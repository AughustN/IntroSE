import { FormEvent, useEffect, useRef, useState } from "react";

const MAX_REASON = 2000;

interface ReportDialogProps {
  /** Whose words are being reported, for the line that says so. */
  authorName: string;
  onSubmit: (reason: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * "Why are you reporting this?", asked in the page.
 *
 * It was a `window.prompt`, which is the browser's dialog and not this site's: no styling, no
 * length limit, no way to say what happens next, and on some browsers a checkbox offering to
 * suppress every later one. This is the same shape as `ConfirmDialog` — modal, Escape and backdrop
 * cancel, focus taken on open — because it is the same kind of interruption.
 *
 * Cancel is the safe answer and therefore the default, as it is there. The difference is that this
 * one carries a field, so the send button stays disabled until there is a reason to send.
 */
export default function ReportDialog({ authorName, onSubmit, onCancel }: ReportDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được báo cáo.");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onCancel}
      role="presentation"
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border-2 border-beige-kem bg-xanh-pho p-6"
      >
        <h2 id="report-title" className="font-display text-title-m font-black text-beige-kem">
          Báo cáo bình luận
        </h2>
        <p className="mt-3 text-body leading-6 text-beige-kem/70">
          Bình luận của <span className="font-bold text-beige-kem">{authorName}</span> sẽ được gửi
          tới quản trị viên kèm lý do bên dưới.
        </p>

        <label className="mt-4 block">
          <span className="sr-only">Lý do báo cáo</span>
          <textarea
            ref={fieldRef}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
            rows={3}
            placeholder="Ví dụ: nội dung xúc phạm, spam, tiết lộ thông tin cá nhân…"
            className="w-full resize-y border border-beige-kem/30 bg-surface-2 p-3 font-meta text-body leading-6 text-beige-kem outline-none transition focus:border-burgundy placeholder:text-beige-kem/40"
          />
        </label>

        {error && <p className="mt-3 font-meta text-meta text-cam-dat">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border-2 border-beige-kem px-4 py-2.5 font-meta text-body text-beige-kem/80 transition hover:border-beige-kem/40 hover:text-beige-kem disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="submit"
            disabled={!reason.trim() || busy}
            className="rounded-xl bg-burgundy px-4 py-2.5 font-meta text-body font-bold text-beige-kem transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Đang gửi…" : "Gửi báo cáo"}
          </button>
        </div>
      </form>
    </div>
  );
}
