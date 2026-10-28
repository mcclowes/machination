/**
 * ---
 * purpose: Touch-selectable belt chart with ownership, transfer trajectories, and accessible rock controls.
 * ---
 */
import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Text as SvgText } from 'react-native-svg';
import { flightEndpoints, fleetPosition } from '../game/flight';
import { MODULES } from '../game/modules';
import { FACTIONS, type Faction, type Fleet, type Rock } from '../game/simulation';

type ChartRock = Omit<Rock, 'owner' | 'drones'> & { owner?: Faction | null; drones?: number; known?: boolean };
type Props<T extends ChartRock> = { game: { hour: number; rocks: T[]; fleets: Fleet[]; coverage?: { x: number; y: number; radius: number }[] }; selected: string; destination?: string; onSelect: (rock: T) => void };
export function BeltMap<T extends ChartRock>({ game, selected, destination, onSelect }: Props<T>) {
  return <View style={styles.chart}>
    <Svg width="100%" height="100%" viewBox="0 0 400 480" preserveAspectRatio="none" pointerEvents="none">
      {Array.from({ length: 65 }, (_, i) => <Circle key={i} cx={(i * 137.5) % 400} cy={(i * 79.7) % 480} r={i % 4 === 0 ? 1 : 0.5} fill="#b5c7bd" opacity={0.12 + (i % 3) * 0.09} />)}
      {game.coverage?.map((sensor, i) => <Ellipse key={`sensor-${i}`} cx={sensor.x * 4} cy={sensor.y * 4.8} rx={sensor.radius * 4} ry={sensor.radius * 4.8} fill="#b8e986" fillOpacity="0.025" stroke="#b8e986" strokeOpacity="0.12" strokeWidth="0.7" />)}
      {[90, 150, 215, 285].map(r => <Ellipse key={r} cx="204" cy="243" rx={r} ry={r * 0.91} stroke="#26332e" strokeWidth="0.7" fill="none" strokeDasharray="3 7" />)}
      <Circle cx="204" cy="243" r="30" fill="#9c744a" opacity="0.025" />
      <Circle cx="204" cy="243" r="14" fill="#9c744a" opacity="0.06" />
      <Circle cx="204" cy="243" r="5" fill="#c9a06b" opacity="0.65" />
      <SvgText x="204" y="265" textAnchor="middle" fill="#6b746c" fontSize="7" letterSpacing="2">SOL / 04</SvgText>
      {game.fleets.map(f => {
        const { from: a, to: b } = flightEndpoints(game, f);
        const position = fleetPosition(game, f);
        const x = position.x * 4; const y = position.y * 4.8;
        return <React.Fragment key={f.id}>
          <Line x1={a.x * 4} y1={a.y * 4.8} x2={b.x * 4} y2={b.y * 4.8} stroke={FACTIONS[f.owner].color} opacity="0.35" strokeDasharray="3 4" />
          {f.intercept && <Circle cx={x} cy={y} r="6" fill="none" stroke={FACTIONS[f.owner].color} strokeWidth="0.7" />}
          <Path d={`M ${x} ${y - 4} l 4 8 l -8 0 Z`} fill={FACTIONS[f.owner].color} />
        </React.Fragment>;
      })}
      {destination && (() => {
        const a = game.rocks.find(r => r.id === selected)!;
        const b = game.rocks.find(r => r.id === destination)!;
        return <Line x1={a.x * 4} y1={a.y * 4.8} x2={b.x * 4} y2={b.y * 4.8} stroke="#b8e986" strokeDasharray="5 4" />;
      })()}
    </Svg>
    {game.rocks.map(rock => {
      const color = rock.owner ? FACTIONS[rock.owner].color : '#7d8b83';
      const active = selected === rock.id || destination === rock.id;
      return <Pressable key={rock.id} accessibilityRole="button" accessibilityLabel={`${rock.name}, ${rock.kind}, ${rock.known === false ? 'outside sensor range, ownership and drones unknown' : `${rock.owner ? FACTIONS[rock.owner].name : 'unclaimed'}, ${Math.floor(rock.drones ?? 0)} drones`}${rock.module ? `, ${MODULES[rock.module].name}` : ''}`} onPress={() => onSelect(rock)} style={[styles.rock, { left: `${rock.x}%`, top: `${rock.y}%` }]}>
        <View style={[styles.ring, { borderColor: active ? color : 'transparent', backgroundColor: active ? `${color}10` : 'transparent' }]}>
          <View style={[styles.stone, { borderColor: color, backgroundColor: `${color}18`, transform: [{ rotate: rock.kind === 'core' ? '0deg' : '25deg' }] }]}>
            <Text style={{ color, fontSize: 11 }}>{rock.kind === 'core' ? '◈' : rock.kind === 'reactor' ? 'ϟ' : '·'}</Text>
          </View>
        </View>
        <Text style={[styles.name, { color: active ? '#eff4e9' : color }]}>{rock.name}</Text>
        <Text style={[styles.count, { color }]}>{rock.known === false ? '?' : Math.floor(rock.drones ?? 0).toString().padStart(2, '0')}{rock.module ? ` · ${MODULES[rock.module].code}` : ''}</Text>
      </Pressable>;
    })}
    <View style={styles.coordinates}><Text style={styles.coord}>SECTOR 07—B</Text><Text style={styles.coord}>2.8 AU / OUTER BELT</Text></View>
  </View>;
}
const styles = StyleSheet.create({
  chart: { width: '100%', height: 480, overflow: 'hidden', backgroundColor: '#0b1412', borderWidth: 1, borderColor: '#25322b' },
  rock: { position: 'absolute', width: 78, height: 70, marginLeft: -39, marginTop: -26, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 38, height: 38, borderRadius: 30, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stone: { width: 23, height: 23, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 9, letterSpacing: 0.5, marginTop: 1 }, count: { fontSize: 10, fontVariant: ['tabular-nums'], marginTop: 2 },
  coordinates: { position: 'absolute', top: 15, left: 15, gap: 4 }, coord: { fontSize: 8, letterSpacing: 1.4, color: '#5e7366' },
});
