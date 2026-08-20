import { config } from '../config.js';
import type { TurnstileVerifyResponse } from '../../../shared/types/botDefense.js';

export interface VerifyTurnstileResult {
  success: boolean;
  errorCodes?: string[];
  bypassed?: boolean;
}

/**
 * Verifies a Cloudflare Turnstile token against the Cloudflare siteverify endpoint.
 *
 * Rules:
 * 1. If token is empty and fail-open is disabled, fails immediately.
 * 2. If config.turnstileFailOpen is true, logs an emergency audit warning and allows the request.
 * 3. Enforces a 2500ms timeout.
 * 4. Fails closed (returns success: false) on network error, invalid response, or timeout.
 */
export async function verifyTurnstile(
  token?: string | null,
  remoteIp?: string,
): Promise<VerifyTurnstileResult> {
  // If emergency fail-open bypass is activated
  if (config.turnstileFailOpen) {
    console.warn('[SECURITY WARNING] Cloudflare Turnstile FAIL_OPEN is active. Bypassing verification.');
    return { success: true, bypassed: true };
  }

  // In test environment or development, accept test/mock tokens gracefully
  if (config.isTest || config.nodeEnv === 'development') {
    if (token && (token.startsWith('test-') || token.startsWith('0.') || token.startsWith('mock-') || token === 'mock-turnstile-token')) {
      return { success: true };
    }
  }

  // If secret key is not configured (e.g. local unit tests without Turnstile credentials)
  if (!config.turnstileSecretKey) {
    if (config.isProd) {
      console.error('[SECURITY ERROR] TURNSTILE_SECRET_KEY is not configured in production.');
      return { success: false, errorCodes: ['secret_key_missing'] };
    }
    return { success: Boolean(token) };
  }

  if (!token || typeof token !== 'string' || token.trim() === '') {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const formData = new URLSearchParams();
    formData.append('secret', config.turnstileSecretKey);
    formData.append('response', token);
    if (remoteIp) {
      formData.append('remoteip', remoteIp);
    }

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[turnstile] Verify endpoint returned HTTP ${response.status}`);
      return { success: false, errorCodes: [`http_${response.status}`] };
    }

    const data = (await response.json()) as TurnstileVerifyResponse;
    if (data.success === true) {
      return { success: true };
    }

    return {
      success: false,
      errorCodes: data['error-codes'] ?? ['verification_failed'],
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.error(`[turnstile] Verification request failed: ${isAbort ? 'Timeout (2500ms)' : (err as Error).message}`);
    return {
      success: false,
      errorCodes: [isAbort ? 'timeout' : 'network_error'],
    };
  }
}
