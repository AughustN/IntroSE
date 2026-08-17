import type { SystemSettingKey, SystemSettings } from '@shared/admin/types.js';
import { DEFAULT_SYSTEM_SETTINGS } from '../../config.js';
import type { Db } from '../../db/pool.js';
import { pool, withTransaction } from '../../db/pool.js';
import { err } from '../../http.js';
import { insertAudit } from './audit.js';

export const SETTINGS_CACHE_TTL_MS = 15_000;
const keys = Object.keys(DEFAULT_SYSTEM_SETTINGS) as SystemSettingKey[];
const defaults: SystemSettings = { ...DEFAULT_SYSTEM_SETTINGS };
type CachedSettings = { value: SystemSettings; expiresAt: number };
let cache: CachedSettings | null = null;
let now = () => Date.now();

const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function validValue(key: SystemSettingKey, value: unknown): boolean {
  switch (key) {
    case 'seat_hold_ttl_minutes': return integer(value, 1, 30);
    case 'topup_grace_minutes': return integer(value, 1, 15);
    case 'absolute_ceiling_minutes': return integer(value, 2, 30);
    case 'max_tickets_per_buyer': return integer(value, 1, 50);
    case 'wallet_topup_min':
    case 'wallet_topup_max':
    case 'wallet_balance_ceiling': return integer(value, 0, Number.MAX_SAFE_INTEGER);
    case 'ai_features_enabled': return typeof value === 'boolean';
    // Zero is deliberately allowed: it stops every external AI call without touching the switch.
    case 'ai_platform_request_ceiling': return integer(value, 0, Number.MAX_SAFE_INTEGER);
    case 'ai_platform_window_hours': return integer(value, 1, 720);
  }
}

function validate(settings: SystemSettings): void {
  for (const key of keys) {
    if (!validValue(key, settings[key])) throw err.badRequest('validation_failed', `Giá trị ${key} không hợp lệ.`);
  }
  if (settings.topup_grace_minutes > settings.absolute_ceiling_minutes) {
    throw err.badRequest('validation_failed', 'Thời gian gia hạn không thể lớn hơn giới hạn tuyệt đối.');
  }
  if (settings.wallet_topup_min > settings.wallet_topup_max || settings.wallet_topup_max > settings.wallet_balance_ceiling) {
    throw err.badRequest('validation_failed', 'Giới hạn nạp tiền và số dư không hợp lệ.');
  }
}

function parseStoredValue(key: SystemSettingKey, value: unknown): SystemSettings[SystemSettingKey] | undefined {
  return validValue(key, value) ? (value as SystemSettings[SystemSettingKey]) : undefined;
}

async function load(db: Db): Promise<SystemSettings> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM system_settings WHERE key = ANY($1::text[])', [keys],
  );
  const settings: SystemSettings = { ...defaults };
  for (const row of rows) {
    if (keys.includes(row.key as SystemSettingKey)) {
      const key = row.key as SystemSettingKey;
      const value = parseStoredValue(key, row.value);
      if (value !== undefined) settings[key] = value as never;
    }
  }
  try { validate(settings); } catch { return { ...defaults }; }
  return settings;
}

export async function getSettings(db: Db = pool): Promise<SystemSettings> {
  if (db === pool && cache && cache.expiresAt > now()) return { ...cache.value };
  const settings = await load(db);
  if (db === pool) cache = { value: settings, expiresAt: now() + SETTINGS_CACHE_TTL_MS };
  return { ...settings };
}

/*
 * Settings the console may read but not write.
 *
 * The AI ceiling governs spend with an outside provider, and the switch in front of it is the only
 * thing standing between a misconfiguration and an unbounded bill. That is an operator decision,
 * made where the API key lives, not a dial on a screen any admin can reach.
 *
 * Enforced here rather than by removing the fields from the form: a hidden input is not a rule, and
 * this endpoint takes a whole settings object, so anything omitted from the UI is still one crafted
 * request away from being written.
 */
const READ_ONLY: SystemSettingKey[] = [
  'ai_features_enabled',
  'ai_platform_request_ceiling',
  'ai_platform_window_hours',
];
const EDITABLE = keys.filter((key) => !READ_ONLY.includes(key));

export async function updateSettings(actorUserId: number, input: SystemSettings): Promise<SystemSettings> {
  const updated = await withTransaction(async (db) => {
    const before = await load(db);
    /*
     * The stored value wins for every read-only key, whatever the request said.
     *
     * Merged BEFORE validation, so a caller sending nonsense in a field they cannot change gets
     * their legitimate edits saved rather than a 400 about a value that was never going to be used.
     */
    const next: SystemSettings = { ...input };
    for (const key of READ_ONLY) (next[key] as SystemSettings[SystemSettingKey]) = before[key];
    validate(next);

    for (const key of EDITABLE) {
      await db.query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [key, JSON.stringify(next[key]), actorUserId],
      );
    }
    await insertAudit(db, { actorUserId, action: 'system_settings_updated', targetType: 'system_settings', targetId: null, outcome: 'applied', detail: { changedKeys: EDITABLE, before, after: next } });
    return { ...next };
  });
  cache = { value: updated, expiresAt: now() + SETTINGS_CACHE_TTL_MS };
  return updated;
}

export const settingServiceTest = {
  resetCache: () => { cache = null; },
  setNow: (clock: () => number) => { now = clock; },
  resetNow: () => { now = () => Date.now(); },
};
