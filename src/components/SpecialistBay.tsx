/**
 * ---
 * purpose: Shared specialist recruitment, promotion, captive release, and explicit transport selection.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPECIALISTS, hireAmount, promotion, type SpecialistKind } from '../game/specialist-catalog';
import { recruitmentStatus } from '../game/specialists';
import type { Faction, Game, Rock } from '../game/simulation';
import type { GameView } from '../game/visibility';

export type SpecialistBayProps = {
  game: Game | GameView; rock: Rock; owner: Faction; enabled: boolean;
  selectionEnabled?: boolean; selected: string[]; onSelect: (ids: string[]) => void;
  onHire: (kind: SpecialistKind) => void; onPromote: (id: string) => void; onRelease: (id: string) => void;
};

export function SpecialistBay({ game, rock, owner, enabled, selectionEnabled = true, selected, onSelect, onHire, onPromote, onRelease }: SpecialistBayProps) {
  const status = recruitmentStatus(game, owner);
  const controlled = rock.owner === owner && !rock.destroyed;
  const active = enabled && game.version === 2 && !game.winner && !game.eliminated.includes(owner);
  const canRecruit = active && !!status.at && status.credits > 0;
  const coreSite = game.rocks.find(site => site.id === status.at);
  const units = rock.specialists ?? [];
  const minutes = Math.max(0, Math.ceil((status.nextAt - game.hour) * 60));
  const nextIn = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return <View style={s.bay}>
    <Text style={s.label}>Specialist bay</Text>
    <View style={s.between}><Text style={s.name}>{status.credits} time {status.credits === 1 ? 'credit' : 'credits'}</Text><Text style={s.cost}>Next credit in {nextIn}</Text></View>
    <Text style={s.detail}>Next recruitment: hour {status.nextAt}. Hiring and promotion cost 1 credit.</Text>
    <Text style={s.detail}>{coreSite ? `Recruit at ${coreSite.name}, your current core site. Keep the Intelligence core at a controlled site to hire or promote.` : 'Move your Intelligence core to a controlled site to hire or promote.'}</Text>
    {status.offers.map(kind => {
      const entry = SPECIALISTS[kind];
      const amount = hireAmount(kind);
      return <View key={kind} style={s.card}>
        <View style={s.between}><Text style={s.name}>{entry.name}</Text><Text style={s.cost}>×{amount}</Text></View>
        <Text style={s.reference}>{entry.reference}</Text>
        <Text style={s.detail}>{entry.description}</Text>
        <Action label={`Hire ${amount > 1 ? `${amount} units` : 'unit'} · 1 credit`} accessibilityLabel={`Hire ${amount} ${entry.name} for 1 credit`} disabled={!canRecruit || !controlled || status.at !== rock.id} onPress={() => onHire(kind)} />
      </View>;
    })}
    <Text style={s.label}>At this site · {units.length}</Text>
    {units.length === 0 && <Text style={s.detail}>No specialists at this site.</Text>}
    {units.map(unit => {
      const entry = SPECIALISTS[unit.kind];
      const next = promotion(unit.kind);
      const owned = unit.owner === owner;
      const checked = selected.includes(unit.id);
      const canLoad = active && controlled && owned && !unit.captive && selectionEnabled;
      return <View key={unit.id} style={[s.card, checked && s.selected]}>
        <View style={s.between}><Text style={s.name}>{entry.name}</Text><Text style={s.cost}>{unit.captive ? 'Captive' : owned ? 'Your unit' : 'Foreign unit'}</Text></View>
        <Text style={s.reference}>{entry.reference}</Text>
        <Text style={s.detail}>{unit.captive ? 'Captive units have no abilities and cannot be loaded.' : entry.description}</Text>
        {!unit.captive && owned && <Pressable accessibilityRole="checkbox" accessibilityLabel={`Load ${entry.name} onto the next hauler`} accessibilityState={{ checked, disabled: !canLoad }} disabled={!canLoad} onPress={() => onSelect(checked ? selected.filter(id => id !== unit.id) : [...selected, unit.id])} style={[s.button, checked && s.selected, !canLoad && s.disabled]}>
          <Text style={s.buttonText}>{checked ? '☑ Unload from next hauler' : '☐ Load onto next hauler'}</Text>
        </Pressable>}
        {!unit.captive && owned && next && <>
          <Text style={s.detail}>Promote to {SPECIALISTS[next].name}: {SPECIALISTS[next].description}</Text>
          <Action label={`Promote · 1 credit`} accessibilityLabel={`Promote ${entry.name} to ${SPECIALISTS[next].name} for 1 credit`} disabled={!canRecruit || !controlled} onPress={() => onPromote(unit.id)} />
        </>}
        {unit.captive && controlled && <Action label="Release captive" accessibilityLabel={`Release captive ${entry.name}`} disabled={!active} onPress={() => onRelease(unit.id)} />}
      </View>;
    })}
  </View>;
}

function Action({ label, accessibilityLabel, disabled, onPress }: { label: string; accessibilityLabel: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}><Text style={s.buttonText}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  bay: { borderTopWidth: 1, borderTopColor: '#30402e', marginTop: 16, paddingTop: 16, gap: 10 },
  label: { color: '#96ad89', fontSize: 10, letterSpacing: 1.4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
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
