import React from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import type { TransactionAuditRecord } from "../../../../shared/types/analytics";

interface Props {
  transactions: TransactionAuditRecord[];
}

function formatVND(val: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(val);
}

/** Compact "dd/MM HH:mm" — the year is one thing a list of this week's orders never needs. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RecentTransactionsTable({ transactions }: Props) {
  const count = transactions?.length ?? 0;

  return (
    <div className="border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem">
      <div className="flex items-center justify-between border-b border-beige-kem/20 pb-3">
        <h4 className="font-display text-base font-black text-beige-kem">Giao dịch gần đây</h4>
        <span className="font-meta text-meta text-ink-soft">{count} giao dịch</span>
      </div>

      {count === 0 ? (
        <div className="my-8 flex flex-col items-center justify-center text-center text-xs text-beige-kem/60">
          <p className="font-bold">
            Chưa có giao dịch mua vé hoặc hoàn tiền nào trong khoảng thời gian đã chọn
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="font-meta text-meta uppercase tracking-widest text-beige-kem/55">
                <th className="py-2 pr-3 font-bold">Mã đơn</th>
                <th className="py-2 pr-3 font-bold">Sự kiện</th>
                <th className="py-2 pr-3 font-bold">Hạng vé</th>
                <th className="py-2 pr-3 text-right font-bold">Số tiền</th>
                <th className="py-2 pr-3 text-right font-bold">Thời gian</th>
                <th className="py-2 text-right font-bold">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, i) => {
                const isRefunded = tx.payment_status === "REFUNDED";
                const isCanceled = tx.payment_status === "CANCELED";

                return (
                  <tr
                    key={`${tx.order_id}-${i}`}
                    className="border-t border-beige-kem/15 font-meta text-meta text-beige-kem/85 hover:bg-beige-kem/5 transition-colors"
                  >
                    <td className="py-2.5 pr-3 font-mono text-beige-kem">{tx.order_id}</td>
                    <td className="max-w-[200px] truncate py-2.5 pr-3">{tx.event_name}</td>
                    <td className="py-2.5 pr-3">{tx.tier_name}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {formatVND(tx.amount_vnd)}
                      {tx.refund_amount_vnd > 0 && (
                        <span className="block text-[10px] text-cam-dat font-medium">
                          (Hoàn {formatVND(tx.refund_amount_vnd)})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap">
                      {formatDate(tx.purchase_timestamp)}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {isRefunded ? (
                        <span className="inline-flex items-center gap-1 bg-cam-dat/20 px-2 py-0.5 font-bold text-cam-dat text-[10px]">
                          <RefreshCw className="h-3 w-3" /> Đã hoàn tiền
                        </span>
                      ) : isCanceled ? (
                        <span className="inline-flex items-center gap-1 bg-burgundy/20 px-2 py-0.5 font-bold text-burgundy text-[10px]">
                          <XCircle className="h-3 w-3" /> Đã hủy
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-la-co/20 px-2 py-0.5 font-bold text-la-co text-[10px]">
                          <CheckCircle2 className="h-3 w-3" /> Thành công
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
