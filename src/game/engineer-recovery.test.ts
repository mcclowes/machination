import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, dispatch } from './simulation';
import { createConfiguredGame } from './world';
import { decodeSave } from './save-format';
import { createArchive, replayTo } from './replay';

function battle(driftingBases = false) {
  const game = createConfiguredGame({ playerCount: 3, mode: 'mining', driftingBases }, 0, 73);
  for (const rock of game.rocks) { rock.productionAt = 1000; rock.shieldsDisabled = true; rock.shield = 0; }
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const target = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  source.drones = 100; target.drones = 1;
  source.specialists!.push(...[1, 2, 3].map(n => ({ id: `engineer-${n}`, kind: 'engineer' as const, owner: 'you' as const })));
  return { game, source, target };
}

test('new games cap stacked Engineer recovery at the drones lost in station combat', () => {
  const { game, source, target } = battle();
  const attack = dispatch(game, source.id, target.id, 10, 'you', false, source.specialists!.map(u => u.id));
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === target.id)!.owner, 'you');
  assert.equal(end.rocks.find(r => r.id === target.id)!.drones, 10);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  assert.deepEqual(replayTo(createArchive(attack), end.hour, { knownThrough: end.hour, rivals: false }), end);
  assert.deepEqual(advance(advance(attack, .37, { rivals: false }), end.hour, { rivals: false }), end);
});

test('outpost defenders also cap stacked global and local recovery', () => {
  const { game, source, target } = battle();
  target.drones = 10;
  target.specialists = source.specialists!.map(u => ({ ...u, owner: 'vesper' }));
  source.specialists = [];
  const attack = dispatch(game, source.id, target.id, 1, 'you');
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === target.id)!.owner, 'vesper');
  assert.equal(end.rocks.find(r => r.id === target.id)!.drones, 10);
});

test('opposing-route winners cannot manufacture drones through Engineer stacking', () => {
  const { game, source, target } = battle();
  const out = dispatch(game, source.id, target.id, 10, 'you', false, source.specialists!.map(u => u.id));
  const both = dispatch(out, target.id, source.id, 1, 'vesper');
  const contact = (both.fleets[0]!.departed + both.fleets[0]!.arrives) / 2;
  const end = advance(both, contact + 1e-8, { rivals: false });
  assert.equal(end.fleets.length, 1);
  assert.equal(end.fleets[0]!.owner, 'you');
  assert.equal(end.fleets[0]!.drones, 10);
});

test('capping repair does not discard drones legitimately converted by Thieves', () => {
  const { game, source, target } = battle();
  target.drones = 20;
  source.specialists!.push(...Array.from({ length: 7 }, (_, n) => ({ id: `thief-${n}`, kind: 'thief' as const, owner: 'you' as const })));
  const attack = dispatch(game, source.id, target.id, 10, 'you', false, source.specialists!.map(u => u.id));
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === target.id)!.drones, 30);
});

test('existing stationary and drifting games retain their previous Engineer results', () => {
  for (const revision of [5, 6] as const) {
    const { game, source, target } = battle(revision === 6);
    game.rules!.mechanicsVersion = revision; delete game.rules!.driftingBases;
    const attack = dispatch(game, source.id, target.id, 10, 'you', false, source.specialists!.map(u => u.id));
    const loaded = decodeSave(JSON.stringify({ savedAt: 0, game: attack })).game;
    const end = advance(loaded, attack.fleets[0]!.arrives, { rivals: false });
    assert.equal(end.rocks.find(r => r.id === target.id)!.drones, 15);
    assert.deepEqual(replayTo(createArchive(loaded), end.hour, { knownThrough: end.hour, rivals: false }), end);
  }
});
