import { tacticalConfig, tacticalStrength } from '../game/tactical-pulse';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { pulseConfig, pulseRate, type PulseAction } from '../game/pulse';
import { worldDistance } from '../game/geometry';
import { playersIn, type Faction } from '../game/players';
import type { GameView } from '../game/visibility';
import { gameClock } from '../game/time-machine';

export function PulseControls({ game, owner, enabled, onCommand }: { game: GameView; owner: Faction; enabled: boolean; onCommand: (action: PulseAction) => void }) {
  const king = game.pulse?.kings.find(k => k.factionId === owner);
  if (!king) return null;
  const config = pulseConfig(game), rate = pulseRate(game, owner, 'charge_rate');
  const remaining = rate ? Math.max(0, config.chargeDuration - king.chargeProgress) / rate : Infinity;
  const actions: { action: PulseAction; label: string; disabled?: boolean }[] = king.state === 'idle'
    ? [{ action: 'START_CHARGE', label: `Start charge · ${config.activationResourceCost} pulse material`, disabled: (game.cargo[owner] ?? 0) < config.activationResourceCost }]
    : king.state === 'charging' ? [{ action: 'CANCEL_CHARGE', label: 'Cancel charge' }]
    : king.state === 'ready' ? [{ action: 'FIRE_PULSE', label: 'Fire King’s Pulse' }, { action: 'CANCEL_CHARGE', label: 'Discard charge' }]
    : king.state === 'firing' ? [{ action: 'TERMINATE_PULSE', label: 'Terminate pulse' }] : [];
  return <View style={s.panel}>
    <Text style={s.heading}>King’s Pulse · {king.state}</Text>
    <Text style={s.detail}>Pulse material: {Math.floor(game.cargo[owner] ?? 0)} · {playersIn(game).filter(f => !game.eliminated.includes(f)).length} Kings remain</Text>
    {king.state === 'charging' && <Text accessibilityLiveRegion="polite" style={s.detail}>Charge: {Math.floor(100 * king.chargeProgress / config.chargeDuration)}% · {Number.isFinite(remaining) ? `estimated ready ${gameClock(game.hour + remaining)}` : 'paused by stasis'}</Text>}
    {king.state === 'firing' && <Text style={s.detail}>Sustaining an expanding pulse. Your assets are immune; every opposing faction is exposed.</Text>}
    {['charging', 'ready', 'firing'].includes(king.state) && <Text accessibilityRole="alert" style={s.warning}>Moving your King cancels {king.state === 'firing' ? 'the pulse everywhere' : 'this charge'}. Committed pulse material is lost.</Text>}
    {(game.pulse?.tactical?.resistance[king.kingId] ?? 0) > game.hour && <Text style={s.detail}>Tactical resistance until {gameClock(game.pulse!.tactical!.resistance[king.kingId]!)}. Strong tactical hits cannot reset your charge or slow your wave again during resistance.</Text>}
    <View style={s.actions}>{actions.map(a => <Pressable key={a.action} accessibilityRole="button" accessibilityState={{ disabled: !enabled || !!a.disabled }} disabled={!enabled || a.disabled} onPress={() => onCommand(a.action)} style={[s.button, (!enabled || a.disabled) && { opacity: 0.35 }]}><Text style={s.text}>{a.label}</Text></Pressable>)}</View>
  </View>;
}
export function PulseLocation({ game, owner, site }: { game: GameView; owner: Faction; site: string }) {
  if (!game.pulse) return null;
  const rock = game.rocks.find(r => r.id === site);
  if (!rock) return null;
  const shield = game.pulse.shields[site], config = pulseConfig(game);
  const drain = shield && rock.owner ? shield.exposed * config.shieldDrainPerHour * pulseRate(game, rock.owner, 'shield_drain') : 0;
  const kings = game.pulse.kings.filter(k => rock.specialists?.some(u => u.id === k.kingId));
  return <View style={s.panel}>
    {rock.known && (rock.sensorJammedUntil ?? 0) > game.hour && <Text style={s.warning}>Sensors jammed until {gameClock(rock.sensorJammedUntil!)} · range halved</Text>}
    {rock.known && (rock.miningDisabledUntil ?? 0) > game.hour && <Text style={s.warning}>Mining disabled until {gameClock(rock.miningDisabledUntil!)}</Text>}
    {kings.map(k => <Text key={k.kingId} style={s.heading}>King · {k.state}{k.state === 'charging' ? ` · ${Math.floor(100 * k.chargeProgress / config.chargeDuration)}%` : ''}</Text>)}
    {shield && <><Text style={s.detail}>Pulse shield: {shield.energy.toFixed(1)} / {config.shieldMaxEnergy} · {(rock.known && rock.shieldsDisabled) ? 'disabled' : shield.exposed ? `absorbing ${shield.exposed} pulse${shield.exposed > 1 ? 's' : ''}` : shield.energy >= config.shieldMaxEnergy ? 'full' : 'recharging'}</Text><Text style={s.detail}>Drain: {(rock.known && rock.shieldsDisabled) ? 0 : drain.toFixed(1)} energy/h{drain && !(rock.known && rock.shieldsDisabled) ? ` · collapse in ${(shield.energy / drain).toFixed(2)}h` : ''}</Text></>}
    {game.pulse.pulses.filter(p => p.factionId !== owner).map(p => {
      const speed = config.propagationSpeed * pulseRate(game, p.factionId, 'pulse_speed');
      const distance = Math.max(0, worldDistance(game, p.origin, rock) - p.radius);
      return <Text key={p.id} style={s.warning}>{p.factionId} pulse: {distance <= 1e-9 ? 'exposed now' : speed ? `estimated arrival in ${(distance / speed).toFixed(2)}h` : 'wavefront in stasis'}</Text>;
    })}
    {game.pulse.tactical?.waves.filter(p => p.factionId !== owner).map(p => {
      const config = tacticalConfig(game), distance = worldDistance(game, p.origin, rock), remaining = distance - p.radius;
      if (remaining < -1e-9 || p.hitSites.includes(site)) return null;
      const strength = tacticalStrength({ initialStrength: p.initialStrength, radius: distance }, config);
      return <Text key={p.id} style={s.warning}>Tactical pulse: estimated arrival in {(Math.max(0, remaining) / config.propagationSpeed).toFixed(2)}h · {strength.toFixed(0)} strength · {strength >= config.chargeInterruptThreshold ? 'strong disruption' : strength >= config.communicationsJamThreshold ? 'sensor jam only' : 'too weak to disrupt'}</Text>;
    })}
    {!!game.pulse.pulses.length && <Text style={s.detail}>Estimates assume current speeds and positions. Shields protect stationed units, including preparing haulers.</Text>}
  </View>;
}
export function PulseMoveWarning({ game, owner, units }: { game: GameView; owner: Faction; units: readonly { kind: string }[] }) {
  const king = game.pulse?.kings.find(k => k.factionId === owner);
  return <>
    {king && ['charging', 'ready', 'firing'].includes(king.state) && units.some(u => u.kind === 'queen') && <Text accessibilityRole="alert" style={s.warning}>This movement order cancels your King’s {king.state === 'firing' ? 'active pulse everywhere' : 'charge'} immediately when executed. No pulse material is refunded.</Text>}
    {units.some(u => u.kind === 'disruptor') && game.pulse?.tactical?.charges.some(c => c.factionId === owner) && <Text accessibilityRole="alert" style={s.warning}>Moving a charging Disruptor cancels its charge immediately. No pulse material is refunded. Launched tactical waves continue.</Text>}
  </>;
}
const s = StyleSheet.create({ panel: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#40563a', marginVertical: 8 }, heading: { color: '#e5eadc', fontSize: 14 }, detail: { color: '#a4b69d', fontSize: 12, lineHeight: 18 }, warning: { color: '#e5c18c', fontSize: 12, lineHeight: 18 }, text: { color: '#e5eadc', fontSize: 12 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { padding: 12, minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: '#6c8b58', backgroundColor: '#263b23' } });
