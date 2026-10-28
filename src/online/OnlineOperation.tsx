/**
 * ---
 * purpose: Invite lobby, server-authoritative orders, reconnect, and private bilateral diplomacy on mobile and web.
 * ---
 */
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { flightDestination } from '../game/flight';
import { InterceptionTargets } from '../components/InterceptionTargets';
import { LaunchTiming, ScheduledOrders } from '../components/ScheduledOrders';
import { ModuleBay } from '../components/ModuleBay';
import { GiftTransfer } from '../components/GiftTransfer';
import { MODULES } from '../game/modules';
import { BeltMap } from '../components/BeltMap';
import { forecastObservation } from '../game/visibility';
import { FACTIONS, travelHours, type Faction } from '../game/simulation';
import { commandId, connect, newCredential, newSession, restoreSession, storeSession, type Pending, type Session } from './client';
import { api, RejectedCommand } from './network';
import { parseRecoveryCode, formatRecoveryCode } from './recovery';
import type { Snapshot } from './protocol';
function Action({ text, onPress, disabled = false }: { text: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.buttonText}>{text}</Text></Pressable>;
}
export function OnlineOperation() {
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
  const [amount, setAmount] = useState('30');
  const [forecast, setForecast] = useState(0);
  const [recipient, setRecipient] = useState<Faction>('vesper');
  const [draft, setDraft] = useState('');
  const [disconnect, setDisconnect] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const lock = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const privateEditor = useRef<TextInput>(null);
  const composer = useRef<View>(null);
  function revealComposer() {
    if (!privateEditor.current?.isFocused()) return;
    // Insets make room; explicitly reveal the entire composer, including its send button.
    scroll.current?.getNativeScrollRef()?.measureInWindow((_x, top) => {
      if (privateEditor.current?.isFocused() && composer.current) scroll.current?.scrollResponderScrollNativeHandleToKeyboard(composer.current, top + 16, true);
    });
  }
  useEffect(() => {
    const keyboard = Keyboard.addListener('keyboardDidShow', revealComposer);
    return () => keyboard.remove();
  }, []);
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
    setRecipient(result.snapshot.faction === 'vesper' ? 'you' : 'vesper');
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
      setRecipient(result.snapshot.faction === 'vesper' ? 'you' : 'vesper');
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
        setRecipient(next.faction === 'vesper' ? 'you' : 'vesper'); setRecoveryInput('');
      }
      if (pending.kind === 'messages') setDraft('');
      else { setDestination(undefined); setPlanning(false); setCarry(false); setDelay(0); }
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
    const body = { requestId: commandId(), revision: snapshot.revision, from: selected, to: destination, drones: Number(amount), carryModule: carry && !!snapshot.game.rocks.find(r => r.id === selected)?.module };
    submit(delay ? { kind: 'schedules', body: { ...body, executeAt: snapshot.game.hour + delay } } : { kind: 'orders', body });
  }
  const recoveryPending = session?.pending?.kind === 'recover' || session?.pending?.kind === 'recovery';
  const game = snapshot && (forecast ? forecastObservation(snapshot.game, snapshot.faction, snapshot.game.hour + forecast) : snapshot.game);
  const rock = game?.rocks.find(r => r.id === selected);
  const target = game?.rocks.find(r => r.id === destination);
  const operational = snapshot?.status === 'game.active' && !snapshot.game.eliminated.includes(snapshot.faction) && !session?.pending && !busy && !forecast;
  return <ScrollView ref={scroll} onContentSizeChange={() => { if (Keyboard.isVisible()) revealComposer(); }} automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Text style={s.title}>Machination / uplink</Text><Text style={s.detail}>Three intelligences. One belt. No corporate oversight.</Text>
    {!!error && <View style={s.panel}><Text accessibilityRole="alert" style={s.error}>{error}</Text></View>}
    {session ? <View key="connected-seat" style={s.panel}><Text style={s.label}>Connection retained on this device</Text><Text style={s.detail}>{session.url}</Text>
      {session.pending && <><Text style={s.error}>Request awaiting confirmation. Retry repeats the saved request.</Text><Action text="Retry command" disabled={busy} onPress={() => void run(() => retry())} /></>}
      {recoveryPending && <Text style={s.error}>Confirm this recovery request before removing the connection. The saved request may be needed to keep access to your seat.</Text>}
      <Action text="Reconnect / refresh" disabled={busy || session.pending?.kind === 'recover'} onPress={() => void run(async () => { const result = await connect(session); setSession(result.session); accept(result.snapshot); })} />
      {!!snapshot && <><Text style={s.label}>Seat recovery</Text><Text style={s.detail}>{snapshot.recoveryEnabled ? 'A recovery code is active. Generating another replaces it.' : 'Save a recovery code before leaving this device. Each code works once and replaces the old connection when used.'}</Text><Action text={snapshot.recoveryEnabled ? 'Replace recovery code' : 'Generate recovery code'} disabled={busy || !!session.pending} onPress={createRecovery} /></>}
      {!!recoveryCode && <><Text style={s.detail}>Save this code with the server address in a private place, such as a password manager. It controls your seat. This app only shows it until you leave this screen.</Text><Text selectable style={s.code}>{recoveryCode}</Text><Action text="Hide recovery code" onPress={() => setRecoveryCode('')} /></>}
      {disconnect ? <><Text style={s.error}>Disconnecting removes this device's seat credential. You can return only with a recovery code saved earlier. The server operation continues.</Text><Action text="Keep connection" onPress={() => setDisconnect(false)} /><Action text="Remove seat from this device" disabled={busy || recoveryPending} onPress={() => void run(async () => { await storeSession(null); setSession(null); setSnapshot(undefined); setDisconnect(false); setRecoveryCode(''); })} /></> : <Action text="Disconnect…" disabled={busy || recoveryPending} onPress={() => setDisconnect(true)} />}
    </View> : <View key="connection-entry" style={s.panel}><Text style={s.label}>Game server</Text><TextInput key="server-url" secureTextEntry={false} accessibilityLabel="Game server URL" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} style={s.input} keyboardType="url" />
      <Action text="Create private operation" disabled={busy} onPress={() => void enter(false)} /><Text style={s.label}>Invitation code</Text><TextInput key="invite-code" secureTextEntry={false} accessibilityLabel="Invitation code" autoCapitalize="none" autoCorrect={false} value={invite} onChangeText={setInvite} style={s.input} maxLength={24} /><Action text="Join operation" disabled={busy || invite.length !== 24} onPress={() => void enter(true)} />
      <Text style={s.label}>Restore your seat</Text><Text style={s.detail}>Use the server address above and a code you saved earlier. Restoring disconnects your old device and consumes the code. Generate a new code afterward.</Text><TextInput key="seat-recovery" accessibilityLabel="Recovery code" autoCapitalize="none" autoCorrect={false} secureTextEntry value={recoveryInput} onChangeText={setRecoveryInput} style={s.input} maxLength={180} /><Action text="Restore seat and revoke old connection" disabled={busy || !recoveryInput.trim()} onPress={restoreSeat} /></View>}
    {snapshot && game && <>
      <View style={s.panel}><Text style={[s.title, { color: FACTIONS[snapshot.faction].color }]}>{FACTIONS[snapshot.faction].name}</Text><Text style={s.label}>{snapshot.status.replace('game.', '')} · {snapshot.members.length}/3 seats · hour {game.hour.toFixed(2)}</Text>
        <Text style={s.detail}>Invitation code</Text><Text selectable style={s.code}>{snapshot.invite}</Text>
        {snapshot.members.map(f => <Text key={f} style={{ color: FACTIONS[f].color, fontSize: 13 }}>{FACTIONS[f].name}{f === snapshot.faction ? ' / you' : ''}{game.eliminated.includes(f) ? ' / core offline' : ''}</Text>)}
        {snapshot.status === 'game.lobby' && snapshot.host && <Action text="Start operation" disabled={busy || snapshot.members.length < 3} onPress={() => void run(async () => accept(await api(session!, `games/${snapshot.id}/start`, {})))} />}
        {snapshot.status === 'game.lobby' && <Text style={s.detail}>Share the invitation with two players. Time begins when the host starts.</Text>}
        {game.winner && <Text style={s.code}>{forecast ? 'Projected: ' : ''}{FACTIONS[game.winner].name}: contract complete.</Text>}
        <Text style={s.detail}>Cargo: {Math.floor(game.cargo[snapshot.faction] ?? 0)} / 300</Text>
      </View>
      <BeltMap game={game} selected={selected} destination={destination} onSelect={r => { if (planning && r.id !== selected) setDestination(r.id); else if (!planning) { setSelected(r.id); setDestination(undefined); setCarry(false); } }} />
      <View style={s.panel}><Text style={s.label}>Forecast / known orders only</Text><View style={s.row}>{[0, 6, 12, 24].map(h => <View key={h} style={{ flex: 1 }}><Action text={h ? `+${h}h` : 'Now'} onPress={() => { setForecast(h); setPlanning(false); setDestination(undefined); }} /></View>)}</View><Text style={s.detail}>{forecast ? `Previewing +${forecast}h. Based on current observations. Hidden forces and new orders can change this future.` : 'Sensors: 32 units per rock, 16 per hauler. Unknown rocks show ?. Refreshes every 15 seconds.'}</Text></View>
      {game.interceptionUncertain && <View style={s.panel}><Text style={s.error}>Interception outcome unknown. The target isn't in the current observations.</Text></View>}
      {!!game.uncertain.length && <View style={s.panel}><Text style={s.error}>Arrival outcomes unknown at {game.uncertain.map(id => game.rocks.find(r => r.id === id)?.name).join(', ')}. Scout and refresh before relying on this forecast.</Text></View>}
      {rock && <View style={s.panel}><Text style={s.title}>{rock.name}</Text><Text style={s.detail}>{rock.known ? `${Math.floor(rock.drones)} drones · ${rock.kind}` : 'Outside sensor range. Ownership and drones unknown.'}</Text><Text style={s.detail}>{target ? `To ${target.name} / ${travelHours(rock, target, carry ? rock.module : undefined)}h transit / arrival in ${delay + travelHours(rock, target, carry ? rock.module : undefined)}h` : planning ? 'Select any other rock as the destination.' : 'Inspect assets or plan a transfer from a controlled rock.'}</Text><Action text={planning ? 'Cancel transfer selection' : 'Choose transfer destination'} disabled={!operational || rock.owner !== snapshot.faction} onPress={() => { setPlanning(!planning); setDestination(undefined); }} />
        <TextInput key="online-manifest" secureTextEntry={false} accessibilityLabel="Online drone manifest" value={amount} onChangeText={setAmount} keyboardType="number-pad" style={s.input} />
        <LaunchTiming delay={delay} disabled={!operational} onChange={setDelay} />
        <Action text={delay ? `Schedule launch +${delay}h` : 'Launch hauler'} disabled={!operational || !target || rock.owner !== snapshot.faction || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0 || !delay && Number(amount) > Math.floor(rock.drones ?? 0)} onPress={sendTransfer} />
        {rock.known && rock.owner === snapshot.faction && target?.known && target.owner && target.owner !== snapshot.faction && !game.eliminated.includes(target.owner) && !delay && <GiftTransfer key={`${rock.id}:${target.id}:${target.owner}:${amount}:${carry}:${rock.module}`} from={rock} to={target} recipient={target.owner} drones={Number(amount)} carry={carry} disabled={!operational || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0 || Number(amount) > Math.floor(rock.drones)} onGift={() => submit({ kind: 'gifts', body: { requestId: commandId(), revision: snapshot.revision, from: rock.id, to: target.id, drones: Number(amount), recipient: target.owner!, carryModule: carry && !!rock.module } })} />}
        {rock.known && rock.owner === snapshot.faction && <InterceptionTargets game={game} source={rock} owner={snapshot.faction} drones={Number(amount)} disabled={!operational} onIntercept={target => submit({ kind: 'intercepts', body: { requestId: commandId(), revision: snapshot.revision, from: rock.id, target, drones: Number(amount) } })} />}
        {rock.known && rock.owner === snapshot.faction && <ModuleBay rock={rock} enabled={!!operational} carry={carry} onCarry={setCarry} onBuild={kind => submit({ kind: 'modules', body: { requestId: commandId(), revision: snapshot.revision, rock: rock.id, module: kind } })} />}
      </View>}
      <ScheduledOrders plans={game.scheduled} hour={game.hour} rocks={game.rocks} disabled={!operational} onCancel={planId => submit({ kind: 'cancel-schedule', body: { requestId: commandId(), revision: snapshot.revision, planId } })} />
      <View style={s.panel}><Text style={s.title}>Haulers in transit</Text>{game.fleets.length ? game.fleets.map(f => <Text key={f.id} style={s.detail}>{FACTIONS[f.owner].name} → {flightDestination(game.rocks, f)} / {f.drones} drones / {(f.arrives - game.hour).toFixed(1)}h{f.module ? ` / ${MODULES[f.module].name}` : ''}</Text>) : <Text style={s.detail}>No active transfers.</Text>}</View>
      <View style={s.panel}><Text style={s.title}>Private channel</Text><View style={s.row}>{snapshot.members.filter(f => f !== snapshot.faction).map(f => <View key={f} style={{ flex: 1 }}><Action text={`${recipient === f ? '● ' : ''}${FACTIONS[f].name}`} onPress={() => setRecipient(f)} /></View>)}</View>
        {snapshot.messages.filter(m => m.from === recipient || m.to === recipient).slice(-30).map(m => <View key={m.id} style={s.message}><Text style={s.label}>{FACTIONS[m.from].name} → {FACTIONS[m.to].name}</Text><Text selectable style={s.messageText}>{m.text}</Text></View>)}
        <View ref={composer} collapsable={false} style={{ gap: 12 }}>
          <TextInput ref={privateEditor} onFocus={() => { if (Keyboard.isVisible()) revealComposer(); }} key="private-transmission" secureTextEntry={false} accessibilityLabel="Private transmission" multiline maxLength={300} value={draft} onChangeText={setDraft} style={[s.input, { minHeight: 80 }]} placeholder="Alliance proposed…" placeholderTextColor="#647960" />
          <Text style={s.detail}>Visible only to you and {FACTIONS[recipient].name}. Stored by the game server.</Text><Action text="Transmit" disabled={busy || !!session?.pending || !draft.trim() || !snapshot.members.includes(recipient) || recipient === snapshot.faction} onPress={() => submit({ kind: 'messages', body: { requestId: commandId(), to: recipient, text: draft } })} />
        </View>
      </View>
      <View style={s.panel}><Text style={s.title}>Signal log</Text>{game.events.slice(0, 12).map((event, i) => <Text key={i} style={s.detail}>{event.hour.toFixed(1)}h / {event.message}</Text>)}</View>
    </>}
  </ScrollView>;
}
const s = StyleSheet.create({
  page: { padding: 20, gap: 18, maxWidth: 820, width: '100%', alignSelf: 'center', paddingBottom: 50 }, title: { color: '#e5eadc', fontSize: 24 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 20 }, label: { color: '#96ad89', fontSize: 11, letterSpacing: 1 },
  panel: { padding: 18, gap: 12, backgroundColor: '#101b13', borderWidth: 1, borderColor: '#30402e' }, input: { color: '#e5eadc', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#0b140e', padding: 13, minHeight: 46, fontSize: 15 },
  button: { backgroundColor: '#b8e986', padding: 14, minHeight: 44, alignItems: 'center' }, buttonText: { color: '#182312', fontSize: 12, fontWeight: '600' }, code: { color: '#b8e986', fontSize: 16, letterSpacing: 1 }, error: { color: '#e9a775', fontSize: 13, lineHeight: 20 }, row: { flexDirection: 'row', gap: 8 }, message: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#30402e', gap: 6 }, messageText: { color: '#d6e2cd', fontSize: 14, lineHeight: 21 },
});
