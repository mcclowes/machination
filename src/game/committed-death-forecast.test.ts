import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CommittedDeathForecast } from './committed-death-forecast';
import { executeCommand } from './replay';
import { advance } from './simulation';
import { predictSpecialistDeaths } from './temporal-intelligence';
import { temporalWorld } from './temporal-test-world';
import { createConfiguredGame } from './world';

function threatenedGame(executeAt: number) {
  let game = temporalWorld();
  game.rocks[0]!.specialists!.push({ id: 'foresight', kind: 'foresight', owner: 'you' });
  Object.assign(game.rocks[1]!, { x: 16, y: 0 });
  game.rocks[1]!.specialists!.push({ id: 'victim', kind: 'foreman', owner: 'you' });
  Object.assign(game.rocks[10]!, { x: 50, y: 0 });
  game.rocks[10]!.specialists!.push({ id: 'assassin', kind: 'assassin', owner: 'vesper' });
  game = executeCommand(game, { type: 'schedule', owner: 'vesper', plan: {
    id: 'forecast-threat-0001', from: game.rocks[10]!.id, to: game.rocks[1]!.id,
    drones: 1, specialists: ['assassin'], executeAt,
  } });
  return game;
}

const committed = { rivals: false, temporalForecast: true } as const;

test('overlapping Foresight predictions update the responsible source when a queued attack launches', () => {
  const game = threatenedGame(25), before = structuredClone(game);
  const forecast = new CommittedDeathForecast();
  const queued = advance(game, 24.137, committed);
  assert.deepEqual(predictSpecialistDeaths(queued, forecast), [{
    owner: 'you', specialistId: 'victim', deathAt: 29.416666666666668,
    source: 'queued enemy transfer from Basalt to Chert at hour 25.00',
  }]);
  const launched = advance(queued, 25, committed);
  assert.deepEqual(predictSpecialistDeaths(launched, forecast), [{
    owner: 'you', specialistId: 'victim', deathAt: 29.416666666666668,
    source: 'enemy hauler from Basalt to Chert',
  }]);
  assert.deepEqual(predictSpecialistDeaths(launched, forecast), predictSpecialistDeaths(launched));
  assert.deepEqual(game, before);
});

test('extending Foresight includes a threatened specialist at the exact recorded horizon boundary', () => {
  const game = threatenedGame(49), forecast = new CommittedDeathForecast();
  const entry = 29.416666666666664;
  assert.deepEqual(predictSpecialistDeaths(game, forecast), []);
  assert.deepEqual(predictSpecialistDeaths(advance(game, entry - 1e-8, committed), forecast), []);
  const expected = [{ owner: 'you', specialistId: 'victim', deathAt: 53.416666666666664,
    source: 'queued enemy transfer from Basalt to Chert at hour 49.00' }];
  assert.deepEqual(predictSpecialistDeaths(advance(game, entry, committed), forecast), expected);
  assert.deepEqual(predictSpecialistDeaths(advance(game, entry + 1e-8, committed), forecast), expected);
});

test('Foresight discards an overlapping prediction after cancellation and after a divergent specialist change', () => {
  const game = threatenedGame(25), forecast = new CommittedDeathForecast();
  assert.equal(predictSpecialistDeaths(game, forecast).length, 1);
  const canceled = executeCommand(game, { type: 'cancel-schedule', owner: 'vesper', id: 'forecast-threat-0001' });
  assert.deepEqual(predictSpecialistDeaths(advance(canceled, 24.5, committed), forecast), []);
  const changed = structuredClone(game);
  changed.rocks[1]!.specialists = [];
  const current = advance(changed, 24.75, committed);
  assert.deepEqual(predictSpecialistDeaths(current, forecast), predictSpecialistDeaths(current));
  assert.deepEqual(predictSpecialistDeaths(current, forecast), []);
  assert.equal(predictSpecialistDeaths(game, forecast).length, 1);
});

test('ten-player solo catch-up retains the complete frozen revision 19 state and input', () => {
  const game = createConfiguredGame({ playerCount: 10, mode: 'mining', driftingBases: false, gravity: true }, 0, 0);
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const before = hash(game);
  const result = advance(game, 6, { rivals: true });
  assert.equal(hash(result), '333c90475d5a0071fbfb7567077bb55344bdd347938477806bd956b41e383ac7');
  assert.equal(hash(game), before);
});
