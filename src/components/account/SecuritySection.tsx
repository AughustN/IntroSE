/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Eye, EyeOff, Info, Loader2, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import type { Me } from "@/shared/auth/types";
import { authClient } from "../../services/authClient";
import { errorMessage } from "./errors";
import {
  EditButton,
  Field,
  FieldGrid,
  FormField,
  InfoCard,
  RuleItem,
  btnDanger,
  btnHeader,
  btnHeaderPrimary,
  inputClass,
  inputErrorClass,
} from "./primitives";
import { passwordError, passwordRules, passwordStrength } from "./validation";

interface Props {
  me: Me;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  /** Raises the confirmation dialog for revoking every session; the shell owns the outcome. */
  onConfirmLogoutAll: () => void;
}

/**
 * Password and session control.
 *
 * Two behaviours worth naming, because they are easy to confuse and the server treats them
 * differently:
 *   - changing the password revokes every OTHER session and keeps this one (`revokeAllExceptFamily`);
 *   - "đăng xuất khỏi mọi thiết bị" revokes every session INCLUDING this one (`revokeAllForUser`).
 * Both consequences are stated before the action, not after it (principle: minimal surprise).
 */
export default function SecuritySection({ me, onNotice, onError, onConfirmLogoutAll }: Props) {
  const [editing, setEditing] = useState(false);
  const [cur, setCur] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<{ pw1?: boolean; pw2?: boolean }>({});

  const rules = passwordRules(pw1);
  const strength = passwordStrength(pw1);
  const pw1Err = pw1 ? passwordError(pw1) : null;
  const pw2Err = pw2 && pw1 !== pw2 ? "Mật khẩu nhập lại không khớp." : null;
  const canSubmit = !!cur && !!pw1 && !!pw2 && !pw1Err && !pw2Err;

  const cancel = () => {
    setCur("");
    setPw1("");
    setPw2("");
    setTouched({});
    setReveal(false);
    setEditing(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ pw1: true, pw2: true });
    if (!canSubmit) return;
    setBusy(true);
    try {
      await authClient.changePassword({
        currentPassword: cur,
        newPassword: pw1,
        newPasswordConfirm: pw2,
      });
      cancel();
      onNotice("Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.");
    } catch (e2) {
      onError(errorMessage(e2, "Không đổi được mật khẩu."));
    } finally {
      setBusy(false);
    }
  };

  const strengthBar =
    strength.score === 3
      ? "w-full bg-la-co"
      : strength.score === 2
        ? "w-2/3 bg-cam-dat"
        : "w-1/3 bg-burgundy";

  const isGoogle = me.provider === "google";

  return (
    <div className="space-y-4">
      <InfoCard
        title="Mật khẩu"
        action={
          isGoogle ? undefined : editing ? (
            <div className="flex gap-2">
              <button type="button" onClick={cancel} disabled={busy} className={btnHeader}>
                Hủy
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !canSubmit}
                className={btnHeaderPrimary}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {busy ? "Đang đổi…" : "Đổi mật khẩu"}
              </button>
            </div>
          ) : (
            <EditButton label="Đổi" onClick={() => setEditing(true)} />
          )
        }
      >
        {isGoogle ? (
          // An earlier version simply omitted this section for Google accounts, leaving them with no
          // explanation of why they have no password to manage (principle: user diversity).
          <div className="flex items-start gap-3 border-2 border-beige-kem bg-surface-2 p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
            <p className="text-body leading-6 text-beige-kem/70">
              Tài khoản này đăng nhập bằng Google, nên TixHub không giữ mật khẩu nào. Mật khẩu được
              quản lý trong tài khoản Google của bạn.
            </p>
          </div>
        ) : editing ? (
          <form onSubmit={submit}>
            <div className="mb-5 flex items-start gap-3 border-2 border-beige-kem bg-cam-dat p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
              <p className="text-eyebrow leading-5 text-beige-kem/80">
                Sau khi đổi mật khẩu,{" "}
                <strong className="font-bold text-beige-kem">mọi thiết bị khác</strong> sẽ bị đăng
                xuất. Thiết bị này vẫn đăng nhập.
              </p>
            </div>

            <FieldGrid>
              <FormField label="Mật khẩu hiện tại" htmlFor="acc-cur">
                <input
                  id="acc-cur"
                  type="password"
                  autoComplete="current-password"
                  value={cur}
                  onChange={(e) => setCur(e.target.value)}
                  className={inputClass}
                />
              </FormField>

              <FormField
                label="Mật khẩu mới"
                htmlFor="acc-pw1"
                error={touched.pw1 ? pw1Err : null}
                hint={`Độ mạnh: ${strength.label}`}
              >
                <div className="relative">
                  <input
                    id="acc-pw1"
                    type={reveal ? "text" : "password"}
                    autoComplete="new-password"
                    value={pw1}
                    onChange={(e) => setPw1(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, pw1: true }))}
                    aria-invalid={touched.pw1 && !!pw1Err}
                    aria-describedby="acc-pw-rules"
                    className={`${touched.pw1 && pw1Err ? inputErrorClass : inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    className="absolute right-1 top-1 grid h-9 w-9 place-items-center text-beige-kem/70 transition hover:text-beige-kem"
                  >
                    {reveal ? (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden bg-bubblegum">
                  {pw1 && <div className={`h-full transition-all ${strengthBar}`} />}
                </div>
              </FormField>

              <FormField
                label="Nhập lại mật khẩu mới"
                htmlFor="acc-pw2"
                error={touched.pw2 ? pw2Err : null}
              >
                <input
                  id="acc-pw2"
                  type={reveal ? "text" : "password"}
                  autoComplete="new-password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, pw2: true }))}
                  aria-invalid={touched.pw2 && !!pw2Err}
                  aria-describedby={touched.pw2 && pw2Err ? "acc-pw2-error" : undefined}
                  className={touched.pw2 && pw2Err ? inputErrorClass : inputClass}
                />
              </FormField>
            </FieldGrid>

            <ul id="acc-pw-rules" className="mt-5 space-y-1.5 border-t border-beige-kem/25 pt-4">
              {rules.map((r) => (
                <RuleItem key={r.label} ok={r.ok} label={r.label} />
              ))}
            </ul>

            <button type="submit" className="sr-only" disabled={busy || !canSubmit}>
              Đổi mật khẩu
            </button>
          </form>
        ) : (
          <FieldGrid>
            <Field label="Mật khẩu" value={<span className="tracking-[0.3em]">••••••••</span>} />
            <Field label="Hình thức đăng nhập" value="Email & mật khẩu" />
          </FieldGrid>
        )}
      </InfoCard>

      {/* Feature 001 built revocable sessions; until now nothing in the UI could use them. */}
      <InfoCard title="Thiết bị đăng nhập">
        <div className="flex items-start gap-3">
          <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-beige-kem/70" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-body leading-6 text-beige-kem/70">
              Nếu bạn nghi ngờ ai đó truy cập tài khoản, hãy đăng xuất khỏi tất cả thiết bị. Bạn sẽ
              cần đăng nhập lại, kể cả trên thiết bị này.
            </p>
            <button type="button" onClick={onConfirmLogoutAll} className={`${btnDanger} mt-4`}>
              Đăng xuất khỏi mọi thiết bị
            </button>
          </div>
        </div>
      </InfoCard>
    </div>
  );
}
