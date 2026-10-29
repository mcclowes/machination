import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance, type Game } from './simulation';
import { applyCommand, createArchive, exportArchive, replayTo, type GameCommand } from './replay';
import { decodeSave } from './save-format';
import { decodeReplay } from './replay-save';
import type { GameOptions } from './rules';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function exercise(options: GameOptions, seed: number, rivals: boolean) {
  const baseline = freeze(createConfiguredGame(options, 0, seed));
  const original = structuredClone(baseline);
  let archive = createArchive(baseline, { rivals });
  let game: Game = baseline;
  for (const owner of rivals ? ['you'] as const : baseline.rules!.players) {
    const home = baseline.rocks.find(rock => rock.coreOf === owner)!;
    const source = baseline.rocks.find(rock => rock.owner === owner && rock.drones >= 10)!;
    const commands: GameCommand[] = [
      { type: 'dispatch', owner, from: source.id, to: home.id, drones: 5 },
      { type: 'schedule', owner, plan: { id: `reinforcement-${owner}-000001`, from: source.id, to: home.id, drones: 5, executeAt: 0.5 } },
      { type: 'schedule-action', owner, plan: { id: `shield-control-${owner}-000001`, executeAt: 0.75, action: { type: 'shields', rock: home.id, disabled: true } } },
    ];
    for (const command of commands) ({ archive, game } = applyCommand(archive, freeze(command), { rivals, knownThrough: 0 }));
  }
  assert.deepEqual(baseline, original, 'commands must leave their baseline unchanged');
  assert.ok(game.fleets.length > 0 && game.scheduled!.length > 0, 'the scenario must exercise live and queued transfers');
  const before = structuredClone(game);
  const expected = advance(freeze(game), 24, { rivals });
  let restored = game;
  for (const hour of [0.137, 1.01, 6.25, 11.999, 12, 12.001, 19.375, 24]) {
    restored = advance(restored, hour, { rivals });
    restored = decodeSave(JSON.stringify({ savedAt: 0, game: restored })).game;
  }
  assert.deepEqual(game, before, 'advancement must leave the input unchanged');
  assert.deepEqual(restored, expected, 'polling and save restoration must agree with one offline catch-up');
  assert.deepEqual(replayTo(archive, 24, { rivals, knownThrough: 24 }), expected, 'replay must agree with direct advancement');
  const loaded = decodeReplay(JSON.parse(JSON.stringify(exportArchive(archive))), expected, rivals);
  assert.deepEqual(replayTo(loaded, 24, { rivals, knownThrough: 24 }), expected, 'persisted history must reconstruct the same operation');
  assert.deepEqual(replayTo(loaded, 0, { rivals, knownThrough: 24 }), game, 'restoration must retain historical command order');
  assert.deepEqual(baseline, original);
}

for (const playerCount of [2, 6, 10]) for (const mode of ['mining', 'domination'] as const)
  for (const driftingBases of [false, true]) for (const rivals of [false, true]) {
    test(`${playerCount}-seat ${mode}, drift=${driftingBases}, rivals=${rivals}: catch-up, saved polling, and replay agree`, () => {
      for (const seed of [0, 73, 0xffffffff]) {
        try { exercise({ playerCount, mode, driftingBases }, seed, rivals); }
        catch (error) { throw new Error(`Configuration seed ${seed}`, { cause: error }); }
      }
    });
  }
