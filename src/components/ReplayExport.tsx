/**
 * Prepare and disclose a detached observed replay before an explicit device handoff.
 *
 * @format
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { decodeSharedReplay, encodeSharedReplay, utf8Size } from '../replay/codec';
import { saveSharedReplay } from '../replay/files';
import type { SharedReplay } from '../replay/timeline';
import { PlayerIdentity, PlayerRoster } from './PlayerIdentity';

type Props = {
  historyStart: number;
  hour: number;
  createReplay: (from: number, through: number) => SharedReplay | Promise<SharedReplay>;
  disabled?: boolean;
};
type Artifact = { raw: string; replay: SharedReplay; bytes: number; retainedStart: number };
const boundsError = 'Choose finite, ordered hours within retained history.';
export function ReplayExport({ historyStart, hour, createReplay, disabled = false }: Props) {
  const [frontier] = useState(hour);
  const [fromText, setFrom] = useState(String(historyStart)),
    [throughText, setThrough] = useState(String(hour));
  const [artifact, setArtifact] = useState<Artifact>();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const mounted = useRef(true),
    preparing = useRef(false),
    saving = useRef(false),
    generation = useRef(0);
  const current = useRef({ historyStart, hour, disabled });
  current.current = { historyStart, hour, disabled };
  const prepared = useRef<Artifact | undefined>(undefined);
  const from = fromText.trim() ? Number(fromText) : NaN,
    through = throughText.trim() ? Number(throughText) : NaN;
  const valid =
    Number.isFinite(from) &&
    Number.isFinite(through) &&
    Number.isFinite(historyStart) &&
    Number.isFinite(frontier) &&
    from >= Math.max(0, historyStart) &&
    through >= from &&
    through <= Math.min(frontier, hour);
  const shareable =
    artifact &&
    valid &&
    artifact.retainedStart === historyStart &&
    artifact.replay.from === from &&
    artifact.replay.through === through;
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      mounted.current = false;
      generation.current++;
      prepared.current = undefined;
    };
    return invalidate;
  }, []);
  useEffect(() => {
    generation.current++;
    prepared.current = undefined;
    setArtifact(undefined);
    setMessage('');
  }, [historyStart]);
  function invalidate() {
    generation.current++;
    prepared.current = undefined;
    setArtifact(undefined);
    setMessage('');
  }
  async function prepare() {
    if (!mounted.current || disabled || preparing.current || saving.current) return;
    invalidate();
    if (!valid) {
      setMessage(boundsError);
      return;
    }
    const ticket = generation.current,
      retainedStart = historyStart;
    preparing.current = true;
    setBusy(true);
    try {
      const value = await createReplay(from, through);
      const raw = encodeSharedReplay(value),
        replay = decodeSharedReplay(raw);
      if (replay.from !== from || replay.through !== through) throw new Error('Interval mismatch');
      if (
        !mounted.current ||
        ticket !== generation.current ||
        current.current.historyStart !== retainedStart ||
        current.current.hour < through ||
        current.current.disabled
      )
        return;
      const next = { raw, replay, bytes: utf8Size(raw), retainedStart };
      prepared.current = next;
      setArtifact(next);
    } catch (error) {
      if (mounted.current && ticket === generation.current)
        setMessage(
          error && typeof error === 'object' && 'code' in error && error.code === 'replay-capacity'
            ? 'This observed timeline is too large. Choose a shorter interval.'
            : 'Replay could not be prepared. Try a shorter interval.',
        );
    } finally {
      preparing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    const next = prepared.current;
    if (
      !mounted.current ||
      disabled ||
      preparing.current ||
      saving.current ||
      !shareable ||
      next !== artifact
    )
      return;
    saving.current = true;
    setBusy(true);
    setMessage('');
    const ticket = generation.current;
    try {
      // Keep the device call before the first await to preserve browser activation.
      const result = await saveSharedReplay(
        next.raw,
        `machination-replay-${next.replay.from}-${next.replay.through}.json`,
      );
      if (!mounted.current || ticket !== generation.current) return;
      if (result === 'cancelled') {
        invalidate();
        return;
      }
      setMessage(Platform.OS === 'web' ? 'File handed to this device' : 'Share sheet closed');
    } catch {
      if (mounted.current && ticket === generation.current) {
        invalidate();
        setMessage('Replay could not be saved. Prepare it again to retry.');
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const button = (label: string, onPress: () => void, blocked = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked }}
      disabled={blocked}
      onPress={onPress}
      style={s.button}
    >
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={s.panel}>
      <Text style={s.title}>Export observed replay</Text>
      <Text style={s.text}>
        Available hours: {historyStart}–{frontier}. Reopen this panel to include newer history.
      </Text>
      <Text style={s.text}>From hour</Text>
      <TextInput
        accessibilityLabel="Replay from hour"
        keyboardType="numeric"
        value={fromText}
        editable={!disabled && !saving.current}
        onChangeText={(value) => {
          invalidate();
          setFrom(value);
        }}
        style={s.input}
      />
      <Text style={s.text}>Through hour</Text>
      <TextInput
        accessibilityLabel="Replay through hour"
        keyboardType="numeric"
        value={throughText}
        editable={!disabled && !saving.current}
        onChangeText={(value) => {
          invalidate();
          setThrough(value);
        }}
        style={s.input}
      />
      {!valid && <Text style={s.text}>{boundsError}</Text>}
      {button('Prepare replay', prepare, disabled || busy || !valid)}
      {shareable && (
        <View style={s.panel}>
          <PlayerRoster
            colors={artifact.replay.groups[0]?.states[0]?.rules?.colors}
            portraits={artifact.replay.groups[0]?.states[0]?.rules?.portraits}
          >
            <PlayerIdentity
              faction={artifact.replay.perspective}
              detail={`Recorded perspective: ${artifact.replay.perspective}`}
            />
          </PlayerRoster>
          <Text style={s.text}>
            Included interval: {artifact.replay.from} through {artifact.replay.through}. Size:{' '}
            {artifact.bytes} bytes.
          </Text>
          <Text style={s.text}>Timeline points: {artifact.replay.groups.length}.</Text>
          <Text style={s.text}>
            Recipients can inspect and redistribute the recorded observed chart. Queues,
            recruitment, private funding, chat, and credentials are excluded.
          </Text>
          {button('Save replay', save, disabled || busy)}
        </View>
      )}
      {button('Cancel', invalidate)}
      {!!message && (
        <Text accessibilityRole="alert" style={s.text}>
          {message}
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  panel: { gap: 12, padding: 12, backgroundColor: '#0b1412' },
  title: { color: '#eff4e9', fontSize: 18 },
  text: { color: '#d6e2cd' },
  input: { color: '#eff4e9', borderWidth: 1, borderColor: '#40563a', padding: 12 },
  button: { minHeight: 44, justifyContent: 'center', padding: 12, backgroundColor: '#15241a' },
});
