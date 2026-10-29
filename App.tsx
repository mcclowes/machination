/**
 * ---
 * purpose: Local operation screen, transfer planning, forecast controls, and save lifecycle.
 * ---
 */
import { openingEnabled } from './src/game/opening-clock';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View, Modal, TextInput } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { stationCourse } from './src/game/drift';
import { fitPlayerCamera, focusCamera } from './src/game/chart-camera';
import { flightDestination, fleetPosition } from './src/game/flight';
import { InterceptionTargets } from './src/components/InterceptionTargets';
import { launchCargoLabel, selectableLaunchUnits } from './src/components/launch-manifest';
import { remoteSiteDescription } from './src/components/site-observation';
import { LaunchTiming, ScheduledOrders } from './src/components/ScheduledOrders';
import { GameSetup } from './src/components/GameSetup';
import { createConfiguredGame } from './src/game/world';
import { DEFAULT_GAME_OPTIONS, driftingBasesEnabled, mechanicsVersion, victoryProgress, victoryTarget, type GameOptions } from './src/game/rules';
import { ResignationControl } from './src/components/ResignationControl';
import type { FutureAction } from './src/game/future-actions';
import { SpecialistBay } from './src/components/SpecialistBay';
import { SpecialistPanel } from './src/components/SpecialistPanel';
import { specialistSpeed } from './src/game/specialist-effects';
import { SPECIALISTS } from './src/game/specialist-catalog';
import { ModuleBay } from './src/components/ModuleBay';
import { type ModuleKind } from './src/game/modules';
import { DroneManifest } from './src/components/DroneManifest';
import { BeltMap } from './src/components/BeltMap';
import { createGame, FACTIONS, operationStatus, travelHours, type Game, type Rock } from './src/game/simulation';
import { loadGame, saveGame } from './src/game/storage';
import { OnlineOperation } from './src/online/OnlineOperation';
import { FieldManual } from './src/components/FieldManual';
import { futureCommandFleets, observedInterceptionIds, launchBlockReason } from './src/components/fleet-planning';
import { GiftTransfer } from './src/components/GiftTransfer';
import { HaulerOrders } from './src/components/HaulerOrders';
import { LAUNCH_PREPARATION } from './src/game/transport';
import { SiteControls, siteDescription } from './src/components/SiteControls';
import { droneInventory, mineCost, powerCapacity } from './src/game/economy';
import { OperationShell, type OperationSection } from './src/components/OperationShell';
import { TerritoryStandings } from './src/components/TerritoryStandings';
import { FundingPanel } from './src/components/FundingPanel';
import { TimeMachine } from './src/components/TimeMachine';
import { gameClock as clock, inspectionOffset, inspectionMode, orderHour } from './src/game/time-machine';
import { createArchive, exportArchive, replayTo, type GameCommand } from './src/game/replay';
import { localLifecycle } from './src/game/local-lifecycle';
import { Practice, type PracticeAttempt } from './src/components/Practice';
import { PracticeStatus } from './src/components/PracticeStatus';
import { ReplayLibraryScreen } from './src/components/ReplayLibraryScreen';
import { ReplayExport } from './src/components/ReplayExport';
import { generateSharedReplay } from './src/replay/generate';
import { StartScreen } from './src/components/StartScreen';
import type { LocalOperation } from './src/game/operation-save';
import { observe, forecastObservation, type ObservedRock } from './src/game/visibility';
import { SignalLog } from './src/components/SignalLog';
import { playSound, useSoundCues } from './src/audio/sound';
import { SoundToggle } from './src/components/SoundToggle';

function operationFor(game: Game): LocalOperation { return { game, archive: createArchive(game, { rivals: true }) }; }
function newOperation(options: GameOptions = DEFAULT_GAME_OPTIONS): LocalOperation { return operationFor(createConfiguredGame(options, Date.now(), Math.floor(Math.random() * 2 ** 32))); }
const ink = '#e5eadc';
const green = '#b8e986';
function Button({ label, onPress, disabled, quiet = false }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={() => { playSound('tap'); onPress(); }} style={({ pressed }) => [s.button, quiet && s.quiet, disabled && { opacity: 0.3 }, pressed && { opacity: 0.65 }]}>
    <Text style={[s.buttonText, quiet && { color: green }]}>{label}</Text>
  </Pressable>;
}
function Label({ children }: { children: React.ReactNode }) { return <Text style={s.label}>{children}</Text>; }
export default function App() {
  const [mode, setMode] = useState<'solo' | 'online' | 'practice' | 'replays' | null>(null);
  if (mode === 'replays') return <SafeAreaProvider><SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}><StatusBar style="light" /><ReplayLibraryScreen onExit={() => setMode(null)} /></SafeAreaView></SafeAreaProvider>;
  return <SafeAreaProvider><SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}><StatusBar style="light" /><View style={[s.row, { paddingHorizontal: 12, paddingTop: 8 }]}>{mode ? <><Pressable accessibilityRole="button" accessibilityLabel="‹ Games" onPress={() => setMode(null)} style={{ minHeight: 44, minWidth: 64, justifyContent: 'center' }}><Text style={{ color: '#b4c7ca', fontSize: 14 }}>‹ Games</Text></Pressable><Text style={[s.small, { flex: 1, fontSize: 14 }]}>{mode === 'solo' ? 'Solo operation' : mode === 'online' ? 'Multiplayer' : 'Tactical practice'}</Text></> : (['solo', 'online', 'practice'] as const).map(m => <View key={m} style={{ flex: 1 }}><Button label={m === 'solo' ? 'Solo' : m === 'online' ? 'Multiplayer' : 'Practice'} quiet={mode !== m} onPress={() => setMode(m)} /></View>)}<SoundToggle compact={!!mode} /><FieldManual compact={!!mode} /></View>{mode === 'solo' ? <Operation onOpenReplays={() => setMode('replays')} /> : mode === 'online' ? <OnlineOperation onOpenReplays={() => setMode('replays')} /> : mode === 'practice' ? <Practice>{(attempt, key) => <Operation key={key} practice={attempt} />}</Practice> : <StartScreen><Button label="Start tactical practice" onPress={() => setMode('practice')} /><Button label="Open solo operation" quiet onPress={() => setMode('solo')} /><Button label="Open multiplayer uplink" quiet onPress={() => setMode('online')} /><Button label="Open shared replay" quiet onPress={() => setMode('replays')} /></StartScreen>}</SafeAreaView></SafeAreaProvider>;
}
function Operation({ practice, onOpenReplays }: { practice?: PracticeAttempt; onOpenReplays?: () => void } = {}) {
  const policy = useMemo(() => localLifecycle({ initial: () => operationFor(createGame()), create: newOperation, load: loadGame, save: saveGame }, practice?.scenario.id), [practice?.scenario.id]);
  const [section, setSection] = useState<OperationSection | null>(null);
  const [operation, setOperation] = useState<LocalOperation>(policy.initial);
  const current = useRef(operation);
  const { game, archive } = operation;
  function replace(next: LocalOperation) { current.current = next; setOperation(next); }
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(practice?.scenario.focus ?? 'a');
  const [destination, setDestination] = useState<string>();
  const [planning, setPlanning] = useState(false);
  const [carry, setCarry] = useState(false);
  const [delay, setDelay] = useState(0);
  const [amount, setAmount] = useState('0');
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [navigating, setNavigating] = useState<number>();
  const [mapCamera, setMapCamera] = useState(() => fitPlayerCamera(game, 'you'));
  const [inspectFleet, setInspectFleet] = useState<{ request: number; id?: number }>();
  const inspectionSequence = useRef(0);
  useEffect(() => { setMapCamera(fitPlayerCamera(game, 'you')); setInspectFleet(undefined); }, [game.epoch]);
  const [inspectedHour, setInspectedHour] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  function inspectTime(hour: number | null) { setResolving(false); setInspectedHour(hour); setDelay(0); setPlanning(false); setNavigating(undefined); setDestination(undefined); }
  const forecast = inspectionOffset(game.hour, inspectedHour);
  const historical = inspectionMode(game.hour, inspectedHour) === 'past';
  const [reset, setReset] = useState(false);
  const [newOptions, setNewOptions] = useState<GameOptions>(DEFAULT_GAME_OPTIONS);
  const lastTick = useRef(Date.now());
  useEffect(() => {
    policy.load().then(next => { replace(next); setSelected((next.game.rocks.find(r => r.id === practice?.scenario.focus) ?? next.game.rocks.find(r => r.coreOf === 'you' && r.owner === 'you') ?? next.game.rocks.find(r => r.owner === 'you') ?? next.game.rocks[0]!).id); if (next.game.rules) setNewOptions({ playerCount: next.game.rules.players.length, mode: next.game.rules.mode, driftingBases: driftingBasesEnabled(next.game) }); setInspectedHour(null); }).catch(e => { setError(String(e.message)); setLoadFailed(true); }).finally(() => { lastTick.current = Date.now(); setReady(true); });
  }, []);
  useEffect(() => {
    if (!ready || loadFailed) return;
    policy.save(operation).catch(() => setError('Could not save this operation. Keep the app open and retry.'));
  }, [operation, ready, loadFailed]);
  useEffect(() => {
    if (!ready || loadFailed || !policy.automaticClock) return;
    const tick = () => {
      const now = Date.now();
      const delta = Math.max(0, now - lastTick.current) / 3_600_000;
      lastTick.current = now;
      const op = current.current;
      if (!op.game.winner && !op.game.draw) replace(policy.advance(op, op.game.hour + delta, 'clock'));
    };
    const timer = setInterval(tick, 15_000);
    const subscription = AppState.addEventListener('change', () => tick());
    return () => { clearInterval(timer); subscription.remove(); };
  }, [ready, loadFailed]);
  const live = useMemo(() => observe(game, 'you'), [game]);
  useSoundCues(ready ? live : undefined, 'you');
  useEffect(() => { if (error) playSound('error'); }, [error]);
  const past = useMemo(() => inspectedHour !== null && inspectedHour < current.current.game.hour ? observe(replayTo(archive, inspectedHour, { rivals: policy.rivals, knownThrough: current.current.game.hour }), 'you') : null, [archive, inspectedHour, historical]);
  const shown = past ?? (forecast ? forecastObservation(live, 'you', game.hour + forecast) : live);
  const orders = past ?? live;
  const visibleWorld = { rocks: shown.rocks.filter((r): r is Rock & { known: true } => r.known), fleets: shown.fleets, funding: shown.funding };
  const historyStart = useMemo(() => exportArchive(archive).baseline.hour, [archive]);
  const rock = shown.rocks.find(r => r.id === selected)!;
  const target = shown.rocks.find(r => r.id === destination);
  const owned = shown.rocks.filter(r => r.owner === 'you');
  const status = operationStatus(game, 'you');
  const assessment = policy.assess(operation);
  const reported = useRef(false);
  useEffect(() => { if (assessment?.status === 'passed' && !reported.current) { reported.current = true; practice?.onPassed(); } }, [assessment?.status]);
  const operational = status === 'active' && ready && !loadFailed && !historical && !resolving && (!assessment || assessment.status === 'active');
  useEffect(() => {
    if (!resolving || !practice) return;
    let frame: number, previous: number | undefined, canceled = false;
    function step(timestamp: number) {
      if (canceled) return;
      // Limit each frame so returning from the background never skips the action.
      const elapsed = previous === undefined ? 0 : Math.max(0, Math.min(100, timestamp - previous));
      previous = timestamp;
      if (elapsed > 0) {
        try {
          const hoursPerSecond = 0.5;
          const next = policy.advance(current.current, current.current.game.hour + elapsed / 1000 * hoursPerSecond, 'manual');
          replace(next);
          if (policy.assess(next)?.status !== 'active') { setResolving(false); return; }
        } catch (error) { setError((error as Error).message); setResolving(false); return; }
      }
      frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    return () => { canceled = true; cancelAnimationFrame(frame); };
  }, [resolving, policy]);
  const outcomeMessage = {
    active: '',
    draw: 'No operational intelligences remain. The operation ended in a draw.',
    victory: 'Contract fulfilled. The belt is yours.',
    defeat: `Contract lost. ${game.winner ? FACTIONS[game.winner].name : 'A rival'} fulfilled the contract.`,
    eliminated: 'Your intelligence has been eliminated. Assets and sensor access remain; orders and extraction have ended.',
  }[status];
  const unitManifest = (rock.known ? rock.specialists ?? [] : []).filter(u => selectedUnits.includes(u.id) && u.owner === 'you' && !u.captive);
  const unitIds = unitManifest.map(u => u.id);
  const count = Number(amount);
  const preparation = game.version === 2 ? LAUNCH_PREPARATION : 0;
  const launchAt = Math.max(game.hour, inspectedHour ?? game.hour) + delay;
  const transfer = target && game.version === 2 ? stationCourse(shown, rock, target, specialistSpeed(shown, 'you', unitManifest, target.owner === 'you'), launchAt + preparation) : undefined;
  const duration = target ? transfer ? transfer.arrives - launchAt - preparation : travelHours(rock, target, carry ? rock.module : undefined, game.version) : 0;
  const launchBlocked = launchBlockReason({ game: shown, owner: 'you', source: rock, target, liveHour: game.hour, executeAt: launchAt, drones: count, units: unitIds.length,
    unavailable: historical ? 'History is read-only. Return to Now or choose a future time.' : !operational ? 'Launches are unavailable until the operation is active and loaded.' : undefined });
  const canSend = launchBlocked === undefined;
  function inspectSpecialistSite(id: string) {
    const site = shown.rocks.find(r => r.id === id);
    if (!site) return;
    setPlanning(false); setNavigating(undefined); setDestination(undefined); setDelay(0); setCarry(false); setSelectedUnits([]);
    setSelected(site.id); setAmount(String(Math.floor((site.drones ?? 0) / 2)));
    setInspectFleet({ request: ++inspectionSequence.current });
    setMapCamera(camera => focusCamera(shown, camera, site)); setSection('asset');
  }
  function inspectSpecialistFleet(id: number) {
    const fleet = shown.fleets.find(f => f.id === id);
    if (!fleet) return;
    setPlanning(false); setNavigating(undefined); setDestination(undefined); setDelay(0); setCarry(false); setSelectedUnits([]);
    setMapCamera(camera => focusCamera(shown, camera, fleetPosition(shown, fleet)));
    setInspectFleet({ request: ++inspectionSequence.current, id }); setSection(null);
  }
  function select(r: ObservedRock) {
    if (navigating !== undefined) { if (!r.destroyed) siteAction({ type: 'hauler', change: { action: 'course', fleet: navigating, to: r.id } }); setNavigating(undefined); setSection('orders'); return; }
    if (planning && r.id !== selected) { setDestination(r.id); setSection('asset'); }
    else if (!planning) { setSection('asset'); setSelected(r.id); setDestination(undefined); setCarry(false); setSelectedUnits([]); setAmount(String(Math.max(game.version === 2 ? 0 : 1, Math.floor((r.drones ?? 0) / 2)))); }
  }
  function prepareTransfer(from: ObservedRock, to: ObservedRock) {
    if (!operational || from.owner !== 'you' || from.destroyed || to.destroyed) return;
    setSelected(from.id); setDestination(to.id); setPlanning(true); setSection('asset');
    setCarry(false); setSelectedUnits([]); setDelay(0); setNavigating(undefined);
    setAmount(String(Math.floor((from.drones ?? 0) / 2)));
  }
  function send() {
    if (!canSend || !destination) return;
    try { const executeAt = orderHour(game.hour, inspectedHour, delay); act(executeAt > game.hour ? { type: 'schedule', owner: 'you', plan: { id: Crypto.randomUUID(), from: selected, to: destination, drones: count, executeAt, carryModule: carry && !!rock.module, specialists: unitIds } } : { type: 'dispatch', owner: 'you', from: selected, to: destination, drones: count, carryModule: carry && !!rock.module, specialists: unitIds }); setDelay(0); setPlanning(false); setSection(null); setDestination(undefined); setCarry(false); setSelectedUnits([]); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function intercept(target: number) {
    if (siteAction({ type: 'intercept', from: selected, target, drones: count, ...(unitIds.length ? { specialists: unitIds } : {}) })) {
      setPlanning(false); setDestination(undefined); setCarry(false); setDelay(0);
    }
  }
  function cancelPlan(id: string) {
    try { act({ type: 'cancel-schedule', owner: 'you', id }); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function act(command: GameCommand) {
    if (resolving) throw new Error('Pause playback before changing orders.');
    if (inspectionMode(current.current.game.hour, inspectedHour) === 'past') throw new Error('Historical views are read-only. Return to Now to issue an order.');
    replace(policy.submit(current.current, command));
  }
  function siteAction(action: FutureAction) {
    if (!operational || shown.winner || shown.draw || shown.eliminated.includes('you')) return false;
    try {
      const executeAt = orderHour(current.current.game.hour, inspectedHour, 0);
      act(executeAt > current.current.game.hour ? { type: 'schedule-action', owner: 'you', plan: { id: Crypto.randomUUID(), executeAt, action } } : { ...action, owner: 'you' });
      setError('');
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }
  function changeUnits(command: GameCommand) { try { act(command); setError(''); } catch (e) { setError((e as Error).message); } }
  function buildModule(kind: ModuleKind) {
    try { act({ type: 'install-module', owner: 'you', rock: selected, kind }); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  const canResolvePractice = !!practice && operational && (game.fleets.some(f => f.owner === 'you') || !!game.scheduled?.some(p => p.owner === 'you'));
  function resolvePracticeOrders() {
    if (!canResolvePractice) return;
    inspectTime(null); setSection(null); setError(''); setResolving(true);
  }
  function advanceClock(hours: number) {
    if (!operational || practice && inspectedHour !== null) return;
    try { lastTick.current = Date.now(); replace(policy.advance(current.current, current.current.game.hour + hours, 'manual')); setInspectedHour(null); setPlanning(false); setNavigating(undefined); setDestination(undefined); setError(''); }
    catch (error) { setError((error as Error).message); }
  }
  function skip() { advanceClock(6); }

  return <View style={s.safe}>
    <OperationShell portraits={shown.rules?.portraits} section={section} onSection={setSection}
      status={(practice || error || outcomeMessage) ? <>{practice && assessment ? <PracticeStatus {...practice} status={assessment.status} message={assessment.message} hour={game.hour} inspected={inspectedHour !== null} resolving={resolving} canResolve={canResolvePractice} onResolve={resolvePracticeOrders} onPause={() => setResolving(false)} onAdvance={advanceClock} onNow={() => inspectTime(null)} /> : <View style={s.between}><Text style={s.mono}>The quiet belt · solo{game.rules ? ` · ${game.rules.mode}` : ''}</Text><Text style={s.clock}>{clock(shown.hour)}</Text></View>}{!!error && <View style={s.notice}><Text style={{ color: '#efb293', fontSize: 12, flex: 1 }}>{error}</Text><Button label={practice ? 'Dismiss' : loadFailed ? 'Reset save' : 'Retry save'} quiet onPress={() => practice ? setError('') : loadFailed ? setReset(true) : policy.save(operation).then(() => setError('')).catch(() => setError('Save still unavailable.'))} /></View>}
{!practice && !!outcomeMessage && <View style={s.notice}><Text accessibilityRole="alert" style={{ color: green, flex: 1 }}>{outcomeMessage}</Text><Button label="New operation" onPress={() => setReset(true)} quiet /></View>}</> : null}
      chart={<BeltMap fill combatObservation={{ view: shown, faction: 'you', observedAt: past ? past.hour : live.hour }} viewport={{ camera: mapCamera, onChange: setMapCamera }} inspectFleet={inspectFleet} inspecting={section === 'asset'} transferRoute={transfer?.route} timeInspection={{ liveHour: game.hour, historyStart, onInspect: inspectTime }} player="you" onInspectFleet={() => setSection(null)} onManageFleet={() => setSection('orders')} onTransfer={operational && !shown.winner && !shown.draw && navigating === undefined ? prepareTransfer : undefined} game={shown} selected={selected} destination={destination} onSelect={select} />}
      hint={(planning && !destination || navigating !== undefined) ? <><Text style={s.mapHintText}>{navigating !== undefined ? 'Select a new course destination' : `From ${rock.name}: choose destination`}</Text><Button label="Cancel selection" quiet onPress={() => { setNavigating(undefined); setPlanning(false); setSection('asset'); }} /></> : undefined}
      timeline={<TimeMachine opening={openingEnabled(shown)} forecastUncertain={shown.forecastUncertain} fleets={orders.fleets} plans={orders.scheduled} rocks={shown.rocks} compact historyStart={historyStart} hour={game.hour} inspectedHour={inspectedHour} onChange={inspectTime} events={[...shown.events.map(e => e.hour), ...shown.fleets.flatMap(f => [f.arrives, ...(f.preparing ? [f.departed] : []), ...(f.pendingCourse ? [f.pendingCourse.executeAt] : [])]), ...orders.scheduled.map(p => p.executeAt)]} />}
      panels={{
        asset: { title: planning ? `${rock.name} → ${target?.name ?? 'Choose destination'}` : rock.name, footer: planning ? <View>{launchBlocked && <Text accessibilityRole="alert" style={[s.small, { marginBottom: 6 }]}>{launchBlocked}</Text>}<Text style={[s.small, { color: ink, marginBottom: 6 }]}>{launchCargoLabel(count, unitManifest, carry ? rock.module : undefined)}</Text><Text style={s.small}>{Math.floor(rock.drones ?? 0)} {forecast ? 'projected on station' : 'on station'}{target ? ` · arrives ${clock(launchAt + preparation + duration)}` : ''}</Text><View style={s.row}><View style={{ flex: 1 }}><Button label={launchAt > game.hour ? `Schedule at ${clock(launchAt)}` : game.version === 2 ? 'Prepare launch · 10m' : 'Launch hauler ↗'} disabled={!canSend} onPress={send} /></View><Button label="Cancel" quiet onPress={() => { setPlanning(false); setDestination(undefined); setDelay(0); }} /></View></View> : undefined, content: <View style={{ gap: 8 }}>
            {!!shown.uncertain.length && <Text style={s.small}>Arrival outcomes unknown outside observed sensors. Refresh live observations before relying on this forecast.</Text>}
            {shown.interceptionUncertain && <Text style={s.small}>Interception outcome unknown. The target is outside current observations.</Text>}
            {!planning && <><Text style={s.small}>{rock.known ? `${rock.owner ? FACTIONS[rock.owner].name : 'Unclaimed'} · ${siteDescription(rock, shown)}` : remoteSiteDescription(rock)}</Text><Text style={{ color: ink, fontSize: 15 }}>{rock.known ? `${Math.floor(rock.drones)} drones on site` : 'Inventory unknown'}</Text></>}
            {planning && <Text style={s.small}>{target ? `${duration.toFixed(2)}h transit · arrives ${clock(launchAt + preparation + duration)}` : 'Choose a destination on the chart.'}</Text>}
            {rock.owner === 'you' && <DroneManifest compact value={amount} available={rock.drones ?? 0} disabled={!operational} onChange={setAmount} />}
            {planning ? <>
              <LaunchTiming compact future={!!forecast} delay={delay} disabled={!operational} onChange={setDelay} />
            </> : <Button label={rock.owner === 'you' ? forecast ? 'Plan transfer at this time ↗' : 'Plan transfer ↗' : 'Select your rock to dispatch'} disabled={!operational || !!shown.winner || !!rock.destroyed || rock.owner !== 'you' } onPress={() => { setPlanning(true); setSection(null); }} />}
            {planning && rock.known && rock.owner === 'you' && target && target.owner && target.owner !== 'you' && !shown.eliminated.includes(target.owner) && !delay && <GiftTransfer key={`${selected}:${destination}:${inspectedHour}:${count}:${unitIds.join(',')}`} scheduledAt={forecast ? inspectedHour! : undefined} specialists={unitManifest} legacy={game.version !== 2} from={rock} to={target} recipient={target.owner} drones={count} carry={carry} disabled={!operational || !!shown.winner || !!shown.draw || shown.eliminated.includes('you') || !Number.isSafeInteger(count) || count < (unitIds.length ? 0 : 1) || count > Math.floor(rock.drones)} onGift={() => { if (siteAction({ type: 'gift', from: selected, to: target.id, drones: count, recipient: target.owner!, carryModule: carry && !!rock.module, specialists: unitIds })) { setPlanning(false); setDestination(undefined); setSection(null); setCarry(false); setSelectedUnits([]); } }} />}
            {!planning && game.version === 2 && rock.known && rock.owner === 'you' && <SiteControls minesAllowed={game.rules?.mode !== 'domination'} rock={rock} cost={mineCost({ minesDrilled: { you: 0, vesper: 0, null: 0, ...shown.minesDrilled } }, 'you')} enabled={operational && !shown.winner && !shown.draw && !shown.eliminated.includes('you')} scheduledAt={forecast ? inspectedHour! : undefined} onMine={() => siteAction({ type: 'drill-mine', rock: selected })} onShields={() => siteAction({ type: 'shields', rock: selected, disabled: !rock.shieldsDisabled })} />}
            {!planning && rock.known && rock.owner === 'you' && <InterceptionTargets game={shown} source={rock} owner="you" drones={count} specialists={unitIds} scheduledAt={forecast ? inspectedHour! : undefined} targetIds={forecast ? observedInterceptionIds(live, 'you') : undefined} disabled={!operational || !!shown.winner || !!shown.draw || shown.eliminated.includes('you')} onIntercept={intercept} />}
            {game.version === 2 && rock.known && rock.owner === 'you' && (!planning || !!rock.specialists?.length) && <SpecialistBay mode="cargo" game={shown} rock={rock} owner="you" enabled={operational && !shown.winner && !shown.draw && !shown.eliminated.includes('you')} scheduledAt={forecast ? inspectedHour! : undefined} selectionEnabled={operational} selected={unitIds} onSelect={setSelectedUnits} onHire={kind => siteAction({ type: 'hire', kind })} onPromote={id => siteAction({ type: 'promote', id })} onRelease={id => siteAction({ type: 'release', id })} />}
            {rock.owner !== 'you' && !!rock.specialists?.length && <View>{rock.specialists.map(u => <Text key={u.id} style={s.small}>{SPECIALISTS[u.kind].name}{u.captive ? ' · captive' : ''}: {u.captive ? 'Abilities inactive.' : SPECIALISTS[u.kind].description}</Text>)}</View>}
            {game.version === 1 && rock.known && rock.owner === 'you' && <ModuleBay rock={rock} enabled={operational && !forecast} carry={carry} onCarry={setCarry} onBuild={buildModule} />}
          </View> },
        orders: { title: 'Your orders', content: <>{game.version === 2 && <HaulerOrders courseDelay={mechanicsVersion(shown) >= 10} title={historical ? 'Historical hauler orders · read-only' : undefined} fleets={forecast ? futureCommandFleets(shown, live, 'you') : shown.fleets.filter(f => f.owner === 'you')} rocks={shown.rocks} hour={shown.hour} scheduledAt={forecast ? inspectedHour! : undefined} enabled={operational && !shown.winner && !shown.draw && !shown.eliminated.includes('you')} onNavigate={id => { setSection(null); setNavigating(current => current === id ? undefined : id); setPlanning(false); setDestination(undefined); }} onCommand={change => siteAction({ type: 'hauler', change })} />} <ScheduledOrders key={`${game.epoch}:${inspectionMode(game.hour, inspectedHour)}`} units={selectableLaunchUnits(orders, 'you')} preparation={game.version === 2} onInspect={inspectTime} onEdit={change => { try { act({ type: 'edit-schedule', owner: 'you', change }); setError(''); } catch (e) { setError((e as Error).message); } }} fleets={orders.fleets} plans={orders.scheduled.filter(p => p.owner === 'you')} hour={orders.hour} rocks={shown.rocks} disabled={!operational} onCancel={cancelPlan} /><View style={s.panel}><Label>Observed haulers</Label>{shown.fleets.map(f => <Text key={f.id} style={s.small}>{FACTIONS[f.owner].name} → {flightDestination(shown.rocks, f)} · {f.drones} drones · {(f.arrives - shown.hour).toFixed(1)}h</Text>)}</View></> },
        units: { title: 'Specialist management', content: game.version === 2 ? <SpecialistPanel game={shown} owner="you" enabled={operational} scheduledAt={forecast ? inspectedHour! : undefined} onHire={kind => siteAction({ type: 'hire', kind })} onPromote={id => siteAction({ type: 'promote', id })} onRelease={id => siteAction({ type: 'release', id })} onInspectSite={inspectSpecialistSite} onInspectFleet={inspectSpecialistFleet} /> : <Text style={s.small}>Legacy modules are managed at their sites.</Text> },
        signals: { title: 'Signal log', content: <SignalLog view={shown} /> },
        intel: { title: 'Intelligence', content: <><View style={s.identity}><View style={s.between}><Label>Your intelligence</Label><Text style={s.online}>● AUTONOMOUS</Text></View><Text style={s.identityName}>Mnemosyne<Text style={{ color: '#5b6e5c' }}> / 01</Text></Text><Text style={s.small}>{game.version === 2 ? `Power: ${droneInventory(visibleWorld, 'you')} / ${powerCapacity(visibleWorld, 'you')} drones. ${game.rules?.mode === 'domination' ? 'Expand control to reach the territorial target.' : 'Establish extraction to earn cargo.'}` : 'Legacy operation · original prototype rules.'}</Text>
            <View style={s.stats}><View><Text style={s.statNumber}>{owned.length.toString().padStart(2, '0')}</Text><Label>Rocks</Label></View><View><Text style={s.statNumber}>{Math.floor(droneInventory(visibleWorld, 'you'))}</Text><Label>Drones</Label></View><View><Text style={s.statNumber}>{shown.fleets.filter(f => f.owner === 'you').length.toString().padStart(2, '0')}</Text><Label>Haulers</Label></View></View>
            <View style={s.between}><Text style={s.small}>{game.rules?.mode === 'domination' ? 'Controlled sites' : 'Cargo quota'}</Text><Text style={s.small}>{Math.floor(victoryProgress(shown, 'you'))} / {victoryTarget(game)}</Text></View><View style={s.progress}><View style={[s.progressFill, { width: `${Math.min(100, victoryProgress(shown, 'you') / victoryTarget(game) * 100)}%` }]} /></View>
          </View><TerritoryStandings game={shown} /><FundingPanel game={shown} owner="you" enabled={operational && !shown.winner && !shown.draw && !shown.eliminated.includes('you')} scheduledAt={forecast ? inspectedHour! : undefined} onChange={(to, enabled) => siteAction({ type: 'funding', to, enabled })} /></> },
        settings: { title: practice ? 'Practice exercise' : 'Solo operation', content: practice ? <View style={s.panel}><Text style={s.small}>Time advances only when you choose. Retry to start this exercise from the same position.</Text><Button label="Retry exercise" quiet onPress={practice.onRetry} /><Button label="All exercises" quiet onPress={practice.onBack} /></View> : <>{game.version === 2 && <ReplayExport key={game.epoch} historyStart={historyStart} hour={game.hour} disabled={!ready || loadFailed} createReplay={(from, through) => generateSharedReplay(current.current, 'you', from, through)} />}{onOpenReplays && <Button label="Open shared replay" quiet onPress={onOpenReplays} />}<View style={s.row}><View style={{ flex: 1 }}><Button label="Advance simulation +6h" quiet disabled={!operational || !!forecast} onPress={skip} /></View><Button label="Reset" quiet onPress={() => setReset(true)} /></View><Text style={s.small}>{game.rules ? `${game.rules.players.length} intelligences · ${game.rules.mode} · target ${victoryTarget(game)} ${game.rules.mode === 'domination' ? 'controlled sites' : 'cargo'}` : 'Fixed chart · 3 intelligences'}</Text><Text style={s.small}>Local simulation. Time continues while you’re away. Rivals follow deterministic training orders. The multiplayer inactivity rule does not apply to this training operation.</Text>{game.version === 2 && <ResignationControl key={`${historical}:${forecast > 0}:${status}`} enabled={operational && !forecast} onConfirm={() => changeUnits({ type: 'resign', owner: 'you' })} />}</> },
      }} />
    <Modal visible={!practice && reset} transparent animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={() => setReset(false)}><View style={s.overlay}><ScrollView style={s.dialog} contentContainerStyle={s.dialogContent}><Label>Terminate operation</Label><Text style={s.heading}>Start again?</Text><Text style={s.dialogBody}>This replaces the local operation and its history. A fresh generated chart will use the settings below.</Text><GameSetup value={newOptions} onChange={setNewOptions} /><Button label="Replace operation" onPress={() => { const next = newOperation(newOptions); replace(next); lastTick.current = Date.now(); setLoadFailed(false); setError(''); setSelected((next.game.rocks.find(r => r.coreOf === 'you' && r.owner === 'you') ?? next.game.rocks[0]!).id); setSelectedUnits([]); setNavigating(undefined); setInspectedHour(null); setPlanning(false); setDestination(undefined); setReset(false); }} /><Button label="Keep operation" quiet onPress={() => setReset(false)} /></ScrollView></View></Modal>
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
  notice: { padding: 15, borderWidth: 1, borderColor: '#705741', marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10 },
  overlay: { flex: 1, backgroundColor: '#000b', alignItems: 'center', justifyContent: 'center', padding: 22 },
  dialog: { width: '100%', maxWidth: 480, maxHeight: '90%', flexGrow: 0, backgroundColor: '#101b13', borderWidth: 1, borderColor: '#526644' },
  dialogContent: { padding: 25, gap: 10 },
  dialogBody: { color: '#a8b8a2', fontSize: 13, lineHeight: 21, marginVertical: 10 },
});
