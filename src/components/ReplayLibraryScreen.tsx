/** Explicit local import; cancellation keeps the current replay intact. */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { pickSharedReplay } from '../replay/files';
import { ReplayFileError } from '../replay/file-errors';
import { decodeSharedReplay } from '../replay/codec';
import type { SharedReplay } from '../replay/timeline';
import { SharedReplayViewer } from './SharedReplayViewer';

export function ReplayLibraryScreen({ onExit }: { onExit: () => void }) {
  const [replay, setReplay] = useState<SharedReplay>();
  const [viewing, setViewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function open() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const raw = await pickSharedReplay();
      if (raw === null || !mounted.current) return;
      const imported = decodeSharedReplay(raw);
      setReplay(imported); setError(''); setViewing(true);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof ReplayFileError ? failure.message : 'This file is not a supported shared replay.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (viewing && replay) return <SharedReplayViewer replay={replay} onExit={() => setViewing(false)} />;
  return <View style={s.screen}><Text style={s.title}>Shared replays</Text><Text style={s.text}>Open a local replay to inspect its recorded perspective.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Open replay" accessibilityState={{ disabled: busy }} disabled={busy} onPress={open} style={s.button}><Text style={s.text}>{busy ? 'Opening…' : 'Open replay'}</Text></Pressable>
    {!!error && <Text accessibilityRole="alert" style={s.text}>{error}</Text>}
    {replay && <Pressable accessibilityRole="button" accessibilityLabel="View imported replay" onPress={() => setViewing(true)} style={s.button}><Text style={s.text}>Unverified replay · Hours {replay.from}–{replay.through}</Text></Pressable>}
    <Pressable accessibilityRole="button" accessibilityLabel="Exit replay library" onPress={onExit} style={s.button}><Text style={s.text}>Back</Text></Pressable>
  </View>;
}
const s = StyleSheet.create({ screen: { flex: 1, padding: 20, gap: 16, backgroundColor: '#0b1412' }, title: { color: '#eff4e9', fontSize: 24 }, text: { color: '#d6e2cd' }, button: { minHeight: 44, justifyContent: 'center', padding: 12, backgroundColor: '#15241a', borderWidth: 1, borderColor: '#40563a' } });
