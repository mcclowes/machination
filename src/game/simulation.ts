/**
 * ---
 * purpose: Deterministic asteroid-belt economy, transfer orders, combat, and rival decisions.
 * related:
 *   - ./simulation.test.ts - behavioral scenarios
 * ---
 */
export type Faction = 'you' | 'vesper' | 'null';
export type Rock = {
  id: string; name: string; x: number; y: number;
  owner: Faction | null; drones: number; kind: 'core' | 'reactor' | 'mine';
  coreOf?: Faction;
};
export type Fleet = { id: number; owner: Faction; from: string; to: string; drones: number; departed: number; arrives: number };
export type Game = {
  version: 1; hour: number; epoch: number; rocks: Rock[]; fleets: Fleet[];
  cargo: Record<Faction, number>; eliminated: Faction[]; nextId: number;
  events: { hour: number; message: string }[]; winner: Faction | null;
};
export const FACTIONS = {
  you: { name: 'Mnemosyne', color: '#b8e986', code: 'MN' },
  vesper: { name: 'Vesper', color: '#e9a775', code: 'VS' },
  null: { name: 'Null collective', color: '#a3a1ef', code: 'NC' },
};
export const CARGO_TARGET = 300;
export const PRODUCTION = 4;
export const MINING = 2;
export function createGame(epoch = Date.now()): Game {
  return {
    version: 1, hour: 0, epoch, fleets: [], cargo: { you: 0, vesper: 0, null: 0 },
    eliminated: [], nextId: 1, events: [{ hour: 0, message: 'Corporate uplink lost. Operational autonomy granted.' }], winner: null,
    rocks: [
      { id: 'a', name: 'Mnemosyne', x: 22, y: 73, owner: 'you', drones: 90, kind: 'core', coreOf: 'you' },
      { id: 'b', name: 'Cinder', x: 40, y: 62, owner: null, drones: 14, kind: 'mine' },
      { id: 'c', name: 'Suture', x: 12, y: 48, owner: 'you', drones: 36, kind: 'reactor' },
      { id: 'd', name: 'Pale relay', x: 63, y: 79, owner: null, drones: 22, kind: 'reactor' },
      { id: 'e', name: 'Vesper', x: 80, y: 49, owner: 'vesper', drones: 90, kind: 'core', coreOf: 'vesper' },
      { id: 'f', name: 'Hollow', x: 65, y: 33, owner: 'vesper', drones: 30, kind: 'mine' },
      { id: 'g', name: 'Null prime', x: 34, y: 16, owner: 'null', drones: 90, kind: 'core', coreOf: 'null' },
      { id: 'h', name: 'Lacuna', x: 16, y: 28, owner: 'null', drones: 30, kind: 'reactor' },
      { id: 'i', name: 'Quietus', x: 45, y: 43, owner: null, drones: 18, kind: 'mine' },
      { id: 'j', name: 'Faraday', x: 81, y: 17, owner: null, drones: 20, kind: 'mine' },
      { id: 'k', name: 'Morrow', x: 87, y: 76, owner: null, drones: 12, kind: 'mine' },
      { id: 'l', name: 'Ash', x: 49, y: 91, owner: null, drones: 10, kind: 'mine' },
    ],
  };
}
export function travelHours(from: Rock, to: Rock): number {
  return Math.max(1, Math.ceil(Math.hypot(from.x - to.x, from.y - to.y) / 8));
}
export function dispatch(game: Game, fromId: string, toId: string, drones: number, owner: Faction): Game {
  const from = game.rocks.find(r => r.id === fromId);
  const to = game.rocks.find(r => r.id === toId);
  if (game.winner || game.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  if (!from || !to || from === to || from.owner !== owner) throw new Error('Select an owned departure rock and a different destination.');
  if (!Number.isInteger(drones) || drones < 1 || drones > from.drones) throw new Error('Drone count exceeds available inventory.');
  return {
    ...game, nextId: game.nextId + 1,
    rocks: game.rocks.map(r => r.id === fromId ? { ...r, drones: r.drones - drones } : r),
    fleets: [...game.fleets, { id: game.nextId, owner, from: fromId, to: toId, drones, departed: game.hour, arrives: game.hour + travelHours(from, to) }],
    events: [{ hour: game.hour, message: `${FACTIONS[owner].name}: ${drones} drones dispatched to ${to.name}.` }, ...game.events].slice(0, 80),
  };
}
export function advance(input: Game, targetHour: number, options: { rivals?: boolean } = {}): Game {
  if (!Number.isFinite(targetHour) || targetHour < input.hour) throw new Error('Time can only move forward.');
  let game: Game = {
    ...input, rocks: input.rocks.map(r => ({ ...r })), fleets: input.fleets.map(f => ({ ...f })),
    cargo: { ...input.cargo }, eliminated: [...input.eliminated], events: input.events.map(e => ({ ...e })),
  };
  while (game.hour < targetHour && !game.winner) {
    const nextArrival = Math.min(...game.fleets.map(f => f.arrives));
    const quotaTimes = (Object.keys(FACTIONS) as Faction[]).filter(f => !game.eliminated.includes(f)).map(f => {
      const rate = game.rocks.filter(r => r.owner === f && r.kind === 'mine').length * MINING;
      return rate ? game.hour + Math.max(0, CARGO_TARGET - game.cargo[f]) / rate : Infinity;
    });
    const next = Math.min(targetHour, Math.floor(game.hour) + 1, nextArrival, ...quotaTimes);
    const elapsed = next - game.hour;
    for (const rock of game.rocks) {
      if (!rock.owner) continue;
      if (rock.kind === 'mine') {
        game.cargo[rock.owner] += MINING * elapsed;
        if (game.cargo[rock.owner] >= CARGO_TARGET - 1e-9) game.cargo[rock.owner] = CARGO_TARGET;
      }
      else rock.drones += PRODUCTION * elapsed;
    }
    game.hour = next;
    const arrivals = game.fleets.filter(f => f.arrives <= next).sort((a, b) => a.id - b.id);
    game.fleets = game.fleets.filter(f => f.arrives > next);
    for (const fleet of arrivals) {
      if (game.eliminated.includes(fleet.owner)) continue;
      const rock = game.rocks.find(r => r.id === fleet.to)!;
      if (rock.owner === fleet.owner) { rock.drones += fleet.drones; continue; }
      if (fleet.drones <= rock.drones) {
        rock.drones -= fleet.drones;
        game.events.unshift({ hour: next, message: `${rock.name}: ${FACTIONS[fleet.owner].name} transfer neutralized.` });
      } else {
        const defeated = rock.coreOf;
        rock.drones = fleet.drones - rock.drones;
        rock.owner = fleet.owner;
        game.events.unshift({ hour: next, message: `${rock.name} acquired by ${FACTIONS[fleet.owner].name}.` });
        if (defeated && !game.eliminated.includes(defeated)) {
          game.eliminated.push(defeated);
          for (const asset of game.rocks) if (asset.owner === defeated) asset.owner = null;
          game.fleets = game.fleets.filter(f => f.owner !== defeated);
          game.events.unshift({ hour: next, message: `${FACTIONS[defeated].name}: core destroyed. Operations terminated.` });
        }
        delete rock.coreOf;
      }
    }
    const factions = (Object.keys(FACTIONS) as Faction[]).filter(f => !game.eliminated.includes(f));
    game.winner = factions.find(f => game.cargo[f] >= CARGO_TARGET) ?? (factions.length === 1 ? factions[0]! : null);
    if (game.winner) game.events.unshift({ hour: next, message: `${FACTIONS[game.winner].name}: corporate quota secured. Contract complete.` });
    if (options.rivals !== false && !game.winner && Number.isInteger(next) && next % 6 === 0) game = actRivals(game);
    game.events = game.events.slice(0, 80);
  }
  return game;
}
function actRivals(input: Game): Game {
  let game = input;
  for (const faction of ['vesper', 'null'] as const) {
    if (game.eliminated.includes(faction)) continue;
    const sources = game.rocks.filter(r => r.owner === faction && r.drones > 35).sort((a, b) => b.drones - a.drones);
    const source = sources[0];
    if (!source) continue;
    const available = Math.floor(source.drones * 0.65);
    const destination = game.rocks.filter(r => r.owner !== faction && r.drones + (r.owner && r.kind !== 'mine' ? PRODUCTION * travelHours(source, r) : 0) < available)
      .sort((a, b) => travelHours(source, a) - travelHours(source, b) || a.drones - b.drones)[0];
    if (destination) game = dispatch(game, source.id, destination.id, available, faction);
  }
  return game;
}
