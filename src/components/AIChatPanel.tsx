import { FormEvent, useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { aiClient, type ChatResponse, type ConversationTurn } from "../services/aiClient";
import { formatVnd } from "../services/currency";
import { formatEventDate } from "../services/formatDate";

interface AIChatPanelProps {
  signedIn: boolean;
  /** Opens an event inside the application. A recommendation must not reload the page. */
  onOpenEvent: (slug: string) => void;
}

/**
 * One line of the transcript.
 *
 * The reader's turns carry only text; the assistant's carry everything the answer was made of, so a
 * reply and the events it produced stay together as the conversation grows. The wire history is
 * derived from this rather than kept alongside it — two lists would drift.
 */
type Entry = { role: "user"; content: string } | { role: "assistant"; answer: ChatResponse };

const OPENERS = [
  "Cuối tuần này có nhạc gì?",
  "Sự kiện dưới 300.000đ ở TP.HCM",
  "Giữ ghế bao lâu thì hết hạn?",
];

const GREETING = "Chào bạn! Mình có thể tìm sự kiện, so giá vé và giải thích cách đặt vé trên TixHub.";

export default function AIChatPanel({ signedIn, onOpenEvent }: AIChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  /*
   * Follow the conversation down as it grows, the way a messaging app does.
   *
   * Keyed on the turn count and the pending state so the scroll happens both when an answer lands
   * and when the typing indicator appears — a reader who cannot see the dots has no way to tell the
   * difference between "thinking" and "did nothing".
   */
  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, busy, open]);

  // Escape closes, and focus goes back to the thing that opened it rather than to the top of the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      launcherRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ask = async (question: string) => {
    const message = question.trim();
    if (!message || busy) return;

    // The wire history is what is already on screen, capped by the client the same way the server
    // caps it. The new message is not in it — it travels as `message`.
    const history: ConversationTurn[] = entries.map((entry) =>
      entry.role === "user"
        ? { role: "user" as const, content: entry.content }
        : { role: "assistant" as const, content: entry.answer.reply },
    );

    setEntries((prior) => [...prior, { role: "user", content: message }]);
    setDraft("");
    setError(null);
    setBusy(true);
    try {
      const answer = await aiClient.chat(message, history);
      setEntries((prior) => [...prior, { role: "assistant", answer }]);
    } catch (e) {
      // The only error the server reports is the attendee's own hourly limit; everything else comes
      // back as a successful answer carrying fallback events (Principle III).
      setError(e instanceof Error ? e.message : "Không thể gọi trợ lý.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  return (
    <>
      {/*
        The launcher: one red disc, bottom right, above everything.

        It replaces a full-width bar that sat between the filters and the results and pushed them
        apart on every visit, whether or not anyone wanted to ask anything. A conversation is
        something you go to, so it waits in a corner until it is wanted.
      */}
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-label={open ? "Đóng trợ lý TixHub" : "Mở trợ lý TixHub"}
        className="fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-burgundy text-white shadow-[0_6px_24px_rgba(138,12,36,0.35)] transition hover:bg-burgundy-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
      >
        {open ? (
          <X aria-hidden="true" className="h-6 w-6" />
        ) : (
          <MessageCircle aria-hidden="true" className="h-6 w-6" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Trợ lý TixHub"
          className="fixed bottom-24 right-6 z-50 flex max-h-[min(34rem,calc(100dvh-8rem))] w-[min(24rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-beige-kem/30 bg-surface-2 shadow-[0_18px_50px_rgba(138,12,36,0.22)]"
        >
          {/* Header: who you are talking to, as a messaging app names the other party. */}
          <div className="flex items-center gap-3 border-b border-beige-kem/20 bg-burgundy px-4 py-3 text-white">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15">
              <MessageCircle aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-body font-black uppercase tracking-[0.04em]">
                Trợ lý TixHub
              </p>
              <p className="font-meta text-eyebrow text-white/70">
                {busy ? "Đang soạn tin…" : "Thường trả lời ngay"}
              </p>
            </div>
          </div>

          {!signedIn ? (
            <div className="px-4 py-8 text-center">
              <p className="font-meta text-body text-beige-kem/80">
                Đăng nhập để hỏi trợ lý về sự kiện, giá vé và lịch diễn.
              </p>
            </div>
          ) : (
            <>
              {/*
                The thread. `aria-live="polite"` so a reply arriving after a wait is announced —
                a reader who looked away is exactly the one who needs telling.
              */}
              <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                <Bubble from="assistant">{GREETING}</Bubble>

                {entries.map((entry, index) =>
                  entry.role === "user" ? (
                    <Bubble key={index} from="user">
                      {entry.content}
                    </Bubble>
                  ) : (
                    <div key={index} className="space-y-2">
                      <Bubble from="assistant">{entry.answer.reply}</Bubble>

                      {entry.answer.message && (
                        <p className="pl-1 font-meta text-eyebrow text-ink-soft">
                          {entry.answer.message}
                        </p>
                      )}

                      {entry.answer.recommendations.map(({ event, reason }) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => onOpenEvent(event.slug)}
                          className="block w-full rounded-xl rounded-tl-sm border border-beige-kem/25 bg-xanh-pho p-3 text-left transition hover:border-burgundy"
                        >
                          <p className="font-display text-body font-black uppercase leading-tight tracking-[0.02em] text-beige-kem">
                            {event.title}
                          </p>
                          <p className="mt-1 font-meta text-eyebrow text-ink-soft">
                            {[
                              formatEventDate(event.startsAt.slice(0, 10), true),
                              event.city,
                              event.startingPrice === null
                                ? null
                                : `từ ${formatVnd(event.startingPrice)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <p className="mt-1.5 font-meta text-eyebrow leading-5 text-beige-kem/75">
                            {reason}
                          </p>
                        </button>
                      ))}
                    </div>
                  ),
                )}

                {/* The other side, composing. Same bubble as any reply, so it reads as one arriving. */}
                {busy && (
                  <div className="flex">
                    <div
                      role="status"
                      aria-label="Trợ lý đang soạn tin"
                      className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-beige-kem/10 px-4 py-3 text-beige-kem"
                    >
                      <span className="chat-dot" />
                      <span className="chat-dot" />
                      <span className="chat-dot" />
                    </div>
                  </div>
                )}

                {error && <p className="font-meta text-eyebrow text-burgundy-ink">{error}</p>}

                {/* Openers, offered once. After the first exchange the thread is the prompt. */}
                {entries.length === 0 && !busy && (
                  <div className="flex flex-col items-start gap-2 pt-1">
                    {OPENERS.map((opener) => (
                      <button
                        key={opener}
                        type="button"
                        onClick={() => void ask(opener)}
                        className="rounded-full border border-beige-kem/30 px-3 py-1.5 font-meta text-eyebrow text-ink-soft transition hover:border-burgundy hover:text-beige-kem"
                      >
                        {opener}
                      </button>
                    ))}
                  </div>
                )}

                <div ref={endRef} />
              </div>

              <form
                onSubmit={submit}
                className="flex items-center gap-2 border-t border-beige-kem/20 px-3 py-3"
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={600}
                  placeholder="Nhắn cho trợ lý…"
                  aria-label="Tin nhắn gửi trợ lý"
                  className="h-10 min-w-0 flex-1 rounded-full border border-beige-kem/30 bg-xanh-pho px-4 font-meta text-meta text-beige-kem outline-none transition focus:border-burgundy"
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  aria-label="Gửi"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-burgundy text-white transition hover:bg-burgundy-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden="true" className="text-body leading-none">
                    ↑
                  </span>
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** One message. Which side it sits on, and which corner is squared off, is who said it. */
function Bubble({ from, children }: { from: "user" | "assistant"; children: React.ReactNode }) {
  const mine = from === "user";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <p
        className={`max-w-[85%] px-4 py-2.5 font-meta text-meta leading-6 ${
          mine
            ? "rounded-2xl rounded-br-sm bg-burgundy text-white"
            : "rounded-2xl rounded-tl-sm bg-beige-kem/10 text-beige-kem"
        }`}
      >
        {children}
      </p>
    </div>
  );
}
