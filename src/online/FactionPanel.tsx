import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ALLEGIANCES, ALLEGIANCE_IDS, type Allegiance, type FactionStandings } from '../game/factions';
import { SPECIALISTS } from '../game/specialist-catalog';
import type { RequestSession } from './account-auth';
import { factionsApi } from './network';

export function FactionPanel({ session, refreshKey, disabled, onMembership }: {
  session: RequestSession; refreshKey: string; disabled?: boolean; onMembership: (faction: Allegiance | undefined) => void;
}) {
  const [standings, setStandings] = useState<FactionStandings>();
  const [selected, setSelected] = useState<Allegiance>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const saving = useRef(false);
  async function load(faction?: Allegiance) {
    if (faction && saving.current) return;
    if (faction) saving.current = true;
    const request = ++sequence.current;
    setBusy(true); setError('');
    try {
      const next = await factionsApi(session, faction);
      if (sequence.current !== request) return;
      setStandings(next); setSelected(undefined); onMembership(next.faction);
    } catch (error) { if (sequence.current === request) setError((error as Error).message); }
    finally { if (faction) saving.current = false; if (sequence.current === request) setBusy(false); }
  }
  useEffect(() => {
    setStandings(undefined); setSelected(undefined); onMembership(undefined);
    void load();
    return () => { sequence.current++; };
  }, [session.url, session.token, session.accountId, refreshKey]);
  const blocked = disabled || busy;
  return <View style={s.panel}>
    <Text style={s.title}>Faction allegiance</Text>
    {!standings && !error && <Text style={s.detail}>Loading factions…</Text>}
    {standings?.faction ? <><Text style={[s.title, { color: ALLEGIANCES[standings.faction].color }]}>{ALLEGIANCES[standings.faction].name}</Text><Text style={s.detail}>Your permanent faction. {ALLEGIANCES[standings.faction].description}</Text></>
      : standings && (standings.completedGames === 0 ? <Text style={s.detail}>Complete your first online operation to choose a permanent faction. Wins and losses both qualify.</Text>
        : <><Text style={s.detail}>Choose your permanent faction. In faction mode, you start with its extra elite specialist. This choice applies to future operations.</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Choose a faction" style={s.choices}>{ALLEGIANCE_IDS.map(id => <Pressable key={id} accessibilityRole="radio" accessibilityLabel={ALLEGIANCES[id].name} accessibilityState={{ checked: selected === id, disabled: !!blocked }} disabled={blocked} onPress={() => setSelected(id)} style={[s.choice, selected === id && { borderColor: ALLEGIANCES[id].color }]}>
            <Text style={[s.title, { color: ALLEGIANCES[id].color }]}>{ALLEGIANCES[id].name}</Text><Text style={s.detail}>{ALLEGIANCES[id].description}</Text><Text style={s.detail}>{SPECIALISTS[ALLEGIANCES[id].elite].description}</Text>
          </Pressable>)}</View>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!blocked || !selected }} disabled={blocked || !selected} style={[s.button, (blocked || !selected) && s.disabled]} onPress={() => void load(selected)}><Text style={s.buttonText}>Join {selected ? ALLEGIANCES[selected].name : 'a faction'} permanently</Text></Pressable></>)}
    <Text style={s.title}>Faction leaderboard</Text><Text style={s.detail}>Total wins from faction-mode operations on this server. Draws award no wins.</Text>
    {standings?.leaderboard.map((row, index) => <View key={row.faction} style={s.row}><Text style={[s.detail, { flex: 1, color: ALLEGIANCES[row.faction].color }]}>{index + 1}. {ALLEGIANCES[row.faction].name}</Text><Text style={s.title}>{row.wins} {row.wins === 1 ? 'win' : 'wins'}</Text></View>)}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!blocked }} disabled={blocked} style={[s.button, blocked && s.disabled]} onPress={() => void load()}><Text style={s.buttonText}>Refresh faction standings</Text></Pressable>
  </View>;
}
const s = StyleSheet.create({
  panel: { padding: 16, gap: 12, backgroundColor: '#102127', borderWidth: 1, borderColor: '#304b52', borderRadius: 12 },
  title: { color: '#e5eadc', fontSize: 16, fontWeight: '600' }, detail: { color: '#b4c7ca', fontSize: 14, lineHeight: 21 },
  choices: { gap: 10 }, choice: { borderWidth: 2, borderColor: '#304b52', borderRadius: 8, padding: 12, gap: 6, minHeight: 44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, button: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#709665', borderRadius: 8 },
  buttonText: { color: '#b8e986', fontSize: 14, fontWeight: '600' }, disabled: { opacity: 0.4 }, error: { color: '#ffbb91' },
});
