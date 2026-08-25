import { ToastStack } from 'tixhub';

const noop = () => {};

// ToastStack renders nothing for an empty array — which is why the unauthored
// card came up blank. These are the four kinds it knows.
export const AllKinds = () => (
  <ToastStack
    toasts={[
      { id: 1, kind: 'success', text: 'Đã lưu sơ đồ chỗ ngồi.' },
      { id: 2, kind: 'info', text: 'Sự kiện đang chờ duyệt.' },
      { id: 3, kind: 'warning', text: 'Còn 12 ghế trong hạn mức của sơ đồ.' },
      { id: 4, kind: 'error', text: 'Không thể huỷ: đã có 412 vé được bán.' },
    ]}
    onDismiss={noop}
  />
);

export const SingleToast = () => (
  <ToastStack toasts={[{ id: 1, kind: 'success', text: 'Đã gửi duyệt sự kiện.' }]} onDismiss={noop} />
);
