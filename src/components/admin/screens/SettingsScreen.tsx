/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { SystemSettings } from "@shared/admin/types.js";
import { adminClient } from "../../../services/adminClient";
import { ACTION_PRIMARY, EmptyState, FIELD, Notice, PANEL, ScreenHead } from "../adminUi";
import { useAsync } from "../useAsync";

interface Meta {
  label: string;
  hint: string;
  min?: number;
  max?: number;
}

/**
 * The ten keys, grouped by the thing they govern.
 *
 * Flat, they were ten number fields in one grid and an admin had to know which three interact — the
 * hold clock, its grace period and the absolute ceiling are one rule spread across three settings,
 * and setting the grace above the ceiling is refused by the server with a message that only makes
 * sense once you know they are related.
 */
const GROUPS: Array<{ title: string; note: string; keys: Array<[keyof SystemSettings, Meta]> }> = [
  {
    title: "Giữ chỗ",
    note: "Ba giá trị này là một luật: gia hạn phải ≤ giới hạn tuyệt đối.",
    keys: [
      [
        "seat_hold_ttl_minutes",
        { label: "Thời gian giữ chỗ (phút)", hint: "1–30", min: 1, max: 30 },
      ],
      [
        "topup_grace_minutes",
        {
          label: "Gia hạn khi nạp tiền (phút)",
          hint: "1–15; ≤ giới hạn tuyệt đối",
          min: 1,
          max: 15,
        },
      ],
      [
        "absolute_ceiling_minutes",
        { label: "Giới hạn tuyệt đối (phút)", hint: "2–30; ≥ gia hạn", min: 2, max: 30 },
      ],
      [
        "max_tickets_per_buyer",
        { label: "Vé tối đa mỗi người mua", hint: "1–50", min: 1, max: 50 },
      ],
    ],
  },
  {
    title: "Ví",
    note: "Số tiền tính bằng đồng, số nguyên.",
    keys: [
      ["wallet_topup_min", { label: "Nạp tối thiểu (VND)", hint: "≥ 0; ≤ nạp tối đa", min: 0 }],
      [
        "wallet_topup_max",
        { label: "Nạp tối đa (VND)", hint: "≥ nạp tối thiểu; ≤ số dư tối đa", min: 0 },
      ],
      ["wallet_balance_ceiling", { label: "Số dư tối đa (VND)", hint: "≥ nạp tối đa", min: 0 }],
    ],
  },
  {
    title: "AI",
    note: "Tắt công tắc là không gọi ra ngoài, bất kể trần còn dư.",
    keys: [
      ["ai_features_enabled", { label: "Bật tính năng AI", hint: "Bật/Tắt" }],
      [
        "ai_platform_request_ceiling",
        { label: "Trần yêu cầu AI mỗi kỳ", hint: "Toàn nền tảng; 0 = ngừng gọi", min: 0 },
      ],
      [
        "ai_platform_window_hours",
        { label: "Độ dài kỳ tính trần (giờ)", hint: "1–720", min: 1, max: 720 },
      ],
    ],
  },
];

export default function SettingsScreen() {
  const { data, error, loading } = useAsync(() => adminClient.settings(), "settings");
  const [draft, setDraft] = useState<SystemSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The saved settings seed the form. Editing then happens locally until Save, so a slip in one
  // field cannot reach the platform while the admin is still deciding about another.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setDraft(data);
  }, [data]);

  const set = (key: keyof SystemSettings, value: number | boolean) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value } as SystemSettings);
    setFailure(null);
    setNotice(null);
  };

  return (
    <>
      <ScreenHead
        title="Cấu hình"
        meta="Áp dụng ngay cho mọi yêu cầu sau khi lưu"
        actions={
          <button
            className={ACTION_PRIMARY}
            disabled={busy || !draft}
            onClick={async () => {
              if (!draft) return;
              setBusy(true);
              setFailure(null);
              try {
                const saved = await adminClient.updateSettings(draft);
                setDraft(saved);
                setNotice("Đã lưu cấu hình.");
              } catch (cause) {
                setFailure(cause instanceof Error ? cause.message : "Không lưu được cấu hình.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Đang lưu…" : "Lưu cấu hình"}
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {!draft ? (
        <EmptyState text={loading ? "Đang tải cấu hình…" : "Không tải được cấu hình."} />
      ) : (
        GROUPS.map((group) => (
          <div key={group.title} className={`${PANEL} space-y-4`}>
            <div>
              <p className="label-eyebrow text-ink-soft">{group.title}</p>
              <p className="mt-1 font-meta text-body text-ink-soft">{group.note}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {group.keys.map(([key, meta]) => {
                const value = draft[key];
                return (
                  <label key={key} className="space-y-1.5 text-body text-beige-kem">
                    <span className="block font-bold">{meta.label}</span>
                    <span className="block font-meta text-meta text-ink-soft">{meta.hint}</span>
                    {typeof value === "boolean" ? (
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={value}
                          aria-label={meta.label}
                          onClick={() => set(key, !value)}
                          /*
                            Square, like every other control on the site. The knob is burgundy when
                            on, so the state is carried by colour and by position rather than by
                            position alone.
                          */
                          className={`relative h-7 w-12 border transition ${
                            value
                              ? "border-burgundy bg-burgundy/15"
                              : "border-beige-kem/25 bg-surface-2"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 transition-transform ${
                              value ? "translate-x-6 bg-burgundy" : "translate-x-0.5 bg-ink-soft"
                            }`}
                          />
                        </button>
                        <span className="font-meta text-meta text-ink-soft">
                          {value ? "Bật" : "Tắt"}
                        </span>
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={value as number}
                        min={meta.min}
                        max={meta.max}
                        onChange={(event) => set(key, Number(event.target.value))}
                        className={`${FIELD} w-full`}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
