/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** The API answered, but with something that is not the API's own error shape. */
export const API_UNREACHABLE = "api_unreachable";

export const API_UNREACHABLE_MESSAGE =
  "Không kết nối được máy chủ. Kiểm tra API đã chạy chưa (npm run dev:server).";

export interface ApiErrorBody {
  code: string;
  message?: string;
  details?: Record<string, number | string>;
}

/**
 * Reads a failed response, telling "the API refused" apart from "the API was never reached".
 *
 * Every client here used to do `res.json().catch(() => ({}))` and then fall back to a generic
 * string. That collapses two very different situations into one unhelpful message: a real refusal
 * carries `{ error, message }` and deserves its own wording, while an unreachable backend produces
 * no JSON at all and used to surface as "Có lỗi xảy ra, vui lòng thử lại." — which sent us looking
 * for a bug in Google OAuth when the API simply was not running.
 *
 * The tell is a 5xx whose body will not parse as JSON. Vite's dev proxy answers a refused upstream
 * connection with an empty `text/plain` 500; Nginx answers with an HTML 502. Neither is the API
 * speaking, so both are reported as unreachable.
 */
/** The error envelope every endpoint in this API returns. */
interface RawErrorBody {
  error?: string;
  message?: string;
  details?: Record<string, unknown>;
}

/** One per-seat refusal from the server's `409 map_edit_refused` body (`details.refusals`). */
export interface ApplyRefusalView {
  reason: string;
  showtimeSeatId?: number;
  seatLabel?: string;
  message?: string;
}

/** An edit the API refused WHOLE, carrying the per-seat reasons it refused for. */
export class RefusedEditError extends Error {
  readonly code = "map_edit_refused";
  readonly refusals: ApplyRefusalView[];
  constructor(message: string, refusals: ApplyRefusalView[]) {
    super(message);
    this.name = "RefusedEditError";
    this.refusals = refusals;
  }
}

export async function readApiError(res: Response): Promise<ApiErrorBody> {
  const text = await res.text().catch(() => "");

  let body: RawErrorBody | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as RawErrorBody;
    } catch {
      // Not JSON — handled below.
    }
  }

  if (!body && res.status >= 500) {
    return { code: API_UNREACHABLE, message: API_UNREACHABLE_MESSAGE };
  }

  return {
    code: body?.error ?? "error",
    message: body?.message,
    // The wire type is open (refusals are an array), but every scalar consumer here narrows to
    // number|string; the structured exception `RefusedEditError` carries anything richer.
    details: body?.details as ApiErrorBody["details"],
  };
}
