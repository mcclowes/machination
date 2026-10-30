/**
 * ---
 * purpose: Contextual industry, extraction, and defense controls for a controlled rock.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { maximumShield } from '../game/economy';
import { gameClock } from '../game/time-machine';
import type { Rock } from '../game/simulation';
import { openingRate, type OpeningWorld } from '../game/opening-clock';

export function siteDescription(rock: Pick<Rock, 'kind' | 'coreOf' | 'destroyed' | 'drift'>, world?: OpeningWorld & { hour: number }): string {
  if (rock.destroyed) return 'Destroyed site';
  const type = { core: 'Core · +4 drones / h', reactor: 'Reactor · +4 drones / h', mine: 'Extraction site', factory: world && openingRate(world, world.hour) > 1 ? 'Factory · base 6 drones / 5h 20m' : 'Factory · 6 drones / 8h', generator: 'Generator · +50 power capacity' }[rock.kind];
  return `${rock.drift ? 'Drifting asteroid base · ' : ''}${type}${rock.coreOf && rock.kind !== 'core' ? ' · intelligence core' : ''}`;
}
export function SiteControls({ rock, cost, enabled, minesAllowed = true, scheduledAt, onMine, onShields }: { rock: Rock; cost: number; enabled: boolean; minesAllowed?: boolean; scheduledAt?: number; onMine: () => void; onShields: () => void }) {
  if (rock.destroyed) return <View style={s.section}><Text style={s.detail}>Sonar remains. This wreck has no production, power, mining, or shields and cannot receive haulers.</Text></View>;
  const label = (action: string) => scheduledAt === undefined ? action : `Schedule at ${gameClock(scheduledAt)}: ${action}`;
  return <View style={s.section}>
    {rock.drift && <Text style={s.detail}>This small asteroid installation drifts 12 chart units per day, carrying its garrison and sensors. Its dotted chart track shows the next 24 hours. Use the Time Machine to inspect its future position.</Text>}
    {scheduledAt !== undefined && <Text style={s.detail}>Schedule site actions for {gameClock(scheduledAt)}. Forecast eligibility is provisional; requirements are checked at execution.</Text>}
    <Text style={s.detail}>Shields: {rock.shield ?? 0} / {maximumShield(rock)} · {rock.shieldsDisabled ? 'disabled' : 'enabled'}</Text>
    <Control label={label(rock.shieldsDisabled ? 'Enable shields' : 'Disable shields')} disabled={!enabled} onPress={onShields} />
    {rock.pulseDisabled && <Text style={s.detail}>Extraction disabled by King’s Pulse.</Text>}
    {rock.kind === 'mine' && !rock.pulseDisabled && rock.miningInterval !== undefined && <Text style={s.detail}>One cargo every {rock.miningInterval.toFixed(2)}h · next payout {gameClock(rock.miningAt!)}. Expansion increases the rate.</Text>}
    {!minesAllowed && <Text style={s.detail}>No mines in domination operations.</Text>}
    {minesAllowed && rock.kind !== 'mine' && <><Text style={s.detail}>Drilling replaces this {rock.kind}. {rock.kind === 'generator' ? 'Power capacity falls by 50.' : 'Drone production stops.'} A mine yields one cargo per controlled rock per day, paid throughout the day.</Text><Control label={label(`Drill mine · ${cost} drones`)} disabled={!enabled || rock.drones < cost} onPress={onMine} /></>}
  </View>;
}
function Control({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.text}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({ section: { gap: 10, marginTop: 16 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, button: { minHeight: 44, padding: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#15241a' }, text: { color: '#d6e2cd', fontSize: 12 } });
