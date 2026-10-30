import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreCargoGame as createConfiguredGame } from './test-world';
import { advance, dispatch } from './simulation';
import { fleetPosition } from './flight';
import { worldDistance } from './geometry';
import { sitePosition } from './drift';
import { observe, forecastObservation } from './visibility';
import { decodeSave } from './save-format';
import { createArchive, replayTo } from './replay';
import { decodeReplay } from './replay-save';
import { exportArchive } from './replay';
import { generateSharedReplay } from '../replay/generate';
import { encodeSharedReplay, decodeSharedReplay } from '../replay/codec';
import { seekReplay } from '../replay/playback';
import { editLaunch } from './transport';
import { changeCourse } from './specialist-navigation';
import { withUnitEffects } from './specialist-effects';
import { dispatchIntercept } from './interception';
import { drillMine } from './economy';
import { detonate } from './destruction';

test('new drifting charts move neutral asteroid installations without moving starting stations', () => {
  const start = createConfiguredGame({ playerCount: 3, mode: 'mining', driftingBases: true }, 0, 73);
  const moving = start.rocks.filter(r => r.drift);
  assert.equal(moving.length, 6);
  assert.ok(moving.every(r => r.owner === null));
  const later = advance(start, 24, { rivals: false });
  for (const rock of start.rocks) {
    const next = later.rocks.find(r => r.id === rock.id)!;
    assert.ok(Math.abs(worldDistance(start, rock, next) - (rock.drift ? 12 : 0)) < 1e-8);
  }
  assert.deepEqual(advance(advance(start, 7.13, { rivals: false }), 24, { rivals: false }), later);
  assert.equal(start.hour, 0);
});

test('public drift forecasts and persisted history retain motion without revealing hidden garrisons', () => {
  const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 1);
  const view = observe(start, 'you');
  const forecast = forecastObservation(view, 'you', 24);
  const live = advance(start, 24, { rivals: false });
  for (const rock of view.rocks) {
    assert.deepEqual(forecast.rocks.find(r => r.id === rock.id)!.drift, rock.drift);
    assert.ok(worldDistance(start, forecast.rocks.find(r => r.id === rock.id)!, live.rocks.find(r => r.id === rock.id)!) < 1e-9);
    if (!rock.known) assert.equal(forecast.rocks.find(r => r.id === rock.id)!.drones, undefined);
  }
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: live })).game, live);
  const archive = createArchive(start);
  assert.doesNotThrow(() => decodeReplay(exportArchive(archive), live, false));
  assert.deepEqual(replayTo(archive, 24, { knownThrough: 24, rivals: false }), live);
  const corrupt = JSON.parse(JSON.stringify(live));
  corrupt.rocks.find((r: { drift?: unknown }) => r.drift).drift.velocity.x = 8;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: corrupt })));
});

test('shared replay export and arbitrary-time seeking animate charted bases and their sensors', () => {
  const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  const base = start.rocks.find(r => r.drift)!;
  base.owner = 'you';
  const archive = createArchive(start);
  const game = advance(start, 5, { rivals: false });
  const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game, archive }, 'you', 0, 5)));
  const frame = seekReplay(replay, 1.371);
  const expected = sitePosition(start, base, frame.hour);
  assert.ok(worldDistance(start, frame.rocks.find(r => r.id === base.id)!, expected) < 1e-8);
  assert.ok(frame.coverage.some(sensor => worldDistance(start, sensor, expected) < 1e-8));
});

test('haulers depart from a drifting base after preparation and meet a moving destination across the seam', () => {
  const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  start.rules!.map.width = 100; start.rules!.map.height = 100;
  const source = start.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const target = start.rocks.find(r => r.drift)!;
  Object.assign(source, { x: 2, y: 50, drones: 80, drift: { origin: { x: 2, y: 50 }, velocity: { x: 0, y: 0.5 } } });
  Object.assign(target, { x: 98, y: 50, shield: 0, drones: 0, drift: { origin: { x: 98, y: 50 }, velocity: { x: -0.5, y: 0 } } });
  const launched = dispatch(start, source.id, target.id, 30, 'you');
  const fleet = launched.fleets[0]!;
  const damaged = JSON.parse(JSON.stringify(launched));
  delete damaged.fleets[0].route;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: damaged })));
  assert.ok(worldDistance(start, fleetPosition({ ...launched, hour: fleet.departed }, fleet), sitePosition(start, source, fleet.departed)) < 1e-8);
  assert.ok(worldDistance(start, fleetPosition({ ...launched, hour: fleet.arrives }, fleet), sitePosition(start, target, fleet.arrives)) < 1e-8);
  const halfway = advance(launched, fleet.departed + (fleet.arrives - fleet.departed) / 2, { rivals: false });
  assert.deepEqual(fleetPosition(halfway, halfway.fleets[0]!), fleetPosition({ ...launched, hour: halfway.hour }, fleet));
  const arrived = advance(launched, fleet.arrives, { rivals: false });
  assert.equal(arrived.rocks.find(r => r.id === target.id)!.owner, 'you');
  assert.deepEqual(advance(halfway, fleet.arrives, { rivals: false }), arrived);
});

test('a drifting envoy releases a captive at range entry independently of polling', () => {
  const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  start.rules!.map.width = 100; start.rules!.map.height = 100;
  for (const r of start.rocks) { delete r.drift; Object.assign(r, { x: 60, y: 60 }); }
  const source = start.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const holding = start.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 0, y: 0, drift: { origin: { x: 0, y: 0 }, velocity: { x: 0.5, y: 0 } } });
  source.specialists!.push({ id: 'drifting-envoy', kind: 'diplomat', owner: 'you' });
  Object.assign(holding, { x: 32.2, y: 0 });
  holding.specialists!.push({ id: 'drifting-captive', kind: 'helmsman', owner: 'you', captive: true });
  const whole = advance(start, 1, { rivals: false });
  const split = advance(advance(start, 0.5, { rivals: false }), 1, { rivals: false });
  assert.deepEqual(split, whole);
  assert.ok(whole.fleets.some(f => f.specialists?.some(u => u.id === 'drifting-captive')));
  assert.ok(Math.abs(whole.fleets[0]!.departed - 0.4) < 1e-9);
});

test('launch edits, global speed changes, and navigator redirection preserve moving-base rendezvous', () => {
  const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  const source = start.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const target = start.rocks.find(r => r.drift)!;
  source.specialists!.push({ id: 'drift-navigator', kind: 'navigator', owner: 'you' }, { id: 'drift-helmsman', kind: 'helmsman', owner: 'you' });
  let game = dispatch(start, source.id, target.id, 20, 'you', false, ['drift-navigator']);
  game = editLaunch(game, game.fleets[0]!.id, 'you', 25, ['drift-navigator', 'drift-helmsman']);
  const edited = game.fleets[0]!;
  assert.ok(worldDistance(game, fleetPosition({ ...game, hour: edited.arrives }, edited), sitePosition(game, target, edited.arrives)) < 1e-8);
  game = editLaunch(game, edited.id, 'you', 25, ['drift-navigator']);
  game = advance(game, 0.2, { rivals: false });
  const before = fleetPosition(game, game.fleets[0]!);
  game.rocks.find(r => r.coreOf === 'you')!.specialists!.push({ id: 'drift-admiral', kind: 'admiral', owner: 'you' });
  // Removing the navigator makes this ordinary convoy eligible for the admiral's global speed bonus.
  game.fleets[0]!.specialists = [];
  const faster = withUnitEffects(game);
  assert.deepEqual(fleetPosition(faster, faster.fleets[0]!), before);
  assert.equal(faster.fleets[0]!.speed, 12);
  const sped = faster.fleets[0]!;
  assert.ok(worldDistance(game, fleetPosition({ ...faster, hour: sped.arrives }, sped), sitePosition(faster, target, sped.arrives)) < 1e-8);
  faster.fleets[0]!.specialists = [{ id: 'drift-navigator', kind: 'navigator', owner: 'you' }];
  const destination = faster.rocks.find(r => r.drift && r.id !== target.id)!;
  const redirected = changeCourse(faster, sped.id, 'you', destination.id);
  assert.deepEqual(fleetPosition(redirected, redirected.fleets[0]!), before);
  const turned = advance(redirected, redirected.fleets[0]!.pendingCourse!.executeAt, { rivals: false });
  const fleet = turned.fleets[0]!;
  assert.equal(fleet.to, destination.id);
  assert.ok(worldDistance(turned, fleetPosition({ ...turned, hour: fleet.arrives }, fleet), sitePosition(turned, destination, fleet.arrives)) < 1e-8);
});

test('interceptors launch from the moving preparation position and return to a drifting friendly base', () => {
  const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  for (const r of start.rocks) { delete r.drift; Object.assign(r, { x: 60, y: 60 }); }
  const source = start.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const enemy = start.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  const destination = start.rocks.find(r => r.coreOf === 'you')!;
  Object.assign(source, { x: 10, y: 10, drones: 100, drift: { origin: { x: 10, y: 10 }, velocity: { x: 0.5, y: 0 } } });
  Object.assign(enemy, { x: 40, y: 10 }); Object.assign(destination, { x: 0, y: 10 });
  source.specialists!.push({ id: 'drift-pirate', kind: 'pirate', owner: 'you' });
  let game = advance(dispatch(start, enemy.id, destination.id, 10, 'vesper'), 0.2, { rivals: false });
  game = dispatchIntercept(game, source.id, game.fleets[0]!.id, 30, 'you', true, ['drift-pirate']);
  const rig = game.fleets.find(f => f.intercept)!;
  assert.ok(worldDistance(game, fleetPosition({ ...game, hour: rig.departed }, rig), sitePosition(game, source, rig.departed)) < 1e-8);
  const met = advance(game, rig.arrives, { rivals: false });
  const returning = met.fleets.find(f => f.id === rig.id)!;
  assert.equal(returning.returning, true);
  assert.equal(returning.to, source.id);
  assert.ok(worldDistance(met, fleetPosition({ ...met, hour: returning.arrives }, returning), sitePosition(met, source, returning.arrives)) < 1e-8);
});

test('mine conversion and destruction retain asteroid motion and wreck coverage', () => {
  let game = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  const base = game.rocks.find(r => r.drift)!;
  base.owner = 'you'; base.drones = 60;
  game = drillMine(game, base.id, 'you');
  const mined = advance(game, 1, { rivals: false });
  assert.equal(mined.rocks.find(r => r.id === base.id)!.kind, 'mine');
  detonate(mined, mined.rocks.find(r => r.id === base.id)!);
  const later = advance(mined, 2, { rivals: false });
  const wreck = later.rocks.find(r => r.id === base.id)!;
  assert.equal(wreck.destroyed, true);
  assert.equal(wreck.drones, 0);
  assert.ok(worldDistance(later, wreck, sitePosition(later, base, 2)) < 1e-8);
  assert.ok(observe(later, 'you').coverage.some(s => worldDistance(later, s, wreck) < 1e-8));
});

test('replays reveal a garrison only while a drifting sensor covers it', () => {
  const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  start.rules!.map.width = 100; start.rules!.map.height = 100;
  for (const r of start.rocks) { delete r.drift; Object.assign(r, { x: 70, y: 70 }); }
  const base = start.rocks.find(r => !r.owner)!;
  Object.assign(base, { owner: 'you', x: 0, y: 10, drift: { origin: { x: 0, y: 10 }, velocity: { x: 0.5, y: 0 } } });
  const target = start.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(target, { x: 32.2, y: 10 });
  const archive = createArchive(start), game = advance(start, 1, { rivals: false });
  const replay = generateSharedReplay({ game, archive }, 'you', 0, 1);
  for (const hour of [0, 0.39, 0.41, 0.7, 1]) {
    const recorded = seekReplay(replay, hour).rocks.find(r => r.id === target.id)!;
    const live = observe(advance(start, hour, { rivals: false }), 'you').rocks.find(r => r.id === target.id)!;
    assert.equal(recorded.known, live.known);
    assert.equal(recorded.drones, live.drones);
  }
  assert.equal(seekReplay(replay, 0.39).rocks.find(r => r.id === target.id)!.known, false);
  assert.equal(seekReplay(replay, 0.41).rocks.find(r => r.id === target.id)!.known, true);
  const malformed = JSON.parse(encodeSharedReplay(replay));
  malformed.schemaVersion = 1;
  assert.throws(() => decodeSharedReplay(JSON.stringify(malformed)));
  malformed.schemaVersion = 2;
  malformed.groups.at(-1).states.at(-1).rocks.find((r: { drift?: unknown }) => r.drift).drift.velocity.x = 0.25;
  assert.throws(() => decodeSharedReplay(JSON.stringify(malformed)));
});
