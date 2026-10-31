/** @format */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrappers = 'src/game/configuration-invariants';
const helper = 'scripts/test-support/configuration-invariants.ts';
const execute = promisify(execFile);

test('default discovery registers every original configuration and seed exactly once', async (t) => {
  const expectedNames = [];
  const expectedTuples = [];
  const expectedFiles = [];
  for (const playerCount of [2, 6, 10])
    for (const mode of ['mining', 'domination'])
      for (const driftingBases of [false, true]) {
        expectedFiles.push(
          `${playerCount}-seat-${mode}-${driftingBases ? 'drifting' : 'fixed'}.test.ts`,
        );
        for (const rivals of [false, true]) {
          expectedNames.push(
            `${playerCount}-seat ${mode}, drift=${driftingBases}, rivals=${rivals}: catch-up, saved polling, and replay agree`,
          );
          for (const seed of [0, 73, 4294967295])
            expectedTuples.push(JSON.stringify([playerCount, mode, driftingBases, rivals, seed]));
        }
      }
  assert.deepEqual((await readdir(join(root, wrappers))).sort(), expectedFiles.sort());
  await assert.rejects(access(join(root, 'src/game/configuration-invariants.test.ts')), {
    code: 'ENOENT',
  });

  const source = await readFile(join(root, helper), 'utf8');
  const parsed = ts.createSourceFile(helper, source, ts.ScriptTarget.Latest, true);
  const registration = parsed.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'registerConfigurationInvariants',
  );
  assert.equal(registration.length, 1);

  const cwd = await mkdtemp(join(tmpdir(), 'machination-configuration-inventory-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const name of expectedFiles) {
    const path = join(wrappers, name);
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), await readFile(join(root, path)));
  }
  await mkdir(dirname(join(cwd, helper)), { recursive: true });
  // Use the real registration and wrappers, replacing only the costly scenario body.
  await writeFile(
    join(cwd, helper),
    `import { test } from 'node:test';
type GameOptions = { playerCount: number; mode: string; driftingBases: boolean };
function exercise(options: GameOptions, seed: number, rivals: boolean) {
  console.log('MATRIX_CASE ' + JSON.stringify([options.playerCount, options.mode, options.driftingBases, rivals, seed]));
}
${registration[0].getText(parsed)}
`,
  );
  const env = { ...process.env, NODE_OPTIONS: '' };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await execute(
    process.execPath,
    [
      join(root, 'scripts/test.mjs'),
      '--test-reporter=tap',
      '--test-concurrency=1',
      '--suite-timeout=15000',
    ],
    { cwd, env, timeout: 20000, maxBuffer: 1024 * 1024 },
  );
  const names = [...stdout.matchAll(/^ok \d+ - (.+)$/gm)].map((match) => match[1]);
  const tuples = [...stdout.matchAll(/^# MATRIX_CASE (\[.+\])$/gm)].map((match) => match[1]);
  assert.deepEqual(names.sort(), expectedNames.sort());
  assert.deepEqual(tuples.sort(), expectedTuples.sort());
  assert.match(stdout, /# tests 24\b/);
  assert.match(stdout, /# pass 24\b/);
  assert.match(stdout, /# fail 0\b/);
  assert.match(stdout, /# cancelled 0\b/);
  assert.match(stdout, /# skipped 0\b/);
});
