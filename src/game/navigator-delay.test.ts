import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance, dispatch } from './simulation';
import { fleetPosition } from './flight';
import { changeCourse } from './specialist-navigation';
import { commandHauler } from './transport';
import { observe, forecastObservation } from './visibility';
import { presentObservation } from '../replay/presentation';
import { decodeSave } from './save-format';
import { applyCommand, createArchive, exportArchive, replayTo } from './replay';
import { decodeReplay } from './replay-save';
import { scheduleAction } from './future-actions';
import { resign } from './retirement';
import { generateSharedReplay } from '../replay/generate';
import { decodeSharedReplay, encodeSharedReplay } from '../replay/codec';
import { seekReplay, replayFleetPosition } from '../replay/playback';

function traveling() {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
  game.rules!.mechanicsVersion = 10; game.rules!.map.width = 200; game.rules!.map.height = 200;
  for (const rock of game.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const target = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  const destination = game.rocks.find(r => r.owner === null)!;
  Object.assign(source, { x: 20, y: 20 }); Object.assign(target, { x: 68, y: 20 }); Object.assign(destination, { x: 20, y: 100 });
  source.specialists!.push({ id: 'delayed-nav', owner: 'you', kind: 'navigator' });
  game.hour = 11;
  const sent = dispatch(game, source.id, target.id, 10, 'you', false, ['delayed-nav']);
  return { game: advance(sent, 11.5, { rivals: false }), destination };
}

test('Navigator orders preserve the old course for ten actual minutes before turning', () => {
  const { game, destination } = traveling();
  const fleet = game.fleets[0]!;
  const pending = changeCourse(game, fleet.id, 'you', destination.id);
  assert.equal(pending.fleets[0]!.to, fleet.to);
  assert.equal(pending.fleets[0]!.arrives, fleet.arrives);
  assert.equal(pending.fleets[0]!.pendingCourse!.executeAt, game.hour + 1 / 6);
  const at = game.hour + 1 / 6;
  const oldPoint = fleetPosition({ ...game, hour: at }, fleet);
  const end = advance(pending, at, { rivals: false });
  assert.equal(end.fleets[0]!.to, destination.id);
  assert.deepEqual(fleetPosition(end, end.fleets[0]!), oldPoint);
  assert.equal(end.fleets[0]!.specialists![0]!.lastCourseAt, at);
  assert.equal(end.fleets[0]!.pendingCourse, undefined);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: pending })).game, pending);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  assert.deepEqual(advance(advance(pending, at - 1e-9, { rivals: false }), at, { rivals: false }), end);
});

test('canceling a pending turn keeps the original route without spending the cooldown', () => {
  const { game, destination } = traveling(); const fleet = game.fleets[0]!;
  const ordered = applyCommand(createArchive(game), { type: 'hauler', owner: 'you', change: { action: 'course', fleet: fleet.id, to: destination.id } }, { rivals: false, knownThrough: game.hour });
  assert.throws(() => changeCourse(ordered.game, fleet.id, 'you', destination.id), /Cancel the pending/);
  const canceled = applyCommand(ordered.archive, { type: 'hauler', owner: 'you', change: { action: 'cancel-course', fleet: fleet.id } }, { rivals: false, knownThrough: game.hour + .08 });
  assert.equal(canceled.game.fleets[0]!.pendingCourse, undefined);
  assert.equal(canceled.game.fleets[0]!.to, fleet.to);
  assert.equal(canceled.game.fleets[0]!.specialists![0]!.lastCourseAt, undefined);
  const loaded = decodeSave(JSON.stringify({ savedAt: 0, game: canceled.game })).game;
  assert.doesNotThrow(() => decodeReplay(exportArchive(canceled.archive), loaded, false));
  assert.doesNotThrow(() => changeCourse(canceled.game, fleet.id, 'you', destination.id));
});

test('pending turns are private while their physical execution appears in forecast and replay', () => {
  const { game, destination } = traveling(); const id = game.fleets[0]!.id;
  const ordered = applyCommand(createArchive(game), { type: 'hauler', owner: 'you', change: { action: 'course', fleet: id, to: destination.id } }, { rivals: false, knownThrough: game.hour });
  const pending = ordered.game, at = pending.fleets[0]!.pendingCourse!.executeAt;
  assert.ok(observe(pending, 'you').fleets[0]!.pendingCourse);
  assert.equal(observe(pending, 'vesper').fleets.find(f => f.id === id)!.pendingCourse, undefined);
  assert.equal('pendingCourse' in presentObservation(observe(pending, 'you')).fleets[0]!, false);
  const end = advance(pending, at, { rivals: false });
  const forecast = forecastObservation(observe(pending, 'you'), 'you', at);
  assert.equal(forecast.fleets[0]!.to, destination.id);
  assert.deepEqual(fleetPosition(forecast, forecast.fleets[0]!), fleetPosition(end, end.fleets[0]!));
  assert.deepEqual(replayTo(ordered.archive, at, { knownThrough: at, rivals: false }), end);
  const raw = encodeSharedReplay(generateSharedReplay({ game: end, archive: ordered.archive }, 'you', game.hour, at));
  assert.equal(raw.includes('pendingCourse'), false);
  const replay = decodeSharedReplay(raw);
  const before = seekReplay(replay, at - 1e-9), after = seekReplay(replay, at);
  assert.equal(before.fleets[0]!.to, game.fleets[0]!.to);
  assert.equal(after.fleets[0]!.to, destination.id);
  assert.deepEqual(replayFleetPosition(after, after.fleets[0]!), fleetPosition(end, end.fleets[0]!));
});

test('cancellation ends at the effective turn and the cooldown starts when the turn occurs', () => {
  const { game, destination } = traveling(); const id = game.fleets[0]!.id;
  const pending = changeCourse(game, id, 'you', destination.id);
  const at = pending.fleets[0]!.pendingCourse!.executeAt;
  assert.throws(() => commandHauler({ ...pending, hour: at }, 'you', { action: 'cancel-course', fleet: id }));
  const turned = advance(pending, at, { rivals: false });
  assert.throws(() => changeCourse(advance(turned, at + 8 - 1 / 6 - 1e-9, { rivals: false }), id, 'you', game.fleets[0]!.to), /eight hours/);
  const ready = advance(turned, at + 8 - 1 / 6, { rivals: false });
  const next = changeCourse(ready, id, 'you', game.fleets[0]!.to);
  assert.ok(next.fleets[0]!.pendingCourse!.executeAt >= at + 8);
  assert.equal(advance(next, next.fleets[0]!.pendingCourse!.executeAt, { rivals: false }).fleets[0]!.to, game.fleets[0]!.to);
});

test('a scheduled cancellation executes before the pending turn and remains a valid saved plan', () => {
  const { game, destination } = traveling(); const id = game.fleets[0]!.id;
  const pending = changeCourse(game, id, 'you', destination.id);
  const queued = scheduleAction(pending, { id: 'cancel-navigator-plan', owner: 'you', executeAt: game.hour + .05, action: { type: 'hauler', change: { action: 'cancel-course', fleet: id } } });
  const loaded = decodeSave(JSON.stringify({ savedAt: 0, game: queued })).game;
  const end = advance(loaded, game.hour + 1 / 6, { rivals: false });
  assert.equal(end.fleets[0]!.pendingCourse, undefined);
  assert.equal(end.fleets[0]!.to, game.fleets[0]!.to);
  assert.equal(end.fleets[0]!.specialists![0]!.lastCourseAt, undefined);
});

test('a destination destroyed during the window aborts the turn privately and preserves the original course', () => {
  const { game, destination } = traveling(); const id = game.fleets[0]!.id;
  const pending = changeCourse(game, id, 'you', destination.id);
  pending.rocks.find(r => r.id === destination.id)!.destroyed = true;
  const end = advance(pending, game.hour + 1 / 6, { rivals: false });
  assert.equal(end.fleets[0]!.pendingCourse, undefined);
  assert.equal(end.fleets[0]!.to, game.fleets[0]!.to);
  assert.deepEqual(end.events.find(e => e.message.startsWith('Course change aborted:'))!.audience, ['you']);
});

test('retirement cancels a pending order without removing its traveling hauler', () => {
  const { game, destination } = traveling(); const id = game.fleets[0]!.id;
  const retired = resign(changeCourse(game, id, 'you', destination.id), 'you');
  assert.equal(retired.fleets[0]!.pendingCourse, undefined);
  assert.equal(retired.fleets[0]!.to, game.fleets[0]!.to);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: retired })).game, retired);
});

test('save loading rejects forged, old-profile, or expired pending course metadata', () => {
  const { game, destination } = traveling(); const id = game.fleets[0]!.id;
  const pending = changeCourse(game, id, 'you', destination.id);
  for (const patch of [{ owner: 'vesper' }, { to: 'missing' }, { executeAt: game.hour }, { executeAt: game.hour + 1 }, { injected: true }]) {
    const corrupt = structuredClone(pending);
    Object.assign(corrupt.fleets[0]!.pendingCourse!, patch);
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: corrupt })));
  }
  pending.rules!.mechanicsVersion = 9;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: pending })));
});

test('revision-nine course orders keep their recorded immediate behavior', () => {
  const { game, destination } = traveling(); game.rules!.mechanicsVersion = 9;
  const end = changeCourse(game, game.fleets[0]!.id, 'you', destination.id);
  assert.equal(end.fleets[0]!.to, destination.id);
  assert.equal(end.fleets[0]!.pendingCourse, undefined);
  assert.equal(end.fleets[0]!.specialists![0]!.lastCourseAt, game.hour);
});

test('arrival during preparation settles the original destination without a ghost turn', () => {
  const { game, destination } = traveling();
  const near = advance(game, game.fleets[0]!.arrives - 1 / 12, { rivals: false });
  const pending = changeCourse(near, near.fleets[0]!.id, 'you', destination.id);
  const end = advance(pending, pending.fleets[0]!.pendingCourse!.executeAt, { rivals: false });
  assert.equal(end.fleets.length, 0);
  const navigator = end.rocks.flatMap(r => r.specialists ?? []).find(u => u.id === 'delayed-nav')!;
  assert.equal(navigator.captive, true);
  assert.equal(navigator.lastCourseAt, undefined);
});

test('a Saboteur return cancels a pending turn before it can override the forced route', () => {
  const { game, destination } = traveling(); const own = game.fleets[0]!;
  const enemy = game.rocks.find(r => r.id === own.to)!;
  enemy.specialists!.push({ id: 'pending-saboteur', owner: 'vesper', kind: 'saboteur' });
  const both = dispatch(game, enemy.id, own.from, 10, 'vesper', false, ['pending-saboteur']);
  const beforeContact = advance(both, 14, { rivals: false });
  const pending = changeCourse(beforeContact, own.id, 'you', destination.id);
  const end = advance(pending, pending.fleets.find(f => f.id === own.id)!.pendingCourse!.executeAt, { rivals: false });
  const returned = end.fleets.find(f => f.id === own.id)!;
  assert.equal(returned.returning, true);
  assert.equal(returned.pendingCourse, undefined);
  assert.notEqual(returned.to, destination.id);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
});
