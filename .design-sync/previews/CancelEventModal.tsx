import { CancelEventModal } from 'tixhub';

const noop = () => {};

// A cancellation with money already taken: the modal has to state the refund
// exposure before the organizer can confirm.
export const WithSoldTickets = () => (
  <CancelEventModal
    eventTitle="Đêm nhạc Trịnh Công Sơn — Hà Nội"
    soldTicketsCount={412}
    totalRefundAmountVnd={286400000}
    onConfirmCancel={noop}
    onClose={noop}
  />
);

// Nothing sold yet — the same flow without the refund warning.
export const NoTicketsSold = () => (
  <CancelEventModal
    eventTitle="Workshop Nhiếp ảnh Đường phố"
    soldTicketsCount={0}
    totalRefundAmountVnd={0}
    onConfirmCancel={noop}
    onClose={noop}
  />
);
