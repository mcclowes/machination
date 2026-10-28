/**
 * ---
 * purpose: Local operation screen, transfer planning, forecast controls, and save lifecycle.
 * ---
 */
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View, Modal, TextInput } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { dispatchIntercept } from './src/game/interception';
import { flightDestination } from './src/game/flight';
import { InterceptionTargets } from './src/components/InterceptionTargets';
import { cancelTransfer, scheduleTransfer } from './src/game/orders';
import { LaunchTiming, ScheduledOrders } from './src/components/ScheduledOrders';
import { SpecialistBay } from './src/components/SpecialistBay';
import { hireSpecialist, promoteSpecialist } from './src/game/specialists';
import { releaseSpecialist } from './src/game/specialist-travel';
import { specialistSpeed } from './src/game/specialist-effects';
import { SPECIALISTS } from './src/game/specialist-catalog';
import { ModuleBay } from './src/components/ModuleBay';
import { MODULES, type ModuleKind } from './src/game/modules';
import { BeltMap } from './src/components/BeltMap';
import { advance, createGame, dispatch, installModule, FACTIONS, operationStatus, travelHours, type Game, type Rock, type Faction } from './src/game/simulation';
import { loadGame, saveGame } from './src/game/storage';
import { OnlineOperation } from './src/online/OnlineOperation';
import { FieldManual } from './src/components/FieldManual';
import { HaulerOrders } from './src/components/HaulerOrders';
import { commandHauler, LAUNCH_PREPARATION } from './src/game/transport';
import { SiteControls, siteDescription } from './src/components/SiteControls';
import { cargoTarget, drillMine, droneInventory, mineCost, powerCapacity, setShields } from './src/game/economy';
import { OperationShell, type OperationSection } from './src/components/OperationShell';
import { FundingPanel } from './src/components/FundingPanel';
import { setFunding } from './src/game/funding';
import { TimeMachine } from './src/components/TimeMachine';
import { gameClock as clock, inspectionOffset, orderHour } from './src/game/time-machine';

const ink = '#e5eadc';
const green = '#b8e986';
function Button({ label, onPress, disabled, quiet = false }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, quiet && s.quiet, disabled && { opacity: 0.3 }, pressed && { opacity: 0.65 }]}>
    <Text style={[s.buttonText, quiet && { color: green }]}>{label}</Text>
  </Pressable>;
}
function Label({ children }: { children: React.ReactNode }) { return <Text style={s.label}>{children}</Text>; }
export default function App() {
  const [mode, setMode] = useState<'solo' | 'online'>('solo');
  return <SafeAreaProvider><SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}><StatusBar style="light" /><View style={[s.row, { paddingHorizontal: 12, paddingTop: 8 }]}>{(['solo', 'online'] as const).map(m => <View key={m} style={{ flex: 1 }}><Button label={m === 'solo' ? 'Solo operation' : 'Multiplayer uplink'} quiet={mode !== m} onPress={() => setMode(m)} /></View>)}<FieldManual /></View>{mode === 'solo' ? <Operation /> : <OnlineOperation />}</SafeAreaView></SafeAreaProvider>;
}
function Operation() {
  const [section, setSection] = useState<OperationSection | null>(null);
  const [game, setGame] = useState<Game>(() => createGame());
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('a');
  const [destination, setDestination] = useState<string>();
  const [planning, setPlanning] = useState(false);
  const [carry, setCarry] = useState(false);
  const [delay, setDelay] = useState(0);
  const [amount, setAmount] = useState('0');
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [navigating, setNavigating] = useState<number>();
  const [inspectedHour, setInspectedHour] = useState<number | null>(null);
  const forecast = inspectionOffset(game.hour, inspectedHour);
  const [reset, setReset] = useState(false);
  const lastTick = useRef(Date.now());
  useEffect(() => {
    loadGame().then(saved => { if (saved) setGame(saved); }).catch(e => { setError(String(e.message)); setLoadFailed(true); }).finally(() => { lastTick.current = Date.now(); setReady(true); });
  }, []);
  useEffect(() => {
    if (!ready || loadFailed) return;
    saveGame(game).catch(() => setError('Could not save this operation. Keep the app open and retry.'));
  }, [game, ready, loadFailed]);
  useEffect(() => {
    if (!ready || loadFailed) return;
    const tick = () => {
      const now = Date.now();
      const delta = Math.max(0, now - lastTick.current) / 3_600_000;
      lastTick.current = now;
      setGame(g => g.winner || g.draw ? g : advance(g, g.hour + delta));
    };
    const timer = setInterval(tick, 15_000);
    const subscription = AppState.addEventListener('change', () => tick());
    return () => { clearInterval(timer); subscription.remove(); };
  }, [ready, loadFailed]);
  const shown = forecast ? advance(game, game.hour + forecast) : game;
  const rock = shown.rocks.find(r => r.id === selected)!;
  const target = shown.rocks.find(r => r.id === destination);
  const owned = shown.rocks.filter(r => r.owner === 'you');
  const status = operationStatus(game, 'you');
  const operational = status === 'active' && ready && !loadFailed;
  const outcomeMessage = {
    active: '',
    draw: 'All cores offline. The operation ended in a draw.',
    victory: 'Contract fulfilled. The belt is yours.',
    defeat: `Contract lost. ${game.winner ? FACTIONS[game.winner].name : 'A rival'} fulfilled the contract.`,
    eliminated: 'Core offline. Your operation has ended.',
  }[status];
  const unitManifest = (rock.specialists ?? []).filter(u => selectedUnits.includes(u.id) && u.owner === 'you' && !u.captive);
  const unitIds = unitManifest.map(u => u.id);
  const duration = target ? game.version === 2 ? Math.max(1e-6, Math.hypot(rock.x - target.x, rock.y - target.y) / specialistSpeed(shown, 'you', unitManifest, target.owner === 'you')) : travelHours(rock, target, carry ? rock.module : undefined, game.version) : 0;
  const count = Number(amount);
  const preparation = game.version === 2 ? LAUNCH_PREPARATION : 0;
  const launchAt = Math.max(game.hour, inspectedHour ?? game.hour) + delay;
  const canSend = operational && !shown.winner && !shown.draw && !rock.destroyed && !target?.destroyed && launchAt <= game.hour + 168 && rock.owner === 'you' && game.rocks.find(r => r.id === selected)?.owner === 'you' && !!target && Number.isSafeInteger(count) && count >= (unitIds.length ? 0 : 1) && (launchAt > game.hour || count <= Math.floor(rock.drones));
  function select(r: Rock) {
    if (navigating !== undefined) { try { setGame(commandHauler(game, 'you', { action: 'course', fleet: navigating, to: r.id })); setError(''); } catch (e) { setError((e as Error).message); } setNavigating(undefined); return; }
    if (planning && r.id !== selected) { setDestination(r.id); setSection('asset'); }
    else if (!planning) { setSection('asset'); setSelected(r.id); setDestination(undefined); setCarry(false); setSelectedUnits([]); setAmount(String(Math.max(game.version === 2 ? 0 : 1, Math.floor(r.drones / 2)))); }
  }
  function send() {
    if (!canSend || !destination) return;
    try { const executeAt = orderHour(game.hour, inspectedHour, delay); setGame(executeAt > game.hour ? scheduleTransfer(game, { id: Crypto.randomUUID(), owner: 'you', from: selected, to: destination, drones: count, executeAt, carryModule: carry && !!rock.module, specialists: unitIds }) : dispatch(game, selected, destination, count, 'you', carry && !!rock.module, unitIds)); setDelay(0); setPlanning(false); setSection(null); setDestination(undefined); setCarry(false); setSelectedUnits([]); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function intercept(target: number) {
    try { setGame(dispatchIntercept(game, selected, target, count, 'you', false, unitIds.length ? unitIds : undefined)); setPlanning(false); setDestination(undefined); setCarry(false); setDelay(0); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function cancelPlan(id: string) {
    try { setGame(cancelTransfer(game, id, 'you')); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function changeUnits(change: (game: Game) => Game) { try { setGame(change(game)); setError(''); } catch (e) { setError((e as Error).message); } }
  function buildModule(kind: ModuleKind) {
    try { setGame(installModule(game, selected, kind, 'you')); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function skip() { lastTick.current = Date.now(); setGame(g => advance(g, g.hour + 6)); setInspectedHour(null); setPlanning(false); setDestination(undefined); }
  return <View style={s.safe}>
    <OperationShell section={section} onSection={setSection}
      status={<><View style={s.between}><Text style={s.mono}>The quiet belt · solo</Text><Text style={s.clock}>{clock(shown.hour)}</Text></View>{!!error && <View style={s.notice}><Text style={{ color: '#efb293', fontSize: 12, flex: 1 }}>{error}</Text><Button label={loadFailed ? 'Reset save' : 'Retry save'} quiet onPress={() => loadFailed ? setReset(true) : saveGame(game).then(() => setError('')).catch(() => setError('Save still unavailable.'))} /></View>}
{!!outcomeMessage && <View style={s.notice}><Text accessibilityRole="alert" style={{ color: green, flex: 1 }}>{outcomeMessage}</Text><Button label="New operation" onPress={() => setReset(true)} quiet /></View>}</>}
      chart={<BeltMap fill player="you" onInspectFleet={() => setSection(null)} onManageFleet={() => setSection('orders')} game={shown} selected={selected} destination={destination} onSelect={select} />}
      hint={(planning || navigating !== undefined) ? <><Text style={s.mapHintText}>{navigating !== undefined ? 'Select a new course destination' : `From ${rock.name}: choose destination`}</Text><Button label="Cancel selection" quiet onPress={() => { setNavigating(undefined); setPlanning(false); setSection('asset'); }} /></> : undefined}
      timeline={<TimeMachine compact hour={game.hour} inspectedHour={inspectedHour} onChange={hour => { setInspectedHour(hour); setDelay(0); }} events={[...game.fleets.flatMap(f => [f.arrives, ...(f.preparing ? [f.departed] : [])]), ...(game.scheduled ?? []).map(p => p.executeAt)]} />}
      panels={{
        asset: { title: planning ? 'Transfer order' : rock.name, content: <View style={s.panel}>
            <View style={s.between}><Label>{planning ? 'Transfer order' : 'Selected asset'}</Label><Text style={[s.badge, { color: rock.owner ? FACTIONS[rock.owner].color : '#819082' }]}>{rock.owner ? rock.owner === 'you' ? 'CONTROLLED' : 'RIVAL' : 'UNCLAIMED'}</Text></View>
            <Text style={s.rockName}>{rock.name}</Text><Text style={s.assetType}>{siteDescription(rock)}</Text>
            <View style={s.inventory}><Text style={s.inventoryNumber}>{Math.floor(rock.drones)}</Text><Text style={s.small}>drones on station</Text></View>
            {rock.owner === 'you' && <View style={s.between}><Label>Drone manifest</Label><TextInput key="solo-manifest" secureTextEntry={false} accessibilityLabel="Drones to dispatch" keyboardType="number-pad" value={amount} onChangeText={setAmount} style={s.input} /></View>}
            {planning ? <>
              <View style={s.destination}><Label>Destination</Label><Text style={{ color: ink, fontSize: 16 }}>{target?.name ?? 'Choose on the map'}</Text>{target && <Text style={s.small}>{duration.toFixed(2)}h transit · arrives {clock(launchAt + preparation + duration)}</Text>}</View>
              <LaunchTiming future={!!forecast} delay={delay} disabled={!operational} onChange={setDelay} />
              <View style={s.row}>{[0.25, 0.5, 1].map(f => <View key={f} style={{ flex: 1 }}><Button label={`${f * 100}%`} quiet onPress={() => setAmount(String(Math.floor(rock.drones * f)))} /></View>)}</View>
              <View style={[s.row, { marginTop: 12 }]}><View style={{ flex: 1 }}><Button label={launchAt > game.hour ? `Schedule · ${clock(launchAt)}` : game.version === 2 ? 'Prepare launch · 10m' : 'Launch hauler ↗'} disabled={!canSend} onPress={send} /></View><Button label="Cancel" quiet onPress={() => { setPlanning(false); setDestination(undefined); }} /></View>
            </> : <Button label={rock.owner === 'you' ? forecast ? 'Plan transfer at this time ↗' : 'Plan transfer ↗' : 'Select your rock to dispatch'} disabled={!operational || !!shown.winner || rock.owner !== 'you' } onPress={() => { setPlanning(true); setSection(null); }} />}
            {game.version === 2 && rock.owner === 'you' && <SiteControls rock={rock} cost={mineCost(game, 'you')} enabled={operational && !forecast} onMine={() => { try { setGame(drillMine(game, selected, 'you')); setError(''); } catch (e) { setError((e as Error).message); } }} onShields={() => { try { setGame(setShields(game, selected, 'you', !rock.shieldsDisabled)); setError(''); } catch (e) { setError((e as Error).message); } }} />}
            {rock.owner === 'you' && <InterceptionTargets game={shown} source={rock} owner="you" drones={count} specialists={unitIds} disabled={!operational || !!forecast} onIntercept={intercept} />}
            {game.version === 2 && rock.owner === 'you' && <SpecialistBay mode="cargo" game={shown} rock={rock} owner="you" enabled={operational && !forecast} selectionEnabled={operational} selected={unitIds} onSelect={setSelectedUnits} onHire={kind => changeUnits(g => hireSpecialist(g, 'you', kind))} onPromote={id => changeUnits(g => promoteSpecialist(g, 'you', id))} onRelease={id => changeUnits(g => releaseSpecialist(g, 'you', id))} />}
            {rock.owner !== 'you' && !!rock.specialists?.length && <View>{rock.specialists.map(u => <Text key={u.id} style={s.small}>{SPECIALISTS[u.kind].name}{u.captive ? ' · captive' : ''}: {u.captive ? 'Abilities inactive.' : SPECIALISTS[u.kind].description}</Text>)}</View>}
            {game.version === 1 && rock.owner === 'you' && <ModuleBay rock={rock} enabled={operational && !forecast} carry={carry} onCarry={setCarry} onBuild={buildModule} />}
          </View> },
        orders: { title: 'Your orders', content: <>{game.version === 2 && <HaulerOrders fleets={game.fleets.filter(f => f.owner === 'you')} rocks={game.rocks} hour={game.hour} enabled={operational} onNavigate={id => { setSection(null); setNavigating(current => current === id ? undefined : id); setPlanning(false); setDestination(undefined); }} onCommand={command => { try { setGame(commandHauler(game, 'you', command)); setError(''); } catch (e) { setError((e as Error).message); } }} />} <ScheduledOrders plans={(game.scheduled ?? []).filter(p => p.owner === 'you')} hour={game.hour} rocks={shown.rocks} disabled={!operational} onCancel={cancelPlan} /><View style={s.panel}><Label>Observed haulers</Label>{shown.fleets.map(f => <Text key={f.id} style={s.small}>{FACTIONS[f.owner].name} → {flightDestination(shown.rocks, f)} · {f.drones} drones · {(f.arrives - shown.hour).toFixed(1)}h</Text>)}</View></> },
        units: { title: `Modules · ${rock.name}`, content: <><Button label="Go to core site" quiet onPress={() => { const home = shown.rocks.find(r => r.coreOf === 'you' && r.owner === 'you'); if (home) select(home); setSection('units'); }} />{game.version === 2 && rock.owner === 'you' && <SpecialistBay game={shown} rock={rock} owner="you" enabled={operational && !forecast} selectionEnabled={operational} selected={unitIds} onSelect={setSelectedUnits} onHire={kind => changeUnits(g => hireSpecialist(g, 'you', kind))} onPromote={id => changeUnits(g => promoteSpecialist(g, 'you', id))} onRelease={id => changeUnits(g => releaseSpecialist(g, 'you', id))} />}</> },
        signals: { title: 'Signal log', content: <>{shown.events.slice(0, 50).map((e, i) => <View key={i} style={s.log}><Text style={s.eventTime}>{clock(e.hour)}</Text><Text style={s.eventText}>{e.message}</Text></View>)}</> },
        intel: { title: 'Intelligence', content: <><View style={s.identity}><View style={s.between}><Label>Your intelligence</Label><Text style={s.online}>● AUTONOMOUS</Text></View><Text style={s.identityName}>Mnemosyne<Text style={{ color: '#5b6e5c' }}> / 01</Text></Text><Text style={s.small}>{game.version === 2 ? `Power: ${droneInventory(shown, 'you')} / ${powerCapacity(shown, 'you')} drones. Establish extraction to earn cargo.` : 'Legacy operation · original prototype rules.'}</Text>
            <View style={s.stats}><View><Text style={s.statNumber}>{owned.length.toString().padStart(2, '0')}</Text><Label>Rocks</Label></View><View><Text style={s.statNumber}>{Math.floor(droneInventory(shown, 'you'))}</Text><Label>Drones</Label></View><View><Text style={s.statNumber}>{shown.fleets.filter(f => f.owner === 'you').length.toString().padStart(2, '0')}</Text><Label>Haulers</Label></View></View>
            <View style={s.between}><Text style={s.small}>Corporate quota</Text><Text style={s.small}>{Math.floor(shown.cargo.you)} / {cargoTarget(game)}</Text></View><View style={s.progress}><View style={[s.progressFill, { width: `${Math.min(100, shown.cargo.you / cargoTarget(game) * 100)}%` }]} /></View>
          </View><FundingPanel game={shown} owner="you" enabled={operational && !forecast} onChange={(to, enabled) => changeUnits(g => setFunding(g, 'you', to, enabled))} /></> },
        settings: { title: 'Solo operation', content: <><View style={s.row}><View style={{ flex: 1 }}><Button label="Advance simulation +6h" quiet disabled={!operational} onPress={skip} /></View><Button label="Reset" quiet onPress={() => setReset(true)} /></View><Text style={s.small}>Local simulation. Time continues while you’re away. Rivals follow deterministic training orders.</Text></> },
      }} />
    <Modal visible={reset} transparent animationType="fade" onRequestClose={() => setReset(false)}><View style={s.overlay}><ScrollView style={s.dialog} contentContainerStyle={s.dialogContent}><Label>Terminate operation</Label><Text style={s.heading}>Start again?</Text><Text style={s.dialogBody}>This replaces the local operation and its history. The belt will return to its starting state.</Text><Button label="Replace operation" onPress={() => { setGame(createGame()); lastTick.current = Date.now(); setLoadFailed(false); setError(''); setSelected('a'); setSelectedUnits([]); setNavigating(undefined); setInspectedHour(null); setPlanning(false); setDestination(undefined); setReset(false); }} /><Button label="Keep operation" quiet onPress={() => setReset(false)} /></ScrollView></View></Modal>
  </View>;
}
const s = StyleSheet.create( {
  safe: { flex: 1, backgroundColor: '#080f0d' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  mono: { fontSize: 9, letterSpacing: 1.5, color: '#a0af9e' },
  label: { color: '#80917c', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' },
  heading: { fontSize: 26, fontWeight: '400', color: ink, marginTop: 7, marginBottom: 4 },
  clock: { color: green, fontSize: 12, fontVariant: ['tabular-nums'] },
  mapHintText: { color: green, fontSize: 11 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  small: { color: '#7f9180', fontSize: 11, lineHeight: 18 },
  identity: { padding: 20, borderWidth: 1, borderColor: '#34432e', backgroundColor: '#121c12' },
  online: { color: green, fontSize: 8, letterSpacing: 1 },
  identityName: { fontSize: 24, color: ink, marginTop: 14, marginBottom: 6 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 24 },
  statNumber: { fontSize: 27, color: ink, marginBottom: 5, fontWeight: '300', fontVariant: ['tabular-nums'] },
  progress: { height: 3, backgroundColor: '#2c3a2a', marginTop: 10 },
  progressFill: { height: 3, backgroundColor: green },
  panel: { padding: 19, borderWidth: 1, borderColor: '#29372c', backgroundColor: '#0c1510' },
  badge: { fontSize: 8, letterSpacing: 1 },
  rockName: { color: ink, fontSize: 26, marginTop: 12 },
  assetType: { fontSize: 11, color: '#80917c', marginTop: 5 },
  inventory: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 19, marginBottom: 20 },
  inventoryNumber: { fontSize: 34, fontWeight: '300', color: ink },
  button: { backgroundColor: green, paddingVertical: 14, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  quiet: { backgroundColor: '#162217', borderWidth: 1, borderColor: '#30442b' },
  buttonText: { color: '#182312', fontSize: 11, fontWeight: '600' },
  destination: { padding: 13, borderWidth: 1, borderColor: '#2f402d', marginBottom: 15, gap: 6 },
  input: { width: 85, padding: 10, color: green, backgroundColor: '#182418', borderWidth: 1, borderColor: '#435b35', fontSize: 18, textAlign: 'right', marginBottom: 10 },
  log: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1d2b22', gap: 5 },
  eventTime: { color: '#65805c', fontSize: 9 },
  eventText: { color: '#a8b7a2', fontSize: 11, lineHeight: 17 },
  notice: { padding: 15, borderWidth: 1, borderColor: '#705741', marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10 },
  overlay: { flex: 1, backgroundColor: '#000b', alignItems: 'center', justifyContent: 'center', padding: 22 },
  dialog: { width: '100%', maxWidth: 480, maxHeight: '90%', flexGrow: 0, backgroundColor: '#101b13', borderWidth: 1, borderColor: '#526644' },
  dialogContent: { padding: 25, gap: 10 },
  dialogBody: { color: '#a8b8a2', fontSize: 13, lineHeight: 21, marginVertical: 10 },
});
