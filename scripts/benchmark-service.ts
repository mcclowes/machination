/**
 * Measure the current single-file service before choosing checkpoints or another persistence backend.
 *
 * @format
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';
import { GameService } from '../server/service';
import { createGame } from '../src/game/world';
import { HOUR_MS } from '../src/game/retirement';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'Benchmark the real service using disposable state: --rooms=1,10 --commands=100 --samples=20 --hours=24',
  );
  process.exit(0);
}
if (args.some((arg) => !/^--(?:rooms|commands|samples|hours)=/.test(arg)))
  throw new Error('Unknown benchmark option. Use --help.');

function option(name: string, fallback: string) {
  return (
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith(`--${name}=`))
      ?.split('=')[1] ?? fallback
  );
}
function count(text: string, maximum: number) {
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`Choose an integer from 1 to ${maximum}.`);
  return value;
}
const roomCounts = option('rooms', '1,10')
  .split(',')
  .map((value) => count(value, 100));
const commands = count(option('commands', '100'), 1000);
const samples = count(option('samples', '20'), 100);
const hours = count(option('hours', '24'), 47);
const credential = () => randomBytes(32).toString('hex');
function distribution(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    Math.round(ordered[Math.ceil(ordered.length * fraction) - 1]! * 100) / 100;
  return {
    samples: values.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: percentile(1),
  };
}
async function duration(run: () => Promise<unknown>) {
  const start = performance.now();
  await run();
  return performance.now() - start;
}

async function main() {
  for (const roomCount of roomCounts) {
    const directory = await mkdtemp(join(tmpdir(), 'machination-service-benchmark-'));
    const delay = monitorEventLoopDelay({ resolution: 10 });
    try {
      const file = join(directory, 'games.json');
      let now = 0;
      const service = await GameService.open(
        file,
        () => now,
        () => createGame(0, { you: 1, vesper: 2, null: 3 }),
      );
      const rooms = [];
      for (let index = 0; index < roomCount; index++) {
        const token = credential();
        const created = await service.create(token);
        await service.join(created.invite, credential());
        await service.join(created.invite, credential());
        const snapshot = await service.start(created.id, token);
        rooms.push({ token, snapshot });
      }
      const active = rooms[0]!;
      const rock = active.snapshot.game.rocks.find(
        (site) => site.owner === active.snapshot.faction,
      )!;
      const commandTimes: number[] = [];
      const pollTimes: number[] = [];
      const historyTimes: number[] = [];
      delay.enable();
      await setImmediate();
      for (let index = 0; index < commands; index++) {
        now += HOUR_MS / 60;
        commandTimes.push(
          await duration(async () => {
            active.snapshot = await service.site(active.snapshot.id, active.token, {
              requestId: randomUUID(),
              revision: active.snapshot.revision,
              rock: rock.id,
              action: 'shields',
              disabled: index % 2 === 0,
            });
          }),
        );
      }
      now += hours * HOUR_MS;
      const catchUpMs = await duration(() => service.snapshot(active.snapshot.id, active.token));
      for (let index = 0; index < samples; index++) {
        pollTimes.push(await duration(() => service.snapshot(active.snapshot.id, active.token)));
        historyTimes.push(
          await duration(() => service.history(active.snapshot.id, active.token, commands / 60)),
        );
      }
      const other = rooms.at(-1)!;
      const otherStarted = performance.now();
      const history = service.history(active.snapshot.id, active.token, commands / 60);
      let otherRoomMs = 0;
      await Promise.all([
        history,
        service.snapshot(other.snapshot.id, other.token).then(() => {
          otherRoomMs = performance.now() - otherStarted;
        }),
      ]);
      await setImmediate();
      delay.disable();
      console.log(
        JSON.stringify({
          runtime: { node: process.versions.node, v8: process.versions.v8 },
          rooms: roomCount,
          commands,
          catchUpHours: hours,
          databaseBytes: (await stat(file)).size,
          command: distribution(commandTimes),
          poll: distribution(pollTimes),
          history: distribution(historyTimes),
          catchUpMs: Math.round(catchUpMs * 100) / 100,
          queuedDifferentRoom: roomCount > 1,
          queuedPollMs: Math.round(otherRoomMs * 100) / 100,
          eventLoopSamples: delay.count,
          eventLoopP99Ms: Math.round(delay.percentile(99) / 10_000) / 100,
          eventLoopMaxMs: Math.round(delay.max / 10_000) / 100,
        }),
      );
    } finally {
      delay.disable();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Service benchmark failed.');
  process.exitCode = 1;
});
