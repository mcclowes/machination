/**
 * ---
 * purpose: Glance at locally held solo and multiplayer operations so the start screen can offer to resume them.
 * ---
 */
import { useEffect, useState } from 'react';
import type { OperationSummary } from '../game/operation-save';
import { peekGame } from '../solo/storage';
import { hasStoredOperation } from '../online/client';
import { useAccountId } from '../online/MultiplayerAccount';

export type OngoingOperations = { solo: OperationSummary | null; multiplayer: boolean };

export function useOngoingOperations(): OngoingOperations {
  const accountId = useAccountId();
  const [solo, setSolo] = useState<OperationSummary | null>(null);
  const [multiplayer, setMultiplayer] = useState(false);
  useEffect(() => {
    let active = true;
    void peekGame()
      .catch(() => null)
      .then((summary) => active && setSolo(summary?.status === 'active' ? summary : null));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (accountId === undefined) return;
    let active = true;
    void hasStoredOperation(accountId ?? undefined).then((held) => active && setMultiplayer(held));
    return () => { active = false; };
  }, [accountId]);
  return { solo, multiplayer };
}

const MODE_NAMES = { pulse: 'King’s Pulse', mining: 'Mining', domination: 'Domination' } as const;
export function describeSolo({ hour, rivals, mode }: OperationSummary): string {
  return [`Hour ${Math.floor(hour)}`, `${rivals} ${rivals === 1 ? 'rival' : 'rivals'}`, mode && MODE_NAMES[mode]]
    .filter(Boolean)
    .join(' · ');
}
