import type { Me } from '@shared/auth/types.js';

// Server-established identity, attached by requireAuth. Clients never assert it.
declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: number; familyId: string; user: Me };
  }
}
