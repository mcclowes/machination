/**
 * ---
 * purpose: Play live-operation music and sound cues with a shared mute preference and foreground lifecycle.
 * ---
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import type { Faction } from '../game/players';
import { cueForUpdate, type CueView, type SoundCue } from './sound-cues';
import { musicTension, type MusicView, type MusicTension } from './music-tension';
import { MusicPlayback } from './music-player';

const MUSIC: Record<MusicTension, number> = {
  calm: require('../../assets/music/space-ambient.mp3'),
  moderate: require('../../assets/music/interstellar-space.mp3'),
  tense: require('../../assets/music/rising-dread.mp3'),
};

const PREFERENCE = 'machination.sound.v1';
const SOURCES: Record<SoundCue, number> = {
  tap: require('../../assets/sounds/tap.wav'),
  launch: require('../../assets/sounds/launch.wav'),
  schedule: require('../../assets/sounds/schedule.wav'),
  signal: require('../../assets/sounds/signal.wav'),
  combat: require('../../assets/sounds/combat.wav'),
  capture: require('../../assets/sounds/capture.wav'),
  loss: require('../../assets/sounds/loss.wav'),
  alarm: require('../../assets/sounds/alarm.wav'),
  victory: require('../../assets/sounds/victory.wav'),
  defeat: require('../../assets/sounds/defeat.wav'),
  error: require('../../assets/sounds/error.wav'),
};

let enabled = true;
const listeners = new Set<() => void>();
const players = new Map<SoundCue, AudioPlayer>();
void AsyncStorage.getItem(PREFERENCE).then(value => { if (value === 'off') setSoundEnabled(false); }).catch(() => undefined);

export function setSoundEnabled(next: boolean) {
  enabled = next;
  listeners.forEach(listener => listener());
  void AsyncStorage.setItem(PREFERENCE, next ? 'on' : 'off').catch(() => undefined);
}
export function useSoundEnabled() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => enabled);
}

export function playSound(cue: SoundCue | null) {
  if (!cue || !enabled) return;
  try {
    let player = players.get(cue);
    if (!player) players.set(cue, player = createAudioPlayer(SOURCES[cue]));
    void player.seekTo(0).catch(() => undefined);
    player.play();
  } catch { /* Sound is decorative; playback failures never interrupt the operation. */ }
}

export function useSoundCues(view: (CueView & MusicView) | undefined, player: Faction | undefined) {
  useMusic(view, player);
  const previous = useRef<CueView>(undefined);
  useEffect(() => {
    if (view && player) playSound(cueForUpdate(previous.current, view, player));
    previous.current = view;
  }, [view, player]);
}

function useMusic(view: MusicView | undefined, player: Faction | undefined) {
  const enabled = useSoundEnabled();
  const tension = enabled ? musicTension(view, player) : null;
  const desired = useRef(tension);
  desired.current = tension;
  const playback = useRef<MusicPlayback | null>(null);
  const active = !!view && !!player;
  useEffect(() => {
    if (!active) return;
    const music = new MusicPlayback(track => createAudioPlayer(MUSIC[track]));
    playback.current = music;
    const refresh = () => music.select(AppState.currentState === 'active' ? desired.current : null);
    refresh();
    const subscription = AppState.addEventListener('change', state => music.select(state === 'active' ? desired.current : null));
    return () => { subscription.remove(); music.dispose(); playback.current = null; };
  }, [active]);
  useEffect(() => {
    playback.current?.select(AppState.currentState === 'active' ? tension : null);
  }, [tension]);
}
