/**
 * ---
 * purpose: Touch-selectable belt chart with ownership, transfer trajectories, and accessible rock controls.
 * ---
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Text, StyleSheet, PanResponder } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { flightDestination, flightEndpoints, fleetPosition } from '../game/flight';
import { SPECIALISTS } from '../game/specialist-catalog';
import { MODULES } from '../game/modules';
import { arrivalInspection } from '../game/time-machine';
import { FACTIONS, type Faction, type Fleet, type Rock } from '../game/simulation';

import { constrainCamera, fitPlayerCamera, zoomCamera, type MapCamera } from '../game/chart-camera';

import { mapOffsets, wrappedBounds, type MapGeometry } from '../game/geometry';
import { chartPosition, chartRoute } from '../game/chart-projection';

type ChartRock = Omit<Rock, 'owner' | 'drones' | 'kind'> & { kind: Rock['kind'] | 'unknown'; owner?: Faction | null; drones?: number; known?: boolean };
export type { MapCamera } from '../game/chart-camera';
type Props<T extends ChartRock> = { game: { epoch?: number; hour: number; rocks: T[]; fleets: Fleet[]; rules?: { map: MapGeometry }; coverage?: { x: number; y: number; radius: number }[] }; selected: string; destination?: string; onSelect: (rock: T) => void; fill?: boolean; viewport?: { camera: MapCamera; onChange: (camera: MapCamera) => void }; player?: Faction; onInspectFleet?: () => void; onManageFleet?: (id: number) => void; timeInspection?: { liveHour: number; historyStart?: number; onInspect: (hour: number | null) => void } };
export function BeltMap<T extends ChartRock>({ game, selected, destination, onSelect, fill, viewport, player, onInspectFleet, onManageFleet, timeInspection }: Props<T>) {
  const [localCamera, setLocalCamera] = useState<MapCamera>(() => fitPlayerCamera(game, player ?? 'you'));
  useEffect(() => { if (!viewport) setLocalCamera(fitPlayerCamera(game, player ?? 'you')); }, [game.epoch, player]);
  const camera = constrainCamera(game, viewport?.camera ?? localCamera);
  const [size, setSize] = useState({ width: 400, height: 480 });
  const [contact, setContact] = useState<number>();
  useEffect(() => setContact(undefined), [game.epoch, player]);
  const current = useRef({ camera, size, wrapped: !!wrappedBounds(game), world: game, onChange: viewport?.onChange ?? setLocalCamera });
  current.current = { camera, size, wrapped: !!wrappedBounds(game), world: game, onChange: viewport?.onChange ?? setLocalCamera };
  const start = useRef({ ...camera, pinch: 0 });
  function move(scale: number, x: number, y: number) {
    current.current.onChange(constrainCamera(current.current.world, { scale, x, y }));
  }
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => event.nativeEvent.touches.length > 1 || (current.current.wrapped || current.current.camera.scale > 1) && Math.hypot(gesture.dx, gesture.dy) > 6,
    onPanResponderGrant: event => {
      const [a, b] = event.nativeEvent.touches;
      start.current = { ...current.current.camera, pinch: a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0 };
    },
    onPanResponderMove: (event, gesture) => {
      const [a, b] = event.nativeEvent.touches;
      if (a && b) {
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        if (!start.current.pinch) start.current = { ...current.current.camera, pinch: distance };
        current.current.onChange(zoomCamera(current.current.world, start.current, start.current.scale * distance / start.current.pinch));
      } else move(start.current.scale, start.current.x + gesture.dx / current.current.size.width * 100, start.current.y + gesture.dy / current.current.size.height * 100);
    },
  })).current;
  const width = game.rules?.map.width ?? 100;
  const height = game.rules?.map.height ?? 100;
  const sx = 400 / width, sy = 480 / height;
  const offsets = mapOffsets(game);
  const position = (point: { x: number; y: number }) => chartPosition(game, camera, point);
  const fleet = game.fleets.find(f => f.id === contact);
  const arrival = fleet && timeInspection ? arrivalInspection(timeInspection.liveHour, timeInspection.historyStart, fleet.arrives) : undefined;
  return <View style={[styles.chart, fill && { flex: 1, height: '100%' }]} onLayout={event => setSize(event.nativeEvent.layout)} {...pan.panHandlers}>
    <Svg width="100%" height="100%" viewBox="0 0 400 480" preserveAspectRatio="none" pointerEvents="none">
      {Array.from({ length: 65 }, (_, i) => <Circle key={i} cx={(i * 137.5) % 400} cy={(i * 79.7) % 480} r={i % 4 === 0 ? 1 : 0.5} fill="#b5c7bd" opacity={0.12 + (i % 3) * 0.09} />)}
      <G transform={`translate(${200 + camera.x * 4}, ${240 + camera.y * 4.8}) scale(${camera.scale}) translate(-200, -240)`}>
      {offsets.map((offset, tile) => <G key={tile} transform={`translate(${offset.x * sx}, ${offset.y * sy})`}>
      {game.coverage?.map((sensor, i) => <Ellipse key={`sensor-${i}`} cx={sensor.x * sx} cy={sensor.y * sy} rx={sensor.radius * sx} ry={sensor.radius * sy} fill="#b8e986" fillOpacity="0.025" stroke="#b8e986" strokeOpacity="0.12" strokeWidth="0.7" />)}
      {[90, 150, 215, 285].map(r => <Ellipse key={r} cx="204" cy="243" rx={r} ry={r * 0.91} stroke="#26332e" strokeWidth="0.7" fill="none" strokeDasharray="3 7" />)}
      <Circle cx="204" cy="243" r="30" fill="#9c744a" opacity="0.025" />
      <Circle cx="204" cy="243" r="14" fill="#9c744a" opacity="0.06" />
      <Circle cx="204" cy="243" r="5" fill="#c9a06b" opacity="0.65" />
      <SvgText x="204" y="265" textAnchor="middle" fill="#6b746c" fontSize="7" letterSpacing="2">SOL / 04</SvgText>
      {game.fleets.map(f => {
        const { from: a, to: b } = flightEndpoints(game, f);
        const position = fleetPosition(game, f);
        const x = position.x * sx; const y = position.y * sy;
        return <React.Fragment key={f.id}>
          <Line x1={a.x * sx} y1={a.y * sy} x2={b.x * sx} y2={b.y * sy} stroke={FACTIONS[f.owner].color} opacity="0.35" strokeDasharray="3 4" />
          {f.intercept && <Circle cx={x} cy={y} r="6" fill="none" stroke={FACTIONS[f.owner].color} strokeWidth="0.7" />}
          <Path d={`M ${x} ${y - 4} l 4 8 l -8 0 Z`} fill={FACTIONS[f.owner].color} />
        </React.Fragment>;
      })}
      {destination && (() => {
        const source = game.rocks.find(r => r.id === selected);
        const target = game.rocks.find(r => r.id === destination);
        if (!source || !target) return null;
        const { from: a, to: b } = chartRoute(game, source, target);
        return <Line x1={a.x * sx} y1={a.y * sy} x2={b.x * sx} y2={b.y * sy} stroke="#b8e986" strokeDasharray="5 4" />;
      })()}
      </G>)}
      </G>
    </Svg>
    {offsets.flatMap((offset, tile) => game.rocks.map(rock => {
      const color = rock.owner ? FACTIONS[rock.owner].color : '#7d8b83';
      const active = selected === rock.id || destination === rock.id;
      const location = position({ x: rock.x + offset.x, y: rock.y + offset.y });
      if (location.x < -15 || location.x > 115 || location.y < -15 || location.y > 115) return null;
      return <Pressable key={`${tile}-${rock.id}`} accessibilityRole="button" accessibilityLabel={`${rock.name}, ${rock.destroyed ? 'destroyed site' : rock.kind}${rock.coreOf ? ", intelligence core" : ""}, ${rock.known === false ? 'outside sensor range, ownership and drones unknown' : `${rock.owner ? FACTIONS[rock.owner].name : 'unclaimed'}, ${Math.floor(rock.drones ?? 0)} drones`}${rock.module ? `, ${MODULES[rock.module].name}` : ''}${rock.specialists?.length ? `, ${rock.specialists.map(u => SPECIALISTS[u.kind].name).join(', ')}` : ''}`} onPress={() => { setContact(undefined); onSelect(rock); }} style={[styles.rock, { left: `${location.x}%`, top: `${location.y}%` }]}>
        <View style={[styles.ring, { borderColor: active ? color : 'transparent', backgroundColor: active ? `${color}10` : 'transparent' }]}>
          <View style={[styles.stone, { borderColor: color, backgroundColor: `${color}18`, transform: [{ rotate: rock.kind === 'core' ? '0deg' : '25deg' }] }]}>
            <Text style={{ color, fontSize: 11 }}>{rock.destroyed ? '×' : rock.kind === 'unknown' ? '?' : rock.coreOf || rock.kind === 'core' ? '◈' : rock.kind === 'reactor' || rock.kind === 'generator' ? 'ϟ' : rock.kind === 'factory' ? '▥' : '·'}</Text>
          </View>
        </View>
        <Text style={[styles.name, { color: active ? '#eff4e9' : color }]}>{rock.name}</Text>
        <Text style={[styles.count, { color }]}>{rock.known === false ? '?' : Math.floor(rock.drones ?? 0).toString().padStart(2, '0')}{rock.module ? ` · ${MODULES[rock.module].code}` : ''}{rock.specialists?.length ? ` · ${rock.specialists.length}u` : ''}</Text>
      </Pressable>;
    }))}
    {offsets.flatMap((offset, tile) => game.fleets.map(f => {
      const point = fleetPosition(game, f);
      const location = position({ x: point.x + offset.x, y: point.y + offset.y });
      if (location.x < -10 || location.x > 110 || location.y < -10 || location.y > 110) return null;
      return <Pressable key={`contact-${tile}-${f.id}`} accessibilityRole="button" accessibilityLabel={`${FACTIONS[f.owner].name} hauler${f.preparing ? ", preparing launch" : ""}, ${f.drones} drones, ${flightDestination(game.rocks, f)}, arrives in ${(f.arrives - game.hour).toFixed(1)} hours`} onPress={() => { setContact(f.id); onInspectFleet?.(); }} style={[styles.hauler, { left: `${location.x}%`, top: `${location.y}%` }]}><View style={[styles.contactRing, { borderColor: contact === f.id ? FACTIONS[f.owner].color : 'transparent' }]} /></Pressable>;
    }))}
    <View style={styles.zoom}><MapControl label="Zoom out" text="−" disabled={camera.scale <= 1} onPress={() => current.current.onChange(zoomCamera(game, camera, camera.scale - 0.5))} /><MapControl label="Zoom in" text="+" disabled={camera.scale >= 4} onPress={() => current.current.onChange(zoomCamera(game, camera, camera.scale + 0.5))} /><MapControl label="Focus your territory" text="Home" onPress={() => { const home = fitPlayerCamera(game, player ?? 'you'); move(home.scale, home.x, home.y); }} /><MapControl label="Fit chart" text="Fit" onPress={() => move(1, 0, 0)} /></View>
    {fleet && <View style={styles.inspector}>
      <View style={styles.contactHeading}><Text style={[styles.contactTitle, { color: FACTIONS[fleet.owner].color }]}>{FACTIONS[fleet.owner].name} · hauler</Text><MapControl label="Close hauler details" text="×" onPress={() => setContact(undefined)} /></View>
      <Text style={styles.contactText}>{fleet.drones} drones{fleet.module ? ` · ${MODULES[fleet.module].name}` : ''}</Text>
      <Text style={styles.contactText}>{fleet.specialists?.map(u => `${SPECIALISTS[u.kind].name}${u.captive ? ' (captive)' : ''}`).join(', ')}</Text>
      <Text style={styles.contactText}>{game.rocks.find(r => r.id === fleet.from)?.name} → {flightDestination(game.rocks, fleet)}</Text>
      <Text style={styles.contactText}>{fleet.intercept ? 'Interception' : 'Arrival'} in {Math.max(0, (fleet.arrives - game.hour) * 60).toFixed(0)} minutes</Text>
      <View style={styles.actions}>
        {timeInspection && <MapControl label={fleet.intercept ? 'Jump to interception' : 'Jump to hauler arrival'} text={fleet.intercept ? 'Jump to interception' : 'Jump to arrival'} disabled={arrival === undefined} onPress={() => { if (arrival !== undefined) { timeInspection.onInspect(arrival); setContact(undefined); } }} />}
        {fleet.owner === player && onManageFleet && <MapControl label="Manage this hauler" text="Manage orders" onPress={() => { onManageFleet(fleet.id); setContact(undefined); }} />}
        <MapControl label="Inspect hauler destination" text="Inspect destination" onPress={() => { const target = game.rocks.find(r => r.id === fleet.to); if (target) onSelect(target); setContact(undefined); }} />
      </View>
      {timeInspection && <Text style={styles.contactText}>{arrival === undefined ? 'Arrival is outside the available time range.' : 'Earlier combat and new orders can change this arrival.'}</Text>}
    </View>}
    <View pointerEvents="none" style={styles.coordinates}><Text style={styles.coord}>SECTOR 07—B</Text><Text style={styles.coord}>2.8 AU / OUTER BELT</Text></View>
  </View>;
}
function MapControl({ label, text, disabled, onPress }: { label: string; text: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.mapControl, disabled && { opacity: 0.35 }]}><Text style={styles.contactText}>{text}</Text></Pressable>;
}
const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  zoom: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', gap: 4 }, mapControl: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#15241a', borderWidth: 1, borderColor: '#40563a' },
  hauler: { position: 'absolute', width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: 'center', justifyContent: 'center' }, contactRing: { width: 25, height: 25, borderWidth: 1, borderRadius: 20 }, inspector: { position: 'absolute', bottom: 10, left: 10, right: 10, padding: 12, gap: 6, backgroundColor: '#101e15', borderWidth: 1, borderColor: '#526644' }, contactHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, contactTitle: { fontSize: 14, flex: 1 }, contactText: { color: '#d6e2cd', fontSize: 12, lineHeight: 18 },
  chart: { width: '100%', height: 480, overflow: 'hidden', backgroundColor: '#0b1412', borderWidth: 1, borderColor: '#25322b' },
  rock: { position: 'absolute', width: 78, height: 70, marginLeft: -39, marginTop: -26, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 38, height: 38, borderRadius: 30, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stone: { width: 23, height: 23, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 9, letterSpacing: 0.5, marginTop: 1 }, count: { fontSize: 10, fontVariant: ['tabular-nums'], marginTop: 2 },
  coordinates: { position: 'absolute', top: 15, left: 15, gap: 4 }, coord: { fontSize: 8, letterSpacing: 1.4, color: '#5e7366' },
});
