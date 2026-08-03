import { err } from '../../http.js';
import { withTransaction } from '../../db/pool.js';
import { insertAudit } from './audit.js';
import { eventQueue, lockEvent, lockOrganizer, organizerQueue, reportQueue, resolveReport, updateEvent, updateOrganizer } from './admin.repo.js';

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
    await insertAudit(db, { actorUserId, action: `organizer_${next}`, targetType: 'organizer', targetId: id, outcome: 'applied', detail: { before: current.status, after: next, reason } });
    return result;
  });
}

export const approveOrganizer = (actor: number, id: number) => organizerAction(actor, id, 'approved', null);
export const rejectOrganizer = (actor: number, id: number, reason: string) => organizerAction(actor, id, 'rejected', reason);
export const suspendOrganizer = (actor: number, id: number, reason: string) => organizerAction(actor, id, 'suspended', reason);

export async function moderateEvent(actorUserId: number, id: number, next: 'approved' | 'removed' | 'flagged', reason: string | null) {
  return withTransaction(async (db) => {
    const current = await lockEvent(id, db);
    if (!current) throw err.notFound('not_found');
    const allowed = next === 'approved' ? current.moderation_status === 'pending_review' : next === 'flagged' ? current.moderation_status === 'approved' : ['pending_review', 'approved', 'flagged'].includes(current.moderation_status);
    if (!allowed) throw err.conflict('moderation_conflict', 'Trạng thái đã thay đổi.');
    const result = await updateEvent(id, next, reason, db);
    await insertAudit(db, { actorUserId, action: `event_${next}`, targetType: 'event', targetId: id, outcome: 'applied', detail: { before: current.moderation_status, after: next, reason } });
    return result;
  });
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
    await insertAudit(db, { actorUserId, action: `report_${decision}`, targetType: 'report', targetId: reportId, outcome: 'applied', detail: { reason } });
    return { ok: true };
  });
}
