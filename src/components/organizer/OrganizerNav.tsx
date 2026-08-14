/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useNavigate } from "react-router-dom";

/**
 * The organizer console's section bar.
 *
 * The seat map used to be a full-screen overlay launched from inside one event, which said the wrong
 * thing about what a chart is: a chart belongs to a VENUE and backs many showtimes across many events.
 * Making the sections siblings is what turns the console into a dashboard the seat map is a module OF,
 * rather than a page that happens to open a separate tool.
 *
 * Deliberately lists only sections that exist. Orders, attendees and analytics belong here eventually,
 * but a nav item leading to an empty screen is worse than no nav item — it advertises a feature the
 * platform does not have.
 */

const SECTIONS: { label: string; path: string; match: (path: string) => boolean }[] = [
  {
    label: "Sự kiện",
    path: "/organizer",
    // Exact, or the events section would also light up on `/organizer/seatmaps`.
    match: (p) => p === "/organizer" || p.startsWith("/organizer/events"),
  },
  {
    label: "Sơ đồ ghế",
    path: "/organizer/seatmaps",
    match: (p) => p.startsWith("/organizer/seatmaps"),
  },
];

export default function OrganizerNav({ current }: { current: string }) {
  const navigate = useNavigate();

  return (
    <nav aria-label="Khu vực quản lý" className="flex flex-wrap gap-2">
      {SECTIONS.map((s) => {
        const active = s.match(current);
        return (
          <button
            key={s.path}
            onClick={() => navigate(s.path)}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl border-2 px-3 py-1.5 text-eyebrow font-bold transition ${
              active
                ? "border-beige-kem bg-beige-kem/10 text-beige-kem"
                : "border-beige-kem/40 text-beige-kem/65 hover:border-beige-kem hover:text-beige-kem"
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
