/**
 * ---
 * purpose: Verify shared Clerk session tokens before they can authorize multiplayer seats.
 * related:
 *   - ./http.ts - authentication at the HTTP boundary
 * ---
 */
import { verifyToken } from '@clerk/backend';
import type { AccountCredential } from './service';
import { Failure } from './failure';

export type AccountAuthentication = (token: string, origin?: string) => Promise<AccountCredential>;
type Configuration = { CLERK_SECRET_KEY?: string; CLERK_JWT_KEY?: string; CLERK_ISSUER?: string };
export function clerkAuthentication(env: Configuration, authorizedParties: string[]): AccountAuthentication | undefined {
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  const jwtKey = env.CLERK_JWT_KEY?.replace(/\\n/g, '\n').trim();
  const issuer = env.CLERK_ISSUER?.trim();
  if (!secretKey && !jwtKey && !issuer) return undefined;
  if ((!secretKey && !jwtKey) || !issuer || !authorizedParties.length) throw new Error('Clerk requires CLERK_ISSUER, CLERK_SECRET_KEY or CLERK_JWT_KEY, and allowed browser origins.');
  const url = new URL(issuer);
  if (url.protocol !== 'https:' || url.origin !== issuer) throw new Error('CLERK_ISSUER must be an HTTPS origin.');
  return async (token, origin) => {
    try {
      // Native sessions may omit azp; browser sessions must match their Origin.
      const claims = await verifyToken(token, { secretKey, jwtKey, issuer });
      if (!/^user_[a-zA-Z0-9]+$/.test(claims.sub) || typeof claims.sid !== 'string' || !claims.sid.startsWith('sess_') || claims.sts === 'pending'
        || claims.azp !== undefined && !authorizedParties.includes(claims.azp) || origin && claims.azp !== origin) throw new Error('Invalid session.');
      return { accountId: claims.sub };
    } catch { throw new Failure(401, 'account.unauthorized.session', 'Sign in to your Machination account again.'); }
  };
}
