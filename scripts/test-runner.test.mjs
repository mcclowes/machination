import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./test.mjs', import.meta.url));
const execute = promisify(execFile);

async function fixture(t, files) {
  const cwd = await mkdtemp(join(tmpdir(), 'machination-test-runner-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(cwd, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  const env = { ...process.env, NODE_OPTIONS: '' };
  delete env.NODE_TEST_CONTEXT;
  return (...args) => execute(process.execPath, [runner, '--test-reporter=tap', ...args], {
    cwd, timeout: 15_000, env,
  });
}

test('default discovery runs nested TypeScript, TSX, plugin, and script tests, including paths with spaces', async t => {
  const run = await fixture(t, {
    'src/new feature/deep/nested.test.ts': "import { test } from 'node:test'; const name: string = 'nested TypeScript'; test(name, () => {});",
    'src/new feature/view.test.tsx': "/** @jsx h */ import { test } from 'node:test'; const h = (type: string) => ({ type }); test('nested TSX', () => { const view = <div />; if (view.type !== 'div') throw Error('JSX failed'); });",
    'server/deep/server.test.ts': "import { test } from 'node:test'; test('nested server', () => {});",
    'plugins/deep/plugin.test.cjs': "require('node:test')('nested plugin', () => {});",
    'scripts/deep/script.test.mjs': "import { test } from 'node:test'; test('nested script', () => {});",
    'scripts/build-server.test.mjs': "throw Error('Production bundle tests need their separate build prerequisite');",
    'src/helper.ts': "throw Error('Non-test helper must not run');",
    'node_modules/dependency.test.js': "throw Error('Dependency tests must not run');",
    'src/node_modules/nested-dependency.test.js': "throw Error('Nested dependency tests must not run');",
    'src/.scratch/experiment.test.js': "throw Error('Hidden scratch tests must not run');",
    'dist/bundle.test.js': "throw Error('Build output must not run');",
  });
  const { stdout } = await run();
  for (const name of ['nested TypeScript', 'nested TSX', 'nested server', 'nested plugin', 'nested script']) assert.match(stdout, new RegExp(`ok \\d+ - ${name}`));
  assert.match(stdout, /# tests 5\b/);
});

test('a failing assertion makes the command fail and retains its diagnostic', async t => {
  const run = await fixture(t, {
    'src/failure.test.ts': "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('failure sentinel', () => assert.equal(1, 2));",
  });
  await assert.rejects(run(), error => {
    assert.equal(error.code, 1);
    assert.equal(error.killed, false);
    assert.match(error.stdout, /not ok 1 - failure sentinel/);
    assert.match(error.stdout, /ERR_ASSERTION/);
    return true;
  });
});

test('an empty suite fails instead of reporting a misleading green check', async t => {
  const run = await fixture(t, { 'src/helper.ts': 'export const helper = true;' });
  await assert.rejects(run(), error => error.code === 1 && /No tests found/.test(error.stderr));
});

test('a synchronous infinite loop is terminated by the suite deadline and fails the command', async t => {
  const run = await fixture(t, {
    'src/hang.test.ts': "import { test } from 'node:test'; test('hang sentinel', () => { console.log('Entered synchronous loop'); while (true) {} });",
  });
  await assert.rejects(run('--suite-timeout=3000'), error => {
    assert.equal(error.code, 1);
    assert.equal(error.killed, false, 'The runner must enforce its deadline before the fixture safety deadline');
    assert.match(error.stdout, /Entered synchronous loop/);
    assert.match(error.stderr, /Test suite exceeded 3000 ms/);
    return true;
  });
});
