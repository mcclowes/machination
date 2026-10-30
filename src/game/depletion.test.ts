import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSoloGame } from './depletion';
import { advance, dispatch } from './simulation';
import { powerCapacity, drillMine, droneInventory } from './economy';
import { createConfiguredGame } from './world';
import { createTrainingAttempt } from './training';
import { decodeSave } from './save-format';
import { createArchive, replayTo } from './replay';
import { decodeOperation, encodeOperation } from './operation-save';
import { observe, forecastObservation } from './visibility';
import { siteValue, attackSites, createRivalForecast } from './rival-tactics';
import { miningInterval } from './mining';
import { generateSharedReplay } from '../replay/generate';
import { decodeSharedReplay, encodeSharedReplay } from '../replay/codec';

test('solo factories spend only produced drones and stop at the last reserve', () => {
  const game = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  const factory = game.rocks.find(r => r.owner === 'you' && r.kind === 'factory')!;
  factory.reserves = 4;
  const before = factory.drones;
  const result = advance(game, factory.productionAt!, { rivals: false });
  const spent = result.rocks.find(r => r.id === factory.id)!;
  assert.equal(spent.reserves, 0);
  assert.equal(spent.drones, before + 4);
  assert.equal(advance(result, result.hour + 24, { rivals: false }).rocks.find(r => r.id === factory.id)!.drones, spent.drones);
  assert.equal(factory.reserves, 4);
});

test('solo reserves survive save, replay, and observed forecasts', () => {
  const baseline = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  const archive = createArchive(baseline, { rivals: false });
  const game = advance(baseline, 24, { rivals: false });
  assert.deepEqual(decodeSave(JSON.stringify({ game, savedAt: 0 })).game, game);
  assert.deepEqual(replayTo(archive, 24, { rivals: false, knownThrough: 24 }), game);
  const restored = decodeOperation(encodeOperation({ game: baseline, archive: createArchive(baseline, { rivals: true }) }, 0), 0);
  assert.deepEqual(restored.game, advance(baseline, 0, { rivals: true }));
  const future = forecastObservation(observe(baseline, 'you'), 'you', 24);
  for (const rock of game.rocks.filter(r => r.owner === 'you')) {
    const projected = future.rocks.find(r => r.id === rock.id)!;
    assert.ok(projected.known);
    assert.equal(projected.reserves, rock.reserves);
  }
});

test('damaged reserve amounts and generator clocks are rejected', () => {
  const game = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  const generator = game.rocks.find(r => r.kind === 'generator')!;
  for (const reserves of [-1, 121, '120', null]) {
    const bad = structuredClone(game);
    (bad.rocks[0] as any).reserves = reserves;
    assert.throws(() => decodeSave(JSON.stringify({ game: bad, savedAt: 0 })));
  }
  const missing = structuredClone(game);
  delete missing.rocks[0]!.reserves;
  assert.throws(() => decodeSave(JSON.stringify({ game: missing, savedAt: 0 })));
  delete generator.supplyAt;
  assert.throws(() => decodeSave(JSON.stringify({ game, savedAt: 0 })));
});

test('blocked factories conserve reserves and ordinary games and tutorials stay unlimited', () => {
  const game = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  const factory = game.rocks.find(r => r.owner === 'you' && r.kind === 'factory')!;
  factory.drones += powerCapacity(game, 'you') - droneInventory(game, 'you');
  const capped = advance(game, factory.productionAt!, { rivals: false });
  assert.equal(capped.rocks.find(r => r.id === factory.id)!.reserves, 120);
  const ordinary = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  assert.ok(advance(ordinary, 24, { rivals: false }).rocks.every(r => r.reserves === undefined && r.supplyAt === undefined));
  for (const id of ['first-launch', 'shield-combat', 'unit-transport', 'future-production', 'interception'] as const) {
    assert.ok(createTrainingAttempt(id).game.rocks.every(r => r.reserves === undefined));
  }
});

test('exhausted generators lose capacity without deleting existing troops; neutral reserves stay fresh', () => {
  const game = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  const generator = game.rocks.find(r => r.owner === 'you' && r.kind === 'generator')!;
  generator.reserves = 6;
  const beforeCapacity = powerCapacity(game, 'you');
  const future = advance(game, 8, { rivals: false });
  assert.equal(powerCapacity(future, 'you'), beforeCapacity - 50);
  assert.equal(future.rocks.find(r => r.id === generator.id)!.drones, generator.drones);
  assert.ok(future.rocks.filter(r => !r.owner).every(r => r.reserves === 120));
  assert.ok(future.events.some(e => e.message.includes(`${generator.name}: reserves exhausted`)));
});

test('mines stop at exhaustion and exhausted territory no longer accelerates extraction', () => {
  const game = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  const mine = game.rocks.find(r => r.owner === 'you' && r.kind === 'mine')!;
  mine.reserves = 1;
  const beforeCargo = game.cargo.you!;
  const beforeInterval = miningInterval(game, 'you');
  const future = advance(game, 24, { rivals: false });
  assert.equal(future.cargo.you, beforeCargo + 1);
  assert.equal(future.rocks.find(r => r.id === mine.id)!.reserves, 0);
  assert.ok(miningInterval(future, 'you') > beforeInterval);
});

test('captures and construction keep remaining reserves and exhausted destinations remain usable', () => {
  let game = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  const factory = game.rocks.find(r => r.owner === 'you' && r.kind === 'factory')!;
  factory.reserves = 17;
  factory.drones = 150;
  game = drillMine(game, factory.id, 'you');
  assert.equal(game.rocks.find(r => r.id === factory.id)!.reserves, 17);
  const exhausted = game.rocks.find(r => !r.owner && r.kind === 'factory')!;
  exhausted.reserves = 0;
  exhausted.drones = 0;
  Object.assign(exhausted, { x: factory.x + 1, y: factory.y });
  const launched = dispatch(game, factory.id, exhausted.id, 5, 'you');
  const future = advance(launched, launched.fleets.at(-1)!.arrives, { rivals: false });
  const captured = future.rocks.find(r => r.id === exhausted.id)!;
  assert.equal(captured.owner, 'you');
  assert.equal(captured.reserves, 0);
  assert.equal(captured.drones, 5);
  assert.throws(() => drillMine(future, captured.id, 'you'), /no reserves/);
});

test('large and split advancement agree across exhaustion, and shared replays retain visible reserves', () => {
  const game = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  for (const r of game.rocks) r.reserves = 7;
  const future = advance(game, 48, { rivals: false });
  let split = game;
  for (let hour = 0.25; hour <= 48; hour += 0.25) split = advance(split, hour, { rivals: false });
  assert.deepEqual(split, future);
  assert.doesNotThrow(() => decodeSave(JSON.stringify({ game: future, savedAt: 0 })));
  const replay = generateSharedReplay({ game: future, archive: createArchive(game, { rivals: false }) }, 'you', 0, 48);
  const decoded = decodeSharedReplay(encodeSharedReplay(replay));
  assert.ok(decoded.groups.some(g => g.states.some(s => s.rocks.some(r => r.reserves === 0))));
  assert.ok(decoded.groups.every(g => g.states.every(s => s.rocks.every(r => r.known || r.reserves === undefined))));
});

test('AI skips empty economic targets but still values an enemy King on exhausted ground', () => {
  const game = createSoloGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  for (const r of game.rocks) { r.reserves = 0; r.drones = 1000; }
  const source = game.rocks.find(r => r.owner === 'vesper' && r.kind === 'factory')!;
  source.drones = 100;
  const target = game.rocks.find(r => !r.owner)!;
  Object.assign(target, { x: source.x + 1, y: source.y, drones: 0 });
  assert.equal(siteValue(game, target, 'vesper'), 0);
  assert.equal(attackSites(game, 'vesper', createRivalForecast(game)).fleets.length, 0);
  const king = game.rocks.find(r => r.coreOf === 'you')!;
  assert.equal(siteValue(game, king, 'vesper'), 600);
});
