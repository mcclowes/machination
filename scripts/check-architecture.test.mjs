import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkArchitecture } from './check-architecture.mjs';

test('architecture check accepts shared domain code and rejects platform and client dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'machination-boundaries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function source(file, code) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, code);
  }
  await source('src/game/model.ts', 'export type Game = {hour:number};');
  await source('src/contracts/view.ts', "import type { Game } from '../game/model';");
  await source('server/api.ts', "import type { Game } from '../src/game/model'; import { readFile } from 'node:fs/promises';");
  assert.deepEqual(await checkArchitecture(root), []);
  await source('src/game/persistence.ts', "import storage from '@react-native-async-storage/async-storage';");
  await source('src/contracts/bad.ts', "import { View } from 'react-native';");
  await source('server/notification.ts', "import { useDevice } from '../src/online/device';");
  const failures = await checkArchitecture(root);
  assert.equal(failures.length, 3);
  assert.ok(failures.some(failure => failure.includes('src/game/persistence.ts')));
  assert.ok(failures.some(failure => failure.includes('src/contracts/bad.ts')));
  assert.ok(failures.some(failure => failure.includes('server/notification.ts')));
});
