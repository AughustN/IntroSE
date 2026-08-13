import { err } from '../../http.js';
import type { Db } from '../../db/pool.js';
import { withTransaction } from '../../db/pool.js';
import { insertAudit } from './audit.js';
// The reviews module owns what a review row may become; moderation only decides that it should.
import { setStatus as setReviewStatus } from '../reviews/reviews.repo.js';
import { eventQueue, insertNotification, listCategories, listFeatured, deleteCategory, insertCategory, lockEvent, lockOrganizer, organizerQueue, reportQueue, replaceFeatured, resolveReport, updateCategory, updateEvent, updateOrganizer } from './admin.repo.js';

const categoryCode = (label: string) => `custom_${label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'category'}_${Date.now()}`;

export const categories = () => listCategories();

export async function createCategory(actorUserId: number, labelVi: string, labelEn: string | null) {
  return withTransaction(async (db) => {
    try {
      const result = await insertCategory(labelVi.trim(), labelEn?.trim() || null, categoryCode(labelVi), db);
      await insertAudit(db, { actorUserId, action: 'category_created', targetType: 'event_category', targetId: result.id, outcome: 'applied', detail: { labelVi, labelEn } });
      return result;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw err.conflict('category_conflict', 'Danh mục đã tồn tại.');
      throw error;
    }
  });
}

export async function renameCategory(actorUserId: number, id: number, labelVi: string, labelEn: string | null) {
  return withTransaction(async (db) => {
    try {
      const result = await updateCategory(id, labelVi.trim(), labelEn?.trim() || null, db);
      if (!result) throw err.notFound('not_found');
      await insertAudit(db, { actorUserId, action: 'category_renamed', targetType: 'event_category', targetId: id, outcome: 'applied', detail: { labelVi, labelEn } });
      return result;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw err.conflict('category_conflict', 'Danh mục đã tồn tại.');
      throw error;
    }
  });
}

export async function removeCategory(actorUserId: number, id: number) {
  return withTransaction(async (db) => {
    const result = await deleteCategory(id, db);
    if (!result) throw err.conflict('category_in_use', 'Không thể xóa danh mục đang có sự kiện.');
    await insertAudit(db, { actorUserId, action: 'category_deleted', targetType: 'event_category', targetId: id, outcome: 'applied' });
  });
}

export const featured = () => listFeatured();

export async function replaceFeaturedEvents(actorUserId: number, events: Array<{ eventId: number; displayOrder: number }>) {
  return withTransaction(async (db) => {
    const result = await replaceFeatured(events, db);
    await insertAudit(db, { actorUserId, action: 'featured_events_replaced', targetType: 'featured_events', targetId: null, outcome: 'applied', detail: { events } });
    return result;
  });
}

export async function queue() {
  return withTransaction(async (db) => ({ organizers: await organizerQueue(db), events: await eventQueue(db), reports: await reportQueue(db) }));
}

async function organizerAction(actorUserId: number, id: number, next: 'approved' | 'rejected' | 'suspended', reason: string | null) {
  return withTransaction(async (db) => {
    const current = await lockOrganizer(id, db);
    if (!current) throw err.notFound('not_found');
    const allowed = next === 'suspended' ? current.status === 'approved' : current.status === 'pending';
    if (!allowed) throw err.conflict('moderation_conflict', 'Trạng thái đã thay đổi.');
    const result = await updateOrganizer(id, next, reason, actorUserId, db);
    await insertNotification(db, { recipientUserId: current.user_id, kind: `organizer_${next}`, targetType: 'organizer', targetId: id, payload: { reason } });
    await insertAudit(db, { actorUserId, action: `organizer_${next}`, targetType: 'organizer', targetId: id, outcome: 'applied', detail: { before: current.status, after: next, reason } });
    return result;
  });
}

export const approveOrganizer = (actor: number, id: number) => organizerAction(actor, id, 'approved', null);
export const rejectOrganizer = (actor: number, id: number, reason: string) => organizerAction(actor, id, 'rejected', reason);
export const suspendOrganizer = (actor: number, id: number, reason: string) => organizerAction(actor, id, 'suspended', reason);

export async function moderateEvent(actorUserId: number, id: number, next: 'approved' | 'removed' | 'flagged', reason: string | null) {
  return withTransaction((db) => moderateEventIn(db, actorUserId, id, next, reason));
}

/** The event transition itself, so a report resolution can apply it in ITS transaction (FR-024). */
async function moderateEventIn(db: Db, actorUserId: number, id: number, next: 'approved' | 'removed' | 'flagged', reason: string | null) {
  const current = await lockEvent(id, db);
  if (!current) throw err.notFound('not_found');
  const allowed = next === 'approved' ? current.moderation_status === 'pending_review' : next === 'flagged' ? current.moderation_status === 'approved' : ['pending_review', 'approved', 'flagged'].includes(current.moderation_status);
  if (!allowed) throw err.conflict('moderation_conflict', 'Trạng thái đã thay đổi.');
  const result = await updateEvent(id, next, reason, db);
  await insertNotification(db, { recipientUserId: current.organizer_user_id, kind: `event_${next}`, targetType: 'event', targetId: id, payload: { reason } });
  await insertAudit(db, { actorUserId, action: `event_${next}`, targetType: 'event', targetId: id, outcome: 'applied', detail: { before: current.moderation_status, after: next, reason } });
  return result;
}

export async function dismissReport(actorUserId: number, id: number, reason: string | null) {
  return withTransaction(async (db) => {
    if (!(await resolveReport(id, 'dismissed', reason, actorUserId, db))) throw err.conflict('moderation_conflict');
    await insertAudit(db, { actorUserId, action: 'report_dismissed', targetType: 'report', targetId: id, outcome: 'applied', detail: { reason } });
    return { ok: true };
  });
}

export async function resolveReportedEvent(actorUserId: number, reportId: number, decision: 'flag' | 'remove', reason: string) {
  return withTransaction(async (db) => {
    const report = await resolveReport(reportId, decision === 'flag' ? 'flagged' : 'resolved', reason, actorUserId, db);
    if (!report) throw err.conflict('moderation_conflict');
    // The decision must actually bite the target, in this same transaction (FR-015/016, FR-024).
    if (report.target_type === 'event') {
      await moderateEventIn(db, actorUserId, report.target_id, decision === 'flag' ? 'flagged' : 'removed', reason);
    } else if (report.target_type === 'review') {
      /*
       * A comment has one outcome — it stays or it goes. There is no "flagged" state for one, and
       * silently resolving the report while leaving the comment up would tell the admin they had
       * acted when they had not.
       *
       * Hidden, not deleted: the report and the audit row must keep a subject an admin can still
       * read afterwards (FR-019, SEC-09). The transaction is what makes the removal and its audit
       * entry inseparable.
       */
      if (decision !== 'remove') {
        throw err.badRequest('validation_failed', 'Bình luận chỉ có thể gỡ hoặc bỏ qua báo cáo.');
      }
      if (!(await setReviewStatus(report.target_id, 'removed', db))) {
        throw err.notFound('not_found', 'Không tìm thấy bình luận này.');
      }
      await insertAudit(db, { actorUserId, action: 'review_removed', targetType: 'review', targetId: report.target_id, outcome: 'applied', detail: { reason, reportId } });
    }
    await insertAudit(db, { actorUserId, action: `report_${decision}`, targetType: 'report', targetId: reportId, outcome: 'applied', detail: { reason, targetType: report.target_type, targetId: report.target_id } });
    return { ok: true };
  });
}
