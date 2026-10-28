import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ResignationControl({ enabled, onConfirm }: { enabled: boolean; onConfirm: () => void }) {
  const [review, setReview] = useState(false);
  const button = (text: string, onPress: () => void, disabled = !enabled) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.buttonText}>{text}</Text></Pressable>;
  return <View style={s.panel}>{review ? <>
    <Text style={s.detail}>Resignation is irreversible. You lose all cargo, cargo mining stops, funding ends, and queued orders and unlaunched preparations are canceled. You cannot issue further orders.</Text>
    <Text style={s.detail}>You keep your assets, launched haulers, drone production, shields, sensors, and chat.</Text>
    {button('Keep operation', () => setReview(false), false)}
    {button('Confirm resignation', () => { if (enabled) { setReview(false); onConfirm(); } })}
  </> : button('Resign…', () => setReview(true))}</View>;
}
const s = StyleSheet.create({
  panel: { gap: 12 }, detail: { color: '#b6bca9', fontSize: 13, lineHeight: 21 },
  button: { padding: 14, minHeight: 44, alignItems: 'center', backgroundColor: '#e9a775' }, buttonText: { color: '#182312', fontSize: 12, fontWeight: '600' },
});
