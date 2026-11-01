import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, type Game } from './simulation';
import { applyCommand, createArchive, executeCommand, exportArchive, replaySlices, replayTo, type GameCommand, type ReplayArchive } from './replay';
import { decodeReplay } from './replay-save';
import { decodeOperation, decodeOperationSlices, encodeOperation } from './operation-save';
import { decodeSave } from './save-format';
import { createSoloGame } from './depletion';
import { DEFAULT_GAME_OPTIONS } from './rules';
import { createConfiguredGame } from './world';
import { HOURLY_FORESIGHT_REVISION, refreshForesight } from './temporal-intelligence';
import { temporalWorld } from './temporal-test-world';

const epoch = Date.parse('2026-10-31T00:00:00Z');
const json = (game: Game) => JSON.stringify(game);

/** The original replay: one advance from the baseline between recorded commands. */
function referenceReplay(archive: ReplayArchive, hour: number): Game {
  const { baseline, entries, rivals } = exportArchive(archive);
  let game = baseline;
  for (const entry of entries) {
    if (entry.hour > hour) break;
    if (entry.hour > game.hour) game = advance(game, entry.hour, { rivals });
    game = executeCommand(game, entry.command, rivals);
  }
  return hour > game.hour ? advance(game, hour, { rivals }) : game;
}

function playSolo(): { archive: ReplayArchive; live: Game } {
  // A seed where the idle player survives the scripted window.
  const start = createSoloGame(DEFAULT_GAME_OPTIONS, epoch, 6);
  let archive = createArchive(start, { rivals: true }), live = start;
  // Poll at uneven intervals like the device clock, ordering at the live frontier.
  for (const [i, hour] of [3.37, 7.9, 7.9, 13.05, 19.6].entries()) {
    while (live.hour < hour) live = advance(live, Math.min(hour, live.hour + 0.73), { rivals: true });
    const owned = live.rocks.filter(r => r.owner === 'you').sort((a, b) => b.drones - a.drones || a.id.localeCompare(b.id));
    const command: GameCommand = { type: 'dispatch', owner: 'you', from: owned[0]!.id, to: owned[1 + i % (owned.length - 1)]!.id, drones: 1 };
    ({ archive, game: live } = applyCommand(archive, command, { rivals: true, knownThrough: live.hour }));
  }
  live = advance(live, 23.4, { rivals: true });
  return { archive, live };
}

test('new operations record the hourly foresight revision', () => {
  assert.equal(createSoloGame(DEFAULT_GAME_OPTIONS, epoch, 1).rules!.mechanicsVersion, HOURLY_FORESIGHT_REVISION);
  assert.equal(createConfiguredGame(DEFAULT_GAME_OPTIONS, epoch, 1, undefined, 19).rules!.mechanicsVersion, 19);
});

test('checkpointed replays match a full replay from the baseline at every inspected hour', () => {
  const { archive, live } = playSolo();
  const options = { rivals: true, knownThrough: live.hour };
  for (const hour of [live.hour, 0.5, 6, 7.9, 12.99, 13.05, 21, 2, live.hour, 19.6, 18.2])
    assert.equal(json(replayTo(archive, hour, options)), json(referenceReplay(archive, hour)), `hour ${hour}`);
  assert.doesNotThrow(() => decodeReplay(exportArchive(archive), live, true));
});

test('sliced replay and sliced loading produce the same operation as one synchronous pass', () => {
  const { archive, live } = playSolo();
  const slices = replaySlices(archive, live.hour, { rivals: true, knownThrough: live.hour });
  let yielded = 0, step = slices.next();
  for (; !step.done; step = slices.next()) yielded++;
  assert.ok(yielded >= 20);
  assert.equal(json(step.value), json(referenceReplay(archive, live.hour)));

  const savedAt = epoch + live.hour * 3_600_000;
  const raw = encodeOperation({ game: live, archive }, savedAt);
  const now = savedAt + 5.5 * 3_600_000;
  const whole = decodeOperation(raw, now);
  const loading = decodeOperationSlices(raw, () => now);
  let loaded = loading.next(), pauses = 0;
  for (; !loaded.done; loaded = loading.next()) pauses++;
  assert.ok(pauses >= 25);
  assert.equal(json(loaded.value.game), json(whole.game));
  assert.equal(json(loaded.value.game), json(advance(live, live.hour + 5.5, { rivals: true })));
});

test('sliced loading counts the time spent loading', () => {
  const { archive, live } = playSolo();
  const savedAt = epoch + live.hour * 3_600_000;
  let now = savedAt + 2 * 3_600_000;
  const loading = decodeOperationSlices(encodeOperation({ game: live, archive }, savedAt), () => (now += 600_000));
  let step = loading.next();
  while (!step.done) step = loading.next();
  assert.ok(step.value.game.hour > live.hour + 2);
  assert.equal(step.value.game.hour, live.hour + (now - savedAt) / 3_600_000);
});

function threatenedWorld(owner: 'you' | 'vesper', revision: 19 | 20 = HOURLY_FORESIGHT_REVISION): Game {
  let game = temporalWorld();
  game.rules!.mechanicsVersion = revision;
  const [own, enemy] = owner === 'you' ? [0, 10] : [10, 0];
  const victim = owner === 'you' ? 1 : 2;
  game.rocks[own]!.specialists!.push({ id: 'seer', kind: 'foresight', owner });
  Object.assign(game.rocks[victim]!, { x: owner === 'you' ? 16 : 34, y: 0, owner });
  game.rocks[victim]!.specialists!.push({ id: 'victim', kind: 'foreman', owner });
  Object.assign(game.rocks[10]!, { x: 50, y: 0 });
  const attacker = owner === 'you' ? 'vesper' : 'you';
  game.rocks[enemy]!.specialists!.push({ id: 'blade', kind: 'assassin', owner: attacker });
  game = executeCommand(game, { type: 'schedule', owner: attacker, plan: {
    id: 'lethal-plan-0001', from: game.rocks[enemy]!.id, to: game.rocks[victim]!.id, drones: 1, specialists: ['blade'], executeAt: 25,
  } });
  return game;
}

test('revision 20 expires passed predictions between hourly refreshes and keeps saves valid', () => {
  const game = threatenedWorld('you');
  const warning = game.temporalIntel!.warnings[0]!;
  assert.equal(warning.specialistId, 'victim');
  const before = advance(game, warning.deathAt - 0.01, { rivals: false });
  assert.deepEqual(before.temporalIntel!.warnings.map(w => w.specialistId), ['victim']);
  const after = advance(before, warning.deathAt + 0.05, { rivals: false });
  assert.ok(!Number.isInteger(after.hour));
  assert.deepEqual(after.temporalIntel?.warnings ?? [], []);
  assert.doesNotThrow(() => decodeSave(JSON.stringify({ savedAt: 0, game: after })));
});

const warningCount = (game: Game): number => game.temporalIntel?.warnings.length ?? 0;

test('revision 20 skips foresight for automated rivals; revision 19 and human rivals keep it', () => {
  const rival = threatenedWorld('vesper');
  assert.equal(rival.temporalIntel?.warnings.length, 1, 'human-controlled rivals still receive warnings');
  delete rival.temporalIntel;
  refreshForesight(rival, true);
  assert.equal(warningCount(rival), 0);

  const legacy = threatenedWorld('vesper', 19);
  delete legacy.temporalIntel;
  refreshForesight(legacy, true);
  assert.equal(warningCount(legacy), 1);

  const player = threatenedWorld('you');
  delete player.temporalIntel;
  refreshForesight(player, true);
  assert.equal(warningCount(player), 1);
});
