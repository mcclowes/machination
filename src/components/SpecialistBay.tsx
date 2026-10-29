/**
 * ---
 * purpose: Shared specialist recruitment, promotion, captive release, and explicit transport selection.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPECIALISTS, hireAmount, promotion, type SpecialistKind } from '../game/specialist-catalog';
import { gameClock } from '../game/time-machine';
import { recruitmentStatus } from '../game/specialists';
import type { Faction, Game, Rock } from '../game/simulation';
import type { GameView } from '../game/visibility';
import { ArtworkImage, SpecialistIcon } from './Artwork';

export type SpecialistBayProps = {
  game: Game | GameView; rock: Rock; owner: Faction; enabled: boolean;
  mode?: 'all' | 'cargo'; scheduledAt?: number;
  selectionEnabled?: boolean; selected: string[]; onSelect: (ids: string[]) => void;
  onHire: (kind: SpecialistKind) => void; onPromote: (id: string) => void; onRelease: (id: string) => void;
};

export function SpecialistBay({ game, rock, owner, enabled, mode = 'all', scheduledAt, selectionEnabled = enabled, selected, onSelect, onHire, onPromote, onRelease }: SpecialistBayProps) {
  const label = (action: string) => scheduledAt === undefined ? action : `Schedule at ${gameClock(scheduledAt)}: ${action}`;
  const status = recruitmentStatus(game, owner);
  const controlled = rock.owner === owner && !rock.destroyed;
  const active = enabled && game.version === 2 && !game.winner && !game.draw && !game.eliminated.includes(owner);
  const canPromote = active && status.credits > 0;
  const units = rock.specialists ?? [];
  return <View style={s.bay}>
    {mode !== 'cargo' && <RecruitmentOffers game={game} owner={owner} enabled={enabled} scheduledAt={scheduledAt} siteAllowed={controlled && status.at === rock.id} onHire={onHire} />}
    <Text style={s.label}>At this site · {units.length}</Text>
    {units.length === 0 && <Text style={s.detail}>No specialists at this site.</Text>}
    {units.map(unit => {
      const entry = SPECIALISTS[unit.kind];
      const next = promotion(unit.kind);
      const owned = unit.owner === owner;
      const checked = selected.includes(unit.id);
      const canLoad = game.version === 2 && !game.winner && !game.draw && !game.eliminated.includes(owner) && controlled && owned && !unit.captive && selectionEnabled;
      return <View key={unit.id} style={[s.card, checked && s.selected]}>
        <View style={s.between}><View style={s.identity}><SpecialistIcon kind={unit.kind} /><Text style={s.name}>{entry.name}</Text></View><Text style={s.cost}>{unit.captive ? 'Captive' : owned ? 'Your unit' : 'Foreign unit'}</Text></View>
        {mode !== 'cargo' && <><Text style={s.reference}>{entry.reference}</Text>
        <Text style={s.detail}>{unit.captive ? 'Captive units have no abilities and cannot be loaded.' : entry.description}</Text></>}
        {!unit.captive && owned && <Pressable accessibilityRole="checkbox" accessibilityLabel={`Load ${entry.name} onto the next hauler`} accessibilityState={{ checked, disabled: !canLoad }} disabled={!canLoad} onPress={() => onSelect(checked ? selected.filter(id => id !== unit.id) : [...selected, unit.id])} style={[s.button, checked && s.selected, !canLoad && s.disabled]}>
          <Text style={s.buttonText}>{checked ? '☑ Unload from next hauler' : '☐ Load onto next hauler'}</Text>
        </Pressable>}
        {mode !== 'cargo' && !unit.captive && owned && next && <>
          <Text style={s.detail}>Promote to {SPECIALISTS[next].name}: {SPECIALISTS[next].description}</Text>
          <Action label={label('Promote · 1 credit')} accessibilityLabel={label(`Promote ${entry.name} to ${SPECIALISTS[next].name} for 1 credit`)} disabled={!canPromote || !controlled} onPress={() => onPromote(unit.id)} />
        </>}
        {mode !== 'cargo' && unit.captive && controlled && <Action label={label('Release captive')} accessibilityLabel={label(`Release captive ${entry.name}`)} disabled={!active} onPress={() => onRelease(unit.id)} />}
      </View>;
    })}
  </View>;
}

export function RecruitmentOffers({ game, owner, enabled, scheduledAt, siteAllowed = true, onHire }: {
  game: Game | GameView; owner: Faction; enabled: boolean; scheduledAt?: number;
  siteAllowed?: boolean; onHire: (kind: SpecialistKind) => void;
}) {
  const status = recruitmentStatus(game, owner);
  const label = (action: string) => scheduledAt === undefined ? action : `Schedule at ${gameClock(scheduledAt)}: ${action}`;
  const active = enabled && game.version === 2 && !game.winner && !game.draw && !game.eliminated.includes(owner);
  const coreSite = game.rocks.find(site => site.id === status.at && !site.destroyed);
  const canRecruit = active && status.credits > 0 && !!coreSite;
  const minutes = Math.max(0, Math.ceil((status.nextAt - game.hour) * 60));
  const nextIn = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return <><ArtworkImage id="ritual-tech-clash" /><Text style={s.label}>Specialist bay</Text>{scheduledAt !== undefined && <Text style={s.detail}>Schedule specialist actions for {gameClock(scheduledAt)}. Credits, ownership, and unit availability are checked at execution.</Text>}
    <View style={s.between}><Text style={s.name}>{status.credits} time {status.credits === 1 ? 'credit' : 'credits'}</Text><Text style={s.cost}>Next credit in {nextIn}</Text></View>
    <Text style={s.detail}>Next recruitment: {gameClock(status.nextAt)}. Hiring and promotion cost 1 credit.</Text>
    <Text style={s.detail}>{coreSite ? `Recruit at ${coreSite.name}, your current core site.` : 'Move your Intelligence core to a controlled site to hire.'} Docked modules can promote at any controlled site.</Text>
    {'recruitmentUncertain' in game && !!game.recruitmentUncertain && <Text style={s.detail}>A planned hire or promotion consumes the known recruitment offer. Subsequent offers are unknown; return to live time after execution to see new choices.</Text>}
    {status.offers.map(kind => {
      const entry = SPECIALISTS[kind];
      const amount = hireAmount(kind);
      return <View key={kind} style={s.card}>
        <View style={s.between}><View style={s.identity}><SpecialistIcon kind={kind} /><Text style={s.name}>{entry.name}</Text></View><Text style={s.cost}>×{amount}</Text></View>
        <Text style={s.reference}>{entry.reference}</Text>
        <Text style={s.detail}>{entry.description}</Text>
        <Action label={label(`Hire ${amount > 1 ? `${amount} units` : 'unit'} · 1 credit`)} accessibilityLabel={label(`Hire ${amount} ${entry.name} for 1 credit`)} disabled={!canRecruit || !siteAllowed} onPress={() => onHire(kind)} />
      </View>;
    })}</>;
}

function Action({ label, accessibilityLabel, disabled, onPress }: { label: string; accessibilityLabel: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}><Text style={s.buttonText}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  bay: { borderTopWidth: 1, borderTopColor: '#30402e', marginTop: 16, paddingTop: 16, gap: 10 },
  label: { color: '#96ad89', fontSize: 10, letterSpacing: 1.4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: '#d6e2cd', fontSize: 12, flexShrink: 1 },
  cost: { color: '#b8e986', fontSize: 11 },
  reference: { color: '#96ad89', fontSize: 10 },
  detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 },
  card: { padding: 12, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#142117', gap: 7 },
  button: { minHeight: 44, padding: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#15241a' },
  buttonText: { color: '#b8e986', fontSize: 12 },
  selected: { borderColor: '#b8e986' },
  disabled: { opacity: 0.4 },
});
