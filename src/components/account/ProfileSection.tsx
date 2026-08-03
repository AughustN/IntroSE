/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertTriangle, Loader2, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import type { Me } from "@/shared/auth/types";
import { authClient } from "../../services/authClient";
import { errorMessage } from "./errors";
import {
  AvatarWithBadge,
  Badge,
  EditButton,
  Field,
  FieldGrid,
  FormField,
  InfoCard,
  btnHeader,
  btnHeaderPrimary,
  inputClass,
  inputErrorClass,
} from "./primitives";
import { NICKNAME_MAX, avatarError, nicknameError, normalizePhone, phoneError } from "./validation";

interface Props {
  me: Me;
  onSaved: (user: Me, message: string) => void;
  onError: (message: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}

const PROVIDER_LABEL: Record<Me["provider"], string> = {
  email: "Email & mật khẩu",
  google: "Google",
};

function roleLabel(me: Me): string {
  if (me.isAdmin) return "Admin";
  if (me.isOrganizer) return "Nhà tổ chức";
  return "Người mua vé";
}

/** Vietnamese formatting for a stored `+84…` number, which is not how anyone reads it aloud. */
function displayPhone(phone: string | null): string {
  if (!phone) return "";
  const m = /^\+84(\d{9})$/.exec(phone);
  if (!m) return phone;
  const n = m[1];
  return `0${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
}

/**
 * Identity. Shows its values as text and turns into a form only when asked — the avatar included,
 * which an earlier version uploaded the instant a file was picked, with no preview and no way back.
 */
export default function ProfileSection({ me, onSaved, onError, onDirtyChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(me.nickname ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState<{ nickname?: boolean; phone?: boolean }>({});

  const nickErr = nicknameError(nickname);
  const phoneErr = phoneError(phone);
  const dirty =
    nickname.trim() !== (me.nickname ?? "") ||
    (normalizePhone(phone.trim()) ?? "") !== (me.phone ?? "") ||
    avatarFile !== null;

  // Report upward so the shell can guard leaving. Clearing on unmount matters: without it a
  // discarded edit would leave the shell believing there is still something unsaved.
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  // One object URL at a time; the browser holds the blob alive until it is revoked.
  useEffect(() => {
    if (!avatarFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const pickAvatar = (file: File) => {
    const problem = avatarError(file);
    if (problem) {
      setAvatarFile(null);
      setAvatarMsg(problem);
      return;
    }
    setAvatarMsg(null);
    setAvatarFile(file);
  };

  const reset = () => {
    setNickname(me.nickname ?? "");
    setPhone(me.phone ?? "");
    setAvatarFile(null);
    setAvatarMsg(null);
    setTouched({});
    setEditing(false);
  };

  const save = async () => {
    setTouched({ nickname: true, phone: true });
    if (nickErr || phoneErr) return;
    setSaving(true);
    try {
      let updated = me;
      const normalized = normalizePhone(phone.trim());
      const fieldsChanged =
        nickname.trim() !== (me.nickname ?? "") || (normalized ?? "") !== (me.phone ?? "");
      // Text first, image second: the avatar response echoes the account as the server sees it, so
      // running it last means the object handed back already carries the new nickname.
      if (fieldsChanged) {
        updated = await authClient.updateProfile({
          nickname: nickname.trim(),
          phone: phone.trim() || null,
        });
      }
      if (avatarFile) {
        updated = await authClient.uploadAvatar(avatarFile);
        setAvatarFile(null);
      }
      setEditing(false);
      setTouched({});
      onSaved(updated, "Đã lưu hồ sơ.");
    } catch (e) {
      onError(errorMessage(e, "Không lưu được hồ sơ."));
    } finally {
      setSaving(false);
    }
  };

  const initial = (nickname || me.nickname || me.email || "?").charAt(0).toUpperCase();
  const shownAvatar = preview ?? me.avatarUrl;

  return (
    <div className="space-y-4">
      {/* Summary: who this is, at a glance. The old screen never showed the email at all. */}
      <section className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-5 shadow-hard shadow-black/20 sm:p-6">
        <div className="flex flex-wrap items-center gap-5">
          <AvatarWithBadge
            url={shownAvatar}
            initial={initial}
            email={me.email}
            onPick={pickAvatar}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-xl font-black text-beige-kem">
              {me.nickname || me.email}
            </p>
            <p className="mt-1 text-sm text-beige-kem/70">{roleLabel(me)}</p>
            <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-xs text-beige-kem/70">
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {me.email}
            </p>
          </div>
        </div>
        {(avatarFile || avatarMsg) && (
          <div className="mt-4 border-t border-beige-kem/25 pt-3">
            {avatarMsg ? (
              <p role="alert" className="flex items-start gap-1.5 text-xs leading-5 text-beige-kem">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-burgundy" aria-hidden />
                {avatarMsg}
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[11px] text-ink-soft">Ảnh mới chưa được lưu.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAvatarFile(null)}
                    disabled={saving}
                    className={btnHeader}
                  >
                    Bỏ ảnh
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className={btnHeaderPrimary}
                  >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    {saving ? "Đang lưu…" : "Lưu ảnh"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <InfoCard
        title="Thông tin cá nhân"
        action={
          editing ? (
            <div className="flex gap-2">
              <button type="button" onClick={reset} disabled={saving} className={btnHeader}>
                Hủy
              </button>
              <button type="button" onClick={save} disabled={saving} className={btnHeaderPrimary}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {saving ? "Đang lưu…" : "Lưu"}
              </button>
            </div>
          ) : (
            <EditButton onClick={() => setEditing(true)} />
          )
        }
      >
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <FieldGrid>
              <FormField
                label="Biệt danh"
                htmlFor="acc-nickname"
                hint={`${nickname.trim().length}/${NICKNAME_MAX} ký tự`}
                error={touched.nickname ? nickErr : null}
              >
                <input
                  id="acc-nickname"
                  value={nickname}
                  maxLength={NICKNAME_MAX}
                  onChange={(e) => setNickname(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, nickname: true }))}
                  aria-invalid={touched.nickname && !!nickErr}
                  aria-describedby={touched.nickname && nickErr ? "acc-nickname-error" : undefined}
                  className={touched.nickname && nickErr ? inputErrorClass : inputClass}
                />
              </FormField>

              <FormField
                label="Số điện thoại"
                htmlFor="acc-phone"
                hint="Không bắt buộc · dùng để nhắc suất diễn"
                error={touched.phone ? phoneErr : null}
              >
                <input
                  id="acc-phone"
                  value={phone}
                  inputMode="tel"
                  placeholder="0901234567"
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  aria-invalid={touched.phone && !!phoneErr}
                  aria-describedby={touched.phone && phoneErr ? "acc-phone-error" : undefined}
                  className={touched.phone && phoneErr ? inputErrorClass : inputClass}
                />
              </FormField>

              <Field label="Email" value={me.email} />
            </FieldGrid>
            <p className="mt-5 border-t border-beige-kem/25 pt-4 font-mono text-[11px] leading-5 text-beige-kem/70">
              Email, hình thức đăng nhập, quyền và trạng thái tài khoản không thể tự đổi ở đây.
            </p>
            {/* Submitting with Enter should work, but the visible commit lives in the card header. */}
            <button type="submit" className="sr-only">
              Lưu
            </button>
          </form>
        ) : (
          <FieldGrid>
            <Field label="Biệt danh" value={me.nickname} />
            <Field label="Số điện thoại" value={displayPhone(me.phone)} />
            <Field label="Email" value={me.email} />
            <Field label="Hình thức đăng nhập" value={PROVIDER_LABEL[me.provider]} />
            <Field label="Quyền" value={roleLabel(me)} />
            <Field
              label="Trạng thái"
              value={
                me.status === "active" ? (
                  <Badge tone="good">Hoạt động</Badge>
                ) : (
                  <Badge tone="warn" icon={<AlertTriangle className="h-3 w-3" aria-hidden />}>
                    Bị đình chỉ
                  </Badge>
                )
              }
            />
          </FieldGrid>
        )}
      </InfoCard>
    </div>
  );
}
