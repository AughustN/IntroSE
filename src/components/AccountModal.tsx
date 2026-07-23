/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Me } from "@/shared/auth/types";
import { ApiClientError, authClient } from "../services/authClient";

interface Props {
  onClose: () => void;
  onLogout: () => void;
  onProfileUpdated: (user: Me) => void;
  onManageEvents: () => void;
}

const inputClass =
  "h-11 w-full rounded-xl border border-beige-kem/20 bg-white/[0.035] px-4 text-sm text-beige-kem outline-none focus:border-cam-dat";
const labelText = "mb-1.5 block font-mono text-xs text-beige-kem/70";
const sectionClass = "rounded-2xl border border-beige-kem/10 bg-white/[0.02] p-4";
const primaryBtn =
  "rounded-xl bg-burgundy px-4 py-2.5 text-sm font-black text-beige-kem transition hover:bg-burgundy/90 disabled:opacity-60";
const msg = (e: unknown) => (e instanceof ApiClientError && e.userMessage ? e.userMessage : "Có lỗi xảy ra.");

export default function AccountModal({ onClose, onLogout, onProfileUpdated, onManageEvents }: Props) {
  const [me, setMe] = useState<Me | null>(null);
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [orgStatus, setOrgStatus] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [cur, setCur] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    authClient
      .me()
      .then((u) => {
        setMe(u);
        setNickname(u.nickname ?? "");
        setPhone(u.phone ?? "");
      })
      .catch(() => {});
    authClient
      .organizerStatus()
      .then((s) => {
        setIsOrganizer(s.isOrganizer);
        setOrgStatus(s.applications[0]?.status ?? null);
      })
      .catch(() => {});
  }, []);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setNote(null);
    try {
      const u = await authClient.updateProfile({ nickname, phone: phone.trim() || null });
      setMe(u);
      onProfileUpdated(u);
      setNote("Đã lưu hồ sơ.");
    } catch (e2) {
      setErr(msg(e2));
    }
  };

  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setNote(null);
    try {
      const u = await authClient.uploadAvatar(file);
      setMe(u);
      onProfileUpdated(u);
      setNote("Đã cập nhật ảnh đại diện.");
    } catch (e2) {
      setErr(msg(e2));
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setNote(null);
    try {
      await authClient.changePassword({ currentPassword: cur, newPassword: pw1, newPasswordConfirm: pw2 });
      setCur("");
      setPw1("");
      setPw2("");
      setNote("Đã đổi mật khẩu. Các phiên khác đã bị đăng xuất.");
    } catch (e2) {
      setErr(msg(e2));
    }
  };

  const applyOrganizer = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setNote(null);
    try {
      await authClient.applyOrganizer({ displayName, description });
      setOrgStatus("pending");
      setNote("Đã gửi đơn đăng ký nhà tổ chức, đang chờ duyệt.");
    } catch (e2) {
      setErr(msg(e2));
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-xanh-pho text-beige-kem">
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-3xl font-black">Tài khoản</h2>
          <button
            onClick={onClose}
            className="grid h-10 place-items-center rounded-xl border border-beige-kem/10 px-4 font-mono text-[11px] font-bold uppercase text-beige-kem/70 transition hover:border-cam-dat hover:text-beige-kem"
          >
            ← Quay lại
          </button>
        </div>

        {note && <div className="rounded-xl border border-la-co/20 bg-la-co/5 p-3 text-xs leading-5 text-la-co">{note}</div>}
        {err && <div className="rounded-xl border border-burgundy/40 bg-burgundy/10 p-3 text-xs leading-5 text-beige-kem">{err}</div>}

        {/* Avatar + profile */}
        <form onSubmit={saveProfile} className={sectionClass}>
          <div className="flex items-center gap-4">
            {me?.avatarUrl ? (
              <img src={me.avatarUrl} alt="avatar" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-full bg-burgundy font-display text-xl font-black">
                {(nickname || me?.email || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <button type="button" onClick={() => fileRef.current?.click()} className={primaryBtn}>
                Đổi ảnh
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} className="hidden" />
              <p className="mt-1 font-mono text-[10px] text-beige-kem/50">JPEG/PNG/WebP, ≤2MB</p>
            </div>
          </div>
          <label className="mt-4 block">
            <span className={labelText}>Biệt danh</span>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={inputClass} />
          </label>
          <label className="mt-3 block">
            <span className={labelText}>Số điện thoại</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </label>
          <button type="submit" className={`${primaryBtn} mt-4`}>
            Lưu hồ sơ
          </button>
        </form>

        {/* Change password */}
        {me?.provider === "email" && (
          <form onSubmit={changePassword} className={sectionClass}>
            <h3 className="mb-3 font-display text-lg font-bold">Đổi mật khẩu</h3>
            <label className="block">
              <span className={labelText}>Mật khẩu hiện tại</span>
              <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} className={inputClass} />
            </label>
            <label className="mt-3 block">
              <span className={labelText}>Mật khẩu mới</span>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} className={inputClass} />
            </label>
            <label className="mt-3 block">
              <span className={labelText}>Nhập lại mật khẩu mới</span>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputClass} />
            </label>
            <button type="submit" className={`${primaryBtn} mt-4`}>
              Đổi mật khẩu
            </button>
          </form>
        )}

        {/* Organizer */}
        <div className={sectionClass}>
          <h3 className="mb-3 font-display text-lg font-bold">Nhà tổ chức</h3>
          {isOrganizer ? (
            <div className="space-y-3">
              <p className="text-sm text-la-co">Bạn đã là nhà tổ chức đã được duyệt.</p>
              <button type="button" onClick={onManageEvents} className={primaryBtn}>
                Quản lý sự kiện
              </button>
            </div>
          ) : orgStatus === "pending" ? (
            <p className="text-sm text-beige-kem/70">Đơn của bạn đang chờ admin duyệt.</p>
          ) : orgStatus === "suspended" ? (
            <p className="text-sm text-beige-kem/70">Tài khoản nhà tổ chức đang bị đình chỉ.</p>
          ) : (
            <form onSubmit={applyOrganizer}>
              {orgStatus === "rejected" && (
                <p className="mb-3 text-xs text-beige-kem/60">Đơn trước bị từ chối. Bạn có thể chỉnh sửa và gửi lại.</p>
              )}
              <label className="block">
                <span className={labelText}>Tên hiển thị</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className={inputClass} />
              </label>
              <label className="mt-3 block">
                <span className={labelText}>Mô tả</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={3}
                  className="w-full rounded-xl border border-beige-kem/20 bg-white/[0.035] px-4 py-2.5 text-sm text-beige-kem outline-none focus:border-cam-dat"
                />
              </label>
              <button type="submit" className={`${primaryBtn} mt-4`}>
                Gửi đơn đăng ký
              </button>
            </form>
          )}
        </div>

        <button
          onClick={onLogout}
          className="w-full rounded-xl border border-beige-kem/15 px-4 py-3 text-sm font-bold text-beige-kem/80 transition hover:border-cam-dat hover:text-beige-kem"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
