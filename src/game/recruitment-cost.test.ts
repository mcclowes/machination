import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance } from './simulation';
import { drillMine, mineCost } from './economy';
import { decodeSave } from './save-format';
import { applyCommand, createArchive, executeCommand, replayTo } from './replay';
import { hireSpecialist, newRecruitment, promoteSpecialist, recruitmentStatus } from './specialists';
import { scheduleAction } from './future-actions';
import { forecastObservation, observe } from './visibility';
import { setFunding } from './funding';
import { createGame } from './world';
import { decodeSharedReplay, encodeSharedReplay } from '../replay/codec';
import { generateSharedReplay } from '../replay/generate';

test('new operations give every player a sixth site with a working mine and five cargo', () => {
  for (const mode of ['mining', 'pulse', 'domination'] as const) for (const playerCount of [2, 3, 10]) {
    const game = createConfiguredGame({ playerCount, mode }, 0, 73);
    assert.equal(game.rules!.victoryTarget, mode === 'mining' ? 300 : mode === 'pulse' ? 1 : playerCount * 5);
    for (const owner of game.rules!.players) {
      const sites = game.rocks.filter(r => r.owner === owner);
      assert.equal(sites.length, 6);
      assert.equal(sites.reduce((sum, r) => sum + r.drones, 0), 160);
      const mines = sites.filter(r => r.kind === 'mine');
      assert.equal(mines.length, 1);
      assert.equal(mines[0]!.miningInterval, 4);
      assert.equal(mines[0]!.miningAt, 4);
      assert.equal(game.cargo[owner], 5);
      assert.equal(mineCost(game, owner), 100);
    }
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
    const earned = advance(game, 4, { rivals: false });
    for (const owner of game.rules!.players) assert.equal(earned.cargo[owner], 6);
  }
});

test('scheduled hires spend cargo at execution, use mine income, and fail atomically if income is lost', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
  game.cargo.you = 4;
  const kind = recruitmentStatus(game, 'you').offers[0]!;
  const scheduled = scheduleAction(game, { id: 'cargo-hire-at-mine-payout', owner: 'you', executeAt: 4, action: { type: 'hire', kind } });
  assert.equal(scheduled.cargo.you, 4);
  const throughSave = decodeSave(JSON.stringify({ savedAt: 0, game: scheduled })).game;
  const projected = forecastObservation(observe(throughSave, 'you'), 'you', 4);
  const executed = advance(throughSave, 4, { rivals: false });
  assert.equal(executed.cargo.you, 0);
  assert.equal(projected.cargo.you, 0);
  assert.equal(executed.recruitment!.you!.used, 1);
  assert.equal(executed.scheduled!.length, 0);
  const split = advance(advance(throughSave, 2, { rivals: false }), 4, { rivals: false });
  assert.deepEqual(split, executed);
  const lost = structuredClone(throughSave);
  const mine = lost.rocks.find(r => r.owner === 'you' && r.kind === 'mine')!;
  mine.owner = null;
  const failed = advance(lost, 4, { rivals: false });
  assert.equal(failed.cargo.you, 4);
  assert.deepEqual(failed.recruitment, lost.recruitment);
  assert.match(failed.events[0]!.message, /5 cargo/);
});

test('cargo charges replay once, withdraw ineligible funding, and leave promotions credit-only', () => {
  let game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
  game = advance(game, 3, { rivals: false });
  game.cargo.you = 25;
  game = setFunding(game, 'you', 'vesper', true);
  const baseline = structuredClone(game);
  const kind = recruitmentStatus(game, 'you').offers[0]!;
  const result = applyCommand(createArchive(game), { type: 'hire', owner: 'you', kind }, { rivals: false, knownThrough: 3 });
  assert.equal(result.game.cargo.you, 20);
  assert.deepEqual(result.game.funding, []);
  assert.deepEqual(replayTo(result.archive, 3, { rivals: false, knownThrough: 3 }), result.game);
  assert.deepEqual(game, baseline);
  const promoted = structuredClone(game);
  promoted.cargo.you = 0;
  promoted.funding = [];
  promoted.rocks.find(r => r.owner === 'you')!.specialists!.push({ id: 'promotion', kind: 'foreman', owner: 'you' });
  assert.equal(promoteSpecialist(promoted, 'you', 'promotion').cargo.you, 0);
});

test('existing recruitment rules still allow zero-cargo hires', () => {
  for (const revision of [undefined, 14, 15, 16] as const) {
    const game = revision === undefined ? createGame(0) : createConfiguredGame({ playerCount: 2, mode: revision >= 15 ? 'pulse' : 'mining' }, 0, 73, undefined, revision === 15 ? 16 : revision);
    if (game.rules) {
      game.rules.mechanicsVersion = revision;
      if (game.rules.mode === 'mining') game.rules.victoryTarget = 200;
      if (revision === 15) {
        delete game.rules.tacticalPulse; delete game.pulse!.tactical;
        game.recruitment = Object.fromEntries(game.rules.players.map((owner, index) => [owner, newRecruitment(index)]));
      }
    }
    const ready = advance(game, 4, { rivals: false });
    ready.cargo.you = 0;
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: ready })).game, ready);
    const kind = recruitmentStatus(ready, 'you').offers[0]!;
    const hired = hireSpecialist(ready, 'you', kind);
    assert.equal(hired.cargo.you, 0);
    assert.equal(hired.recruitment!.you!.used, 1);
  }
});

test('new mining victory requires 300 cargo and shared replays retain the new rules', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
  game.cargo.you = 200;
  assert.equal(advance(game, 1, { rivals: false }).winner, null);
  game.cargo.you = 299;
  const archive = createArchive(game);
  const won = advance(game, 4, { rivals: false });
  assert.equal(won.cargo.you, 300);
  assert.equal(won.winner, 'you');
  const replay = generateSharedReplay({ game: won, archive }, 'you', 0, 4);
  assert.deepEqual(decodeSharedReplay(encodeSharedReplay(replay)), replay);
});

test('the starting mine counts toward construction costs and domination can replace lost income', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'domination' }, 0, 73);
  const site = game.rocks.find(r => r.owner === 'you' && r.kind !== 'mine')!;
  site.drones = 100;
  const built = drillMine(game, site.id, 'you');
  assert.equal(built.rocks.find(r => r.id === site.id)!.drones, 0);
  assert.equal(mineCost(built, 'you'), 200);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: built })).game, built);
  const planned = scheduleAction(game, { id: 'domination-mine-order', owner: 'you', executeAt: 1, action: { type: 'drill-mine', rock: site.id } });
  assert.equal(advance(planned, 1, { rivals: false }).rocks.find(r => r.id === site.id)!.kind, 'mine');
});

test('a hire spends five cargo once, including batch hires, and an unaffordable hire changes nothing', () => {
  for (const kind of ['lieutenant', 'saboteur'] as const) {
    const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
    game.hour = recruitmentStatus(game, 'you').nextAt;
    game.recruitment!.you!.offers[0] = kind;
    const before = structuredClone(game);
    const hired = hireSpecialist(game, 'you', kind);
    assert.equal(hired.cargo.you, 0);
    assert.equal(hired.recruitment!.you!.used, 1);
    assert.deepEqual(game, before);
    const poor = { ...game, cargo: { ...game.cargo, you: 4 } };
    const unchanged = structuredClone(poor);
    assert.throws(() => executeCommand(poor, { type: 'hire', owner: 'you', kind }), /5 cargo/);
    assert.deepEqual(poor, unchanged);
  }
});
