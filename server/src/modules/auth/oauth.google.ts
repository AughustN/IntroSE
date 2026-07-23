import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config.js';

export interface GoogleIdentity {
  sub: string; // stable provider subject id — the account is keyed on this, not email (FR-025)
  email: string;
  name?: string;
  picture?: string;
}

const client = new OAuth2Client(config.googleClientId);

// Exposed as an object so tests can spy on `verify` without a live Google token.
export const googleVerifier = {
  async verify(credential: string): Promise<GoogleIdentity> {
    if (!config.googleClientId) throw new Error('google_not_configured');
    const ticket = await client.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('invalid_google_payload');
    return { sub: p.sub, email: p.email.toLowerCase(), name: p.name, picture: p.picture };
  },
};
