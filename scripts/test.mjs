import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// The production bundle suite has a build prerequisite and runs in test:server-build.
const bundleTest = join('scripts', 'build-server.test.mjs');
async function discover(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : discover(path);
    return entry.isFile() && /\.test\.(?:[cm]?js|tsx?)$/.test(entry.name) && path !== bundleTest ? [path] : [];
  }));
  return files.flat();
}

const files = (await Promise.all(['src', 'server', 'plugins', 'scripts'].map(discover))).flat().sort();
const args = process.argv.slice(2);
const deadline = args.find(arg => arg.startsWith('--suite-timeout='));
const timeout = deadline ? Number(deadline.slice('--suite-timeout='.length)) : 600_000;
if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) throw new Error('Suite timeout must be a positive integer in milliseconds, at most 2147483647.');
if (!files.length) {
  console.error('No tests found in src, server, plugins, or scripts.');
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [
    '--import', import.meta.resolve('tsx'), '--test', '--test-concurrency=4', '--test-timeout=120000',
    ...args.filter(arg => !arg.startsWith('--suite-timeout=')), ...files,
  ], { stdio: 'inherit', detached: process.platform !== 'win32' });
  function terminate(signal) {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`Test suite exceeded ${timeout} ms; terminating test processes.`);
    terminate('SIGKILL');
  }, timeout);
  timer.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => terminate(signal));
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    process.exitCode = timedOut ? 1 : code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
}
