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
  onClose
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
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 space-y-6 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 className="text-lg font-bold text-rose-400 flex items-center gap-2">
            <span>⚠️</span> Xác Nhận Hủy Sự Kiện
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        {/* Warning Details */}
        <div className="space-y-3 text-xs">
          <p className="text-zinc-300">
            Bạn đang yêu cầu hủy sự kiện: <strong className="text-white">{eventTitle}</strong>.
          </p>

          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 space-y-2 text-rose-300">
            <p className="font-semibold text-rose-200">Hành động này không thể hoàn tác:</p>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-rose-300/90">
              <li>Mọi hoạt động bán vé và giữ chỗ sẽ ngừng lập tức (0ms latency).</li>
              <li>
                Hệ thống tự động kích hoạt hoàn tiền 100% (tổng <strong>{formatVND(totalRefundAmountVnd)}</strong>) vào ví tích điểm store-credit cho <strong>{soldTicketsCount} người mua vé</strong>.
              </li>
              <li>Lý do hủy sẽ được ghi lại trong nhật ký kiểm toán bất biến (Audit Log).</li>
            </ul>
          </div>
        </div>

        {/* Mandatory Reason Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5">
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
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-rose-500/60 rounded-xl p-3 text-white outline-none"
            />
            {error && <p className="text-rose-400 mt-1 text-[11px] font-medium">{error}</p>}
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold transition-colors"
            >
              Quay Lại
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors shadow-lg shadow-rose-600/20 disabled:opacity-50"
            >
              {isSubmitting ? "Đang xử lý hủy..." : "Xác Nhận Hủy Sự Kiện"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
