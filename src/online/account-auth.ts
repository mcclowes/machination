export type AccountAccess = { accountId: string; getToken: () => Promise<string | null> };
export type RequestSession = { url: string; token: string; accountId?: string; getToken?: () => Promise<string | null> };

/** Fetch a fresh Clerk token per request; never fall back to a device credential for an account seat. */
export async function authorization(session: RequestSession): Promise<string> {
  if (!session.accountId) return `Bearer ${session.token}`;
  const token = await session.getToken?.();
  if (!token) throw new Error('Sign in to your Marginal Utility account again.');
  return `Bearer ${token}`;
}
