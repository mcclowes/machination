/**
 * ---
 * purpose: Simultaneous rival decisions: each seat plans against the same snapshot, then its orders are replayed onto the shared game.
 * related:
 *   - ./rival-ai.ts - per-seat planning and policy selection
 * ---
 */
import { dispatch, type Faction, type Game } from './simulation';
import { commandPulse, type PulseCommand } from './pulse';
import { drillMine } from './economy';
import { hireSpecialist, promoteSpecialist } from './specialists';

type Order = (game: Game, renamed: Map<string, string>) => Game;

/** Reads a seat's orders from the difference between the snapshot and its plan, in an order whose costs stay affordable. */
export function plannedOrders(before: Game, after: Game, owner: Faction): Order[] {
  const orders: Order[] = [];
  const receipts = before.pulse?.receipts ?? {};
  for (const [key, action] of Object.entries(after.pulse?.receipts ?? {})) {
    if (Object.hasOwn(receipts, key) || !key.startsWith(`${owner}:`)) continue;
    const command = { action, id: key.slice(owner.length + 1) } as PulseCommand;
    orders.push(game => commandPulse(game, owner, command));
  }
  const fleetIds = new Set(before.fleets.map(f => f.id));
  const departed = after.fleets.filter(f => f.owner === owner && !fleetIds.has(f.id));
  const unitsBefore = new Map(before.rocks.flatMap(r => r.specialists ?? []).map(u => [u.id, u.kind]));
  for (const unit of [...after.rocks, ...departed].flatMap(asset => asset.specialists ?? [])) {
    const previous = unitsBefore.get(unit.id);
    if (unit.owner === owner && previous !== undefined && previous !== unit.kind) orders.push(game => promoteSpecialist(game, owner, unit.id));
  }
  const seen = new Set([...unitsBefore.keys(), ...before.fleets.flatMap(f => f.specialists ?? []).map(u => u.id)]);
  const hired = [...after.rocks.flatMap(r => r.specialists ?? []), ...departed.flatMap(f => f.specialists ?? [])].filter(u => u.owner === owner && !seen.has(u.id));
  if (hired.length) orders.push((game, renamed) => {
    const nextId = game.nextId;
    const result = hireSpecialist(game, owner, hired[0]!.kind);
    hired.forEach((unit, index) => renamed.set(unit.id, `unit-${nextId + index}`));
    return result;
  });
  for (const rock of after.rocks) {
    const old = before.rocks.find(r => r.id === rock.id);
    if (rock.owner === owner && rock.kind === 'mine' && old?.kind !== 'mine') orders.push(game => drillMine(game, rock.id, owner));
  }
  for (const fleet of departed) orders.push((game, renamed) => dispatch(game, fleet.from, fleet.to, fleet.drones, owner, false, (fleet.specialists ?? []).map(u => renamed.get(u.id) ?? u.id)));
  return orders;
}

/** Seats never see each other's same-tick orders, so decision order carries no information advantage. */
export function actSimultaneously(input: Game, owners: readonly Faction[], plan: (game: Game, owner: Faction) => Game, after?: (game: Game) => void): Game {
  const plans = owners.map(owner => ({ owner, orders: plannedOrders(input, plan(input, owner), owner) }));
  let game = input;
  for (const { orders } of plans) {
    const renamed = new Map<string, string>();
    for (const order of orders) {
      // An order can only fail if another seat's same-tick order invalidated it; skip it rather than abort the tick.
      try { game = order(game, renamed); } catch { /* skipped */ }
    }
    after?.(game);
  }
  return game;
}
