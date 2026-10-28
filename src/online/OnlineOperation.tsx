/**
 * ---
 * purpose: Invite lobby, server-authoritative orders, reconnect, and private bilateral diplomacy on mobile and web.
 * ---
 */
import { GameSetup } from '../components/GameSetup';
import { DEFAULT_GAME_OPTIONS, victoryProgress, victoryTarget, type GameOptions } from '../game/rules';
import { playersIn } from '../game/players';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ResignationControl } from '../components/ResignationControl';
import { presenceDue, inactivityRemaining } from './presence';
import { worldDistance } from '../game/geometry';
import { flightDestination } from '../game/flight';
import { InterceptionTargets } from '../components/InterceptionTargets';
import { selectableLaunchUnits } from '../components/launch-manifest';
import { remoteSiteDescription } from '../components/site-observation';
import { LaunchTiming, ScheduledOrders, scheduledOrderLabel } from '../components/ScheduledOrders';
import type { FutureAction } from '../game/future-actions';
import { SpecialistBay } from '../components/SpecialistBay';
import { specialistSpeed } from '../game/specialist-effects';
import { SPECIALISTS } from '../game/specialist-catalog';
import { ModuleBay } from '../components/ModuleBay';
import { GiftTransfer } from '../components/GiftTransfer';
import { MODULES } from '../game/modules';
import { fitPlayerCamera } from '../game/chart-camera';
import { BeltMap } from '../components/BeltMap';
import { futureCommandFleets, observedInterceptionIds } from '../components/fleet-planning';
import { HaulerOrders } from '../components/HaulerOrders';
import { SiteControls, siteDescription } from '../components/SiteControls';
import { LAUNCH_PREPARATION } from '../game/transport';
import { mineCost } from '../game/economy';
import { useDiplomacyPanel } from './DiplomacyPanel';
import { TerritoryStandings } from '../components/TerritoryStandings';
import { FundingPanel } from '../components/FundingPanel';
import { OperationShell, type OperationSection } from '../components/OperationShell';
import { TimeMachine } from '../components/TimeMachine';
import { gameClock, inspectionMode, inspectionOffset, orderHour } from '../game/time-machine';
import { forecastObservation } from '../game/visibility';
import { FACTIONS, travelHours } from '../game/simulation';
import { commandId, connect, newCredential, newSession, restoreSession, storeSession, type Pending, type Session } from './client';
import { useHistoricalView } from './useHistoricalView';
import { api, RejectedCommand } from './network';
import { parseRecoveryCode, formatRecoveryCode } from './recovery';
import type { ObjectReference, Snapshot } from './protocol';
import { copyableReference, focusReferenceCamera, referenceInspectionHour, resolveReference, type ReferenceFrame } from './reference-inspection';
import { encodeObjectReference } from './object-references';
import { CopyObjectReference } from '../components/CopyObjectReference';
function Action({ text, onPress, disabled = false }: { text: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.buttonText}>{text}</Text></Pressable>;
}
export function OnlineOperation() {
  const [section, setSection] = useState<OperationSection | null>(null);
  const [mapCamera, setMapCamera] = useState({ scale: 1, x: 0, y: 0 });
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [url, setUrl] = useState(process.env.EXPO_PUBLIC_GAME_SERVER ?? 'http://localhost:8787');
  const [invite, setInvite] = useState('');
  const [options, setOptions] = useState<GameOptions>({ ...DEFAULT_GAME_OPTIONS });
  const [busy, setBusy] = useState(true);
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
  const [referenceRequest, setReferenceRequest] = useState<{ reference: ObjectReference; mode: 'observed' | 'now'; identity: string }>();
  const [referenceNotice, setReferenceNotice] = useState('');
  const referenceSequence = useRef(0);
  const [inspectFleet, setInspectFleet] = useState<{ request: number; id?: number }>();
  const referenceIdentity = JSON.stringify([session?.url, session?.id, session?.token, snapshot?.faction]);
  function inspectTime(hour: number | null) { setReferenceRequest(undefined); setReferenceNotice(''); setInspectedHour(hour); setDelay(0); setPlanning(false); setNavigating(undefined); setDestination(undefined); }
  function changeSection(next: OperationSection | null) { setReferenceRequest(undefined); setReferenceNotice(''); setSection(next); }
  const mode = inspectionMode(snapshot?.game.hour ?? 0, inspectedHour);
  const past = mode === 'past';
  const history = useHistoricalView(session?.id && snapshot?.history ? { ...session, id: session.id, faction: snapshot.faction } : undefined, past ? inspectedHour : null);
  useEffect(() => { setReferenceRequest(undefined); setReferenceNotice(''); setInspectFleet({ request: ++referenceSequence.current }); }, [referenceIdentity]);
  useEffect(() => { setPlanning(false); setNavigating(undefined); setDestination(undefined); setCarry(false); setSelectedUnits([]); setDelay(0); }, [mode, session?.url, session?.id, session?.token]);
  useEffect(() => { if (snapshot) setMapCamera(fitPlayerCamera(snapshot.game, snapshot.faction)); }, [session?.url, session?.id, snapshot?.faction, snapshot?.game.epoch]);
  const forecast = inspectionOffset(snapshot?.game.hour ?? 0, inspectedHour);
  const [acknowledged, setAcknowledged] = useState<string>();
  const [disconnect, setDisconnect] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const lock = useRef(false);
  const lastActivity = useRef(0);
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const scroll = useRef<ScrollView>(null);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await work(); setError(''); } catch (e) { if (e instanceof RejectedCommand && e.status === 401) { setSnapshot(undefined); setRecoveryCode(''); } setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  function accept(next: Snapshot) {
    if (next.inactivity && next.inactivity.expiresAt !== latestSnapshot.current?.inactivity?.expiresAt) lastActivity.current = Date.now();
    latestSnapshot.current = next; setSnapshot(next);
  }
  useEffect(() => { void run(async () => {
    const saved = await restoreSession();
    if (!saved) return;
    setSession(saved);
    if (saved.pending?.kind === 'recover') { await complete(saved, saved.pending); return; }
    const result = await connect(saved); setSession(result.session); accept(result.snapshot);
    setSelected((result.snapshot.game.rocks.find(r => r.owner === result.snapshot.faction) ?? result.snapshot.game.rocks[0]!).id);
  }); }, []);
  useEffect(() => {
    if (!session?.id || session.pending?.kind === 'recover') return;
    const refresh = (foregroundEvent = false) => void run(async () => {
      const active = AppState.currentState === 'active';
      const presence = presenceDue({ now: Date.now(), lastActivity: lastActivity.current, active, eligible: !!latestSnapshot.current?.inactivity, foregroundEvent });
      const next = await api(session, `games/${session.id}${presence ? '/activity' : ''}`, presence ? {} : undefined);
      if (presence) lastActivity.current = Date.now();
      accept(next);
    });
    const timer = setInterval(() => refresh(), 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(true); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [session]);
  async function enter(join: boolean) {
    await run(async () => {
      const created = await newSession(url, join ? invite : undefined, join ? undefined : options);
      await storeSession(created); setSnapshot(undefined); setInspectedHour(null); setSession(created);
      const result = await connect(created); setSession(result.session); accept(result.snapshot);
      setSelected((result.snapshot.game.rocks.find(r => r.owner === result.snapshot.faction) ?? result.snapshot.game.rocks[0]!).id);
    });
  }
  async function complete(saved: Session, pending: Pending) {
    try {
      const next = await api(saved, `games/${saved.id}/${pending.kind}`, pending.body);
      const cleared = { ...saved, pending: undefined };
      await storeSession(cleared); setSession(cleared); accept(next);
      if (pending.kind === 'recovery') setRecoveryCode(formatRecoveryCode(saved.id!, pending.body.secret));
      if (pending.kind === 'recover') {
        setSelected((next.game.rocks.find(r => r.owner === next.faction) ?? next.game.rocks[0]!).id);
        setRecoveryInput('');
      }
      if (pending.kind === 'messages' || pending.kind === 'channel-messages' || pending.kind === 'groups') setAcknowledged(pending.body.requestId);
      else if (pending.kind === 'orders' || pending.kind === 'schedules' || pending.kind === 'gifts' || pending.kind === 'intercepts' || pending.kind === 'recover' || pending.kind === 'haulers' && pending.body.action === 'course') {
        setSection(null); setDestination(undefined); setPlanning(false); setCarry(false); setDelay(0); setSelectedUnits([]); setNavigating(undefined);
      }
    } catch (error) {
      if (error instanceof RejectedCommand) {
        const cleared = { ...saved, pending: undefined };
        await storeSession(pending.kind === 'recover' ? null : cleared); setSession(pending.kind === 'recover' ? null : cleared);
        try { accept(await api(cleared, `games/${cleared.id}`)); } catch { /* Keep the last confirmed snapshot. */ }
      }
      throw error;
    }
  }
  function createRecovery() {
    if (!session?.id) return;
    setRecoveryCode('');
    void run(async () => {
      const pending: Pending = { kind: 'recovery', body: { requestId: commandId(), secret: await newCredential() } };
      const saved = { ...session, pending }; await storeSession(saved); setSession(saved);
      await complete(saved, pending);
    });
  }
  function restoreSeat() {
    void run(async () => {
      const code = parseRecoveryCode(recoveryInput);
      const fresh = await newSession(url);
      const pending: Pending = { kind: 'recover', body: { secret: code.secret } };
      const saved = { ...fresh, id: code.id, pending };
      await storeSession(saved); setSnapshot(undefined); setInspectedHour(null); setSession(saved); await complete(saved, pending);
    });
  }
  async function retry() {
    if (past && session?.pending && !['messages', 'groups', 'channel-messages', 'recovery', 'recover'].includes(session.pending.kind)) { setError('Historical views are read-only. Return to Now to retry an order.'); return; }
    if (mode !== 'live' && session?.pending && ['resign', 'orders', 'gifts', 'intercepts', 'haulers', 'modules', 'sites', 'specialists', 'funding'].includes(session.pending.kind)) { setError('Return to Now to retry a live action. Scheduled orders can be retried from a forecast.'); return; }
    if (session?.id && session.pending) await complete(session, session.pending);
  }
  function submit(pending: Pending) {
    if (!session) return;
    if (past && !['messages', 'groups', 'channel-messages', 'recovery', 'recover'].includes(pending.kind)) { setError('Historical views are read-only. Return to Now to issue orders.'); return; }
    if (pending.kind === 'resign' && (mode !== 'live' || busy || session.pending || snapshot?.status !== 'game.active' || snapshot.game.version !== 2 || snapshot.game.eliminated.includes(snapshot.faction))) return;
    void run(async () => {
      const saved = { ...session, pending }; await storeSession(saved); setSession(saved);
      await complete(saved, pending);
    });
  }
  function siteAction(action: FutureAction) {
    if (!snapshot || !operational || !game || game.winner || game.draw || game.eliminated.includes(snapshot.faction)) return;
    const base = { requestId: commandId(), revision: snapshot.revision };
    try {
      const executeAt = orderHour(snapshot.game.hour, inspectedHour, 0);
      if (executeAt > snapshot.game.hour) { submit({ kind: 'schedules', body: { ...base, executeAt, action } }); return; }
      switch (action.type) {
        case 'hire': submit({ kind: 'specialists', body: { ...base, action: 'hire', kind: action.kind } }); break;
        case 'promote': case 'release': submit({ kind: 'specialists', body: { ...base, action: action.type, unit: action.id } }); break;
        case 'drill-mine': submit({ kind: 'sites', body: { ...base, rock: action.rock, action: 'mine' } }); break;
        case 'shields': submit({ kind: 'sites', body: { ...base, rock: action.rock, action: 'shields', disabled: action.disabled } }); break;
        case 'gift': { const { type, ...gift } = action; submit({ kind: 'gifts', body: { ...base, ...gift } }); break; }
        case 'intercept': { const { type, ...intercept } = action; submit({ kind: 'intercepts', body: { ...base, ...intercept } }); break; }
        case 'hauler': submit({ kind: 'haulers', body: { ...base, ...action.change } }); break;
        case 'funding': submit({ kind: 'funding', body: { ...base, recipient: action.to, enabled: action.enabled } }); break;
      }
    } catch (error) { setError((error as Error).message); }
  }
  function sendTransfer() {
    if (!snapshot || !destination) return;
    const body = { requestId: commandId(), revision: snapshot.revision, from: selected, to: destination, drones: Number(amount), specialists: unitIds, carryModule: carry && !!snapshot.game.rocks.find(r => r.id === selected)?.module };
    try {
      const executeAt = orderHour(snapshot.game.hour, inspectedHour, delay);
      submit(executeAt > snapshot.game.hour ? { kind: 'schedules', body: { ...body, executeAt } } : { kind: 'orders', body });
    } catch (error) { setError((error as Error).message); }
  }
  const pendingEdit = session?.pending?.kind === 'edit-schedule' ? session.pending.body : undefined;
  const pendingPlan = pendingEdit && snapshot?.game.scheduled.find(plan => plan.id === pendingEdit.planId);
  const recoveryPending = session?.pending?.kind === 'recover' || session?.pending?.kind === 'recovery';
  const game = past ? history.frame?.game : snapshot && (forecast ? forecastObservation(snapshot.game, snapshot.faction, snapshot.game.hour + forecast) : snapshot.game);
  const referenceFrame: ReferenceFrame | undefined = forecast ? undefined : past
    ? history.frame && { ...history.frame, at: history.frame.history.at }
    : snapshot && { ...snapshot, at: snapshot.game.hour };
  function inspectReference(reference: ObjectReference, mode: 'observed' | 'now') {
    setPlanning(false); setNavigating(undefined); setDestination(undefined); setSelectedUnits([]); setCarry(false); setDelay(0);
    if (!snapshot) return;
    try {
      const hour = referenceInspectionHour(snapshot, reference, mode);
      inspectTime(hour);
      setReferenceRequest({ reference, mode, identity: referenceIdentity });
      setSection(null);
    } catch (error) { setReferenceRequest(undefined); setReferenceNotice((error as Error).message); }
  }
  useEffect(() => {
    if (!referenceRequest || referenceRequest.identity !== referenceIdentity || !referenceFrame) return;
    if (referenceRequest.mode === 'observed' && referenceFrame.at !== referenceRequest.reference.hour) return;
    const target = resolveReference(referenceFrame, referenceRequest.reference, referenceRequest.mode);
    setReferenceRequest(undefined);
    if (!target) { setReferenceNotice('Reference unavailable in your observations at this time.'); setSection('signals'); return; }
    setMapCamera(camera => focusReferenceCamera(referenceFrame.game, camera, target.point));
    setInspectFleet({ request: ++referenceSequence.current, ...(target.kind === 'hauler' ? { id: target.id } : {}) });
    if (target.kind === 'outpost') { setSelected(target.id); setSection('asset'); } else setSection(null);
    setReferenceNotice(referenceRequest.mode === 'observed' ? `Reference · observed at ${gameClock(referenceFrame.at)}.` : 'Reference · current observations.');
  }, [referenceRequest, referenceIdentity, referenceFrame]);
  function referenceText(kind: ObjectReference['kind'], id: string | number, label: string): string | undefined {
    const reference = referenceFrame && copyableReference(referenceFrame, kind, id);
    return reference ? `${label} ${encodeObjectReference(reference)}` : undefined;
  }
  const orders = past ? game : snapshot?.game;
  const rock = game?.rocks.find(r => r.id === selected);
  const target = game?.rocks.find(r => r.id === destination);
  const unitManifest = rock?.known && snapshot ? (rock.specialists ?? []).filter(u => selectedUnits.includes(u.id) && u.owner === snapshot.faction && !u.captive) : [];
  const unitIds = unitManifest.map(u => u.id);
  const duration = target && rock && game && snapshot ? game.version === 2 ? Math.max(1e-6, worldDistance(game, rock, target) / specialistSpeed(game, snapshot.faction, unitManifest, target.owner === snapshot.faction)) : travelHours(rock, target, carry ? rock.module : undefined, game.version) : 0;
  const operational = !past && snapshot?.status === 'game.active' && !snapshot.game.eliminated.includes(snapshot.faction) && !session?.pending && !busy;
  const immediate = operational && !forecast;
  const preparation = snapshot?.game.version === 2 ? LAUNCH_PREPARATION : 0;
  const launchAt = snapshot ? Math.max(snapshot.game.hour, inspectedHour ?? snapshot.game.hour) + delay : 0;
  const diplomacy = useDiplomacyPanel({ snapshot, origin: JSON.stringify([session?.url, session?.token]), disabled: busy || !!session?.pending, acknowledged, scroll, onSubmit: submit, onInspectReference: inspectReference });
  const rulesGame = snapshot?.game;
  const roster = rulesGame ? playersIn(rulesGame) : [];
  const joined = snapshot ? roster.filter(f => snapshot.members.includes(f)).length : 0;
  const rulesSummary = rulesGame && <Text style={s.detail}>{rulesGame.rules?.mode === 'domination' ? 'Domination' : 'Mining'} · {roster.length} players · {victoryTarget(rulesGame)} {rulesGame.rules?.mode === 'domination' ? 'outposts to control' : 'cargo quota'}</Text>;
  const connection = <>{session ? <View key="connected-seat" style={s.panel}><Text style={s.label}>Connection retained on this device</Text><Text style={s.detail}>{session.url}</Text>{rulesSummary}{!snapshot && session.options && <Text style={s.detail}>Saved creation: {session.options.playerCount} players · {session.options.mode}. Reconnect repeats these options.</Text>}
      {session.pending && <><Text style={s.error}>Request awaiting confirmation. Retry repeats the saved request.</Text><Action text="Retry command" disabled={busy} onPress={() => void run(() => retry())} /></>}
      {recoveryPending && <Text style={s.error}>Confirm this recovery request before removing the connection. The saved request may be needed to keep access to your seat.</Text>}
      <Action text="Reconnect / refresh" disabled={busy || session.pending?.kind === 'recover'} onPress={() => void run(async () => { const result = await connect(session); setSession(result.session); accept(result.snapshot); })} />
      {!!snapshot && <><Text style={s.label}>Seat recovery</Text><Text style={s.detail}>{snapshot.recoveryEnabled ? 'A recovery code is active. Generating another replaces it.' : 'Save a recovery code before leaving this device. Each code works once and replaces the old connection when used.'}</Text><Action text={snapshot.recoveryEnabled ? 'Replace recovery code' : 'Generate recovery code'} disabled={busy || !!session.pending} onPress={createRecovery} /></>}
      {!!recoveryCode && <><Text style={s.detail}>Save this code with the server address in a private place, such as a password manager. It controls your seat. This app only shows it until you leave this screen.</Text><Text selectable style={s.code}>{recoveryCode}</Text><Action text="Hide recovery code" onPress={() => setRecoveryCode('')} /></>}
      {disconnect ? <><Text style={s.error}>Disconnecting removes this device's seat credential. You can return only with a recovery code saved earlier. The server operation continues.</Text><Action text="Keep connection" onPress={() => setDisconnect(false)} /><Action text="Remove seat from this device" disabled={busy || recoveryPending} onPress={() => void run(async () => { await storeSession(null); setSession(null); setSnapshot(undefined); setDisconnect(false); setRecoveryCode(''); })} /></> : <Action text="Disconnect…" disabled={busy || recoveryPending} onPress={() => setDisconnect(true)} />}
    </View> : <View key="connection-entry" style={s.panel}><Text style={s.label}>Game server</Text><TextInput key="server-url" secureTextEntry={false} accessibilityLabel="Game server URL" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} style={s.input} keyboardType="url" />
      <Text style={s.label}>New operation</Text><GameSetup value={options} onChange={setOptions} disabled={busy} /><Action text="Create private operation" disabled={busy} onPress={() => void enter(false)} /><Text style={s.label}>Invitation code</Text><TextInput key="invite-code" secureTextEntry={false} accessibilityLabel="Invitation code" autoCapitalize="none" autoCorrect={false} value={invite} onChangeText={setInvite} style={s.input} maxLength={24} /><Action text="Join operation" disabled={busy || invite.length !== 24} onPress={() => void enter(true)} />
      <Text style={s.label}>Restore your seat</Text><Text style={s.detail}>Use the server address above and a code you saved earlier. Restoring disconnects your old device and consumes the code. Generate a new code afterward.</Text><TextInput key="seat-recovery" accessibilityLabel="Recovery code" autoCapitalize="none" autoCorrect={false} secureTextEntry value={recoveryInput} onChangeText={setRecoveryInput} style={s.input} maxLength={180} /><Action text="Restore seat and revoke old connection" disabled={busy || !recoveryInput.trim()} onPress={restoreSeat} /></View>}</>;
  const setup = <><View style={s.panel}><Text style={s.title}>Operation participation</Text>
    {snapshot?.game.eliminated.includes(snapshot.faction) && <Text style={s.detail}>You are eliminated. Sensors and chat remain available.</Text>}
    {snapshot?.inactivity && <><Text style={s.detail}>After 48 hours of inactivity, you are automatically resigned. Opening this operation in the foreground, issuing orders, or chatting counts as activity. Background refreshes do not.</Text><Text style={s.detail}>{inactivityRemaining(snapshot.inactivity.expiresAt, snapshot.serverTime)} until automatic resignation without further activity. Deadline: {new Date(snapshot.inactivity.expiresAt).toLocaleString()}.</Text></>}
    <ResignationControl key={`${mode}:${session?.url}:${session?.id}:${session?.token}:${snapshot?.faction}:${snapshot?.status}:${snapshot?.game.eliminated.includes(snapshot.faction)}`} enabled={!!immediate && snapshot?.game.version === 2} onConfirm={() => { if (snapshot) submit({ kind: 'resign', body: { requestId: commandId(), revision: snapshot.revision } }); }} />
  </View>{connection}</>;
  const timeline = snapshot && <TimeMachine forecastUncertain={game?.forecastUncertain} fleets={orders?.fleets} plans={orders?.scheduled} rocks={snapshot.game.rocks} compact hour={snapshot.game.hour} historyStart={snapshot.history?.from} inspectedHour={inspectedHour} onChange={inspectTime} events={[...(game?.events.map(event => event.hour) ?? []), ...(game?.fleets.flatMap(f => [f.arrives, ...(f.preparing ? [f.departed] : [])]) ?? []), ...(orders?.scheduled.map(p => p.executeAt) ?? [])]} online />;
  if (snapshot && past && !game) {
    const waiting = <View style={s.panel}><Text accessibilityRole={history.error ? 'alert' : undefined} style={s.detail}>{!snapshot.history ? 'Observed history is unavailable on this server.' : history.error ?? 'Loading observed history…'}</Text><Action text="Now" onPress={() => inspectTime(null)} />{history.error && <Action text="Retry history" onPress={history.retry} />}</View>;
    return <OperationShell section={section} onSection={changeSection} panelScrollRef={scroll}
      status={<><Text style={s.label}>{FACTIONS[snapshot.faction].name} · loading history · {gameClock(inspectedHour!)}</Text>{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}</>}
      chart={<View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>{waiting}</View>} timeline={timeline}
      panels={{ asset: { title: 'Historical asset', content: waiting }, orders: { title: 'Historical orders', content: waiting }, units: { title: 'Historical units', content: waiting }, intel: { title: 'Historical intelligence', content: waiting }, signals: { title: 'Diplomacy and signals', content: <><Text style={s.label}>Chat · current</Text>{diplomacy}</> }, settings: { title: 'Setup', content: setup } }} />;
  }
  if (!snapshot || !game) return <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}><Text style={s.title}>Machination / uplink</Text>{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{connection}</ScrollView>;
  return <OperationShell section={section} onSection={changeSection} panelScrollRef={scroll}
    status={<>{!!referenceNotice && <Text accessibilityLiveRegion="polite" style={s.detail}>{referenceNotice}</Text>}<View style={s.row}><Text style={[s.label, { flex: 1 }]}>{FACTIONS[snapshot.faction].name} · {past ? 'history · read-only' : snapshot.game.eliminated.includes(snapshot.faction) ? 'eliminated' : snapshot.status.replace('game.', '')}</Text><Text style={s.detail}>{gameClock(past ? history.frame!.history.at : game.hour)}</Text></View>{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{snapshot.status === 'game.lobby' && <Action text="Open lobby and invitation" onPress={() => setSection('intel')} />}{pendingEdit && <Text style={s.detail}>Saved launch edit · {pendingPlan ? scheduledOrderLabel(pendingPlan, snapshot.game.rocks, snapshot.game.scheduled, snapshot.game.fleets) : 'Queued launch'} · {pendingEdit.drones} drones · awaiting confirmation. Retry repeats this saved edit.</Text>}{session?.pending && <Action text="Retry pending command" disabled={busy} onPress={() => void run(() => retry())} />}{game.draw && <Text style={s.code}>Operation ended in a draw.</Text>}{game.winner && <Text style={s.code}>{forecast ? 'Projected: ' : ''}{FACTIONS[game.winner].name}: {game.rules?.mode === 'domination' ? 'territory target reached.' : 'contract complete.'}</Text>}</>}
    chart={<BeltMap fill inspectFleet={inspectFleet} fleetReference={fleet => referenceText('hauler', fleet.id, 'Hauler')} timeInspection={{ liveHour: snapshot.game.hour, historyStart: snapshot.history?.from, onInspect: inspectTime }} viewport={{ camera: mapCamera, onChange: setMapCamera }} player={snapshot.faction} onInspectFleet={() => { setReferenceRequest(undefined); setSection(null); }} onManageFleet={() => setSection('orders')} game={game} selected={selected} destination={destination} onSelect={r => { setReferenceRequest(undefined); setReferenceNotice(''); if (navigating !== undefined) { if (!r.destroyed) siteAction({ type: 'hauler', change: { action: 'course', fleet: navigating, to: r.id } }); setNavigating(undefined); return; } if (planning && r.id !== selected) { setDestination(r.id); setSection('asset'); } else if (!planning) { setSection('asset'); setSelected(r.id); setDestination(undefined); setCarry(false); setSelectedUnits([]); if (r.known) setAmount(String(Math.floor(r.drones / 2))); } }} />}
    hint={(planning || navigating !== undefined) ? <><Text style={s.detail}>{navigating !== undefined ? 'Choose a new course destination.' : `From ${rock?.name}: choose a destination.`}</Text><Action text="Cancel selection" onPress={() => { setNavigating(undefined); setPlanning(false); setSection('asset'); }} /></> : undefined}
    timeline={timeline}
    panels={{
      asset: { title: rock?.name ?? 'Selected asset', content: <>{game.interceptionUncertain && <View style={s.panel}><Text style={s.error}>Interception outcome unknown. The target isn't in the current observations.</Text></View>}
{!!game.uncertain.length && <View style={s.panel}><Text style={s.error}>Arrival outcomes unknown at {game.uncertain.map(id => game.rocks.find(r => r.id === id)?.name).join(', ')}. Scout and refresh before relying on this forecast.</Text></View>} {rock && <View style={s.panel}><Text style={s.title}>{rock.name}</Text><Text style={s.detail}>{rock.known ? `${Math.floor(rock.drones)} drones · ${siteDescription(rock)}` : remoteSiteDescription(rock)}</Text><Text style={s.detail}>{target ? `To ${target.name} / ${duration.toFixed(2)}h transit / arrival ${gameClock(launchAt + preparation + duration)}` : planning ? 'Select any other rock as the destination.' : 'Inspect assets or plan a transfer from a controlled rock.'}</Text><Action text={planning ? 'Cancel transfer selection' : 'Choose transfer destination'} disabled={!operational || !!rock.destroyed || rock.owner !== snapshot.faction} onPress={() => { setPlanning(!planning); setDestination(undefined); setSection(planning ? 'asset' : null); }} />
        <TextInput key="online-manifest" secureTextEntry={false} accessibilityLabel="Online drone manifest" value={amount} onChangeText={setAmount} keyboardType="number-pad" style={s.input} />
        <LaunchTiming future={!!forecast} delay={delay} disabled={!operational} onChange={setDelay} />
        <Action text={snapshot && launchAt > snapshot.game.hour ? `Schedule at ${gameClock(launchAt)}` : game.version === 2 ? 'Prepare launch · 10m' : 'Launch hauler'} disabled={!operational || !!game.winner || !!game.draw || !!rock.destroyed || !!target?.destroyed || launchAt > snapshot.game.hour + 168 || !target || rock.owner !== snapshot.faction || !Number.isSafeInteger(Number(amount)) || Number(amount) < (unitIds.length ? 0 : 1) || launchAt <= snapshot.game.hour && Number(amount) > Math.floor(rock.drones ?? 0)} onPress={sendTransfer} />
        {rock.known && rock.owner === snapshot.faction && target && target.owner && target.owner !== snapshot.faction && !game.eliminated.includes(target.owner) && !delay && <GiftTransfer key={`${rock.id}:${target.id}:${target.owner}:${amount}:${carry}:${rock.module}:${unitIds.join(',')}`} scheduledAt={forecast ? inspectedHour! : undefined} specialists={unitManifest} legacy={game.version !== 2} from={rock} to={target} recipient={target.owner} drones={Number(amount)} carry={carry} disabled={!operational || !!game.winner || !!game.draw || game.eliminated.includes(snapshot.faction) || !Number.isSafeInteger(Number(amount)) || Number(amount) < (unitIds.length ? 0 : 1) || Number(amount) > Math.floor(rock.drones)} onGift={() => siteAction({ type: 'gift', from: rock.id, to: target.id, drones: Number(amount), specialists: unitIds, recipient: target.owner!, carryModule: carry && !!rock.module })} />}
        {game.version === 2 && rock.known && rock.owner === snapshot.faction && <SiteControls minesAllowed={game.rules?.mode !== 'domination'} rock={rock} cost={mineCost({ minesDrilled: { you: 0, vesper: 0, null: 0, ...game.minesDrilled } }, snapshot.faction)} enabled={!!operational && !game.winner && !game.draw && !game.eliminated.includes(snapshot.faction)} scheduledAt={forecast ? inspectedHour! : undefined} onMine={() => siteAction({ type: 'drill-mine', rock: rock.id })} onShields={() => siteAction({ type: 'shields', rock: rock.id, disabled: !rock.shieldsDisabled })} />}
        {referenceText('outpost', rock.id, rock.name) && <CopyObjectReference value={referenceText('outpost', rock.id, rock.name)!} label="Copy outpost reference" />}
        {rock.known && rock.owner === snapshot.faction && <InterceptionTargets game={game} source={rock} owner={snapshot.faction} drones={Number(amount)} specialists={unitIds} scheduledAt={forecast ? inspectedHour! : undefined} targetIds={forecast ? observedInterceptionIds(snapshot.game, snapshot.faction) : undefined} disabled={!operational || !!game.winner || !!game.draw || game.eliminated.includes(snapshot.faction)} onIntercept={target => siteAction({ type: 'intercept', from: rock.id, target, drones: Number(amount), ...(unitIds.length ? { specialists: unitIds } : {}) })} />}
        {game.version === 2 && rock.known && rock.owner === snapshot.faction && <SpecialistBay mode="cargo" game={game} rock={rock} owner={snapshot.faction} enabled={!!operational && !game.winner && !game.draw && !game.eliminated.includes(snapshot.faction)} scheduledAt={forecast ? inspectedHour! : undefined} selectionEnabled={!!operational} selected={unitIds} onSelect={setSelectedUnits} onHire={kind => siteAction({ type: 'hire', kind })} onPromote={id => siteAction({ type: 'promote', id })} onRelease={id => siteAction({ type: 'release', id })} />}
        {rock.known && rock.owner !== snapshot.faction && !!rock.specialists?.length && <View>{rock.specialists.map(u => <Text key={u.id} style={s.detail}>{SPECIALISTS[u.kind].name}{u.captive ? ' · captive' : ''}: {u.captive ? 'Abilities inactive.' : SPECIALISTS[u.kind].description}</Text>)}</View>}
        {game.version === 1 && rock.known && rock.owner === snapshot.faction && <ModuleBay rock={rock} enabled={!!immediate} carry={carry} onCarry={setCarry} onBuild={kind => submit({ kind: 'modules', body: { requestId: commandId(), revision: snapshot.revision, rock: rock.id, module: kind } })} />}
      </View>}</> },
      orders: { title: 'Your orders', content: <>{game.version === 2 && <HaulerOrders title={past ? 'Historical hauler orders · read-only' : undefined} fleets={forecast ? futureCommandFleets(game, snapshot.game, snapshot.faction) : game.fleets.filter(f => f.owner === snapshot.faction)} rocks={game.rocks} hour={game.hour} scheduledAt={forecast ? inspectedHour! : undefined} enabled={!!operational && !game.winner && !game.draw && !game.eliminated.includes(snapshot.faction)} onNavigate={id => { setSection(null); setNavigating(current => current === id ? undefined : id); setPlanning(false); setDestination(undefined); }} onCommand={change => siteAction({ type: 'hauler', change })} />}
      <ScheduledOrders key={`${session?.url}:${session?.id}:${session?.token}:${snapshot.faction}:${snapshot.game.epoch}:${mode}`} units={selectableLaunchUnits(orders!, snapshot.faction)} preparation={snapshot.game.version === 2} onInspect={inspectTime} onEdit={change => { if (operational) submit({ kind: 'edit-schedule', body: { requestId: commandId(), revision: snapshot.revision, ...change } }); }} fleets={orders?.fleets} plans={orders?.scheduled ?? []} hour={orders?.hour ?? snapshot.game.hour} rocks={game.rocks} disabled={!operational} onCancel={planId => submit({ kind: 'cancel-schedule', body: { requestId: commandId(), revision: snapshot.revision, planId } })} />
      <View style={s.panel}><Text style={s.title}>Haulers in transit</Text>{game.fleets.length ? game.fleets.map(f => <Text key={f.id} style={s.detail}>{FACTIONS[f.owner].name} → {flightDestination(game.rocks, f)} / {f.drones} drones / {(f.arrives - game.hour).toFixed(1)}h{f.module ? ` / ${MODULES[f.module].name}` : ''}</Text>) : <Text style={s.detail}>No active transfers.</Text>}</View></> },
      units: { title: `Modules · ${rock?.name ?? ''}`, content: <><Action text="Go to core site" onPress={() => { const home = game.rocks.find(r => r.known && r.coreOf === snapshot.faction && r.owner === snapshot.faction); if (home) { setSelected(home.id); setSelectedUnits([]); setDestination(undefined); setPlanning(false); } }} />{rock ? <>{game.version === 2 && rock.known && rock.owner === snapshot.faction && <SpecialistBay game={game} rock={rock} owner={snapshot.faction} enabled={!!operational && !game.winner && !game.draw && !game.eliminated.includes(snapshot.faction)} scheduledAt={forecast ? inspectedHour! : undefined} selectionEnabled={!!operational} selected={unitIds} onSelect={setSelectedUnits} onHire={kind => siteAction({ type: 'hire', kind })} onPromote={id => siteAction({ type: 'promote', id })} onRelease={id => siteAction({ type: 'release', id })} />}</> : null}</> },
      signals: { title: 'Diplomacy and signals', content: <><Text style={s.label}>Chat · current</Text>{diplomacy}
      <View style={s.panel}><Text style={s.title}>Signal log</Text>{game.events.slice(0, 12).map((event, i) => <Text key={i} style={s.detail}>{event.hour.toFixed(1)}h / {event.message}</Text>)}</View></> },
      intel: { title: 'Operation intelligence', content: <View style={s.panel}><Text style={[s.title, { color: FACTIONS[snapshot.faction].color }]}>{FACTIONS[snapshot.faction].name}</Text><Text style={s.label}>{past ? 'history · read-only' : snapshot.game.eliminated.includes(snapshot.faction) ? 'eliminated' : snapshot.status.replace('game.', '')} · {joined}/{roster.length} players joined · hour {(past ? history.frame!.history.at : game.hour).toFixed(2)}</Text>
        {rulesSummary}<Text style={s.detail}>Invitation code</Text><Text selectable style={s.code}>{snapshot.invite}</Text>
        {snapshot.members.map(f => <Text key={f} style={{ color: FACTIONS[f].color, fontSize: 13 }}>{FACTIONS[f].name}{f === snapshot.faction ? ' / you' : ''}{game.eliminated.includes(f) ? ' / eliminated' : ''}</Text>)}
        {snapshot.status === 'game.lobby' && snapshot.host && <Action text="Start operation" disabled={past || busy || joined < roster.length || !!session?.pending} onPress={() => { if (!past) void run(async () => accept(await api(session!, `games/${snapshot.id}/start`, {}))); }} />}
        {snapshot.status === 'game.lobby' && <Text style={s.detail}>{Math.max(0, roster.length - joined)} players remaining. Share the invitation to fill the configured seats. Time begins when the host starts.</Text>}
        {game.draw && <Text style={s.code}>All players eliminated. The operation ended in a draw.</Text>}
        {game.winner && <Text style={s.code}>{forecast ? 'Projected: ' : ''}{FACTIONS[game.winner].name}: {game.rules?.mode === 'domination' ? 'territory target reached.' : 'contract complete.'}</Text>}
        <Text style={s.detail}>{game.rules?.mode === 'domination' ? 'Your territory' : 'Cargo'}: {Math.floor(victoryProgress(game, snapshot.faction))} / {victoryTarget(game)}</Text><TerritoryStandings game={game} /><FundingPanel game={game} owner={snapshot.faction} enabled={!!operational && !game.winner && !game.draw && !game.eliminated.includes(snapshot.faction)} scheduledAt={forecast ? inspectedHour! : undefined} onChange={(to, enabled) => siteAction({ type: 'funding', to, enabled })} />
      </View> },
      settings: { title: 'Setup', content: setup },
    }} />;

}
const s = StyleSheet.create({
  page: { padding: 20, gap: 18, maxWidth: 820, width: '100%', alignSelf: 'center', paddingBottom: 50 }, title: { color: '#e5eadc', fontSize: 24 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 20 }, label: { color: '#96ad89', fontSize: 11, letterSpacing: 1 },
  panel: { padding: 18, gap: 12, backgroundColor: '#101b13', borderWidth: 1, borderColor: '#30402e' }, input: { color: '#e5eadc', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#0b140e', padding: 13, minHeight: 46, fontSize: 15 },
  button: { backgroundColor: '#b8e986', padding: 14, minHeight: 44, alignItems: 'center' }, buttonText: { color: '#182312', fontSize: 12, fontWeight: '600' }, code: { color: '#b8e986', fontSize: 16, letterSpacing: 1 }, error: { color: '#e9a775', fontSize: 13, lineHeight: 20 }, row: { flexDirection: 'row', gap: 8 }, message: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#30402e', gap: 6 }, messageText: { color: '#d6e2cd', fontSize: 14, lineHeight: 21 },
});
