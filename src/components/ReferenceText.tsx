import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ObjectReference } from '../online/protocol';
import { splitObjectReferences } from '../online/object-references';

type Props = { text: string; onInspect?: (reference: ObjectReference, mode: 'observed' | 'now') => void };

export function ReferenceText({ text, onInspect }: Props) {
  const references = onInspect ? splitObjectReferences(text).flatMap(part => part.reference ? [part.reference] : []) : [];
  return <View style={s.container}>
    <Text selectable style={s.text}>{text}</Text>
    {references.map((reference, index) => <View key={index} style={s.reference}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Inspect ${reference.kind} at copied hour ${reference.hour}`} onPress={() => onInspect?.(reference, 'observed')} style={s.button}><Text style={s.action}>Inspect {reference.kind} · copied hour {reference.hour}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Inspect ${reference.kind} now, reference copied at hour ${reference.hour}`} onPress={() => onInspect?.(reference, 'now')} style={s.button}><Text style={s.action}>Inspect now</Text></Pressable>
    </View>)}
  </View>;
}

const s = StyleSheet.create({
  container: { gap: 6 }, text: { color: '#d6e2cd', fontSize: 14, lineHeight: 21 }, reference: { gap: 6 }, button: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#15241a', justifyContent: 'center' }, action: { color: '#b8e986', fontSize: 12 },
});
