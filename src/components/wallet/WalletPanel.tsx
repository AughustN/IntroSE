/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import {
  walletClient,
  WalletError,
  type WalletEntry,
  type WalletLimits,
  type WalletStatement,
} from "../../services/walletClient";
import TopUpSheet from "./TopUpSheet";
import { formatVnd } from "../../services/currency";

const KIND_LABEL: Record<WalletEntry["kind"], string> = {
  topup: "Nạp tiền",
  purchase: "Mua vé",
  refund: "Hoàn vé",
};

const formatMoment = (iso: string): string =>
  new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Saigon" });

/**
 * The wallet screen (UC-41): the balance, and the statement that explains why it is that number.
 *
 * Pending top-ups sit above the ledger rather than inside it. They are not ledger rows — nothing has
 * moved — and mixing them in would make the listed entries stop summing to the balance, which is the
 * one thing this screen exists to demonstrate.
 */
export default function WalletPanel({ onBack }: { onBack: () => void }) {
  const [statement, setStatement] = useState<WalletStatement | null>(null);
  const [limits, setLimits] = useState<WalletLimits | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summary, page] = await Promise.all([
        walletClient.summary(),
        walletClient.statement({ limit: 20 }),
      ]);
      setLimits(summary.limits);
      setStatement(page);
    } catch (e) {
      setError(e instanceof WalletError ? e.message : "Không tải được ví.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!statement || statement.entries.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const oldest = statement.entries[statement.entries.length - 1].id;
      const next = await walletClient.statement({ limit: 20, before: oldest });
      setStatement({
        ...next,
        entries: [...statement.entries, ...next.entries],
      });
    } catch (e) {
      setError(e instanceof WalletError ? e.message : "Không tải thêm được lịch sử.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between border-b border-beige-kem/25 pb-4">
        <button
          onClick={onBack}
          className="font-meta text-body text-ink-soft transition hover:text-beige-kem"
        >
          Quay lại
        </button>
        <h2 className="font-display text-title-m font-black text-beige-kem">Ví TixHub</h2>
      </div>

      {loading && <p className="font-meta text-body text-ink-soft">Đang tải ví...</p>}

      {error && !loading && (
        <div className="space-y-3 border-2 border-beige-kem bg-bubblegum p-5 text-on-tint">
          <p className="text-body">{error}</p>
          <button
            onClick={() => void load()}
            className="border-2 border-beige-kem px-4 py-2 text-eyebrow font-bold uppercase"
          >
            Thử lại
          </button>
        </div>
      )}

      {statement && limits && !loading && (
        <>
          <section className="space-y-4 border-2 border-beige-kem bg-xanh-pho p-6 sm:p-8">
            <p className="font-meta text-eyebrow uppercase text-ink-soft">Số dư khả dụng</p>
            <p className="font-display text-title-l font-black text-burgundy-ink">
              {formatVnd(statement.balanceAmount)}
            </p>
            <p className="font-meta text-meta leading-5 text-beige-kem/70">
              Mỗi lần nạp {formatVnd(limits.min)} – {formatVnd(limits.max)} · số dư tối đa{" "}
              {formatVnd(limits.balanceCap)}. Tiền vào ví bằng cách nạp qua VNPay, ra khỏi ví dưới
              dạng vé. Hoàn vé trả tiền về lại ví, không rút ra tiền mặt.
            </p>
            {!showTopUp && (
              <button
                onClick={() => setShowTopUp(true)}
                className="bg-burgundy px-6 py-3 text-body font-black text-white transition hover:brightness-95"
              >
                Nạp tiền
              </button>
            )}
          </section>

          {showTopUp && (
            <TopUpSheet
              balance={statement.balanceAmount}
              limits={limits}
              onCancel={() => setShowTopUp(false)}
            />
          )}

          {statement.pending.length > 0 && (
            <section className="space-y-3 border-2 border-beige-kem bg-cam-dat p-5 text-on-tint">
              <h3 className="font-display text-title-s font-black">Đang chờ xác nhận</h3>
              <p className="font-meta text-meta leading-5">
                VNPay chưa báo về. Tiền chưa vào ví và cũng chưa mất — hệ thống tự đối soát lại sau
                ít phút.
              </p>
              <ul className="space-y-2">
                {statement.pending.map((row) => (
                  <li key={row.id} className="flex justify-between gap-4 font-meta text-eyebrow">
                    <span>{formatMoment(row.createdAt)}</span>
                    <b>{formatVnd(row.amount)}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-4">
            <h3 className="font-display text-title-m font-black text-beige-kem">
              Lịch sử giao dịch
            </h3>

            {statement.entries.length === 0 ? (
              <div className="border-2 border-dashed border-beige-kem/50 p-8 text-center">
                <p className="font-display text-title-s font-black text-beige-kem">
                  Ví chưa có giao dịch
                </p>
                <p className="mx-auto mt-2 max-w-md font-meta text-eyebrow leading-5 text-ink-soft">
                  Nạp tiền qua VNPay để có số dư, rồi mua vé — mỗi lần nạp, mua hay hoàn vé đều hiện
                  ở đây kèm số dư sau giao dịch.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border-2 border-beige-kem">
                <table className="w-full min-w-[34rem] border-collapse text-left">
                  <thead className="bg-surface-2 font-meta text-meta uppercase text-ink-soft">
                    <tr>
                      <th className="px-4 py-3">Thời điểm</th>
                      <th className="px-4 py-3">Loại</th>
                      <th className="px-4 py-3 text-right">Số tiền</th>
                      <th className="px-4 py-3 text-right">Số dư sau</th>
                    </tr>
                  </thead>
                  <tbody className="font-meta text-eyebrow text-beige-kem/85">
                    {statement.entries.map((entry) => (
                      <tr key={entry.id} className="border-t border-beige-kem/20">
                        <td className="px-4 py-3 whitespace-nowrap">
                          {formatMoment(entry.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          {KIND_LABEL[entry.kind]}
                          {entry.eventTitle && (
                            <span className="block text-meta text-ink-soft">
                              {entry.eventTitle}
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-bold whitespace-nowrap ${ entry.amount < 0 ? "text-ink-soft" : "text-cam-dat"
                          }`}
                        >
                          {entry.amount > 0 ? "+" : "−"}
                          {formatVnd(Math.abs(entry.amount))}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {formatVnd(entry.balanceAfter)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {statement.hasMore && (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="border-2 border-beige-kem px-5 py-2.5 font-meta text-eyebrow font-bold text-beige-kem transition hover:bg-surface-2 disabled:opacity-50"
              >
                {loadingMore ? "Đang tải..." : "Xem thêm"}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
