import { FormEvent, useState } from "react";
import type { Review } from "../../services/reviewsClient";
import StarRating from "./StarRating";

interface ReviewFormProps {
  /**
   * The comment being rewritten, when this is an edit opened from its own menu. Absent when the box
   * is writing something new.
   */
  existing?: Review | null;
  /**
   * Whether this box carries stars.
   *
   * True exactly once per person per event — on their first comment about it, or when they later
   * edit that comment. Every other box (a second comment, any reply) is prose, because the vote is
   * already cast and the server will drop stars sent from here anyway.
   */
  withStars?: boolean;
  /** Stars are null whenever `withStars` is false. */
  onSubmit: (rating: number | null, body: string) => Promise<void>;
  /** Leave without writing. Shown for an edit and for a reply box, which the reader opened. */
  onCancel?: () => void;
  placeholder?: string;
  submitLabel?: string;
  /** The reply box: one line to start with, and type that sits under a comment rather than beside it. */
  compact?: boolean;
}

const MAX_BODY = 2000;

/**
 * The write side: a box, sometimes five stars, and a send.
 *
 * One component for four jobs — first comment, later comment, reply, edit — because they are the
 * same two fields in every case and only the requirements differ. It clears itself after a
 * successful send unless it is an edit, so the composer at the foot of the wall is ready for the
 * next remark and the one just written is above it, in the list, where every comment lives.
 */
export default function ReviewForm({
  existing,
  withStars = false,
  onSubmit,
  onCancel,
  placeholder,
  submitLabel,
  compact = false,
}: ReviewFormProps) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stars stand alone; prose without them has to actually say something, or the row would be blank.
  const ready = withStars ? rating > 0 : body.trim().length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Guarded here as well as by the disabled button, because a form still submits on Enter.
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(withStars ? rating : null, body);
      // Empty again, ready for the next one. Only on success: a failed send must leave the reader
      // their text to try with, not an empty box and an error.
      if (!existing) {
        setRating(0);
        setBody("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được bình luận.");
    } finally {
      setBusy(false);
    }
  };

  const remaining = MAX_BODY - body.length;

  return (
    /*
     * One box, not a box inside a box.
     *
     * The textarea used to carry its own border inside a panel that had another, which drew two
     * rectangles a few pixels apart and made the composer the heaviest thing in a section built out
     * of hairlines. The panel is the field now: the textarea is transparent and borderless, and the
     * whole card lights up on `focus-within` — so the focus ring is the shape the reader is typing
     * into rather than a smaller shape floating in it.
     */
    <form
      onSubmit={submit}
      className={`border border-beige-kem/25 bg-surface-2 transition focus-within:border-burgundy ${
        compact ? "p-3" : "p-4"
      }`}
    >
      {withStars && (
        <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-beige-kem/15 pb-3">
          <StarRating value={rating} onChange={setRating} size={22} label="Số sao" />
          <span className="font-meta text-meta text-ink-soft">
            {rating ? `${rating}/5 sao` : "Chọn số sao (bắt buộc)"}
          </span>
        </div>
      )}

      <label className="block">
        <span className="sr-only">Nội dung bình luận</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, MAX_BODY))}
          rows={compact ? 1 : 2}
          placeholder={placeholder ?? "Bạn thấy sự kiện thế nào?"}
          className="w-full resize-y bg-transparent p-0 font-meta text-body leading-6 text-beige-kem outline-none placeholder:text-ink-soft/70"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {/* Only shown as it starts to matter — a counter on an empty box is noise. */}
        <span className="font-meta text-eyebrow text-ink-soft">
          {remaining < 200 ? `Còn ${remaining} ký tự` : ""}
        </span>

        <div className="ml-auto flex items-center gap-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="font-meta text-meta text-ink-soft transition hover:text-beige-kem disabled:opacity-50"
            >
              Huỷ
            </button>
          )}
          <button
            type="submit"
            disabled={!ready || busy}
            className={`label-eyebrow bg-burgundy text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${
              compact ? "h-8 px-4" : "h-9 px-5"
            }`}
          >
            {busy ? "Đang gửi…" : (submitLabel ?? (existing ? "Cập nhật" : "Gửi bình luận"))}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 font-meta text-meta text-burgundy-ink">{error}</p>}
    </form>
  );
}
