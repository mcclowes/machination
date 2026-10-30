/**
 * ---
 * purpose: Fetch an account's operations from the configured server.
 * ---
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationListing } from '../contracts/protocol';
import type { AccountAccess } from './account-auth';
import { DEFAULT_GAME_SERVER } from './client';
import { accountOperationsApi } from './network';

export function useAccountOperations(account: AccountAccess | null | undefined) {
  const [operations, setOperations] = useState<OperationListing[]>();
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    if (!account) return;
    const started = ++sequence.current;
    setError('');
    // Account requests authorize with a fresh session token, so no device credential is sent.
    accountOperationsApi({ url: DEFAULT_GAME_SERVER, token: '', ...account })
      .then((next) => sequence.current === started && setOperations(next))
      .catch((e: Error) => sequence.current === started && setError(e.message));
  }, [account]);
  useEffect(() => {
    refresh();
    return () => { sequence.current++; };
  }, [refresh]);
  return { operations: account ? operations : undefined, error, refresh };
}
