/**
 * ---
 * purpose: Touch-selectable belt chart with ownership, transfer trajectories, and accessible rock controls.
 * ---
 */
import { DriftCourse } from './DriftCourse';
import { stationCourse } from '../game/drift';
import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Text, StyleSheet, PanResponder } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { flightDestination, flightEndpoints, fleetPosition } from '../game/flight';
import { SPECIALISTS } from '../game/specialist-catalog';
import { MODULES } from '../game/modules';
import { arrivalInspection } from '../game/time-machine';
import { remoteSiteDescription } from './site-observation';
import { CopyObjectReference } from './CopyObjectReference';
import { FactionEmblem, PlayerIdentity, usePlayerRoster } from './PlayerIdentity';
import { FACTIONS, type Faction, type Fleet, type Rock } from '../game/simulation';

import { constrainCamera, fitPlayerCamera, zoomCamera, type MapCamera } from '../game/chart-camera';

import { mapOffsets, wrappedBounds, type MapGeometry, type Point } from '../game/geometry';
import { chartPosition, chartRoute } from '../game/chart-projection';

type ChartRock = Omit<Rock, 'owner' | 'drones' | 'kind'> & { kind: Rock['kind'] | 'unknown'; owner?: Faction | null; drones?: number; known?: boolean };
export type { MapCamera } from '../game/chart-camera';
type Props<T extends ChartRock> = { game: { epoch?: number; hour: number; rocks: T[]; fleets: Fleet[]; rules?: { map: MapGeometry }; coverage?: { x: number; y: number; radius: number }[] }; selected: string; destination?: string; transferRoute?: { from: Point; to: Point }; onSelect: (rock: T) => void; onTransfer?: (from: T, to: T) => void; fill?: boolean; viewport?: { camera: MapCamera; onChange: (camera: MapCamera) => void }; player?: Faction; onInspectFleet?: () => void; onManageFleet?: (id: number) => void; inspectFleet?: { request: number; id?: number }; fleetReference?: (fleet: Fleet) => string | undefined; timeInspection?: { liveHour: number; historyStart?: number; onInspect: (hour: number | null) => void } };
export function BeltMap<T extends ChartRock>({ game, selected, destination, transferRoute, onSelect, onTransfer, fill, viewport, player, onInspectFleet, onManageFleet, inspectFleet, fleetReference, timeInspection }: Props<T>) {
  const identity = usePlayerRoster();
  const [localCamera, setLocalCamera] = useState<MapCamera>(() => fitPlayerCamera(game, player ?? 'you'));
  useEffect(() => { if (!viewport) setLocalCamera(fitPlayerCamera(game, player ?? 'you')); }, [game.epoch, player]);
  const camera = constrainCamera(game, viewport?.camera ?? localCamera);
  const [size, setSize] = useState({ width: 400, height: 480 });
  const [contact, setContact] = useState<number>();
  useEffect(() => setContact(undefined), [game.epoch, player]);
  useEffect(() => { if (inspectFleet) setContact(inspectFleet.id); }, [inspectFleet?.request]);
  const map = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const touchStart = useRef<{ x: number; y: number } | undefined>(undefined);
  type Drag = { from: T; startX: number; startY: number; x: number; y: number; target?: T };
  const [drag, setDrag] = useState<Drag>();
  const dragging = useRef<Drag | undefined>(undefined);
  const commands = useRef({ game, player, onTransfer });
  commands.current = { game, player, onTransfer };
  function siteAt(pageX: number, pageY: number): T | undefined {
    const state = current.current;
    const local = { x: pageX - origin.current.x, y: pageY - origin.current.y };
    let nearest: T | undefined, distance = 30;
    for (const offset of mapOffsets(state.world)) for (const rock of commands.current.game.rocks) {
      const point = chartPosition(state.world, state.camera, { x: rock.x + offset.x, y: rock.y + offset.y });
      const delta = Math.hypot(point.x / 100 * state.size.width - local.x, point.y / 100 * state.size.height - local.y);
      if (delta < distance) { nearest = rock; distance = delta; }
    }
    return nearest;
  }
  function sourceAt(x: number, y: number) {
    const source = siteAt(x, y);
    return commands.current.onTransfer && source && source.owner === commands.current.player && !source.destroyed ? source : undefined;
  }
  const current = useRef({ camera, size, wrapped: !!wrappedBounds(game), world: game, onChange: viewport?.onChange ?? setLocalCamera });
  current.current = { camera, size, wrapped: !!wrappedBounds(game), world: game, onChange: viewport?.onChange ?? setLocalCamera };
  const start = useRef({ ...camera, pinch: 0, dx: 0, dy: 0 });
  function move(scale: number, x: number, y: number) {
    current.current.onChange(constrainCamera(current.current.world, { scale, x, y }));
  }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: event => {
      const touch = event.nativeEvent.touches[0];
      if (event.nativeEvent.touches.length === 1 && touch) touchStart.current = { x: touch.pageX, y: touch.pageY };
      return false;
    },
    onMoveShouldSetPanResponderCapture: (event, gesture) => event.nativeEvent.touches.length === 1 && Math.hypot(gesture.dx, gesture.dy) > 8 && !!touchStart.current && !!sourceAt(touchStart.current.x, touchStart.current.y),
    onMoveShouldSetPanResponder: (event, gesture) => event.nativeEvent.touches.length > 1 || (current.current.wrapped || current.current.camera.scale > 1) && Math.hypot(gesture.dx, gesture.dy) > 6,
    onPanResponderGrant: (event, gesture) => {
      const first = touchStart.current ?? { x: gesture.x0, y: gesture.y0 };
      const from = event.nativeEvent.touches.length === 1 ? sourceAt(first.x, first.y) : undefined;
      const x = first.x - origin.current.x, y = first.y - origin.current.y;
      dragging.current = from ? { from, startX: x, startY: y, x, y } : undefined;
      setDrag(dragging.current);
      const [a, b] = event.nativeEvent.touches;
      start.current = { ...current.current.camera, pinch: a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0, dx: gesture.dx, dy: gesture.dy };
    },
    onPanResponderStart: (event, gesture) => {
      const [a, b] = event.nativeEvent.touches;
      if (a && b) {
        dragging.current = undefined; setDrag(undefined);
        start.current = { ...current.current.camera, pinch: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), dx: gesture.dx, dy: gesture.dy };
      }
    },
    onPanResponderMove: (event, gesture) => {
      const [a, b] = event.nativeEvent.touches;
      if (a && b) {
        dragging.current = undefined; setDrag(undefined);
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        if (!start.current.pinch) start.current = { ...current.current.camera, pinch: distance, dx: gesture.dx, dy: gesture.dy };
        current.current.onChange(zoomCamera(current.current.world, start.current, start.current.scale * distance / start.current.pinch));
      } else if (dragging.current) {
        const next = { ...dragging.current, x: gesture.moveX - origin.current.x, y: gesture.moveY - origin.current.y, target: siteAt(gesture.moveX, gesture.moveY) };
        dragging.current = next; setDrag(next);
      } else move(start.current.scale, start.current.x + (gesture.dx - start.current.dx) / current.current.size.width * 100, start.current.y + (gesture.dy - start.current.dy) / current.current.size.height * 100);
    },
    onPanResponderEnd: (event, gesture) => {
      if (event.nativeEvent.touches.length === 1) start.current = { ...current.current.camera, pinch: 0, dx: gesture.dx, dy: gesture.dy };
    },
    onPanResponderRelease: (_event, gesture) => {
      const from = dragging.current?.from;
      const to = siteAt(gesture.moveX, gesture.moveY);
      dragging.current = undefined; setDrag(undefined);
      if (from && to && from.id !== to.id && !to.destroyed) commands.current.onTransfer?.(from, to);
    },
    onPanResponderTerminate: () => { dragging.current = undefined; setDrag(undefined); },
    onPanResponderTerminationRequest: () => !dragging.current,
  })).current;
  const width = game.rules?.map.width ?? 100;
  const height = game.rules?.map.height ?? 100;
  const sx = 400 / width, sy = 480 / height;
  const offsets = mapOffsets(game);
  const position = (point: { x: number; y: number }) => chartPosition(game, camera, point);
  const fleet = game.fleets.find(f => f.id === contact);
  const reference = fleet && fleetReference?.(fleet);
  const arrival = fleet && timeInspection ? arrivalInspection(timeInspection.liveHour, timeInspection.historyStart, fleet.arrives) : undefined;
  const measure = () => map.current?.measureInWindow((x, y) => { origin.current = { x, y }; });
  return <View ref={map} testID="belt-map" style={[styles.chart, fill && { flex: 1, height: '100%' }]} onTouchStart={measure} onLayout={event => { setSize(event.nativeEvent.layout); measure(); }} {...pan.panHandlers}>
    <Svg width="100%" height="100%" viewBox="0 0 400 480" preserveAspectRatio="none" pointerEvents="none">
      {Array.from({ length: 65 }, (_, i) => <Circle key={i} cx={(i * 137.5) % 400} cy={(i * 79.7) % 480} r={i % 4 === 0 ? 1 : 0.5} fill="#b5c7bd" opacity={0.12 + (i % 3) * 0.09} />)}
      <G transform={`translate(${200 + camera.x * 4}, ${240 + camera.y * 4.8}) scale(${camera.scale}) translate(-200, -240)`}>
      {offsets.map((offset, tile) => <G key={tile} transform={`translate(${offset.x * sx}, ${offset.y * sy})`}>
      {game.coverage?.map((sensor, i) => <Ellipse key={`sensor-${i}`} cx={sensor.x * sx} cy={sensor.y * sy} rx={sensor.radius * sx} ry={sensor.radius * sy} fill={identity(player ?? 'you').color} fillOpacity="0.025" stroke={identity(player ?? 'you').color} strokeOpacity="0.12" strokeWidth="0.7" />)}
      {[90, 150, 215, 285].map(r => <Ellipse key={r} cx="204" cy="243" rx={r} ry={r * 0.91} stroke="#26332e" strokeWidth="0.7" fill="none" strokeDasharray="3 7" />)}
      <Circle cx="204" cy="243" r="30" fill="#9c744a" opacity="0.025" />
      <Circle cx="204" cy="243" r="14" fill="#9c744a" opacity="0.06" />
      <Circle cx="204" cy="243" r="5" fill="#c9a06b" opacity="0.65" />
      <SvgText x="204" y="265" textAnchor="middle" fill="#6b746c" fontSize="7" letterSpacing="2">SOL / 04</SvgText>
      {game.rocks.filter(r => r.drift).map(site => <DriftCourse key={`drift-${site.id}`} site={site} sx={sx} sy={sy} selected={site.id === selected || site.id === destination} />)}
      {game.fleets.map(f => {
        const { from: a, to: b } = flightEndpoints(game, f);
        const position = fleetPosition(game, f);
        const x = position.x * sx; const y = position.y * sy;
        return <React.Fragment key={f.id}>
          <Line x1={a.x * sx} y1={a.y * sy} x2={b.x * sx} y2={b.y * sy} stroke={identity(f.owner).color} opacity="0.35" strokeDasharray="3 4" />
          {f.intercept && <Circle cx={x} cy={y} r="6" fill="none" stroke={identity(f.owner).color} strokeWidth="0.7" />}
          <Path d={`M ${x} ${y - 4} l 4 8 l -8 0 Z`} fill={identity(f.owner).color} />
        </React.Fragment>;
      })}
      {destination && (() => {
        const source = game.rocks.find(r => r.id === selected);
        const target = game.rocks.find(r => r.id === destination);
        if (!source || !target) return null;
        const { from: a, to: b } = transferRoute ?? (source.drift || target.drift ? stationCourse(game, source, target, 8, game.hour + 1 / 6).route : chartRoute(game, source, target));
        return <Line x1={a.x * sx} y1={a.y * sy} x2={b.x * sx} y2={b.y * sy} stroke={identity(player ?? 'you').color} strokeDasharray="5 4" />;
      })()}
      </G>)}
      </G>
      {drag && <Line x1={drag.startX / size.width * 400} y1={drag.startY / size.height * 480} x2={drag.x / size.width * 400} y2={drag.y / size.height * 480} stroke={identity(player ?? 'you').color} strokeWidth="2" strokeDasharray="5 3" />}
    </Svg>
    {offsets.flatMap((offset, tile) => game.rocks.map(rock => {
      const color = rock.owner ? identity(rock.owner).color : '#7d8b83';
      const active = selected === rock.id || destination === rock.id || drag?.from.id === rock.id || drag?.target?.id === rock.id;
      const location = position({ x: rock.x + offset.x, y: rock.y + offset.y });
      if (location.x < -15 || location.x > 115 || location.y < -15 || location.y > 115) return null;
      return <Pressable key={`${tile}-${rock.id}`} accessibilityRole="button" accessibilityLabel={`${rock.name}, ${rock.drift ? 'drifting asteroid base, 12 chart units per day, ' : ''}${rock.destroyed ? 'destroyed site' : rock.kind}${rock.coreOf ? ", intelligence core" : ""}, ${rock.known === false ? remoteSiteDescription(rock) : `${rock.owner ? FACTIONS[rock.owner].name : 'unclaimed'}, ${Math.floor(rock.drones ?? 0)} drones`}${rock.known !== false && rock.shieldMax !== undefined ? rock.shieldsDisabled ? ', shields disabled' : `, shield charge ${Math.floor(rock.shield ?? 0)}` : ''}${destination === rock.id ? ', transfer destination' : selected === rock.id ? ', selected site' : ''}${rock.module ? `, ${MODULES[rock.module].name}` : ''}${rock.specialists?.length ? `, ${rock.specialists.map(u => SPECIALISTS[u.kind].name).join(', ')}` : ''}`} accessibilityState={{ selected: active }} onPress={() => { setContact(undefined); onSelect(rock); }} style={[styles.rock, { left: `${location.x}%`, top: `${location.y}%` }]}>
        <View style={[styles.ring, { borderColor: color, borderWidth: active ? 3 : 1, backgroundColor: active ? `${color}10` : 'transparent' }]}>
          <View style={[styles.stone, rock.drift && styles.asteroid, { borderColor: color, backgroundColor: `${color}18`, transform: [{ rotate: rock.kind === 'core' ? '0deg' : '25deg' }] }]}>
            <Text style={{ color, fontSize: 11 }}>{rock.destroyed ? '×' : rock.kind === 'unknown' ? '?' : rock.coreOf || rock.kind === 'core' ? '◈' : rock.kind === 'reactor' || rock.kind === 'generator' ? 'ϟ' : rock.kind === 'factory' ? '▥' : '·'}</Text>
          </View>
          {!!rock.owner && <View style={styles.ownerEmblem}><FactionEmblem faction={rock.owner} size={12} /><Text style={[styles.ownerCode, { color }]}>{FACTIONS[rock.owner].code}</Text></View>}
        </View>
        {rock.known !== false && rock.shieldMax !== undefined && <Text style={[styles.defense, { color: rock.shieldsDisabled ? '#9ca79c' : '#e0d7ad' }]}>{rock.shieldsDisabled ? 'Shield off' : `◇ ${Math.floor(rock.shield ?? 0)}`}</Text>}
        {(!destination || active) && <><Text style={[styles.name, { color: active ? '#eff4e9' : color }]}>{rock.name}</Text>
        {rock.drift && <Text style={styles.driftLabel}>↗ drifting asteroid</Text>}
        <Text style={[styles.count, { color }]}>{rock.known === false ? '?' : Math.floor(rock.drones ?? 0)}{rock.module ? ` · ${MODULES[rock.module].code}` : ''}{rock.specialists?.length ? ` · ${rock.specialists.length}u` : ''}</Text></>}
      </Pressable>;
    }))}
    {offsets.flatMap((offset, tile) => game.fleets.map(f => {
      const point = fleetPosition(game, f);
      const location = position({ x: point.x + offset.x, y: point.y + offset.y });
      if (location.x < -10 || location.x > 110 || location.y < -10 || location.y > 110) return null;
      return <Pressable key={`contact-${tile}-${f.id}`} accessibilityRole="button" accessibilityLabel={`${FACTIONS[f.owner].name} hauler${f.preparing ? ", preparing launch" : ""}, ${f.drones} drones, ${flightDestination(game.rocks, f)}, arrives in ${(f.arrives - game.hour).toFixed(1)} hours`} onPress={() => { setContact(f.id); onInspectFleet?.(); }} style={[styles.hauler, { left: `${location.x}%`, top: `${location.y}%` }]}><View style={[styles.contactRing, { borderColor: contact === f.id ? '#e5eadc' : identity(f.owner).color, backgroundColor: identity(f.owner).color }]}><Text style={styles.fleetCount}>{f.drones}</Text></View></Pressable>;
    }))}
    <View style={[styles.zoom, size.height < 240 && { width: 192, flexWrap: 'nowrap' }]}><MapControl label="Zoom out" text="−" disabled={camera.scale <= 1} onPress={() => current.current.onChange(zoomCamera(game, camera, camera.scale - 0.5))} /><MapControl label="Zoom in" text="+" disabled={camera.scale >= 4} onPress={() => current.current.onChange(zoomCamera(game, camera, camera.scale + 0.5))} /><MapControl label="Focus your territory" text="⌂" onPress={() => { const home = fitPlayerCamera(game, player ?? 'you'); move(home.scale, home.x, home.y); }} /><MapControl label="Fit chart" text="⊡" onPress={() => move(1, 0, 0)} /></View>
    {fleet && <View style={styles.inspector}>
      <View style={styles.contactHeading}><PlayerIdentity faction={fleet.owner} detail="Hauler" size={36} /><MapControl label="Close hauler details" text="×" onPress={() => setContact(undefined)} /></View>
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
      {reference && <CopyObjectReference value={reference} label="Copy hauler reference" />}
    </View>}
    <View pointerEvents="none" style={styles.coordinates}><Text style={styles.coord}>{destination ? '' : drag ? `Release at ${drag.target?.name ?? 'a destination'}` : onTransfer ? 'Drag from your site to set a course' : 'Pinch to zoom · tap to inspect'}</Text></View>
  </View>;
}
function MapControl({ label, text, disabled, onPress }: { label: string; text: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.mapControl, disabled && { opacity: 0.35 }]}><Text style={styles.contactText}>{text}</Text></Pressable>;
}
const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  zoom: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', flexWrap: 'wrap', width: 96, gap: 4 }, mapControl: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#15241a', borderWidth: 1, borderColor: '#40563a' },
  hauler: { position: 'absolute', width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: 'center', justifyContent: 'center' }, contactRing: { minWidth: 32, height: 24, paddingHorizontal: 4, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, fleetCount: { color: '#08100b', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }, inspector: { position: 'absolute', bottom: 10, left: 10, right: 10, padding: 12, gap: 6, backgroundColor: '#101e15', borderWidth: 1, borderColor: '#526644' }, contactHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, contactTitle: { fontSize: 14, flex: 1 }, contactText: { color: '#d6e2cd', fontSize: 12, lineHeight: 18 },
  chart: { width: '100%', height: 480, overflow: 'hidden', backgroundColor: '#0b1412', borderWidth: 1, borderColor: '#25322b' },
  rock: { position: 'absolute', width: 84, height: 82, marginLeft: -42, marginTop: -28, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 44, height: 44, borderRadius: 30, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ownerEmblem: { position: 'absolute', right: 0, bottom: 0, backgroundColor: '#0b1412', borderRadius: 2, flexDirection: 'row', alignItems: 'center' }, ownerCode: { fontSize: 7 },
  stone: { width: 23, height: 23, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  asteroid: { width: 17, height: 15, borderRadius: 4, borderTopLeftRadius: 9, borderBottomRightRadius: 7 }, driftLabel: { color: '#d5b987', fontSize: 8 },
  defense: { position: 'absolute', top: 0, right: 0, fontSize: 10, backgroundColor: '#0b1412' },
  name: { fontSize: 10, letterSpacing: 0.5, marginTop: 1 }, count: { position: 'absolute', left: 66, top: 16, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  coordinates: { position: 'absolute', bottom: 12, left: 12, gap: 4 }, coord: { fontSize: 11, color: '#a0af9e' },
});
