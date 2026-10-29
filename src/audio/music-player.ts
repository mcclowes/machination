/**
 * ---
 * purpose: Own looping music players and bounded crossfades, releasing audio when the operation is silent.
 * ---
 */
import type { MusicTension } from './music-tension';

type Player = { volume: number; loop: boolean; play(): void; remove(): void };
export const MUSIC_VOLUME = 0.24;
export const CROSSFADE_MS = 2000;
const STEP_MS = 50;

export class MusicPlayback {
  private players = new Map<MusicTension, Player>();
  private selected: MusicTension | null = null;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private create: (track: MusicTension) => Player) {}

  select(track: MusicTension | null) {
    if (!track) { this.dispose(); return; }
    if (track === this.selected) return;
    this.cancelFade();
    // Finish retiring an older fade before introducing a third player.
    for (const [key, player] of this.players) if (key !== this.selected && key !== track) this.release(key, player);
    try {
      let player = this.players.get(track);
      if (!player) {
        player = this.create(track);
        this.players.set(track, player);
        player.loop = true; player.volume = 0; player.play();
      }
      this.selected = track;
      const initial = new Map([...this.players].map(([key, value]) => [key, value.volume]));
      let elapsed = 0;
      this.timer = setInterval(() => {
        try {
          elapsed += STEP_MS;
          const progress = Math.min(1, elapsed / CROSSFADE_MS);
          for (const [key, value] of this.players) {
            const from = initial.get(key) ?? 0;
            value.volume = from + ((key === track ? MUSIC_VOLUME : 0) - from) * progress;
            if (progress === 1 && key !== track) this.release(key, value);
          }
          if (progress === 1) this.cancelFade();
        } catch { this.dispose(); }
      }, STEP_MS);
    } catch { this.dispose(); }
  }

  dispose() {
    this.cancelFade();
    for (const [key, player] of this.players) this.release(key, player);
    this.selected = null;
  }

  private cancelFade() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private release(track: MusicTension, player: Player) {
    this.players.delete(track);
    try { player.remove(); } catch { /* Playback never blocks the operation. */ }
  }
}
