/** Own process output and completion before a caller performs asynchronous bookkeeping. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

export function startLoggedCommand(command: string[], options: { cwd: string; stdout: string; stderr: string; env?: NodeJS.ProcessEnv }) {
  const [executable, ...args] = command;
  assert.ok(executable, 'Provide an executable.');
  const descriptors: number[] = [];
  try {
    descriptors.push(openSync(options.stdout, 'w'));
    descriptors.push(openSync(options.stderr, 'w'));
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', descriptors[0]!, descriptors[1]!] });
    const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>(done => {
      child.once('error', error => done({ code: null, signal: null, error }));
      child.once('close', (code, signal) => done({ code, signal }));
    });
    return { child, completed };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
  }
}
