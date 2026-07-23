import type pg from 'pg';
import type { Me, Provider, AccountStatus } from '@shared/auth/types.js';
import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

export interface UserRow {
  id: number;
  email: string;
  phone: string | null;
  nickname: string | null;
  password_hash: string | null;
  provider: Provider;
  provider_user_id: string | null;
  is_admin: boolean;
  status: AccountStatus;
  avatar_url: string | null;
}

const COLS = `id, email, phone, nickname, password_hash, provider, provider_user_id, is_admin, status, avatar_url`;

export function toMe(row: UserRow, isOrganizer: boolean): Me {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    isAdmin: row.is_admin,
    status: row.status,
    provider: row.provider,
    isOrganizer,
  };
}

export async function findById(id: number, db: Db = pool): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findByEmail(email: string, db: Db = pool): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${COLS} FROM users WHERE email = $1`, [email]);
  return rows[0] ?? null;
}

export async function findByPhone(phone: string, db: Db = pool): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${COLS} FROM users WHERE phone = $1`, [phone]);
  return rows[0] ?? null;
}

export async function findByProviderSubject(provider: Provider, subject: string, db: Db = pool): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${COLS} FROM users WHERE provider = $1 AND provider_user_id = $2`, [
    provider,
    subject,
  ]);
  return rows[0] ?? null;
}

/** Organizer capability is derived per request (FR-021): an approved row exists. */
export async function isApprovedOrganizer(userId: number, db: Db = pool): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM organizers WHERE user_id = $1 AND status = 'approved' LIMIT 1`, [userId]);
  return rows.length > 0;
}

/** Create a password account AND its wallet in one transaction (FR-007). */
export async function createPasswordUser(
  client: pg.PoolClient,
  input: { email: string; phone: string | null; nickname: string; passwordHash: string },
): Promise<UserRow> {
  const { rows } = await client.query<UserRow>(
    `INSERT INTO users (email, phone, nickname, password_hash, provider)
     VALUES ($1, $2, $3, $4, 'email')
     RETURNING ${COLS}`,
    [input.email, input.phone, input.nickname, input.passwordHash],
  );
  const user = rows[0]!;
  await client.query(`INSERT INTO wallets (user_id, balance_amount) VALUES ($1, 0)`, [user.id]);
  return user;
}

/** Create a Google account AND its wallet in one transaction (FR-007/024). */
export async function createGoogleUser(
  client: pg.PoolClient,
  input: { email: string; subject: string; nickname: string | null; avatarUrl: string | null },
): Promise<UserRow> {
  const { rows } = await client.query<UserRow>(
    `INSERT INTO users (email, nickname, provider, provider_user_id, avatar_url)
     VALUES ($1, $2, 'google', $3, $4)
     RETURNING ${COLS}`,
    [input.email, input.nickname, input.subject, input.avatarUrl],
  );
  const user = rows[0]!;
  await client.query(`INSERT INTO wallets (user_id, balance_amount) VALUES ($1, 0)`, [user.id]);
  return user;
}

export async function updatePasswordHash(userId: number, hash: string, db: Db = pool): Promise<void> {
  await db.query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [hash, userId]);
}

/** Update only the profile fields a user is allowed to change (FR-035). */
export async function updateProfile(
  userId: number,
  fields: { nickname?: string; phone?: string | null },
  db: Db = pool,
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users
        SET nickname = COALESCE($2, nickname),
            phone    = CASE WHEN $3::boolean THEN $4 ELSE phone END,
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLS}`,
    [userId, fields.nickname ?? null, fields.phone !== undefined, fields.phone ?? null],
  );
  return rows[0]!;
}

export async function updateAvatarUrl(userId: number, url: string, db: Db = pool): Promise<void> {
  await db.query(`UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2`, [url, userId]);
}
