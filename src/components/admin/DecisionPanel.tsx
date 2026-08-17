/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { ACTION_GHOST, ACTION_PRIMARY, FIELD, Notice, PANEL } from "./adminUi";

/**
 * One thing an admin can do to the thing they are looking at.
 *
 * `effect` is shown only after the button is pressed, in the moment between choosing and confirming.
 * That is the one point where it can still change the answer — printed next to every button up
 * front, three paragraphs of consequence read as decoration and stop being read at all.
 */
export interface DecisionOption {
  id: string;
  label: string;
  /** What this actually does, in the words the admin needs before confirming. */
  effect: string;
  /**
   * `required` — the subject reads this line, so it cannot be blank.
   * `optional` — recorded in the audit log if given.
   * `none`     — approval, which has nothing to justify.
   */
  reason: "required" | "optional" | "none";
  /** The one filled button in the group, if any: the decision the screen is really asking about. */
  primary?: boolean;
  run: (reason: string) => Promise<unknown>;
}

/**
 * The decision, on the page with the evidence.
 *
 * Shared by the event and organizer previews because the shape of the act is identical — choose,
 * read what it will do, justify it, confirm — and only the verbs differ. Written once so a fourth
 * moderation surface cannot invent a fifth way to ask "are you sure".
 *
 * Two steps, never one: no decision here is undoable by the person taking it, and a single click
 * that both chooses and commits is a click somebody makes by accident.
 */
export default function DecisionPanel({
  options,
  onDecided,
}: {
  options: DecisionOption[];
  onDecided: () => void;
}) {
  const [chosen, setChosen] = useState<DecisionOption | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (options.length === 0) return null;

  const submit = async () => {
    if (!chosen) return;
    const text = reason.trim();
    if (chosen.reason === "required" && !text) {
      setFailure(
        "Cần một lý do — người bị ảnh hưởng đọc dòng này, và nhật ký thao tác lưu lại nó.",
      );
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await chosen.run(text);
      onDecided();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Thao tác thất bại.");
      setBusy(false);
    }
  };

  const reset = () => {
    setChosen(null);
    setReason("");
    setFailure(null);
  };

  return (
    <div className={`${PANEL} space-y-3`}>
      <p className="label-eyebrow text-ink-soft">Quyết định</p>
      {failure && <Notice tone="error">{failure}</Notice>}

      {chosen ? (
        <>
          <p className="font-meta text-meta text-ink-soft">{chosen.effect}</p>
          <div className="flex flex-wrap gap-2">
            {chosen.reason !== "none" && (
              <input
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  chosen.reason === "required" ? "Lý do (bắt buộc)" : "Ghi chú (không bắt buộc)"
                }
                className={`${FIELD} min-w-[280px] flex-1`}
              />
            )}
            <button className={ACTION_PRIMARY} onClick={() => void submit()} disabled={busy}>
              {busy ? "Đang gửi…" : `Xác nhận ${chosen.label.toLowerCase()}`}
            </button>
            <button className={ACTION_GHOST} onClick={reset} disabled={busy}>
              Huỷ
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              className={option.primary ? ACTION_PRIMARY : ACTION_GHOST}
              onClick={() => {
                setChosen(option);
                setReason("");
                setFailure(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
