/** Browser playback owns rejected media promises, including offline and autoplay failures. */
import { Asset } from 'expo-asset';
import type { PlaybackPlayer } from './audio-player';

export function createPlaybackPlayer(source: number): PlaybackPlayer {
  const asset = Asset.fromModule(source);
  const media = new Audio(asset.localUri ?? asset.uri);
  let removed = false;
  return {
    get volume() { return media.volume; },
    set volume(value) { media.volume = value; },
    get loop() { return media.loop; },
    set loop(value) { media.loop = value; },
    play() {
      if (removed) return;
      if (media.error) media.load();
      void media.play().catch(() => undefined);
    },
    async seekTo(seconds) {
      if (!removed) media.currentTime = seconds;
    },
    remove() {
      if (removed) return;
      removed = true;
      media.pause();
      media.removeAttribute('src');
      media.load();
    },
  };
}
