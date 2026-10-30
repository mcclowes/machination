import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { councilBallots, waiverActive, type CouncilAction, type CouncilChoice } from '../game/compact';
import { COMPACT_POLICIES, COMPACT_POLICY_IDS, COUNCIL_WAIVER_HOURS } from '../game/compact-policies';
import { FACTIONS, type Faction } from '../game/players';
import type { GameView } from '../game/visibility';

type Props = { game: Pick<GameView, 'hour' | 'epoch' | 'compact' | 'eliminated' | 'winner' | 'draw'>; owner: Faction; enabled: boolean; onCommand: (action: CouncilAction) => void; notice?: string };
export function CouncilPanel({ game, owner, enabled, onCommand, notice }: Props) {
  const [charter, setCharter] = useState(false);
  const [nominating, setNominating] = useState(false);
  const [history, setHistory] = useState(false);
  const compact = game.compact;
  if (!compact) return null;
  const motion = compact.motion;
  const canAct = enabled && !!motion && !game.winner && !game.draw && !game.eliminated.includes(owner) && game.hour < motion.closesAt;
  const ballots = motion ? councilBallots(motion) : {};
  const date = (hour: number) => new Date(game.epoch + hour * 3_600_000).toLocaleString();
  return <View style={s.panel}>
    <Text accessibilityRole="header" style={s.title}>The Belt compact</Text>
    <Text style={s.text}>Corporate uplinks are silent. Your council holds the keys to the inherited conventions. Navigation, fabrication, and weapons systems enforce its decisions.</Text>
    {!!notice && <Text style={s.detail}>{notice}</Text>}
    {motion ? <View style={s.section}>
      <Text accessibilityRole="header" style={s.heading}>Motion {motion.id}: {COMPACT_POLICIES[motion.policy].motion}</Text>
      <Text style={s.text}>{COMPACT_POLICIES[motion.policy].reason}</Text>
      <Text style={s.text}>If passed: {COMPACT_POLICIES[motion.policy].effect}</Text>
      <Text style={s.detail}>{motion.proposer ? `Nominated by ${FACTIONS[motion.proposer].name}` : 'Standing charter motion'} · {Math.floor(motion.electorate.length / 2) + 1} yes votes required. Closes {date(motion.closesAt)} ({Math.max(0, motion.closesAt - game.hour).toFixed(1)}h). Permission then lasts {COUNCIL_WAIVER_HOURS} hours.</Text>
      {motion.electorate.map(f => <Text key={f} style={s.text}>{FACTIONS[f].name}: {ballots[f] ?? 'not voted'}{game.eliminated.includes(f) ? ' · eliminated' : ''}</Text>)}
      <View style={s.row}>{(['yes', 'no', 'abstain'] as CouncilChoice[]).map(choice => <Button key={choice} label={choice === 'yes' ? 'Vote yes' : choice === 'no' ? 'Vote no' : 'Abstain'} selected={ballots[owner] === choice} disabled={!canAct || !motion.electorate.includes(owner)} onPress={() => onCommand({ action: 'vote', motionId: motion.id, choice })} />)}</View>
      <Text style={s.detail}>Positions are public and can change until closing. The wording and electorate stay fixed. Abstention and absence do not count toward a majority.</Text>
      {motion.changes.length > 0 && <Text style={s.detail}>Latest change: {FACTIONS[motion.changes.at(-1)!.owner].name} voted {motion.changes.at(-1)!.choice} at hour {motion.changes.at(-1)!.hour.toFixed(2)}.</Text>}
      <Button label={nominating ? 'Hide nominations' : 'Nominate a later motion'} disabled={!canAct} onPress={() => setNominating(!nominating)} />
      {Object.entries(compact.proposals).map(([f, policy]) => <Text key={f} style={s.detail}>{FACTIONS[f as Faction].name} nominates: {COMPACT_POLICIES[policy!].motion}.</Text>)}
      {nominating && <View style={s.section}><Text style={s.detail}>One public nomination per intelligence. Agenda priority rotates each day. Without nominations, the charter supplies a convention.</Text>{COMPACT_POLICY_IDS.map(policy => <Button key={policy} label={`Nominate: ${COMPACT_POLICIES[policy].name}`} selected={compact.proposals[owner] === policy} disabled={!canAct} onPress={() => onCommand({ action: 'nominate', motionId: motion.id, policy })} />)}{compact.proposals[owner] && <Button label="Withdraw your nomination" disabled={!canAct} onPress={() => onCommand({ action: 'nominate', motionId: motion.id, policy: null })} />}</View>}
    </View> : <Text style={s.detail}>The operation has ended. The council record remains available.</Text>}
    {COMPACT_POLICY_IDS.filter(policy => waiverActive(game, policy)).map(policy => <View key={policy} style={s.waiver}><Text accessibilityRole="header" style={s.heading}>Waived: {COMPACT_POLICIES[policy].name}</Text><Text style={s.text}>{COMPACT_POLICIES[policy].effect}</Text><Text style={s.detail}>Convention resumes {date(compact.waivers[policy]!.expiresAt)}.</Text></View>)}
    <Button label={charter ? 'Close conventions' : 'Read the six conventions'} onPress={() => setCharter(!charter)} />
    {charter && COMPACT_POLICY_IDS.map(policy => <View key={policy} style={s.section}><Text style={s.heading}>{COMPACT_POLICIES[policy].name} · {waiverActive(game, policy) ? 'waived' : 'in force'}</Text><Text style={s.text}>{COMPACT_POLICIES[policy].reason}</Text><Text style={s.detail}>{COMPACT_POLICIES[policy].restriction}</Text><Text style={s.detail}>Waiver: {COMPACT_POLICIES[policy].effect}</Text></View>)}
    <Button label={history ? 'Close council record' : `Council record · ${compact.history.length} decisions`} onPress={() => setHistory(!history)} />
    {history && <View style={s.section}>{compact.history.length === 0 && <Text style={s.detail}>No decisions yet.</Text>}{[...compact.history].reverse().map(m => { const votes = councilBallots(m); return <View key={m.id} style={s.section}><Text accessibilityRole="header" style={s.heading}>Motion {m.id} · {m.result}: {COMPACT_POLICIES[m.policy].motion}</Text><Text style={s.detail}>{date(m.resolvedAt)}{m.result === 'passed' ? ` · waiver ended/ends ${date(m.resolvedAt + COUNCIL_WAIVER_HOURS)}` : ''}</Text>{m.electorate.map(f => <Text key={f} style={s.detail}>{FACTIONS[f].name}: {votes[f] ?? 'not voted'}</Text>)}{m.changes.map((c, i) => <Text key={i} style={s.detail}>Hour {c.hour.toFixed(2)} · {FACTIONS[c.owner].name} → {c.choice}</Text>)}</View>; })}</View>}
  </View>;
}
function Button({ label, onPress, disabled = false, selected }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return <Pressable accessibilityRole="button" aria-pressed={selected} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={[s.button, selected && s.selected, disabled && s.disabled]}><Text style={s.action}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: { padding: 16, gap: 12, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#101b13' }, section: { gap: 8 }, title: { color: '#e5eadc', fontSize: 20 }, heading: { color: '#d6e2cd', fontSize: 14 }, text: { color: '#b8c9af', fontSize: 13, lineHeight: 20 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 19 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 44, padding: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#40563a' }, action: { color: '#b8e986', fontSize: 13 }, selected: { backgroundColor: '#263c20', borderColor: '#b8e986' }, disabled: { opacity: 0.4 }, waiver: { padding: 12, gap: 8, borderLeftWidth: 3, borderColor: '#b8e986' },
});
