import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { tacticalConfig, type TacticalPulseRequest } from '../game/tactical-pulse';
import type { GameView } from '../game/visibility';
import type { Faction } from '../game/players';
import { gameClock } from '../game/time-machine';

export function DisruptorControls({ game, owner, site, enabled, onCommand }: { game: GameView; owner: Faction; site: string; enabled: boolean; onCommand: (command: TacticalPulseRequest) => void }) {
  const [material, setMaterial] = useState('20');
  const system = game.pulse?.tactical, config = tacticalConfig(game);
  const rock = game.rocks.find(r => r.id === site);
  const units = rock?.owner === owner ? rock.specialists?.filter(u => u.kind === 'disruptor' && u.owner === owner && !u.captive) ?? [] : [];
  if (!system || !units.length) return null;
  const cost = Number(material), validCost = material.trim() !== '' && Number.isSafeInteger(cost) && cost >= config.minimumResourceCost && cost <= config.maximumResourceCost;
  const active = enabled && !game.winner && !game.draw && !game.eliminated.includes(owner);
  return <View style={s.panel}>
    <Text style={s.heading}>Disruptor · tactical pulse</Text>
    <Text style={s.detail}>Spend Pulse Material now or save it for your King. Charges for {config.chargeDuration * 60} minutes, then fires automatically.</Text>
    <Text style={s.detail}>Pulse Material ({config.minimumResourceCost}–{config.maximumResourceCost}) · available {Math.floor(game.cargo[owner] ?? 0)}</Text>
    <TextInput accessibilityLabel="Tactical pulse material" keyboardType="number-pad" value={material} onChangeText={setMaterial} editable={!!active} style={s.input} />
    {validCost && <Text style={s.detail}>Strong effects within {Math.max(0, (cost * config.strengthPerResource - config.chargeInterruptThreshold) / config.attenuationPerDistance).toFixed(1)} chart units · sensor jamming within {Math.max(0, (cost * config.strengthPerResource - config.communicationsJamThreshold) / config.attenuationPerDistance).toFixed(1)}. Travel speed: {config.propagationSpeed} units/h.</Text>}
    <Text style={s.detail}>Strong hits disable engines and mining, damage pulse shields, and reset a charging King. A firing King’s wave slows temporarily. Kings resist further interruption for {config.resistanceDuration}h. Tactical pulses cannot destroy a King.</Text>
    {units.map(unit => {
      const charge = system.charges.find(c => c.specialistId === unit.id);
      const disabled = !active || !charge && (!validCost || (game.cargo[owner] ?? 0) < cost);
      return <View key={unit.id} style={s.unit}>
        {charge && <><Text accessibilityLiveRegion="polite" style={s.detail}>Charging · launches {gameClock(charge.readyAt)} · {charge.resourceCost} material committed</Text><Text accessibilityRole="alert" style={s.warning}>Movement cancels this charge without a refund.</Text></>}
        <Pressable accessibilityRole="button" accessibilityLabel={charge ? 'Cancel Disruptor charge' : 'Charge Disruptor'} accessibilityState={{ disabled: !!disabled }} disabled={!!disabled} onPress={() => onCommand(charge ? { action: 'CANCEL_DISRUPTOR', specialistId: unit.id } : { action: 'CHARGE_DISRUPTOR', specialistId: unit.id, resourceCost: cost })} style={[s.button, disabled && { opacity: .35 }]}><Text style={s.heading}>{charge ? 'Cancel charge' : `Charge tactical pulse · ${validCost ? cost : 'choose'} material`}</Text></Pressable>
      </View>;
    })}
    <Text style={s.detail}>Once launched, the fading wave travels independently of the Disruptor. Your own assets are immune.</Text>
  </View>;
}
const s = StyleSheet.create({ panel: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#40563a', marginVertical: 8 }, heading: { color: '#e5eadc', fontSize: 13 }, detail: { color: '#a4b69d', fontSize: 12, lineHeight: 18 }, warning: { color: '#e5c18c', fontSize: 12 }, input: { color: '#e5eadc', borderWidth: 1, borderColor: '#6c8b58', padding: 10, minHeight: 44 }, unit: { gap: 8 }, button: { padding: 12, minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: '#6c8b58', backgroundColor: '#263b23' } });
