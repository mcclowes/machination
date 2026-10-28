import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch, type Game } from './simulation';
import { fleetPosition } from './flight';
import { changeCourse } from './specialist-navigation';

function traveling(): Game {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'nav', kind: 'navigator', owner: 'you' });
  const launched = dispatch(game, 'c', 'e', 10, 'you', false, ['nav']);
  return advance(launched, launched.fleets[0]!.departed, { rivals: false });
}

test('only an active owner with a departed, unlocked navigator hauler can change course', () => {
  const game = traveling();
  const id = game.fleets[0]!.id;
  const denied: Game[] = [
    { ...game, version: 1 }, { ...game, winner: 'you' }, { ...game, eliminated: ['you'] },
    { ...game, fleets: [] },
    ...[
      { owner: 'vesper' as const }, { preparing: true as const }, { departed: game.hour + 1 },
      { arrives: game.hour }, { courseLocked: true as const }, { specialists: [] },
      { specialists: [{ id: 'nav', kind: 'navigator' as const, owner: 'you' as const, captive: true as const }] },
      { specialists: [{ id: 'nav', kind: 'navigator' as const, owner: 'vesper' as const }] },
    ].map(patch => ({ ...game, fleets: [{ ...game.fleets[0]!, ...patch }] })),
  ];
  for (const input of denied) {
    const before = structuredClone(input);
    assert.throws(() => changeCourse(input, id, 'you', 'n'));
    assert.deepEqual(input, before);
  }
  assert.throws(() => changeCourse(game, id, 'you', 'missing'));
  const destroyed = { ...game, rocks: game.rocks.map(r => r.id === 'n' ? { ...r, destroyed: true as const } : r) };
  assert.throws(() => changeCourse(destroyed, id, 'you', 'n'));
});

test('course changes preserve position and payload, use specialist speed, and arrive continuously', () => {
  const game = traveling();
  game.hour += 1;
  const fleet = game.fleets[0]!;
  fleet.specialists!.push({ id: 'helm', kind: 'helmsman', owner: 'you' });
  fleet.intercept = { target: 99, home: 'c' };
  fleet.returning = true;
  fleet.route = { from: { x: 12, y: 52 }, to: { x: 84, y: 52 } };
  const before = structuredClone(game);
  const point = fleetPosition(game, fleet);
  const changed = changeCourse(game, fleet.id, 'you', 'n');
  const routed = changed.fleets[0]!;
  const destination = game.rocks.find(r => r.id === 'n')!;
  assert.deepEqual(game, before);
  assert.deepEqual(fleetPosition(changed, routed), point);
  assert.deepEqual(routed.route, { from: point, to: { x: destination.x, y: destination.y } });
  assert.equal(routed.departed, game.hour);
  assert.equal(routed.speed, 16);
  assert.equal(routed.arrives, game.hour + Math.hypot(destination.x - point.x, destination.y - point.y) / 16);
  assert.equal(routed.drones, fleet.drones);
  assert.equal(routed.owner, fleet.owner);
  assert.deepEqual(routed.specialists!.map(u => u.id), fleet.specialists!.map(u => u.id));
  assert.equal(routed.intercept, undefined);
  assert.equal(routed.returning, undefined);
  assert.equal(routed.preparing, undefined);
  const arrived = advance(changed, routed.arrives, { rivals: false });
  assert.ok(!arrived.fleets.some(f => f.id === fleet.id));
  assert.ok(arrived.rocks.find(r => r.id === 'n')!.specialists!.some(u => u.id === 'nav'));
});

test('the first change is immediate and all navigators share the eight-hour restriction', () => {
  const game = traveling();
  // Keep both courses long enough to exercise the exact cooldown boundary in flight.
  game.rocks.find(r => r.id === 'n')!.x = 1000;
  game.fleets[0]!.specialists!.push({ id: 'nav-2', kind: 'navigator', owner: 'you' });
  const id = game.fleets[0]!.id;
  const first = changeCourse(game, id, 'you', 'n');
  assert.deepEqual(first.fleets[0]!.specialists!.map(u => u.lastCourseAt), [game.hour, game.hour]);
  assert.throws(() => changeCourse(first, id, 'you', 'c'));
  const almost = advance(first, game.hour + 8 - 1e-6, { rivals: false });
  assert.throws(() => changeCourse(almost, id, 'you', 'c'));
  const ready = advance(first, game.hour + 8, { rivals: false });
  const second = changeCourse(ready, id, 'you', 'c');
  assert.equal(second.fleets[0]!.specialists![0]!.lastCourseAt, game.hour + 8);
  const mixed = structuredClone(first);
  delete mixed.fleets[0]!.specialists![1]!.lastCourseAt;
  assert.throws(() => changeCourse(mixed, id, 'you', 'c'));
});
