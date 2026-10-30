import { validPlayerColors } from '../game/player-colors';
import { validCompact } from '../game/compact-save';
import { PLANET_RESERVES } from '../game/depletion';
import type { Faction } from '../game/players';
import { validateTacticalPulseConfig } from '../game/tactical-pulse';
import { validatePulseConfig } from '../game/pulse';
import { validateTeams } from '../game/teams';
import { driftingBasesEnabled } from '../game/rules';
import { sitePosition, validDrift } from '../game/drift';
import { CHARACTER_IDS } from '../game/characters';
import { isModule } from '../game/modules';
import { isSpecialistKind } from '../game/specialist-catalog';
import type { ReplayScene } from './presentation';
import { SHARED_REPLAY_LIMITS as L, type SharedReplay } from './timeline';

type Obj = Record<string, any>;
const factions = ['you', 'vesper', 'null', 'aether', 'umbra', 'orbit', 'prism', 'echo', 'nadir', 'zenith'];
function need(ok: unknown): asserts ok { if (!ok) throw new Error('Invalid shared replay'); }
const own = (o: Obj, k: string) => Object.hasOwn(o, k);
function object(v: unknown, required: string[], optional: string[] = []): asserts v is Obj {
  need(v !== null && typeof v === 'object' && !Array.isArray(v));
  need(required.every(k => own(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k)));
}
function array(v: unknown, max: number = L.records): asserts v is any[] { need(Array.isArray(v) && v.length <= max); }
function num(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): asserts v is number { need(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max); }
function integer(v: unknown, min = 0) { num(v, min); need(Number.isSafeInteger(v)); }
function text(v: unknown) { need(typeof v === 'string' && v.length > 0 && v.length <= L.text); }
function one(v: unknown, choices: readonly unknown[]) { need(choices.includes(v)); }
function faction(v: unknown) { one(v, factions); }
function optional(o: Obj, k: string, check: (v: any) => void) { if (own(o, k)) check(o[k]); }
function point(v: unknown) { object(v, ['x', 'y']); coord(v.x); coord(v.y); }
function coord(v: unknown) { num(v, -L.coordinate, L.coordinate); }
function unique(values: unknown[]) { need(new Set(values).size === values.length); }
function fingerprint(v: any): string {
  if (Array.isArray(v)) return `[${v.map(fingerprint).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${fingerprint(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Counts UTF-8 bytes without allocating an encoded copy; lone surrogates use replacement bytes. */
export function utf8Size(text: string): number {
  let size = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) size++;
    else if (c < 0x800) size += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
    else size += 3;
  }
  return size;
}

// Inspect descriptors before reading values so serialization cannot invoke getters or hooks.
function inspect(value: unknown) {
  let records = 0, bytes = 0;
  const active = new Set<object>();
  function visit(v: unknown, depth: number) {
    need(depth <= L.depth && ++records <= L.records);
    if (typeof v === 'string') { bytes += utf8Size(v); need(bytes <= L.bytes); return; }
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { need(Number.isFinite(v)); return; }
    need(typeof v === 'object' && v !== null && !active.has(v));
    need(Object.getPrototypeOf(v) === (Array.isArray(v) ? Array.prototype : Object.prototype) || Object.getPrototypeOf(v) === null);
    active.add(v);
    const keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) need(keys.length === v.length + 1);
    for (const key of keys) {
      need(typeof key === 'string');
      if (Array.isArray(v) && key === 'length') continue;
      if (Array.isArray(v)) need(/^(0|[1-9]\d*)$/.test(key) && Number(key) < v.length);
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      need(own(d, 'value') && d.enumerable);
      bytes += utf8Size(key); need(bytes <= L.bytes);
      visit(d.value, depth + 1);
    }
    active.delete(v);
  }
  visit(value, 1);
}

function rules(v: unknown) {
  object(v, ['players', 'mode', 'victoryTarget', 'map'], ['colors', 'pulse', 'tacticalPulse', 'portraits', 'mechanicsVersion', 'driftingBases', 'beltCompact', 'teams']);
  optional(v, 'beltCompact', n => one(n, [1]));
  array(v.players, factions.length); need(v.players.length >= 2); v.players.forEach(faction); unique(v.players);
  one(v.mode, ['pulse', 'mining', 'domination']); num(v.victoryTarget, Number.MIN_VALUE);
  optional(v, 'pulse', validatePulseConfig);
  need(v.mode !== 'pulse' || v.pulse && [15, 16, 17, 18].includes(v.mechanicsVersion));
  optional(v, 'tacticalPulse', validateTacticalPulseConfig);
  need(v.mode === 'pulse' && (v.mechanicsVersion ?? 1) >= 16 ? !!v.tacticalPulse : !v.tacticalPulse);
  optional(v, 'mechanicsVersion', n => one(n, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]));
  optional(v, 'teams', t => { need((v.mechanicsVersion ?? 1) >= 17 && v.mode !== 'pulse'); validateTeams(t, v.players); });
  need((v.mechanicsVersion ?? 1) >= 7 ? typeof v.driftingBases === 'boolean' : v.driftingBases === undefined);
  optional(v, 'colors', c => need(validPlayerColors(c, v.players.length)));
  optional(v, 'portraits', p => { array(p, factions.length); need(p.length === v.players.length); p.forEach(c => one(c, CHARACTER_IDS)); unique(p); });
  object(v.map, ['generator', 'width', 'height'], ['topology']); one(v.map.generator, ['balanced.v1', 'balanced.v2']);
  num(v.map.width, Number.MIN_VALUE, L.coordinate); num(v.map.height, Number.MIN_VALUE, L.coordinate); optional(v.map, 'topology', t => one(t, ['torus']));
}
function scene(v: unknown) : asserts v is ReplayScene {
  object(v, ['hour', 'rocks', 'fleets', 'coverage', 'cargo', 'eliminated', 'winner'], ['pulse', 'version', 'standings', 'draw', 'rules', 'compact', 'foresight', 'discoveries']);
  num(v.hour); optional(v, 'version', n => one(n, [1, 2])); optional(v, 'draw', n => one(n, [true])); optional(v, 'rules', rules);
  const roster: string[] = v.rules?.players ?? factions;
  need(!!v.rules?.beltCompact === !!v.compact);
  optional(v, 'compact', c => need(validCompact(c, roster as Faction[], v.hour, !!v.winner || !!v.draw, true)));
  const member = (f: unknown) => { faction(f); need(roster.includes(f as string)); };
  const units = new Set<string>(); let unitCount = 0;
  function manifest(items: unknown) {
    array(items, L.units); unitCount += items.length; need(unitCount <= L.units);
    for (const u of items) {
      object(u, ['id', 'kind', 'owner'], ['captive']); text(u.id); need(/^u[1-9]\d*$/.test(u.id)); integer(Number(u.id.slice(1)), 1);
      need(!units.has(u.id)); units.add(u.id); need(isSpecialistKind(u.kind)); member(u.owner); optional(u, 'captive', n => one(n, [true]));
    }
  }
  array(v.rocks, L.sites); const sites = new Set<string>();
  for (const r of v.rocks) {
    object(r, ['id', 'name', 'x', 'y', 'known', 'kind'], ['owner', 'drones', 'destroyed', 'coreOf', 'shield', 'shieldMax', 'shieldsDisabled', 'module', 'specialists', 'drift', 'sensorJammedUntil', 'miningDisabledUntil', 'reserves', 'stasisUntil', 'overclock']);
    text(r.id); text(r.name); need(!sites.has(r.id)); sites.add(r.id); coord(r.x); coord(r.y); one(r.known, [true, false]);
    one(r.kind, ['core', 'reactor', 'mine', 'factory', 'generator', 'unknown']);
    if (r.drift !== undefined) { need(driftingBasesEnabled(v) && validDrift(r.drift, v)); const expected = sitePosition(v, { x: r.x, y: r.y, drift: r.drift }, v.hour); need(Math.hypot(r.x - expected.x, r.y - expected.y) < 1e-8); }
    optional(r, 'owner', n => { if (n !== null) member(n); });
    if (!r.known) need(Object.keys(r).every(k => ['id', 'name', 'x', 'y', 'known', 'kind', 'owner', 'drift'].includes(k)));
    else { need(r.kind !== 'unknown' && own(r, 'drones')); num(r.drones); }
    optional(r, 'destroyed', n => one(n, [true])); optional(r, 'coreOf', member);
    optional(r, 'sensorJammedUntil', num); optional(r, 'miningDisabledUntil', num);
    optional(r, 'stasisUntil', n => { need(v.rules?.mechanicsVersion >= 18); num(n); });
    optional(r, 'overclock', loan => { need(v.rules?.mechanicsVersion >= 18); object(loan, ['boostUntil', 'debtUntil'], ['repaying']); num(loan.boostUntil); num(loan.debtUntil, loan.boostUntil); optional(loan, 'repaying', n => one(n, [true])); });
    optional(r, 'reserves', n => num(n, 0, PLANET_RESERVES));
    optional(r, 'shield', num); optional(r, 'shieldMax', num); optional(r, 'shieldsDisabled', n => one(n, [true, false]));
    optional(r, 'module', n => need(isModule(n))); optional(r, 'specialists', manifest);
  }
  array(v.fleets, L.fleets); const fleetIds = new Set<number>();
  for (const f of v.fleets) {
    object(f, ['id', 'owner', 'from', 'to', 'drones', 'departed', 'arrives'], ['preparing', 'returning', 'giftAt', 'module', 'specialists', 'speed', 'route', 'intercept', 'enginesDisabledUntil', 'sensorJammedUntil', 'heldAt']);
    integer(f.id, 1); need(!fleetIds.has(f.id)); fleetIds.add(f.id); member(f.owner); need(sites.has(f.from) && sites.has(f.to));
    num(f.drones); num(f.departed); num(f.arrives); need(f.arrives > f.departed);
    optional(f, 'heldAt', site => { need(v.rules?.mechanicsVersion >= 18 && sites.has(site) && f.to === site); });
    optional(f, 'enginesDisabledUntil', num); optional(f, 'sensorJammedUntil', num);
    optional(f, 'preparing', n => one(n, [true])); optional(f, 'returning', n => one(n, [true])); optional(f, 'giftAt', num);
    optional(f, 'module', n => need(isModule(n))); optional(f, 'specialists', manifest); optional(f, 'speed', n => num(n, Number.MIN_VALUE));
    optional(f, 'route', r => { object(r, ['from', 'to']); point(r.from); point(r.to); });
    optional(f, 'intercept', i => { object(i, ['home'], ['target']); need(sites.has(i.home)); optional(i, 'target', n => integer(n, 1)); });
  }
  for (const f of v.fleets) if (f.intercept && own(f.intercept, 'target')) need(fleetIds.has(f.intercept.target));
  array(v.coverage, L.sites + L.fleets); for (const c of v.coverage) { object(c, ['x', 'y', 'radius'], ['drift']); if (c.drift !== undefined) { need(driftingBasesEnabled(v) && validDrift(c.drift, v)); const expected = sitePosition(v, { x: c.x, y: c.y, drift: c.drift }, v.hour); need(Math.hypot(c.x - expected.x, c.y - expected.y) < 1e-8); } coord(c.x); coord(c.y); num(c.radius, 0, L.coordinate); }
  object(v.cargo, [], roster); Object.values(v.cargo).forEach(n => num(n));
  optional(v, 'standings', s => { object(s, [], roster); for (const n of Object.values(s)) { object(n, ['cargo', 'funders']); num(n.cargo); integer(n.funders); } });
  optional(v, 'pulse', s => {
    need(v.rules?.mode === 'pulse');
    object(s, ['kings', 'pulses', 'shields', 'modifiers'], ['tactical']);
    optional(s, 'tactical', t => {
      need(v.rules.tacticalPulse);
      object(t, ['charges', 'waves', 'resistance']);
      array(t.charges, 1000); array(t.waves, 1000);
      for (const c of t.charges) {
        object(c, ['id', 'specialistId', 'factionId', 'siteId', 'readyAt', 'resourceCost']);
        text(c.id); text(c.specialistId); member(c.factionId); need(sites.has(c.siteId)); num(c.readyAt); integer(c.resourceCost, 1);
      }
      for (const w of t.waves) {
        object(w, ['id', 'specialistId', 'factionId', 'origin', 'firedAt', 'initialStrength', 'attenuationPerDistance', 'radius', 'hitSites', 'hitFleets']);
        text(w.id); text(w.specialistId); member(w.factionId); point(w.origin); num(w.firedAt, 0, v.hour); num(w.initialStrength, Number.MIN_VALUE); num(w.attenuationPerDistance, Number.MIN_VALUE); num(w.radius);
        array(w.hitSites, L.sites); unique(w.hitSites); w.hitSites.forEach((id: string) => need(sites.has(id)));
        array(w.hitFleets, L.fleets); unique(w.hitFleets); w.hitFleets.forEach((id: number) => need(fleetIds.has(id)));
      }
      object(t.resistance, [], s.kings.map((k: Obj) => k.kingId)); Object.values(t.resistance).forEach(n => num(n));
    });
    array(s.kings, roster.length); array(s.pulses, roster.length); array(s.modifiers, 10000);
    for (const k of s.kings) {
      object(k, ['kingId', 'factionId', 'state', 'position', 'chargeProgress', 'resourceCommitted']);
      text(k.kingId); member(k.factionId); point(k.position); one(k.state, ['idle', 'charging', 'ready', 'firing', 'moving', 'destroyed']);
      num(k.chargeProgress, 0, v.rules.pulse.chargeDuration); num(k.resourceCommitted);
    }
    for (const p of s.pulses) {
      object(p, ['id', 'kingId', 'factionId', 'origin', 'firedAt', 'radius']);
      text(p.id); text(p.kingId); member(p.factionId); point(p.origin); num(p.firedAt, 0, v.hour); num(p.radius);
    }
    object(s.shields, [], [...sites]);
    for (const shield of Object.values(s.shields)) { object(shield, ['energy', 'exposed']); num(shield.energy, 0, v.rules.pulse.shieldMaxEnergy); integer(shield.exposed); }
    for (const m of s.modifiers) {
      object(m, ['factionId', 'type', 'multiplier', 'expiresAt']); member(m.factionId); one(m.type, ['charge_rate', 'pulse_speed', 'shield_drain']); num(m.multiplier, 0, 100); num(m.expiresAt, v.hour);
    }
  });
  optional(v, 'foresight', warnings => { need(v.rules?.mechanicsVersion >= 18); array(warnings, L.units); for (const w of warnings) { object(w, ['specialistId', 'deathAt', 'source']); need(units.has(w.specialistId)); num(w.deathAt); text(w.source); } });
  optional(v, 'discoveries', discoveries => { need(v.rules?.mechanicsVersion >= 18); array(discoveries, 80); for (const d of discoveries) { object(d, ['hour', 'discoveredAt', 'message']); num(d.hour, 0, v.hour); num(d.discoveredAt, d.hour, v.hour); text(d.message); } });
  array(v.eliminated, factions.length); v.eliminated.forEach(member); unique(v.eliminated); if (v.winner !== null) member(v.winner);
}
function validate(value: unknown): asserts value is SharedReplay {
  inspect(value);
  object(value, ['kind', 'schemaVersion', 'presentationVersion', 'history', 'perspective', 'from', 'through', 'groups', 'spans']);
  one(value.kind, ['machination.observed-timeline']); one(value.schemaVersion, [1, 2]); one(value.presentationVersion, [1]); one(value.history, ['canonical-events']); faction(value.perspective);
  num(value.from); num(value.through); need(value.through >= value.from);
  array(value.groups); array(value.spans); need(value.groups.length > 0 && value.spans.length === value.groups.length - 1);
  const perspective = value.perspective;
  const schemaVersion = value.schemaVersion;
  let chart: string | undefined, publicRules: string | undefined;
  function frame(s: unknown, hour: number) {
    scene(s); need(s.hour === hour);
    need((schemaVersion === 2) === s.rocks.some(r => !!r.drift));
    const nextChart = fingerprint(s.rocks.map(r => ({ id: r.id, name: r.name, ...(r.drift ? { drift: r.drift } : { x: r.x, y: r.y }) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const nextRules = fingerprint(s.rules ?? null);
    if (chart === undefined) { chart = nextChart; publicRules = nextRules; }
    need(chart === nextChart && publicRules === nextRules);
    if (s.rules) need(s.rules.players.includes(perspective));
  }
  for (let i = 0; i < value.groups.length; i++) {
    const g = value.groups[i]; object(g, ['hour', 'states']); num(g.hour); array(g.states); need(g.states.length > 0);
    need(i === 0 ? g.hour === value.from : g.hour > value.groups[i - 1].hour);
    g.states.forEach(s => frame(s, g.hour));
  }
  need(value.groups[value.groups.length - 1].hour === value.through);
  for (let i = 0; i < value.spans.length; i++) {
    const s = value.spans[i]; object(s, ['from', 'through', 'scene']);
    need(s.from === value.groups[i].hour && s.through === value.groups[i + 1].hour && s.through > s.from); frame(s.scene, s.from);
  }
}

export function encodeSharedReplay(value: SharedReplay): string {
  validate(value);
  const raw = JSON.stringify(value); need(utf8Size(raw) <= L.bytes); return raw;
}
export function decodeSharedReplay(raw: string): SharedReplay {
  need(typeof raw === 'string' && raw.length <= L.bytes && utf8Size(raw) <= L.bytes);
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') { need(++depth <= L.depth); }
    else if (c === '}' || c === ']') need(--depth >= 0);
  }
  need(depth === 0 && !quoted);
  const value: unknown = JSON.parse(raw); validate(value); return value;
}
