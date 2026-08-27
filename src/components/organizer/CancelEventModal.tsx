import React, { useId, useRef, useState } from "react";
import { useDialogFocus } from "../../hooks/useDialogFocus";

interface CancelEventModalProps {
  eventTitle: string;
  soldTicketsCount?: number;
  totalRefundAmountVnd?: number;
  onConfirmCancel?: (reason: string) => void | Promise<void>;
  onConfirm?: (reason: string) => void | Promise<void>;
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
  const submitting = useRef(false);
  const id = useId();
  const dialogRef = useDialogFocus(onClose, isSubmitting);

  const formatVND = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!reason || reason.trim().length < 5) {
      setError("Vui lòng nhập lý do hủy chi tiết (tối thiểu 5 ký tự).");
      return;
    }
    if (reason.trim().length > 500) {
      setError("Lý do hủy tối đa 500 ký tự.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    submitting.current = true;
    try {
      const callback = onConfirmCancel || onConfirm;
      if (!callback) throw new Error("Không thể gửi yêu cầu hủy. Vui lòng thử lại.");
      await callback(reason.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chưa hủy được sự kiện. Vui lòng thử lại.");
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-busy={isSubmitting}
        tabIndex={-1}
        className="max-h-[90dvh] w-full max-w-lg space-y-6 overflow-y-auto border border-beige-kem/25 bg-surface-2 p-6"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-beige-kem/25 pb-3">
          <h2 id={`${id}-title`} className="font-display text-title-s font-black text-burgundy-ink">
            Xác Nhận Hủy Sự Kiện
          </h2>
          <button
            type="button"
            aria-label="Đóng xác nhận hủy sự kiện"
            disabled={isSubmitting}
            onClick={onClose}
            className="min-h-11 min-w-11 text-lg text-ink-soft transition-colors hover:text-beige-kem disabled:opacity-50"
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
              <li>Mọi hoạt động bán vé và giữ chỗ sẽ ngừng ngay lập tức.</li>
              <li>
                Hệ thống tự động kích hoạt hoàn tiền 100% (tổng{" "}
                <strong>{formatVND(totalRefundAmountVnd)}</strong>) vào ví tích điểm store-credit
                cho <strong>{soldTicketsCount} người mua vé</strong>.
              </li>
              <li>Lý do hủy sẽ được ghi lại vĩnh viễn trong nhật ký kiểm toán.</li>
            </ul>
          </div>
        </div>

        {/* Mandatory Reason Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 text-xs">
          <div>
            <label htmlFor={`${id}-reason`} className="mb-1.5 block font-bold text-beige-kem">
              Lý do hủy sự kiện (Bắt buộc) *
            </label>
            <textarea
              id={`${id}-reason`}
              data-dialog-autofocus
              disabled={isSubmitting}
              maxLength={500}
              aria-invalid={!!error}
              aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
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
            <p id={`${id}-hint`} className="mt-1 text-ink-soft">
              5–500 ký tự · {reason.length}/500
            </p>
            {error && (
              <p
                id={`${id}-error`}
                role="alert"
                className="mt-1 font-meta text-meta font-bold text-burgundy-ink"
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="min-h-11 border border-beige-kem/40 px-4 py-2 font-bold text-beige-kem transition-colors hover:bg-bubblegum/20 disabled:opacity-50"
            >
              Quay Lại
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-11 bg-burgundy px-4 py-2 font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {isSubmitting ? "Đang xử lý hủy..." : "Xác Nhận Hủy Sự Kiện"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
