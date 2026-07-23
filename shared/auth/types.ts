// One typed contract shared by server and web (Constitution Principle VI).
// Derived from src/specs/001-account-auth/contracts/auth.openapi.yaml.

export type Provider = 'email' | 'google';
export type AccountStatus = 'active' | 'suspended';

/** Current account, as returned by GET /api/me and inside AuthSuccess. */
export interface Me {
  id: number;
  email: string;
  phone: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  status: AccountStatus;
  provider: Provider;
  /** Derived per request from an approved organizers row. */
  isOrganizer: boolean;
}

/** Body of a successful sign-in / register / refresh. The refresh token itself
 *  travels in an httpOnly cookie, never in this body. */
export interface AuthSuccess {
  accessToken: string;
  user: Me;
}

/** Uniform error shape for every failing endpoint. */
export interface ApiError {
  error: AuthErrorCode | string;
  /** Vietnamese, user-facing. */
  message?: string;
}

/** Stable machine codes the frontend switches on. */
export type AuthErrorCode =
  | 'validation_failed'
  | 'password_mismatch'
  | 'weak_password'
  | 'email_taken'
  | 'phone_taken'
  | 'email_registered_with_google'
  | 'email_registered_with_password'
  | 'invalid_credentials'
  | 'account_suspended'
  | 'account_uses_google'
  | 'invalid_or_revoked_session'
  | 'session_expired'
  | 'invalid_session'
  | 'session_revoked'
  | 'invalid_or_expired_token'
  | 'unauthenticated'
  | 'wrong_current_password'
  | 'invalid_image'
  | 'file_too_large'
  | 'already_pending'
  | 'already_approved'
  | 'suspended_cannot_reapply'
  | 'invalid_google_credential'
  | 'rate_limited';

// ---- Request bodies (email/password flows) ----

export interface RegisterBody {
  email: string;
  password: string;
  passwordConfirm: string;
  nickname: string;
  phone?: string | null;
}

export interface LoginBody {
  /** email OR phone, classified server-side. */
  identifier: string;
  password: string;
}

export interface ForgotBody {
  email: string;
}

export interface ResetBody {
  token: string;
  password: string;
  passwordConfirm: string;
}

export interface UpdateMeBody {
  nickname?: string;
  phone?: string | null;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
}
