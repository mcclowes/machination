import { resourceName, siteKindLabel } from '../content/terminology';
/**
 * ---
 * purpose: Contextual industry, extraction, and defense controls for a controlled rock.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { maximumShield } from '../game/economy';
import { hasReserves, reserveDescription } from '../game/depletion';
import { gameClock } from '../game/time-machine';
import type { GameOptions } from '../game/rules';
import type { Rock } from '../game/simulation';
import { openingRate, type OpeningWorld } from '../game/opening-clock';

export function siteDescription(rock: Pick<Rock, 'kind' | 'coreOf' | 'destroyed' | 'drift' | 'reserves'>, world?: OpeningWorld & { hour: number }): string {
  if (rock.destroyed) return 'Destroyed site';
  if (!hasReserves(rock)) return `Exhausted ${siteKindLabel(rock.kind).toLowerCase()}${rock.coreOf ? ' · intelligence core' : ''}`;
  const type = { core: 'Core · +4 drones / h', reactor: 'Legacy reactor · +4 drones / h', mine: 'Mine', factory: world && openingRate(world, world.hour) > 1 ? 'Factory · base 6 drones / 5h 20m' : 'Factory · 6 drones / 8h', generator: 'Reactor · +50 drone capacity' }[rock.kind];
  return `${rock.drift ? 'Drifting asteroid base · ' : ''}${type}${rock.coreOf && rock.kind !== 'core' ? ' · intelligence core' : ''}`;
}
export function SiteControls({ rock, cost, enabled, minesAllowed = true, mode, scheduledAt, onMine, onShields }: { rock: Rock; cost: number; enabled: boolean; minesAllowed?: boolean; mode?: GameOptions['mode']; scheduledAt?: number; onMine: () => void; onShields: () => void }) {
  const resource = resourceName(mode);
  if (rock.destroyed) return <View style={s.section}><Text style={s.detail}>Sensor coverage remains. This wreck has no production, power, mining, or shields and cannot receive haulers.</Text></View>;
  const label = (action: string) => scheduledAt === undefined ? action : `Schedule at ${gameClock(scheduledAt)}: ${action}`;
  return <View style={s.section}>
    {rock.drift && <Text style={s.detail}>This small asteroid installation drifts 12 chart units per day, carrying its garrison and sensors. Its dotted chart track shows the next 24 hours. Use the Time Machine to inspect its future position.</Text>}
    {scheduledAt !== undefined && <Text style={s.detail}>Schedule site actions for {gameClock(scheduledAt)}. Forecast eligibility is provisional; requirements are checked at execution.</Text>}
    {rock.reserves !== undefined && <Text style={s.detail}>{reserveDescription(rock, resource)}. Capture and mine construction don't replenish reserves.</Text>}
    <Text style={s.detail}>Shields: {rock.shield ?? 0} / {maximumShield(rock)} · {rock.shieldsDisabled ? 'disabled' : 'enabled'}</Text>
    <Control label={label(rock.shieldsDisabled ? 'Enable shields' : 'Disable shields')} disabled={!enabled} onPress={onShields} />
    {rock.pulseDisabled && <Text style={s.detail}>Extraction disabled by King’s Pulse.</Text>}
    {rock.kind === 'mine' && hasReserves(rock) && !rock.pulseDisabled && rock.miningInterval !== undefined && <Text style={s.detail}>One {resource} every {rock.miningInterval.toFixed(2)}h · next payout {gameClock(rock.miningAt!)}. Expansion increases the rate.</Text>}
    {!minesAllowed && <Text style={s.detail}>No mines in domination operations.</Text>}
    {minesAllowed && hasReserves(rock) && rock.kind !== 'mine' && <><Text style={s.detail}>Drilling replaces this {siteKindLabel(rock.kind).toLowerCase()}. {rock.kind === 'generator' ? 'Drone capacity falls by 50.' : 'Drone production stops.'} A mine yields one {resource} per productive controlled site per day, paid throughout the day.</Text><Control label={label(`Drill mine · ${cost} drones`)} disabled={!enabled || rock.drones < cost} onPress={onMine} /></>}
  </View>;
}
function Control({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.text}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({ section: { gap: 10, marginTop: 16 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, button: { minHeight: 44, padding: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#15241a' }, text: { color: '#d6e2cd', fontSize: 12 } });
