import type { PublicRules } from '../game/rules';
import type { Drift } from '../game/drift';
import type { GameView } from '../game/visibility';
import type { Faction } from '../game/players';
import type { ModuleKind } from '../game/modules';
import type { SpecialistKind } from '../game/specialist-catalog';
import type { CharacterId } from '../game/characters';
import { maximumShield } from '../game/economy';

export type ReplayUnit = { id: string; kind: SpecialistKind; owner: Faction; captive?: true };
type ReplayPoint = { x: number; y: number };
export type ReplayRock = ReplayPoint & {
  id: string; name: string; known: boolean; drift?: Drift;
  kind: 'core' | 'reactor' | 'mine' | 'factory' | 'generator' | 'unknown';
  owner?: Faction | null; drones?: number; destroyed?: true; coreOf?: Faction;
  sensorJammedUntil?: number; miningDisabledUntil?: number; shield?: number; shieldMax?: number; shieldsDisabled?: boolean; module?: ModuleKind; specialists?: ReplayUnit[];
};
export type ReplayFleet = {
  id: number; owner: Faction; from: string; to: string; drones: number; departed: number; arrives: number;
  enginesDisabledUntil?: number; sensorJammedUntil?: number; preparing?: true; returning?: true; giftAt?: number; module?: ModuleKind; specialists?: ReplayUnit[]; speed?: number;
  route?: { from: ReplayPoint; to: ReplayPoint }; intercept?: { home: string; target?: number };
};
export type ReplayScene = {
  version?: 1 | 2; hour: number; rocks: ReplayRock[]; fleets: ReplayFleet[];
  coverage: { x: number; y: number; radius: number; drift?: Drift }[];
  cargo: Partial<Record<Faction, number>>;
  standings?: Partial<Record<Faction, { cargo: number; funders: number }>>;
  eliminated: Faction[]; winner: Faction | null; draw?: true;
  pulse?: GameView['pulse']; rules?: PublicRules;
};

/** Keep one alias set per export, including gaps where a contact disappears. */
export function createReplayAliases(): { fleet: (id: number) => number; unit: (id: string) => string } {
  const fleets = new Map<number, number>();
  const units = new Map<string, string>();
  return {
    fleet(id) { if (!fleets.has(id)) fleets.set(id, fleets.size + 1); return fleets.get(id)!; },
    unit(id) { if (!units.has(id)) units.set(id, `u${units.size + 1}`); return units.get(id)!; },
  };
}

const factions: readonly Faction[] = ['you', 'vesper', 'null', 'aether', 'umbra', 'orbit', 'prism', 'echo', 'nadir', 'zenith'];

/** Projects an already filtered observation. Observed preparations belong to the chart; private queued intents never do. */
export function presentObservation(view: GameView, aliases = createReplayAliases()): ReplayScene {
  const scene: ReplayScene = {
    hour: view.hour, rocks: [], fleets: [], coverage: view.coverage.map(s => ({ x: s.x, y: s.y, radius: s.radius, ...(s.drift ? { drift: { origin: { x: s.drift.origin.x, y: s.drift.origin.y }, velocity: { x: s.drift.velocity.x, y: s.drift.velocity.y } } } : {}) })),
    cargo: {}, eliminated: view.eliminated.map(f => f), winner: view.winner,
  };
  const units = (items: NonNullable<GameView['fleets'][number]['specialists']>): ReplayUnit[] => items.map(u => {
    const unit: ReplayUnit = { id: aliases.unit(u.id), kind: u.kind, owner: u.owner };
    if (u.captive !== undefined) unit.captive = u.captive;
    return unit;
  });
  for (const r of view.rocks) {
    const rock: ReplayRock = { id: r.id, name: r.name, x: r.x, y: r.y, known: r.known, kind: r.kind };
    if (r.drift) rock.drift = { origin: { x: r.drift.origin.x, y: r.drift.origin.y }, velocity: { x: r.drift.velocity.x, y: r.drift.velocity.y } };
    if (r.owner !== undefined) rock.owner = r.owner;
    if (r.known) {
      rock.drones = r.drones;
      if (r.sensorJammedUntil !== undefined) rock.sensorJammedUntil = r.sensorJammedUntil;
      if (r.miningDisabledUntil !== undefined) rock.miningDisabledUntil = r.miningDisabledUntil;
      if (r.destroyed !== undefined) rock.destroyed = r.destroyed;
      if (r.coreOf !== undefined) rock.coreOf = r.coreOf;
      if (r.shield !== undefined) rock.shield = r.shield;
      if (r.shieldMax !== undefined) rock.shieldMax = maximumShield(r);
      if (r.shieldsDisabled !== undefined) rock.shieldsDisabled = r.shieldsDisabled;
      if (r.module !== undefined) rock.module = r.module;
      if (r.specialists !== undefined) rock.specialists = units(r.specialists);
    }
    scene.rocks.push(rock);
  }
  // Allocate only observed fleets, before resolving any interception references.
  const visible = new Map(view.fleets.map(f => [f.id, aliases.fleet(f.id)]));
  for (const f of view.fleets) {
    const fleet: ReplayFleet = { id: visible.get(f.id)!, owner: f.owner, from: f.from, to: f.to, drones: f.drones, departed: f.departed, arrives: f.arrives };
    if (f.enginesDisabledUntil !== undefined) fleet.enginesDisabledUntil = f.enginesDisabledUntil;
    if (f.sensorJammedUntil !== undefined) fleet.sensorJammedUntil = f.sensorJammedUntil;
    if (f.preparing !== undefined) fleet.preparing = f.preparing;
    if (f.returning !== undefined) fleet.returning = f.returning;
    if (f.giftAt !== undefined) fleet.giftAt = f.giftAt;
    if (f.module !== undefined) fleet.module = f.module;
    if (f.specialists !== undefined) fleet.specialists = units(f.specialists);
    if (f.speed !== undefined) fleet.speed = f.speed;
    if (f.route !== undefined) fleet.route = { from: { x: f.route.from.x, y: f.route.from.y }, to: { x: f.route.to.x, y: f.route.to.y } };
    if (f.intercept !== undefined) {
      fleet.intercept = { home: f.intercept.home };
      const target = f.intercept.target === undefined ? undefined : visible.get(f.intercept.target);
      if (target !== undefined) fleet.intercept.target = target;
    }
    scene.fleets.push(fleet);
  }
  for (const faction of factions) {
    if (view.cargo[faction] !== undefined) scene.cargo[faction] = view.cargo[faction];
  }
  if (view.standings !== undefined) {
    scene.standings = {};
    for (const faction of factions) {
      const standing = view.standings[faction];
      if (standing !== undefined) scene.standings[faction] = { cargo: standing.cargo, funders: standing.funders };
    }
  }
  if (view.version !== undefined) scene.version = view.version;
  if (view.draw !== undefined) scene.draw = view.draw;
  if (view.rules !== undefined) {
    const r = view.rules;
    scene.rules = { players: r.players.map(f => f), mode: r.mode, victoryTarget: r.victoryTarget,
      map: { generator: r.map.generator, width: r.map.width, height: r.map.height } };
    if (r.portraits !== undefined) scene.rules.portraits = [...r.portraits];
    if (r.mechanicsVersion !== undefined) scene.rules.mechanicsVersion = r.mechanicsVersion;
    if (r.driftingBases !== undefined) scene.rules.driftingBases = r.driftingBases;
    if (r.map.topology !== undefined) scene.rules.map.topology = r.map.topology;
  }
  if (view.rules?.tacticalPulse && scene.rules) scene.rules.tacticalPulse = { ...view.rules.tacticalPulse };
  if (view.rules?.pulse && scene.rules) scene.rules.pulse = { ...view.rules.pulse };
  if (view.pulse) scene.pulse = { ...view.pulse,
    kings: view.pulse.kings.map(k => ({ ...k, kingId: aliases.unit(k.kingId), position: { ...k.position } })),
    pulses: view.pulse.pulses.map(p => ({ ...p, kingId: aliases.unit(p.kingId), origin: { ...p.origin } })),
    shields: Object.fromEntries(Object.entries(view.pulse.shields).map(([id, s]) => [id, { ...s }])), modifiers: view.pulse.modifiers.map(m => ({ ...m })) };
  if (view.pulse?.tactical && scene.pulse) scene.pulse.tactical = {
    charges: view.pulse.tactical.charges.map(c => ({ ...c, id: `charge-${aliases.unit(c.specialistId)}-${c.readyAt}`, specialistId: aliases.unit(c.specialistId) })),
    waves: view.pulse.tactical.waves.map(w => ({ ...w, specialistId: aliases.unit(w.specialistId), origin: { ...w.origin }, hitSites: [...w.hitSites], hitFleets: w.hitFleets.filter(id => visible.has(id)).map(id => visible.get(id)!) })),
    resistance: Object.fromEntries(Object.entries(view.pulse.tactical.resistance).map(([id, until]) => [aliases.unit(id), until])),
  };
  return scene;
}
