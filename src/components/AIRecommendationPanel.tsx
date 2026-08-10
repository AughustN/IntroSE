import { FormEvent, useState } from "react";
import { aiClient, type RecommendedEvent } from "../services/aiClient";
import { formatVnd } from "../services/currency";

export default function AIRecommendationPanel({ signedIn }: { signedIn: boolean }) {
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<RecommendedEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!signedIn) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await aiClient.recommendations(message.trim());
      setResults(response.recommendations);
      setNotice(response.message ?? (response.source === "cache" ? "Đã dùng gợi ý gần nhất." : null));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể lấy gợi ý.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-y-2 border-beige-kem bg-surface-2 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <h2 className="font-display text-2xl font-bold text-beige-kem">Gợi ý sự kiện</h2>
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={600} placeholder="Ví dụ: nhạc cuối tuần dưới 500.000đ" className="h-11 min-w-0 flex-1 rounded-lg border-2 border-beige-kem bg-xanh-pho px-3 text-sm text-beige-kem outline-none focus:border-burgundy" />
          <button disabled={busy} className="rounded-lg bg-burgundy px-4 text-sm font-bold text-white disabled:opacity-60">{busy ? "Đang tìm" : "Hỏi AI"}</button>
        </form>
        {notice && <p className="mt-3 text-xs text-beige-kem/70">{notice}</p>}
        {results.length > 0 && <div className="mt-4 grid gap-3 md:grid-cols-3">
          {results.map(({ event, reason }) => <a key={event.id} href={`/events/${encodeURIComponent(event.slug)}`} className="border border-beige-kem/30 bg-xanh-pho p-4 transition hover:border-burgundy">
            <p className="font-display text-lg font-bold text-beige-kem">{event.title}</p>
            <p className="mt-1 text-xs text-beige-kem/65">{event.city ?? "Đang cập nhật"} · {event.startingPrice === null ? "Miễn phí/đang cập nhật" : `Từ ${formatVnd(event.startingPrice)}`}</p>
            <p className="mt-3 text-sm text-beige-kem/80">{reason}</p>
          </a>)}
        </div>}
      </div>
    </section>
  );
}
