import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { setStringAsync } from 'expo-clipboard';

type Props = { value: string; label?: string };

export function CopyObjectReference({ value, label = 'Copy reference' }: Props) {
  const copying = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ value: string; message: string }>();
  async function copy() {
    if (copying.current) return;
    copying.current = true;
    setBusy(true);
    setResult(undefined);
    try {
      if (!await setStringAsync(value)) throw new Error('Clipboard write failed');
      setResult({ value, message: 'Reference copied.' });
    } catch {
      setResult({ value, message: 'Could not copy reference. Try again.' });
    } finally {
      copying.current = false;
      setBusy(false);
    }
  }
  return <View style={s.container}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={copy} style={s.button}><Text style={s.label}>{busy ? 'Copying…' : label}</Text></Pressable>
    {result?.value === value && <Text accessibilityLiveRegion="polite" style={s.status}>{result.message}</Text>}
  </View>;
}

const s = StyleSheet.create({
  container: { gap: 6 }, button: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#15241a', justifyContent: 'center' }, label: { color: '#b8e986', fontSize: 12 }, status: { color: '#d6e2cd', fontSize: 12 },
});
