import { useRef, useState } from "react";
import { adminClient } from "../../services/adminClient";
import { ACTION_GHOST, Notice, PANEL } from "./adminUi";

export default function AdCompensationForm({
  purchaseId,
  onDone,
  onClose,
}: {
  purchaseId: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <form
      className={`${PANEL} space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        const form = new FormData(e.currentTarget);
        lock.current = true;
        setBusy(true);
        setError("");
        try {
          const from = new Date(String(form.get("from")));
          const to = new Date(String(form.get("to")));
          if (!(to > from) || to.getTime() > Date.now())
            throw new Error("Ngày kết thúc phải sau ngày bắt đầu và không ở tương lai.");
          await adminClient.compensateAd({
            purchaseId,
            incidentId: String(form.get("incident")),
            from: from.toISOString(),
            to: to.toISOString(),
            reason: String(form.get("reason")),
          });
          onDone();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Không thể bù thời gian.");
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <h3 className="font-display text-xl text-beige-kem">
        Bù thời gian · chiến dịch #{purchaseId}
      </h3>
      <p className="text-sm text-ink-soft">
        Chỉ xác nhận sự cố nền tảng đã kiểm chứng, không bù vì ít người xem. Hệ thống chỉ bù phần sự
        cố trùng thời hạn gói và lưu người xác nhận; cùng sự cố không được bù hai lần.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        {[
          ["incident", "Mã sự cố", "text"],
          ["from", "Bắt đầu sự cố (giờ địa phương)", "datetime-local"],
          ["to", "Kết thúc sự cố (giờ địa phương)", "datetime-local"],
          ["reason", "Lý do / bằng chứng xác minh", "text"],
        ].map(([name, label, type]) => (
          <label key={name} className="space-y-2 text-sm text-beige-kem">
            <span>{label}</span>
            <input
              required
              name={name}
              type={type}
              minLength={name === "reason" ? 10 : name === "incident" ? 3 : undefined}
              maxLength={name === "reason" ? 1000 : 100}
              className="min-h-11 w-full border border-beige-kem/40 bg-surface-2 px-3 text-beige-kem"
            />
          </label>
        ))}
      </fieldset>
      <label className="flex gap-2 text-sm text-beige-kem">
        <input required type="checkbox" disabled={busy} />
        Tôi xác nhận đây là sự cố nền tảng đã được kiểm chứng.
      </label>
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className={ACTION_GHOST}>
          {busy ? "Đang xử lý…" : "Xác nhận bù thời gian"}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={ACTION_GHOST}>
          Huỷ
        </button>
      </div>
    </form>
  );
}
