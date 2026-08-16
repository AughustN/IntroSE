/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { formatVnd } from "../../../services/currency";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  EmptyState,
  Kpi,
  KpiStrip,
  Notice,
  Pill,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import { useAsync } from "../useAsync";

const KIND_LABEL = {
  topup: "Nạp ví",
  purchase: "Mua vé",
  refund: "Hoàn tiền",
  ad_purchase: "Mua quảng cáo",
  ad_refund: "Hoàn quảng cáo",
} as const;

/** The kinds that put money back into a wallet — the ones worth flagging on sight. */
const CREDIT_BACK: ReadonlySet<string> = new Set(["refund", "ad_refund"]);

/**
 * The wallet ledger, whole.
 *
 * Money enters TixHub in exactly one way — a VNPay top-up — and leaves as tickets or comes back as a
 * refund. Per-account screens can show a person their own ledger, but the one failure that actually
 * loses money is invisible from there: a top-up VNPay recorded as successful that never landed in
 * anybody's balance. That is a gap between two lists, and this is the screen where both are visible
 * at once — the gateway reference sits beside the ledger row it produced.
 */
export default function WalletScreen() {
  const [kind, setKind] = useState<"" | keyof typeof KIND_LABEL>("");
  const { data, error, loading, reload } = useAsync(
    () => adminClient.walletTransactions({ kind: kind || undefined, limit: 200 }),
    kind || "all",
  );

  const rows = data ?? [];
  const sum = (of: keyof typeof KIND_LABEL) =>
    rows.filter((row) => row.kind === of).reduce((total, row) => total + Math.abs(row.amount), 0);

  return (
    <>
      <ScreenHead
        title="Ví & hoàn tiền"
        meta="200 giao dịch gần nhất"
        actions={
          <button onClick={reload} className={ACTION_GHOST} disabled={loading}>
            {loading ? "Đang tải…" : "Tải lại"}
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      <KpiStrip>
        <Kpi label="Tiền nạp vào" value={formatVnd(sum("topup"))} />
        <Kpi label="Chi mua vé" value={formatVnd(sum("purchase"))} />
        <Kpi label="Đã hoàn" value={formatVnd(sum("refund"))} />
        <Kpi label="Chi quảng cáo" value={formatVnd(sum("ad_purchase"))} />
      </KpiStrip>

      <div className="flex flex-wrap gap-2">
        {(["", "topup", "purchase", "refund", "ad_purchase", "ad_refund"] as const).map((value) => (
          <button
            key={value || "all"}
            onClick={() => setKind(value)}
            className={
              kind === value
                ? "label-eyebrow inline-flex h-9 items-center bg-beige-kem px-4 text-xanh-pho"
                : ACTION_GHOST
            }
          >
            {value === "" ? "Tất cả" : KIND_LABEL[value]}
          </button>
        ))}
      </div>

      {rows.length === 0 && !loading ? (
        <EmptyState text="Chưa có giao dịch ví nào." />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[820px] text-left text-body">
            <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
              <tr>
                <Th>Thời điểm</Th>
                <Th>Tài khoản</Th>
                <Th>Loại</Th>
                <Th>Số tiền</Th>
                <Th>Số dư sau</Th>
                <Th>Tham chiếu</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-beige-kem/15">
                  <Td nowrap>{row.createdAt.slice(0, 16).replace("T", " ")}</Td>
                  <Td>{row.userEmail}</Td>
                  <Td nowrap>
                    <Pill tone={CREDIT_BACK.has(row.kind) ? "warn" : "neutral"}>
                      {KIND_LABEL[row.kind]}
                    </Pill>
                  </Td>
                  <Td nowrap>
                    {/* The sign is the ledger's own, and it is the fastest read on the row:
                        negative is money leaving the wallet. */}
                    <span
                      className={`tabular-nums ${row.amount < 0 ? "text-ink-soft" : "text-beige-kem"}`}
                    >
                      {row.amount < 0 ? "−" : "+"}
                      {formatVnd(Math.abs(row.amount))}
                    </span>
                  </Td>
                  <Td nowrap>
                    <span className="tabular-nums">{formatVnd(row.balanceAfter)}</span>
                  </Td>
                  <Td>
                    {row.orderCode && <span className="font-meta">{row.orderCode}</span>}
                    {row.adEventTitle && <span className="font-meta">{row.adEventTitle}</span>}
                    {row.providerRef && (
                      <span className="block font-meta text-meta text-ink-soft">
                        VNPay {row.providerRef} · {row.providerStatus}
                      </span>
                    )}
                    {!row.orderCode && !row.adEventTitle && !row.providerRef && "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
