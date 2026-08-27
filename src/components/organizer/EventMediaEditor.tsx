import { useState } from "react";
import { studioApi, type MyEvent } from "../../services/catalogClient";

/** Recoverable uploads on an existing draft; a failed upload never requires another event. */
export default function EventMediaEditor({
  event,
  onSaved,
}: {
  event: MyEvent;
  onSaved: () => void;
}) {
  const [banner, setBanner] = useState<File | null>(null);
  const [trailer, setTrailer] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const mutate = async (remove = false) => {
    if (busy) return;
    if (
      event.status === "on_sale" &&
      event.moderation === "approved" &&
      !window.confirm("Thay đổi ảnh/video sẽ tạm ẩn sự kiện và đưa về chờ duyệt lại. Tiếp tục?")
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (remove) await studioApi.removeTrailer(event.id);
      else {
        if (banner) {
          await studioApi.uploadBanner(event.id, banner);
          setBanner(null);
        }
        if (trailer) {
          await studioApi.uploadTrailer(event.id, trailer);
          setTrailer(null);
        }
      }
      setRevision((n) => n + 1);
      setMessage(
        "Đã lưu ảnh/video. Thay đổi trên sự kiện đã duyệt cần được quản trị viên duyệt lại.",
      );
    } catch (e) {
      setError(
        `Chưa hoàn tất tải tệp: ${(e as Error).message}. Tệp đã tải thành công vẫn được giữ; có thể thử lại tệp còn thiếu.`,
      );
    } finally {
      onSaved();
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 border border-beige-kem/25 bg-surface-2 p-5">
      <h3 className="font-display text-xl">Hình ảnh & video sự kiện</h3>
      <p className="text-xs text-ink-soft">
        Lưu tệp trực tiếp vào sự kiện này. Ảnh tối đa 5MB; video MP4/WebM tối đa 50MB.
      </p>
      <label className="block space-y-1 text-sm">
        <span>Ảnh sự kiện{event.imageUrl ? " — đã có ảnh" : " — chưa tải ảnh"}</span>
        <input
          key={`banner-${revision}`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          disabled={busy}
          onChange={(e) => setBanner(e.target.files?.[0] ?? null)}
          className="block w-full border border-beige-kem/30 p-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Video giới thiệu (tùy chọn){event.trailerUrl ? " — đã có video" : ""}</span>
        <input
          key={`trailer-${revision}`}
          type="file"
          accept="video/mp4,video/webm"
          disabled={busy}
          onChange={(e) => setTrailer(e.target.files?.[0] ?? null)}
          className="block w-full border border-beige-kem/30 p-2"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-burgundy-ink">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-ink-soft">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || (!banner && !trailer)}
          onClick={() => void mutate()}
          className="min-h-10 bg-burgundy px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Đang lưu…" : "Lưu ảnh/video"}
        </button>
        {event.trailerUrl && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void mutate(true)}
            className="min-h-10 border border-burgundy px-4 text-sm font-bold text-burgundy-ink disabled:opacity-50"
          >
            Xóa video
          </button>
        )}
      </div>
    </section>
  );
}
