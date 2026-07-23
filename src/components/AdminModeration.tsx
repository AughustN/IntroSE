/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { QueueItem, adminApi } from "../services/catalogClient";

const ghost = "rounded-xl border border-beige-kem/15 px-3 py-2 text-xs font-bold text-beige-kem/80 transition hover:border-cam-dat";

export default function AdminModeration({ onBack }: { onBack: () => void }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => {
    setErr(null);
    try {
      setQueue(await adminApi.queue());
    } catch (e) {
      setErr((e as Error).message === "forbidden" ? "Chỉ admin mới truy cập được." : (e as Error).message);
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setErr(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 text-beige-kem">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-black">Kiểm duyệt sự kiện</h1>
        <button onClick={onBack} className={ghost}>← Về trang chủ</button>
      </div>
      {notice && <div className="rounded-xl border border-la-co/20 bg-la-co/5 p-3 text-xs text-la-co">{notice}</div>}
      {err && <div className="rounded-xl border border-burgundy/40 bg-burgundy/10 p-3 text-xs">{err}</div>}

      <p className="font-mono text-xs text-beige-kem/60">Hàng chờ duyệt ({queue.length}) — duyệt để hiển thị công khai cho người mua.</p>

      <div className="space-y-3">
        {queue.length === 0 && !err && <p className="text-sm text-beige-kem/60">Không có sự kiện nào chờ duyệt.</p>}
        {queue.map((e) => (
          <div key={e.id} className="rounded-2xl border border-beige-kem/10 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-display text-lg font-bold">{e.title}</div>
                <div className="font-mono text-[11px] text-beige-kem/50">Tổ chức: {e.organizer} · {e.slug}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => act(() => adminApi.approve(e.id).then(() => {}), "Đã duyệt.")}
                  className="rounded-xl bg-la-co/20 px-4 py-2 text-sm font-black text-la-co transition hover:bg-la-co/30"
                >
                  Duyệt
                </button>
                <button
                  onClick={() => {
                    const reason = window.prompt("Lý do từ chối:");
                    if (reason) act(() => adminApi.reject(e.id, reason).then(() => {}), "Đã từ chối.");
                  }}
                  className="rounded-xl bg-burgundy/20 px-4 py-2 text-sm font-black text-beige-kem transition hover:bg-burgundy/30"
                >
                  Từ chối
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
