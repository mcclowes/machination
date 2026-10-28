/**
 * ---
 * purpose: Show reachable observed haulers and immediate scavenger launch controls.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FACTIONS, type Faction, type Fleet, type Rock } from '../game/simulation';
import { flightDestination, interceptionCourse, type FlightWorld } from '../game/flight';
type Props = { game: FlightWorld & { version?: 1 | 2; fleets: Fleet[]; rocks: (FlightWorld['rocks'][number] & { name: string })[] }; source: Rock; owner: Faction; drones: number; specialists?: string[]; disabled: boolean; onIntercept: (target: number) => void };
export function InterceptionTargets({ game, source, owner, drones, specialists, disabled, onIntercept }: Props) {
  const modern = game.version === 2;
  const rig = source.specialists?.find(u => u.kind === 'pirate' && u.owner === owner && !u.captive);
  if (modern ? !rig : source.module !== 'scavenger') return null;
  const selected = specialists?.length ? specialists : rig ? [rig.id] : [];
  const includesRig = !modern || !!source.specialists?.some(u => u.kind === 'pirate' && u.owner === owner && !u.captive && selected.includes(u.id));
  const targets = game.fleets.filter(f => f.owner !== owner && !f.preparing);
  const validManifest = Number.isSafeInteger(drones) && drones >= (modern ? 0 : 1) && includesRig && drones <= Math.floor(source.drones);
  return <View style={s.panel}><Text style={s.title}>Scavenger interception</Text><Text style={s.detail}>{modern ? 'Prepares for ten minutes with a scavenger rig and the manifest above. Surviving rigs return to the nearest friendly site at quadruple speed.' : "Uses this rock's rig and the drone manifest above. Launches immediately; surviving rigs return here after combat."}</Text>
    {targets.length ? targets.map(target => {
      const course = interceptionCourse(game, source, target, modern ? 16 : 8, game.hour + (modern ? 1 / 6 : 0));
      const blocked = disabled || !validManifest || !course;
      return <View key={target.id} style={s.target}><Text style={s.text}>{FACTIONS[target.owner].name} · {target.drones} drones</Text><Text style={s.detail}>{flightDestination(game.rocks, target)}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Intercept ${FACTIONS[target.owner].name} hauler`} accessibilityState={{ disabled: blocked }} disabled={blocked} onPress={() => onIntercept(target.id)} style={[s.button, blocked && { opacity: 0.35 }]}><Text style={s.buttonText}>{course ? `Intercept now · ETA ${(course.arrives - game.hour).toFixed(2)}h` : 'Out of reach on this leg'}</Text></Pressable></View>;
    }) : <Text style={s.detail}>No observed enemy haulers.</Text>}
  </View>;
}
const s = StyleSheet.create({ panel: { gap: 10, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderColor: '#30402e' }, title: { color: '#b8e986', fontSize: 12 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, text: { color: '#d6e2cd', fontSize: 12 }, target: { gap: 7, paddingVertical: 10 }, button: { minHeight: 44, padding: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#b8e986' }, buttonText: { color: '#182312', fontSize: 11, fontWeight: '600' } });
