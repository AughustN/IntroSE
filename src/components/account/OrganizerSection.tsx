/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertCircle, AlertTriangle, BarChart3, Check, Clock, Loader2, PauseCircle, Send, Store, XCircle } from "lucide-react";
import { FormEvent, useState } from "react";
import type { OrganizerApplicationView, OrganizerAppealView } from "../../services/authClient";
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
  btnSecondary,
  inputClass,
  inputErrorClass,
  textareaClass,
} from "./primitives";
import { MediaDropzone } from "../common/MediaDropzone";

interface Props {
  isOrganizer: boolean;
  latest: OrganizerApplicationView | null;
  latestAppeal?: OrganizerAppealView | null;
  appeals?: OrganizerAppealView[];
  onApplied: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onManageEvents: () => void;
  onViewAnalytics?: () => void;
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
  latestAppeal,
  appeals = [],
  onApplied,
  onNotice,
  onError,
  onManageEvents,
  onViewAnalytics,
}: Props) {
  const rejected = latest?.status === "rejected";
  const noApplication = !latest;
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(rejected ? latest.display_name : "");
  const [description, setDescription] = useState(rejected ? (latest.description ?? "") : "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const [showAppealForm, setShowAppealForm] = useState(false);
  const [appealReason, setAppealReason] = useState("");
  const [submittingAppeal, setSubmittingAppeal] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);

  const submitAppeal = async (e: FormEvent) => {
    e.preventDefault();
    if (appealReason.trim().length < 5) {
      setAppealError("Vui lòng nhập lý do giải trình chi tiết (tối thiểu 5 ký tự).");
      return;
    }
    setSubmittingAppeal(true);
    setAppealError(null);
    try {
      await authClient.submitOrganizerAppeal(appealReason.trim());
      setShowAppealForm(false);
      setAppealReason("");
      onNotice("Đã gửi đơn khiếu nại thành công. Quản trị viên sẽ xem xét giải trình của bạn.");
      onApplied();
    } catch (err) {
      setAppealError(errorMessage(err, "Không gửi được đơn khiếu nại."));
    } finally {
      setSubmittingAppeal(false);
    }
  };

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
        logo: logoFile,
      });
      setEditing(false);
      setTouched(false);
      setLogoFile(null);
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
                setLogoFile(null);
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
        <form onSubmit={apply} className="space-y-4">
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

          <div className="border-t border-beige-kem/20 pt-3">
            <MediaDropzone
              label="Logo Ban Tổ Chức (Tùy chọn)"
              mediaType="logo"
              onFileSelected={(file) => setLogoFile(file)}
              onRemove={() => setLogoFile(null)}
              helpText="PNG, JPG, WebP tối đa 2MB (Tỷ lệ 1:1)"
              aspectRatio="square"
              disabled={busy}
            />
          </div>
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
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onManageEvents} className={btnPrimary}>
            <Store className="h-4 w-4" aria-hidden />
            Vào trang quản lý Ban Tổ Chức
          </button>
        </div>
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
    const isAppealPending = appeals.some((a) => a.status === "pending") || latestAppeal?.status === "pending";

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
          {latest.review_note && <Field label="Lý do đình chỉ" value={latest.review_note} full />}
        </FieldGrid>

        <p className="mt-5 text-eyebrow leading-5 text-beige-kem/80">
          Bạn không thể tạo hoặc bán vé cho tới khi được mở lại. Vé đã bán không bị ảnh hưởng.
        </p>

        {/* Appeal Form or Action Button */}
        {showAppealForm ? (
          <form onSubmit={submitAppeal} className="mt-5 space-y-4 rounded border border-beige-kem/20 bg-beige-kem/[0.04] p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-body font-bold text-beige-kem uppercase tracking-wider">
                Gửi đơn giải trình & khiếu nại
              </h4>
              <button
                type="button"
                onClick={() => {
                  setShowAppealForm(false);
                  setAppealError(null);
                }}
                className="text-xs text-beige-kem/60 hover:text-beige-kem underline"
              >
                Đóng
              </button>
            </div>

            {appealError && (
              <div className="flex items-center gap-2 rounded bg-red-500/20 p-3 text-xs text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{appealError}</span>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-beige-kem/80">
                Nội dung giải trình / Lý do khiếu nại <span className="text-red-400">*</span>
              </label>
              <textarea
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                placeholder="Vui lòng giải trình rõ lý do bạn cho rằng quyết định đình chỉ là nhầm lẫn hoặc các tài liệu/chứng cứ khắc phục vi phạm..."
                rows={4}
                maxLength={2000}
                className={textareaClass}
                disabled={submittingAppeal}
                required
              />
              <div className="mt-1 flex justify-between text-meta text-beige-kem/50">
                <span>Tối thiểu 5 ký tự</span>
                <span>{appealReason.length}/2000</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={submittingAppeal || appealReason.trim().length < 5}
                className={`${btnPrimary} flex items-center gap-2`}
              >
                {submittingAppeal ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Đang gửi...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Gửi đơn khiếu nại
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAppealForm(false);
                  setAppealError(null);
                }}
                className={btnSecondary}
                disabled={submittingAppeal}
              >
                Hủy
              </button>
            </div>
          </form>
        ) : (
          !isAppealPending && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowAppealForm(true)}
                className={`${btnPrimary} flex items-center gap-2`}
              >
                <Send className="h-4 w-4" />
                {appeals.length > 0 ? "Gửi lại đơn khiếu nại mới" : "Gửi đơn khiếu nại trực tuyến"}
              </button>
            </div>
          )
        )}

        {/* Lịch sử toàn bộ khiếu nại */}
        {appeals.length > 0 && (
          <div className="mt-6 space-y-3 border-t border-beige-kem/15 pt-5">
            <h4 className="font-display text-body font-bold text-beige-kem uppercase tracking-wider">
              Lịch sử khiếu nại ({appeals.length})
            </h4>
            <div className="space-y-3">
              {appeals.map((appeal) => (
                <div
                  key={appeal.id}
                  className={`rounded border p-4 text-eyebrow ${
                    appeal.status === "pending"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : appeal.status === "approved"
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-red-500/30 bg-red-500/[0.06]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-beige-kem/10 pb-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          appeal.status === "approved"
                            ? "good"
                            : appeal.status === "pending"
                              ? "neutral"
                              : "warn"
                        }
                      >
                        {appeal.status === "pending"
                          ? "Đang chờ duyệt"
                          : appeal.status === "approved"
                            ? "Đã chấp thuận"
                            : "Đã từ chối"}
                      </Badge>
                      <span className="text-meta text-beige-kem/70">
                        Nộp lúc: {formatDate(appeal.created_at)}
                      </span>
                    </div>
                    {appeal.reviewed_at && (
                      <span className="text-meta text-beige-kem/70">
                        Xử lý lúc: {formatDate(appeal.reviewed_at)}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 space-y-2 text-beige-kem">
                    <div>
                      <span className="mb-1 block text-xs font-semibold text-beige-kem/70">
                        Nội dung giải trình:
                      </span>
                      <p className="whitespace-pre-line rounded bg-black/25 p-2.5 text-body italic text-beige-kem/90">
                        &ldquo;{appeal.reason}&rdquo;
                      </p>
                    </div>

                    {appeal.review_note && (
                      <div className="mt-2 border-l-2 border-beige-kem/40 pl-3">
                        <span className="block text-xs font-semibold text-beige-kem/70">
                          Phản hồi của Quản trị viên:
                        </span>
                        <p className="text-body text-beige-kem/90">
                          {appeal.review_note}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
