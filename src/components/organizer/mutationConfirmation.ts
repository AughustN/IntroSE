import { isMaterialEdit } from "@/shared/catalog/material-edit";
import type { ConfirmRequest } from "../ConfirmDialog";

export const REVIEW_WARNING =
  "Thay đổi này sẽ đưa sự kiện về chờ duyệt lại và tạm ẩn khỏi trang công khai cho đến khi quản trị viên duyệt lại. Vé đã bán và vé đang giữ không bị ảnh hưởng.";

/** The same exemption list as the server: changing capacity alone needs no review warning. */
export function mutationConfirmation(
  isLive: boolean,
  fields: readonly string[],
  destructive?: ConfirmRequest,
): ConfirmRequest | null {
  const review = isLive && isMaterialEdit(fields);
  if (destructive)
    return {
      ...destructive,
      message: destructive.message + (review ? `\n\n${REVIEW_WARNING}` : ""),
    };
  return review
    ? {
        title: "Lưu thay đổi và gửi duyệt lại?",
        message: REVIEW_WARNING,
        confirmLabel: "Lưu và gửi duyệt lại",
        cancelLabel: "Giữ nguyên",
        tone: "normal",
      }
    : null;
}
