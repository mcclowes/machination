/** Review voluntary support separately from an ordinary transfer or attack. */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FACTIONS, type Faction, type Rock } from '../game/simulation';
import { MODULES } from '../game/modules';
export function GiftTransfer({ from, to, recipient, drones, carry, disabled, onGift }: {
  from: Rock; to: Rock; recipient: Faction; drones: number; carry: boolean; disabled: boolean; onGift: () => void;
}) {
  const [review, setReview] = useState(false);
  const payload = `${drones} drones${carry && from.module ? ` and ${MODULES[from.module].name}` : ''}`;
  const button = (text: string, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.buttonText}>{text}</Text></Pressable>;
  return <View style={s.panel}>
    <Text style={s.title}>Voluntary support / {FACTIONS[recipient].name}</Text>
    {review ? <>
      <Text style={s.detail}>Give {payload} from {from.name} to {FACTIONS[recipient].name}, bound for {to.name}?</Text>
      <Text style={s.detail}>Ownership and hauler sensors transfer at launch. You cannot recall this gift. It reinforces the recipient, or fights for them if the destination changes hands.</Text>
      {button('Confirm gift and launch now', () => { setReview(false); onGift(); })}
      <Pressable accessibilityRole="button" onPress={() => setReview(false)} style={s.button}><Text style={s.buttonText}>Keep drones</Text></Pressable>
    </> : <>
      <Text style={s.detail}>Give this manifest and any loaded module to the destination's intelligence. Gifts launch immediately.</Text>
      {button('Review gift instead of attack', () => setReview(true))}
    </>}
  </View>;
}
const s = StyleSheet.create({
  panel: { padding: 14, gap: 12, borderWidth: 1, borderColor: '#7c6842' }, title: { color: '#e9a775', fontSize: 15 }, detail: { color: '#b6bca9', fontSize: 13, lineHeight: 21 },
  button: { padding: 14, minHeight: 44, alignItems: 'center', backgroundColor: '#e9a775' }, buttonText: { color: '#182312', fontSize: 12, fontWeight: '600' },
});
