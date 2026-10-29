/**
 * ---
 * purpose: Touch-selectable belt chart with ownership, transfer trajectories, and accessible rock controls.
 * ---
 */
import { HaulerCombat, type CombatObservation } from './HaulerCombat';
import { DriftCourse } from './DriftCourse';
import { SpaceBackground } from './SpaceBackground';
import { stationCourse } from '../game/drift';
import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, Text, Image, StyleSheet, PanResponder, Platform } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { flightDestination, flightEndpoints, fleetPosition } from '../game/flight';
import { SPECIALISTS } from '../game/specialist-catalog';
import { MODULES } from '../game/modules';
import { arrivalInspection } from '../game/time-machine';
import { remoteSiteDescription } from './site-observation';
import { CopyObjectReference } from './CopyObjectReference';
import { PlayerIdentity, usePlayerRoster } from './PlayerIdentity';
import { FACTIONS, type Faction, type Fleet, type Rock } from '../game/simulation';

import { constrainCamera, fitPlayerCamera, zoomCamera, type MapCamera } from '../game/chart-camera';

import { wrappedBounds, type MapGeometry, type Point } from '../game/geometry';
import { chartOffsets, chartPosition, chartRoute, chartTransform, overlayLift, revealAboveCamera } from '../game/chart-projection';
import { layoutSiteNames } from './map-labels';
import { mapShields } from './map-shields';

type ChartRock = Omit<Rock, 'owner' | 'drones' | 'kind'> & { kind: Rock['kind'] | 'unknown'; owner?: Faction | null; drones?: number; known?: boolean };
export type { MapCamera } from '../game/chart-camera';
const baseIcons = {
  factory: require('../../assets/bases/factory.png'),
  generator: require('../../assets/bases/generator.png'),
  mine: require('../../assets/bases/mine.png'),
};
const INSPECTOR_CHART_SPACE = 44 + 20;
function siteIcon(rock: Pick<ChartRock, 'destroyed' | 'kind'>) {
  if (rock.destroyed || rock.kind === 'unknown') return undefined;
  const kind = rock.kind === 'core' ? 'factory' : rock.kind === 'reactor' ? 'generator' : rock.kind;
  return baseIcons[kind];
}
type Props<T extends ChartRock> = { game: { epoch?: number; hour: number; rocks: T[]; fleets: Fleet[]; rules?: { map: MapGeometry }; coverage?: { x: number; y: number; radius: number }[] }; selected: string; inspecting?: boolean; destination?: string; transferRoute?: { from: Point; to: Point }; onSelect: (rock: T) => void; onTransfer?: (from: T, to: T) => void; fill?: boolean; viewport?: { camera: MapCamera; onChange: (camera: MapCamera) => void }; player?: Faction; onInspectFleet?: () => void; onManageFleet?: (id: number) => void; inspectFleet?: { request: number; id?: number }; fleetReference?: (fleet: Fleet) => string | undefined; combatObservation?: CombatObservation; timeInspection?: { liveHour: number; historyStart?: number; onInspect: (hour: number | null) => void } };
export function BeltMap<T extends ChartRock>({ game, selected, inspecting = false, destination, transferRoute, onSelect, onTransfer, fill, viewport, player, onInspectFleet, onManageFleet, inspectFleet, fleetReference, combatObservation, timeInspection }: Props<T>) {
  const identity = usePlayerRoster();
  const [localCamera, setLocalCamera] = useState<MapCamera>(() => fitPlayerCamera(game, player ?? 'you'));
  useEffect(() => { if (!viewport) setLocalCamera(fitPlayerCamera(game, player ?? 'you')); }, [game.epoch, player]);
  const [size, setSize] = useState({ width: 400, height: 480 });
  const [contact, setContact] = useState<number>();
  const fleet = game.fleets.find(f => f.id === contact);
  const [card, setCard] = useState<{ id: number; height: number }>();
  const lift = card && card.id === fleet?.id ? overlayLift(game, size, card.height + styles.inspector.bottom) : 0;
  const camera = constrainCamera(game, viewport?.camera ?? localCamera, lift);
  const [mapTools, setMapTools] = useState(Platform.OS === 'web');
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
    for (const offset of chartOffsets(state.world, state.camera, state.size)) for (const rock of commands.current.game.rocks) {
      const point = chartPosition(state.world, state.camera, { x: rock.x + offset.x, y: rock.y + offset.y }, state.size);
      const delta = Math.hypot(point.x / 100 * state.size.width - local.x, point.y / 100 * state.size.height - local.y);
      if (delta < distance) { nearest = rock; distance = delta; }
    }
    return nearest;
  }
  function sourceAt(x: number, y: number) {
    const source = siteAt(x, y);
    return commands.current.onTransfer && source && source.owner === commands.current.player && !source.destroyed ? source : undefined;
  }
  const current = useRef({ camera, size, lift, wrapped: !!wrappedBounds(game), world: game, onChange: viewport?.onChange ?? setLocalCamera });
  current.current = { camera, size, lift, wrapped: !!wrappedBounds(game), world: game, onChange: viewport?.onChange ?? setLocalCamera };
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = map.current as unknown as HTMLElement | null;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const target = event.target as Element | null;
      if (!event.deltaY || dragging.current || target?.closest('[data-testid="hauler-inspector"], [data-testid="map-controls"]')) return;
      event.preventDefault();
      const state = current.current;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.size.height : 1;
      const delta = Math.max(-120, Math.min(120, event.deltaY * units));
      const next = zoomCamera(state.world, state.camera, state.camera.scale * Math.exp(-delta * 0.002), state.lift);
      current.current.camera = next;
      state.onChange(next);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const start = useRef({ ...camera, pinch: 0, dx: 0, dy: 0 });
  function move(scale: number, x: number, y: number) {
    current.current.onChange(constrainCamera(current.current.world, { scale, x, y }, current.current.lift));
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
        current.current.onChange(zoomCamera(current.current.world, start.current, start.current.scale * distance / start.current.pinch, current.current.lift));
      } else if (dragging.current) {
        const next = { ...dragging.current, x: gesture.moveX - origin.current.x, y: gesture.moveY - origin.current.y, target: siteAt(gesture.moveX, gesture.moveY) };
        dragging.current = next; setDrag(next);
      } else {
        const state = current.current;
        const base = chartTransform(state.world, { scale: 1, x: 0, y: 0 }, state.size);
        const width = state.world.rules?.map.width ?? 100, height = state.world.rules?.map.height ?? 100;
        move(start.current.scale, start.current.x + (gesture.dx - start.current.dx) / (width * base.scale) * 100, start.current.y + (gesture.dy - start.current.dy) / (height * base.scale) * 100);
      }
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
  const projection = chartTransform(game, camera, size);
  const sx = projection.scale, sy = projection.scale;
  const offsets = chartOffsets(game, camera, size);
  const position = (point: { x: number; y: number }) => chartPosition(game, camera, point, size);
  const sites = offsets.flatMap((offset, tile) => game.rocks.map(rock => {
    const location = position({ x: rock.x + offset.x, y: rock.y + offset.y });
    const active = ((inspecting || !!destination) && selected === rock.id) || destination === rock.id || drag?.from.id === rock.id || drag?.target?.id === rock.id;
    const shields = mapShields(rock);
    const radius = shields.at(-1)?.radius ?? 18;
    return { key: `${tile}-${rock.id}`, rock, location, active, shields, radius, x: location.x / 100 * size.width, y: location.y / 100 * size.height, priority: active ? 1000 : rock.owner === player ? 100 : rock.owner ? 50 : 0 };
  })).filter(site => site.location.x >= -15 && site.location.x <= 115 && site.location.y >= -15 && site.location.y <= 115);
  const names = layoutSiteNames(sites, size);
  const reference = fleet && fleetReference?.(fleet);
  const revealed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!fleet) { revealed.current = undefined; return; }
    const key = `${fleet.id}:${inspectFleet?.request ?? 0}:${size.width}:${size.height}:${card?.height}`;
    if (card?.id !== fleet.id || revealed.current === key) return;
    revealed.current = key;
    const state = current.current;
    const next = revealAboveCamera(state.world, state.camera, fleetPosition(state.world, fleet), state.size, card.height + styles.inspector.bottom);
    if (next !== state.camera) state.onChange(next);
  }, [fleet?.id, card, inspectFleet?.request, size.width, size.height]);
  const arrival = fleet && timeInspection ? arrivalInspection(timeInspection.liveHour, timeInspection.historyStart, fleet.arrives) : undefined;
  const measure = () => map.current?.measureInWindow((x, y) => { origin.current = { x, y }; });
  return <View ref={map} testID="belt-map" style={[styles.chart, fill && { flex: 1, height: '100%' }]} onTouchStart={measure} onLayout={event => { setSize(event.nativeEvent.layout); measure(); }} {...pan.panHandlers}>
    <SpaceBackground />
    <Svg width="100%" height="100%" viewBox={`0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`} pointerEvents="none">
      <G transform={`translate(${projection.x}, ${projection.y})`}>
      {offsets.map((offset, tile) => <G key={tile} transform={`translate(${offset.x * sx}, ${offset.y * sy})`}>
      {game.coverage?.map((sensor, i) => {
        const site = game.rocks.find(rock => rock.id === selected);
        const focused = inspecting && site && Math.hypot(site.x - sensor.x, site.y - sensor.y) < 0.01;
        return <Circle key={`sensor-${i}`} cx={sensor.x * sx} cy={sensor.y * sy} r={sensor.radius * projection.scale} fill="#58777e" fillOpacity="0.045" stroke={focused ? '#809c9e' : 'none'} strokeOpacity="0.3" strokeWidth="0.8" />;
      })}
      {game.rocks.filter(r => r.drift && (inspecting || !!destination) && (r.id === selected || r.id === destination)).map(site => <DriftCourse key={`drift-${site.id}`} site={site} sx={sx} sy={sy} selected />)}
      {game.fleets.map(f => {
        const { from: a, to: b } = flightEndpoints(game, f);
        return <Line key={f.id} x1={a.x * sx} y1={a.y * sy} x2={b.x * sx} y2={b.y * sy} stroke={identity(f.owner).color} opacity={contact === f.id ? 0.8 : 0.3} strokeWidth={contact === f.id ? 1.3 : 0.7} />;
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
      {sites.map(({ key, x, y, shields }) => shields.length > 0 && <G key={`shields-${key}`} transform={`translate(${x}, ${y})`}>
        {shields.map(arc => <Path key={arc.radius} d={arc.path} fill="none" stroke="#b6c3c5" strokeOpacity={0.65} strokeWidth={1.2} strokeLinecap="round" />)}
      </G>)}
      {drag && <Line x1={drag.startX} y1={drag.startY} x2={drag.x} y2={drag.y} stroke={identity(player ?? 'you').color} strokeWidth="2" strokeDasharray="5 3" />}
    </Svg>
    {sites.map(({ key, rock, location, active, radius }) => {
      const color = rock.owner ? identity(rock.owner).color : '#68777b';
      const icon = siteIcon(rock);
      const namePlacement = names.get(key);
      return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${rock.name}, ${rock.drift ? 'drifting asteroid base, 12 chart units per day, ' : ''}${rock.destroyed ? 'destroyed site' : rock.kind}${rock.coreOf ? ", intelligence core" : ""}, ${rock.known === false ? remoteSiteDescription(rock) : `${rock.owner ? FACTIONS[rock.owner].name : 'unclaimed'}, ${Math.floor(rock.drones ?? 0)} drones`}${rock.known !== false && rock.shieldMax !== undefined ? rock.shieldsDisabled ? ', shields disabled' : `, shield charge ${Math.floor(rock.shield ?? 0)}` : ''}${destination === rock.id ? ', transfer destination' : active && selected === rock.id ? ', selected site' : ''}${rock.module ? `, ${MODULES[rock.module].name}` : ''}${rock.specialists?.length ? `, ${rock.specialists.map(u => SPECIALISTS[u.kind].name).join(', ')}` : ''}`} accessibilityState={{ selected: active }} onPress={() => { setContact(undefined); onSelect(rock); }} style={[styles.rock, { left: `${location.x}%`, top: `${location.y}%` }]}>
        <View style={[styles.ring, { borderColor: active ? '#dce7e5' : 'transparent', borderWidth: 1.5, backgroundColor: 'transparent' }]}>
          <View style={[styles.stone, rock.drift && styles.asteroid, { borderColor: color, backgroundColor: rock.owner ? color : '#16262c' }, icon && styles.emblemStone, icon && rock.drift && styles.driftingEmblem]}>
            {icon ? <Image accessible={false} source={icon} resizeMode="contain" style={[styles.baseIcon, { tintColor: rock.owner ? color : '#829195' }]} /> : <Text style={{ color: rock.owner ? '#101d24' : '#829195', fontSize: 15 }}>{rock.destroyed ? '×' : '?'}</Text>}
            {icon && (rock.coreOf || rock.kind === 'core') && <Text accessible={false} style={[styles.coreBadge, { color }]}>◈</Text>}
          </View>
        </View>
        {namePlacement && (!destination || active) && <Text numberOfLines={1} style={[styles.name, { top: namePlacement === 'above' ? 6 - radius : 24 + radius }, active && { color: '#e1e8e7' }]}>{rock.name}</Text>}
        {rock.known !== false && (rock.drones ?? 0) > 0 && <Text style={styles.count}>{Math.floor(rock.drones ?? 0)}</Text>}
      </Pressable>;
    })}
    {offsets.flatMap((offset, tile) => game.fleets.map(f => {
      const point = fleetPosition(game, f);
      const location = position({ x: point.x + offset.x, y: point.y + offset.y });
      if (location.x < -10 || location.x > 110 || location.y < -10 || location.y > 110) return null;
      return <Pressable key={`contact-${tile}-${f.id}`} accessibilityRole="button" accessibilityLabel={`${FACTIONS[f.owner].name} hauler${f.preparing ? ", preparing launch" : ""}, ${f.drones} drones, ${flightDestination(game.rocks, f)}, arrives in ${(f.arrives - game.hour).toFixed(1)} hours`} onPress={() => { setContact(f.id); onInspectFleet?.(); }} style={[styles.hauler, { left: `${location.x}%`, top: `${location.y}%` }]}><View style={[styles.contactRing, { borderColor: contact === f.id ? '#e5eadc' : identity(f.owner).color, backgroundColor: identity(f.owner).color }]}><Text style={styles.fleetCount}>{f.drones}</Text></View></Pressable>;
    }))}
    <View testID="map-controls" style={styles.zoom}><MapControl label={mapTools ? "Close map controls" : "Map controls"} text={mapTools ? "×" : "⌖"} onPress={() => setMapTools(!mapTools)} />{mapTools && <><MapControl label="Zoom out" text="−" disabled={camera.scale <= 1} onPress={() => current.current.onChange(zoomCamera(game, camera, camera.scale - 0.5, lift))} /><MapControl label="Zoom in" text="+" disabled={camera.scale >= 4} onPress={() => current.current.onChange(zoomCamera(game, camera, camera.scale + 0.5, lift))} /><MapControl label="Focus your territory" text="⌂" onPress={() => { const home = fitPlayerCamera(game, player ?? 'you'); move(home.scale, home.x, home.y); }} /><MapControl label="Fit chart" text="⊡" onPress={() => move(1, 0, 0)} /></>}</View>
    {fleet && <ScrollView testID="hauler-inspector" style={[styles.inspector, { maxHeight: Math.max(44, size.height - INSPECTOR_CHART_SPACE) }]} contentContainerStyle={styles.inspectorContent} onLayout={event => setCard({ id: fleet.id, height: event.nativeEvent.layout.height })}>
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
      {combatObservation && <HaulerCombat key={fleet.id} observation={combatObservation} fleetId={fleet.id} />}
      {reference && <CopyObjectReference value={reference} label="Copy hauler reference" />}
    </ScrollView>}
    {drag && <View pointerEvents="none" style={styles.coordinates}><Text style={styles.coord}>Release at {drag.target?.name ?? 'a destination'}</Text></View>}
  </View>;
}
function MapControl({ label, text, disabled, onPress }: { label: string; text: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.mapControl, disabled && { opacity: 0.35 }]}><Text style={styles.contactText}>{text}</Text></Pressable>;
}
const styles = StyleSheet.create({
  inspectorContent: { padding: 12, gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  zoom: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', flexWrap: 'wrap', width: 44, gap: 4 }, mapControl: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#15262de8', borderRadius: 22 },
  hauler: { position: 'absolute', width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: 'center', justifyContent: 'center' }, contactRing: { minWidth: 32, height: 24, paddingHorizontal: 4, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, fleetCount: { color: '#08100b', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }, inspector: { position: 'absolute', bottom: 10, left: 10, right: 10, backgroundColor: '#101e15', borderWidth: 1, borderColor: '#526644' }, contactHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, contactTitle: { fontSize: 14, flex: 1 }, contactText: { color: '#d6e2cd', fontSize: 12, lineHeight: 18 },
  chart: { width: '100%', height: 480, overflow: 'hidden', backgroundColor: '#101d24' },
  rock: { position: 'absolute', width: 64, height: 44, marginLeft: -32, marginTop: -22, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 38, height: 38, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stone: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  asteroid: { width: 22, height: 20, borderRadius: 6, borderTopLeftRadius: 10, borderBottomRightRadius: 9 },
  emblemStone: { width: 34, height: 34, borderWidth: 0, backgroundColor: 'transparent' },
  driftingEmblem: { backgroundColor: '#24343c', borderWidth: 1, borderRadius: 8 },
  baseIcon: { width: 34, height: 34 },
  coreBadge: { position: 'absolute', top: -3, right: -3, width: 13, height: 13, lineHeight: 13, fontSize: 12, textAlign: 'center', backgroundColor: '#101d24', borderRadius: 7 },
  name: { position: 'absolute', left: -12, width: 88, fontSize: 10, textAlign: 'center', color: '#82979d' },
  count: { position: 'absolute', left: 50, top: 13, color: '#e4edeb', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  coordinates: { position: 'absolute', bottom: 12, left: 12, gap: 4 }, coord: { fontSize: 11, color: '#a0af9e' },
});
