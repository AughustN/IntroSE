import React from "react";
import { Activity, Clock, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function RecentTransactionsTable({ transactions }: Props) {
  const count = transactions?.length ?? 0;

  return (
    <div className="border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem">
      {/* Card Header */}
      <div className="mb-4 flex items-center justify-between border-b border-beige-kem/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-la-co/20 p-2 text-la-co">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-black text-beige-kem">Hoạt động gần đây</h4>
            <p className="text-xs text-beige-kem/60">
              Nhật ký đơn hàng & trạng thái thanh toán / hoàn tiền trong kỳ
            </p>
          </div>
        </div>
        <span className="bg-beige-kem/10 px-2.5 py-1 text-xs font-bold text-beige-kem/80">
          {count} giao dịch
        </span>
      </div>

      {/* Table Container with fixed max-height, sticky header, and vertical scrollbar */}
      {count === 0 ? (
        <div className="my-8 flex flex-col items-center justify-center text-center text-xs text-beige-kem/60">
          <Clock className="h-8 w-8 mb-2 text-beige-kem/30" />
          <p className="font-bold">
            Chưa có giao dịch mua vé hoặc hoàn tiền nào trong khoảng thời gian đã chọn
          </p>
        </div>
      ) : (
        <div className="max-h-[380px] overflow-y-auto overflow-x-auto border border-beige-kem/10 custom-scrollbar">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr className="border-b border-beige-kem/20 text-beige-kem/60 text-[11px] bg-surface-2">
                <th className="py-2.5 px-3 font-bold uppercase tracking-wider bg-surface-2">
                  Mã đơn / Vé
                </th>
                <th className="py-2.5 px-3 font-bold uppercase tracking-wider bg-surface-2">
                  Sự kiện
                </th>
                <th className="py-2.5 px-3 font-bold uppercase tracking-wider bg-surface-2">
                  Hạng vé
                </th>
                <th className="py-2.5 px-3 font-bold uppercase tracking-wider bg-surface-2">
                  Số tiền (VND)
                </th>
                <th className="py-2.5 px-3 font-bold uppercase tracking-wider bg-surface-2">
                  Thời gian
                </th>
                <th className="py-2.5 px-3 font-bold uppercase tracking-wider bg-surface-2">
                  Trạng thái
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-beige-kem/10">
              {transactions.map((tx, i) => {
                const isRefunded = tx.payment_status === "REFUNDED";
                const isCanceled = tx.payment_status === "CANCELED";

                return (
                  <tr
                    key={`${tx.order_id}-${i}`}
                    className="hover:bg-beige-kem/5 transition-colors"
                  >
                    <td className="py-3 px-3 font-mono font-bold text-beige-kem">
                      <span className="bg-beige-kem/10 px-1.5 py-0.5">{tx.order_id}</span>
                    </td>
                    <td className="py-3 px-3 font-semibold text-beige-kem max-w-[180px] truncate">
                      {tx.event_name}
                    </td>
                    <td className="py-3 px-3 text-beige-kem/80 font-medium">
                      <span className="bg-burgundy/15 px-2 py-0.5 font-bold text-burgundy">
                        {tx.tier_name}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-bold text-beige-kem">
                      {formatVND(tx.amount_vnd)}
                      {tx.refund_amount_vnd > 0 && (
                        <span className="block text-[10px] text-cam-dat font-medium">
                          (Hoàn {formatVND(tx.refund_amount_vnd)})
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-beige-kem/70 font-medium whitespace-nowrap">
                      {formatDate(tx.purchase_timestamp)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      {isRefunded ? (
                        <span className="inline-flex items-center gap-1 bg-cam-dat/20 px-2.5 py-0.5 font-bold text-cam-dat text-[11px]">
                          <RefreshCw className="h-3 w-3" /> Đã hoàn tiền
                        </span>
                      ) : isCanceled ? (
                        <span className="inline-flex items-center gap-1 bg-burgundy/20 px-2.5 py-0.5 font-bold text-burgundy text-[11px]">
                          <XCircle className="h-3 w-3" /> Đã hủy
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-la-co/20 px-2.5 py-0.5 font-bold text-la-co text-[11px]">
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
