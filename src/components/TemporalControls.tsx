/** Shared docked-specialist actions and visible site clock costs. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Rock } from '../game/simulation';
import type { Specialist } from '../game/specialists';
import { inStasis, temporalEnabled } from '../game/temporal';
import type { GameRules } from '../game/rules';
import { gameClock } from '../game/time-machine';

export function TemporalSiteStatus({ site, hour }: { site: Rock; hour: number }) {
  return <View>
    {inStasis({ hour }, site) && <Text style={s.detail}>Anchor stasis until {gameClock(site.stasisUntil!)}. Arrivals and local clocks wait.</Text>}
    {site.overclock && <Text style={s.detail}>{site.overclock.repaying ? `No production until ${gameClock(site.overclock.debtUntil)}.` : `Double production until ${gameClock(site.overclock.boostUntil)}, then no production until ${gameClock(site.overclock.debtUntil)}.`}</Text>}
  </View>;
}
export function TemporalSpecialistControl({ game, site, unit, enabled, scheduledAt, onActivate }: {
  game: { hour: number; rules?: Pick<GameRules, 'mechanicsVersion'> }; site?: Rock; unit: Specialist; enabled: boolean; scheduledAt?: number; onActivate?: (id: string) => void;
}) {
  if (!onActivate || !temporalEnabled(game) || !['anchor', 'overclock'].includes(unit.kind) || unit.captive) return null;
  const cooldown = (unit.temporalReadyAt ?? 0) > game.hour;
  const ready = enabled && !!site && !inStasis(game, site) && !cooldown && (unit.kind === 'anchor' ? (site.anchorReadyAt ?? 0) <= game.hour : site.kind === 'factory' && !site.overclock);
  const action = unit.kind === 'anchor' ? 'Activate stasis · 2h' : 'Overclock · 4h boost, 4h repayment';
  const label = scheduledAt === undefined ? action : `Schedule at ${gameClock(scheduledAt)}: ${action}`;
  return <View>
    {cooldown && <Text style={s.detail}>Ready at {gameClock(unit.temporalReadyAt!)}.</Text>}
    {site && unit.kind === 'anchor' && (site.anchorReadyAt ?? 0) > game.hour && <Text style={s.detail}>Site ready for stasis at {gameClock(site.anchorReadyAt!)}.</Text>}
    {!site && <Text style={s.detail}>Dock at a controlled site to activate.</Text>}
    {site && unit.kind === 'overclock' && site.kind !== 'factory' && <Text style={s.detail}>Overclock requires a factory.</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={() => onActivate(unit.id)} style={[s.button, !ready && s.disabled]}><Text style={s.action}>{label}</Text></Pressable>
  </View>;
}
const s = StyleSheet.create({ detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, action: { color: '#b8e986', fontSize: 12 },
  button: { minHeight: 44, padding: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#15241a' }, disabled: { opacity: 0.4 } });
