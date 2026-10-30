/**
 * ---
 * purpose: Validate client-visible observations before rendering or reconstructing a forecast.
 * related:
 *   - ./visibility.ts - observed view contract and producer
 *   - ../online/snapshot-response.ts - live and historical envelope decoding
 * ---
 */
import { validCompact } from './compact-save';
import { validDrift } from './drift';
import { validateFutureAction } from './future-actions';
import { isModule } from './modules';
import { playersIn, isFaction, type Faction } from './players';
import { validateRules, type PublicRules } from './rules';
import { isSpecialistKind } from './specialist-catalog';
import type { Fleet } from './simulation';
import type { GameView, ObservedRock } from './visibility';

type ObjectValue = Record<string, unknown>;
type World = { players: readonly Faction[]; rules?: PublicRules };
const record = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const count = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const fleetId = (value: unknown): value is number => count(value) && value > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const point = (value: unknown) => record(value) && finite(value.x) && finite(value.y);
const list = (value: unknown, check: (item: unknown) => boolean) => Array.isArray(value) && value.every(check);
const optional = (value: ObjectValue, key: string, check: (item: unknown) => boolean) => value[key] === undefined || check(value[key]);
const player = (value: unknown, world: World): value is Faction => isFaction(value) && world.players.includes(value);
const flag = (value: unknown) => value === true;
const boolean = (value: unknown) => typeof value === 'boolean';
const numbers = (value: ObjectValue, keys: string[]) => keys.every(key => optional(value, key, nonnegative));
function playerValues(value: unknown, world: World, check: (item: unknown) => boolean): boolean {
  return record(value) && Object.entries(value).every(([key, item]) => player(key, world) && check(item));
}
function publicRules(value: unknown): value is PublicRules {
  if (!record(value) || !record(value.map) || Object.hasOwn(value.map, 'seed')) return false;
  try { validateRules({ ...value, map: { ...value.map, seed: 0 } }); return true; } catch { return false; }
}
function units(value: unknown, world: World): boolean {
  return value === undefined || list(value, unit => record(unit) && text(unit.id) && player(unit.owner, world) && isSpecialistKind(unit.kind)
    && optional(unit, 'captive', flag) && numbers(unit, ['nextActionAt', 'lastCourseAt']));
}
function rock(value: unknown, world: World): value is ObservedRock {
  if (!record(value) || !text(value.id) || typeof value.name !== 'string' || !point(value) || typeof value.known !== 'boolean'
    || !['core', 'reactor', 'mine', 'factory', 'generator', 'unknown'].includes(value.kind as string)
    || !optional(value, 'drift', drift => validDrift(drift, world))) return false;
  if (!value.known) return optional(value, 'owner', owner => owner === null || player(owner, world))
    && ['destroyed', 'drones', 'module', 'specialists', 'coreOf'].every(key => value[key] === undefined);
  return value.kind !== 'unknown' && (value.owner === null || player(value.owner, world)) && nonnegative(value.drones)
    && numbers(value, ['reserves', 'supplyAt', 'shield', 'shieldMax', 'shieldAt', 'productionAt', 'productionInterval', 'miningAt', 'miningInterval', 'sensorJammedUntil', 'miningDisabledUntil'])
    && optional(value, 'shieldBonus', finite) && optional(value, 'coreOf', owner => player(owner, world)) && optional(value, 'module', isModule)
    && optional(value, 'shieldsDisabled', boolean) && optional(value, 'destroyed', flag) && optional(value, 'pulseDisabled', flag) && units(value.specialists, world);
}
function fleet(value: unknown, world: World, sites: ReadonlySet<string>): value is Fleet {
  if (!record(value) || !fleetId(value.id) || !player(value.owner, world) || !text(value.from) || !text(value.to) || !sites.has(value.from) || !sites.has(value.to)
    || !count(value.drones) || !nonnegative(value.departed) || !nonnegative(value.arrives) || value.arrives <= value.departed
    || !units(value.specialists, world) || !optional(value, 'module', isModule)
    || !numbers(value, ['speed', 'giftAt', 'enginesDisabledUntil', 'sensorJammedUntil'])
    || !['preparing', 'courseChanged', 'returning', 'interceptionReturn', 'courseLocked'].every(key => optional(value, key, flag))
    || !optional(value, 'thrust', thrust => thrust === 1.5)) return false;
  if (!optional(value, 'route', route => record(route) && point(route.from) && point(route.to))) return false;
  if (!optional(value, 'intercept', intercept => record(intercept) && text(intercept.home) && sites.has(intercept.home) && optional(intercept, 'target', fleetId))) return false;
  if (!optional(value, 'pendingCourse', course => record(course) && player(course.owner, world) && text(course.to) && sites.has(course.to) && nonnegative(course.executeAt))) return false;
  return optional(value, 'lastContacts', contacts => list(contacts, contact => record(contact) && fleetId(contact.id) && nonnegative(contact.hour)));
}
function plan(value: unknown, world: World, sites: ReadonlySet<string>): boolean {
  if (!record(value) || !text(value.id) || !player(value.owner, world) || !nonnegative(value.executeAt) || !optional(value, 'fleetId', fleetId)) return false;
  if (Object.hasOwn(value, 'action')) {
    try { validateFutureAction(value.action); } catch { return false; }
    return optional(value, 'hireCycle', count) && optional(value, 'hireUnits', ids => list(ids, text));
  }
  return text(value.from) && text(value.to) && sites.has(value.from) && sites.has(value.to) && count(value.drones)
    && optional(value, 'module', isModule) && optional(value, 'specialists', ids => list(ids, text));
}

function pulse(value: unknown, world: World, sites: ReadonlySet<string>): boolean {
  if (world.rules?.mode !== 'pulse') return value === undefined;
  if (!record(value) || !list(value.kings, king => record(king) && text(king.kingId) && player(king.factionId, world) && point(king.position)
    && ['idle', 'charging', 'ready', 'firing', 'moving', 'destroyed'].includes(king.state as string) && nonnegative(king.chargeProgress) && nonnegative(king.resourceCommitted))
    || !list(value.pulses, wave => record(wave) && text(wave.id) && text(wave.kingId) && player(wave.factionId, world) && point(wave.origin) && nonnegative(wave.firedAt) && nonnegative(wave.radius))
    || !record(value.shields) || !Object.entries(value.shields).every(([id, shield]) => sites.has(id) && record(shield) && nonnegative(shield.energy) && count(shield.exposed))
    || !list(value.modifiers, modifier => record(modifier) && player(modifier.factionId, world) && ['charge_rate', 'pulse_speed', 'shield_drain'].includes(modifier.type as string)
      && nonnegative(modifier.multiplier) && nonnegative(modifier.expiresAt))) return false;
  if (!world.rules.tacticalPulse) return value.tactical === undefined;
  const tactical = value.tactical;
  return record(tactical) && list(tactical.charges, charge => record(charge) && text(charge.id) && text(charge.specialistId) && player(charge.factionId, world)
    && text(charge.siteId) && sites.has(charge.siteId) && nonnegative(charge.readyAt) && count(charge.resourceCost))
    && list(tactical.waves, wave => record(wave) && text(wave.id) && text(wave.specialistId) && player(wave.factionId, world) && point(wave.origin)
      && nonnegative(wave.firedAt) && nonnegative(wave.initialStrength) && nonnegative(wave.attenuationPerDistance) && nonnegative(wave.radius)
      && list(wave.hitSites, id => typeof id === 'string' && sites.has(id)) && list(wave.hitFleets, fleetId))
    && record(tactical.resistance) && Object.entries(tactical.resistance).every(([id, until]) => text(id) && nonnegative(until));
}

export function validObservation(value: unknown): value is GameView {
  if (!record(value) || !nonnegative(value.hour) || !nonnegative(value.epoch)
    || !optional(value, 'rules', publicRules) || !optional(value, 'version', version => version === 1 || version === 2)) return false;
  const rules = value.rules as PublicRules | undefined;
  const world: World = { rules, players: playersIn({ rules }) };
  if (!Array.isArray(value.rocks) || !value.rocks.every((item): item is ObservedRock => rock(item, world))) return false;
  const sites = new Set(value.rocks.map(site => site.id));
  if (sites.size !== value.rocks.length || !Array.isArray(value.fleets) || !value.fleets.every((item): item is Fleet => fleet(item, world, sites))
    || new Set(value.fleets.map(item => item.id)).size !== value.fleets.length || !list(value.scheduled, item => plan(item, world, sites))) return false;
  const unitIds = [...value.rocks, ...value.fleets].flatMap(asset => asset.specialists?.map(unit => unit.id) ?? []);
  if (new Set(unitIds).size !== unitIds.length) return false;
  if (!list(value.events, event => record(event) && nonnegative(event.hour) && typeof event.message === 'string')
    || !list(value.coverage, sensor => record(sensor) && point(sensor) && nonnegative(sensor.radius) && optional(sensor, 'drift', drift => validDrift(drift, world)))
    || !list(value.uncertain, text) || typeof value.interceptionUncertain !== 'boolean'
    || !playerValues(value.cargo, world, nonnegative) || !Array.isArray(value.eliminated) || !value.eliminated.every(owner => player(owner, world))
    || new Set(value.eliminated).size !== value.eliminated.length || !(value.winner === null || player(value.winner, world)) || !optional(value, 'draw', flag)) return false;
  if (!['forecastUncertain', 'fundingUncertain', 'recruitmentUncertain'].every(key => optional(value, key, boolean))
    || !optional(value, 'recruitment', states => playerValues(states, world, state => record(state) && count(state.used) && list(state.offers, isSpecialistKind)))
    || !optional(value, 'funding', states => list(states, state => record(state) && player(state.from, world) && player(state.to, world)))
    || !optional(value, 'standings', states => playerValues(states, world, state => record(state) && nonnegative(state.cargo) && count(state.funders)))
    || !optional(value, 'minesDrilled', states => playerValues(states, world, count))) return false;
  if (!pulse(value.pulse, world, sites)) return false;
  return value.compact === undefined ? rules?.beltCompact === undefined
    : rules?.beltCompact === 1 && validCompact(value.compact, world.players, value.hour, !!value.winner || !!value.draw);
}
