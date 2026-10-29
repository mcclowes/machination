/**
 * ---
 * purpose: Player-facing specialist roster and combat quick reference inside the field manual.
 * related:
 *   - ../game/specialist-catalog.ts - shared names, effects, and promotion graph
 *   - ./FieldManual.tsx - manual navigation
 * ---
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SPECIALISTS, hireAmount, promotion, type SpecialistKind } from '../game/specialist-catalog';
import { SpecialistIcon } from './SpecialistIcon';

const kinds = Object.keys(SPECIALISTS) as SpecialistKind[];
const groups = [
  ['core', 'Core'], ['attack', 'Attack hires'], ['defense', 'Defense hires'],
  ['other', 'Other hires'], ['promotion', 'Promotions'],
] as const;
const combatOrder = Object.values(SPECIALISTS).filter(unit => 'priority' in unit)
  .sort((a, b) => a.priority - b.priority);

export function SpecialistsCheatsheet() {
  return <ScrollView contentContainerStyle={s.content}>
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>Specialists cheatsheet</Text>
      <Text style={s.body}>Modules change the rules wherever you send them. Local effects apply to the carrying site or hauler; global effects apply across your operation. Captives have no abilities. Speed bonuses use the fastest applicable multiplier.</Text>
    </View>
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.heading}>Recruitment and promotions</Text>
      <Text style={s.body}>Earn a credit after four normal-rate hours, then every 18. Credits accumulate. The opening runs recruitment at 1.5× for 12 game hours, bringing the first credit at 2h 40m.</Text>
      <Text style={s.body}>Each hire offers one attack, one defense, and one other module. Hire at your core's controlled site for one credit. A traveling core can't hire. Diversion worm and Kill protocol give two units per hire; other hires give one.</Text>
      <Text style={s.body}>Spend one credit to promote an eligible module docked at a controlled site, even while your core travels. Promotion replaces the old ability and refreshes the offers. Hires and promotions take effect immediately when executed.</Text>
    </View>
    {groups.map(([category, title]) => <View key={category} style={s.section}>
      <Text accessibilityRole="header" style={s.heading}>{title}</Text>
      {kinds.filter(kind => SPECIALISTS[kind].category === category).map(kind => {
        const unit = SPECIALISTS[kind];
        const promoted = promotion(kind);
        const from = kinds.find(candidate => promotion(candidate) === kind);
        return <View key={kind} style={s.unit}>
          <SpecialistIcon kind={kind} size={36} />
          <View style={s.details}>
            <Text accessibilityRole="header" style={s.name}>{unit.name}</Text>
            <Text style={s.reference}>{unit.reference}</Text>
            <Text style={s.body}>{unit.description}</Text>
            {hireAmount(kind) > 1 && <Text style={s.note}>{hireAmount(kind)} units per hire</Text>}
            {promoted && <Text style={s.note}>Promotes to {SPECIALISTS[promoted].name}</Text>}
            {from && <Text style={s.note}>Promoted from {SPECIALISTS[from].name}</Text>}
          </View>
        </View>;
      })}
    </View>)}
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.heading}>Combat order</Text>
      <Text style={s.body}>Earlier abilities can end combat or remove modules before later ones act. Equal-priority effects resolve simultaneously.</Text>
      {combatOrder.map(unit => <Text key={unit.name} style={s.body}>{unit.priority}. {unit.name}</Text>)}
      <Text style={s.body}>Self-destruct charge detonates before suppression. Precedence kernel suppresses local combat abilities if only one side carries it; kernels on both sides allow those abilities again.</Text>
      <Text style={s.body}>If combat continues, War controller and Siege controller apply global damage, then shields absorb site attacks, then drones fight. More active local modules break drone ties. Victory recovery and shield refill follow. Global combat bonuses and global Repair mesh recovery still apply under local suppression.</Text>
      <Text style={s.body}>Gift contacts transfer modules without combat abilities. Captured modules keep their original owner but become inactive captives.</Text>
    </View>
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.heading}>Travel reminders</Text>
      <Text style={s.body}>Load modules explicitly onto haulers; they can travel without drones. Scavenger rig's 2× outbound and 4× return speed apply to targeted interceptions, not ordinary site-bound travel or captive release.</Text>
      <Text style={s.body}>Routing controller turns take effect after a cancelable ten-minute delay. The eight-hour cooldown starts at the turn. Sentry, Capacitor, and Navigator timers keep their ordinary timing during opening acceleration.</Text>
      <Text style={s.body}>These are current operation rules. Older saves retain their recorded mechanics.</Text>
    </View>
  </ScrollView>;
}

const s = StyleSheet.create({
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 24, gap: 24 },
  section: { gap: 12 }, title: { color: '#e5eadc', fontSize: 23 },
  heading: { color: '#e5eadc', fontSize: 18 },
  unit: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#30402e' },
  details: { flex: 1, minWidth: 0, gap: 4 }, name: { color: '#e5eadc', fontSize: 16 },
  reference: { color: '#a8b8a2', fontSize: 13 },
  body: { color: '#a8b8a2', fontSize: 15, lineHeight: 24 },
  note: { color: '#b8e986', fontSize: 13, lineHeight: 20 },
});
