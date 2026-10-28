/**
 * ---
 * purpose: Show reachable observed haulers and immediate scavenger launch controls.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FACTIONS, type Faction, type Fleet, type Rock } from '../game/simulation';
import { flightDestination, interceptionCourse, type FlightWorld } from '../game/flight';
type Props = { game: FlightWorld & { fleets: Fleet[]; rocks: (FlightWorld['rocks'][number] & { name: string })[] }; source: Rock; owner: Faction; drones: number; disabled: boolean; onIntercept: (target: number) => void };
export function InterceptionTargets({ game, source, owner, drones, disabled, onIntercept }: Props) {
  if (source.module !== 'scavenger') return null;
  const targets = game.fleets.filter(f => f.owner !== owner);
  const validManifest = Number.isSafeInteger(drones) && drones > 0 && drones <= Math.floor(source.drones);
  return <View style={s.panel}><Text style={s.title}>Scavenger interception</Text><Text style={s.detail}>Uses this rock's rig and the drone manifest above. Launches immediately; surviving rigs return here after combat.</Text>
    {targets.length ? targets.map(target => {
      const course = interceptionCourse(game, source, target);
      const blocked = disabled || !validManifest || !course;
      return <View key={target.id} style={s.target}><Text style={s.text}>{FACTIONS[target.owner].name} · {target.drones} drones</Text><Text style={s.detail}>{flightDestination(game.rocks, target)}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Intercept ${FACTIONS[target.owner].name} hauler`} accessibilityState={{ disabled: blocked }} disabled={blocked} onPress={() => onIntercept(target.id)} style={[s.button, blocked && { opacity: 0.35 }]}><Text style={s.buttonText}>{course ? `Intercept now · ETA ${(course.arrives - game.hour).toFixed(2)}h` : 'Out of reach on this leg'}</Text></Pressable></View>;
    }) : <Text style={s.detail}>No observed enemy haulers.</Text>}
  </View>;
}
const s = StyleSheet.create({ panel: { gap: 10, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderColor: '#30402e' }, title: { color: '#b8e986', fontSize: 12 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, text: { color: '#d6e2cd', fontSize: 12 }, target: { gap: 7, paddingVertical: 10 }, button: { minHeight: 44, padding: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#b8e986' }, buttonText: { color: '#182312', fontSize: 11, fontWeight: '600' } });
