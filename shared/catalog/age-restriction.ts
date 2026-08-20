/**
 * How an event's age limit is written for a reader.
 *
 * `events.age_restriction` stores one of four codes (0002_catalog.sql). Three of them — `13+`,
 * `16+`, `18+` — already read as themselves, which is why the raw value survived so long in the UI.
 * The fourth does not: `all` is an English word that reached Vietnamese-speaking organizers and
 * admins verbatim, in the organizer's own listing preview and in the admin moderation queue.
 *
 * Shared rather than mapped at each call site, because there were already two of those and they
 * disagreed about whether to translate at all.
 */
export type AgeRestriction = 'all' | '13+' | '16+' | '18+';

const LABELS: Record<string, string> = {
  all: 'Mọi lứa tuổi',
  '13+': '13+',
  '16+': '16+',
  '18+': '18+',
};

/**
 * Unknown codes are returned untouched: a value this table has not met yet is more useful shown as
 * itself than replaced by a guess, and the CHECK constraint means one can only appear after a
 * migration this file should be updated alongside.
 */
export function ageRestrictionLabel(code: string | null | undefined): string {
  if (!code) return '';
  return LABELS[code] ?? code;
}
