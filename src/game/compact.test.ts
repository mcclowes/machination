import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, advance } from './simulation';
import { createCompact, castCouncilVote, compactAllows, councilBallots, proposeCouncilPolicy } from './compact';
import { resign } from './retirement';
import { executeCommand } from './replay';
import { createConfiguredGame } from './world';
import { decodeSave } from './save-format';
import { scheduleTransfer } from './orders';

test('the Belt compact starts restricted and a majority lifts transit limits for two days', () => {
  let game = createGame(0);
  game.compact = createCompact(['you', 'vesper', 'null']);
  assert.equal(compactAllows(game, 'transit'), false);
  game = castCouncilVote(game, 'you', 1, 'yes');
  game = castCouncilVote(game, 'vesper', 1, 'yes');
  assert.equal(compactAllows(game, 'transit'), false);
  const resolved = advance(game, 24, { rivals: false });
  assert.equal(resolved.compact!.history[0]!.result, 'passed');
  assert.equal(compactAllows(resolved, 'transit'), true);
  assert.equal(compactAllows(advance(resolved, 72, { rivals: false }), 'transit'), false);
  assert.equal(game.compact!.history.length, 0);
});

test('only the final public position counts; abstention, absence, and ties do not pass a motion', () => {
  let game = createGame(0); game.compact = createCompact(['you', 'vesper', 'null']);
  game = castCouncilVote(game, 'you', 1, 'yes');
  game = castCouncilVote(game, 'vesper', 1, 'yes');
  game = { ...game, hour: 1 };
  game = castCouncilVote(game, 'you', 1, 'abstain');
  const result = advance(game, 24, { rivals: false });
  assert.equal(result.compact!.history[0]!.result, 'failed');
  assert.deepEqual(councilBallots(result.compact!.history[0]!), { you: 'abstain', vesper: 'yes' });
  assert.equal(result.compact!.history[0]!.changes.length, 3);
  assert.throws(() => castCouncilVote(result, 'you', 1, 'yes'), /closed/);
  assert.throws(() => castCouncilVote(result, 'you', 2, 'maybe' as never), /Choose/);
});

test('daily agenda priority rotates and the charter supplies quiet-day motions', () => {
  let game = createGame(0); game.compact = createCompact(['you', 'vesper', 'null']);
  game = proposeCouncilPolicy(game, 'you', 'sensors', 1);
  game = proposeCouncilPolicy(game, 'vesper', 'weapons', 1);
  game = advance(game, 24, { rivals: false });
  assert.equal(game.compact!.motion!.proposer, 'vesper');
  assert.equal(game.compact!.motion!.policy, 'weapons');
  assert.equal(game.compact!.proposals.you, 'sensors');
  game = advance(game, 48, { rivals: false });
  assert.equal(game.compact!.motion!.proposer, 'you');
  assert.equal(game.compact!.motion!.policy, 'sensors');
  game = advance(game, 72, { rivals: false });
  assert.equal(game.compact!.motion!.proposer, undefined);
  assert.equal(game.compact!.motion!.policy, 'infrastructure');
});

test('elimination keeps the opening electorate fixed and operation completion cancels the ballot', () => {
  let game = createGame(0); game.compact = createCompact(['you', 'vesper', 'null']);
  game = castCouncilVote(game, 'vesper', 1, 'yes');
  game = resign(game, 'vesper');
  assert.throws(() => castCouncilVote(game, 'vesper', 1, 'no'), /active intelligence/);
  game = castCouncilVote(game, 'you', 1, 'yes');
  game = advance(game, 24, { rivals: false });
  assert.equal(game.compact!.history[0]!.electorate.length, 3);
  assert.equal(game.compact!.history[0]!.result, 'passed');
  assert.equal(game.compact!.motion!.electorate.includes('vesper'), false);
  game = executeCommand(game, { type: 'resign', owner: 'null' });
  assert.equal(game.compact!.motion, undefined);
  assert.equal(game.compact!.history.at(-1)!.result, 'canceled');
});

test('compact saves round-trip while old games keep their original permissions', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining', beltCompact: true }, 0, 7);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game.compact, game.compact);
  const old = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 7);
  assert.equal(decodeSave(JSON.stringify({ savedAt: 0, game: old })).game.compact, undefined);
  assert.equal(compactAllows(old, 'weapons'), true);
  const corrupted = structuredClone(game); corrupted.compact!.motion!.closesAt = 2;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: corrupted })), /damaged/);
});

test('a ballot closing at a scheduled launch authorizes that launch in both pulse and mining games', () => {
  for (const mode of ['pulse', 'mining'] as const) {
    let game = createConfiguredGame({ playerCount: 3, mode, beltCompact: true }, 0, 7);
    const sites = game.rocks.filter(r => r.owner === 'you');
    sites[0]!.drones = 30;
    game = castCouncilVote(game, 'you', 1, 'yes');
    game = castCouncilVote(game, 'vesper', 1, 'yes');
    game = scheduleTransfer(game, { id: 'compact-future-launch-0001', owner: 'you', from: sites[0]!.id, to: sites[1]!.id, drones: 1, executeAt: 24 });
    const result = advance(game, 24, { rivals: false });
    assert.equal(result.fleets.at(-1)!.speed, 12, mode);
  }
});
