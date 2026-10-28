/**
 * ---
 * purpose: Live launch editing, cancellation, and in-transit gift controls shared by solo and online play.
 * ---
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { flightDestination } from '../game/flight';
import type { Fleet } from '../game/simulation';
import type { HaulerChange } from '../game/transport';

type Props = { fleets: Fleet[]; rocks: { id: string; name: string }[]; hour: number; enabled: boolean; onCommand: (command: HaulerChange) => void };
export function HaulerOrders({ fleets, rocks, hour, enabled, onCommand }: Props) {
  return <View style={s.panel}><Text style={s.heading}>Your live hauler orders</Text>{fleets.length ? fleets.map(fleet => <Hauler key={fleet.id} fleet={fleet} rocks={rocks} hour={hour} enabled={enabled} onCommand={onCommand} />) : <Text style={s.detail}>No preparing or traveling haulers.</Text>}</View>;
}
function Hauler({ fleet, rocks, hour, enabled, onCommand }: Omit<Props, 'fleets'> & { fleet: Fleet }) {
  const [amount, setAmount] = useState(String(fleet.drones));
  const giftPending = fleet.giftAt !== undefined && fleet.giftAt > hour;
  return <View style={s.hauler}>
    <Text style={s.text}>{rocks.find(r => r.id === fleet.from)?.name} → {flightDestination(rocks, fleet)}</Text>
    <Text style={s.detail}>{fleet.drones} drones · {fleet.preparing ? `preparing, departs in ${Math.max(0, (fleet.departed - hour) * 60).toFixed(0)}m` : `arrives in ${(fleet.arrives - hour).toFixed(2)}h`}{fleet.giftAt !== undefined ? giftPending ? ' · gift pending' : ' · gift active' : ''}</Text>
    {fleet.preparing && <><View style={s.row}><TextInput accessibilityLabel={`Edit launch manifest to ${flightDestination(rocks, fleet)}`} secureTextEntry={false} keyboardType="number-pad" value={amount} onChangeText={setAmount} style={s.input} /><Control text="Update manifest" disabled={!enabled || !Number.isSafeInteger(Number(amount)) || Number(amount) < 1} onPress={() => onCommand({ action: 'edit-launch', fleet: fleet.id, drones: Number(amount) })} /></View><Control text="Cancel launch and return manifest" disabled={!enabled} onPress={() => onCommand({ action: 'cancel-launch', fleet: fleet.id })} /></>}
    {fleet.giftAt === undefined ? <><Text style={s.detail}>A gift transfers to the next intelligence it contacts. The gift order takes effect in ten minutes and can be canceled before then.</Text><Control text="Turn hauler into a gift" disabled={!enabled} onPress={() => onCommand({ action: 'gift', fleet: fleet.id })} /></> : giftPending ? <Control text="Cancel gift order" disabled={!enabled} onPress={() => onCommand({ action: 'cancel-gift', fleet: fleet.id })} /> : <Text style={s.detail}>Gift committed. Ownership transfers on contact.</Text>}
  </View>;
}
function Control({ text, disabled, onPress }: { text: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={[s.control, disabled && { opacity: 0.35 }]}><Text style={s.text}>{text}</Text></Pressable>; }
const s = StyleSheet.create({ panel: { gap: 12, padding: 16, borderWidth: 1, borderColor: '#30442b', backgroundColor: '#101b13' }, heading: { color: '#e5eadc', fontSize: 15 }, hauler: { gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: '#30442b' }, row: { flexDirection: 'row', gap: 8, alignItems: 'center' }, input: { minHeight: 44, width: 80, color: '#d6e2cd', padding: 10, borderWidth: 1, borderColor: '#40563a' }, control: { minHeight: 44, padding: 10, alignItems: 'center', justifyContent: 'center', flexGrow: 1, borderWidth: 1, borderColor: '#40563a' }, text: { color: '#d6e2cd', fontSize: 12 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 } });
