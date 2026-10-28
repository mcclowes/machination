import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch } from '../game/simulation';
import { observe } from '../game/visibility';
import { copyableReference, focusReferenceCamera, referenceInspectionHour, resolveReference } from './reference-inspection';
import type { ObjectReference } from './protocol';

test('chat references inspect recipient aliases only inside the requested observed frame', () => {
  const initial = createGame(0);
  initial.rocks[0]!.drones = 20;
  const game = dispatch(initial, 'a', 'b', 10, 'you');
  const reference: ObjectReference = { version: 1, gameId: 'a'.repeat(24), kind: 'hauler', ref: 'b'.repeat(64), hour: 0 };
  const frame = { id: reference.gameId, at: 0, game: observe(game, 'you', () => 900), references: { version: 1 as const, outposts: [], haulers: [{ id: 900, ref: reference.ref }] } };
  const result = resolveReference(frame, reference, 'observed');
  assert.equal(result?.kind, 'hauler');
  assert.equal(result?.id, 900);
  assert.equal(resolveReference({ ...frame, at: 1 }, reference, 'observed'), undefined);
  assert.equal(resolveReference({ ...frame, id: 'c'.repeat(24) }, reference, 'now'), undefined);
  assert.equal(resolveReference({ ...frame, references: { ...frame.references, haulers: [] } }, reference, 'now'), undefined);
  assert.equal(resolveReference({ ...frame, game: { ...frame.game, fleets: [] } }, reference, 'now'), undefined);
  assert.equal(resolveReference({ ...frame, references: undefined }, reference, 'now'), undefined);
  const other = { ...frame, game: observe(game, 'you', () => 901), references: { ...frame.references, haulers: [{ id: 901, ref: reference.ref }] } };
  assert.equal(resolveReference(other, reference, 'now')?.id, 901);
});

test('inspection never silently replaces a wrong game or unavailable copied hour with live time', () => {
  const snapshot = { id: 'a'.repeat(24), game: { hour: 10 }, history: { from: 2, through: 10 } };
  const reference: ObjectReference = { version: 1, gameId: snapshot.id, kind: 'outpost', ref: 'b'.repeat(64), hour: 4.123456789 };
  assert.equal(referenceInspectionHour(snapshot, reference, 'observed'), reference.hour);
  assert.equal(referenceInspectionHour(snapshot, reference, 'now'), null);
  assert.throws(() => referenceInspectionHour(snapshot, { ...reference, gameId: 'c'.repeat(24) }, 'now'), /another operation/);
  for (const hour of [0, 1.999, 10.001, NaN, Infinity]) assert.throws(() => referenceInspectionHour(snapshot, { ...reference, hour }, 'observed'), /available observed history/);
  assert.throws(() => referenceInspectionHour({ ...snapshot, history: undefined }, reference, 'observed'), /available observed history/);
});

test('public outpost references keep hidden detail redacted and center seam locations', () => {
  const game = createGame(0);
  const view = observe(game, 'you');
  const remote = view.rocks.find(r => !r.known)!;
  const frame = { id: 'a'.repeat(24), at: 8, game: view, references: { version: 1 as const, outposts: [{ id: remote.id, ref: 'b'.repeat(64) }], haulers: [] } };
  const reference = copyableReference(frame, 'outpost', remote.id)!;
  assert.equal(reference.hour, 8, 'requested observation time can exceed a terminal simulation hour');
  assert.deepEqual(resolveReference(frame, reference, 'observed'), { kind: 'outpost', id: remote.id, point: { x: remote.x, y: remote.y } });
  assert.equal(copyableReference(frame, 'hauler', 1), undefined);
  assert.equal(copyableReference({ ...frame, references: undefined }, 'outpost', remote.id), undefined);
  assert.equal(resolveReference(frame, { ...reference, kind: 'hauler' }, 'observed'), undefined);
  assert.equal(remote.drones, undefined);
  const torus = { ...view, rules: { mechanicsVersion: 4 as const, players: ['you', 'vesper'] as import('../game/players').Faction[], mode: 'domination' as const, victoryTarget: 10, map: { generator: 'balanced.v2' as const, topology: 'torus' as const, width: 200, height: 100 } } };
  const point = { x: 198, y: 1 };
  const camera = focusReferenceCamera(torus, { scale: 1, x: 0, y: 0 }, point);
  assert.equal(camera.scale, 2);
  const projectedX = (point.x / 200 * 100 - 50) * camera.scale + 50 + camera.x;
  const projectedY = (point.y / 100 * 100 - 50) * camera.scale + 50 + camera.y;
  assert.equal(projectedX, 50);
  assert.equal(projectedY, 50);
});
