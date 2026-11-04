/** Native playback behind the small interface used by effects and music. */
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

export type PlaybackPlayer = Pick<AudioPlayer, 'volume' | 'loop' | 'play' | 'seekTo' | 'remove'>;

export function createPlaybackPlayer(source: number): PlaybackPlayer {
  return createAudioPlayer(source);
}
