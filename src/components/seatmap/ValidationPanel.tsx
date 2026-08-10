/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ValidationIssue } from "@/shared/catalog/seatmap-validate";

/**
 * The five pre-publish checks, each naming the seats or sections at fault rather than reporting one
 * generic failure (FR-030, FR-031).
 *
 * Fed by the shared validator, so what the organizer sees while drafting is exactly what the publish
 * gate will decide. Advisory here — the server still refuses (R-11). A draft is allowed to sit in a
 * failing state; the gate is at publish, not at every keystroke (FR-032).
 */
export default function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-la-co bg-surface-2 p-4">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-la-co">Hợp lệ</h3>
        <p className="mt-1 text-xs text-beige-kem/70">Sơ đồ có thể phát hành.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-bubblegum bg-surface-2 p-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-bubblegum">
        {issues.length} vấn đề — chưa thể phát hành
      </h3>
      <ul className="mt-2 space-y-2">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${i}`} className="text-xs leading-5 text-beige-kem/80">
            {/* Message is plain text from the shared validator — React escapes it (SEC-07). */}
            <span className="font-bold">{issue.message}</span>
            {issue.seatIds && issue.seatIds.length > 0 && (
              <span className="ml-1 font-mono text-[12px] text-beige-kem/50">(ghế #{issue.seatIds.join(", #")})</span>
            )}
            {issue.sectionIds && issue.sectionIds.length > 0 && (
              <span className="ml-1 font-mono text-[12px] text-beige-kem/50">(khu vực #{issue.sectionIds.join(", #")})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
