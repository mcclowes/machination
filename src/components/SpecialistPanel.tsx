/** Global management uses only the supplied observation. */
import { TemporalSiteStatus, TemporalSpecialistControl } from './TemporalControls';
import { inStasis } from '../game/temporal';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Faction } from '../game/simulation';
import type { GameView, ObservedRock } from '../game/visibility';
import { recruitmentStatus } from '../game/specialists';
import { SPECIALISTS, specialistReference, promotion, type SpecialistKind } from '../game/specialist-catalog';
import { gameClock } from '../game/time-machine';
import { SpecialistIcon } from './SpecialistIcon';
import { RecruitmentOffers } from './SpecialistBay';

export type SpecialistPanelProps = {
  game: GameView; owner: Faction; enabled: boolean; scheduledAt?: number;
  onHire: (kind: SpecialistKind) => void; onPromote: (id: string) => void; onRelease: (id: string) => void; onActivate?: (id: string) => void;
  onInspectSite: (id: string) => void; onInspectFleet: (id: number) => void;
};
export function SpecialistPanel({ game, owner, enabled, scheduledAt, onHire, onPromote, onRelease, onActivate, onInspectSite, onInspectFleet }: SpecialistPanelProps) {
  const sites = game.rocks.filter((site): site is Extract<ObservedRock, {known:true}> => site.known);
  const observed = { ...game, rocks: sites };
  const active = enabled && game.version === 2 && !game.winner && !game.draw && !game.eliminated.includes(owner);
  const status = recruitmentStatus(observed, owner);
  const label = (action: string) => scheduledAt === undefined ? action : `Schedule at ${gameClock(scheduledAt)}: ${action}`;
  const rows = [
    ...sites.flatMap(site => (site.specialists ?? []).filter(unit => unit.owner === owner || unit.captive && site.owner === owner).map(unit => ({unit, site, fleet: undefined}))),
    ...game.fleets.flatMap(fleet => (fleet.specialists ?? []).filter(unit => unit.owner === owner).map(unit => ({unit, site: undefined, fleet}))),
  ];
  const docked = (row: typeof rows[number]) => !!row.site && row.site.owner === owner && !row.site.destroyed && !inStasis(game, row.site) && row.unit.owner === owner && !row.unit.captive;
  const promotable = rows.filter(row => docked(row) && promotion(row.unit.kind)).length;
  const siteName = (id: string) => game.rocks.find(site => site.id === id)?.name ?? id;
  return <View style={s.panel}>
    <Text style={s.heading}>Specialists</Text>
    <RecruitmentOffers game={observed} owner={owner} enabled={enabled} scheduledAt={scheduledAt} onHire={onHire} />
    <Text style={s.detail}>{promotable} docked {promotable === 1 ? 'specialist' : 'specialists'} can promote{status.credits === 0 ? ' when a credit is available' : ''}.</Text>
    {game.foresight?.map(w => <Text key={w.specialistId} style={s.detail}>Foresight: specialist death predicted at {gameClock(w.deathAt)} from {w.source}. Conditional on current plans.</Text>)}
    <Text style={s.heading}>Known roster · {rows.length}</Text>
    {rows.length === 0 && <Text style={s.detail}>No known specialists.</Text>}
    {rows.map(row => {
      const {unit, site, fleet} = row;
      const entry = SPECIALISTS[unit.kind];
      const next = promotion(unit.kind);
      const held = !!site && site.owner === owner && !site.destroyed;
      const returnSite = game.rocks.some(home => home.owner === unit.owner && !(home.known && home.destroyed));
      return <View key={unit.id} style={s.card}>
        <View style={s.identity}><SpecialistIcon kind={unit.kind} /><Text style={s.name}>{entry.name}</Text></View>
        <Text style={s.detail}>{specialistReference(unit.kind)} · {unit.captive ? unit.owner === owner ? 'Your captive unit' : 'Captive' : fleet ? fleet.preparing ? 'Preparing departure' : 'In transit' : 'Docked'}</Text>
        <Text style={s.detail}>{unit.captive ? 'Captive units have no abilities.' : entry.description}</Text>
        {site ? <Button label={`Inspect site ${site.name}`} onPress={() => onInspectSite(site.id)} /> : fleet && <Button label={`Inspect hauler ${fleet.id}: ${siteName(fleet.from)} → ${siteName(fleet.to)}`} onPress={() => onInspectFleet(fleet.id)} />}
        {unit.owner === owner && next && !unit.captive && <>
          <Text style={s.detail}>Promote to {SPECIALISTS[next].name}: {SPECIALISTS[next].description}</Text>
          {!docked(row) && <Text style={s.detail}>Promotion requires docking at a controlled live site.</Text>}
          <Button label={label(`Promote ${entry.name} to ${SPECIALISTS[next].name} for 1 credit`)} disabled={!active || status.credits === 0 || !docked(row)} onPress={() => onPromote(unit.id)} />
        </>}
        {unit.owner === owner && <TemporalSpecialistControl game={game} site={site?.owner === owner && !site.destroyed ? site : undefined} unit={unit} enabled={active} scheduledAt={scheduledAt} onActivate={onActivate} />}
        {site && <TemporalSiteStatus site={site} hour={game.hour} />}
        {unit.captive && held && <>
          {!returnSite && <Text style={s.detail}>No return territory on the chart for this captive.</Text>}
          <Button label={label(`Release captive ${entry.name}`)} disabled={!active || !returnSite} onPress={() => onRelease(unit.id)} />
        </>}
      </View>;
    })}
  </View>;
}
function Button({label, disabled = false, onPress}: {label:string; disabled?:boolean; onPress:()=>void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}><Text style={s.name}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: {gap:10}, heading: {color:'#b8e986', fontSize:13},
  card: {padding:12, borderWidth:1, borderColor:'#40563a', backgroundColor:'#142117', gap:7},
  identity: {flexDirection:'row', alignItems:'center', gap:10},
  name: {color:'#d6e2cd', fontSize:12}, detail: {color:'#8c9f85', fontSize:11, lineHeight:18},
  button: {minHeight:44, padding:12, justifyContent:'center', borderWidth:1, borderColor:'#40563a', backgroundColor:'#15241a'}, disabled: {opacity:0.4},
});
