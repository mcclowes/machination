/**
 * ---
 * purpose: Strict queued-order decoding and detached canonical payloads for stable command retries.
 * related:
 *   - ./service.ts - authorization, transaction ownership, and queued-order execution
 * ---
 */
import type { EditSchedule, ScheduleOrder } from '../src/online/protocol';
import type { HaulerChange } from '../src/game/transport';
import { validateFutureAction } from '../src/game/future-actions';
import { validateLaunchEdit } from '../src/game/orders';
import { Failure } from './failure';

function canonicalHaulerChange(change: HaulerChange): HaulerChange {
  switch (change.action) {
    case 'edit-launch': return { action: change.action, fleet: change.fleet, drones: change.drones,
      ...(change.specialists !== undefined ? { specialists: [...change.specialists] } : {}) };
    case 'course': return { action: change.action, fleet: change.fleet, to: change.to };
    default: return { action: change.action, fleet: change.fleet };
  }
}

export function canonicalSchedule(input: unknown): ScheduleOrder {
  const invalid = () => new Failure(400, 'schedule.validation.payload', 'Provide a supported future order.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  const action = Object.hasOwn(value, 'action');
  const required = ['requestId', 'revision', 'executeAt', ...(action ? ['action'] : ['from', 'to', 'drones'])];
  const allowed = [...required, ...(action ? [] : ['specialists', 'carryModule'])];
  if (!required.every(key => Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.includes(key))
    || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || typeof value.executeAt !== 'number' || !Number.isFinite(value.executeAt)) throw invalid();
  const base = { requestId: value.requestId, revision: value.revision as number, executeAt: value.executeAt };
  if (action) {
    try {
      const action = validateFutureAction(value.action);
      const manifest = 'specialists' in action && action.specialists !== undefined ? { specialists: [...action.specialists] } : {};
      switch (action.type) {
        case 'gift': return { ...base, action: { type: 'gift', from: action.from, to: action.to, drones: action.drones, recipient: action.recipient,
          ...(action.carryModule !== undefined ? { carryModule: action.carryModule } : {}), ...manifest } };
        case 'intercept': return { ...base, action: { type: 'intercept', from: action.from, target: action.target, drones: action.drones, ...manifest } };
        case 'hauler': return { ...base, action: { type: 'hauler', change: canonicalHaulerChange(action.change) } };
        default: return { ...base, action };
      }
    }
    catch { throw invalid(); }
  }
  if (typeof value.from !== 'string' || typeof value.to !== 'string' || !Number.isSafeInteger(value.drones)
    || value.carryModule !== undefined && typeof value.carryModule !== 'boolean'
    || value.specialists !== undefined && (!Array.isArray(value.specialists) || value.specialists.length > 10000
      || value.specialists.some(id => typeof id !== 'string') || new Set(value.specialists).size !== value.specialists.length)) throw invalid();
  return { ...base, from: value.from, to: value.to, drones: value.drones as number,
    ...(value.carryModule !== undefined ? { carryModule: value.carryModule as boolean } : {}),
    ...(value.specialists !== undefined ? { specialists: [...value.specialists as string[]] } : {}) };
}

export function canonicalScheduleEdit(input: unknown): EditSchedule {
  const invalid = () => new Failure(400, 'schedule.validation.payload', 'Provide a queued launch manifest edit.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['requestId', 'revision', 'planId', 'drones', 'specialists'].includes(key))
    || !Object.hasOwn(value, 'requestId') || !Object.hasOwn(value, 'revision')
    || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw invalid();
  let change;
  try {
    change = validateLaunchEdit({ planId: value.planId, drones: value.drones,
      ...(Object.hasOwn(value, 'specialists') ? { specialists: value.specialists } : {}) });
  } catch { throw invalid(); }
  return { requestId: value.requestId, revision: value.revision as number, ...change };
}
