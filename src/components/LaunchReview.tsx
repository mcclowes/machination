import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { type LaunchEdit, type ScheduledLaunch } from '../game/orders';
import { isActionPlan } from '../game/future-actions';
import { SPECIALISTS } from '../game/specialist-catalog';
import { FACTIONS } from '../game/simulation';
import { MODULES } from '../game/modules';
import { gameClock } from '../game/time-machine';
import { LAUNCH_PREPARATION } from '../game/transport';
import type { LaunchUnit } from './launch-manifest';

export function LaunchReview({ plan, units, disabled, preparation, onSave, onClose }: { plan: ScheduledLaunch; units: LaunchUnit[]; disabled: boolean; preparation: boolean; onSave: (change: LaunchEdit) => void; onClose: () => void }) {
  const manifest = isActionPlan(plan) ? plan.action : plan;
  const [drones, setDrones] = useState(String(manifest.drones));
  const [selected, setSelected] = useState(manifest.specialists ?? []);
  const [changedUnits, setChangedUnits] = useState(false);
  const text = { color: '#d6e2cd', fontSize: 12, lineHeight: 20 };
  const button = (label: string, onPress: () => void, blocked = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked }} disabled={blocked} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: '#43563a', padding: 10, opacity: blocked ? 0.35 : 1 }}><Text style={text}>{label}</Text></Pressable>;
  const valid = drones.trim() !== '' && Number.isSafeInteger(Number(drones)) && Number(drones) >= (selected.length ? 0 : 1);
  const legacyModule = !isActionPlan(plan) ? plan.module : undefined;
  return <View style={{ gap: 10 }}>
    {isActionPlan(plan) && plan.action.type === 'gift' && <Text style={text}>Gift recipient: {FACTIONS[plan.action.recipient].name}{plan.action.carryModule ? ' · carries site module' : ''}</Text>}
    <Text style={text}>Order time: {gameClock(plan.executeAt)}</Text>
    <Text style={text}>Departure: {gameClock(plan.executeAt + (preparation ? LAUNCH_PREPARATION : 0))}{preparation ? ' · 10m preparation' : ''}</Text>
    <Text style={text}>Modules: {selected.length ? selected.map(id => { const unit = units.find(u => u.id === id); return unit ? `${SPECIALISTS[unit.kind].name} (${id})` : id; }).join(', ') : 'None'}{legacyModule ? ` · ${MODULES[legacyModule].name}` : ''}</Text>
    <Text style={text}>Drone manifest</Text><TextInput accessibilityLabel="Scheduled launch drones" editable={!disabled} value={drones} onChangeText={setDrones} keyboardType="number-pad" style={{ ...text, borderWidth: 1, borderColor: '#43563a', padding: 12 }} />
    {units.map(unit => <View key={unit.id}>{button(`${selected.includes(unit.id) ? '☑' : '☐'} ${SPECIALISTS[unit.kind].name} · ${unit.id}${unit.planned ? ' · queued hire' : ''}`, () => { setChangedUnits(true); setSelected(ids => ids.includes(unit.id) ? ids.filter(id => id !== unit.id) : [...ids, unit.id]); }, disabled)}</View>)}
    {selected.some(id => !units.some(unit => unit.id === id)) && button('Clear unavailable modules', () => { setChangedUnits(true); setSelected(ids => ids.filter(id => units.some(unit => unit.id === id))); }, disabled)}
    <Text style={text}>Future production can supply drones beyond current inventory. Drones and modules aren't reserved. Ownership, inventory, module location, and launch eligibility are checked when the order executes. Queued hires can fail.</Text>
    {!valid && <Text accessibilityRole="alert" style={text}>Enter a whole number of drones, at least {selected.length ? 'zero' : 'one'}.</Text>}
    {button('Save launch manifest', () => onSave({ planId: plan.id, drones: Number(drones), ...(changedUnits ? { specialists: selected } : {}) }), disabled || !valid)}
    {button('Close review', onClose)}
  </View>;
}
