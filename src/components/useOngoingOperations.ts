/**
 * ---
 * purpose: Gather resumable solo and multiplayer operations so the start screen can offer quick access.
 * ---
 */
import { useEffect, useState } from 'react';
import type { OperationListing } from '../contracts/protocol';
import type { OperationSummary } from '../game/operation-save';
import { peekGame } from '../solo/storage';
import { hasStoredOperation } from '../online/client';
import { useAccountAccess } from '../online/MultiplayerAccount';
import { useAccountOperations } from '../online/useAccountOperations';

export type OngoingOperations = {
  solo: OperationSummary | null;
  /** Active account operations, newest first. */
  multiplayer: OperationListing[];
  /** A device-token seat with no account listing. */
  deviceSeat: boolean;
};

export function useOngoingOperations(): OngoingOperations {
  const account = useAccountAccess();
  const { operations } = useAccountOperations(account);
  const [solo, setSolo] = useState<OperationSummary | null>(null);
  const [deviceSeat, setDeviceSeat] = useState(false);
  useEffect(() => {
    let active = true;
    void peekGame()
      .catch(() => null)
      .then((summary) => active && setSolo(summary?.status === 'active' ? summary : null));
    void hasStoredOperation().then((held) => active && setDeviceSeat(held));
    return () => { active = false; };
  }, []);
  return {
    solo,
    multiplayer: operations?.filter((o) => o.status === 'active') ?? [],
    deviceSeat: !account && deviceSeat,
  };
}
