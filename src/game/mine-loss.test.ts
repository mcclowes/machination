import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { advance, dispatch, type Game } from './simulation';

function miningGame(): Game {
  const game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 10);
  for (const rock of game.rocks) Object.assign(rock, { x: 50, y: 0 });
  return game;
}

test('capturing a mine rounds the former owner cargo loss up and gives the attacker no cargo', () => {
  const game = miningGame();
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const mine = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 10, y: 50, drones: 100 });
  Object.assign(mine, { x: 18, y: 50, kind: 'mine', drones: 0, shield: 0, miningAt: 24 });
  game.cargo.vesper = 11;
  const sent = dispatch(game, source.id, mine.id, 50, 'you');
  const captured = advance(sent, sent.fleets[0]!.arrives);
  assert.equal(captured.rocks.find(r => r.id === mine.id)!.owner, 'you');
  assert.equal(captured.cargo.vesper, 8);
  assert.equal(captured.cargo.you, 0);
  assert.equal(game.cargo.vesper, 11);
});

test('old rules retain their fractional mine-loss result for deterministic replay', () => {
  const game = miningGame(); delete game.rules!.mechanicsVersion;
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const mine = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 10, y: 50, drones: 100 });
  Object.assign(mine, { x: 18, y: 50, kind: 'mine', drones: 0, shield: 0, miningAt: 24 });
  game.cargo.vesper = 11;
  const sent = dispatch(game, source.id, mine.id, 50, 'you');
  assert.equal(advance(sent, sent.fleets[0]!.arrives).cargo.vesper, 8.8);
});

test('a martyr destroys a mine without transferring ownership or charging its owner a cargo penalty', () => {
  const game = miningGame();
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const mine = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 10, y: 50, drones: 100 });
  source.specialists!.push({ id: 'mine-martyr', kind: 'martyr', owner: 'you' });
  Object.assign(mine, { x: 18, y: 50, kind: 'mine', drones: 20, shield: 0, miningAt: 24 });
  game.cargo.vesper = 11;
  const sent = dispatch(game, source.id, mine.id, 1, 'you', false, ['mine-martyr']);
  const result = advance(sent, sent.fleets[0]!.arrives);
  const wreck = result.rocks.find(r => r.id === mine.id)!;
  assert.equal(wreck.destroyed, true);
  assert.equal(wreck.owner, 'vesper');
  assert.equal(wreck.drones, 0);
  assert.deepEqual(wreck.specialists, []);
  assert.equal(result.cargo.vesper, 11);
});

test('retained wrecks provide sonar but no factory output, power, shields, or active mine clocks', async () => {
  const { detonate } = await import('./destruction');
  const { maximumShield, powerCapacity, nextEconomyEvent } = await import('./economy');
  const { miningInterval } = await import('./mining');
  const { observe } = await import('./visibility');
  const game = miningGame();
  const sites = game.rocks.filter(r => r.owner === 'you' && !r.coreOf);
  const [factory, generator, mine] = sites;
  Object.assign(factory!, { x: 10, y: 50, kind: 'factory' });
  Object.assign(generator!, { x: 11, y: 50, kind: 'generator' });
  Object.assign(mine!, { x: 12, y: 50, kind: 'mine', miningAt: 24 });
  const contact = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(contact, { x: 30, y: 50 });
  const before = powerCapacity(game, 'you');
  detonate(game, factory!);
  assert.equal(powerCapacity(game, 'you'), before - 50);
  assert.equal(maximumShield(factory!), 0);
  assert.equal(maximumShield(generator!), 0);
  assert.equal(miningInterval(game, 'you'), 12);
  assert.equal(observe(game, 'you').rocks.find(r => r.id === contact.id)!.known, true);
  for (const site of game.rocks.filter(r => !r.destroyed)) site.owner = null;
  assert.equal(nextEconomyEvent(game), Infinity);
});

test('destroyed mines and factories stay inert through future simulation and survive save validation', async () => {
  const { detonate } = await import('./destruction');
  const { decodeSave } = await import('./save-format');
  const game = miningGame();
  const factory = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const mine = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(factory, { x: 10, y: 50, kind: 'factory' });
  Object.assign(mine, { x: 12, y: 50, kind: 'mine', miningAt: 24 });
  game.cargo.vesper = 11;
  detonate(game, factory);
  const later = advance(game, 48);
  assert.equal(later.rocks.find(r => r.id === factory.id)!.drones, 0);
  assert.equal(later.rocks.find(r => r.id === factory.id)!.shield, 0);
  assert.equal(later.cargo.vesper, 11);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: later })).game, later);
});

test('wreck persistence rejects surviving resources, units, and unsupported mechanics versions', async () => {
  const { detonate } = await import('./destruction');
  const { decodeSave } = await import('./save-format');
  const game = miningGame();
  const site = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  Object.assign(site, { x: 10, y: 50 }); detonate(game, site);
  for (const patch of [{ drones: 1 }, { shield: 1 }, { coreOf: 'you' }, { module: 'routing' }, { specialists: [{ id: 'wreck-survivor', owner: 'you', kind: 'engineer' }] }]) {
    const broken = structuredClone(game);
    Object.assign(broken.rocks.find(r => r.id === site.id)!, patch);
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: broken })));
  }
  const envelope = JSON.parse(JSON.stringify({ savedAt: 0, game }));
  envelope.game.rules.mechanicsVersion = 99;
  assert.throws(() => decodeSave(JSON.stringify(envelope)));
});

test('owned wrecks cannot accept mine, shield, or transfer commands', async () => {
  const { detonate } = await import('./destruction');
  const { drillMine, setShields } = await import('./economy');
  const { scheduleTransfer } = await import('./orders');
  const game = miningGame();
  const site = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const other = game.rocks.find(r => r.owner === 'you' && r.id !== site.id)!;
  Object.assign(site, { x: 10, y: 50 }); detonate(game, site);
  assert.throws(() => setShields(game, site.id, 'you', true));
  assert.throws(() => drillMine(game, site.id, 'you'));
  assert.throws(() => dispatch(game, other.id, site.id, 1, 'you'));
  assert.throws(() => dispatch(game, site.id, other.id, 1, 'you'));
  assert.throws(() => scheduleTransfer(game, { id: 'wreck-plan-00000001', owner: 'you', from: site.id, to: other.id, drones: 1, executeAt: 1 }));
  assert.throws(() => scheduleTransfer(game, { id: 'wreck-plan-00000002', owner: 'you', from: other.id, to: site.id, drones: 1, executeAt: 1 }));
});

test('capture and explosion replays written before the correction still load their exact historical states', async () => {
  const { readFile } = await import('node:fs/promises');
  const { decodeOperation } = await import('./operation-save');
  const fixtures = JSON.parse(await readFile('src/game/fixtures/mine-replays-e92b028.json', 'utf8'));
  for (const fixture of fixtures) assert.deepEqual(decodeOperation(JSON.stringify(fixture), fixture.savedAt).game, fixture.game);
});

test('mine capture handles zero cargo, small balances, and exact fifths without fractional cargo', () => {
  for (const [cargo, remaining] of [[0, 0], [1, 0], [4, 3], [5, 4], [199, 159]]) {
    const game = miningGame();
    const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
    const mine = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
    Object.assign(source, { x: 10, y: 50, drones: 100 });
    Object.assign(mine, { x: 18, y: 50, kind: 'mine', drones: 0, shield: 0, miningAt: 24 });
    game.cargo.vesper = cargo;
    const sent = dispatch(game, source.id, mine.id, 50, 'you');
    assert.equal(advance(sent, sent.fleets[0]!.arrives).cargo.vesper, remaining);
  }
});
