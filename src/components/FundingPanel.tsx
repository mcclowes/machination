/**
 * ---
 * purpose: Cargo standings and diplomatic support controls without disclosing other sponsors' identities.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FACTIONS, type Faction, type Game } from '../game/simulation';
import type { GameView } from '../game/visibility';
import { FUNDING_LEAD, FUNDING_OUTPUT, FUNDING_POWER, fundingCount } from '../game/funding';

type Props = { game: Game | GameView; owner: Faction; enabled: boolean; onChange: (to: Faction, enabled: boolean) => void };
export function FundingPanel({ game, owner, enabled, onChange }: Props) {
  if (game.version !== 2) return null;
  const standings = 'standings' in game ? game.standings : undefined;
  const cargo = (f: Faction) => standings?.[f].cargo ?? game.cargo[f];
  const active = enabled && game.version === 2 && !game.winner && !game.draw && !game.eliminated.includes(owner);
  return <View style={s.panel}><Text style={s.title}>Cargo standings and funding</Text><Text style={s.detail}>A lead of {FUNDING_LEAD} cargo lets you support another intelligence for free. Each sponsor adds {FUNDING_POWER} power and {FUNDING_OUTPUT} drones per factory cycle. Support ends when the lead drops below {FUNDING_LEAD}.</Text>
    {(Object.keys(FACTIONS) as Faction[]).map(f => {
      const outgoing = game.funding?.some(edge => edge.from === owner && edge.to === f) ?? false;
      const sponsors = standings?.[f].funders ?? fundingCount(game, f);
      const eligible = f !== owner && !game.eliminated.includes(f) && cargo(owner) !== undefined && cargo(f) !== undefined && cargo(owner)! - cargo(f)! >= FUNDING_LEAD;
      const incoming = game.funding?.filter(edge => edge.to === f && edge.from === owner || edge.to === owner && edge.from === f) ?? [];
      return <View key={f} style={s.entry}><Text style={[s.name, { color: FACTIONS[f].color }]}>{FACTIONS[f].name}{f === owner ? ' · you' : ''}{game.eliminated.includes(f) ? ' · eliminated' : ''}</Text>
        <Text style={s.detail}>{cargo(f) === undefined ? 'Cargo unknown' : `${Math.floor(cargo(f)!)} cargo`} · {sponsors} {sponsors === 1 ? 'sponsor' : 'sponsors'}</Text>
        {incoming.some(edge => edge.to === owner) && <Text style={s.detail}>Funding your intelligence</Text>}
        {f !== owner && <Pressable accessibilityRole="button" accessibilityLabel={`${outgoing ? 'Withdraw funding from' : 'Fund'} ${FACTIONS[f].name}`} accessibilityState={{ disabled: !active || !outgoing && !eligible }} disabled={!active || !outgoing && !eligible} onPress={() => onChange(f, !outgoing)} style={[s.button, (!active || !outgoing && !eligible) && s.disabled]}><Text style={s.action}>{outgoing ? 'Withdraw funding' : eligible ? 'Fund intelligence · free' : `Requires a ${FUNDING_LEAD}-cargo lead`}</Text></Pressable>}
      </View>;
    })}
    {'fundingUncertain' in game && game.fundingUncertain && <Text style={s.detail}>Private sponsors and unseen mining can change future funding. Projected production may differ.</Text>}
  </View>;
}
const s = StyleSheet.create({
  panel: { padding: 16, borderWidth: 1, borderColor: '#30402e', backgroundColor: '#101b13', gap: 10 }, title: { color: '#e5eadc', fontSize: 16 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 19 }, name: { fontSize: 14 }, entry: { gap: 8, paddingVertical: 12, borderTopWidth: 1, borderColor: '#30402e' }, button: { minHeight: 44, padding: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#19271a' }, action: { color: '#b8e986', fontSize: 12 }, disabled: { opacity: 0.4 },
});
