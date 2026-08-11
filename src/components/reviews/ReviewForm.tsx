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
 * The write side: five stars and an optional sentence.
 *
 * One form for both writing and editing, because to the reader they are the same act — UC-18 A2
 * says a second attempt edits rather than duplicates, and showing a blank "write a review" box to
 * somebody who already reviewed would promise a second one the server will never create.
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
      setError(e instanceof Error ? e.message : "Không gửi được đánh giá.");
    } finally {
      setBusy(false);
    }
  };

  const remaining = MAX_BODY - body.length;

  return (
    <form onSubmit={submit} className="border border-beige-kem/25 bg-surface-2 p-5">
      <p className="label-eyebrow text-ink-soft">
        {existing ? "Sửa đánh giá của bạn" : "Đánh giá sự kiện này"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <StarRating value={rating} onChange={setRating} size={26} label="Số sao" />
        <span className="font-meta text-meta text-ink-soft">
          {rating ? `${rating}/5` : "Chọn số sao để gửi"}
        </span>
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Nhận xét</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, MAX_BODY))}
          rows={4}
          placeholder="Bạn thấy sự kiện thế nào? (không bắt buộc)"
          className="w-full border border-beige-kem/30 bg-xanh-pho p-3 font-meta text-body text-beige-kem outline-none transition focus:border-burgundy"
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
              Xoá đánh giá
            </button>
          )}
          <button
            type="submit"
            disabled={!rating || busy}
            className="label-eyebrow bg-burgundy px-5 py-2 text-white transition hover:bg-burgundy-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Đang gửi…" : existing ? "Cập nhật" : "Gửi đánh giá"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 font-meta text-meta text-burgundy-ink">{error}</p>}
    </form>
  );
}
