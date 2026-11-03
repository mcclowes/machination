import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { advance, dispatch, type Fleet } from './simulation';
import { gravityCourse } from './gravity';
import { fleetPosition, fleetVelocity } from './flight';
import { observe, forecastObservation } from './visibility';
import { teamMembers } from './teams';
import { playersIn } from './players';

function curvedFlight(teams = false) {
  let game = createConfiguredGame(teams
    ? { playerCount: 4, teamFormat: '2v2', mode: 'mining', gravity: true }
    : { playerCount: 2, mode: 'mining', gravity: true }, 0, 7);
  let best = { bend: 0, from: '', to: '' };
  for (const from of game.rocks.filter(r => r.owner === 'you' && r.drones > 0)) for (const to of game.rocks.filter(r => r.id !== from.id)) {
    const { route } = gravityCourse(game, from, to, 8, 0, 'you')!;
    const dx = route.to.x - route.from.x, dy = route.to.y - route.from.y;
    const bend = Math.max(...route.course!.map(p => Math.abs((p.x - from.x) * dy - (p.y - from.y) * dx) / Math.hypot(dx, dy)));
    if (bend > best.bend) best = { bend, from: from.id, to: to.id };
  }
  assert.ok(best.bend > 0.5, 'fixture must have a visibly curved real launch');
  game = dispatch(game, best.from, best.to, 1, 'you');
  return advance(game, (game.fleets[0]!.departed + game.fleets[0]!.arrives) / 2, { rivals: false });
}

test('observed gravity flights retain the actual frozen curve, position, and heading independently', () => {
  const game = curvedFlight(), source = game.fleets[0]!;
  const view = observe(game, 'you'), fleet = view.fleets[0]!;
  assert.ok(fleet.route?.course, 'observation must retain the committed curve');
  assert.deepEqual(fleet.route, source.route);
  assert.deepEqual(fleetPosition(view, fleet), fleetPosition(game, source));
  assert.deepEqual(fleetVelocity(view, fleet), fleetVelocity(game, source));
  assert.notEqual(fleet.route, source.route);
  assert.notEqual(fleet.route.from, source.route!.from);
  assert.notEqual(fleet.route.to, source.route!.to);
  assert.notEqual(fleet.route.course, source.route!.course);
  assert.notEqual(fleet.route.course[1], source.route!.course![1]);
  fleet.route.course[1]!.x++;
  assert.notEqual(fleet.route.course[1]!.x, source.route!.course![1]!.x);
});

test('gravity forecasts retain the observed curve and its continuous motion without mutating input', () => {
  const game = curvedFlight(), source = game.fleets[0]!;
  const view = observe(game, 'you');
  const before = JSON.stringify(view), target = game.hour + 0.05;
  const forecast = forecastObservation(view, 'you', target);
  const fleet = forecast.fleets.find(f => f.id === view.fleets[0]!.id)!;
  assert.ok(fleet.route?.course, 'forecast must retain the committed curve');
  assert.deepEqual(fleet.route, source.route);
  assert.deepEqual(fleetPosition(forecast, fleet), fleetPosition({ ...game, hour: target }, source));
  assert.deepEqual(fleetVelocity(forecast, fleet), fleetVelocity({ ...game, hour: target }, source));
  assert.equal(JSON.stringify(view), before);
  assert.notEqual(fleet.route.course, view.fleets[0]!.route!.course);
  assert.notEqual(fleet.route.course[1], view.fleets[0]!.route!.course![1]);
});

test('only disclosed contacts receive allowlisted frozen curves while pending plans and contact logs stay private', () => {
  const game = curvedFlight(true), source = game.fleets[0]!;
  const ally = teamMembers(game, 'you').find(owner => owner !== 'you')!;
  const enemy = playersIn(game).find(owner => !teamMembers(game, 'you').includes(owner))!;
  const point = fleetPosition(game, source);
  Object.assign(game.rocks.find(r => r.owner === 'you')!, point);
  Object.assign(source.route!, { travelTime: 'private-route-metadata' });
  Object.assign(source.route!.course![1]!, { privateDetail: 'private-point-metadata' });
  const contacts: Fleet[] = (['you', ally, enemy] as const).map((owner, i) => ({
    ...source, id: i + 1, owner,
    pendingCourse: { owner, to: source.to, executeAt: game.hour + 1 },
    lastContacts: [{ id: 999, hour: game.hour }],
  }));
  game.fleets = [...contacts, { ...source, id: 4, owner: enemy, preparing: true, departed: game.hour + 1, arrives: game.hour + 5 }];
  const view = observe(game, 'you', id => id + 100);
  assert.deepEqual(view.fleets.map(f => f.id), [101, 102, 103]);
  for (const fleet of view.fleets) {
    assert.ok(fleet.route?.course, 'every already disclosed contact keeps its committed curve');
    assert.deepEqual(Object.keys(fleet.route).sort(), ['course', 'from', 'to']);
    assert.deepEqual(fleet.route.course, source.route!.course!.map(({ x, y, at }) => ({ x, y, at })));
    assert.ok(fleet.route.course.every(p => Object.keys(p).sort().join(',') === 'at,x,y'));
    assert.equal(fleet.lastContacts, undefined);
    assert.notEqual(fleet.route.course[1], source.route!.course![1]);
    if (fleet.owner === enemy) assert.equal(fleet.pendingCourse, undefined);
    else {
      const original = contacts.find(f => f.owner === fleet.owner)!;
      assert.deepEqual(fleet.pendingCourse, original.pendingCourse);
      assert.notEqual(fleet.pendingCourse, original.pendingCourse);
    }
  }
});
