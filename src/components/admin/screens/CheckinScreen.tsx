/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState } from "react";
import type { CheckinResult } from "@shared/admin/types.js";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_PRIMARY,
  FIELD,
  Notice,
  PANEL,
  Pill,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";

/**
 * The door (UC-27, UC-28).
 *
 * What this replaces was an input box and a line of copy that said "mock result" — nothing was ever
 * written, and every check-in figure in the product was therefore zero.
 *
 * Two things shape the design, both from how the thing is actually used. A hardware QR scanner types
 * the code and presses Enter, so the field submits on Enter, clears itself and takes focus back —
 * one scan, one action, no mouse. And a re-scan is not an error: staff scan the same wristband twice
 * all the time, and the honest answer is "already inside, since 19:42", not a red failure that makes
 * them doubt a genuine ticket.
 */
export default function CheckinScreen() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [last, setLast] = useState<CheckinResult | null>(null);
  const [history, setHistory] = useState<CheckinResult[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const scan = async () => {
    const barcode = code.trim();
    if (!barcode) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await adminClient.checkIn(barcode);
      setLast(result);
      setHistory((rows) => [result, ...rows].slice(0, 20));
      setCode("");
    } catch (cause) {
      setLast(null);
      setFailure(cause instanceof Error ? cause.message : "Không quét được vé này.");
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <>
      <ScreenHead
        title="Check-in"
        meta="Quét mã QR hoặc gõ tay mã vé — cửa mở trước giờ diễn 6 tiếng"
      />

      <form
        className={`${PANEL} space-y-3`}
        onSubmit={(event) => {
          event.preventDefault();
          void scan();
        }}
      >
        <label className="space-y-1">
          <span className="label-eyebrow block text-ink-soft">Mã vé</span>
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Quét QR, hoặc gõ mã in trên vé"
              className={`${FIELD} min-w-[280px] flex-1`}
            />
            <button type="submit" className={ACTION_PRIMARY} disabled={busy || !code.trim()}>
              {busy ? "Đang kiểm tra…" : "Xác nhận check-in"}
            </button>
          </div>
        </label>
        <p className="font-meta text-body text-ink-soft">
          Máy quét cầm tay gõ mã rồi nhấn Enter — không cần chạm chuột giữa hai lượt khách.
        </p>
      </form>

      {failure && <Notice tone="error">{failure}</Notice>}

      {last && (
        <div
          className={`border-l-2 p-5 ${
            last.admitted ? "border-la-co bg-la-co/10" : "border-cam-dat bg-cam-dat/15"
          }`}
        >
          <p className="label-eyebrow text-ink-soft">
            {last.admitted ? "Cho vào" : "Vé này đã vào rồi"}
          </p>
          <p className="mt-2 font-display text-title-m font-black text-beige-kem">
            {last.buyerName}
          </p>
          <p className="mt-1 font-meta text-body text-beige-kem">
            {last.eventTitle} · {last.tier}
            {last.seat ? ` · Ghế ${last.seat}` : ""}
          </p>
          <p className="mt-1 font-meta text-meta text-ink-soft">
            {last.admitted ? "Vào lúc" : "Đã vào từ"}{" "}
            {new Date(last.checkedInAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Saigon" })} ·
            mã {last.barcode}
          </p>
        </div>
      )}

      {history.length > 0 && (
        <div className={`${PANEL} space-y-3`}>
          <p className="label-eyebrow text-ink-soft">Lượt quét gần đây · ca này</p>
          <TableScroll>
            <table className="w-full min-w-[620px] text-left text-body">
              <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                <tr>
                  <Th>Khách</Th>
                  <Th>Hạng vé</Th>
                  <Th>Ghế</Th>
                  <Th>Kết quả</Th>
                  <Th>Giờ</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, index) => (
                  <tr key={`${row.ticketId}-${index}`} className="border-b border-beige-kem/15">
                    <Td>{row.buyerName}</Td>
                    <Td nowrap>{row.tier}</Td>
                    <Td nowrap>{row.seat ?? "—"}</Td>
                    <Td nowrap>
                      <Pill tone={row.admitted ? "good" : "warn"}>
                        {row.admitted ? "Cho vào" : "Quét lại"}
                      </Pill>
                    </Td>
                    <Td nowrap>
                      {new Date(row.checkedInAt).toLocaleTimeString("vi-VN", {
                        timeZone: "Asia/Saigon",
                      })}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </>
  );
}
