import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { validateOptions, validateRules, victoryProgress } from './rules';
import { actStrategicPlayer } from './rival-ai';
import { advance, operationStatus } from './simulation';
import { mineCost } from './economy';

test('doubles creates two fixed pairs and preserves current starting resources', () => {
  const game = createConfiguredGame({ playerCount: 4, mode: 'mining', teamFormat: '2v2' }, 0, 471);
  assert.deepEqual(game.rules!.teams!.members, [['you', 'vesper'], ['null', 'aether']]);
  assert.equal(game.rules!.victoryTarget, 300);
  assert.equal(game.rules!.mechanicsVersion, 18);
  assert.equal(game.rocks.length, 40);
  assert.equal(game.rocks.filter(rock => rock.kind === 'mine').length, 4);
  assert.equal(game.cargo.you, 5);
  assert.deepEqual(validateRules(game.rules), game.rules);
});

test('doubles pools both players toward victory and counts starting mines per pair', () => {
  const game = createConfiguredGame({ playerCount: 4, mode: 'mining', teamFormat: '2v2' }, 0, 471);
  assert.equal(mineCost(game, 'you'), 200);
  game.cargo.you = 145;
  game.cargo.vesper = 155;
  assert.equal(victoryProgress(game, 'vesper'), 300);
  const end = advance(game, 0.1, { rivals: false });
  assert.equal(operationStatus(end, 'you'), 'victory');
  assert.equal(operationStatus(end, 'vesper'), 'victory');
  assert.equal(operationStatus(end, 'null'), 'defeat');
  assert.throws(() => validateOptions({ playerCount: 4, mode: 'pulse', teamFormat: '2v2' }));
  assert.throws(() => validateOptions({ playerCount: 8, mode: 'mining', teamFormat: '2v2' }));
});

test('a doubles AI never attacks its teammate when allied sites are easy captures', () => {
  const game = createConfiguredGame({ playerCount: 4, mode: 'mining', teamFormat: '2v2' }, 0, 471);
  for (const rock of game.rocks) {
    rock.drones = rock.owner === 'you' ? 0 : rock.owner === 'vesper' ? 100 : 10000;
    rock.x = rock.owner === 'you' || rock.owner === 'vesper' ? 10 : 100;
    rock.y = 10;
  }
  const next = actStrategicPlayer(game, 'vesper');
  assert.equal(next.fleets.some(fleet => fleet.owner === 'vesper' && next.rocks.some(rock => rock.id === fleet.to && rock.owner === 'you')), false);
});
