/** Illustrated telemetry shared by solo and online operations. */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { GameView } from '../game/visibility';
import { gameClock } from '../game/time-machine';
import { FACTIONS, playersIn } from '../game/players';
import { ARTWORK, ARTWORK_SOURCES, type ArtworkId } from './artwork-catalog';
import { eventMessage } from './event-message';
import { PlayerIdentity } from './PlayerIdentity';

type SignalView = Pick<GameView, 'hour' | 'winner' | 'eliminated' | 'rules' | 'events'>;

export function signalArtwork(message: string): ArtworkId {
  if (/\b(unknown|unobserved)\b/i.test(message)) return 'cloaked-ship';
  if (/\b(detonation|self-destruct|meltdown|core destroyed|cores lost)\b/i.test(message)) return 'exploding-planet';
  if (/\b(bombardment|sentry|watchdog)\b/i.test(message)) return 'bombardment';
  if (/\b(fought|captured|acquired|neutralized|defending force|combat|assimilated)\b/i.test(message)) return 'techno-gothic-duel';
  if (/\b(planned|scheduled|course change)\b/i.test(message)) return 'time-ship';
  if (/\b(recruited|promoted|captive|released)\b/i.test(message)) return 'ritual-tech-clash';
  if (/\b(mine|mining|extraction|cargo|quota)\b/i.test(message)) return 'mining-world';
  if (/\b(constructed|shields|production)\b/i.test(message)) return 'industrial-cockpit';
  if (/\b(drones|hauler|haulers|transfer|interception|gift|scavenger|interceptor)\b/i.test(message)) return 'mining-drones';
  return 'command-bridge';
}

export function signalPlayers(view: Pick<GameView, 'rules'>, message: string) {
  return playersIn(view).filter(faction => {
    const name = new RegExp(`\\b${FACTIONS[faction].name}\\b`, 'i');
    // Older signals sometimes use the seat ID for funding and elimination.
    const seat = new RegExp(`^${faction}:|^${faction} (?:began funding|withdrew funding from) | (?:began funding|withdrew funding from) ${faction}\\.`, 'i');
    return name.test(message) || seat.test(message);
  });
}

export function SignalLog({ view, limit = 50 }: { view: SignalView; limit?: number }) {
  return <View style={s.list}>{view.events.slice(0, limit).map((event, index) => {
    const message = eventMessage(view, event);
    const artwork = signalArtwork(message);
    const players = signalPlayers(view, message);
    return <View key={index} style={s.signal}>
      <Image source={ARTWORK_SOURCES[artwork]} accessibilityLabel={ARTWORK.find(image => image.id === artwork)!.title} resizeMode="cover" style={s.scene} />
      <View style={s.copy}><Text style={s.time}>{gameClock(event.hour)}</Text><Text style={s.text}>{message}</Text>
        {players.length > 0 && <View style={s.players}>{players.map(faction => <PlayerIdentity key={faction} faction={faction} size={30} />)}</View>}
      </View>
    </View>;
  })}</View>;
}

const s = StyleSheet.create({
  list: { gap: 12 }, signal: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#30454c' },
  scene: { width: 80, height: 64, borderRadius: 3, backgroundColor: '#101b21', flexShrink: 0 }, copy: { flex: 1, minWidth: 0, gap: 8 },
  players: { gap: 10, paddingBottom: 3 },
  time: { color: '#8c9f85', fontSize: 10 }, text: { color: '#d6e2cd', fontSize: 12, lineHeight: 19 },
});
