/** Validate temporal clocks and private intelligence without upgrading older operation rules. */
import type { Faction, Game } from './simulation';
import { TEMPORAL, temporalEnabled } from './temporal';
import { playersIn } from './players';
import { MAX_STORED_EVENTS } from './events';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const shape = (v: object, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
export function validTemporalSave(game: Game): boolean {
  const enabled = temporalEnabled(game), factions = playersIn(game);
  for (const asset of [...game.rocks, ...game.fleets]) for (const u of asset.specialists ?? []) if (u.temporalReadyAt !== undefined
    && (!enabled || !['anchor', 'overclock'].includes(u.kind) || !finite(u.temporalReadyAt))) return false;
  for (const rock of game.rocks) {
    if (rock.anchorReadyAt !== undefined && (!enabled || !finite(rock.anchorReadyAt))) return false;
    if (rock.stasisUntil !== undefined && (!enabled || !finite(rock.stasisUntil) || rock.stasisUntil <= game.hour || rock.stasisUntil > game.hour + TEMPORAL.stasisHours)) return false;
    if (rock.productionPausedUntil !== undefined && (!enabled || !finite(rock.productionPausedUntil))) return false;
    const loan = rock.overclock;
    if (loan !== undefined && (!enabled || !record(loan) || !shape(loan, ['boostUntil', 'debtUntil', ...(loan.repaying === undefined ? [] : ['repaying'])])
      || !finite(loan.boostUntil) || !finite(loan.debtUntil) || loan.debtUntil <= game.hour || loan.debtUntil <= loan.boostUntil
      || !(loan.repaying === undefined || loan.repaying === true) || !!loan.repaying !== (loan.boostUntil <= game.hour))) return false;
  }
  for (const fleet of game.fleets) if (fleet.heldAt !== undefined) {
    const site = game.rocks.find(r => r.id === fleet.heldAt);
    if (!enabled || !site || fleet.to !== site.id || !site.stasisUntil || fleet.arrives !== site.stasisUntil || fleet.preparing) return false;
  }
  const intel = game.temporalIntel;
  if (intel !== undefined) {
    if (!enabled || !record(intel) || !shape(intel, ['pending', 'warnings']) || !Array.isArray(intel.pending) || !Array.isArray(intel.warnings)
      || intel.pending.length > MAX_STORED_EVENTS || intel.warnings.length > 10000) return false;
    if (!intel.pending.every(p => record(p) && shape(p, ['owner', 'occurredAt', 'discoverAt', 'message']) && factions.includes(p.owner as Faction)
      && finite(p.occurredAt) && p.occurredAt <= game.hour && finite(p.discoverAt) && p.discoverAt === p.occurredAt + TEMPORAL.hindsightDelay
      && p.discoverAt > game.hour && typeof p.message === 'string' && p.message.length <= 2000)) return false;
    if (!intel.warnings.every(w => record(w) && shape(w, ['owner', 'specialistId', 'deathAt', 'source']) && factions.includes(w.owner as Faction)
      && typeof w.specialistId === 'string' && [...game.rocks, ...game.fleets].some(a => a.specialists?.some(u => u.id === w.specialistId && u.owner === w.owner))
      && finite(w.deathAt) && w.deathAt > game.hour && w.deathAt <= game.hour + TEMPORAL.foresightHorizon && typeof w.source === 'string' && w.source.length <= 2000)) return false;
  }
  return game.events.every(e => e.discoveredAt === undefined || enabled && finite(e.discoveredAt) && e.discoveredAt >= e.hour && e.discoveredAt <= game.hour);
}
