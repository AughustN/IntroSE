import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import type { AuditOutcome } from '@shared/admin/types.js';

export async function insertAudit(db: Db, input: { actorUserId: number; action: string; targetType: string; targetId: number | null; outcome: AuditOutcome; detail?: Record<string, unknown> }): Promise<void> {
  await db.query(`INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [input.actorUserId, input.action, input.targetType, input.targetId, input.outcome, JSON.stringify(input.detail ?? {})]);
}

export async function listAuditLogs(db: Db = pool) {
  const { rows } = await db.query(`SELECT id, actor_user_id AS "actorUserId", action, target_type AS "targetType", target_id AS "targetId", outcome, detail, created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 200`);
  return rows;
}
