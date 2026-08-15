/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { catalogClient, type EventCategory } from "../services/catalogClient";

/**
 * The catalogue's categories, fetched once per mount.
 *
 * Replaces the six-entry `EVENT_CATEGORIES` constant the organizer forms used to read. The database
 * holds thirteen, so seven of them could not be chosen by anyone creating an event, and a category an
 * Admin added through the console saved successfully and then appeared nowhere. Categories are
 * Admin-managed data (UC-35); a copy compiled into the bundle can only ever be a stale second
 * opinion.
 *
 * Failure yields an empty list rather than throwing: a category picker that cannot load is a form
 * with one empty dropdown, not a broken screen.
 */
export function useEventCategories(): EventCategory[] {
  const [categories, setCategories] = useState<EventCategory[]>([]);

  useEffect(() => {
    let alive = true;
    catalogClient
      .listCategories()
      .then((rows) => {
        if (alive) setCategories(rows);
      })
      .catch(() => {
        if (alive) setCategories([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return categories;
}
