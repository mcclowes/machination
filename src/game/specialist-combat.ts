/**
 * ---
 * purpose: Specialist-aware site arrivals, combat outcomes, capture, and core succession.
 * ---
 */
import { reconcilePulseKings } from './pulse';
import { afterWork } from './opening-clock';
import { mechanicsVersion } from './rules';
import { worldDistance } from './geometry';
import { playersIn } from './players';
import { sendUnitsHome, returnHauler } from './specialist-travel';
import { applyCombatAbilities } from './combat-abilities';
import type { Faction, Fleet, Game, Rock } from './simulation';
import { fleetPosition } from './flight';
import { maximumShield, absorbShields, droneInventory, powerCapacity } from './economy';
import { reconcileFunding } from './funding';
import { loseMine, MINING_DAY } from './mining';
import { activeUnits, restoreControl, unitCount, type Specialist } from './specialists';
import { refreshUnitEffects } from './specialist-effects';
import { defendWithPreparations } from './transport';
import { observers } from './sensors';
import { emitEncounter, snapshotAsset, startEncounter, type EncounterDraft, type EncounterKind, type EncounterOutcome, type EncounterSink } from './combat-report';

type Asset = Rock | Fleet;
const isRock = (asset: Asset): asset is Rock => typeof asset.id === 'string';
const living = (asset: Asset) => (asset.specialists ?? []).filter(u => !u.captive && u.owner === asset.owner);
export function reconcileLeadership(game: Game, previous: readonly (Faction | { owner: Faction; point: { x: number; y: number } })[], point: { x: number; y: number }): void {
  if (game.pulse) { reconcilePulseKings(game); refreshUnitEffects(game); return; }
  for (const entry of previous) {
    const owner = typeof entry === 'string' ? entry : entry.owner;
    const lostAt = typeof entry === 'string' ? point : entry.point;
    if (game.eliminated.includes(owner) || activeUnits(game, owner).some(u => u.kind === 'queen')) continue;
    const candidates = [
      ...game.rocks.filter(r => r.owner === owner).flatMap(r => (r.specialists ?? []).filter(u => u.owner === owner && !u.captive && u.kind === 'princess').map(unit => ({ unit, point: r }))),
      ...game.fleets.filter(f => f.owner === owner).flatMap(f => (f.specialists ?? []).filter(u => u.owner === owner && !u.captive && u.kind === 'princess').map(unit => ({ unit, point: fleetPosition(game, f) }))),
    ].sort((a, b) => worldDistance(game, a.point, lostAt) - worldDistance(game, b.point, lostAt) || a.unit.id.localeCompare(b.unit.id));
    if (candidates[0]) {
      candidates[0].unit.kind = 'queen';
      game.events.unshift({ hour: game.hour, audience: [owner], message: 'Fallback core promoted. Operational control preserved.' });
    } else {
      game.eliminated.push(owner); game.cargo[owner] = 0;
      game.scheduled = (game.scheduled ?? []).filter(p => p.owner !== owner);
      for (const rock of game.rocks.filter(r => r.owner === owner)) defendWithPreparations(game, rock.id);
      game.events.unshift({ hour: game.hour, audience: [...playersIn(game)], message: `${owner}: core lost. Orders and extraction terminated; remaining assets persist.` });
    }
  }
  refreshUnitEffects(game);
}
const newlyCaptive = (units: readonly Specialist[], owner: Faction) => units.filter(u => u.owner !== owner && !u.captive).map(u => u.id);
const presence = (game: Game, asset: Asset) => isRock(asset) || game.fleets.includes(asset) ? snapshotAsset(asset) : null;
function finish(sink: EncounterSink | undefined, draft: EncounterDraft | undefined, game: Game, outcome: EncounterOutcome, a: Asset, b: Asset): void {
  if (!sink || !draft) return;
  draft.outcome = outcome; draft.after = [presence(game, a), presence(game, b)];
  emitEncounter(sink, draft);
}
function capture(game: Game, units: Specialist[], owner: Faction): Specialist[] {
  for (const unit of units) { if (unit.owner === owner) restoreControl(game, unit, owner, units); else unit.captive = true; }
  return units;
}
function excessGiftDrones(game: Game, owner: Faction, incoming: number): number {
  const existing = droneInventory(game, owner) - incoming;
  const accepted = Math.max(0, Math.min(incoming, powerCapacity(game, owner) - existing));
  return incoming - accepted;
}
function log(game: Game, point: { x: number; y: number }, owners: (Faction | null)[], message: string): void {
  game.events.unshift({ hour: game.hour, audience: [...new Set([...owners.filter((o): o is Faction => !!o), ...observers(game, point)])], message });
}
export function resolveStationArrival(game: Game, fleet: Fleet, rock: Rock, encounters?: EncounterSink): void {
  const leaders = coreLocations(game);
  const draft = encounters && { ...startEncounter('arrival', game.hour, fleet, rock), site: rock.id };
  if (rock.destroyed) { returnHauler(game, fleet); finish(encounters, draft, game, 'returned', fleet, rock); return; }
  const donor = fleet.owner;
  if (fleet.giftAt !== undefined && fleet.giftAt <= game.hour && rock.owner) {
    fleet.owner = rock.owner;
    for (const unit of fleet.specialists ?? []) restoreControl(game, unit, fleet.owner, fleet.specialists);
  }
  if (fleet.owner === rock.owner) {
    game.fleets = game.fleets.filter(f => f.id !== fleet.id);
    rock.drones += fleet.drones;
    rock.specialists = [...(rock.specialists ?? []), ...(fleet.specialists ?? [])];
    reconcileLeadership(game, donor === fleet.owner ? [] : leaders, rock);
    if (mechanicsVersion(game) >= 8 && donor !== fleet.owner) {
      reconcileFunding(game);
      rock.drones -= excessGiftDrones(game, fleet.owner, fleet.drones);
    }
    if (living(fleet).some(u => u.kind === 'inspector')) rock.shield = maximumShield(rock);
    if (draft && donor !== fleet.owner) { draft.kind = 'gift'; finish(encounters, draft, game, 'transferred', fleet, rock); }
    return;
  }
  const launches = draft ? game.fleets.filter(f => f.preparing && f.from === rock.id).map(snapshotAsset) : [];
  defendWithPreparations(game, rock.id);
  if (draft) draft.reinforcement = Object.freeze({ haulers: Object.freeze(launches), site: snapshotAsset(rock) });
  const formerOwner = rock.owner;
  const originalAttacking = fleet.drones; const originalDefending = rock.drones;
  const phase = applyCombatAbilities(game, fleet, rock, draft?.steps);
  if (draft) draft.suppressed = phase.suppressed;
  if (phase.ended) { reconcileLeadership(game, leaders, rock); finish(encounters, draft, game, 'ended', fleet, rock); return; }
  const shieldBefore = rock.shield ?? 0; const exposed = fleet.drones;
  fleet.drones = absorbShields(game, rock, fleet.drones);
  if (draft) draft.shield = Object.freeze({ before: shieldBefore, absorbed: exposed - fleet.drones, after: rock.shield ?? 0 });
  const attackerWins = fleet.drones > rock.drones || fleet.drones === rock.drones && living(fleet).length > living(rock).length;
  if (attackerWins) {
    const remaining = fleet.drones - rock.drones;
    const repaired = repairLosses(game, fleet, Math.max(0, originalAttacking - remaining), phase.suppressed);
    rock.drones = remaining + repaired;
    if (draft) { draft.winner = 0; draft.repaired = repaired; draft.captured = newlyCaptive(rock.specialists ?? [], fleet.owner); }
    rock.specialists = [...capture(game, rock.specialists ?? [], fleet.owner), ...(fleet.specialists ?? [])];
    if (rock.kind === 'mine') { if (rock.owner) loseMine(game, rock.owner); rock.miningAt = game.hour + MINING_DAY; delete rock.miningInterval; }
    if (!rock.owner && rock.kind === 'factory') rock.productionAt = afterWork(game, game.hour, 8);
    rock.owner = fleet.owner; rock.shieldAt = afterWork(game, game.hour, 48 / (rock.shieldMax ?? 10));
    log(game, rock, [formerOwner, fleet.owner], `${rock.name} acquired; opposing modules captured.`);
  } else {
    const remaining = rock.drones - fleet.drones;
    const repaired = repairLosses(game, rock, Math.max(0, originalDefending - remaining), phase.suppressed);
    rock.drones = remaining + repaired;
    if (draft) { draft.winner = 1; draft.repaired = repaired; draft.captured = rock.owner ? newlyCaptive(fleet.specialists ?? [], rock.owner) : []; }
    if (rock.owner) rock.specialists = [...(rock.specialists ?? []), ...capture(game, fleet.specialists ?? [], rock.owner)];
    log(game, rock, [formerOwner, fleet.owner], `${rock.name}: defending force held the site.`);
  }
  game.fleets = game.fleets.filter(f => f.id !== fleet.id);
  reconcileLeadership(game, leaders, rock);
  if (!phase.suppressed && living(rock).some(u => u.kind === 'inspector')) rock.shield = maximumShield(rock);
  finish(encounters, draft, game, attackerWins ? 'captured' : 'held', fleet, rock);
}

export function repairLosses(game: Game, asset: Asset, lost: number, suppressed: boolean): number {
  if (!asset.owner) return 0;
  const repaired = Math.ceil(lost * 0.25) * (unitCount(game, asset.owner, 'engineer') + (suppressed ? 0 : living(asset).filter(u => u.kind === 'engineer').length));
  return mechanicsVersion(game) >= 7 ? Math.min(lost, repaired) : repaired;
}

export function coreLocations(game: Game): { owner: Faction; point: { x: number; y: number } }[] {
  return [...game.rocks.flatMap(r => living(r).filter(u => u.kind === 'queen').map(u => ({ owner: u.owner, point: { x: r.x, y: r.y } }))),
    ...game.fleets.flatMap(f => living(f).filter(u => u.kind === 'queen').map(u => ({ owner: u.owner, point: fleetPosition(game, f) })))];
}
export function resolveHaulerBattle(game: Game, a: Fleet, b: Fleet, encounters?: EncounterSink, kind: EncounterKind = 'route'): void {
  const point = fleetPosition(game, a); const leaders = coreLocations(game);
  const draft = encounters && startEncounter(kind, game.hour, a, b);
  const originalA = a.drones; const originalB = b.drones;
  const phase = applyCombatAbilities(game, a, b, draft?.steps);
  if (draft) draft.suppressed = phase.suppressed;
  if (phase.ended) { reconcileLeadership(game, leaders, point); finish(encounters, draft, game, 'ended', a, b); return; }
  const result = a.drones - b.drones || living(a).length - living(b).length;
  if (result === 0) {
    game.fleets = game.fleets.filter(f => f.id !== a.id && f.id !== b.id);
    sendUnitsHome(game, point, a.owner, a.specialists ?? [], a.intercept || a.interceptionReturn ? 'interception' : undefined); sendUnitsHome(game, point, b.owner, b.specialists ?? [], b.intercept || b.interceptionReturn ? 'interception' : undefined);
  } else {
    const winner = result > 0 ? a : b; const loser = result > 0 ? b : a;
    const remaining = Math.max(0, winner.drones - loser.drones);
    const repaired = repairLosses(game, winner, Math.max(0, (result > 0 ? originalA : originalB) - remaining), phase.suppressed);
    winner.drones = remaining + repaired;
    if (draft) { draft.winner = result > 0 ? 0 : 1; draft.repaired = repaired; draft.captured = newlyCaptive(loser.specialists ?? [], winner.owner); }
    game.fleets = game.fleets.filter(f => f.id !== loser.id);
    const captives = capture(game, loser.specialists ?? [], winner.owner);
    if (captives.length && !sendUnitsHome(game, point, winner.owner, captives)) winner.specialists = [...(winner.specialists ?? []), ...captives];
    if (phase.redirected.includes(winner) || living(winner).some(u => u.kind === 'pirate') && (mechanicsVersion(game) < 3 || winner.intercept)) returnHauler(game, winner);
    if (winner.drones === 0 && !winner.specialists?.length) game.fleets = game.fleets.filter(f => f.id !== winner.id);
  }
  log(game, point, [a.owner, b.owner], 'Haulers fought in transit; surviving modules returned or were captured.');
  reconcileLeadership(game, leaders, point);
  finish(encounters, draft, game, result === 0 ? 'tie' : 'won', a, b);
}

export function resolveHaulerContact(game: Game, a: Fleet, b: Fleet, encounters?: EncounterSink, kind: Exclude<EncounterKind, 'arrival' | 'gift'> = 'route'): void {
  a.lastContacts = [...(a.lastContacts ?? []).filter(c => Math.abs(c.hour - game.hour) < 1e-9), { id: b.id, hour: game.hour }];
  b.lastContacts = [...(b.lastContacts ?? []).filter(c => Math.abs(c.hour - game.hour) < 1e-9), { id: a.id, hour: game.hour }];
  const giftA = a.giftAt !== undefined && a.giftAt <= game.hour;
  const giftB = b.giftAt !== undefined && b.giftAt <= game.hour;
  if (!giftA && !giftB) { resolveHaulerBattle(game, a, b, encounters, kind); return; }
  const leaders = coreLocations(game); const point = fleetPosition(game, a);
  const draft = encounters && startEncounter('gift', game.hour, a, b);
  const ownerA = a.owner; const ownerB = b.owner;
  const cappedGifts = mechanicsVersion(game) >= 8;
  const gifts: Fleet[] = [];
  for (const [fleet, owner, gift] of [[a, ownerB, giftA], [b, ownerA, giftB]] as const) if (gift) {
    for (const unit of fleet.specialists ?? []) restoreControl(game, unit, owner, fleet.specialists);
    fleet.owner = owner; delete fleet.giftAt;
    if (cappedGifts) gifts.push(fleet); else returnHauler(game, fleet);
  }
  if (cappedGifts) {
    reconcileLeadership(game, leaders, point);
    reconcileFunding(game);
    for (const fleet of gifts) {
      fleet.drones -= excessGiftDrones(game, fleet.owner, fleet.drones);
      if (fleet.drones || fleet.specialists?.length) returnHauler(game, fleet);
      else game.fleets = game.fleets.filter(f => f.id !== fleet.id);
    }
  }
  log(game, point, [ownerA, ownerB], 'Gift accepted in transit and routed to friendly territory.');
  reconcileLeadership(game, leaders, point);
  finish(encounters, draft, game, 'transferred', a, b);
}
