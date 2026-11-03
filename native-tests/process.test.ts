import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { startLoggedCommand } from './process';

async function files(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), 'machination-command-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return { cwd, stdout: join(cwd, 'stdout'), stderr: join(cwd, 'stderr') };
}

test('a fast command remains observable after the child has already closed', { timeout: 5000 }, async t => {
  const options = await files(t);
  const running = startLoggedCommand([process.execPath, '-e', 'process.stdout.write("record ready");'], options);
  await once(running.child, 'close');
  assert.deepEqual(await running.completed, { code: 0, signal: null });
  assert.equal(await readFile(options.stdout, 'utf8'), 'record ready');
});

test('command failures preserve their exit status and diagnostic output', { timeout: 5000 }, async t => {
  const options = await files(t);
  const running = startLoggedCommand([process.execPath, '-e', 'process.stderr.write("controlled failure"); process.exitCode = 7;'], options);
  assert.deepEqual(await running.completed, { code: 7, signal: null });
  assert.equal(await readFile(options.stderr, 'utf8'), 'controlled failure');
});

test('a missing executable settles as a launch error without an unhandled rejection', { timeout: 5000 }, async t => {
  const options = await files(t);
  const running = startLoggedCommand([join(options.cwd, 'does-not-exist')], options);
  const result = await running.completed;
  assert.equal((result.error as NodeJS.ErrnoException).code, 'ENOENT');
  assert.equal(result.code, null);
});
