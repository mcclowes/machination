import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreCargoGame as createConfiguredGame } from './test-world';
import { advance, type Game } from './simulation';
import { withUnitEffects } from './specialist-effects';
import { activeUnits, recruitmentStatus } from './specialists';
import { maximumShield } from './economy';
import { rockSensorRange } from './sensors';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import { generateSharedReplay } from '../replay/generate';
import { decodeSharedReplay, encodeSharedReplay } from '../replay/codec';
import { seekReplay } from '../replay/playback';

// Official Queen/Princess rules: an additional acquired Queen becomes a Princess.
// Controlled configured fixtures isolate restoration; they are not original-client traces.
function world(mode: 'mining' | 'domination') {
  const game = createConfiguredGame({ playerCount: 3, mode, driftingBases: false }, 0, 73);
  game.hour = 24;
  for (const rock of game.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; rock.shieldsDisabled = true; }
  const core = game.rocks.find(r => r.coreOf === 'you')!;
  const [successor, home, rescue, distant] = game.rocks.filter(r => r.owner === 'you' && !r.coreOf);
  Object.assign(core, { x: 20, y: 20, drones: 10 });
  Object.assign(successor!, { x: 44, y: 20 });
  Object.assign(home!, { x: 10, y: 20, drones: 10 });
  Object.assign(rescue!, { x: 21, y: 21, drones: 10 });
  Object.assign(distant!, { x: 50, y: 70 });
  successor!.specialists!.push({ id: 'successor', kind: 'princess', owner: 'you' });
  distant!.specialists!.push({ id: 'envoy', kind: 'diplomat', owner: 'you' });
  rescue!.specialists!.push({ id: 'rescuer', kind: 'pirate', owner: 'you' });
  const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(enemy, { x: 28, y: 20, drones: 100 });
  return { game: withUnitEffects(game), core: core.id, successor: successor!.id, home: home!.id, rescue: rescue!.id, distant: distant!.id, enemy: enemy.id };
}

function history(baseline: Game) {
  let game = baseline;
  const original = JSON.stringify(baseline), entries: ReplayEntry[] = [];
  decodeSave(JSON.stringify({ savedAt: 0, game }));
  return {
    get game() { return game; },
    command(command: GameCommand) {
      entries.push({ hour: game.hour, command });
      game = executeCommand(game, command);
    },
    at(hour: number) {
      const split = advance(advance(game, (hour + game.hour) / 2, { rivals: false }), hour, { rivals: false });
      game = advance(game, hour, { rivals: false });
      assert.deepEqual(split, game);
    },
    check() {
      const archive = restoreArchive({ ...exportArchive(createArchive(baseline)), entries: [...entries] });
      assert.deepEqual(replayTo(archive, game.hour, { rivals: false, knownThrough: game.hour }), game);
      assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game, replay: exportArchive(archive) })).game, game);
      assert.equal(JSON.stringify(baseline), original);
      const clip = decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game, archive }, 'you', baseline.hour, game.hour)));
      const scene = seekReplay(clip, game.hour);
      assert.equal([...scene.rocks, ...scene.fleets].flatMap(a => a.specialists ?? []).filter(u => u.owner === 'you' && u.kind === 'queen' && !u.captive).length, 1);
      assert.equal('recruitment' in scene, false);
    },
  };
}
const units = (game: Game) => [...game.rocks, ...game.fleets].flatMap(a => a.specialists ?? []);
function restored(game: Game) {
  assert.deepEqual(activeUnits(game, 'you').filter(u => u.kind === 'queen').map(u => u.id), ['successor']);
  assert.deepEqual(units(game).find(u => u.id === 'core-you'), { id: 'core-you', kind: 'princess', owner: 'you' });
  assert.equal(game.eliminated.includes('you'), false);
}

for (const mode of ['mining', 'domination'] as const) {
  for (const path of ['release', 'diplomat', 'recapture'] as const) test(`a restored Queen preserves her successor: ${path}, ${mode}`, () => {
    const f = world(mode);
    f.game.rocks.find(r => r.id === f.core)!.drones = 0;
    const h = history(f.game);
    h.command({ type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.core, drones: 1 });
    h.at(h.game.fleets.at(-1)!.arrives);
    assert.equal(units(h.game).find(u => u.id === 'core-you')!.captive, true);
    assert.equal(units(h.game).find(u => u.id === 'successor')!.kind, 'queen');
    h.check();
    const credits = recruitmentStatus(h.game, 'you').credits;
    if (path === 'release') {
      h.command({ type: 'release', owner: 'vesper', id: 'core-you' });
    } else {
      h.command(path === 'diplomat'
        ? { type: 'dispatch', owner: 'you', from: f.distant, to: f.home, drones: 0, specialists: ['envoy'] }
        : { type: 'dispatch', owner: 'you', from: f.home, to: f.core, drones: 2 });
      h.at(h.game.fleets.find(fleet => path === 'diplomat' ? fleet.specialists?.some(u => u.id === 'envoy') : fleet.owner === 'you')!.arrives);
    }
    restored(h.game); h.check();
    assert.equal(recruitmentStatus(h.game, 'you').at, f.successor);
    assert.equal(recruitmentStatus(h.game, 'you').credits, credits);
    const returning = h.game.fleets.find(fleet => fleet.specialists?.some(u => u.id === 'core-you'));
    if (path !== 'recapture') {
      assert.ok(returning?.returning, 'Release and rescue keep actual return transit');
      h.at(returning.arrives); restored(h.game); h.check();
    }
    const at = h.game.rocks.find(r => r.specialists?.some(u => u.id === 'core-you'))!;
    assert.equal(at.coreOf, undefined);
    assert.equal(maximumShield(at), at.shieldMax, 'The restored Princess grants no Queen shield bonus');
    assert.equal(rockSensorRange(h.game, at), 48, 'Her Princess sonar effect applies at the destination');
  });

  for (const path of ['defending-site', 'hauler-battle', 'gift-site', 'gift-hauler', 'double-agent'] as const) test(`a captive aboard a homeless captor is restored once: ${path}, ${mode}`, () => {
    const f = world(mode);
    if (path === 'double-agent') f.game.rocks.find(r => r.id === f.rescue)!.specialists!.push({ id: 'exchange', kind: 'doubleAgent', owner: 'you' });
    const enemyCore = f.game.rocks.find(r => r.coreOf === 'vesper')!;
    Object.assign(enemyCore, { x: 28, y: 20, drones: 1 });
    // A valid departed carrier with no friendly outpost exercises the engine's keep-captives-aboard fallback.
    let baseline = executeCommand(f.game, { type: 'dispatch', owner: 'vesper', from: enemyCore.id, to: f.core, drones: 1, specialists: ['core-vesper'] });
    baseline = executeCommand(baseline, { type: 'dispatch', owner: 'you', from: f.core, to: enemyCore.id, drones: 0, specialists: ['core-you'] });
    baseline = advance(baseline, Math.max(...baseline.fleets.map(fleet => fleet.departed)), { rivals: false });
    for (const rock of baseline.rocks) if (rock.owner === 'vesper') { rock.owner = null; rock.drones = 0; delete rock.coreOf; }
    baseline = withUnitEffects(baseline);
    const h = history(baseline);
    h.at(nextRouteEncounter(h.game));
    const carrier = h.game.fleets.find(fleet => fleet.owner === 'vesper' && fleet.specialists?.some(u => u.id === 'core-you'))!;
    assert.ok(carrier.specialists!.find(u => u.id === 'core-you')!.captive);
    h.check();
    if (path.startsWith('gift')) h.command({ type: 'hauler', owner: 'vesper', change: { action: 'gift', fleet: carrier.id } });
    if (path.endsWith('hauler') || path === 'hauler-battle' || path === 'double-agent') {
      h.command({ type: 'intercept', owner: 'you', from: f.rescue, target: carrier.id, drones: 5, specialists: path === 'double-agent' ? ['rescuer', 'exchange'] : ['rescuer'] });
      h.at(h.game.fleets.find(fleet => fleet.intercept)!.arrives);
    } else h.at(carrier.arrives);
    restored(h.game); h.check();
    assert.equal(recruitmentStatus(h.game, 'you').at, f.successor);
  });
}

test('revision thirteen retains its old release result and refuses the resulting invalid strict save', () => {
  const f = world('mining'); f.game.rules!.mechanicsVersion = 13;
  f.game.rocks.find(r => r.id === f.core)!.drones = 0;
  let game = executeCommand(f.game, { type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.core, drones: 1 });
  game = advance(game, game.fleets.at(-1)!.arrives, { rivals: false });
  decodeSave(JSON.stringify({ savedAt: 0, game }));
  game = executeCommand(game, { type: 'release', owner: 'vesper', id: 'core-you' });
  assert.equal(activeUnits(game, 'you').filter(u => u.kind === 'queen').length, 2);
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game })), /damaged/);
});

test('a successor traveling on its own hauler remains the sole Queen when the original is released and docks', () => {
  const f = world('mining');
  f.game.rocks.find(r => r.id === f.core)!.drones = 0;
  const h = history(f.game);
  h.command({ type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.core, drones: 1 });
  h.at(h.game.fleets.at(-1)!.arrives);
  h.command({ type: 'dispatch', owner: 'you', from: f.successor, to: f.distant, drones: 0, specialists: ['successor'] });
  const successor = h.game.fleets.find(fleet => fleet.specialists?.some(u => u.id === 'successor'))!;
  h.at(successor.departed + 0.01);
  assert.equal(h.game.fleets.find(fleet => fleet.id === successor.id)!.preparing, undefined);
  assert.equal(recruitmentStatus(h.game, 'you').at, undefined);
  h.command({ type: 'release', owner: 'vesper', id: 'core-you' });
  restored(h.game); h.check();
  assert.equal(h.game.fleets.find(fleet => fleet.id === successor.id)!.arrives, successor.arrives);
  const returning = h.game.fleets.find(fleet => fleet.specialists?.some(u => u.id === 'core-you'))!;
  assert.ok(returning.arrives < successor.arrives);
  h.at(returning.arrives);
  restored(h.game); h.check();
  assert.equal(recruitmentStatus(h.game, 'you').at, undefined, 'Docking the restored Princess does not open a second hiring core');
  h.at(successor.arrives);
  restored(h.game); h.check();
  assert.equal(recruitmentStatus(h.game, 'you').at, f.distant);
});

for (const mode of ['mining', 'domination'] as const) test(`a restored Princess can succeed again without duplicating cores: ${mode}`, () => {
  const f = world(mode);
  f.game.rocks.find(r => r.id === f.core)!.drones = 0;
  const h = history(f.game);
  h.command({ type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.core, drones: 1 });
  h.at(h.game.fleets.at(-1)!.arrives);
  h.command({ type: 'release', owner: 'vesper', id: 'core-you' });
  h.at(h.game.fleets.find(fleet => fleet.specialists?.some(u => u.id === 'core-you'))!.arrives);
  restored(h.game); h.check();
  h.command({ type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.successor, drones: 80 });
  h.at(h.game.fleets.find(fleet => fleet.owner === 'vesper')!.arrives);
  assert.deepEqual(activeUnits(h.game, 'you').filter(u => u.kind === 'queen').map(u => u.id), ['core-you']);
  assert.equal(units(h.game).find(u => u.id === 'successor')!.captive, true);
  const core = h.game.rocks.find(r => r.specialists?.some(u => u.id === 'core-you'))!;
  assert.equal(core.coreOf, 'you');
  assert.equal(maximumShield(core), core.shieldMax! + 20);
  assert.equal(rockSensorRange(h.game, core), 32);
  assert.equal(recruitmentStatus(h.game, 'you').at, core.id);
  h.check();
});

for (const contact of ['site', 'hauler'] as const) test(`two rescued Queens cannot duplicate leadership after the current Queen is killed at ${contact} contact`, () => {
  const f = world('mining');
  const prison = f.game.rocks.find(r => r.id === f.enemy)!;
  prison.drones = 1;
  prison.specialists!.push({ id: 'assassin', kind: 'assassin', owner: 'vesper' });
  let baseline = executeCommand(f.game, { type: 'dispatch', owner: 'you', from: f.core, to: f.enemy, drones: 10, specialists: ['core-you'] });
  if (contact === 'hauler') baseline = executeCommand(baseline, { type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.core, drones: 1, specialists: ['assassin'] });
  baseline = advance(baseline, Math.max(...baseline.fleets.map(fleet => fleet.departed)), { rivals: false });
  const holder = contact === 'site' ? baseline.rocks.find(r => r.id === f.enemy)! : baseline.fleets.find(fleet => fleet.owner === 'vesper')!;
  holder.specialists!.push(...['rescued-a', 'rescued-b'].map(id => ({ id, kind: 'queen' as const, owner: 'you' as const, captive: true as const })));
  const h = history(baseline);
  h.at(contact === 'site' ? h.game.fleets[0]!.arrives : nextRouteEncounter(h.game));
  assert.equal(units(h.game).some(u => u.id === 'core-you'), false, 'Assassin removes the previous Queen');
  assert.equal(activeUnits(h.game, 'you').filter(u => u.kind === 'queen').length, 1);
  assert.deepEqual(units(h.game).filter(u => u.id.startsWith('rescued-')).map(u => u.kind).sort(), ['princess', 'queen']);
  h.check();
});

test('releasing an eliminated owner’s Queen never restores orders', () => {
  const f = world('mining');
  f.game.rocks.find(r => r.id === f.successor)!.specialists = [];
  f.game.rocks.find(r => r.id === f.core)!.drones = 0;
  let game = executeCommand(f.game, { type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.core, drones: 1 });
  game = advance(game, game.fleets.at(-1)!.arrives, { rivals: false });
  assert.ok(game.eliminated.includes('you'));
  game = executeCommand(game, { type: 'release', owner: 'vesper', id: 'core-you' });
  assert.ok(game.eliminated.includes('you'));
  assert.equal(units(game).find(u => u.id === 'core-you')!.kind, 'queen');
  assert.throws(() => executeCommand(game, { type: 'dispatch', owner: 'you', from: f.home, to: f.core, drones: 1 }), /eliminated|no longer/);
  decodeSave(JSON.stringify({ savedAt: 0, game }));
});
