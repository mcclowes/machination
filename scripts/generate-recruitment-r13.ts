/**
 * ---
 * purpose: Reproduce frozen recruitment results using an extracted pre-preview source archive.
 * related:
 *   - ../docs/recruitment-lifecycle.md
 * ---
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GameCommand, ReplayArchive } from '../src/game/replay';

const sourceCommit = '8d83a53cbec81cafbf0ced338eb071f0d644ac48';
async function main() {
  const [sourceDirectory, output] = process.argv.slice(2);
  if (!sourceDirectory || !output) throw new Error('Usage: node --import tsx scripts/generate-recruitment-r13.ts <extracted-8d83a53-source> <output.json>');
  const engine = resolve(sourceDirectory, 'src/game');
  const files = (await readdir(engine)).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')).sort();
  const fingerprint = createHash('sha256');
  for (const name of files) fingerprint.update(name).update('\0').update(await readFile(resolve(engine, name))).update('\0');
  assert.equal(fingerprint.digest('hex'), '263680468cf69706cb2b66385597ddc66cb34ae33574d785fe1efbee0b4896bf', 'Engine source must match the extracted 8d83a53 archive.');
  const source = (file: string) => pathToFileURL(resolve(sourceDirectory, 'src/game', file)).href;
  const { createConfiguredGame } = await import(source('world.ts')) as typeof import('../src/game/world');
  const { advance } = await import(source('simulation.ts')) as typeof import('../src/game/simulation');
  const { HIRE_KINDS, SPECIALISTS } = await import(source('specialist-catalog.ts')) as typeof import('../src/game/specialist-catalog');
  const { decodeSave } = await import(source('save-format.ts')) as typeof import('../src/game/save-format');
  const { createArchive, applyCommand, exportArchive, replayTo } = await import(source('replay.ts')) as typeof import('../src/game/replay');
  const baseline = (seed: number) => createConfiguredGame({ playerCount: 3, mode: 'mining', driftingBases: false }, 0, 17, { you: seed });
  const options = (hour: number) => ({ rivals: false, knownThrough: hour });
  assert.equal(baseline(4).rules!.mechanicsVersion, 13);

  function scenario(name: string, archive: ReplayArchive, hour: number, commands: GameCommand[], checkpointHours: number[] = []) {
    const before = replayTo(archive, hour, options(hour));
    return { name, hour, replay: exportArchive(archive), recruitment: before.recruitment,
      branches: commands.map(command => {
        const { game } = applyCommand(archive, command, options(hour));
        return { command, game, ...(command.type === 'schedule-action' ? {
          checkpoints: checkpointHours.map(at => ({ hour: at, game: advance(game, at, { rivals: false }) })),
        } : {}) };
      }) };
  }
  const first = createArchive(baseline(4), { rivals: false });
  const firstOffers = replayTo(first, 4, options(4)).recruitment!.you!.offers;
  const second = applyCommand(createArchive(baseline(0), { rivals: false }), { type: 'hire', owner: 'you', kind: 'lieutenant' }, options(4));
  const secondOffers = replayTo(second.archive, 22, options(22)).recruitment!.you!.offers;
  const unit = second.game.rocks.flatMap(site => site.specialists ?? []).find(unit => unit.owner === 'you' && unit.kind === 'lieutenant')!;

  // Strict-save-valid synthetic pool boundary, after a genuine Lieutenant hire.
  const depleted = replayTo(second.archive, 22, options(22));
  const state = depleted.recruitment!.you!;
  for (const kind of HIRE_KINDS.filter(kind => SPECIALISTS[kind].category === 'other')) state.pool[kind] = 0;
  state.pool.tinkerer = 1;
  state.offers[2] = 'tinkerer';
  const boundary = createArchive(decodeSave(JSON.stringify({ savedAt: 0, game: depleted })).game, { rivals: false });
  const fixture = { sourceCommit, node: process.versions.node, mechanicsVersion: 13,
    purpose: 'Synthetic revision-13 recruitment compatibility reference; the last-copy scenario has a crafted pool. Not original-client evidence.',
    scenarios: [
      scenario('seed-4-first-credit', first, 4, firstOffers.map(kind => ({ type: 'hire', owner: 'you', kind }))),
      scenario('seed-0-after-lieutenant', second.archive, 22, [{ type: 'promote', owner: 'you', id: unit.id }, ...secondOffers.map(kind => ({ type: 'hire', owner: 'you', kind }) as const)]),
      scenario('synthetic-last-copy-other', boundary, 22, [
        { type: 'hire', owner: 'you', kind: 'tinkerer' },
        { type: 'hire', owner: 'you', kind: 'assassin' },
        { type: 'promote', owner: 'you', id: unit.id },
        { type: 'schedule-action', owner: 'you', plan: { id: 'legacy-last-copy-hire', executeAt: 23, action: { type: 'hire', kind: 'tinkerer' } } },
      ], [22.5, 23, 24]),
    ],
  };
  const serialized = JSON.stringify(fixture) + '\n';
  await writeFile(output, serialized);
  console.log(JSON.stringify({ sourceCommit, scenarios: fixture.scenarios.length, branches: fixture.scenarios.reduce((n, s) => n + s.branches.length, 0), bytes: serialized.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
