/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check, Clock, Loader2, PauseCircle, Store } from "lucide-react";
import { FormEvent, useState } from "react";
import type { OrganizerApplicationView } from "../../services/authClient";
import { authClient } from "../../services/authClient";
import { errorMessage } from "./errors";
import {
  Badge,
  Field,
  FieldGrid,
  FormField,
  InfoCard,
  btnHeader,
  btnHeaderPrimary,
  btnPrimary,
  inputClass,
  inputErrorClass,
  textareaClass,
} from "./primitives";

interface Props {
  isOrganizer: boolean;
  latest: OrganizerApplicationView | null;
  onApplied: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onManageEvents: () => void;
}

const DESCRIPTION_MIN = 20;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Where the account stands in the approval path, so "chờ duyệt" is a position, not a dead end. */
function Stepper({ current }: { current: 0 | 1 | 2 }) {
  const steps = ["Gửi đơn", "Chờ duyệt", "Đã duyệt"];
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Tiến trình đăng ký nhà tổ chức">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              /*
               * Done is the page's ink inverted, the way a chosen row is marked in every rail in
               * this app; the step being waited on is burgundy, the colour that commits. Neither
               * used to be: they were a lavender and a peach lozenge, two fills nothing else on the
               * site paints at full strength.
               */
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border font-meta text-meta font-bold ${
                done
                  ? "border-beige-kem bg-beige-kem text-xanh-pho"
                  : active
                    ? "border-burgundy bg-burgundy text-white"
                    : "border-beige-kem/25 text-beige-kem/70"
              }`}
            >
              {done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
            </span>
            <span
              className={`truncate font-meta text-meta uppercase ${
                active ? "text-beige-kem" : "text-beige-kem/70"
              }`}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span
                className={`hidden h-0.5 flex-1 sm:block ${done ? "bg-beige-kem/60" : "bg-beige-kem/30"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The organizer capability is derived, not a role: an approved application IS the permission. This
 * card therefore reads as a record of that application, and — when one was rejected — brings the
 * previous answers back so nothing has to be retyped (principle: recoverability).
 */
export default function OrganizerSection({
  isOrganizer,
  latest,
  onApplied,
  onNotice,
  onError,
  onManageEvents,
}: Props) {
  const rejected = latest?.status === "rejected";
  const noApplication = !latest;
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(rejected ? latest.display_name : "");
  const [description, setDescription] = useState(rejected ? (latest.description ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const nameErr = displayName.trim() ? null : "Tên hiển thị không được để trống.";
  const descErr =
    description.trim().length >= DESCRIPTION_MIN
      ? null
      : `Mô tả cần ít nhất ${DESCRIPTION_MIN} ký tự để admin có thể xét duyệt.`;

  const apply = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameErr || descErr) return;
    setBusy(true);
    try {
      await authClient.applyOrganizer({
        displayName: displayName.trim(),
        description: description.trim(),
      });
      setEditing(false);
      setTouched(false);
      onNotice(
        "Đã gửi đơn đăng ký nhà tổ chức. Admin sẽ xét duyệt và bạn sẽ thấy trạng thái ở đây.",
      );
      onApplied();
    } catch (e2) {
      onError(errorMessage(e2, "Không gửi được đơn đăng ký."));
    } finally {
      setBusy(false);
    }
  };

  // The application form, used both for a first submission and for a resubmission after rejection.
  if (editing) {
    return (
      <InfoCard
        title={rejected ? "Gửi lại đơn đăng ký" : "Đăng ký làm nhà tổ chức"}
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTouched(false);
              }}
              disabled={busy}
              className={btnHeader}
            >
              Hủy
            </button>
            <button type="button" onClick={apply} disabled={busy} className={btnHeaderPrimary}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {busy ? "Đang gửi…" : "Gửi đơn"}
            </button>
          </div>
        }
      >
        <Stepper current={0} />
        <form onSubmit={apply}>
          <FieldGrid>
            <FormField
              label="Tên hiển thị"
              htmlFor="org-name"
              hint="Tên khán giả thấy trên trang sự kiện"
              error={touched ? nameErr : null}
            >
              <input
                id="org-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-invalid={touched && !!nameErr}
                aria-describedby={touched && nameErr ? "org-name-error" : undefined}
                className={touched && nameErr ? inputErrorClass : inputClass}
              />
            </FormField>

            <FormField
              label="Mô tả"
              htmlFor="org-desc"
              full
              hint={`Bạn tổ chức loại sự kiện nào? · ${description.trim().length}/${DESCRIPTION_MIN} ký tự tối thiểu`}
              error={touched ? descErr : null}
            >
              <textarea
                id="org-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                aria-invalid={touched && !!descErr}
                aria-describedby={touched && descErr ? "org-desc-error" : undefined}
                className={touched && descErr ? `${textareaClass} border-burgundy` : textareaClass}
              />
            </FormField>
          </FieldGrid>
          <button type="submit" className="sr-only" disabled={busy}>
            Gửi đơn
          </button>
        </form>
      </InfoCard>
    );
  }

  if (isOrganizer && latest) {
    return (
      <InfoCard title="Nhà tổ chức">
        <Stepper current={2} />
        <FieldGrid>
          <Field label="Tên hiển thị" value={latest.display_name} />
          <Field
            label="Trạng thái"
            value={
              <Badge tone="good" icon={<Check className="h-3 w-3" aria-hidden />}>
                Đã duyệt
              </Badge>
            }
          />
          <Field label="Ngày gửi đơn" value={formatDate(latest.applied_at)} />
          <Field label="Mô tả" value={latest.description} full />
        </FieldGrid>
        <button type="button" onClick={onManageEvents} className={`${btnPrimary} mt-5`}>
          <Store className="h-4 w-4" aria-hidden />
          Quản lý sự kiện
        </button>
      </InfoCard>
    );
  }

  if (latest?.status === "pending") {
    return (
      <InfoCard title="Nhà tổ chức">
        <Stepper current={1} />
        <FieldGrid>
          <Field label="Tên hiển thị" value={latest.display_name} />
          <Field
            label="Trạng thái"
            value={
              <Badge tone="neutral" icon={<Clock className="h-3 w-3" aria-hidden />}>
                Chờ duyệt
              </Badge>
            }
          />
          <Field label="Ngày gửi đơn" value={formatDate(latest.applied_at)} />
          <Field label="Mô tả" value={latest.description} full />
        </FieldGrid>
        <div className="mt-5 flex items-start gap-3 border-l-2 border-beige-kem/40 bg-beige-kem/[0.06] p-4">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
          <p className="text-eyebrow leading-5 text-beige-kem/80">
            Bạn không cần làm gì thêm. Khi được duyệt, mục này sẽ mở ra trang quản lý sự kiện. Trong
            lúc chờ, bạn vẫn mua vé bình thường.
          </p>
        </div>
      </InfoCard>
    );
  }

  if (latest?.status === "suspended") {
    return (
      <InfoCard title="Nhà tổ chức" tone="danger">
        <FieldGrid>
          <Field label="Tên hiển thị" value={latest.display_name} />
          <Field
            label="Trạng thái"
            value={
              <Badge tone="warn" icon={<PauseCircle className="h-3 w-3" aria-hidden />}>
                Bị đình chỉ
              </Badge>
            }
          />
          <Field label="Ngày gửi đơn" value={formatDate(latest.applied_at)} />
          {latest.review_note && <Field label="Lý do" value={latest.review_note} full />}
        </FieldGrid>
        <p className="mt-5 text-eyebrow leading-5 text-beige-kem/70">
          Bạn không thể tạo hoặc bán vé cho tới khi được mở lại. Vé đã bán không bị ảnh hưởng. Liên
          hệ admin nếu bạn cho rằng đây là nhầm lẫn.
        </p>
      </InfoCard>
    );
  }

  // Rejected, or never applied.
  return (
    <InfoCard title="Nhà tổ chức">
      {rejected ? (
        <>
          <FieldGrid>
            <Field label="Tên hiển thị" value={latest.display_name} />
            <Field
              label="Trạng thái"
              value={
                <Badge tone="warn" icon={<PauseCircle className="h-3 w-3" aria-hidden />}>
                  Bị từ chối
                </Badge>
              }
            />
            <Field label="Ngày gửi đơn" value={formatDate(latest.applied_at)} />
            {latest.review_note && <Field label="Lý do từ chối" value={latest.review_note} full />}
          </FieldGrid>
          <p className="mt-5 text-eyebrow leading-5 text-beige-kem/70">
            Bạn có thể chỉnh sửa và gửi lại — nội dung cũ sẽ được điền sẵn.
          </p>
        </>
      ) : (
        <p className="text-body leading-6 text-beige-kem/70">
          Đăng ký để tự tạo sự kiện, thiết kế sơ đồ ghế và bán vé trên TixHub. Admin xét duyệt đơn
          trước khi bạn bắt đầu bán.
        </p>
      )}
      <button type="button" onClick={() => setEditing(true)} className={`${btnPrimary} mt-5`}>
        {noApplication ? "Đăng ký làm nhà tổ chức" : "Gửi lại đơn"}
      </button>
    </InfoCard>
  );
}
