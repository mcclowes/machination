import { resourceName } from '../content/terminology';
/**
 * ---
 * purpose: Compact ranked intelligence reports, observed military totals, and live or scheduled funding actions.
 * related:
 *   - ../game/intelligence.ts - visibility-aware scoreboard calculations
 * ---
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { intelligenceReport } from '../game/intelligence';
import { FACTIONS, type Faction } from '../game/players';
import { FUNDING_LEAD, FUNDING_OUTPUT, FUNDING_POWER } from '../game/funding';
import { teamMembers } from '../game/teams';
import { gameClock } from '../game/time-machine';
import type { GameView } from '../game/visibility';
import { FactionEmblem, usePlayerRoster } from './PlayerIdentity';

type Props = { game: GameView; owner: Faction; enabled: boolean; forecast?: boolean; scheduledAt?: number; onChange: (to: Faction, enabled: boolean) => void };
type Column = 'Drones' | 'Sites' | 'Funding';
const number = (value: number | undefined) => value === undefined ? '?' : Number(value.toFixed(1)).toLocaleString('en-US');
const duration = (hours: number) => hours >= 48 ? `${number(hours / 24)} days` : hours >= 1 ? `${number(hours)} hours` : `${Math.max(1, Math.ceil(hours * 60))} min`;
const medals = ['#d8b65c', '#b8c7cd', '#c78b61'];

export function IntelligenceReports({ game, owner, enabled, forecast, scheduledAt, onChange }: Props) {
  const [column, setColumn] = useState<Column>('Drones');
  const appearance = usePlayerRoster();
  const report = intelligenceReport(game, owner);
  const domination = game.rules?.mode === 'domination';
  const pulse = game.rules?.mode === 'pulse';
  const ownCargo = report.rows.find(r => r.faction === owner)?.cargo;
  const active = enabled && game.version === 2 && !game.winner && !game.draw && !game.eliminated.includes(owner);
  const projection = report.projection;
  const columns: Column[] = domination || game.version !== 2 ? ['Drones', 'Sites'] : ['Drones', 'Sites', 'Funding'];
  const selected = columns.includes(column) ? column : 'Drones';
  return <View testID="intelligence-reports" style={s.panel}>
    <View style={s.heading}><Text accessibilityRole="header" style={s.title}>Intelligence reports</Text><Text style={s.kicker}>{forecast ? 'Projected standings' : 'Operation standings'}</Text></View>
    <View style={s.banner}>
      {game.draw ? <Text style={s.bannerTitle}>{forecast ? 'Projected draw' : 'Operation drawn'}</Text> : game.winner ? <Text style={s.bannerTitle}>{forecast ? 'Projected winner: ' : 'Winner: '}{game.rules?.teams ? `Team ${report.rows.find(r => r.faction === game.winner)?.team}` : appearance(game.winner).name}</Text>
        : projection ? <><Text style={s.kicker}>At current mining rates</Text><Text style={s.bannerTitle}>{projection.team ? `Team ${projection.team}` : appearance(projection.faction).name} could win in {duration(projection.hours)}</Text></>
          : <Text style={s.detail}>{pulse ? 'Eliminate rival Kings to win. Pulse material funds your operation.' : domination ? `Control ${report.target} sites to win.` : 'Winner estimate unavailable without complete mining intelligence or a clear leader.'}</Text>}
      {projection && <Text style={s.detail}>Assumes unchanged rates. Battles, disabled mines, and exhausted reserves can change the finish.</Text>}
    </View>
    <Text style={s.detail}>{report.scoreLabel}{report.target !== undefined ? ` · goal ${report.target}` : ' · no score target'}{game.rules?.teams ? ' · ranked by team total' : ` · ranked by ${report.scoreLabel.toLowerCase()}`}</Text>
    <View style={s.tableHeader}><Text style={[s.kicker, s.scoreHeading]}>{report.scoreLabel}</Text><View accessibilityRole="tablist" style={s.tabs}>{columns.map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tab} accessibilityState={{ selected: selected === tab }} onPress={() => setColumn(tab)} style={[s.tab, selected === tab && s.selectedTab]}><Text style={[s.tabLabel, selected === tab && s.active]}>{tab}</Text></Pressable>)}</View></View>
    {report.rows.map(row => {
      const identity = appearance(row.faction);
      const outgoing = game.funding?.some(f => f.from === owner && f.to === row.faction) ?? false;
      const incoming = game.funding?.some(f => f.from === row.faction && f.to === owner) ?? false;
      const eligible = row.faction !== owner && !row.eliminated && ownCargo !== undefined && row.cargo !== undefined && ownCargo - row.cargo >= FUNDING_LEAD;
      const disabled = !active || !outgoing && !eligible;
      const action = `${outgoing ? 'Withdraw funding from' : 'Fund'} ${FACTIONS[row.faction].name}`;
      const members = report.rows.filter(r => teamMembers(game, row.faction).includes(r.faction));
      const income = members.every(r => r.income !== undefined) ? members.reduce((n, r) => n + r.income!, 0) : undefined;
      return <View testID={`intelligence-row-${row.faction}`} key={row.faction} style={[s.row, row.eliminated && s.eliminated]}>
        <View style={s.scoreCell}><Text accessibilityLabel={row.eliminated ? 'Eliminated' : row.rank ? `Rank ${row.rank}` : 'Rank unknown'} style={[s.rank, row.rank && row.rank <= 3 ? { color: medals[row.rank - 1] } : undefined]}>{row.rank ?? (row.eliminated ? '–' : '?')}</Text><View style={s.scoreCopy}><Text style={s.score}>{row.score === undefined ? '?' : Math.floor(row.score)}</Text>{!domination && <Text style={s.income}>{income === undefined ? '?/day' : `+${number(income)}/day`}</Text>}</View></View>
        <View style={[s.player, { borderLeftColor: identity.color, backgroundColor: `${identity.color}12` }]}>
          <View style={s.playerHeading}><FactionEmblem faction={row.faction} size={16} /><Text numberOfLines={1} style={[s.name, { color: identity.color }]}>{identity.name}</Text>{row.faction === owner && <Text style={s.you}>You</Text>}</View>
          {(row.team || row.eliminated) && <Text style={s.detail}>{[row.team ? `Team ${row.team}` : '', row.eliminated ? 'Eliminated' : ''].filter(Boolean).join(' · ')}</Text>}
          {selected === 'Drones' && <><Text style={s.value}>{row.observed ? `${number(row.drones)} observed` : `${number(row.drones)} / ${number(row.capacity)} drones`}</Text><Text style={s.detail}>{row.production === undefined ? 'Capacity and production unknown' : `+${number(row.production)}/day at current rate`}</Text></>}
          {selected === 'Sites' && <><Text style={s.value}>{number(row.sites)} sites</Text><Text style={s.detail}>{number(row.mines)} mines · {row.typesUnknown ? '≥' : ''}{row.factories} factories · {row.typesUnknown ? '≥' : ''}{row.generators} reactors</Text></>}
          {selected === 'Funding' && <><Text style={s.value}>{row.sponsors} {row.sponsors === 1 ? 'sponsor' : 'sponsors'}{incoming ? ' · funding you' : ''}</Text>{game.rules?.teams && <Text style={s.detail}>{number(row.cargo)} personal {resourceName(game.rules?.mode)}</Text>}{row.faction !== owner && <Pressable accessibilityRole="button" accessibilityLabel={scheduledAt === undefined ? action : `Schedule at ${gameClock(scheduledAt)}: ${action}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onChange(row.faction, !outgoing)} style={[s.fund, disabled && s.disabled]}><Text style={s.fundLabel}>{outgoing ? 'Withdraw funding' : eligible ? 'Fund · free' : `Needs ${FUNDING_LEAD} ${resourceName(game.rules?.mode)} lead`}</Text></Pressable>}</>}
          {report.target !== undefined && row.score !== undefined && <View style={s.track}><View style={{ height: 2, width: `${Math.min(100, Math.max(0, row.score / report.target * 100))}%`, backgroundColor: identity.color }} /></View>}
        </View>
      </View>;
    })}
    {selected === 'Drones' && <Text style={s.note}>Rival drones are observed totals; unseen forces are excluded. Daily rates use current bonuses and capacity, including opening acceleration.</Text>}
    {selected === 'Sites' && <Text style={s.note}>Site ownership and mines are public in current operations. ≥ marks incomplete type intelligence.</Text>}
    {selected === 'Funding' && <><Text style={s.note}>A {FUNDING_LEAD} {resourceName(game.rules?.mode)} lead lets you fund another intelligence for free. Each sponsor adds {FUNDING_POWER} drone capacity and {FUNDING_OUTPUT} drones per factory cycle. Other sponsors stay anonymous.</Text>{scheduledAt !== undefined && <Text style={s.note}>Funding changes are scheduled for {gameClock(scheduledAt)}. Eligibility is checked at execution.</Text>}</>}
    {(game.forecastUncertain || game.fundingUncertain) && <Text style={s.note}>Projected from observed intelligence. Unseen activity can change these standings and rates.</Text>}
  </View>;
}

const s = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: '#34474a', backgroundColor: '#101c23', padding: 12, gap: 10 },
  heading: { gap: 3 }, title: { color: '#e5eadc', fontSize: 19, fontWeight: '600' }, kicker: { color: '#8eaaa9', fontSize: 10, lineHeight: 15 },
  banner: { backgroundColor: '#1b302c', borderLeftWidth: 2, borderLeftColor: '#b8e986', padding: 10, gap: 4 }, bannerTitle: { color: '#dcecc7', fontSize: 14, lineHeight: 20 },
  tableHeader: { flexDirection: 'row', alignItems: 'center' }, scoreHeading: { width: 70 }, tabs: { flex: 1, flexDirection: 'row' },
  tab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: '#30454c' }, selectedTab: { backgroundColor: '#263830', borderBottomColor: '#b8e986' }, tabLabel: { color: '#9aabaa', fontSize: 11 }, active: { color: '#d9efbd' },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 6 }, eliminated: { opacity: 0.55 },
  scoreCell: { width: 64, flexDirection: 'row', alignItems: 'center', gap: 3 }, rank: { width: 17, color: '#839896', fontSize: 19, fontWeight: '600', textAlign: 'center' }, scoreCopy: { flex: 1, alignItems: 'flex-end', gap: 3 }, score: { color: '#e5eadc', fontSize: 20, fontVariant: ['tabular-nums'] }, income: { color: '#a7bf9e', fontSize: 9 },
  player: { flex: 1, minWidth: 0, borderLeftWidth: 3, padding: 8, gap: 4 }, playerHeading: { flexDirection: 'row', alignItems: 'center', gap: 5 }, name: { flex: 1, fontSize: 13, fontWeight: '600' }, you: { fontSize: 9, color: '#d9efbd' },
  value: { color: '#d6dfd0', fontSize: 12, fontVariant: ['tabular-nums'] }, detail: { color: '#9bb0a7', fontSize: 10, lineHeight: 15 }, note: { color: '#92a59c', fontSize: 11, lineHeight: 17 },
  track: { height: 2, backgroundColor: '#2c3d3b', marginTop: 3 }, fund: { minHeight: 44, borderWidth: 1, borderColor: '#4a6441', padding: 6, justifyContent: 'center', alignItems: 'center' }, fundLabel: { color: '#c9e6a8', fontSize: 11 }, disabled: { opacity: 0.45 },
});
