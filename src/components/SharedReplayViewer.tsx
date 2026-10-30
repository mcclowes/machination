/** @format */

import { siteKindLabel } from '../content/terminology';
/** Read-only playback of validated public observations. */
import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BeltMap } from './BeltMap';
import { PlayerIdentity, PlayerPortraits } from './PlayerIdentity';
import { SpecialistManifest } from './SpecialistManifest';
import { mapSpecialistSummary } from './map-specialists';
import { MODULES } from '../game/modules';
import {
  nextReplayStep,
  previousReplayStep,
  seekReplay,
  type ReplayPosition,
} from '../replay/playback';
import type { SharedReplay } from '../replay/timeline';
import { gameClock } from '../game/time-machine';
import { playerAppearance } from '../game/players';

const PlayerRosterProvider = PlayerPortraits.Provider;
export function SharedReplayViewer({
  replay,
  onExit,
}: {
  replay: SharedReplay;
  onExit: () => void;
}) {
  const [position, setPosition] = useState<ReplayPosition>({ hour: replay.through });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState('');
  const [siteCard, setSiteCard] = useState<{ id: string; height: number }>();
  const [inspection, setInspection] = useState({ request: 0, id: undefined as number | undefined });
  const [width, setWidth] = useState(1);
  const [hourText, setHourText] = useState(String(replay.through));
  const [options, setOptions] = useState(false);
  const scene = useMemo(
    () => seekReplay(replay, position.hour, position.ordinal),
    [replay, position],
  );
  const current = useRef(position);
  current.current = position;
  useEffect(() => {
    setPlaying(false);
    setPosition({ hour: replay.through });
    setHourText(String(replay.through));
    setSelected('');
    setOptions(false);
    setInspection((value) => ({ request: value.request + 1, id: undefined }));
  }, [replay]);
  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = ((now - last) / 1000) * speed;
      last = now;
      if (!Number.isFinite(delta) || delta <= 0) return;
      const hour = Math.min(replay.through, current.current.hour + delta);
      if (!Number.isFinite(hour)) return;
      current.current = { hour };
      setPosition({ hour });
      setHourText(String(hour));
      if (hour >= replay.through) setPlaying(false);
    }, 50);
    return () => clearInterval(timer);
  }, [playing, speed, replay]);
  const closeLostSelection = useEffectEvent(() => {
    if (selected && !scene.rocks.some((rock) => rock.id === selected && rock.known))
      setSelected('');
  });
  useEffect(() => {
    closeLostSelection();
  }, [scene]);
  function seek(next: ReplayPosition) {
    if (!Number.isFinite(next.hour)) return;
    const bounded = { ...next, hour: Math.max(replay.from, Math.min(replay.through, next.hour)) };
    setPlaying(false);
    current.current = bounded;
    setPosition(bounded);
    setHourText(String(bounded.hour));
    setInspection((value) => ({ request: value.request + 1, id: undefined }));
  }
  function seekHour() {
    if (!hourText.trim() || !Number.isFinite(Number(hourText))) return;
    Keyboard.dismiss();
    seek({ hour: Number(hourText) });
  }
  const previous = previousReplayStep(replay, position),
    next = nextReplayStep(replay, position);
  const rock = scene.rocks.find((item) => item.id === selected);
  const group = replay.groups.find((item) => item.hour === position.hour);
  const ordinal = position.ordinal ?? (group ? group.states.length - 1 : undefined);
  const ratio =
    replay.through === replay.from
      ? 0
      : (position.hour - replay.from) / (replay.through - replay.from);
  const scrub = (x: number) => {
    if (Number.isFinite(x))
      seek({
        hour: replay.from + Math.max(0, Math.min(1, x / width)) * (replay.through - replay.from),
      });
  };
  return (
    <PlayerRosterProvider value={scene.rules?.portraits}>
      <KeyboardAvoidingView
        style={s.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <View style={s.between}>
            <PlayerIdentity
              faction={replay.perspective}
              size={32}
              detail="Unverified replay · recorded perspective"
            />
            <Control
              label="Exit replay"
              text="×"
              onPress={() => {
                setPlaying(false);
                onExit();
              }}
            />
          </View>
          {scene.winner && (
            <Text style={s.text}>
              Winner · {playerAppearance(scene.winner, scene.rules?.portraits).name}
            </Text>
          )}
          {scene.foresight?.map(w => <Text key={w.specialistId} style={s.text}>Foresight: death predicted at {gameClock(w.deathAt)} from {w.source}.</Text>)}
      {scene.discoveries?.slice(0, 2).map((d, i) => <Text key={i} style={s.text}>{d.message}</Text>)}
      {scene.draw && <Text style={s.text}>Draw</Text>}
        </View>
        <View style={s.stage}>
          <BeltMap
            fill
            inspecting={!!selected}
            coveredBottom={rock && siteCard?.id === rock.id ? siteCard.height + s.drawer.bottom : 0}
            game={scene}
            selected={selected}
            player={replay.perspective}
            onSelect={(site) => {
              setOptions(false);
              setSelected(site.id);
            }}
            inspectFleet={inspection}
            onInspectFleet={() => {
              setSelected('');
              setOptions(false);
            }}
            timeInspection={{
              liveHour: replay.through,
              historyStart: replay.from,
              historyEnd: replay.through,
              onInspect: (hour) => {
                if (hour === null || (hour >= replay.from && hour <= replay.through))
                  seek({ hour: hour ?? replay.through });
              },
            }}
          />
          {options && (
            <View style={s.drawer}>
              <View style={s.drawerHeading}>
                <Text style={s.title}>Playback options</Text>
                <Control
                  label="Close playback options"
                  text="×"
                  onPress={() => setOptions(false)}
                />
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={s.details}
              >
                <Text style={s.text}>
                  Clip {gameClock(replay.from)} — {gameClock(replay.through)}
                </Text>
                <Text style={s.text}>Seek to an exact hour</Text>
                <View style={s.row}>
                  <TextInput
                    style={s.input}
                    accessibilityLabel="Replay hour"
                    keyboardType="decimal-pad"
                    value={hourText}
                    onChangeText={setHourText}
                    onSubmitEditing={seekHour}
                  />
                  <Control label="Seek hour" onPress={seekHour} />
                </View>
                <View style={s.row}>
                  {[0.25, 1, 4, 16].map((value) => (
                    <Control
                      key={value}
                      label={`${value}×`}
                      selected={speed === value}
                      onPress={() => setSpeed(value)}
                    />
                  ))}
                </View>
                <Text style={s.text}>1× plays one game hour per second.</Text>
              </ScrollView>
            </View>
          )}
          {rock && (
            <View
              key={rock.id}
              testID="replay-site-inspector"
              style={s.drawer}
              onLayout={(event) =>
                setSiteCard({ id: rock.id, height: event.nativeEvent.layout.height })
              }
            >
              <View style={s.drawerHeading}>
                <Text style={s.title}>{rock.name}</Text>
                <Control label="Close site details" text="×" onPress={() => setSelected('')} />
              </View>
              <ScrollView contentContainerStyle={s.details}>
                {rock.owner !== undefined &&
                  (rock.owner ? (
                    <PlayerIdentity faction={rock.owner} detail="Observed owner" />
                  ) : (
                    <Text style={s.text}>Unclaimed</Text>
                  ))}
                {rock.kind !== 'unknown' && <Text style={s.text}>{siteKindLabel(rock.kind)}</Text>}
                {!rock.known ? (
                  <Text style={s.text}>Outside recorded sensor coverage</Text>
                ) : (
                  <>
                    {rock.destroyed && <Text style={s.text}>Destroyed</Text>}
                    {rock.coreOf && (
                      <PlayerIdentity faction={rock.coreOf} detail="Intelligence core" />
                    )}
                    {rock.drones !== undefined && <Text style={s.text}>{rock.drones} drones</Text>}
                    {rock.shield !== undefined && (
                      <Text style={s.text}>
                        Shield {rock.shield}
                        {rock.shieldMax !== undefined ? ` / ${rock.shieldMax}` : ''}
                      </Text>
                    )}
                    {rock.shieldsDisabled !== undefined && (
                      <Text style={s.text}>
                        Shields {rock.shieldsDisabled ? 'disabled' : 'enabled'}
                      </Text>
                    )}
                    {rock.module && <Text style={s.text}>{MODULES[rock.module].name}</Text>}
                    <SpecialistManifest
                      summary={mapSpecialistSummary(rock)}
                      heading="Specialists at this site"
                    />
                  </>
                )}
              </ScrollView>
            </View>
          )}
        </View>
        <View style={s.controls}>
          <View style={s.between}>
            <Text style={[s.text, s.clock]}>
              {gameClock(position.hour)}
              {group ? ` · State ${ordinal! + 1} of ${group.states.length}` : ''}
            </Text>
            <Control
              label="Playback options"
              text={`${speed}× · Options`}
              selected={options}
              onPress={() => {
                setPlaying(false);
                setOptions((value) => !value);
                setSelected('');
                setInspection((value) => ({ request: value.request + 1, id: undefined }));
              }}
            />
          </View>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Replay timeline"
            accessibilityState={{ disabled: !next && !previous }}
            accessibilityValue={{
              min: 0,
              max: 1,
              now: ratio,
              text: `${gameClock(position.hour)}${group ? ` · State ${ordinal! + 1} of ${group.states.length}` : ''}`,
            }}
            accessibilityActions={[
              { name: 'increment', label: 'Next state' },
              { name: 'decrement', label: 'Previous state' },
            ]}
            onAccessibilityAction={(event) => {
              const target = event.nativeEvent.actionName === 'increment' ? next : previous;
              if (target) seek(target);
            }}
            onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
            onStartShouldSetResponder={() => true}
            onResponderGrant={(event) => scrub(event.nativeEvent.locationX)}
            onResponderMove={(event) => scrub(event.nativeEvent.locationX)}
            style={s.timeline}
          >
            <View style={[s.progress, { width: `${ratio * 100}%` }]} />
          </View>
          <View style={s.transport}>
            <Control
              compact
              label="Beginning"
              text="|‹"
              onPress={() => seek({ hour: replay.from, ordinal: 0 })}
              disabled={!previous}
            />
            <Control
              compact
              label="Previous state"
              text="‹"
              disabled={!previous}
              onPress={() => previous && seek(previous)}
            />
            <Control
              compact
              label={playing ? 'Pause' : 'Play'}
              disabled={!playing && !next}
              onPress={() => {
                setOptions(false);
                if (playing) setPlaying(false);
                else if (position.hour === replay.through && next) seek(next);
                else setPlaying(true);
              }}
            />
            <Control
              compact
              label="Next state"
              text="›"
              disabled={!next}
              onPress={() => next && seek(next)}
            />
            <Control
              compact
              label="End"
              text="›|"
              disabled={!next}
              onPress={() => seek({ hour: replay.through })}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </PlayerRosterProvider>
  );
}
function Control({
  label,
  text,
  compact,
  onPress,
  disabled = false,
  selected,
}: {
  label: string;
  text?: string;
  compact?: boolean;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[
        s.button,
        compact && { flex: 1 },
        selected && s.selected,
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={s.text}>{text ?? label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: '#0b1412' },
  header: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderColor: '#40563a',
  },
  title: { color: '#eff4e9', fontSize: 16, flexShrink: 1 },
  text: { color: '#d6e2cd', fontSize: 12, lineHeight: 18 },
  clock: { flex: 1 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stage: { flex: 1, minHeight: 120, overflow: 'hidden' },
  drawer: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    maxHeight: '65%',
    backgroundColor: '#101e15',
    borderWidth: 1,
    borderColor: '#40563a',
  },
  drawerHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 12,
    borderBottomWidth: 1,
    borderColor: '#40563a',
  },
  controls: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 4,
    borderTopWidth: 1,
    borderColor: '#40563a',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  transport: { flexDirection: 'row', gap: 6 },
  button: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15241a',
    borderWidth: 1,
    borderColor: '#40563a',
  },
  selected: { borderColor: '#9cb886' },
  timeline: { height: 44, backgroundColor: '#26332e', justifyContent: 'center' },
  progress: { height: 8, backgroundColor: '#9cb886' },
  input: {
    flex: 1,
    minHeight: 44,
    minWidth: 100,
    color: '#eff4e9',
    borderWidth: 1,
    borderColor: '#40563a',
    padding: 8,
  },
  details: { gap: 10, padding: 12 },
});
