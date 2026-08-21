/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { ListingSuggestion } from "@/shared/catalog/types";
import { aiApi } from "../../services/catalogClient";
import { dong } from "./states";

const input =
  "h-10 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
const btn =
  " bg-burgundy px-3 py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50";
const ghost = " border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80";

/**
 * UC-22, bound by constitution Principle III: assistive, never autonomous.
 *
 * Nothing here reaches the event by itself. Each field is accepted individually, after any edits the
 * organizer makes, and rejecting everything leaves the form untouched (FR-028).
 *
 * When the assistant is unavailable — timeout, upstream error, exhausted quota — the server answers
 * `available: false` with a 200, and this panel says so quietly and gets out of the way. It is never
 * an error state, because the organizer can always just type (FR-029, FR-030).
 */
export default function AiListingPanel({
  eventId,
  onAccept,
}: {
  eventId?: number;
  /** Push one accepted field into the form. Only ever called by an explicit click. */
  onAccept: (field: "title" | "description", value: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [pending, setPending] = useState(false);
  const [suggestion, setSuggestion] = useState<ListingSuggestion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const generate = async () => {
    if (!topic.trim()) return;
    setPending(true);
    setNotice(null);
    setSuggestion(null);
    try {
      const res = await aiApi.listing({
        eventId,
        topic: topic.trim(),
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      });
      if (res.available && res.suggestion) {
        setSuggestion(res.suggestion);
        setDraft(res.suggestion.description ?? "");
      } else {
        // A non-blocking notice, never an error banner: the form below still works exactly as before.
        setNotice(
          "Trợ lý AI hiện không dùng được. Bạn có thể nhập nội dung thủ công như bình thường.",
        );
      }
    } catch (e) {
      // Only the per-user rate limit reaches here, and it is the one case worth surfacing (UC-22 A2).
      setNotice((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="border-2 border-dashed border-beige-kem/50 p-4">
      <div className="flex items-center justify-between">
        <h4 className="font-display text-sm font-bold">Trợ lý viết nội dung (tuỳ chọn)</h4>
        <span className="font-mono text-[10px] text-beige-kem/45">
          Gợi ý — bạn luôn sửa được trước khi dùng
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Chủ đề (vd: nhạc acoustic)"
          className={input}
        />
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Từ khoá, cách nhau bởi dấu phẩy"
          className={input}
        />{" "}
        <button onClick={generate} disabled={pending || !topic.trim()} className={btn}>
          {pending ? "Đang tạo…" : "Tạo gợi ý"}
        </button>
      </div>

      {notice && <p className="mt-3 font-mono text-[11px] text-beige-kem/60">{notice}</p>}

      {suggestion && (
        <div className="mt-4 space-y-3">
          {suggestion.titles.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[11px] text-beige-kem/60">Tiêu đề gợi ý</p>
              <div className="flex flex-wrap gap-2">
                {suggestion.titles.map((t) => (
                  <button key={t} onClick={() => onAccept("title", t)} className={ghost}>
                    Dùng: {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {suggestion.description !== null && (
            <div>
              <p className="mb-1 font-mono text-[11px] text-beige-kem/60">
                Mô tả gợi ý — sửa tuỳ ý trước khi dùng
              </p>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                className={`${input} h-auto py-2`}
              />
              <button onClick={() => onAccept("description", draft)} className={`${ghost} mt-2`}>
                Dùng mô tả này
              </button>
            </div>
          )}

          {suggestion.tags.length > 0 && (
            <p className="font-mono text-[11px] text-beige-kem/60">
              Thẻ gợi ý: {suggestion.tags.join(" · ")}
            </p>
          )}

          {suggestion.price !== null && (
            <p className="font-mono text-[11px] text-beige-kem/60">
              Giá tham khảo: {dong(suggestion.price)} — mức giữa của {suggestion.priceBasis} sự kiện
              tương tự đang bán trên TixHub.
            </p>
          )}

          <button
            onClick={() => setSuggestion(null)}
            className="font-mono text-[11px] text-beige-kem/45 underline"
          >
            Bỏ qua tất cả gợi ý
          </button>
        </div>
      )}
    </div>
  );
}
