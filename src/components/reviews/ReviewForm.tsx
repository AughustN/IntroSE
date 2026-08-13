import { FormEvent, useState } from "react";
import type { Review } from "../../services/reviewsClient";
import StarRating from "./StarRating";

interface ReviewFormProps {
  /** The reader's existing review, when they have one. Its presence turns this into an edit. */
  existing: Review | null;
  onSubmit: (rating: number, body: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const MAX_BODY = 2000;

/**
 * The write side: five stars and a comment.
 *
 * One form for both writing and editing, because to the reader they are the same act — UC-18 A2
 * says a second attempt edits rather than duplicates, and showing a blank "write a comment" box to
 * somebody who already commented would promise a second one the server will never create.
 *
 * The stars are required and the text is not, which is the server's rule (`rating` 1–5, `body`
 * optional) and not this form's invention. It is stated on the control rather than discovered by
 * pressing a disabled button.
 */
export default function ReviewForm({ existing, onSubmit, onDelete }: ReviewFormProps) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Guarded here as well as by the disabled button, because a form still submits on Enter.
    if (!rating || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(rating, body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được bình luận.");
    } finally {
      setBusy(false);
    }
  };

  const remaining = MAX_BODY - body.length;

  return (
    <form onSubmit={submit} className="border-l-2 border-burgundy bg-surface-2 p-5 sm:p-6">
      <p className="font-display text-lede font-black uppercase tracking-[0.03em] text-beige-kem">
        {existing ? "Sửa bình luận của bạn" : "Viết bình luận"}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <StarRating value={rating} onChange={setRating} size={30} label="Số sao" />
        <span className="font-meta text-body text-ink-soft">
          {rating ? `${rating}/5 sao` : "Chọn số sao (bắt buộc)"}
        </span>
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Nội dung bình luận</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, MAX_BODY))}
          rows={4}
          placeholder="Bạn thấy sự kiện thế nào? (không bắt buộc)"
          className="w-full border border-beige-kem/30 bg-xanh-pho p-3 font-meta text-body leading-7 text-beige-kem outline-none transition focus:border-burgundy"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        {/* Only shown as it starts to matter — a counter on an empty box is noise. */}
        <span className="font-meta text-eyebrow text-ink-soft">
          {remaining < 200 ? `Còn ${remaining} ký tự` : ""}
        </span>

        <div className="flex items-center gap-4">
          {existing && onDelete && (
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={busy}
              className="font-meta text-meta text-ink-soft transition hover:text-burgundy-ink disabled:opacity-50"
            >
              Xoá bình luận
            </button>
          )}
          <button
            type="submit"
            disabled={!rating || busy}
            className="label-eyebrow h-10 bg-burgundy px-6 text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Đang gửi…" : existing ? "Cập nhật" : "Gửi bình luận"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 font-meta text-meta text-burgundy-ink">{error}</p>}
    </form>
  );
}
