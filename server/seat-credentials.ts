/**
 * Hash and compare seat credentials without owning authentication effects or game state.
 *
 * @format
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Room } from './database';
import { requireThat } from './failure';

export type AccountCredential = { accountId: string };
export type Credential = string | AccountCredential;
export const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export const matchesHash = (expected: string | undefined, actual: string) =>
  expected !== undefined &&
  timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));

export function credentialHash(token: Credential): string {
  if (typeof token !== 'string') {
    requireThat(
      /^user_[a-zA-Z0-9]+$/.test(token.accountId),
      401,
      'account.unauthorized.identity',
      'A valid account is required.',
    );
    return hash(`clerk:${token.accountId}`);
  }
  requireThat(
    /^[a-f0-9]{64}$/.test(token),
    401,
    'seat.unauthorized.token',
    'A valid seat token is required.',
  );
  return hash(token);
}
export function matchesCredential(seat: Room['seats'][number], token: Credential): boolean {
  const credential = credentialHash(token);
  return typeof token === 'string'
    ? !seat.accountId && seat.hash === credential
    : seat.accountId === token.accountId;
}
