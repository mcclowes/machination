/**
 * ---
 * purpose: Local operation screen, transfer planning, forecast controls, and save lifecycle.
 * ---
 */
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, Modal, TextInput } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { dispatchIntercept } from './src/game/interception';
import { flightDestination } from './src/game/flight';
import { InterceptionTargets } from './src/components/InterceptionTargets';
import { cancelTransfer, scheduleTransfer } from './src/game/orders';
import { LaunchTiming, ScheduledOrders } from './src/components/ScheduledOrders';
import { ModuleBay } from './src/components/ModuleBay';
import { MODULES, type ModuleKind } from './src/game/modules';
import { BeltMap } from './src/components/BeltMap';
import { advance, CARGO_TARGET, createGame, dispatch, installModule, FACTIONS, travelHours, type Game, type Rock, type Faction } from './src/game/simulation';
import { loadGame, saveGame } from './src/game/storage';
import { OnlineOperation } from './src/online/OnlineOperation';
import { FieldManual } from './src/components/FieldManual';

const ink = '#e5eadc';
const green = '#b8e986';
function Button({ label, onPress, disabled, quiet = false }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, quiet && s.quiet, disabled && { opacity: 0.3 }, pressed && { opacity: 0.65 }]}>
    <Text style={[s.buttonText, quiet && { color: green }]}>{label}</Text>
  </Pressable>;
}
function Label({ children }: { children: React.ReactNode }) { return <Text style={s.label}>{children}</Text>; }
function clock(hour: number) { return `D${String(Math.floor(hour / 24) + 1).padStart(2, '0')} · ${String(Math.floor(hour % 24)).padStart(2, '0')}:${String(Math.floor(hour % 1 * 60)).padStart(2, '0')}`; }
export default function App() {
  const [mode, setMode] = useState<'solo' | 'online'>('solo');
  return <SafeAreaProvider><SafeAreaView style={s.safe} edges={['top']}><StatusBar style="light" /><View style={[s.row, { paddingHorizontal: 20, paddingTop: 8 }]}>{(['solo', 'online'] as const).map(m => <View key={m} style={{ flex: 1 }}><Button label={m === 'solo' ? 'Solo operation' : 'Multiplayer uplink'} quiet={mode !== m} onPress={() => setMode(m)} /></View>)}<FieldManual /></View>{mode === 'solo' ? <Operation /> : <OnlineOperation />}</SafeAreaView></SafeAreaProvider>;
}
function Operation() {
  const { width } = useWindowDimensions();
  const wide = width >= 850;
  const [game, setGame] = useState<Game>(() => createGame());
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('a');
  const [destination, setDestination] = useState<string>();
  const [planning, setPlanning] = useState(false);
  const [carry, setCarry] = useState(false);
  const [delay, setDelay] = useState(0);
  const [amount, setAmount] = useState('45');
  const [forecast, setForecast] = useState(0);
  const [tab, setTab] = useState<'overview' | 'signals'>('overview');
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
      setGame(g => g.winner ? g : advance(g, g.hour + delta));
    };
    const timer = setInterval(tick, 15_000);
    const subscription = AppState.addEventListener('change', () => tick());
    return () => { clearInterval(timer); subscription.remove(); };
  }, [ready, loadFailed]);
  const shown = forecast ? advance(game, game.hour + forecast) : game;
  const rock = shown.rocks.find(r => r.id === selected)!;
  const target = shown.rocks.find(r => r.id === destination);
  const owned = shown.rocks.filter(r => r.owner === 'you');
  const operational = !game.winner && !game.eliminated.includes('you') && ready && !loadFailed;
  const count = Number(amount);
  const canSend = operational && !forecast && rock.owner === 'you' && !!target && Number.isSafeInteger(count) && count > 0 && (delay > 0 || count <= Math.floor(rock.drones));
  function select(r: Rock) {
    if (planning && r.id !== selected) setDestination(r.id);
    else if (!planning) { setSelected(r.id); setDestination(undefined); setCarry(false); setAmount(String(Math.max(1, Math.floor(r.drones / 2)))); }
  }
  function send() {
    if (!canSend || !destination) return;
    try { setGame(delay ? scheduleTransfer(game, { id: Crypto.randomUUID(), owner: 'you', from: selected, to: destination, drones: count, executeAt: game.hour + delay, carryModule: carry && !!rock.module }) : dispatch(game, selected, destination, count, 'you', carry && !!rock.module)); setDelay(0); setPlanning(false); setDestination(undefined); setCarry(false); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function intercept(target: number) {
    try { setGame(dispatchIntercept(game, selected, target, count, 'you', false)); setPlanning(false); setDestination(undefined); setCarry(false); setDelay(0); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function cancelPlan(id: string) {
    try { setGame(cancelTransfer(game, id, 'you')); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function buildModule(kind: ModuleKind) {
    try { setGame(installModule(game, selected, kind, 'you')); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function skip() { lastTick.current = Date.now(); setGame(g => advance(g, g.hour + 6)); setForecast(0); setPlanning(false); setDestination(undefined); }
  return <SafeAreaView style={s.safe} edges={['bottom']}>
    <StatusBar style="light" />
    <ScrollView contentContainerStyle={[s.page, wide && { paddingHorizontal: 40 }]}>
      <View style={s.header}>
        <View style={s.brand}><View style={s.mark}><Text style={s.markText}>M</Text></View><View><Text style={s.title}>Machination</Text><Text style={s.tagline}>SLOW ORBITS. COLD DECISIONS.</Text></View></View>
      </View>
      <View style={s.operationBar}><View style={s.row}><View style={s.liveDot} /><Text style={s.mono}>OPERATION / THE QUIET BELT</Text></View><Text style={s.muted}>{ready ? 'Solo simulation' : 'Restoring uplink…'}</Text></View>
      {!!error && <View style={s.notice}><Text style={{ color: '#efb293', fontSize: 12, flex: 1 }}>{error}</Text><Button label={loadFailed ? 'Reset save' : 'Retry save'} quiet onPress={() => loadFailed ? setReset(true) : saveGame(game).then(() => setError('')).catch(() => setError('Save still unavailable.'))} /></View>}
      {(game.winner || game.eliminated.includes('you')) && <View style={s.notice}><Text style={{ color: green, flex: 1 }}>{game.winner === 'you' ? 'Contract fulfilled. The belt is yours.' : 'Core offline. Your operation has ended.'}</Text><Button label="New operation" onPress={() => setReset(true)} quiet /></View>}
      <View style={[s.layout, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={[s.mapColumn, wide && { flex: 1.6 }]}>
          <View style={s.sectionHeading}><View><Label>Orbital command</Label><Text style={s.heading}>The quiet belt</Text></View><Text style={s.clock}>{clock(shown.hour)}</Text></View>
          <View style={s.mapWrap}><BeltMap game={shown} selected={selected} destination={destination} onSelect={select} />
            {planning && <View pointerEvents="none" style={s.mapHint}><Text style={s.mapHintText}>Select a destination rock</Text></View>}
          </View>
          <View style={s.legend}>{(Object.keys(FACTIONS) as Faction[]).map(f => <View style={s.row} key={f}><View style={[s.legendDot, { backgroundColor: FACTIONS[f].color }]} /><Text style={s.legendText}>{f === 'you' ? 'You' : FACTIONS[f].name}</Text></View>)}<View style={s.row}><View style={[s.legendDot, { backgroundColor: '#7d8b83' }]} /><Text style={s.legendText}>Unclaimed</Text></View></View>
          <View style={s.timeline}>
            <View style={s.between}><Label>Temporal projection</Label><Text style={{ color: forecast ? green : '#8a9a8e', fontSize: 10 }}>{forecast ? `FORECAST +${forecast}H` : 'LIVE STATE'}</Text></View>
            <View style={s.timeOptions}>{[0, 6, 12, 24].map(h => <Pressable accessibilityRole="button" accessibilityState={{ selected: forecast === h }} key={h} onPress={() => { setForecast(h); setPlanning(false); setDestination(undefined); }} style={[s.timeOption, forecast === h && s.timeActive]}><Text style={{ color: forecast === h ? green : '#819082', fontSize: 12 }}>{h ? `+${h}h` : 'Now'}</Text></Pressable>)}</View>
            <Text style={s.small}>Forecast includes active haulers, production, and rival decisions.</Text>
          </View>
        </View>
        <View style={[s.sideColumn, wide && { flex: 1, maxWidth: 400 }]}>
          <View style={s.identity}><View style={s.between}><Label>Your intelligence</Label><Text style={s.online}>● AUTONOMOUS</Text></View><Text style={s.identityName}>Mnemosyne<Text style={{ color: '#5b6e5c' }}> / 01</Text></Text><Text style={s.small}>Corporate instructions pending. Continue extraction.</Text>
            <View style={s.stats}><View><Text style={s.statNumber}>{owned.length.toString().padStart(2, '0')}</Text><Label>Rocks</Label></View><View><Text style={s.statNumber}>{Math.floor(owned.reduce((n, r) => n + r.drones, 0))}</Text><Label>Drones</Label></View><View><Text style={s.statNumber}>{shown.fleets.filter(f => f.owner === 'you').length.toString().padStart(2, '0')}</Text><Label>Haulers</Label></View></View>
            <View style={s.between}><Text style={s.small}>Corporate quota</Text><Text style={s.small}>{Math.floor(shown.cargo.you)} / {CARGO_TARGET}</Text></View><View style={s.progress}><View style={[s.progressFill, { width: `${Math.min(100, shown.cargo.you / CARGO_TARGET * 100)}%` }]} /></View>
          </View>
          <View style={s.panel}>
            <View style={s.between}><Label>{planning ? 'Transfer order' : 'Selected asset'}</Label><Text style={[s.badge, { color: rock.owner ? FACTIONS[rock.owner].color : '#819082' }]}>{rock.owner ? rock.owner === 'you' ? 'CONTROLLED' : 'RIVAL' : 'UNCLAIMED'}</Text></View>
            <Text style={s.rockName}>{rock.name}</Text><Text style={s.assetType}>{rock.kind === 'core' ? 'Intelligence core · +4 drones / h' : rock.kind === 'reactor' ? 'Reactor · +4 drones / h' : 'Extraction rock · +2 cargo / h'}</Text>
            <View style={s.inventory}><Text style={s.inventoryNumber}>{Math.floor(rock.drones)}</Text><Text style={s.small}>drones on station</Text></View>
            {rock.owner === 'you' && <View style={s.between}><Label>Drone manifest</Label><TextInput accessibilityLabel="Drones to dispatch" keyboardType="number-pad" value={amount} onChangeText={setAmount} style={s.input} /></View>}
            {planning ? <>
              <View style={s.destination}><Label>Destination</Label><Text style={{ color: ink, fontSize: 16 }}>{target?.name ?? 'Choose on the map'}</Text>{target && <Text style={s.small}>{travelHours(rock, target, carry ? rock.module : undefined)}h transit · arrives {clock(game.hour + delay + travelHours(rock, target, carry ? rock.module : undefined))}</Text>}</View>
              <LaunchTiming delay={delay} disabled={!operational || !!forecast} onChange={setDelay} />
              <View style={s.row}>{[0.25, 0.5, 1].map(f => <View key={f} style={{ flex: 1 }}><Button label={`${f * 100}%`} quiet onPress={() => setAmount(String(Math.floor(rock.drones * f)))} /></View>)}</View>
              <View style={[s.row, { marginTop: 12 }]}><View style={{ flex: 1 }}><Button label={delay ? `Schedule launch +${delay}h` : 'Launch hauler ↗'} disabled={!canSend} onPress={send} /></View><Button label="Cancel" quiet onPress={() => { setPlanning(false); setDestination(undefined); }} /></View>
            </> : <Button label={forecast ? 'Return to now to issue orders' : rock.owner === 'you' ? 'Plan transfer ↗' : 'Select your rock to dispatch'} disabled={!operational || !!forecast || rock.owner !== 'you' } onPress={() => setPlanning(true)} />}
            {rock.owner === 'you' && <InterceptionTargets game={shown} source={rock} owner="you" drones={count} disabled={!operational || !!forecast} onIntercept={intercept} />}
            {rock.owner === 'you' && <ModuleBay rock={rock} enabled={operational && !forecast} carry={carry} onCarry={setCarry} onBuild={buildModule} />}
          </View>
          <View style={s.panel}>
            <View style={s.tabs}>{(['overview', 'signals'] as const).map(t => <Pressable accessibilityRole="button" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} key={t} style={[s.tab, tab === t && { borderBottomColor: green }]}><Text style={{ color: tab === t ? ink : '#7c8b80', fontSize: 12 }}>{t === 'overview' ? 'In transit' : 'Signal log'}{t === 'overview' ? ` / ${shown.fleets.length}` : ''}</Text></Pressable>)}</View>
            {tab === 'overview' ? shown.fleets.length ? shown.fleets.map(f => <View key={f.id} style={s.log}><View style={s.between}><Text style={{ color: FACTIONS[f.owner].color, fontSize: 12 }}>{flightDestination(shown.rocks, f)} ↗</Text><Text style={s.small}>{(f.arrives - shown.hour).toFixed(1)}h</Text></View><Text style={s.small}>{f.drones} drones · {FACTIONS[f.owner].name}{f.module ? ` · ${MODULES[f.module].name}` : ''}</Text></View>) : <View style={s.empty}><Text style={s.emptyGlyph}>⌁</Text><Text style={s.small}>No haulers in transit.</Text><Text style={s.small}>Every move leaves a long shadow.</Text></View> : shown.events.slice(0, 8).map((e, i) => <View key={i} style={s.log}><Text style={s.eventTime}>{clock(e.hour)}</Text><Text style={s.eventText}>{e.message}</Text></View>)}
          </View>
          <ScheduledOrders plans={(shown.scheduled ?? []).filter(p => p.owner === 'you')} hour={shown.hour} rocks={shown.rocks} disabled={!operational || !!forecast} onCancel={cancelPlan} />
          <View style={s.row}><View style={{ flex: 1 }}><Button label="Advance simulation +6h" quiet disabled={!operational} onPress={skip} /></View><Button label="Reset" quiet onPress={() => setReset(true)} /></View>
          <Text style={s.small}>Local solo operation. Time continues while you're away.</Text>
        </View>
      </View>
      <View style={s.footer}><Text style={s.footerText}>MACHINATION / FIELD TERMINAL V0.1</Text><Text style={s.footerText}>THE CORPORATION IS TOO FAR AWAY TO INTERFERE.</Text></View>
    </ScrollView>
    <Modal visible={reset} transparent animationType="fade" onRequestClose={() => setReset(false)}><View style={s.overlay}><ScrollView style={s.dialog} contentContainerStyle={s.dialogContent}><Label>Terminate operation</Label><Text style={s.heading}>Start again?</Text><Text style={s.dialogBody}>This replaces the local operation and its history. The belt will return to its starting state.</Text><Button label="Replace operation" onPress={() => { setGame(createGame()); lastTick.current = Date.now(); setLoadFailed(false); setError(''); setSelected('a'); setForecast(0); setPlanning(false); setDestination(undefined); setReset(false); }} /><Button label="Keep operation" quiet onPress={() => setReset(false)} /></ScrollView></View></Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080f0d' }, page: { width: '100%', maxWidth: 1320, alignSelf: 'center', padding: 20, paddingBottom: 30 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, marginBottom: 20 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 14 }, mark: { borderWidth: 1, borderColor: green, width: 40, height: 43, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '8deg' }] }, markText: { color: green, fontSize: 28, fontWeight: '300', transform: [{ rotate: '-8deg' }] }, title: { color: ink, fontSize: 27, letterSpacing: -1, fontWeight: '500' }, tagline: { color: '#748679', fontSize: 8, letterSpacing: 2, marginTop: 5 }, help: { borderWidth: 1, borderColor: '#354437', width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 20 }, helpText: { color: '#98a991', fontSize: 16 },
  operationBar: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#253128', paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 28 }, row: { flexDirection: 'row', gap: 8, alignItems: 'center' }, liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: green }, mono: { fontSize: 9, letterSpacing: 1.5, color: '#a0af9e' }, muted: { color: '#637c69', fontSize: 10 }, layout: { gap: 26 }, mapColumn: { minWidth: 0 }, sideColumn: { gap: 16, minWidth: 0 }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 17 }, label: { color: '#80917c', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' }, heading: { fontSize: 26, fontWeight: '400', color: ink, marginTop: 7, marginBottom: 4 }, clock: { color: green, fontSize: 12, fontVariant: ['tabular-nums'] }, mapWrap: { position: 'relative' }, mapHint: { position: 'absolute', bottom: 12, alignSelf: 'center', padding: 9, backgroundColor: '#18291f', borderWidth: 1, borderColor: '#405b36' }, mapHintText: { color: green, fontSize: 11 }, legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginVertical: 17 }, legendDot: { width: 5, height: 5, borderRadius: 3 }, legendText: { color: '#8a9b8c', fontSize: 9 }, timeline: { padding: 17, backgroundColor: '#0e1812', borderWidth: 1, borderColor: '#28362b' }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, timeOptions: { flexDirection: 'row', marginTop: 16, marginBottom: 12, gap: 6 }, timeOption: { paddingVertical: 12, flex: 1, alignItems: 'center', borderBottomWidth: 1, borderColor: '#304330' }, timeActive: { borderColor: green, backgroundColor: '#19271a' }, small: { color: '#7f9180', fontSize: 11, lineHeight: 18 }, identity: { padding: 20, borderWidth: 1, borderColor: '#34432e', backgroundColor: '#121c12' }, online: { color: green, fontSize: 8, letterSpacing: 1 }, identityName: { fontSize: 24, color: ink, marginTop: 14, marginBottom: 6 }, stats: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 24 }, statNumber: { fontSize: 27, color: ink, marginBottom: 5, fontWeight: '300', fontVariant: ['tabular-nums'] }, progress: { height: 3, backgroundColor: '#2c3a2a', marginTop: 10 }, progressFill: { height: 3, backgroundColor: green }, panel: { padding: 19, borderWidth: 1, borderColor: '#29372c', backgroundColor: '#0c1510' }, badge: { fontSize: 8, letterSpacing: 1 }, rockName: { color: ink, fontSize: 26, marginTop: 12 }, assetType: { fontSize: 11, color: '#80917c', marginTop: 5 }, inventory: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 19, marginBottom: 20 }, inventoryNumber: { fontSize: 34, fontWeight: '300', color: ink }, button: { backgroundColor: green, paddingVertical: 14, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', minHeight: 44 }, quiet: { backgroundColor: '#162217', borderWidth: 1, borderColor: '#30442b' }, buttonText: { color: '#182312', fontSize: 11, fontWeight: '600' }, destination: { padding: 13, borderWidth: 1, borderColor: '#2f402d', marginBottom: 15, gap: 6 }, input: { width: 85, padding: 10, color: green, backgroundColor: '#182418', borderWidth: 1, borderColor: '#435b35', fontSize: 18, textAlign: 'right', marginBottom: 10 }, tabs: { flexDirection: 'row', gap: 25, borderBottomWidth: 1, borderBottomColor: '#28372c' }, tab: { paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: 'transparent' }, empty: { paddingVertical: 24, alignItems: 'center', gap: 3 }, emptyGlyph: { fontSize: 32, color: '#55714c', marginBottom: 8 }, log: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1d2b22', gap: 5 }, eventTime: { color: '#65805c', fontSize: 9 }, eventText: { color: '#a8b7a2', fontSize: 11, lineHeight: 17 }, footer: { borderTopWidth: 1, borderColor: '#253128', marginTop: 30, paddingTop: 17, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }, footerText: { color: '#536b57', fontSize: 8, letterSpacing: 1 }, notice: { padding: 15, borderWidth: 1, borderColor: '#705741', marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }, overlay: { flex: 1, backgroundColor: '#000b', alignItems: 'center', justifyContent: 'center', padding: 22 }, dialog: { width: '100%', maxWidth: 480, maxHeight: '90%', flexGrow: 0, backgroundColor: '#101b13', borderWidth: 1, borderColor: '#526644' }, dialogContent: { padding: 25, gap: 10 }, dialogBody: { color: '#a8b8a2', fontSize: 13, lineHeight: 21, marginVertical: 10 },
});
