import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ObjectReference } from '../online/protocol';
import { splitObjectReferences } from '../online/object-references';
import { gameClock } from '../game/time-machine';
import { CopyObjectReference } from './CopyObjectReference';

type Props = { text: string; onInspect?: (reference: ObjectReference, mode: 'observed' | 'now') => void };

export function ReferenceText({ text, onInspect }: Props) {
  const parts = onInspect ? splitObjectReferences(text) : [{ text }];
  const references = parts.flatMap(part => part.reference ? [{ reference: part.reference, token: part.text }] : []);
  const readable = parts.map(part => part.reference ? `[${part.reference.kind} · observed at ${gameClock(part.reference.hour)}]` : part.text).join('');
  return <View style={s.container}>
    <Text selectable style={s.text}>{readable}</Text>
    {references.map(({ reference, token }, index) => <View key={index} style={s.reference}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Inspect ${reference.kind} at copied hour ${reference.hour}`} onPress={() => onInspect?.(reference, 'observed')} style={s.button}><Text style={s.action}>Inspect {reference.kind} · {gameClock(reference.hour)}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Inspect ${reference.kind} now, reference copied at hour ${reference.hour}`} onPress={() => onInspect?.(reference, 'now')} style={s.button}><Text style={s.action}>Inspect now</Text></Pressable>
      <CopyObjectReference value={token} />
    </View>)}
  </View>;
}

const s = StyleSheet.create({
  container: { gap: 6 }, text: { color: '#d6e2cd', fontSize: 14, lineHeight: 21 }, reference: { gap: 6, flexDirection: 'row', flexWrap: 'wrap' }, button: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#15241a', justifyContent: 'center' }, action: { color: '#b8e986', fontSize: 12 },
});
