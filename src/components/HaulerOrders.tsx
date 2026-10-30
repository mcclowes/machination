/**
 * ---
 * purpose: Live launch editing, cancellation, and in-transit gift controls shared by solo and online play.
 * ---
 */
import { gameClock } from '../game/time-machine';
import type { Faction } from '../game/simulation';
import type { ModuleKind } from '../game/modules';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SPECIALISTS } from '../game/specialist-catalog';
import { flightDestination } from '../game/flight';
import type { Specialist } from '../game/specialists';
import type { Fleet } from '../game/simulation';
import type { HaulerChange } from '../game/transport';

type Props = { title?: string; fleets: Fleet[]; rocks: { id: string; name: string; specialists?: Specialist[]; drones?: number; owner?: Faction | null; module?: ModuleKind }[]; hour: number; scheduledAt?: number; enabled: boolean; courseDelay?: boolean; onCommand: (command: HaulerChange) => void; onNavigate?: (id: number) => void };
export function HaulerOrders({ title, fleets, rocks, hour, enabled, scheduledAt, courseDelay = false, onCommand, onNavigate }: Props) {
  return <View style={s.panel}><Text style={s.heading}>{title ?? (scheduledAt === undefined ? 'Your live hauler orders' : `Hauler orders at ${gameClock(scheduledAt)}`)}</Text>{scheduledAt !== undefined && <Text style={s.detail}>Commands use forecast inventory and timing. Requirements are checked again at execution; unavailable haulers abort privately.</Text>}{fleets.length ? fleets.map(fleet => <Hauler key={fleet.id} fleet={fleet} rocks={rocks} hour={hour} enabled={enabled} scheduledAt={scheduledAt} courseDelay={courseDelay} onCommand={onCommand} onNavigate={onNavigate} />) : <Text style={s.detail}>No preparing or traveling haulers.</Text>}</View>;
}
function Hauler({ fleet, rocks, hour, enabled, scheduledAt, courseDelay, onCommand, onNavigate }: Omit<Props, 'fleets'> & { fleet: Fleet }) {
  const [amount, setAmount] = useState(String(fleet.drones));
  const signature = (fleet.specialists ?? []).map(u => u.id).join(',');
  const [manifest, setManifest] = useState<string[]>((fleet.specialists ?? []).map(u => u.id));
  useEffect(() => { setAmount(String(fleet.drones)); setManifest((fleet.specialists ?? []).map(u => u.id)); }, [fleet.drones, signature]);
  const available = [...(fleet.specialists ?? []), ...(rocks.find(r => r.id === fleet.from)?.specialists ?? [])].filter(u => u.owner === fleet.owner && !u.captive);
  const selected = manifest.filter(id => available.some(u => u.id === id));
  const source = rocks.find(r => r.id === fleet.from);
  const preparing = !!fleet.preparing && fleet.departed > hour;
  const canEdit = enabled && preparing && source?.owner === fleet.owner;
  const label = (text: string) => scheduledAt === undefined ? text : `Schedule at ${gameClock(scheduledAt)}: ${text}`;
  const giftPending = fleet.giftAt !== undefined && fleet.giftAt > hour;
  return <View style={s.hauler}>
    <Text style={s.text}>{rocks.find(r => r.id === fleet.from)?.name} → {flightDestination(rocks, fleet)}</Text>
    <Text style={s.detail}>{fleet.drones} drones · {fleet.preparing ? `preparing, departs in ${Math.max(0, (fleet.departed - hour) * 60).toFixed(0)}m` : `arrives in ${(fleet.arrives - hour).toFixed(2)}h`}{fleet.giftAt !== undefined ? giftPending ? ' · gift pending' : ' · gift active' : ''}</Text>
    {(fleet.enginesDisabledUntil ?? 0) > hour && <Text style={s.detail}>Engines disabled until {gameClock(fleet.enginesDisabledUntil!)}. Arrival includes the outage.</Text>}
    {!!fleet.specialists?.length && <Text style={s.detail}>{fleet.specialists.map(u => `${SPECIALISTS[u.kind].name}${u.captive ? ' (captive)' : ''}`).join(' · ')}</Text>}
    {!preparing && fleet.departed <= hour && fleet.arrives > hour && fleet.specialists?.some(u => u.kind === 'navigator' && u.owner === fleet.owner && !u.captive) && onNavigate && <Control text={label("Change course on chart")} disabled={!enabled || (fleet.enginesDisabledUntil ?? 0) > hour || !!fleet.pendingCourse || !!fleet.courseLocked || fleet.specialists.some(u => u.kind === 'navigator' && u.owner === fleet.owner && !u.captive && u.lastCourseAt !== undefined && hour + (courseDelay ? 1 / 6 : 0) < u.lastCourseAt + 8)} onPress={() => onNavigate(fleet.id)} />}
    {fleet.specialists?.some(u => u.kind === 'navigator' && u.owner === fleet.owner && !u.captive) && <Text style={s.detail}>{courseDelay ? 'Course changes take effect after ten minutes. The current course continues until then; cancel before activation. Turns must be eight hours apart; the next order can prepare during the final ten minutes.' : 'Course changes take effect immediately, with an eight-hour cooldown.'}</Text>}
    {fleet.pendingCourse && <><Text style={s.detail}>Course change requested: {rocks.find(r => r.id === fleet.pendingCourse!.to)?.name ?? fleet.pendingCourse.to} · effective {gameClock(fleet.pendingCourse.executeAt)}</Text><Control text={label("Cancel course change")} disabled={!enabled || hour >= fleet.pendingCourse.executeAt} onPress={() => onCommand({ action: 'cancel-course', fleet: fleet.id })} /></>}
    {preparing && <>{available.map(unit => <Pressable key={unit.id} accessibilityRole="checkbox" accessibilityLabel={`Include ${SPECIALISTS[unit.kind].name} in preparing launch`} accessibilityState={{ checked: selected.includes(unit.id), disabled: !canEdit }} disabled={!canEdit} onPress={() => setManifest(current => current.includes(unit.id) ? current.filter(id => id !== unit.id) : [...current, unit.id])} style={s.control}><Text style={s.text}>{selected.includes(unit.id) ? '☑' : '☐'} {SPECIALISTS[unit.kind].name}</Text></Pressable>)}<View style={s.row}><TextInput accessibilityLabel={`Edit launch manifest to ${flightDestination(rocks, fleet)}`} secureTextEntry={false} keyboardType="number-pad" value={amount} onChangeText={setAmount} style={s.input} /><Control text={label("Update manifest")} disabled={!canEdit || Number(amount) > fleet.drones + Math.floor(source?.drones ?? 0) || !!fleet.intercept && !available.some(u => selected.includes(u.id) && u.kind === 'pirate') || !Number.isSafeInteger(Number(amount)) || Number(amount) < (selected.length ? 0 : 1)} onPress={() => onCommand({ action: 'edit-launch', fleet: fleet.id, drones: Number(amount), specialists: selected })} /></View><Control text={label("Cancel launch and return manifest")} disabled={!canEdit || !!fleet.module && !!source?.module} onPress={() => onCommand({ action: 'cancel-launch', fleet: fleet.id })} /></>}
    {fleet.giftAt === undefined ? <Control text={label("Turn hauler into a gift")} disabled={!enabled} onPress={() => onCommand({ action: 'gift', fleet: fleet.id })} /> : giftPending ? <Control text={label("Cancel gift order")} disabled={!enabled} onPress={() => onCommand({ action: 'cancel-gift', fleet: fleet.id })} /> : <Text style={s.detail}>Gift committed. Ownership transfers on contact.</Text>}
  </View>;
}
function Control({ text, disabled, onPress }: { text: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={[s.control, disabled && { opacity: 0.35 }]}><Text style={[s.text, { alignSelf: 'stretch', textAlign: 'center' }]}>{text}</Text></Pressable>; }
const s = StyleSheet.create({ panel: { gap: 12, padding: 16, borderWidth: 1, borderColor: '#30442b', backgroundColor: '#101b13' }, heading: { color: '#e5eadc', fontSize: 15 }, hauler: { gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: '#30442b' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, input: { minHeight: 44, width: 80, color: '#d6e2cd', padding: 10, borderWidth: 1, borderColor: '#40563a' }, control: { minHeight: 44, padding: 10, alignItems: 'center', justifyContent: 'center', flexGrow: 1, flexShrink: 1, minWidth: 0, borderWidth: 1, borderColor: '#40563a' }, text: { color: '#d6e2cd', fontSize: 12 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 } });
