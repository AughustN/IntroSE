/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { formatVnd } from "../../../services/currency";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  ACTION_PRIMARY,
  EmptyState,
  FIELD,
  Notice,
  PANEL,
  Pill,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import Select from "../../Select";
import { useAsync } from "../useAsync";

const PAGE = 25;

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  paid: "good",
  partially_refunded: "warn",
  refunded: "warn",
  pending: "neutral",
  failed: "bad",
  cancelled: "bad",
};

const STATUS_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "paid", label: "Đã thanh toán" },
  { value: "partially_refunded", label: "Hoàn một phần" },
  { value: "refunded", label: "Đã hoàn" },
  { value: "pending", label: "Đang chờ" },
  { value: "failed", label: "Thất bại" },
  { value: "cancelled", label: "Đã huỷ" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  paid: "Đã thanh toán",
  partially_refunded: "Hoàn một phần",
  refunded: "Đã hoàn",
  pending: "Đang chờ",
  failed: "Thất bại",
  cancelled: "Đã huỷ",
};

/**
 * Every order on the platform, searchable.
 *
 * This exists for one message support keeps receiving: "tôi bị trừ tiền mà không thấy vé". Answering
 * it needed a database client until now — the console's order tab listed the *viewer's own* bookings
 * out of browser state, which is never the person writing in.
 *
 * Searchable by order code, e-mail and name, because those are the three things somebody can quote
 * from their own mailbox.
 */
export default function OrdersScreen() {
  const [draft, setDraft] = useState({ q: "", status: "" });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(0);
  const { data, error, loading } = useAsync(
    () =>
      adminClient.orders({
        q: applied.q || undefined,
        status: applied.status || undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    JSON.stringify({ applied, page }),
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  return (
    <>
      <ScreenHead
        title="Đơn hàng"
        meta={total ? `${total} đơn khớp bộ lọc` : "Toàn bộ đơn trên hệ thống"}
      />

      <form
        className={`${PANEL} flex flex-wrap items-end gap-3`}
        onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setApplied(draft);
        }}
      >
        <label className="min-w-[240px] flex-1 space-y-1">
          <span className="label-eyebrow block text-ink-soft">Mã đơn, email hoặc tên khách</span>
          <input
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            placeholder="TIX-2026-… hoặc an@example.com"
            className={`${FIELD} w-full`}
          />
        </label>
        {/*
          The site's own dropdown, not the browser's. A native `<select>` draws its list with the
          operating system, so on this page it opened as a grey Windows menu in the middle of a
          cream, small-caps console — the one control that did not belong to the product.
        */}
        <div className="w-56">
          <Select
            label="Trạng thái"
            value={draft.status}
            options={STATUS_OPTIONS}
            onChange={(value) => setDraft({ ...draft, status: value })}
            triggerClassName={`${FIELD} justify-between`}
          />
        </div>
        <button type="submit" className={ACTION_PRIMARY} disabled={loading}>
          {loading ? "Đang tìm…" : "Tìm"}
        </button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      {rows.length === 0 && !loading ? (
        <EmptyState text="Không có đơn nào khớp." />
      ) : (
        <>
          <TableScroll>
            <table className="w-full min-w-[860px] text-left text-body">
              <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                <tr>
                  <Th>Mã đơn</Th>
                  <Th>Khách</Th>
                  <Th>Sự kiện</Th>
                  <Th>Vé</Th>
                  <Th>Số tiền</Th>
                  <Th>Trạng thái</Th>
                  <Th>Đặt lúc</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id} className="border-b border-beige-kem/15">
                    <Td nowrap>
                      <span className="font-meta">{order.code}</span>
                    </Td>
                    <Td>
                      <span className="block text-beige-kem">{order.customerName}</span>
                      <span className="block font-meta text-meta text-ink-soft">
                        {order.customerEmail}
                      </span>
                    </Td>
                    <Td>
                      <span className="block">{order.eventTitle}</span>
                      <span className="block font-meta text-meta text-ink-soft">
                        {order.startsAt.slice(0, 16).replace("T", " ")}
                      </span>
                    </Td>
                    <Td nowrap>
                      <span className="tabular-nums">{order.tickets}</span>
                      {/* A voided ticket is the trace a refund leaves; hiding it makes a
                          partially-refunded order look like a miscounted one. */}
                      {order.voidTickets > 0 && (
                        <span className="ml-2 font-meta text-meta text-ink-soft">
                          +{order.voidTickets} đã huỷ
                        </span>
                      )}
                    </Td>
                    <Td nowrap>
                      <span className="tabular-nums">{formatVnd(order.total)}</span>
                    </Td>
                    <Td nowrap>
                      <Pill tone={STATUS_TONE[order.paymentStatus] ?? "neutral"}>
                        {STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus}
                      </Pill>
                    </Td>
                    <Td nowrap>{order.createdAt.slice(0, 10)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          <div className="flex items-center justify-between gap-4">
            <span className="font-meta text-body text-ink-soft">
              Trang {page + 1} / {lastPage + 1}
            </span>
            <div className="flex gap-2">
              <button
                className={ACTION_GHOST}
                disabled={page === 0 || loading}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                Trước
              </button>
              <button
                className={ACTION_GHOST}
                disabled={page >= lastPage || loading}
                onClick={() => setPage((value) => value + 1)}
              >
                Sau
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
