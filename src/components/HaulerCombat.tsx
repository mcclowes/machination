/** Contextual predictions use the inspected observation, including historical frames. */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { forecastEncounters } from '../game/encounter-forecast';
import type { EncounterAsset, EncounterReport } from '../game/combat-report';
import { SPECIALISTS } from '../game/specialist-catalog';
import { gameClock } from '../game/time-machine';
import type { Faction } from '../game/simulation';
import type { GameView } from '../game/visibility';
import { usePlayerRoster } from './PlayerIdentity';

export type CombatObservation = { view: GameView; faction: Faction; observedAt: number };
export function HaulerCombat({ observation, fleetId }: { observation: CombatObservation; fleetId: number }) {
  const [open, setOpen] = useState(false);
  const { view, faction, observedAt } = observation;
  const forecast = useMemo(() => open ? forecastEncounters(view, faction, fleetId) : undefined, [open, view, faction, fleetId]);
  const identity = usePlayerRoster();
  if (view.version !== 2) return null;
  const owner = (side: EncounterAsset) => side.owner ? identity(side.owner).name : 'Unclaimed';
  const inventory = (side: EncounterAsset) => `${side.drones} drones${side.shieldsDisabled ? ' · shields disabled' : side.shield ? ` + ${Math.floor(side.shield)} shields` : ''}`;
  const name = (side: EncounterAsset) => side.asset.type === 'site' ? view.rocks.find(r => r.id === side.asset.id)?.name ?? 'Site' : 'Hauler';
  const result = (report: EncounterReport) => {
    const survivor = report.kind === 'arrival' || report.site ? report.after[1] : report.winner === undefined ? undefined : report.after[report.winner];
    if (report.outcome === 'captured') return `Site acquired · ${survivor?.drones ?? 0} drones survive`;
    if (report.outcome === 'held') return `Defender holds · ${survivor?.drones ?? 0} drones survive`;
    if (report.outcome === 'won' && survivor) return `${owner(survivor)} wins · ${survivor.drones} drones survive`;
    if (report.outcome === 'tie') return 'Tie · both haulers lost';
    if (report.outcome === 'transferred') return 'Gift accepted';
    if (report.outcome === 'returned') return 'Hauler returns from destroyed destination';
    return 'Combat ends during specialist abilities';
  };
  return <View style={s.container}>
    <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Close combat prediction' : 'Combat prediction'} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={s.button}>
      <Text style={s.text}>{open ? 'Close combat' : 'Combat'}</Text>
    </Pressable>
    {forecast && <View testID="combat-prediction" style={s.report}>
      <Text style={s.heading}>Combat prediction</Text>
      <Text style={s.muted}>Based on observations at {gameClock(observedAt)}.{view.hour !== observedAt ? ` Inspected time: ${gameClock(view.hour)}.` : ''}</Text>
      {forecast.reports.map((report, index) => <View key={index} style={s.encounter}>
        <Text style={s.heading}>{gameClock(report.hour)} · {report.site ? view.rocks.find(r => r.id === report.site)?.name ?? 'Site' : report.kind === 'interception' ? 'Interception' : 'In transit'}</Text>
        <Text style={s.heading}>{result(report)}</Text>
        {report.before.map((side, i) => <Text key={i} style={s.text}>{owner(side)} · {name(side)}: {inventory(side)}</Text>)}
        {!!report.reinforcement?.haulers.length && <Text style={s.text}>Preparing defenders join: {report.reinforcement.haulers.reduce((sum, h) => sum + h.drones, 0)} drones; defence now {report.reinforcement.site.drones}.</Text>}
        {report.steps.map((step, i) => <Text key={i} style={s.text}>{step.type === 'ability' ? `${step.kinds.map(k => SPECIALISTS[k].name).join(', ')} (priority ${step.priority})` : [step.generals.some(Boolean) && SPECIALISTS.general.name, step.king.some(Boolean) && SPECIALISTS.king.name].filter(Boolean).join(', ')}: {step.before[0].drones} → {step.after[0].drones} / {step.before[1].drones} → {step.after[1].drones}{step.type === 'ability' && step.ended ? ' · combat ends' : ''}</Text>)}
        {report.suppressed && <Text style={s.text}>Arbiter suppresses later local abilities and local repair.</Text>}
        {report.shield && <Text style={s.text}>{report.before[1].shieldsDisabled ? 'Shields disabled · no drones absorbed.' : `Shields absorb ${report.shield.absorbed} drones · ${Math.floor(report.shield.after)} charge remains.`}</Text>}
        {!!report.salvaged && <Text style={s.text}>Council-authorized salvage: {report.salvaged} drones.</Text>}
        {!!report.repaired && <Text style={s.text}>Engineer recovery: {report.repaired} drones.</Text>}
        {report.outcome === 'ended' && report.after.map((side, i) => side && <Text key={i} style={s.text}>{owner(side)} · {name(side)}: {side.destroyed ? 'destroyed' : inventory(side)}{side.returning ? ' · returning' : ''}</Text>)}
        {!!report.captured.length && <Text style={s.text}>{report.captured.length} specialist{report.captured.length === 1 ? '' : 's'} captured.</Text>}
      </View>)}
      <Text style={s.text}>{forecast.status === 'unknown-destination' ? 'Destination outside observations. Its defence and arrival outcome are unknown.' : forecast.status === 'unknown-interception' ? 'Interception target outside observations. Its outcome is unknown.' : forecast.status === 'operation-ended' ? 'The observed forecast ends with the operation; later encounters are unknown.' : forecast.status === 'limit' ? 'Hauler still traveling at the seven-day forecast limit.' : forecast.status === 'unavailable' ? 'Combat prediction unavailable for this hauler.' : !forecast.reports.length ? 'No combat predicted before this hauler docks.' : 'Predicted outcomes can change with new information and orders.'}</Text>
      <Text style={s.muted}>Your queued orders are included. New rival orders and hires are not predicted. Only observed specialists contribute to global effects.{forecast.incomplete ? ' Unobserved territory makes this forecast conditional.' : ''}</Text>
    </View>}
  </View>;
}
const s = StyleSheet.create({
  container: { gap: 6 }, button: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 22, backgroundColor: '#24352c' },
  report: { gap: 8 }, encounter: { gap: 4, borderTopWidth: 1, borderTopColor: '#526644', paddingTop: 8 },
  text: { color: '#d6e2cd', fontSize: 12, lineHeight: 18 }, muted: { color: '#a6b1a0', fontSize: 11, lineHeight: 17 }, heading: { color: '#e5eadc', fontSize: 12, fontWeight: '600', lineHeight: 18 },
});
