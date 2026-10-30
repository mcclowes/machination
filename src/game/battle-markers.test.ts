import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, createGame, dispatch } from './simulation';
import { observe } from './visibility';
import { fleetPosition } from './flight';
import { nextRouteEncounter } from './route-encounters';
import { markGift } from './gifts';
import { decodeSave } from './save-format';
import { validObservation } from './observation-format';
import { applyCommand, createArchive, exportArchive } from './replay';
import { decodeReplay } from './replay-save';

test('site battles disclose their exact location only to the event audience', () => {
  const sent = dispatch(createGame(0), 'c', 'f', 40, 'you');
  const end = advance(sent, sent.fleets[0]!.arrives, { rivals: false });
  const battle = end.events.find(event => event.battle);
  assert.ok(battle, 'Combat has map telemetry');
  const site = end.rocks.find(rock => rock.id === 'f')!;
  assert.deepEqual(battle.battle, { x: site.x, y: site.y });
  for (const player of ['you', 'vesper', 'null'] as const) {
    assert.equal(observe(end, player).events.some(event => event.battle), battle.audience!.includes(player));
  }
});

test('saved histories from before battle telemetry still reconstruct', () => {
  const { game: sent, archive } = applyCommand(createArchive(createGame(0)), { type: 'dispatch', owner: 'you', from: 'c', to: 'f', drones: 40 }, { knownThrough: 0, rivals: false });
  const end = advance(sent, sent.fleets[0]!.arrives, { rivals: false });
  const legacy = { ...end, events: end.events.map(({ battle, ...event }) => event) };
  assert.doesNotThrow(() => decodeReplay(exportArchive(archive), legacy, false));
  const tampered = { ...legacy, events: legacy.events.map(event => ({ ...event, message: 'Forged' })) };
  assert.throws(() => decodeReplay(exportArchive(archive), tampered, false));
});

test('transit battles retain their contact point after the losing hauler disappears', () => {
  let game = createGame(0);
  game = dispatch(game, 'c', 'f', 20, 'you');
  game = dispatch(game, 'f', 'c', 10, 'vesper');
  game = advance(game, Math.max(...game.fleets.map(fleet => fleet.departed)), { rivals: false });
  const hour = nextRouteEncounter(game);
  const point = fleetPosition({ ...game, hour }, game.fleets[0]!);
  const end = advance(game, hour, { rivals: false });
  assert.ok(end.fleets.length < game.fleets.length);
  assert.deepEqual(end.events.find(event => event.battle)?.battle, point);
});

test('friendly reinforcements and gifts leave no battle marker', () => {
  for (const gift of [false, true]) {
    let game = createGame(0);
    if (!gift) game.rocks.find(site => site.id === 'f')!.owner = 'you';
    game = dispatch(game, 'c', 'f', 20, 'you');
    if (gift) game = markGift(game, game.fleets[0]!.id, 'you');
    const end = advance(game, game.fleets[0]!.arrives, { rivals: false });
    assert.equal(end.events.some(event => event.battle), false);
  }
});

test('a self-destruct battle leaves a marker even when both forces disappear', () => {
  let game = createGame(0);
  game.rocks.find(site => site.id === 'c')!.specialists!.push({ id: 'battle-martyr', kind: 'martyr', owner: 'you' });
  game = dispatch(game, 'c', 'f', 20, 'you', false, ['battle-martyr']);
  const end = advance(game, game.fleets[0]!.arrives, { rivals: false });
  const site = end.rocks.find(rock => rock.id === 'f')!;
  assert.ok(site.destroyed);
  assert.deepEqual(end.events.find(event => event.battle)?.battle, { x: site.x, y: site.y });
});

test('battle coordinates round-trip through saves and reject malformed observations', () => {
  const sent = dispatch(createGame(0), 'c', 'f', 40, 'you');
  const game = advance(sent, sent.fleets[0]!.arrives, { rivals: false });
  assert.deepEqual(decodeSave(JSON.stringify({ game, savedAt: 0 })).game, game);
  const view = observe(game, 'you');
  assert.equal(validObservation(view), true);
  for (const battle of [null, {}, { x: '5', y: 8 }, { x: Infinity, y: 5 }]) {
    const invalid = { ...view, events: [{ hour: game.hour, message: 'Battle', battle }] };
    assert.equal(validObservation(invalid), false);
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: { ...game, events: [{ hour: game.hour, message: 'Battle', battle }] } })));
  }
});
