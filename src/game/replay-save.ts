/**
 * ---
 * purpose: Validate private persisted command history and prove it reconstructs the saved live operation.
 * ---
 */
import { advance, FACTIONS, type Game } from './simulation';
import { decodeSave } from './save-format';
import { isModule } from './modules';
import { isSpecialistKind } from './specialist-catalog';
import { replayTo, restoreArchive, type ReplayArchive, type ReplayData } from './replay';
export const MAX_REPLAY_COMMANDS = 10_000;
export const MAX_REPLAY_CHARACTERS = 16 * 1024 * 1024;
const MAX_INACTIVITY_COMMANDS = Object.keys(FACTIONS).length;
const INACTIVITY_CHARACTER_RESERVE = 1024;
export function replayFits(data: ReplayData, systemReserve = false): boolean {
  const automatic = data.entries.filter(entry => entry?.command?.type === 'inactivity').length;
  return automatic <= MAX_INACTIVITY_COMMANDS && data.entries.length - automatic <= MAX_REPLAY_COMMANDS
    && JSON.stringify(data).length <= MAX_REPLAY_CHARACTERS + (systemReserve ? INACTIVITY_CHARACTER_RESERVE : 0);
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9:-]{1,80}$/.test(v);
const owner = (v: unknown) => typeof v === 'string' && Object.hasOwn(FACTIONS, v);
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function shape(v: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(v, key)) && Object.keys(v).every(key => required.includes(key) || optional.includes(key));
}
function payload(v: Record<string, unknown>): boolean {
  return text(v.from) && text(v.to) && count(v.drones) && (v.carryModule === undefined || typeof v.carryModule === 'boolean')
    && (v.specialists === undefined || Array.isArray(v.specialists) && v.specialists.length <= 10_000 && v.specialists.every(text) && new Set(v.specialists).size === v.specialists.length);
}
function command(v: unknown): boolean {
  if (!record(v)) return false;
  if (v.type === 'inactivity') return shape(v, ['type', 'owners']) && Array.isArray(v.owners) && v.owners.length > 0 && v.owners.length <= 3 && v.owners.every(owner) && new Set(v.owners).size === v.owners.length;
  if (!owner(v.owner)) return false;
  const keys = ['type', 'owner'];
  switch (v.type) {
    case 'resign': return shape(v, keys);
    case 'dispatch': case 'gift': return shape(v, [...keys, 'from', 'to', 'drones', ...(v.type === 'gift' ? ['recipient'] : [])], ['specialists', 'carryModule']) && payload(v) && (v.type !== 'gift' || owner(v.recipient));
    case 'intercept': return shape(v, [...keys, 'from', 'target', 'drones'], ['specialists']) && payload({ ...v, to: v.from }) && count(v.target) && v.target !== 0;
    case 'hauler': {
      const c = v.change;
      if (!shape(v, [...keys, 'change']) || !record(c) || !count(c.fleet) || c.fleet === 0) return false;
      if (c.action === 'edit-launch') return shape(c, ['action', 'fleet', 'drones'], ['specialists']) && payload({ ...c, from: 'site', to: 'site' });
      if (c.action === 'course') return shape(c, ['action', 'fleet', 'to']) && text(c.to);
      return ['cancel-launch', 'gift', 'cancel-gift'].includes(c.action as string) && shape(c, ['action', 'fleet']);
    }
    case 'schedule': return shape(v, [...keys, 'plan']) && record(v.plan) && shape(v.plan, ['id', 'from', 'to', 'drones', 'executeAt'], ['specialists', 'carryModule']) && text(v.plan.id) && finite(v.plan.executeAt) && payload(v.plan);
    case 'cancel-schedule': case 'promote': case 'release': return shape(v, [...keys, 'id']) && text(v.id);
    case 'hire': return shape(v, [...keys, 'kind']) && isSpecialistKind(v.kind);
    case 'drill-mine': return shape(v, [...keys, 'rock']) && text(v.rock);
    case 'shields': return shape(v, [...keys, 'rock', 'disabled']) && text(v.rock) && typeof v.disabled === 'boolean';
    case 'funding': return shape(v, [...keys, 'to', 'enabled']) && owner(v.to) && typeof v.enabled === 'boolean';
    case 'install-module': return shape(v, [...keys, 'rock', 'kind']) && text(v.rock) && isModule(v.kind);
    default: return false;
  }
}
function canonical(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : record(v) ? Object.fromEntries(Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => [k, normalize(v[k])])) : v;
  return JSON.stringify(normalize(value));
}
export function decodeReplay(input: unknown, live: Game, rivals: boolean): ReplayArchive {
  try {
    if (!record(input) || !shape(input, ['version', 'rules', 'baseline', 'entries', 'rivals']) || input.version !== 1 || input.rules !== 1 || input.rivals !== rivals || !Array.isArray(input.entries) || input.entries.length > MAX_REPLAY_COMMANDS + MAX_INACTIVITY_COMMANDS || !replayFits(input as ReplayData, true)) throw new Error();
    const baseline = decodeSave(JSON.stringify({ savedAt: 0, game: input.baseline })).game;
    if (baseline.hour > live.hour || baseline.epoch !== live.epoch || baseline.version !== live.version) throw new Error();
    let previous = baseline.hour;
    for (const entry of input.entries) {
      if (!record(entry) || !shape(entry, ['hour', 'command']) || !finite(entry.hour) || entry.hour < previous || entry.hour > live.hour || !command(entry.command) || rivals && (entry.command as { owner: string }).owner !== 'you') throw new Error();
      previous = entry.hour;
    }
    const data = { version: 1, rules: 1, baseline, entries: input.entries, rivals } as ReplayData;
    const archive = restoreArchive(data);
    const reconstructed = replayTo(archive, live.hour, { rivals, knownThrough: live.hour });
    if (canonical(advance(reconstructed, reconstructed.hour, { rivals })) !== canonical(advance(live, live.hour, { rivals }))) throw new Error();
    return archive;
  } catch { throw new Error('Saved history is damaged or does not match this operation.'); }
}
