/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { QueueItem, adminApi } from "../services/catalogClient";

const ghost = "rounded-xl border-2 border-beige-kem px-3 py-2 text-xs font-bold text-beige-kem/80 transition";

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
        <h1 className="font-display text-4xl font-black">Kiểm duyệt sự kiện</h1>
        <button onClick={onBack} className={ghost}>← Về trang chủ</button>
      </div>
      {notice && <div className="rounded-xl border-2 border-beige-kem bg-la-co p-3 text-xs text-on-tint">{notice}</div>}
      {err && <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-xs">{err}</div>}

      <p className="font-mono text-xs text-beige-kem/60">Hàng chờ duyệt ({queue.length}) — duyệt để hiển thị công khai cho người mua.</p>

      <div className="space-y-3">
        {queue.length === 0 && !err && <p className="text-sm text-beige-kem/60">Không có sự kiện nào chờ duyệt.</p>}
        {queue.map((e) => (
          <div key={e.id} className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-display text-xl font-bold">{e.title}</div>
                <div className="font-mono text-[11px] text-beige-kem/50">Tổ chức: {e.organizer} · {e.slug}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => act(() => adminApi.approve(e.id).then(() => {}), "Đã duyệt.")}
                  className="rounded-xl bg-la-co px-4 py-2 text-sm font-black text-on-tint transition hover:brightness-95"
                >
                  Duyệt
                </button>
                <button
                  onClick={() => {
                    const reason = window.prompt("Lý do từ chối:");
                    if (reason) act(() => adminApi.reject(e.id, reason).then(() => {}), "Đã từ chối.");
                  }}
                  className="rounded-xl bg-bubblegum px-4 py-2 text-sm font-black text-on-tint transition hover:brightness-95"
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
