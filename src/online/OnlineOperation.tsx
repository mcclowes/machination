/**
 * ---
 * purpose: Invite lobby, server-authoritative orders, reconnect, and private bilateral diplomacy on mobile and web.
 * ---
 */
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { flightDestination } from '../game/flight';
import { InterceptionTargets } from '../components/InterceptionTargets';
import { LaunchTiming, ScheduledOrders } from '../components/ScheduledOrders';
import { SpecialistBay } from '../components/SpecialistBay';
import { specialistSpeed } from '../game/specialist-effects';
import { SPECIALISTS } from '../game/specialist-catalog';
import { ModuleBay } from '../components/ModuleBay';
import { GiftTransfer } from '../components/GiftTransfer';
import { MODULES } from '../game/modules';
import { BeltMap } from '../components/BeltMap';
import { HaulerOrders } from '../components/HaulerOrders';
import { SiteControls, siteDescription } from '../components/SiteControls';
import { LAUNCH_PREPARATION } from '../game/transport';
import { cargoTarget, mineCost } from '../game/economy';
import { useDiplomacyPanel } from './DiplomacyPanel';
import { FundingPanel } from '../components/FundingPanel';
import { OperationShell, type OperationSection } from '../components/OperationShell';
import { TimeMachine } from '../components/TimeMachine';
import { gameClock, inspectionOffset, orderHour } from '../game/time-machine';
import { forecastObservation } from '../game/visibility';
import { FACTIONS, travelHours } from '../game/simulation';
import { commandId, connect, newCredential, newSession, restoreSession, storeSession, type Pending, type Session } from './client';
import { api, RejectedCommand } from './network';
import { parseRecoveryCode, formatRecoveryCode } from './recovery';
import type { Snapshot } from './protocol';
function Action({ text, onPress, disabled = false }: { text: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.buttonText}>{text}</Text></Pressable>;
}
export function OnlineOperation() {
  const [section, setSection] = useState<OperationSection | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [url, setUrl] = useState(process.env.EXPO_PUBLIC_GAME_SERVER ?? 'http://localhost:8787');
  const [invite, setInvite] = useState('');
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
  const forecast = inspectionOffset(snapshot?.game.hour ?? 0, inspectedHour);
  const [acknowledged, setAcknowledged] = useState<string>();
  const [disconnect, setDisconnect] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const lock = useRef(false);
  const scroll = useRef<ScrollView>(null);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await work(); setError(''); } catch (e) { if (e instanceof RejectedCommand && e.status === 401) { setSnapshot(undefined); setRecoveryCode(''); } setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  function accept(next: Snapshot) { setSnapshot(next); }
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
    const refresh = () => void run(async () => accept(await api(session, `games/${session.id}`)));
    const timer = setInterval(refresh, 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [session]);
  async function enter(join: boolean) {
    await run(async () => {
      const created = await newSession(url, join ? invite : undefined);
      await storeSession(created); setSession(created);
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
      await storeSession(saved); setSession(saved); await complete(saved, pending);
    });
  }
  async function retry() {
    if (session?.id && session.pending) await complete(session, session.pending);
  }
  function submit(pending: Pending) {
    if (!session) return;
    void run(async () => {
      const saved = { ...session, pending }; await storeSession(saved); setSession(saved);
      await complete(saved, pending);
    });
  }
  function sendTransfer() {
    if (!snapshot || !destination) return;
    const body = { requestId: commandId(), revision: snapshot.revision, from: selected, to: destination, drones: Number(amount), specialists: unitIds, carryModule: carry && !!snapshot.game.rocks.find(r => r.id === selected)?.module };
    try {
      const executeAt = orderHour(snapshot.game.hour, inspectedHour, delay);
      submit(executeAt > snapshot.game.hour ? { kind: 'schedules', body: { ...body, executeAt } } : { kind: 'orders', body });
    } catch (error) { setError((error as Error).message); }
  }
  const recoveryPending = session?.pending?.kind === 'recover' || session?.pending?.kind === 'recovery';
  const game = snapshot && (forecast ? forecastObservation(snapshot.game, snapshot.faction, snapshot.game.hour + forecast) : snapshot.game);
  const rock = game?.rocks.find(r => r.id === selected);
  const target = game?.rocks.find(r => r.id === destination);
  const unitManifest = rock?.known && snapshot ? (rock.specialists ?? []).filter(u => selectedUnits.includes(u.id) && u.owner === snapshot.faction && !u.captive) : [];
  const unitIds = unitManifest.map(u => u.id);
  const duration = target && rock && game && snapshot ? game.version === 2 ? Math.max(1e-6, Math.hypot(rock.x - target.x, rock.y - target.y) / specialistSpeed(game, snapshot.faction, unitManifest, target.owner === snapshot.faction)) : travelHours(rock, target, carry ? rock.module : undefined, game.version) : 0;
  const operational = snapshot?.status === 'game.active' && !snapshot.game.eliminated.includes(snapshot.faction) && !session?.pending && !busy;
  const immediate = operational && !forecast;
  const preparation = snapshot?.game.version === 2 ? LAUNCH_PREPARATION : 0;
  const launchAt = snapshot ? Math.max(snapshot.game.hour, inspectedHour ?? snapshot.game.hour) + delay : 0;
  const diplomacy = useDiplomacyPanel({ snapshot, disabled: busy || !!session?.pending, acknowledged, scroll, onSubmit: submit });
  const connection = <>{session ? <View key="connected-seat" style={s.panel}><Text style={s.label}>Connection retained on this device</Text><Text style={s.detail}>{session.url}</Text>
      {session.pending && <><Text style={s.error}>Request awaiting confirmation. Retry repeats the saved request.</Text><Action text="Retry command" disabled={busy} onPress={() => void run(() => retry())} /></>}
      {recoveryPending && <Text style={s.error}>Confirm this recovery request before removing the connection. The saved request may be needed to keep access to your seat.</Text>}
      <Action text="Reconnect / refresh" disabled={busy || session.pending?.kind === 'recover'} onPress={() => void run(async () => { const result = await connect(session); setSession(result.session); accept(result.snapshot); })} />
      {!!snapshot && <><Text style={s.label}>Seat recovery</Text><Text style={s.detail}>{snapshot.recoveryEnabled ? 'A recovery code is active. Generating another replaces it.' : 'Save a recovery code before leaving this device. Each code works once and replaces the old connection when used.'}</Text><Action text={snapshot.recoveryEnabled ? 'Replace recovery code' : 'Generate recovery code'} disabled={busy || !!session.pending} onPress={createRecovery} /></>}
      {!!recoveryCode && <><Text style={s.detail}>Save this code with the server address in a private place, such as a password manager. It controls your seat. This app only shows it until you leave this screen.</Text><Text selectable style={s.code}>{recoveryCode}</Text><Action text="Hide recovery code" onPress={() => setRecoveryCode('')} /></>}
      {disconnect ? <><Text style={s.error}>Disconnecting removes this device's seat credential. You can return only with a recovery code saved earlier. The server operation continues.</Text><Action text="Keep connection" onPress={() => setDisconnect(false)} /><Action text="Remove seat from this device" disabled={busy || recoveryPending} onPress={() => void run(async () => { await storeSession(null); setSession(null); setSnapshot(undefined); setDisconnect(false); setRecoveryCode(''); })} /></> : <Action text="Disconnect…" disabled={busy || recoveryPending} onPress={() => setDisconnect(true)} />}
    </View> : <View key="connection-entry" style={s.panel}><Text style={s.label}>Game server</Text><TextInput key="server-url" secureTextEntry={false} accessibilityLabel="Game server URL" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} style={s.input} keyboardType="url" />
      <Action text="Create private operation" disabled={busy} onPress={() => void enter(false)} /><Text style={s.label}>Invitation code</Text><TextInput key="invite-code" secureTextEntry={false} accessibilityLabel="Invitation code" autoCapitalize="none" autoCorrect={false} value={invite} onChangeText={setInvite} style={s.input} maxLength={24} /><Action text="Join operation" disabled={busy || invite.length !== 24} onPress={() => void enter(true)} />
      <Text style={s.label}>Restore your seat</Text><Text style={s.detail}>Use the server address above and a code you saved earlier. Restoring disconnects your old device and consumes the code. Generate a new code afterward.</Text><TextInput key="seat-recovery" accessibilityLabel="Recovery code" autoCapitalize="none" autoCorrect={false} secureTextEntry value={recoveryInput} onChangeText={setRecoveryInput} style={s.input} maxLength={180} /><Action text="Restore seat and revoke old connection" disabled={busy || !recoveryInput.trim()} onPress={restoreSeat} /></View>}</>;
  if (!snapshot || !game) return <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}><Text style={s.title}>Machination / uplink</Text>{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{connection}</ScrollView>;
  return <OperationShell section={section} onSection={setSection} panelScrollRef={scroll}
    status={<><View style={s.row}><Text style={[s.label, { flex: 1 }]}>{FACTIONS[snapshot.faction].name} · {snapshot.status.replace('game.', '')}</Text><Text style={s.detail}>{gameClock(game.hour)}</Text></View>{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{snapshot.status === 'game.lobby' && <Action text="Open lobby and invitation" onPress={() => setSection('intel')} />}{session?.pending && <Action text="Retry pending command" disabled={busy} onPress={() => void run(() => retry())} />}{game.draw && <Text style={s.code}>Operation ended in a draw.</Text>}{game.winner && <Text style={s.code}>{forecast ? 'Projected: ' : ''}{FACTIONS[game.winner].name}: contract complete.</Text>}</>}
    chart={<BeltMap fill player={snapshot.faction} onInspectFleet={() => setSection(null)} onManageFleet={() => setSection('orders')} game={game} selected={selected} destination={destination} onSelect={r => { if (navigating !== undefined) { submit({ kind: 'haulers', body: { requestId: commandId(), revision: snapshot.revision, action: 'course', fleet: navigating, to: r.id } }); setNavigating(undefined); return; } if (planning && r.id !== selected) { setDestination(r.id); setSection('asset'); } else if (!planning) { setSection('asset'); setSelected(r.id); setDestination(undefined); setCarry(false); setSelectedUnits([]); if (r.known) setAmount(String(Math.floor(r.drones / 2))); } }} />}
    hint={(planning || navigating !== undefined) ? <><Text style={s.detail}>{navigating !== undefined ? 'Choose a new course destination.' : `From ${rock?.name}: choose a destination.`}</Text><Action text="Cancel selection" onPress={() => { setNavigating(undefined); setPlanning(false); setSection('asset'); }} /></> : undefined}
    timeline={<TimeMachine compact hour={snapshot.game.hour} inspectedHour={inspectedHour} onChange={hour => { setInspectedHour(hour); setDelay(0); }} events={[...snapshot.game.fleets.flatMap(f => [f.arrives, ...(f.preparing ? [f.departed] : [])]), ...snapshot.game.scheduled.map(p => p.executeAt)]} online />}
    panels={{
      asset: { title: rock?.name ?? 'Selected asset', content: <>{game.interceptionUncertain && <View style={s.panel}><Text style={s.error}>Interception outcome unknown. The target isn't in the current observations.</Text></View>}
{!!game.uncertain.length && <View style={s.panel}><Text style={s.error}>Arrival outcomes unknown at {game.uncertain.map(id => game.rocks.find(r => r.id === id)?.name).join(', ')}. Scout and refresh before relying on this forecast.</Text></View>} {rock && <View style={s.panel}><Text style={s.title}>{rock.name}</Text><Text style={s.detail}>{rock.known ? `${Math.floor(rock.drones)} drones · ${siteDescription(rock)}` : 'Outside sensor range. Ownership and drones unknown.'}</Text><Text style={s.detail}>{target ? `To ${target.name} / ${duration.toFixed(2)}h transit / arrival ${gameClock(launchAt + preparation + duration)}` : planning ? 'Select any other rock as the destination.' : 'Inspect assets or plan a transfer from a controlled rock.'}</Text><Action text={planning ? 'Cancel transfer selection' : 'Choose transfer destination'} disabled={!operational || rock.owner !== snapshot.faction} onPress={() => { setPlanning(!planning); setDestination(undefined); setSection(planning ? 'asset' : null); }} />
        <TextInput key="online-manifest" secureTextEntry={false} accessibilityLabel="Online drone manifest" value={amount} onChangeText={setAmount} keyboardType="number-pad" style={s.input} />
        <LaunchTiming future={!!forecast} delay={delay} disabled={!operational} onChange={setDelay} />
        <Action text={snapshot && launchAt > snapshot.game.hour ? `Schedule · ${gameClock(launchAt)}` : game.version === 2 ? 'Prepare launch · 10m' : 'Launch hauler'} disabled={!operational || !!game.winner || !!game.draw || !!rock.destroyed || !!target?.destroyed || launchAt > snapshot.game.hour + 168 || !target || rock.owner !== snapshot.faction || !Number.isSafeInteger(Number(amount)) || Number(amount) < (unitIds.length ? 0 : 1) || launchAt <= snapshot.game.hour && Number(amount) > Math.floor(rock.drones ?? 0)} onPress={sendTransfer} />
        {rock.known && rock.owner === snapshot.faction && target?.known && target.owner && target.owner !== snapshot.faction && !game.eliminated.includes(target.owner) && !delay && <GiftTransfer key={`${rock.id}:${target.id}:${target.owner}:${amount}:${carry}:${rock.module}:${unitIds.join(',')}`} specialists={unitManifest} legacy={game.version !== 2} from={rock} to={target} recipient={target.owner} drones={Number(amount)} carry={carry} disabled={!immediate || !Number.isSafeInteger(Number(amount)) || Number(amount) < (unitIds.length ? 0 : 1) || Number(amount) > Math.floor(rock.drones)} onGift={() => submit({ kind: 'gifts', body: { requestId: commandId(), revision: snapshot.revision, from: rock.id, to: target.id, drones: Number(amount), specialists: unitIds, recipient: target.owner!, carryModule: carry && !!rock.module } })} />}
        {game.version === 2 && rock.known && rock.owner === snapshot.faction && <SiteControls rock={rock} cost={mineCost({ minesDrilled: { you: 0, vesper: 0, null: 0, ...snapshot.game.minesDrilled } }, snapshot.faction)} enabled={!!immediate} onMine={() => submit({ kind: 'sites', body: { requestId: commandId(), revision: snapshot.revision, rock: rock.id, action: 'mine' } })} onShields={() => submit({ kind: 'sites', body: { requestId: commandId(), revision: snapshot.revision, rock: rock.id, action: 'shields', disabled: !rock.shieldsDisabled } })} />}
        {rock.known && rock.owner === snapshot.faction && <InterceptionTargets game={game} source={rock} owner={snapshot.faction} drones={Number(amount)} specialists={unitIds} disabled={!immediate} onIntercept={target => submit({ kind: 'intercepts', body: { requestId: commandId(), revision: snapshot.revision, from: rock.id, target, drones: Number(amount), ...(unitIds.length ? { specialists: unitIds } : {}) } })} />}
        {game.version === 2 && rock.known && rock.owner === snapshot.faction && <SpecialistBay mode="cargo" game={game} rock={rock} owner={snapshot.faction} enabled={!!immediate} selectionEnabled={!!operational} selected={unitIds} onSelect={setSelectedUnits} onHire={kind => submit({ kind: 'specialists', body: { requestId: commandId(), revision: snapshot.revision, action: 'hire', kind } })} onPromote={unit => submit({ kind: 'specialists', body: { requestId: commandId(), revision: snapshot.revision, action: 'promote', unit } })} onRelease={unit => submit({ kind: 'specialists', body: { requestId: commandId(), revision: snapshot.revision, action: 'release', unit } })} />}
        {rock.known && rock.owner !== snapshot.faction && !!rock.specialists?.length && <View>{rock.specialists.map(u => <Text key={u.id} style={s.detail}>{SPECIALISTS[u.kind].name}{u.captive ? ' · captive' : ''}: {u.captive ? 'Abilities inactive.' : SPECIALISTS[u.kind].description}</Text>)}</View>}
        {game.version === 1 && rock.known && rock.owner === snapshot.faction && <ModuleBay rock={rock} enabled={!!immediate} carry={carry} onCarry={setCarry} onBuild={kind => submit({ kind: 'modules', body: { requestId: commandId(), revision: snapshot.revision, rock: rock.id, module: kind } })} />}
      </View>}</> },
      orders: { title: 'Your orders', content: <>{game.version === 2 && <HaulerOrders fleets={snapshot.game.fleets.filter(f => f.owner === snapshot.faction)} rocks={snapshot.game.rocks} hour={snapshot.game.hour} enabled={!!operational} onNavigate={id => { setSection(null); setNavigating(current => current === id ? undefined : id); setPlanning(false); setDestination(undefined); }} onCommand={command => submit({ kind: 'haulers', body: { requestId: commandId(), revision: snapshot.revision, ...command } })} />}
      <ScheduledOrders plans={snapshot.game.scheduled} hour={snapshot.game.hour} rocks={game.rocks} disabled={!operational} onCancel={planId => submit({ kind: 'cancel-schedule', body: { requestId: commandId(), revision: snapshot.revision, planId } })} />
      <View style={s.panel}><Text style={s.title}>Haulers in transit</Text>{game.fleets.length ? game.fleets.map(f => <Text key={f.id} style={s.detail}>{FACTIONS[f.owner].name} → {flightDestination(game.rocks, f)} / {f.drones} drones / {(f.arrives - game.hour).toFixed(1)}h{f.module ? ` / ${MODULES[f.module].name}` : ''}</Text>) : <Text style={s.detail}>No active transfers.</Text>}</View></> },
      units: { title: `Modules · ${rock?.name ?? ''}`, content: <><Action text="Go to core site" onPress={() => { const home = game.rocks.find(r => r.known && r.coreOf === snapshot.faction && r.owner === snapshot.faction); if (home) { setSelected(home.id); setSelectedUnits([]); setDestination(undefined); setPlanning(false); } }} />{rock ? <>{game.version === 2 && rock.known && rock.owner === snapshot.faction && <SpecialistBay game={game} rock={rock} owner={snapshot.faction} enabled={!!immediate} selectionEnabled={!!operational} selected={unitIds} onSelect={setSelectedUnits} onHire={kind => submit({ kind: 'specialists', body: { requestId: commandId(), revision: snapshot.revision, action: 'hire', kind } })} onPromote={unit => submit({ kind: 'specialists', body: { requestId: commandId(), revision: snapshot.revision, action: 'promote', unit } })} onRelease={unit => submit({ kind: 'specialists', body: { requestId: commandId(), revision: snapshot.revision, action: 'release', unit } })} />}</> : null}</> },
      signals: { title: 'Diplomacy and signals', content: <>{diplomacy}
      <View style={s.panel}><Text style={s.title}>Signal log</Text>{game.events.slice(0, 12).map((event, i) => <Text key={i} style={s.detail}>{event.hour.toFixed(1)}h / {event.message}</Text>)}</View></> },
      intel: { title: 'Operation intelligence', content: <View style={s.panel}><Text style={[s.title, { color: FACTIONS[snapshot.faction].color }]}>{FACTIONS[snapshot.faction].name}</Text><Text style={s.label}>{snapshot.status.replace('game.', '')} · {snapshot.members.length}/3 seats · hour {game.hour.toFixed(2)}</Text>
        <Text style={s.detail}>Invitation code</Text><Text selectable style={s.code}>{snapshot.invite}</Text>
        {snapshot.members.map(f => <Text key={f} style={{ color: FACTIONS[f].color, fontSize: 13 }}>{FACTIONS[f].name}{f === snapshot.faction ? ' / you' : ''}{game.eliminated.includes(f) ? ' / core offline' : ''}</Text>)}
        {snapshot.status === 'game.lobby' && snapshot.host && <Action text="Start operation" disabled={busy || snapshot.members.length < 3} onPress={() => void run(async () => accept(await api(session!, `games/${snapshot.id}/start`, {})))} />}
        {snapshot.status === 'game.lobby' && <Text style={s.detail}>Share the invitation with two players. Time begins when the host starts.</Text>}
        {game.draw && <Text style={s.code}>All cores offline. The operation ended in a draw.</Text>}
        {game.winner && <Text style={s.code}>{forecast ? 'Projected: ' : ''}{FACTIONS[game.winner].name}: contract complete.</Text>}
        <Text style={s.detail}>Cargo: {Math.floor(game.cargo[snapshot.faction] ?? 0)} / {cargoTarget(game)}</Text><FundingPanel game={game} owner={snapshot.faction} enabled={!!immediate} onChange={(recipient, enabled) => submit({ kind: 'funding', body: { requestId: commandId(), revision: snapshot.revision, recipient, enabled } })} />
      </View> },
      settings: { title: 'Connection and recovery', content: connection },
    }} />;

}
const s = StyleSheet.create({
  page: { padding: 20, gap: 18, maxWidth: 820, width: '100%', alignSelf: 'center', paddingBottom: 50 }, title: { color: '#e5eadc', fontSize: 24 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 20 }, label: { color: '#96ad89', fontSize: 11, letterSpacing: 1 },
  panel: { padding: 18, gap: 12, backgroundColor: '#101b13', borderWidth: 1, borderColor: '#30402e' }, input: { color: '#e5eadc', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#0b140e', padding: 13, minHeight: 46, fontSize: 15 },
  button: { backgroundColor: '#b8e986', padding: 14, minHeight: 44, alignItems: 'center' }, buttonText: { color: '#182312', fontSize: 12, fontWeight: '600' }, code: { color: '#b8e986', fontSize: 16, letterSpacing: 1 }, error: { color: '#e9a775', fontSize: 13, lineHeight: 20 }, row: { flexDirection: 'row', gap: 8 }, message: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#30402e', gap: 6 }, messageText: { color: '#d6e2cd', fontSize: 14, lineHeight: 21 },
});
