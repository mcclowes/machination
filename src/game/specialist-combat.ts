/**
 * ---
 * purpose: Specialist-aware site arrivals, combat outcomes, capture, and core succession.
 * ---
 */
import { sendUnitsHome, returnHauler } from './specialist-travel';
import { applyCombatAbilities } from './combat-abilities';
import type { Faction, Fleet, Game, Rock } from './simulation';
import { fleetPosition } from './flight';
import { maximumShield, absorbShields } from './economy';
import { MINING_DAY } from './mining';
import { activeUnits, unitCount, type Specialist } from './specialists';
import { refreshUnitEffects } from './specialist-effects';
import { defendWithPreparations } from './transport';
import { observers } from './sensors';

type Asset = Rock | Fleet;
const isRock = (asset: Asset): asset is Rock => typeof asset.id === 'string';
const living = (asset: Asset) => (asset.specialists ?? []).filter(u => !u.captive && u.owner === asset.owner);
export function reconcileLeadership(game: Game, previous: readonly (Faction | { owner: Faction; point: { x: number; y: number } })[], point: { x: number; y: number }): void {
  for (const entry of previous) {
    const owner = typeof entry === 'string' ? entry : entry.owner;
    const lostAt = typeof entry === 'string' ? point : entry.point;
    if (game.eliminated.includes(owner) || activeUnits(game, owner).some(u => u.kind === 'queen')) continue;
    const candidates = [
      ...game.rocks.filter(r => r.owner === owner).flatMap(r => (r.specialists ?? []).filter(u => u.owner === owner && !u.captive && u.kind === 'princess').map(unit => ({ unit, point: r }))),
      ...game.fleets.filter(f => f.owner === owner).flatMap(f => (f.specialists ?? []).filter(u => u.owner === owner && !u.captive && u.kind === 'princess').map(unit => ({ unit, point: fleetPosition(game, f) }))),
    ].sort((a, b) => Math.hypot(a.point.x - lostAt.x, a.point.y - lostAt.y) - Math.hypot(b.point.x - lostAt.x, b.point.y - lostAt.y) || a.unit.id.localeCompare(b.unit.id));
    if (candidates[0]) {
      candidates[0].unit.kind = 'queen';
      game.events.unshift({ hour: game.hour, audience: [owner], message: 'Fallback core promoted. Operational control preserved.' });
    } else {
      game.eliminated.push(owner); game.cargo[owner] = 0;
      game.scheduled = (game.scheduled ?? []).filter(p => p.owner !== owner);
      for (const rock of game.rocks.filter(r => r.owner === owner)) defendWithPreparations(game, rock.id);
      game.events.unshift({ hour: game.hour, audience: ['you', 'vesper', 'null'], message: `${owner}: core lost. Orders and extraction terminated; remaining assets persist.` });
    }
  }
  refreshUnitEffects(game);
}
function capture(units: Specialist[], owner: Faction): Specialist[] {
  for (const unit of units) { if (unit.owner === owner) delete unit.captive; else unit.captive = true; }
  return units;
}
function log(game: Game, point: { x: number; y: number }, owners: (Faction | null)[], message: string): void {
  game.events.unshift({ hour: game.hour, audience: [...new Set([...owners.filter((o): o is Faction => !!o), ...observers(game, point)])], message });
}
export function resolveStationArrival(game: Game, fleet: Fleet, rock: Rock): void {
  const leaders = coreLocations(game);
  if (rock.destroyed) { returnHauler(game, fleet); return; }
  const donor = fleet.owner;
  if (fleet.giftAt !== undefined && fleet.giftAt <= game.hour && rock.owner) {
    fleet.owner = rock.owner;
    for (const unit of fleet.specialists ?? []) { if (unit.owner !== fleet.owner && unit.kind === 'queen') unit.kind = 'princess'; unit.owner = fleet.owner; delete unit.captive; }
  }
  if (fleet.owner === rock.owner) {
    game.fleets = game.fleets.filter(f => f.id !== fleet.id);
    rock.drones += fleet.drones;
    rock.specialists = [...(rock.specialists ?? []), ...(fleet.specialists ?? [])];
    reconcileLeadership(game, donor === fleet.owner ? [] : leaders, rock);
    if (living(fleet).some(u => u.kind === 'inspector')) rock.shield = maximumShield(rock);
    return;
  }
  defendWithPreparations(game, rock.id);
  const formerOwner = rock.owner;
  const originalAttacking = fleet.drones; const originalDefending = rock.drones;
  const phase = applyCombatAbilities(game, fleet, rock);
  if (phase.ended) { reconcileLeadership(game, leaders, rock); return; }
  fleet.drones = absorbShields(game, rock, fleet.drones);
  const attackerWins = fleet.drones > rock.drones || fleet.drones === rock.drones && living(fleet).length > living(rock).length;
  if (attackerWins) {
    const remaining = fleet.drones - rock.drones;
    rock.drones = remaining + repairLosses(game, fleet, Math.max(0, originalAttacking - remaining), phase.suppressed);
    rock.specialists = [...capture(rock.specialists ?? [], fleet.owner), ...(fleet.specialists ?? [])];
    if (rock.kind === 'mine') { if (rock.owner) game.cargo[rock.owner] *= 0.8; rock.miningAt = game.hour + MINING_DAY; delete rock.miningInterval; }
    if (!rock.owner && rock.kind === 'factory') rock.productionAt = game.hour + 8;
    rock.owner = fleet.owner; rock.shieldAt = game.hour + 48 / (rock.shieldMax ?? 10);
    log(game, rock, [formerOwner, fleet.owner], `${rock.name} acquired; opposing modules captured.`);
  } else {
    const remaining = rock.drones - fleet.drones;
    rock.drones = remaining + repairLosses(game, rock, Math.max(0, originalDefending - remaining), phase.suppressed);
    if (rock.owner) rock.specialists = [...(rock.specialists ?? []), ...capture(fleet.specialists ?? [], rock.owner)];
    log(game, rock, [formerOwner, fleet.owner], `${rock.name}: defending force held the site.`);
  }
  game.fleets = game.fleets.filter(f => f.id !== fleet.id);
  reconcileLeadership(game, leaders, rock);
  if (!phase.suppressed && living(rock).some(u => u.kind === 'inspector')) rock.shield = maximumShield(rock);
}

export function repairLosses(game: Game, asset: Asset, lost: number, suppressed: boolean): number {
  if (!asset.owner) return 0;
  return Math.ceil(lost * 0.25) * (unitCount(game, asset.owner, 'engineer') + (suppressed ? 0 : living(asset).filter(u => u.kind === 'engineer').length));
}

export function coreLocations(game: Game): { owner: Faction; point: { x: number; y: number } }[] {
  return [...game.rocks.flatMap(r => living(r).filter(u => u.kind === 'queen').map(u => ({ owner: u.owner, point: { x: r.x, y: r.y } }))),
    ...game.fleets.flatMap(f => living(f).filter(u => u.kind === 'queen').map(u => ({ owner: u.owner, point: fleetPosition(game, f) })))];
}
export function resolveHaulerBattle(game: Game, a: Fleet, b: Fleet): void {
  const point = fleetPosition(game, a); const leaders = coreLocations(game);
  const originalA = a.drones; const originalB = b.drones;
  const phase = applyCombatAbilities(game, a, b);
  if (phase.ended) { reconcileLeadership(game, leaders, point); return; }
  const result = a.drones - b.drones || living(a).length - living(b).length;
  if (result === 0) {
    game.fleets = game.fleets.filter(f => f.id !== a.id && f.id !== b.id);
    sendUnitsHome(game, point, a.owner, a.specialists ?? []); sendUnitsHome(game, point, b.owner, b.specialists ?? []);
  } else {
    const winner = result > 0 ? a : b; const loser = result > 0 ? b : a;
    const remaining = Math.max(0, winner.drones - loser.drones);
    winner.drones = remaining + repairLosses(game, winner, Math.max(0, (result > 0 ? originalA : originalB) - remaining), phase.suppressed);
    game.fleets = game.fleets.filter(f => f.id !== loser.id);
    const captives = capture(loser.specialists ?? [], winner.owner);
    if (captives.length && !sendUnitsHome(game, point, winner.owner, captives)) winner.specialists = [...(winner.specialists ?? []), ...captives];
    if (living(winner).some(u => u.kind === 'pirate')) returnHauler(game, winner);
    if (winner.drones === 0 && !winner.specialists?.length) game.fleets = game.fleets.filter(f => f.id !== winner.id);
  }
  log(game, point, [a.owner, b.owner], 'Haulers fought in transit; surviving modules returned or were captured.');
  reconcileLeadership(game, leaders, point);
}

export function resolveHaulerContact(game: Game, a: Fleet, b: Fleet): void {
  a.lastContacts = [...(a.lastContacts ?? []).filter(c => Math.abs(c.hour - game.hour) < 1e-9), { id: b.id, hour: game.hour }];
  b.lastContacts = [...(b.lastContacts ?? []).filter(c => Math.abs(c.hour - game.hour) < 1e-9), { id: a.id, hour: game.hour }];
  const giftA = a.giftAt !== undefined && a.giftAt <= game.hour;
  const giftB = b.giftAt !== undefined && b.giftAt <= game.hour;
  if (!giftA && !giftB) { resolveHaulerBattle(game, a, b); return; }
  const leaders = coreLocations(game); const point = fleetPosition(game, a);
  const ownerA = a.owner; const ownerB = b.owner;
  for (const [fleet, owner, gift] of [[a, ownerB, giftA], [b, ownerA, giftB]] as const) if (gift) {
    for (const unit of fleet.specialists ?? []) { if (unit.kind === 'queen' && unit.owner !== owner) unit.kind = 'princess'; unit.owner = owner; delete unit.captive; }
    fleet.owner = owner; delete fleet.giftAt; returnHauler(game, fleet);
  }
  log(game, point, [ownerA, ownerB], 'Gift accepted in transit and routed to friendly territory.');
  reconcileLeadership(game, leaders, point);
}
