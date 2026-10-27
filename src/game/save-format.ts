/**
 * ---
 * purpose: Validate versioned local snapshots before they reach the simulation or replace saved progress.
 * ---
 */
import { type Game, type Faction, createGame } from './simulation';
export type Save = { savedAt: number; game: Game };
const factions: unknown[] = ['you', 'vesper', 'null'];
const isFaction = (v: unknown): v is Faction => factions.includes(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function decodeSave(raw: string): Save {
  const fail = () => { throw new Error('This save is damaged or belongs to an unsupported version. Reset the operation to start again.'); };
  let save: unknown;
  try { save = JSON.parse(raw); } catch { return fail(); }
  if (!record(save) || !nonnegative(save.savedAt) || !record(save.game)) return fail();
  const g = save.game;
  const base = createGame(0);
  if (g.version !== 1 || !nonnegative(g.hour) || !nonnegative(g.epoch) || !Number.isInteger(g.nextId) || (g.nextId as number) < 1
    || !record(g.cargo) || !factions.every(f => nonnegative((g.cargo as Record<string, unknown>)[f as string]))
    || !Array.isArray(g.eliminated) || !g.eliminated.every(isFaction) || new Set(g.eliminated).size !== g.eliminated.length
    || !(g.winner === null || isFaction(g.winner))
    || !Array.isArray(g.rocks) || g.rocks.length !== base.rocks.length
    || !Array.isArray(g.fleets) || !Array.isArray(g.events) || g.events.length > 80) return fail();
  const ids = new Set<string>();
  for (const r of g.rocks) {
    if (!record(r) || typeof r.id !== 'string' || ids.has(r.id) || !base.rocks.some(b => b.id === r.id)
      || typeof r.name !== 'string' || !finite(r.x) || !finite(r.y) || !nonnegative(r.drones)
      || !(r.owner === null || isFaction(r.owner)) || !['core', 'reactor', 'mine'].includes(r.kind as string)
      || !(r.coreOf === undefined || isFaction(r.coreOf))) return fail();
    ids.add(r.id);
  }
  const fleetIds = new Set<number>();
  for (const f of g.fleets) {
    if (!record(f) || !Number.isInteger(f.id) || (f.id as number) < 1 || (f.id as number) >= (g.nextId as number) || fleetIds.has(f.id as number)
      || !isFaction(f.owner) || g.eliminated.includes(f.owner) || !ids.has(f.from as string) || !ids.has(f.to as string) || f.from === f.to
      || !Number.isInteger(f.drones) || (f.drones as number) < 1 || !nonnegative(f.departed) || f.departed > g.hour
      || !finite(f.arrives) || f.arrives <= g.hour || f.arrives <= f.departed) return fail();
    fleetIds.add(f.id as number);
  }
  if (!g.events.every(e => record(e) && nonnegative(e.hour) && e.hour <= (g.hour as number) && typeof e.message === 'string')) return fail();
  return save as Save;
}
