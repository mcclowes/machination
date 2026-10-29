/** Review voluntary support separately from an ordinary transfer or attack. */
import { gameClock } from '../game/time-machine';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FACTIONS, type Faction, type Rock } from '../game/simulation';
import type { Specialist } from '../game/specialists';
import { SPECIALISTS } from '../game/specialist-catalog';
import { MODULES } from '../game/modules';
export function GiftTransfer({ from, to, recipient, drones, carry, disabled, onGift, scheduledAt, legacy = false, specialists = [] }: {
  specialists?: Specialist[]; scheduledAt?: number; legacy?: boolean; from: Rock; to: Pick<Rock, 'id' | 'name' | 'destroyed'>; recipient: Faction; drones: number; carry: boolean; disabled: boolean; onGift: () => void;
}) {
  const [review, setReview] = useState(false);
  const blocked = disabled || scheduledAt !== undefined && legacy || !!from.destroyed || !!to.destroyed;
  const payload = `${drones} drones${carry && from.module ? ` and ${MODULES[from.module].name}` : ''}${specialists.length ? ` and ${specialists.map(u => SPECIALISTS[u.kind].name).join(', ')}` : ''}`;
  const button = (text: string, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked }} disabled={blocked} onPress={onPress} style={[s.button, blocked && { opacity: 0.35 }]}><Text style={s.buttonText}>{text}</Text></Pressable>;
  return <View style={s.panel}>
    {scheduledAt !== undefined && <Text style={s.detail}>Schedule for {gameClock(scheduledAt)}. The full manifest and recipient must remain eligible at execution; otherwise the private order aborts.</Text>}
    <Text style={s.title}>Optional gift / {FACTIONS[recipient].name}</Text>
    {review ? <>
      <Text style={s.detail}>Give {payload} from {from.name} to {FACTIONS[recipient].name}, bound for {to.name}?</Text>
      <Text style={s.detail}>{legacy ? 'Ownership and hauler sensors transfer at launch. You cannot recall this gift. It reinforces the recipient, or fights for them if the destination changes hands.' : 'The manifest prepares for ten minutes. It stays yours until contact, then transfers to the current owner of the destination or a passing hauler. Cancel the launch or gift order during preparation.'}</Text>
      {button(scheduledAt === undefined ? legacy ? 'Confirm gift and launch now' : 'Confirm gift and prepare launch' : `Schedule gift at ${gameClock(scheduledAt)}`, () => { setReview(false); onGift(); })}
      <Pressable accessibilityRole="button" onPress={() => setReview(false)} style={s.button}><Text style={s.buttonText}>Keep drones</Text></Pressable>
    </> : <>
      <Text style={s.detail}>Use the bottom launch button to attack. Review a gift only if you want to give these units away.</Text>
      <Text style={s.detail}>{legacy ? "Give this manifest and any loaded module to the destination's intelligence. Gifts launch immediately." : 'Give this manifest and any loaded module on contact. A passing hauler can accept it before the destination.'}</Text>
      {button('Review gift instead of attack', () => setReview(true))}
    </>}
  </View>;
}
const s = StyleSheet.create({
  panel: { padding: 14, gap: 12, borderWidth: 1, borderColor: '#7c6842' }, title: { color: '#e9a775', fontSize: 15 }, detail: { color: '#b6bca9', fontSize: 13, lineHeight: 21 },
  button: { padding: 14, minHeight: 44, alignItems: 'center', backgroundColor: '#e9a775' }, buttonText: { color: '#182312', fontSize: 12, fontWeight: '600' },
});
