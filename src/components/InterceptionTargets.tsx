/**
 * ---
 * purpose: Show reachable observed haulers and immediate interceptor launch controls.
 * ---
 */
import { allied, type TeamWorld } from '../game/teams';
import { gameClock } from '../game/time-machine';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FACTIONS, type Faction, type Fleet, type Rock } from '../game/simulation';
import { flightDestination, interceptionCourse, type FlightWorld } from '../game/flight';
type Props = { game: FlightWorld & TeamWorld & { version?: 1 | 2; fleets: Fleet[]; rocks: (FlightWorld['rocks'][number] & { name: string })[] }; source: Rock; owner: Faction; drones: number; specialists?: string[]; disabled: boolean; scheduledAt?: number; targetIds?: readonly number[]; onIntercept: (target: number) => void };
export function InterceptionTargets({ game, source, owner, drones, specialists, disabled, scheduledAt, targetIds, onIntercept }: Props) {
  const modern = game.version === 2;
  const rig = source.specialists?.find(u => u.kind === 'pirate' && u.owner === owner && !u.captive);
  if (modern ? !rig : source.module !== 'scavenger') return null;
  const selected = specialists?.length ? specialists : rig ? [rig.id] : [];
  const includesRig = !modern || !!source.specialists?.some(u => u.kind === 'pirate' && u.owner === owner && !u.captive && selected.includes(u.id));
  const targets = game.fleets.filter(f => !allied(game, owner, f.owner) && !f.preparing && (targetIds === undefined || targetIds.includes(f.id)));
  const validManifest = Number.isSafeInteger(drones) && drones >= (modern ? 0 : 1) && includesRig && drones <= Math.floor(source.drones);
  return <View style={s.panel}><Text style={s.title}>Interceptor targets</Text><Text style={s.detail}>{modern ? 'Prepares for ten minutes with an interceptor and the manifest above. Surviving interceptors return to the nearest friendly site at quadruple speed.' : "Uses this site's interceptor and the drone manifest above. Launches immediately; surviving interceptors return here after combat."}</Text>
    {scheduledAt !== undefined && <Text style={s.detail}>Only currently observed targets can be scheduled. The target must still exist and be reachable at execution.</Text>}
    {targets.length ? targets.map(target => {
      const course = interceptionCourse(game, source, target, modern ? 16 : 8, game.hour + (modern ? 1 / 6 : 0));
      const blocked = disabled || scheduledAt !== undefined && !modern || !!source.destroyed || !validManifest || !course;
      return <View key={target.id} style={s.target}><Text style={s.text}>{FACTIONS[target.owner].name} · {target.drones} drones</Text><Text style={s.detail}>{flightDestination(game.rocks, target)}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Intercept ${FACTIONS[target.owner].name} hauler`} accessibilityState={{ disabled: blocked }} disabled={blocked} onPress={() => onIntercept(target.id)} style={[s.button, blocked && { opacity: 0.35 }]}><Text style={s.buttonText}>{course ? `${scheduledAt === undefined ? 'Intercept now' : `Schedule at ${gameClock(scheduledAt)}`} · ETA ${(course.arrives - game.hour).toFixed(2)}h` : 'Out of reach on this leg'}</Text></Pressable></View>;
    }) : <Text style={s.detail}>No observed enemy haulers.</Text>}
  </View>;
}
const s = StyleSheet.create({ panel: { gap: 10, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderColor: '#30402e' }, title: { color: '#b8e986', fontSize: 12 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, text: { color: '#d6e2cd', fontSize: 12 }, target: { gap: 7, paddingVertical: 10 }, button: { minHeight: 44, padding: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#b8e986' }, buttonText: { color: '#182312', fontSize: 11, fontWeight: '600' } });
