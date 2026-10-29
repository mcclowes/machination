import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicPlayback, MUSIC_VOLUME, CROSSFADE_MS } from './music-player';
import type { MusicTension } from './music-tension';

test('loops quietly, crossfades, reuses steady tracks, and releases on silence', context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const created: { track: MusicTension; volume: number; loop: boolean; plays: number; removed: boolean; play(): void; remove(): void }[] = [];
  const playback = new MusicPlayback(track => {
    const player = { track, volume: 1, loop: false, plays: 0, removed: false, play() { this.plays++; }, remove() { this.removed = true; } };
    created.push(player); return player;
  });
  playback.select('calm');
  const calm = created[0]!;
  assert.equal(calm.loop, true); assert.equal(calm.plays, 1); assert.equal(calm.volume, 0);
  context.mock.timers.tick(CROSSFADE_MS);
  assert.equal(calm.volume, MUSIC_VOLUME);
  playback.select('calm');
  assert.equal(created.length, 1); assert.equal(calm.plays, 1);
  playback.select('moderate');
  context.mock.timers.tick(CROSSFADE_MS / 2);
  const moderate = created[1]!;
  assert.ok(calm.volume > 0 && calm.volume < MUSIC_VOLUME);
  assert.ok(moderate.volume > 0 && moderate.volume < MUSIC_VOLUME);
  playback.select('tense');
  assert.equal(created.filter(p => !p.removed).length, 2, 'rapid changes retain at most two players');
  context.mock.timers.tick(CROSSFADE_MS);
  assert.equal(calm.removed, true); assert.equal(moderate.removed, true);
  assert.equal(created[2]!.volume, MUSIC_VOLUME);
  playback.select(null);
  assert.ok(created.every(p => p.removed));
  context.mock.timers.tick(CROSSFADE_MS * 2);
  playback.select('tense');
  assert.equal(created.length, 4, 'unmuting or returning to foreground starts music again');
  playback.dispose();
  assert.ok(created.every(p => p.removed));
});

test('failed audio never escapes into gameplay and can retry', () => {
  let attempts = 0;
  const playback = new MusicPlayback(() => { attempts++; throw new Error('No audio device'); });
  assert.doesNotThrow(() => { playback.select('calm'); playback.select('calm'); playback.dispose(); });
  assert.equal(attempts, 2);
});
