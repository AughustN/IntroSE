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
  isReadonly = false,
}) => {
  const formatVND = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  return (
    <div className="space-y-4 border border-beige-kem/25 bg-surface-2 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-title-s font-black text-beige-kem">
            Danh Sách Hạng Vé & Sức Chứa
          </h2>
          <p className="font-meta text-meta text-ink-soft">
            Quản lý từng hạng vé, giá bán (VND) và theo dõi số lượng vé bán ra.
          </p>
        </div>

        {!isReadonly && (
          <button
            onClick={onAddTier}
            className="border border-beige-kem/40 px-3 py-1.5 font-meta text-meta font-bold text-beige-kem transition-colors hover:bg-bubblegum/20"
          >
            + Thêm Hạng Vé
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-beige-kem/25 bg-xanh-pho font-meta text-meta uppercase tracking-wider text-ink-soft">
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
          <tbody className="divide-y divide-beige-kem/15 text-beige-kem">
            {ticketTiers.map((tier) => {
              const cap = tier.capacity || 0;
              const sold = tier.soldCount || 0;
              const remaining = Math.max(0, cap - sold);
              const isArchived = tier.isArchived;

              return (
                <tr
                  key={tier.id}
                  className={isArchived ? "bg-beige-kem/5 text-ink-soft" : "hover:bg-bubblegum/15"}
                >
                  <td className="px-4 py-3 font-bold text-beige-kem">
                    {tier.label}
                    {tier.description && (
                      <span className="block font-meta text-meta font-normal text-ink-soft">
                        {tier.description}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold tabular-nums text-beige-kem">
                    {formatVND(tier.price)}
                  </td>
                  <td className="py-3 px-4 font-medium">{cap}</td>
                  <td className="px-4 py-3 font-bold tabular-nums text-burgundy-ink">{sold}</td>
                  <td className="py-3 px-4">{remaining}</td>
                  <td className="py-3 px-4">
                    {isArchived ? (
                      <span className="inline-flex items-center border border-beige-kem/30 px-2 py-0.5 font-meta text-meta text-ink-soft">
                        Đã Lưu Trữ
                      </span>
                    ) : (
                      <span className="inline-flex items-center border border-la-co bg-la-co/25 px-2 py-0.5 font-meta text-meta text-beige-kem">
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
                            className="font-meta text-meta text-ink-soft transition-colors hover:text-beige-kem"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => onDeleteOrArchive(tier.id)}
                            className="font-meta text-meta text-burgundy-ink transition-colors hover:brightness-110"
                            title={
                              sold > 0
                                ? "Hạng vé đã bán vé nên sẽ được lưu trữ (Archive) thay vì xóa."
                                : "Xóa hạng vé này."
                            }
                          >
                            {sold > 0 ? "Lưu trữ" : "Xóa"}
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
