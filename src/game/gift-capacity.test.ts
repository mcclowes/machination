import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, dispatch } from './simulation';
import { createConfiguredGame } from './world';
import { giftTransfer } from './gifts';
import { droneInventory, powerCapacity } from './economy';
import { nextRouteEncounter } from './route-encounters';
import { decodeSave } from './save-format';
import { createArchive, replayTo } from './replay';

function fixture() {
  const game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 73);
  for (const rock of game.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; rock.drones = 0; }
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const target = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 20, y: 20, drones: 30 });
  Object.assign(target, { x: 68, y: 20, drones: powerCapacity(game, 'vesper') - 7 });
  return { game, source, target };
}

test('station gifts discard only incoming drones beyond recipient capacity', () => {
  const { game, source, target } = fixture();
  const gift = giftTransfer(game, source.id, target.id, 30, 'you', 'vesper');
  const end = advance(gift, gift.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === target.id)!.drones, powerCapacity(end, 'vesper'));
  assert.equal(droneInventory(end, 'vesper'), powerCapacity(end, 'vesper'));
  assert.equal(droneInventory(end, 'you'), 0);
  assert.equal(game.rocks.find(r => r.id === source.id)!.drones, 30);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  assert.deepEqual(replayTo(createArchive(gift), end.hour, { knownThrough: end.hour, rivals: false }), end);
});

test('sub contacts cap incoming gifts without reducing the recipient fleet', () => {
  const { game, source, target } = fixture();
  const gift = giftTransfer(game, source.id, target.id, 30, 'you', 'vesper');
  const both = dispatch(gift, target.id, source.id, 1, 'vesper');
  const underway = advance(both, both.fleets[0]!.departed, { rivals: false });
  const end = advance(underway, nextRouteEncounter(underway), { rivals: false });
  assert.equal(end.fleets.find(f => f.id === gift.fleets[0]!.id)!.drones, 7);
  assert.equal(end.fleets.find(f => f.id !== gift.fleets[0]!.id)!.drones, 1);
  assert.equal(droneInventory(end, 'vesper'), powerCapacity(end, 'vesper'));
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  assert.deepEqual(replayTo(createArchive(both), end.hour, { knownThrough: end.hour, rivals: false }), end);
  assert.deepEqual(advance(advance(both, .37, { rivals: false }), end.hour, { rivals: false }), end);
});

for (const contact of ['station', 'sub'] as const) for (const surplus of [0, 19]) {
  test(`${contact} gifts at ${surplus ? 'above' : 'exactly'} capacity preserve existing drones and transfer specialists`, () => {
    const { game, source, target } = fixture();
    const existing = powerCapacity(game, 'vesper') + surplus;
    target.drones = existing;
    source.specialists!.push({ id: 'gift-assassin', owner: 'you', kind: 'assassin' });
    let gift = giftTransfer(game, source.id, target.id, 30, 'you', 'vesper', false, ['gift-assassin']);
    if (contact === 'sub') gift = dispatch(gift, target.id, source.id, 1, 'vesper');
    const underway = advance(gift, gift.fleets[0]!.departed, { rivals: false });
    const hour = contact === 'sub' ? nextRouteEncounter(underway) : gift.fleets[0]!.arrives;
    const end = advance(underway, hour, { rivals: false });
    assert.equal(droneInventory(end, 'vesper'), existing);
    const carrier = [...end.rocks, ...end.fleets].find(a => a.specialists?.some(u => u.id === 'gift-assassin'))!;
    assert.equal(carrier.owner, 'vesper');
    assert.deepEqual(carrier.specialists!.find(u => u.id === 'gift-assassin'), { id: 'gift-assassin', owner: 'vesper', kind: 'assassin' });
    if (contact === 'sub') assert.equal(carrier.drones, 0);
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  });
}

for (const kind of ['energy', 'tinkerer'] as const) {
  test(`a gifted ${kind} contributes capacity when docked before accepting its drone cargo`, () => {
    const { game, source, target } = fixture();
    source.specialists!.push({ id: 'capacity-gift', owner: 'you', kind });
    const gift = giftTransfer(game, source.id, target.id, 30, 'you', 'vesper', false, ['capacity-gift']);
    const end = advance(gift, gift.fleets[0]!.arrives, { rivals: false });
    assert.equal(droneInventory(end, 'vesper'), 273);
    assert.ok(powerCapacity(end, 'vesper') >= 273);
  });
}

for (const reverse of [false, true]) {
  test(`reciprocal gifts free both outgoing manifests before capacity is applied, reverse=${reverse}`, () => {
    const { game, source, target } = fixture();
    source.drones = powerCapacity(game, 'you') - 5;
    const first = reverse ? giftTransfer(game, target.id, source.id, 20, 'vesper', 'you') : giftTransfer(game, source.id, target.id, 30, 'you', 'vesper');
    const both = reverse ? giftTransfer(first, source.id, target.id, 30, 'you', 'vesper') : giftTransfer(first, target.id, source.id, 20, 'vesper', 'you');
    const underway = advance(both, both.fleets[0]!.departed, { rivals: false });
    const end = advance(underway, nextRouteEncounter(underway), { rivals: false });
    assert.equal(droneInventory(end, 'you'), 235);
    assert.equal(droneInventory(end, 'vesper'), 250);
    assert.equal(end.fleets.find(f => f.owner === 'you')!.drones, 20);
    assert.equal(end.fleets.find(f => f.owner === 'vesper')!.drones, 27);
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
    assert.deepEqual(replayTo(createArchive(both), end.hour, { knownThrough: end.hour, rivals: false }), end);
  });
}

test('ordinary friendly transfers keep owned drones even when above capacity', () => {
  const { game, source } = fixture();
  source.drones = powerCapacity(game, 'you') + 30;
  const target = game.rocks.find(r => r.owner === 'you' && r.id !== source.id && !r.coreOf)!;
  const own = dispatch(game, source.id, target.id, 30, 'you');
  const end = advance(own, own.fleets[0]!.arrives, { rivals: false });
  assert.equal(droneInventory(end, 'you'), 280);
});

test('a fully rejected drone-only gift leaves no empty sub at contact', () => {
  const { game, source, target } = fixture();
  target.drones = powerCapacity(game, 'vesper');
  const gift = giftTransfer(game, source.id, target.id, 30, 'you', 'vesper');
  const both = dispatch(gift, target.id, source.id, 1, 'vesper');
  const underway = advance(both, both.fleets[0]!.departed, { rivals: false });
  const end = advance(underway, nextRouteEncounter(underway), { rivals: false });
  assert.equal(end.fleets.length, 1);
  assert.equal(end.fleets[0]!.id, both.fleets[1]!.id);
  assert.equal(droneInventory(end, 'vesper'), 250);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
});

for (const contact of ['station', 'sub'] as const) {
  test(`revision-seven ${contact} gifts preserve their original uncapped result`, () => {
    const { game, source, target } = fixture();
    game.rules!.mechanicsVersion = 7;
    let gift = giftTransfer(game, source.id, target.id, 30, 'you', 'vesper');
    if (contact === 'sub') gift = dispatch(gift, target.id, source.id, 1, 'vesper');
    const underway = advance(gift, gift.fleets[0]!.departed, { rivals: false });
    const end = advance(underway, contact === 'sub' ? nextRouteEncounter(underway) : gift.fleets[0]!.arrives, { rivals: false });
    assert.equal(droneInventory(end, 'vesper'), 273);
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  });
}
