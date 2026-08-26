import { FormEvent, Suspense, lazy, useEffect, useRef, useState } from "react";
import { ChevronDown, Maximize2, MessageCircle, Minimize2, X } from "lucide-react";
import { aiClient, type ChatResponse, type ConversationTurn } from "../services/aiClient";

/*
 * The assistant writes Markdown, so the bubble has to read it.
 *
 * It always did — the model returns "**Thời hạn hủy:**" and numbered lists because that is how a
 * three-condition answer wants to be laid out — and the bubble printed the asterisks and ran the
 * list into one paragraph. The reader saw punctuation where the emphasis was meant to be.
 *
 * `react-markdown` is already here for the legal pages and already has its own chunk, so this costs
 * a lazy import rather than a dependency, and only for readers who get an answer.
 */
const ReactMarkdown = lazy(() => import("react-markdown"));

/**
 * The subset the assistant is allowed to use, mapped onto the bubble's own type.
 *
 * A chat bubble is not an article: headings, quotes and rules would all be louder than the message
 * around them, so they are not given a mapping and `react-markdown` renders them as their contents.
 * What is left is what a short answer actually needs — paragraphs, both kinds of list, emphasis.
 */
const BUBBLE_MARKDOWN = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 leading-5 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-5">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
};
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
  "Phim nào sắp chiếu?",
  "Giữ ghế bao lâu thì hết hạn?",
  "Huỷ vé có được hoàn tiền không?",
];

/**
 * What the assistant can do, said before anyone asks.
 *
 * The greeting used to be one sentence — "mình có thể tìm sự kiện, so giá vé và giải thích cách đặt
 * vé" — which is true and tells a reader nothing they can act on. Somebody opening a chat panel for
 * the first time does not know what vocabulary it understands, and a blank box invites them to
 * guess wrong once and give up. A short list of the actual jobs is the difference between a reader
 * who asks something answerable and one who closes the panel.
 */
const CAPABILITIES = [
  { icon: "🎟️", title: "Tìm sự kiện", detail: "theo thể loại, ngày, thành phố hoặc mức giá" },
  { icon: "🎬", title: "Phim đang & sắp chiếu", detail: "lịch chiếu và rạp gần bạn" },
  { icon: "💺", title: "Cách đặt vé", detail: "chọn ghế, giữ chỗ, thanh toán" },
  { icon: "↩️", title: "Đổi trả & hoàn vé", detail: "điều kiện và thời hạn" },
] as const;

export default function AIChatPanel({ signedIn, onOpenEvent }: AIChatPanelProps) {
  const [open, setOpen] = useState(false);
  /**
   * The bigger panel.
   *
   * A recommendation carries a title, a date, a city, a price and a sentence of reasoning, and at
   * 24rem three of them fill the thread — the reader scrolls a column the width of a receipt to
   * compare things that want to sit side by side. The toggle is the cheap answer: same panel,
   * twice the room, and the reader decides which they are doing.
   */
  const [expanded, setExpanded] = useState(false);
  /**
   * Whether the reader has taken one of the offered questions.
   *
   * The rail is a way in, not a permanent menu: somebody who has used one has learned both what the
   * assistant answers and that they can just type, so leaving it up spends a line of a short panel
   * on an offer already accepted. Typing a question of their own does NOT retire it — that reader
   * has not necessarily seen what else is on offer.
   */
  const [openerUsed, setOpenerUsed] = useState(false);
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
      {/*
        The launcher and its nameplate, on one row so the label sits beside the button rather than
        being drawn inside it — a circle with words in it is not a circle.
      */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        {/*
          Who this is, for the reader who has not met it.
          
          A bare speech bubble in a corner is a convention, not an explanation: it could be support,
          feedback, or a chatbot selling something. The name is the whole difference between a
          button people press and one they learn to ignore.

          Gone once the panel is open — its header says the same thing at that point, and repeating
          it beside the close button says it twice. `pointer-events-none` so the target stays the
          circle: a label that swallows clicks is a bigger button that does not look like one.
        */}
        {!open && (
          <span className="pointer-events-none select-none rounded-full border border-beige-kem/30 bg-surface-2 px-3 py-1.5 label-eyebrow text-beige-kem shadow-[0_4px_16px_rgba(0,0,0,0.18)]">
            TixHub AI
          </span>
        )}

        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-label={open ? "Đóng trợ lý TixHub" : "Mở trợ lý TixHub"}
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-burgundy text-white shadow-[0_6px_24px_rgba(138,12,36,0.35)] transition hover:bg-burgundy-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
        >
          {open ? (
            <X aria-hidden="true" className="h-6 w-6" />
          ) : (
            <MessageCircle aria-hidden="true" className="h-6 w-6" />
          )}
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Trợ lý TixHub"
          /*
           * Rounded, and only here.
           *
           * The rest of the product is drawn with ticket corners and hard edges, which is the brand
           * and stays. A chat panel is the one surface people already have a strong shape for —
           * every messaging app they use rounds its bubbles — and a square speech bubble reads as a
           * label rather than as somebody talking. The rounding stops at this panel's border.
           */
          className={`fixed bottom-24 right-6 z-50 flex flex-col overflow-hidden rounded-2xl border border-beige-kem/30 bg-surface-2 shadow-[0_18px_50px_rgba(138,12,36,0.22)] transition-[width,max-height] duration-200 ${ expanded
              ? "max-h-[min(46rem,calc(100dvh-8rem))] w-[min(34rem,calc(100vw-3rem))]"
              : "max-h-[min(34rem,calc(100dvh-8rem))] w-[min(24rem,calc(100vw-3rem))]"
          }`}
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
              <p className="font-ui text-eyebrow text-white/70">
                {busy ? "Đang soạn tin…" : "Thường trả lời ngay"}
              </p>
            </div>

            {/* Push the controls to the far edge, away from the name they are not part of. */}
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-label={expanded ? "Thu nhỏ khung chat" : "Mở rộng khung chat"}
                className="grid h-8 w-8 place-items-center text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                {expanded ? (
                  <Minimize2 aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Maximize2 aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Đóng khung chat"
                className="grid h-8 w-8 place-items-center text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          {!signedIn ? (
            <div className="px-4 py-8 text-center">
              <p className="font-ui text-body text-beige-kem/80">
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
                {/*
                  The opening card, not a bubble.
                  
                  It is the only turn that is a menu rather than a remark, and dressing it as a
                  message pretends the reader has already been told something. Shown once: after the
                  first exchange the thread itself is the prompt.
                */}
                <Row from="assistant">
                  <div className="rounded-2xl rounded-bl-md border border-beige-kem/25 bg-beige-kem/[0.06] p-3">
                    <p className="font-ui text-eyebrow leading-5 text-beige-kem">
                      Chào bạn! Mình là <strong className="font-bold">Trợ lý TixHub</strong>. Mình có
                      thể giúp bạn:
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {CAPABILITIES.map((c) => (
                        <li key={c.title} className="flex gap-2">
                          <span aria-hidden="true" className="shrink-0 leading-5">
                            {c.icon}
                          </span>
                          <p className="font-ui text-eyebrow leading-5 text-beige-kem/85">
                            <strong className="font-bold text-beige-kem">{c.title}</strong>{" "}
                            {c.detail}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2.5 font-ui text-eyebrow leading-5 text-ink-soft">
                      Hôm nay bạn cần tìm gì?
                    </p>
                  </div>
                </Row>

                {entries.map((entry, index) =>
                  entry.role === "user" ? (
                    <Bubble key={index} from="user">
                      {entry.content}
                    </Bubble>
                  ) : (
                    <div key={index} className="space-y-2">
                      <Bubble from="assistant">{entry.answer.reply}</Bubble>

                      {entry.answer.message && (
                        <p className="pl-1 font-ui text-eyebrow text-ink-soft">
                          {entry.answer.message}
                        </p>
                      )}

                      {entry.answer.recommendations.map(({ event, reason }) => (
                        <Suggestion
                          key={event.id}
                          title={event.title}
                          meta={[
                            formatEventDate(event.startsAt.slice(0, 10), true),
                            event.city,
                            event.startingPrice === null
                              ? null
                              : `từ ${formatVnd(event.startingPrice)}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          reason={reason}
                          onOpen={() => onOpenEvent(event.slug)}
                        />
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
                      className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-beige-kem/10 px-4 py-3 text-beige-kem"
                    >
                      <span className="chat-dot" />
                      <span className="chat-dot" />
                      <span className="chat-dot" />
                    </div>
                  </div>
                )}

                {error && <p className="font-ui text-eyebrow text-burgundy-ink">{error}</p>}

                <div ref={endRef} />
              </div>

              {/*
                Suggested questions, on their own rail above the composer.
                
                They used to sit inside the thread and only before the first message, which put them
                where they scroll away and removed them exactly when a reader has learned enough to
                want another. Here they stay reachable, and a horizontal rail costs one line instead
                of one line per suggestion — the panel is 34rem tall and five stacked buttons took a
                fifth of it.
              */}
              {!busy && !openerUsed && (
                <div className="chat-scrollbar-x flex gap-2 overflow-x-auto border-t border-beige-kem/20 px-3 pb-3.5 pt-2.5">
                  {OPENERS.map((opener) => (
                    <button
                      key={opener}
                      type="button"
                      onClick={() => {
                        setOpenerUsed(true);
                        void ask(opener);
                      }}
                      className="shrink-0 whitespace-nowrap rounded-full border border-beige-kem/30 px-3 py-1.5 font-ui text-eyebrow text-ink-soft transition hover:border-burgundy hover:text-beige-kem"
                    >
                      {opener}
                    </button>
                  ))}
                </div>
              )}

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
                  className="h-10 min-w-0 flex-1 rounded-full border border-beige-kem/30 bg-xanh-pho px-4 font-ui text-meta text-beige-kem outline-none transition focus:border-burgundy"
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

/**
 * A recommended event: the headline always, the reasoning on request.
 *
 * The whole card used to be one button that navigated, with the assistant's sentence of reasoning
 * printed inside it. That put three or four paragraphs of prose in the thread whichever the reader
 * cared about, and made "read why" and "go there" the same gesture — so finding out more about a
 * suggestion meant leaving the conversation that produced it.
 *
 * Split in two: the row opens and closes, and a separate action leaves. Collapsed, four
 * suggestions fit where one used to; expanded, the reasoning is there without costing the page.
 */
function Suggestion({
  title,
  meta,
  reason,
  onOpen,
}: {
  title: string;
  meta: string;
  reason: string;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-beige-kem/25 bg-xanh-pho">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 p-3 text-left transition hover:bg-beige-kem/[0.06]"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-display text-body font-black uppercase leading-tight tracking-[0.02em] text-beige-kem">
            {title}
          </span>
          <span className="mt-1 block font-ui text-eyebrow text-ink-soft">{meta}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`mt-0.5 h-4 w-4 shrink-0 text-ink-soft transition-transform ${ open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="border-t border-beige-kem/20 px-3 pb-3 pt-2.5">
          <p className="font-ui text-eyebrow leading-5 text-beige-kem/75">{reason}</p>
          <button
            type="button"
            onClick={onOpen}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-burgundy px-3 py-1.5 font-ui text-eyebrow font-bold text-white transition hover:bg-burgundy-ink"
          >
            Xem sự kiện
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One turn, with the assistant's face beside it.
 *
 * The avatar is what stops a long thread reading as one voice: a reply, the card it produced and
 * the note under it are three blocks in a row, and without a mark down the left they are
 * indistinguishable from three things the reader said. It repeats on every assistant turn rather
 * than only the first, because the reader scrolls and the first one leaves the screen.
 */
function Row({ from, children }: { from: "user" | "assistant"; children: React.ReactNode }) {
  if (from === "user") return <div className="flex justify-end">{children}</div>;
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-burgundy text-white"
      >
        <MessageCircle className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * One message. Which side it sits on, and which colour it takes, is who said it.
 *
 * The reader's own words go in verbatim — they typed them, and running somebody's message through a
 * Markdown parser would silently eat an asterisk or a hash they meant literally. Only the
 * assistant's turn is parsed, because only the assistant is writing Markdown on purpose.
 */
function Bubble({ from, children }: { from: "user" | "assistant"; children: React.ReactNode }) {
  const mine = from === "user";
  return (
    <Row from={from}>
      <div
        className={`px-3.5 py-2 font-ui text-eyebrow leading-5 ${ mine
            ? "max-w-[85%] rounded-2xl rounded-br-md bg-burgundy text-white"
            : "rounded-2xl rounded-bl-md bg-beige-kem/10 text-beige-kem"
        }`}
      >
        {mine || typeof children !== "string" ? (
          children
        ) : (
          /*
            The fallback is the raw text, which is what used to render anyway — so a slow chunk
            costs the formatting for a moment, never the answer.
          */
          <Suspense fallback={<span className="whitespace-pre-line">{children}</span>}>
            <ReactMarkdown components={BUBBLE_MARKDOWN}>{children}</ReactMarkdown>
          </Suspense>
        )}
      </div>
    </Row>
  );
}
