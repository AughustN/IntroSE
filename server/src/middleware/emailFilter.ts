import type { Request, Response, NextFunction } from 'express';
import { isEmail } from '../modules/auth/identifier.js';

// Common disposable / burner email domains
const FALLBACK_DISPOSABLE_DOMAINS = new Set<string>([
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'mailinator.com',
  'sharklasers.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'discard.email',
  'getairmail.com',
  'dispostable.com',
  'trashmail.com',
  'trashmail.net',
  'temp-mail.org',
  'throwawaymail.com',
  'fakemailgenerator.com',
  'mohmal.com',
  'burnermail.io',
  'generator.email',
  'crazymailing.com',
  'maildrop.cc',
  'nada.ltd',
  'inboxkitten.com',
]);

let disposableDomainsSet = FALLBACK_DISPOSABLE_DOMAINS;

// Dynamically import disposable-email-domains package if available
try {
  const mod = await import('disposable-email-domains');
  const domainsList = (mod.default || mod) as unknown as string[];
  if (Array.isArray(domainsList) && domainsList.length > 0) {
    disposableDomainsSet = new Set([...FALLBACK_DISPOSABLE_DOMAINS, ...domainsList]);
  }
} catch {
  // Use fallback list
}

/**
 * Checks whether a given domain (e.g. "mailinator.com") is a disposable temporary provider
 */
export function isDisposableEmailDomain(domain: string): boolean {
  const lower = domain.trim().toLowerCase();
  return disposableDomainsSet.has(lower);
}

/**
 * Checks whether an email address is from a disposable email domain
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || !isEmail(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1].toLowerCase();
  return isDisposableEmailDomain(domain);
}

/**
 * Express middleware to reject requests containing disposable email in req.body.email
 */
export function requireNonDisposableEmail(req: Request, res: Response, next: NextFunction) {
  const email = req.body?.email;
  if (typeof email === 'string' && isDisposableEmail(email)) {
    return res.status(400).json({
      error: 'disposable_email_rejected',
      message: 'Địa chỉ email tạm thời / rác không được chấp nhận. Vui lòng sử dụng email chính thức.',
    });
  }
  next();
}
