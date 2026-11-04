/** @format */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import type { PlaybackPlayer } from './audio-player';

class Media {
  volume = 1;
  loop = false;
  currentTime = 0;
  error: Error | null = null;
  plays = 0;
  loads = 0;
  pauses = 0;
  sourceRemoved = false;
  pending?: Promise<void>;
  onPause?: () => void;
  constructor(readonly uri: string) {}
  play() {
    this.plays++;
    return this.pending ?? (this.error ? Promise.reject(this.error) : Promise.resolve());
  }
  load() {
    this.loads++;
    this.error = null;
  }
  pause() {
    this.pauses++;
    this.onPause?.();
  }
  removeAttribute(name: string) {
    assert.equal(name, 'src');
    this.sourceRemoved = true;
  }
}

async function player() {
  const instances: Media[] = [];
  const output = await build({
    entryPoints: [fileURLToPath(new URL('./audio-player.web.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'asset-host',
        setup(builder) {
          builder.onResolve({ filter: /^expo-asset$/ }, () => ({
            path: 'asset',
            namespace: 'host',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({
            contents:
              'export const Asset = { fromModule: source => ({ uri: `fixture:${source}` }) };',
          }));
        },
      },
    ],
  });
  const module = { exports: {} as { createPlaybackPlayer(source: number): PlaybackPlayer } };
  class Audio extends Media {
    constructor(uri: string) {
      super(uri);
      instances.push(this);
    }
  }
  new Function('module', 'exports', 'Audio', output.outputFiles[0]!.text)(
    module,
    module.exports,
    Audio,
  );
  const playback = module.exports.createPlaybackPlayer(7);
  return { playback, media: instances[0]! };
}

test('browser playback resolves bundled assets and retains music and effect controls', async () => {
  const { playback, media } = await player();
  assert.equal(media.uri, 'fixture:7');
  playback.volume = 0.24;
  playback.loop = true;
  assert.equal(media.volume, 0.24);
  assert.equal(media.loop, true);
  await playback.seekTo(2);
  assert.equal(media.currentTime, 2);
  playback.play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(media.plays, 1);
  playback.remove();
});

test('a rejected browser play promise is contained and a failed source can retry', async () => {
  const { playback, media } = await player();
  media.pending = Promise.reject(new Error('No supported source'));
  playback.play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  media.pending = undefined;
  media.error = new Error('Offline source');
  playback.play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(media.loads, 1);
  assert.equal(media.plays, 2);
  assert.equal(media.error, null);
  playback.remove();
});

test('removal handles an in-flight play abort, releases the source once, and prevents reuse', async () => {
  const { playback, media } = await player();
  let abort!: (error: Error) => void;
  media.pending = new Promise<void>((_, reject) => {
    abort = reject;
  });
  media.onPause = () => abort(new Error('Playback aborted'));
  playback.play();
  playback.remove();
  playback.remove();
  playback.play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(media.plays, 1);
  assert.equal(media.pauses, 1);
  assert.equal(media.loads, 1);
  assert.equal(media.sourceRemoved, true);
  await playback.seekTo(10);
  assert.equal(media.currentTime, 0);
});
