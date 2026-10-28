/**
 * ---
 * purpose: Touch-selectable belt chart with ownership, transfer trajectories, and accessible rock controls.
 * ---
 */
import React, { useRef, useState } from 'react';
import { View, Pressable, Text, StyleSheet, PanResponder } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { flightDestination, flightEndpoints, fleetPosition } from '../game/flight';
import { SPECIALISTS } from '../game/specialist-catalog';
import { MODULES } from '../game/modules';
import { FACTIONS, type Faction, type Fleet, type Rock } from '../game/simulation';

type ChartRock = Omit<Rock, 'owner' | 'drones'> & { owner?: Faction | null; drones?: number; known?: boolean };
type Props<T extends ChartRock> = { game: { hour: number; rocks: T[]; fleets: Fleet[]; coverage?: { x: number; y: number; radius: number }[] }; selected: string; destination?: string; onSelect: (rock: T) => void };
export function BeltMap<T extends ChartRock>({ game, selected, destination, onSelect }: Props<T>) {
  const [camera, setCamera] = useState({ scale: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ width: 400, height: 480 });
  const [contact, setContact] = useState<number>();
  const current = useRef({ camera, size });
  current.current = { camera, size };
  const start = useRef({ ...camera, pinch: 0 });
  function move(scale: number, x: number, y: number) {
    const zoom = Math.max(1, Math.min(4, scale));
    const bound = (zoom - 1) * 50;
    setCamera({ scale: zoom, x: Math.max(-bound, Math.min(bound, x)), y: Math.max(-bound, Math.min(bound, y)) });
  }
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => event.nativeEvent.touches.length > 1 || current.current.camera.scale > 1 && Math.hypot(gesture.dx, gesture.dy) > 6,
    onPanResponderGrant: event => {
      const [a, b] = event.nativeEvent.touches;
      start.current = { ...current.current.camera, pinch: a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0 };
    },
    onPanResponderMove: (event, gesture) => {
      const [a, b] = event.nativeEvent.touches;
      if (a && b) {
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        if (!start.current.pinch) start.current = { ...current.current.camera, pinch: distance };
        move(start.current.scale * distance / start.current.pinch, start.current.x, start.current.y);
      } else move(start.current.scale, start.current.x + gesture.dx / current.current.size.width * 100, start.current.y + gesture.dy / current.current.size.height * 100);
    },
  })).current;
  const position = (point: { x: number; y: number }) => ({ x: (point.x - 50) * camera.scale + 50 + camera.x, y: (point.y - 50) * camera.scale + 50 + camera.y });
  const fleet = game.fleets.find(f => f.id === contact);
  return <View style={styles.chart} onLayout={event => setSize(event.nativeEvent.layout)} {...pan.panHandlers}>
    <Svg width="100%" height="100%" viewBox="0 0 400 480" preserveAspectRatio="none" pointerEvents="none">
      {Array.from({ length: 65 }, (_, i) => <Circle key={i} cx={(i * 137.5) % 400} cy={(i * 79.7) % 480} r={i % 4 === 0 ? 1 : 0.5} fill="#b5c7bd" opacity={0.12 + (i % 3) * 0.09} />)}
      <G transform={`translate(${200 + camera.x * 4}, ${240 + camera.y * 4.8}) scale(${camera.scale}) translate(-200, -240)`}>
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
      </G>
    </Svg>
    {game.rocks.map(rock => {
      const color = rock.owner ? FACTIONS[rock.owner].color : '#7d8b83';
      const active = selected === rock.id || destination === rock.id;
      const location = position(rock);
      return <Pressable key={rock.id} accessibilityRole="button" accessibilityLabel={`${rock.name}, ${rock.destroyed ? 'destroyed site' : rock.kind}${rock.coreOf ? ", intelligence core" : ""}, ${rock.known === false ? 'outside sensor range, ownership and drones unknown' : `${rock.owner ? FACTIONS[rock.owner].name : 'unclaimed'}, ${Math.floor(rock.drones ?? 0)} drones`}${rock.module ? `, ${MODULES[rock.module].name}` : ''}${rock.specialists?.length ? `, ${rock.specialists.map(u => SPECIALISTS[u.kind].name).join(', ')}` : ''}`} onPress={() => { setContact(undefined); onSelect(rock); }} style={[styles.rock, { left: `${location.x}%`, top: `${location.y}%` }]}>
        <View style={[styles.ring, { borderColor: active ? color : 'transparent', backgroundColor: active ? `${color}10` : 'transparent' }]}>
          <View style={[styles.stone, { borderColor: color, backgroundColor: `${color}18`, transform: [{ rotate: rock.kind === 'core' ? '0deg' : '25deg' }] }]}>
            <Text style={{ color, fontSize: 11 }}>{rock.destroyed ? '×' : rock.coreOf || rock.kind === 'core' ? '◈' : rock.kind === 'reactor' || rock.kind === 'generator' ? 'ϟ' : rock.kind === 'factory' ? '▥' : '·'}</Text>
          </View>
        </View>
        <Text style={[styles.name, { color: active ? '#eff4e9' : color }]}>{rock.name}</Text>
        <Text style={[styles.count, { color }]}>{rock.known === false ? '?' : Math.floor(rock.drones ?? 0).toString().padStart(2, '0')}{rock.module ? ` · ${MODULES[rock.module].code}` : ''}{rock.specialists?.length ? ` · ${rock.specialists.length}u` : ''}</Text>
      </Pressable>;
    })}
    {game.fleets.map(f => {
      const location = position(fleetPosition(game, f));
      return <Pressable key={`contact-${f.id}`} accessibilityRole="button" accessibilityLabel={`${FACTIONS[f.owner].name} hauler${f.preparing ? ", preparing launch" : ""}, ${f.drones} drones, ${flightDestination(game.rocks, f)}, arrives in ${(f.arrives - game.hour).toFixed(1)} hours`} onPress={() => setContact(f.id)} style={[styles.hauler, { left: `${location.x}%`, top: `${location.y}%` }]}><View style={[styles.contactRing, { borderColor: contact === f.id ? FACTIONS[f.owner].color : 'transparent' }]} /></Pressable>;
    })}
    <View style={styles.zoom}><MapControl label="Zoom out" text="−" disabled={camera.scale <= 1} onPress={() => move(camera.scale - 0.5, camera.x, camera.y)} /><MapControl label="Zoom in" text="+" disabled={camera.scale >= 4} onPress={() => move(camera.scale + 0.5, camera.x, camera.y)} /><MapControl label="Fit chart" text="Fit" onPress={() => move(1, 0, 0)} /></View>
    {fleet && <View style={styles.inspector}><View style={styles.contactHeading}><Text style={[styles.contactTitle, { color: FACTIONS[fleet.owner].color }]}>{FACTIONS[fleet.owner].name} · hauler</Text><MapControl label="Close hauler details" text="×" onPress={() => setContact(undefined)} /></View><Text style={styles.contactText}>{fleet.drones} drones{fleet.module ? ` · ${MODULES[fleet.module].name}` : ''}</Text><Text style={styles.contactText}>{fleet.specialists?.map(u => `${SPECIALISTS[u.kind].name}${u.captive ? ' (captive)' : ''}`).join(', ')}</Text><Text style={styles.contactText}>{game.rocks.find(r => r.id === fleet.from)?.name} → {flightDestination(game.rocks, fleet)}</Text><Text style={styles.contactText}>Arrives in {Math.max(0, (fleet.arrives - game.hour) * 60).toFixed(0)} minutes</Text><MapControl label="Inspect hauler destination" text="Inspect destination" onPress={() => { const target = game.rocks.find(r => r.id === fleet.to); if (target) onSelect(target); setContact(undefined); }} /></View>}
    <View pointerEvents="none" style={styles.coordinates}><Text style={styles.coord}>SECTOR 07—B</Text><Text style={styles.coord}>2.8 AU / OUTER BELT</Text></View>
  </View>;
}
function MapControl({ label, text, disabled, onPress }: { label: string; text: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.mapControl, disabled && { opacity: 0.35 }]}><Text style={styles.contactText}>{text}</Text></Pressable>;
}
const styles = StyleSheet.create({
  zoom: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', gap: 4 }, mapControl: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#15241a', borderWidth: 1, borderColor: '#40563a' },
  hauler: { position: 'absolute', width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: 'center', justifyContent: 'center' }, contactRing: { width: 25, height: 25, borderWidth: 1, borderRadius: 20 }, inspector: { position: 'absolute', bottom: 10, left: 10, right: 10, padding: 12, gap: 6, backgroundColor: '#101e15', borderWidth: 1, borderColor: '#526644' }, contactHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, contactTitle: { fontSize: 14, flex: 1 }, contactText: { color: '#d6e2cd', fontSize: 12, lineHeight: 18 },
  chart: { width: '100%', height: 480, overflow: 'hidden', backgroundColor: '#0b1412', borderWidth: 1, borderColor: '#25322b' },
  rock: { position: 'absolute', width: 78, height: 70, marginLeft: -39, marginTop: -26, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 38, height: 38, borderRadius: 30, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stone: { width: 23, height: 23, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 9, letterSpacing: 0.5, marginTop: 1 }, count: { fontSize: 10, fontVariant: ['tabular-nums'], marginTop: 2 },
  coordinates: { position: 'absolute', top: 15, left: 15, gap: 4 }, coord: { fontSize: 8, letterSpacing: 1.4, color: '#5e7366' },
});
