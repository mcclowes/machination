/**
 * ---
 * purpose: Shared module construction and explicit hauler-loading controls for solo and multiplayer.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MODULES, type ModuleKind } from '../game/modules';
import type { Rock } from '../game/simulation';
type Props = { rock: Rock; enabled: boolean; carry: boolean; onCarry: (carry: boolean) => void; onBuild: (kind: ModuleKind) => void };
export function ModuleBay({ rock, enabled, carry, onCarry, onBuild }: Props) {
  return <View style={s.bay}>
    <Text style={s.label}>Module bay</Text>
    {rock.module ? <>
      <Text style={s.name}>{MODULES[rock.module].name}</Text>
      <Text style={s.detail}>{MODULES[rock.module].description}</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: carry, disabled: !enabled }} disabled={!enabled} onPress={() => onCarry(!carry)} style={[s.load, !enabled && { opacity: 0.4 }]}><Text style={s.loadText}>{carry ? '☑' : '☐'} Load onto the next hauler</Text></Pressable>
      <Text style={s.detail}>Stored modules have no combat effect. A carried module is destroyed if its hauler loses. An occupied arrival bay scraps the incoming module.</Text>
    </> : <>
      <Text style={s.detail}>Build with drones. One module per rock. Load explicitly when planning a transfer.</Text>
      {(Object.keys(MODULES) as ModuleKind[]).map(kind => {
        const entry = MODULES[kind];
        const disabled = !enabled || rock.drones < entry.cost;
        return <Pressable accessibilityRole="button" accessibilityLabel={`Build ${entry.name} for ${entry.cost} drones`} accessibilityState={{ disabled }} disabled={disabled} key={kind} onPress={() => onBuild(kind)} style={[s.option, disabled && { opacity: 0.4 }]}><View style={s.between}><Text style={s.name}>{entry.name}</Text><Text style={s.cost}>{entry.cost} drones</Text></View><Text style={s.detail}>{entry.description}</Text></Pressable>;
      })}
    </>}
  </View>;
}
const s = StyleSheet.create({
  bay: { borderTopWidth: 1, borderTopColor: '#30402e', marginTop: 16, paddingTop: 16, gap: 10 }, label: { color: '#96ad89', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' }, name: { color: '#d6e2cd', fontSize: 12 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, between: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, cost: { color: '#b8e986', fontSize: 11 }, option: { padding: 12, minHeight: 44, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#142117', gap: 7 }, load: { minHeight: 44, padding: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#40563a' }, loadText: { color: '#b8e986', fontSize: 12 },
});
