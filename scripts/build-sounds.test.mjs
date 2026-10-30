import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const recorded = ['launch', 'signal', 'combat', 'capture', 'loss'];

test('sound rebuild retains the recorded cues and produces a complete PCM bank', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'machination-sounds-'));
  try {
    mkdirSync(join(scratch, 'scripts'));
    cpSync(join(root, 'scripts/build-sounds.mjs'), join(scratch, 'scripts/build-sounds.mjs'));
    mkdirSync(join(scratch, 'assets/sounds'), { recursive: true });
    for (const cue of recorded) {
      cpSync(join(root, `assets/sounds/${cue}.wav`), join(scratch, `assets/sounds/${cue}.wav`));
    }
    const result = spawnSync(process.execPath, [join(scratch, 'scripts/build-sounds.mjs')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const cue of recorded) {
      assert.ok(readFileSync(join(scratch, `assets/sounds/${cue}.wav`)).equals(
        readFileSync(join(root, `assets/sounds/${cue}.wav`))), `${cue} recording must survive rebuilds`);
    }
    const files = readdirSync(join(scratch, 'assets/sounds')).filter(name => name.endsWith('.wav'));
    assert.equal(files.length, 11);
    for (const name of files) {
      const data = readFileSync(join(scratch, 'assets/sounds', name));
      assert.equal(data.toString('ascii', 0, 4), 'RIFF', name);
      assert.equal(data.toString('ascii', 8, 12), 'WAVE', name);
      assert.equal(data.toString('ascii', 12, 16), 'fmt ', name);
      assert.equal(data.readUInt16LE(20), 1, `${name}: PCM`);
      assert.equal(data.readUInt16LE(22), 1, `${name}: mono`);
      assert.equal(data.readUInt32LE(24), 22050, `${name}: sample rate`);
      assert.equal(data.readUInt16LE(34), 16, `${name}: sample depth`);
      assert.equal(data.toString('ascii', 36, 40), 'data', name);
      assert.equal(data.readUInt32LE(40), data.length - 44, `${name}: complete payload`);
      assert.ok(data.length > 44, `${name}: nonempty payload`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
