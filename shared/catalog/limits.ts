/** Default number of active ticket tiers per showtime; archived tiers do not use a slot. */
export const DEFAULT_MAX_TIERS_PER_SHOWTIME = 20;

/** Effective server settings, so organizer forms never maintain a separate tier limit. */
export interface OrganizerLimits {
  maxTiersPerShowtime: number;
}
