/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApiClientError } from "../../services/authClient";

/**
 * Vietnamese, user-facing text for a failed call. `ApiClientError.message` falls back to the raw
 * error code when the server sent no message, which is not something to show a buyer — so an
 * error without `userMessage` gets a generic line instead.
 */
export function errorMessage(e: unknown, fallback = "Có lỗi xảy ra, vui lòng thử lại."): string {
  if (e instanceof ApiClientError && e.userMessage) return e.userMessage;
  return fallback;
}
