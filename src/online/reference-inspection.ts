/** Resolve shared identity only within the recipient's observed frame. */
import { fleetPosition } from '../game/flight';
import { focusCamera, type MapCamera } from '../game/chart-camera';
import type { GameView } from '../game/visibility';
import type { ObjectReference, ObjectReferences } from './protocol';

export type ReferenceFrame = { id: string; at: number; game: GameView; references?: ObjectReferences };
export type ReferenceTarget = { point: { x: number; y: number } } & ({ kind: 'outpost'; id: string } | { kind: 'hauler'; id: number });

export function referenceInspectionHour(snapshot: { id: string; game: { hour: number }; history?: { from: number; through: number } }, reference: ObjectReference, mode: 'observed' | 'now'): number | null {
  if (reference.gameId !== snapshot.id) throw new Error('This reference belongs to another operation.');
  if (mode === 'now') return null;
  const from = snapshot.history?.from ?? snapshot.game.hour;
  if (!Number.isFinite(reference.hour) || reference.hour < from || reference.hour > snapshot.game.hour) throw new Error('The copied hour is outside the available observed history. Refresh live observations or choose Inspect now.');
  return reference.hour;
}

export function resolveReference(frame: ReferenceFrame, reference: ObjectReference, mode: 'observed' | 'now'): ReferenceTarget | undefined {
  if (reference.gameId !== frame.id || mode === 'observed' && frame.at !== reference.hour || frame.references?.version !== 1) return;
  if (reference.kind === 'outpost') {
    const identity = frame.references.outposts.find(item => item.ref === reference.ref);
    const rock = identity && frame.game.rocks.find(r => r.id === identity.id);
    return rock ? { kind: 'outpost', id: rock.id, point: { x: rock.x, y: rock.y } } : undefined;
  }
  const identity = frame.references.haulers.find(item => item.ref === reference.ref);
  const fleet = identity && frame.game.fleets.find(f => f.id === identity.id);
  return fleet ? { kind: 'hauler', id: fleet.id, point: fleetPosition(frame.game, fleet) } : undefined;
}

export function copyableReference(frame: ReferenceFrame, kind: ObjectReference['kind'], id: string | number): ObjectReference | undefined {
  const entry = kind === 'outpost' ? frame.references?.outposts.find(item => item.id === id) : frame.references?.haulers.find(item => item.id === id);
  if (!entry || !resolveReference(frame, { version: 1, gameId: frame.id, kind, ref: entry.ref, hour: frame.at }, 'observed')) return;
  return { version: 1, gameId: frame.id, kind, ref: entry.ref, hour: frame.at };
}

export function focusReferenceCamera(game: GameView, camera: MapCamera, point: { x: number; y: number }): MapCamera {
  return focusCamera(game, camera, point);
}
