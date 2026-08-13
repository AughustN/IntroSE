import React from "react";
import { TicketTier } from "../../types";

interface TicketTierBreakdownProps {
  ticketTiers: TicketTier[];
  onDeleteOrArchive: (tierId: string) => void;
  onEditTier: (tier: TicketTier) => void;
  onAddTier: () => void;
  isReadonly?: boolean;
}

export const TicketTierBreakdown: React.FC<TicketTierBreakdownProps> = ({
  ticketTiers,
  onDeleteOrArchive,
  onEditTier,
  onAddTier,
  isReadonly = false
}) => {
  const formatVND = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Danh Sách Hạng Vé & Sức Chứa</h2>
          <p className="text-xs text-zinc-400">
            Quản lý từng hạng vé, giá bán (VND) và theo dõi số lượng vé bán ra.
          </p>
        </div>

        {!isReadonly && (
          <button
            onClick={onAddTier}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 transition-colors"
          >
            + Thêm Hạng Vé
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-950 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
            <tr>
              <th className="py-3 px-4">Tên Hạng Vé</th>
              <th className="py-3 px-4">Giá Vé (VND)</th>
              <th className="py-3 px-4">Tổng Sức Chứa</th>
              <th className="py-3 px-4">Đã Bán</th>
              <th className="py-3 px-4">Còn Lại</th>
              <th className="py-3 px-4">Trạng Thái</th>
              {!isReadonly && <th className="py-3 px-4 text-right">Thao Tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
            {ticketTiers.map((tier) => {
              const cap = tier.capacity || 0;
              const sold = tier.soldCount || 0;
              const remaining = Math.max(0, cap - sold);
              const isArchived = tier.isArchived;

              return (
                <tr key={tier.id} className={isArchived ? "bg-zinc-950/40 text-zinc-500" : "hover:bg-zinc-800/30"}>
                  <td className="py-3 px-4 font-medium text-white">
                    {tier.label}
                    {tier.description && (
                      <span className="block text-[10px] text-zinc-400 font-normal">{tier.description}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-semibold text-emerald-400">{formatVND(tier.price)}</td>
                  <td className="py-3 px-4 font-medium">{cap}</td>
                  <td className="py-3 px-4 font-semibold text-amber-400">{sold}</td>
                  <td className="py-3 px-4">{remaining}</td>
                  <td className="py-3 px-4">
                    {isArchived ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700">
                        📁 Đã Lưu Trữ (Archived)
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        ● Hoạt động
                      </span>
                    )}
                  </td>
                  {!isReadonly && (
                    <td className="py-3 px-4 text-right space-x-2">
                      {!isArchived && (
                        <>
                          <button
                            onClick={() => onEditTier(tier)}
                            className="text-xs text-zinc-400 hover:text-white transition-colors"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => onDeleteOrArchive(tier.id)}
                            className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                            title={
                              sold > 0
                                ? "Hạng vé đã bán vé nên sẽ được lưu trữ (Archive) thay vì xóa."
                                : "Xóa hạng vé này."
                            }
                          >
                            {sold > 0 ? "Archive" : "Xóa"}
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
