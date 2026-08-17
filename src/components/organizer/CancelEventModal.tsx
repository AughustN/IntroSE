import React, { useState } from "react";

interface CancelEventModalProps {
  eventTitle: string;
  soldTicketsCount?: number;
  totalRefundAmountVnd?: number;
  onConfirmCancel?: (reason: string) => void;
  onConfirm?: (reason: string) => void;
  onClose: () => void;
}

export const CancelEventModal: React.FC<CancelEventModalProps> = ({
  eventTitle,
  soldTicketsCount = 0,
  totalRefundAmountVnd = 0,
  onConfirmCancel,
  onConfirm,
  onClose,
}) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatVND = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || reason.trim().length < 5) {
      setError("Vui lòng nhập lý do hủy chi tiết (tối thiểu 5 ký tự).");
      return;
    }
    setError("");
    setIsSubmitting(true);
    const callback = onConfirmCancel || onConfirm;
    if (callback) callback(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6 border border-beige-kem/25 bg-surface-2 p-6">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-beige-kem/25 pb-3">
          <h2 className="flex items-center gap-2 font-display text-title-s font-black text-burgundy-ink">
            <span>⚠️</span> Xác Nhận Hủy Sự Kiện
          </h2>
          <button
            onClick={onClose}
            className="text-lg text-ink-soft transition-colors hover:text-beige-kem"
          >
            ✕
          </button>
        </div>

        {/* Warning Details */}
        <div className="space-y-3 text-xs">
          <p className="text-beige-kem">
            Bạn đang yêu cầu hủy sự kiện: <strong className="text-beige-kem">{eventTitle}</strong>.
          </p>

          <div className="space-y-2 border border-burgundy/40 bg-bubblegum/25 p-4 text-beige-kem">
            <p className="font-bold text-burgundy-ink">Hành động này không thể hoàn tác:</p>
            <ul className="list-inside list-disc space-y-1 font-meta text-meta text-beige-kem">
              <li>Mọi hoạt động bán vé và giữ chỗ sẽ ngừng lập tức (0ms latency).</li>
              <li>
                Hệ thống tự động kích hoạt hoàn tiền 100% (tổng{" "}
                <strong>{formatVND(totalRefundAmountVnd)}</strong>) vào ví tích điểm store-credit
                cho <strong>{soldTicketsCount} người mua vé</strong>.
              </li>
              <li>Lý do hủy sẽ được ghi lại trong nhật ký kiểm toán bất biến (Audit Log).</li>
            </ul>
          </div>
        </div>

        {/* Mandatory Reason Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="mb-1.5 block font-bold text-beige-kem">
              Lý do hủy sự kiện (Bắt buộc) *
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError("");
              }}
              placeholder="Nhập lý do cụ thể (vd: do thời tiết bão lũ, sự cố kỹ thuật từ địa điểm)..."
              required
              className="w-full border border-beige-kem/25 bg-xanh-pho p-3 text-beige-kem outline-none transition-colors placeholder:text-ink-soft/60 focus:border-burgundy"
            />
            {error && (
              <p className="mt-1 font-meta text-meta font-bold text-burgundy-ink">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-beige-kem/40 px-4 py-2 font-bold text-beige-kem transition-colors hover:bg-bubblegum/20"
            >
              Quay Lại
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-burgundy px-4 py-2 font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {isSubmitting ? "Đang xử lý hủy..." : "Xác Nhận Hủy Sự Kiện"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
