/**
 * ---
 * purpose: Short one-line descriptions of solo saves and multiplayer listings for menus.
 * ---
 */
import type { OperationListing } from '../contracts/protocol';
import type { OperationSummary } from '../game/operation-save';

const MODE_NAMES = { pulse: 'King’s Pulse', mining: 'Mining', domination: 'Domination' } as const;
const RESULTS = { victory: 'Victory', defeat: 'Defeat', eliminated: 'Eliminated', draw: 'Draw' } as const;
const hourOf = (hour: number) => Math.floor(hour);

export function describeListing({ mode, players, seated, started, hour, status }: OperationListing): string {
  const progress =
    status !== 'active'
      ? `${RESULTS[status]} at hour ${hourOf(hour)}`
      : started
        ? `Hour ${hourOf(hour)} · ${players} players`
        : `Waiting for players ${seated}/${players}`;
  return `${MODE_NAMES[mode]} · ${progress}`;
}

export function describeSolo({ hour, rivals, mode }: OperationSummary): string {
  return [`Hour ${hourOf(hour)}`, `${rivals} ${rivals === 1 ? 'rival' : 'rivals'}`, mode && MODE_NAMES[mode]]
    .filter(Boolean)
    .join(' · ');
}
