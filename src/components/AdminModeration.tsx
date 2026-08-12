/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { QueueItem, adminApi } from "../services/catalogClient";
import Section, { SectionHead } from "./Section";

/*
 * Same four controls the console next door uses, for the same reason: this screen and `/admin` are
 * one job split across two routes, and they were drawn with two different vocabularies — 2px borders
 * and rounded-2xl here, hairlines and squares there.
 */
const ACTION_PRIMARY =
  "label-eyebrow inline-flex h-9 items-center bg-burgundy px-4 text-white transition hover:brightness-110";
const ACTION_GHOST =
  "label-eyebrow inline-flex h-9 items-center gap-2 border border-beige-kem/40 px-3 text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20";

export default function AdminModeration({ onBack }: { onBack: () => void }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => {
    setErr(null);
    try {
      setQueue(await adminApi.queue());
    } catch (e) {
      setErr(
        (e as Error).message === "forbidden"
          ? "Chỉ admin mới truy cập được."
          : (e as Error).message,
      );
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
    /*
      The spacing goes on a wrapper inside, not on `Section`: its `className` lands on the outer
      band element, whose only child is the measure — `space-y-*` there would have nothing to space.
    */
    <Section divided={false}>
      <div className="space-y-6 text-beige-kem">
        <div className="space-y-5">
          <button onClick={onBack} className={ACTION_GHOST}>
            <span aria-hidden="true">&lt;</span>
            Về trang chủ
          </button>
          <SectionHead
            variant="bar"
            eyebrow="Kiểm duyệt"
            title="Hàng chờ duyệt sự kiện"
            meta={`${queue.length} sự kiện`}
          />
        </div>

        {/* Both notices are a stroke and a wash, never a filled block — the same shape the console uses. */}
        {notice && (
          <div className="border-l-2 border-la-co bg-la-co/10 px-4 py-3 font-meta text-body">
            {notice}
          </div>
        )}
        {err && (
          <div className="border-l-2 border-burgundy bg-bubblegum/25 px-4 py-3 font-meta text-body">
            {err}
          </div>
        )}

        <p className="font-meta text-body text-ink-soft">
          Duyệt để hiển thị công khai cho người mua.
        </p>

        <div className="border-t border-beige-kem/25">
          {queue.length === 0 && !err && (
            <div className="hud-dashed mt-6 p-12 text-center font-meta text-body text-ink-soft">
              Không có sự kiện nào chờ duyệt.
            </div>
          )}
          {queue.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-beige-kem/25 py-4"
            >
              <div className="min-w-0">
                <div className="font-display text-title-s font-black uppercase leading-tight">
                  {e.title}
                </div>
                <div className="mt-1 font-meta text-meta text-ink-soft">
                  Tổ chức: {e.organizer} · {e.slug}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {/* One filled action per row — approving is the outcome this queue exists to produce. */}
                <button
                  onClick={() => act(() => adminApi.approve(e.id).then(() => {}), "Đã duyệt.")}
                  className={ACTION_PRIMARY}
                >
                  Duyệt
                </button>
                <button
                  onClick={() => {
                    const reason = window.prompt("Lý do từ chối:");
                    if (reason)
                      act(() => adminApi.reject(e.id, reason).then(() => {}), "Đã từ chối.");
                  }}
                  className={ACTION_GHOST}
                >
                  Từ chối
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
