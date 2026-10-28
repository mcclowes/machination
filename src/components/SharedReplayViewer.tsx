/** Read-only playback of validated public observations. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BeltMap } from './BeltMap';
import { PlayerIdentity, PlayerPortraits } from './PlayerIdentity';
import { SPECIALISTS } from '../game/specialist-catalog';
import { MODULES } from '../game/modules';
import { nextReplayStep, previousReplayStep, seekReplay, type ReplayPosition } from '../replay/playback';
import type { SharedReplay } from '../replay/timeline';

const PlayerRosterProvider = PlayerPortraits.Provider;
export function SharedReplayViewer({ replay, onExit }: { replay: SharedReplay; onExit: () => void }) {
  const [position, setPosition] = useState<ReplayPosition>({ hour: replay.through });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState('');
  const [inspection, setInspection] = useState({ request: 0, id: undefined as number | undefined });
  const [width, setWidth] = useState(1);
  const [hourText, setHourText] = useState(String(replay.through));
  const scene = useMemo(() => seekReplay(replay, position.hour, position.ordinal), [replay, position]);
  const current = useRef(position); current.current = position;
  useEffect(() => {
    setPlaying(false); setPosition({ hour: replay.through }); setHourText(String(replay.through)); setSelected('');
    setInspection(value => ({ request: value.request + 1, id: undefined }));
  }, [replay]);
  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = (now - last) / 1000 * speed;
      last = now;
      if (!Number.isFinite(delta) || delta <= 0) return;
      const hour = Math.min(replay.through, current.current.hour + delta);
      if (!Number.isFinite(hour)) return;
      current.current = { hour }; setPosition({ hour }); setHourText(String(hour));
      if (hour >= replay.through) setPlaying(false);
    }, 50);
    return () => clearInterval(timer);
  }, [playing, speed, replay]);
  useEffect(() => {
    if (selected && !scene.rocks.some(rock => rock.id === selected && rock.known)) setSelected('');
  }, [scene]);
  function seek(next: ReplayPosition) {
    if (!Number.isFinite(next.hour)) return;
    const bounded = { ...next, hour: Math.max(replay.from, Math.min(replay.through, next.hour)) };
    setPlaying(false); current.current = bounded; setPosition(bounded); setHourText(String(bounded.hour));
    setInspection(value => ({ request: value.request + 1, id: undefined }));
  }
  const previous = previousReplayStep(replay, position), next = nextReplayStep(replay, position);
  const rock = scene.rocks.find(item => item.id === selected);
  const group = replay.groups.find(item => item.hour === position.hour);
  const ordinal = position.ordinal ?? (group ? group.states.length - 1 : undefined);
  const ratio = replay.through === replay.from ? 0 : (position.hour - replay.from) / (replay.through - replay.from);
  const scrub = (x: number) => { if (Number.isFinite(x)) seek({ hour: replay.from + Math.max(0, Math.min(1, x / width)) * (replay.through - replay.from) }); };
  return <PlayerRosterProvider value={scene.rules?.portraits}><ScrollView style={s.screen} contentContainerStyle={s.content}>
    <Control label="Exit replay" onPress={() => { setPlaying(false); onExit(); }} />
    <Text style={s.title}>Unverified replay</Text>
    <PlayerIdentity faction={replay.perspective} detail="Recorded perspective" />
    <Text style={s.text}>Hour {position.hour.toFixed(3)}{group ? ` · State ${ordinal! + 1} of ${group.states.length}` : ''} · Clip {replay.from}–{replay.through}</Text>
    {scene.winner && <PlayerIdentity faction={scene.winner} detail="Winner" />}
    {scene.draw && <Text style={s.text}>Draw</Text>}
    <View style={s.row}>
      <Control label="Beginning" onPress={() => seek({ hour: replay.from, ordinal: 0 })} disabled={!previous} />
      <Control label="Previous state" disabled={!previous} onPress={() => previous && seek(previous)} />
      <Control label={playing ? 'Pause' : 'Play'} disabled={!playing && !next} onPress={() => {
        if (playing) setPlaying(false);
        else if (position.hour === replay.through && next) seek(next);
        else setPlaying(true);
      }} />
      <Control label="Next state" disabled={!next} onPress={() => next && seek(next)} />
      <Control label="End" disabled={!next} onPress={() => seek({ hour: replay.through })} />
    </View>
    <View accessibilityRole="adjustable" accessibilityLabel="Replay timeline" accessibilityValue={{ min: replay.from, max: replay.through, now: position.hour }}
      accessibilityActions={[{ name: 'increment', label: 'Next state' }, { name: 'decrement', label: 'Previous state' }]}
      onAccessibilityAction={event => { const target = event.nativeEvent.actionName === 'increment' ? next : previous; if (target) seek(target); }}
      onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))} onStartShouldSetResponder={() => true}
      onResponderGrant={event => scrub(event.nativeEvent.locationX)} onResponderMove={event => scrub(event.nativeEvent.locationX)} style={s.timeline}>
      <View style={[s.progress, { width: `${ratio * 100}%` }]} />
    </View>
    <View style={s.row}><Text style={s.text}>Hour</Text><TextInput style={s.input} accessibilityLabel="Replay hour" keyboardType="decimal-pad" value={hourText} onChangeText={setHourText} />
      <Control label="Seek hour" onPress={() => { if (hourText.trim()) seek({ hour: Number(hourText) }); }} />
      {[0.25, 1, 4, 16].map(value => <Control key={value} label={`${value}×`} selected={speed === value} onPress={() => setSpeed(value)} />)}
    </View>
    <BeltMap game={scene} selected={selected} player={replay.perspective} onSelect={site => setSelected(site.id)} inspectFleet={inspection}
      onInspectFleet={() => setSelected('')} timeInspection={scene.fleets.every(fleet => fleet.arrives >= replay.from && fleet.arrives <= replay.through)
        ? { liveHour: replay.through, historyStart: replay.from, onInspect: hour => { if (hour === null || hour >= replay.from && hour <= replay.through) seek({ hour: hour ?? replay.through }); } }
        : undefined} />
    {rock && <View style={s.details}><Text style={s.title}>{rock.name}</Text><Control label="Close site details" onPress={() => setSelected('')} />
      {rock.owner !== undefined && (rock.owner ? <PlayerIdentity faction={rock.owner} detail="Observed owner" /> : <Text style={s.text}>Unclaimed</Text>)}
      {rock.kind !== 'unknown' && <Text style={s.text}>{rock.kind}</Text>}
      {!rock.known ? <Text style={s.text}>Outside recorded sensor coverage</Text> : <>
        {rock.destroyed && <Text style={s.text}>Destroyed</Text>}
        {rock.coreOf && <PlayerIdentity faction={rock.coreOf} detail="Intelligence core" />}
        {rock.drones !== undefined && <Text style={s.text}>{rock.drones} drones</Text>}
        {rock.shield !== undefined && <Text style={s.text}>Shield {rock.shield}{rock.shieldMax !== undefined ? ` / ${rock.shieldMax}` : ''}</Text>}
        {rock.shieldsDisabled !== undefined && <Text style={s.text}>Shields {rock.shieldsDisabled ? 'disabled' : 'enabled'}</Text>}
        {rock.module && <Text style={s.text}>{MODULES[rock.module].name}</Text>}
        {rock.specialists?.map(unit => <View key={unit.id}><Text style={s.text}>{SPECIALISTS[unit.kind].name}{unit.captive ? ' · Captive' : ''}</Text><PlayerIdentity faction={unit.owner} detail="Specialist owner" size={32} /></View>)}
      </>}
    </View>}
  </ScrollView></PlayerRosterProvider>;
}
function Control({ label, onPress, disabled = false, selected }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.4 }]}><Text style={s.text}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1412' }, content: { padding: 16, gap: 12 }, title: { color: '#eff4e9', fontSize: 20 }, text: { color: '#d6e2cd' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, button: { minHeight: 44, padding: 10, justifyContent: 'center', backgroundColor: '#15241a', borderWidth: 1, borderColor: '#40563a' },
  timeline: { height: 44, backgroundColor: '#26332e', justifyContent: 'center' }, progress: { height: 8, backgroundColor: '#9cb886' }, input: { minHeight: 44, minWidth: 100, color: '#eff4e9', borderWidth: 1, borderColor: '#40563a', padding: 8 }, details: { gap: 10, padding: 12, backgroundColor: '#101e15' },
});
