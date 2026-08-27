import { AD_PLACEMENT_LABELS, type AdPurchase } from "@shared/ads/types.js";
import { formatVnd } from "../../services/currency";

export const adDateTime = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Export the current read model; do not present mutable names/dates as a signed contract. */
export function adTransactionText(purchase: AdPurchase): string {
  return [
    "TIXHUB — THÔNG TIN GIAO DỊCH QUẢNG CÁO",
    "Mã chiến dịch: #" + purchase.id,
    "Sự kiện: " + purchase.eventTitle + " (#" + purchase.eventId + ")",
    "Tên gói hiện tại: " + purchase.packageName,
    "Số tiền đã thanh toán: " + formatVnd(purchase.price),
    "Vị trí đã mua: " + purchase.placements.map((slot) => AD_PLACEMENT_LABELS[slot]).join("; "),
    "Ngày đặt: " + adDateTime(purchase.createdAt),
    "Bắt đầu: " + adDateTime(purchase.startsAt),
    "Kết thúc hiện tại: " + adDateTime(purchase.endsAt),
    "Múi giờ: Việt Nam (Asia/Ho_Chi_Minh)",
    "Trạng thái giao dịch: " + (purchase.status === "cancelled" ? "Đã huỷ" : "Đã thanh toán"),
    "Điều khoản: " +
      (purchase.policy === "fair_v1"
        ? "fair_v1 — luân phiên, trọng số ngang nhau"
        : "Điều khoản cũ — không tự chuyển đổi"),
    "Thời gian đã bù: " + (purchase.compensatedSeconds ?? 0) + " giây",
    "",
    "Bản tóm tắt dữ liệu tại thời điểm tải. Không thay thế hóa đơn hoặc hợp đồng có chữ ký.",
  ].join("\n");
}

export function downloadAdTransaction(purchase: AdPurchase) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", adTransactionText(purchase)], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tixhub-quang-cao-" + purchase.id + ".txt";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a chance to start reading the blob before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
