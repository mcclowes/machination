import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, dispatch, type Game, type Rock } from './simulation';
import { createConfiguredGame } from './world';
import { actStrategicRivals } from './rival-ai';
import { createArchive, replayTo } from './replay';
import { encodeOperation, decodeOperation } from './operation-save';
import { commandPulse } from './pulse';
import { createRivalForecast, RIVAL_FORECAST_BUDGET } from './rival-tactics';
import { decodeSave } from './save-format';

function scenario(mode: 'mining' | 'pulse' | 'domination' = 'domination', playerCount = 2): Game {
  const game = createConfiguredGame({ playerCount, mode }, 0, 42);
  game.hour = 24;
  game.rocks = game.rocks.map(r => ({ ...r, owner: null, drones: 1000, shield: 0, productionAt: 1000, shieldAt: 1000, miningAt: 1000, specialists: [], coreOf: undefined }));
  site(game, 0, { owner: 'you', x: 80, y: 80, specialists: [{ id: 'king-you', owner: 'you', kind: 'queen' }], coreOf: 'you' });
  site(game, 1, { owner: 'vesper', x: 10, y: 10, drones: 40, specialists: [{ id: 'king-vesper', owner: 'vesper', kind: 'queen' }], coreOf: 'vesper' });
  game.cargo = { you: 0, vesper: 0 };
  if (game.pulse) {
    game.pulse.kings = game.pulse.kings.map(k => ({ ...k, kingId: `king-${k.factionId}`, position: k.factionId === 'you' ? { x: 80, y: 80 } : { x: 10, y: 10 } }));
  }
  return game;
}
function site(game: Game, index: number, fields: Partial<Rock>): Rock {
  Object.assign(game.rocks[index]!, { kind: 'generator', shieldMax: 20 }, fields);
  return game.rocks[index]!;
}

test('takes affordable expansion without emptying the King garrison or mutating input', () => {
  const game = scenario();
  const target = site(game, 2, { x: 18, y: 10, drones: 0, kind: 'factory' });
  const original = structuredClone(game);
  const result = actStrategicRivals(game);
  assert.ok(result.fleets.some(f => f.owner === 'vesper' && f.to === target.id));
  assert.ok(result.rocks[1]!.drones >= 20);
  assert.deepEqual(game, original);
});

test('rejects a nominally weak target protected by a lethal specialist', () => {
  const game = scenario();
  site(game, 2, { owner: 'you', x: 18, y: 10, drones: 1, specialists: [{ id: 'bomb', kind: 'martyr', owner: 'you' }] });
  assert.equal(actStrategicRivals(game).fleets.filter(f => f.owner === 'vesper').length, 0);
});

test('reinforces a threatened King before spending drones on expansion', () => {
  let game = scenario();
  const donor = site(game, 2, { owner: 'vesper', x: 14, y: 10, drones: 90 });
  const enemy = site(game, 3, { owner: 'you', x: 42, y: 10, drones: 100 });
  game = dispatch(game, enemy.id, game.rocks[1]!.id, 80, 'you');
  const result = actStrategicRivals(game);
  assert.ok(result.fleets.some(f => f.owner === 'vesper' && f.from === donor.id && f.to === game.rocks[1]!.id));
  assert.equal(advance(result, game.fleets[0]!.arrives, { rivals: false }).eliminated.includes('vesper'), false);
});

test('does not pile a second attack onto an already secured destination', () => {
  let game = scenario();
  const donor = site(game, 2, { owner: 'vesper', x: 14, y: 10, drones: 100 });
  const target = site(game, 3, { x: 22, y: 10, drones: 0, kind: 'factory' });
  game = dispatch(game, donor.id, target.id, 25, 'vesper');
  const result = actStrategicRivals(game);
  assert.equal(result.fleets.filter(f => f.owner === 'vesper' && f.to === target.id).length, 1);
});

test('establishes extraction without converting the last factory or power generator', () => {
  const game = scenario('mining');
  site(game, 1, { kind: 'factory' });
  site(game, 2, { owner: 'vesper', x: 12, y: 10, drones: 100 });
  site(game, 3, { owner: 'vesper', x: 14, y: 10, drones: 150 });
  const result = actStrategicRivals(game);
  assert.ok(result.rocks.some(r => r.owner === 'vesper' && r.kind === 'mine'));
  assert.ok(result.rocks.some(r => r.owner === 'vesper' && r.kind === 'factory'));
  assert.ok(result.rocks.some(r => r.owner === 'vesper' && r.kind === 'generator'));
});

test('charges and fires the pulse through ordinary resource-paying commands', () => {
  const game = scenario('pulse');
  game.cargo.vesper = 100;
  const charged = actStrategicRivals(game);
  assert.equal(charged.pulse!.kings.find(k => k.factionId === 'vesper')!.state, 'charging');
  assert.equal(charged.cargo.vesper, 0);
  const ready = advance(charged, 30, { rivals: false });
  const fired = actStrategicRivals(ready);
  assert.equal(fired.pulse!.kings.find(k => k.factionId === 'vesper')!.state, 'firing');
  assert.equal(fired.pulse!.pulses.length, 1);
  assert.deepEqual(actStrategicRivals(fired).pulse!.pulses, fired.pulse!.pulses);
});

test('new rival policy survives save/replay and rejects unsupported policies', () => {
  const game = createConfiguredGame({ playerCount: 3, mode: 'pulse' }, 0, 123);
  assert.equal(game.rivalPolicy, 2);
  const archive = createArchive(game, { rivals: true });
  const jumped = advance(game, 36);
  let stepped = game;
  for (const hour of [0.3, 3, 3.01, 7.7, 12, 18.25, 36]) stepped = advance(stepped, hour);
  assert.deepEqual(stepped, jumped);
  assert.deepEqual(replayTo(archive, 36, { rivals: true, knownThrough: 36 }), jumped);
  const raw = encodeOperation({ game: jumped, archive }, 0);
  assert.deepEqual(decodeOperation(raw, 0).game, jumped);
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: { ...game, rivalPolicy: 3 } })), /unsupported/);
  assert.equal(decodeSave(JSON.stringify({ savedAt: 0, game: { ...game, rivalPolicy: 1 } })).game.rivalPolicy, 1);
});

test('accounts for shields and committed enemy reinforcements at arrival', () => {
  let game = scenario();
  const attacker = site(game, 2, { owner: 'vesper', x: 16, y: 10, drones: 40 });
  const target = site(game, 3, { owner: 'you', x: 32, y: 10, drones: 10, shield: 20 });
  const reinforcement = site(game, 4, { owner: 'you', x: 28, y: 10, drones: 100 });
  game = dispatch(game, reinforcement.id, target.id, 90, 'you');
  const result = actStrategicRivals(game);
  assert.ok(result.fleets.every(f => f.owner !== 'vesper' || f.to !== target.id));
  assert.equal(result.rocks.find(r => r.id === attacker.id)!.owner, 'vesper');
});

test('evacuates an outmatched King along a surviving route', () => {
  let game = scenario();
  const refuge = site(game, 2, { owner: 'vesper', x: 14, y: 10, drones: 0 });
  const enemy = site(game, 3, { owner: 'you', x: 42, y: 10, drones: 200 });
  game = dispatch(game, enemy.id, game.rocks[1]!.id, 180, 'you');
  const result = actStrategicRivals(game);
  const escape = result.fleets.find(f => f.owner === 'vesper' && f.specialists?.some(u => u.kind === 'queen'));
  assert.equal(escape?.to, refuge.id);
  const end = advance(result, game.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.eliminated.includes('vesper'), false);
  assert.ok(end.rocks.find(r => r.id === refuge.id)!.specialists!.some(u => u.kind === 'queen'));
});

test('moves idle rear forces toward the front', () => {
  const game = scenario();
  for (const rock of game.rocks) if (rock.owner !== 'vesper') Object.assign(rock, { x: 50, y: 50 });
  const rear = site(game, 2, { owner: 'vesper', x: 5, y: 10, drones: 90 });
  const front = site(game, 3, { owner: 'vesper', x: 25, y: 10, drones: 6 });
  site(game, 4, { owner: 'you', x: 33, y: 10, drones: 500 });
  const result = actStrategicRivals(game);
  assert.ok(result.fleets.some(f => f.from === rear.id && f.to === front.id && f.owner === 'vesper'));
});

test('recruitment spends ordinary credits and cargo without moving the King into attacks', () => {
  const game = scenario();
  game.cargo.vesper = 5;
  const used = game.recruitment!.vesper!.used;
  const result = actStrategicRivals(game);
  assert.equal(result.recruitment!.vesper!.used, used + 1);
  assert.equal(result.cargo.vesper, 0);
  assert.ok(result.rocks.some(r => r.owner === 'vesper' && r.specialists?.some(u => u.kind === 'queen')));
});

test('finished and eliminated opponents issue no orders', () => {
  const game = scenario();
  const winner = { ...game, winner: 'you' as const };
  assert.equal(actStrategicRivals(winner), winner);
  const eliminated = { ...game, eliminated: ['vesper' as const] };
  assert.deepEqual(actStrategicRivals(eliminated), eliminated);
});

test('old configured operations retain the six-hour rival policy', () => {
  const old = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 42, undefined, 14);
  delete old.rivalPolicy;
  assert.equal(old.rivalPolicy, undefined);
  assert.deepEqual(advance(old, 3), advance(old, 3, { rivals: false }));
  assert.ok(advance(old, 6).fleets.length > 0);
});


test('leaves an approaching pulse before the wave traps the King on station', () => {
  let game = scenario('pulse');
  const refuge = site(game, 2, { owner: 'vesper', x: 40, y: 10, drones: 20 });
  const king = game.pulse!.kings.find(k => k.factionId === 'you')!;
  Object.assign(king, { state: 'ready', chargeProgress: 6, resourceCommitted: 100 });
  game = commandPulse(game, 'you', { action: 'FIRE_PULSE', id: 'human-pulse-00000001' });
  const result = actStrategicRivals(game);
  const escape = result.fleets.find(f => f.owner === 'vesper' && f.specialists?.some(u => u.kind === 'queen'));
  assert.equal(escape?.to, refuge.id);
  const safe = advance(result, escape!.arrives + 3, { rivals: false });
  assert.equal(safe.eliminated.includes('vesper'), false);
});

test('speculation has a finite budget, reuses cached results, and never invokes rivals', () => {
  const game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 42);
  const predict = createRivalForecast(game);
  const first = predict(game, 3);
  assert.deepEqual(first, advance(game, 3, { rivals: false }));
  for (let i = 1; i < RIVAL_FORECAST_BUDGET; i++) assert.ok(predict(structuredClone(game), 3));
  assert.equal(predict(structuredClone(game), 3), undefined);
  assert.equal(predict(game, 3), first);
  assert.equal(game.hour, 0);
  assert.equal(game.fleets.length, 0);
});


test('claims useful territory retained by an eliminated faction', () => {
  const game = scenario('domination', 3);
  game.eliminated = ['you'];
  site(game, 4, { owner: 'null', x: 70, y: 70, drones: 500, specialists: [{ id: 'king-null', owner: 'null', kind: 'queen' }] });
  const abandoned = site(game, 2, { owner: 'you', x: 18, y: 10, drones: 0, kind: 'factory' });
  const result = actStrategicRivals(game);
  assert.ok(result.fleets.some(f => f.owner === 'vesper' && f.to === abandoned.id));
});

test('policy two spends a credit on a poor offer set that policy one hoards', () => {
  const game = scenario();
  game.cargo.vesper = 5;
  game.recruitment!.vesper!.offers = ['pirate', 'saboteur', 'diplomat'];
  const used = game.recruitment!.vesper!.used;
  assert.equal(actStrategicRivals(game).recruitment!.vesper!.used, used + 1);
  assert.equal(actStrategicRivals({ ...game, rivalPolicy: 1 }).recruitment!.vesper!.used, used);
});

test('attack task forces carry only the specialists that change the fight', () => {
  const game = scenario();
  site(game, 2, { owner: 'vesper', x: 14, y: 10, drones: 100, specialists: [
    { id: 'hijacker', owner: 'vesper', kind: 'thief' }, { id: 'courier', owner: 'vesper', kind: 'smuggler' }, { id: 'arbiter', owner: 'vesper', kind: 'elder' }] });
  const target = site(game, 3, { x: 22, y: 10, drones: 0, kind: 'factory' });
  const attack = actStrategicRivals(game).fleets.find(f => f.owner === 'vesper' && f.to === target.id);
  assert.deepEqual(attack?.specialists?.map(u => u.id), ['hijacker']);
});

test('keeps specialists out of a site defended by a purger', () => {
  const game = scenario();
  site(game, 2, { owner: 'vesper', x: 14, y: 10, drones: 100, specialists: [{ id: 'striker', owner: 'vesper', kind: 'lieutenant' }] });
  const target = site(game, 3, { owner: 'you', x: 22, y: 10, drones: 5, kind: 'factory', specialists: [{ id: 'purger', owner: 'you', kind: 'assassin' }] });
  const attack = actStrategicRivals(game).fleets.find(f => f.owner === 'vesper' && f.to === target.id);
  assert.ok(attack);
  assert.deepEqual(attack.specialists, []);
});

test('moves a fabricator from the core to the site covering the most factories', () => {
  const game = scenario();
  for (const rock of game.rocks) if (!rock.owner) Object.assign(rock, { x: 90, y: 20 });
  game.rocks[1]!.specialists!.push({ id: 'fabricator', owner: 'vesper', kind: 'foreman' });
  const hub = site(game, 2, { owner: 'vesper', x: 40, y: 40, drones: 30 });
  site(game, 3, { owner: 'vesper', x: 28, y: 40, drones: 30, kind: 'factory' });
  site(game, 4, { owner: 'vesper', x: 52, y: 40, drones: 30, kind: 'factory' });
  const transfer = actStrategicRivals(game).fleets.find(f => f.owner === 'vesper' && f.specialists?.some(u => u.id === 'fabricator'));
  assert.equal(transfer?.to, hub.id);
  assert.equal(transfer?.drones, 0);
});
