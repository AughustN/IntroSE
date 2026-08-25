// Frontend auth data layer. The access token lives in memory only (never localStorage — FR-016);
// the refresh token is the httpOnly cookie.

import type {
  AuthSuccess,
  ChangePasswordBody,
  ForgotBody,
  LoginBody,
  Me,
  RegisterBody,
  ResetBody,
  UpdateMeBody,
} from "@/shared/auth/types";
import { apiAssetUrl, apiUrl } from "./api";
import { readApiError } from "./apiError";

/** Mirrors `OrganizerApplication` as GET /api/organizers/me returns it (newest first). */
export interface OrganizerApplicationView {
  id: number;
  status: "pending" | "approved" | "rejected" | "suspended";
  display_name: string;
  description: string | null;
  review_note: string | null;
  applied_at: string;
}

export interface OrganizerStatusResponse {
  isOrganizer: boolean;
  applications: OrganizerApplicationView[];
}

let accessToken: string | null = null;
export const getAccessToken = (): string | null => accessToken;
const setToken = (t: string | null): void => {
  accessToken = t;
};

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    public userMessage?: string,
  ) {
    super(userMessage ?? code);
  }
}

type Options = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
};

async function raw(path: string, opts: Options = {}): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(apiUrl(`/api${path}`), {
    method: opts.method ?? "GET",
    headers,
    credentials: "include", // send/receive the tix_refresh cookie
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function normalizeMe(user: Me): Me {
  return { ...user, avatarUrl: apiAssetUrl(user.avatarUrl) };
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await readApiError(res);
    throw new ApiClientError(res.status, err.code, err.message);
  }
  return (res.status === 204 ? null : await res.json().catch(() => null)) as T;
}

// ---- single-flight refresh (R-12: one in-flight /refresh; concurrent callers await it) ----

let refreshing: Promise<boolean> | null = null;

function doRefresh(): Promise<boolean> {
  if (!refreshing) {
    const key = crypto.randomUUID();
    refreshing = raw("/auth/refresh", { method: "POST", headers: { "x-idempotency-key": key } })
      .then(async (res) => {
        if (!res.ok) {
          setToken(null);
          return false;
        }
        const body = (await res.json()) as AuthSuccess;
        setToken(body.accessToken);
        return true;
      })
      .catch(() => {
        setToken(null);
        return false;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** Authenticated request that transparently refreshes once on a 401. */
async function authed<T>(path: string, opts: Options = {}): Promise<T> {
  return parse<T>(await withAuthRetry(() => raw(path, { ...opts, auth: true })));
}

/**
 * Same refresh-once-on-401 behaviour, exposed for the other data layers (catalog, holds).
 *
 * The access token is short-lived and in memory, so any screen a user can sit on for a while — the
 * seat map above all — will eventually send a stale one. Without this, that reads to the user as
 * "please sign in" while their refresh cookie is still perfectly valid.
 */
export async function withAuthRetry(
  send: (token: string | null) => Promise<Response>,
): Promise<Response> {
  let res = await send(accessToken);
  if (res.status === 401 && (await doRefresh())) res = await send(accessToken);
  return res;
}

// ---- public API (mirrors contracts/auth.openapi.yaml) ----

export const authClient = {
  async register(body: RegisterBody): Promise<Me> {
    const data = await parse<AuthSuccess>(await raw("/auth/register", { method: "POST", body }));
    setToken(data.accessToken);
    return normalizeMe(data.user);
  },

  async login(body: LoginBody): Promise<Me> {
    const data = await parse<AuthSuccess>(await raw("/auth/login", { method: "POST", body }));
    setToken(data.accessToken);
    return normalizeMe(data.user);
  },

  async loginWithGoogle(credential: string): Promise<Me> {
    const data = await parse<AuthSuccess>(
      await raw("/auth/oauth/google", { method: "POST", body: { credential } }),
    );
    setToken(data.accessToken);
    return normalizeMe(data.user);
  },

  async logout(): Promise<void> {
    await authed<void>("/auth/logout", { method: "POST" });
    setToken(null);
  },

  async logoutAll(): Promise<void> {
    await authed<void>("/auth/logout-all", { method: "POST" });
    setToken(null);
  },

  /** Restore a session on page load using the refresh cookie. Returns null if not signed in. */
  async restore(): Promise<Me | null> {
    if (!(await doRefresh())) return null;
    return authClient.me();
  },

  me(): Promise<Me> {
    return authed<Me>("/me").then(normalizeMe);
  },

  async forgotPassword(body: ForgotBody): Promise<void> {
    // Always a uniform 200 (unless rate-limited); nothing to read.
    await raw("/auth/password/forgot", { method: "POST", body });
  },

  async resetPassword(body: ResetBody): Promise<void> {
    await parse<{ ok: true }>(await raw("/auth/password/reset", { method: "POST", body }));
  },

  changePassword(body: ChangePasswordBody): Promise<void> {
    return authed<void>("/me/password", { method: "POST", body });
  },

  updateProfile(body: UpdateMeBody): Promise<Me> {
    return authed<Me>("/me", { method: "PATCH", body });
  },

  async uploadAvatar(file: File): Promise<Me> {
    const send = () => {
      const fd = new FormData();
      fd.append("file", file);
      const headers: Record<string, string> = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      return fetch(apiUrl("/api/me/avatar"), {
        method: "POST",
        headers,
        credentials: "include",
        body: fd,
      });
    };
    let res = await send();
    if (res.status === 401 && (await doRefresh())) res = await send();
    return normalizeMe(await parse<Me>(res));
  },

  applyOrganizer(body: {
    displayName: string;
    description: string;
    logoUrl?: string | null;
  }): Promise<{ ok: true }> {
    return authed<{ ok: true }>("/organizers/apply", { method: "POST", body });
  },

  organizerStatus(): Promise<OrganizerStatusResponse> {
    return authed("/organizers/me");
  },
};
