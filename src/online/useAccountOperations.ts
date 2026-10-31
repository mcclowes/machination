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
  const sequence = useRef({ value: 0 });
  const refresh = useCallback(() => {
    if (!account) return;
    const started = ++sequence.current.value;
    setError('');
    // Account requests authorize with a fresh session token, so no device credential is sent.
    accountOperationsApi({ url: DEFAULT_GAME_SERVER, token: '', ...account })
      .then((next) => sequence.current.value === started && setOperations(next))
      .catch((e: Error) => sequence.current.value === started && setError(e.message));
  }, [account]);
  useEffect(() => {
    const pending = sequence.current;
    refresh();
    return () => { pending.value++; };
  }, [refresh]);
  return { operations: account ? operations : undefined, error, refresh };
}
