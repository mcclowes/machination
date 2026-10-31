/**
 * ---
 * purpose: Compose multiplayer views using independent connection, notification, and planning workflows.
 * ---
 *
 * @format
 */

import { usePlanningMode } from '../components/usePlanningMode';
import { displayGameText } from '../content/terminology';
import { inactivityRemaining } from '../game/retirement';
import { DisruptorControls } from '../components/DisruptorControls';
import { SPECIALISTS } from '../game/specialist-catalog';
import { PulseMoveWarning, PulseControls, PulseLocation } from '../components/PulseControls';

import { CouncilPanel } from '../components/CouncilPanel';
import { openingEnabled } from '../game/opening-clock';
import { GameSetup } from '../components/GameSetup';
import { teamNumber } from '../game/teams';
import {
  DEFAULT_GAME_OPTIONS,
  mechanicsVersion,
  victoryProgress,
  victoryTarget,
  type GameOptions,
} from '../game/rules';
import { playersIn } from '../game/players';
import { MultiplayerAccount } from './MultiplayerAccount';
import { OperationDirectory } from './OperationDirectory';
import { FactionPanel } from './FactionPanel';
import { ALLEGIANCES, type Allegiance } from '../game/factions';
import type { AccountAccess } from './account-auth';
import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ResignationControl } from '../components/ResignationControl';
import { stationCourse } from '../game/drift';
import { flightDestination } from '../game/flight';
import { InterceptionTargets } from '../components/InterceptionTargets';
import { launchCargoLabel, selectableLaunchUnits } from '../components/launch-manifest';
import { remoteSiteDescription } from '../components/site-observation';
import { LaunchTiming, ScheduledOrders, scheduledOrderLabel } from '../components/ScheduledOrders';
import type { FutureAction } from '../game/future-actions';
import { SpecialistBay } from '../components/SpecialistBay';
import { SpecialistPanel } from '../components/SpecialistPanel';
import { focusCamera } from '../game/chart-camera';
import { fleetPosition } from '../game/flight';
import { specialistSpeed } from '../game/specialist-effects';
import { SpecialistManifest } from '../components/SpecialistManifest';
import { mapSpecialistSummary } from '../components/map-specialists';
import { ModuleBay } from '../components/ModuleBay';
import { GiftTransfer } from '../components/GiftTransfer';
import { MODULES } from '../game/modules';
import { fitPlayerCamera } from '../game/chart-camera';
import { DroneManifest } from '../components/DroneManifest';
import { BeltMap } from '../components/BeltMap';
import {
  futureCommandFleets,
  observedInterceptionIds,
  launchBlockReason,
} from '../components/fleet-planning';
import { HaulerOrders } from '../components/HaulerOrders';
import { SiteControls, siteDescription } from '../components/SiteControls';
import { LAUNCH_PREPARATION } from '../game/transport';
import { minesAllowed, mineCost } from '../game/economy';
import { useDiplomacyPanel } from './DiplomacyPanel';
import { IntelligenceReports } from '../components/IntelligenceReports';
import { OperationShell, type OperationSection } from '../components/OperationShell';
import { TimeMachine } from '../components/TimeMachine';
import { gameClock, inspectionMode, inspectionOffset, orderHour } from '../game/time-machine';
import { forecastObservation } from '../game/visibility';
import { SignalLog } from '../components/SignalLog';
import { FACTIONS, travelHours } from '../game/simulation';
import { PlayerIdentity } from '../components/PlayerIdentity';
import { playerAppearance } from '../game/players';
import { commandId, type Pending } from './client';
import { seatIdentity, useOnlineConnection } from './useOnlineConnection';
import { useHistoricalView } from './useHistoricalView';
import { api } from './network';
import type { ObjectReference } from '../contracts/protocol';
import {
  copyableReference,
  focusReferenceCamera,
  referenceInspectionHour,
  resolveReference,
  type ReferenceFrame,
} from './reference-inspection';
import { encodeObjectReference } from './object-references';
import { CopyObjectReference } from '../components/CopyObjectReference';
import { ReplayExport } from '../components/ReplayExport';
import { exportSharedReplay } from './shared-replay';
import { playSound, useSoundCues } from '../audio/sound';
import { MessageNotificationSettings } from './MessageNotificationSettings';
import { useMessageNotifications } from './useMessageNotifications';
import { notificationDeps, useNotificationDevice } from './notification-wiring';
import type { NotificationRequest } from './message-notifications';
import { useNotificationTap } from './useNotificationTap';
import { INCOMING_NOTIFICATION_KIND } from '../contracts/notifications';
function Action({
  text,
  onPress,
  disabled = false,
}: {
  text: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={() => {
        playSound('tap');
        onPress();
      }}
      style={[s.button, disabled && { opacity: 0.35 }]}
    >
      <Text style={s.buttonText}>{text}</Text>
    </Pressable>
  );
}
type OnlineOperationProps = {
  onOpenReplays?: () => void;
  notification?: NotificationRequest;
  onNotificationHandled?: (notificationId: string, opened: boolean) => void;
};
/** `operationId` opens that operation directly; otherwise account players start at their operation list. */
export function OnlineOperation({
  operationId,
  ...props
}: OnlineOperationProps & { operationId?: string } = {}) {
  return (
    <MultiplayerAccount>
      {(account) =>
        account ? (
          <AccountOperations {...props} account={account} initial={operationId} />
        ) : (
          <ConnectedOperation {...props} />
        )
      }
    </MultiplayerAccount>
  );
}
type Selection = 'list' | { id?: string; instance: number };
function AccountOperations({
  account,
  initial,
  ...props
}: OnlineOperationProps & { account: AccountAccess; initial?: string }) {
  const instances = useRef(0);
  const [selection, setSelection] = useState<Selection>(() =>
    initial ? { id: initial, instance: instances.current } : 'list',
  );
  const open = (id?: string) => setSelection({ id, instance: ++instances.current });
  const tapped = props.notification?.gameId;
  useEffect(() => {
    if (!tapped) return;
    const next = { id: tapped, instance: ++instances.current };
    setSelection((current) => (current !== 'list' && current.id === tapped ? current : next));
  }, [tapped]);
  if (selection === 'list') return <OperationDirectory account={account} onOpen={open} />;
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setSelection('list')}
        style={s.backToList}
      >
        <Text style={s.backToListText}>‹ All operations</Text>
      </Pressable>
      <ConnectedOperation
        key={selection.instance}
        {...props}
        account={account}
        operationId={selection.id}
        onOpened={(id) =>
          setSelection((current) => (current === 'list' ? current : { ...current, id }))
        }
      />
    </View>
  );
}
function ConnectedOperation({
  onOpenReplays,
  account,
  notification,
  onNotificationHandled,
  operationId,
  onOpened,
}: OnlineOperationProps & {
  account?: AccountAccess;
  operationId?: string;
  onOpened?: (id: string) => void;
}) {
  const [section, setSection] = useState<OperationSection | null>(null);
  const [mapCamera, setMapCamera] = useState({ scale: 1, x: 0, y: 0 });
  const [invite, setInvite] = useState('');
  const [variant, setVariant] = useState<'faction'>();
  const [membership, setMembership] = useState<Allegiance>();
  const [options, setOptions] = useState<GameOptions>({
    ...DEFAULT_GAME_OPTIONS,
    beltCompact: true,
  });
  const [selected, setSelected] = useState('a');
  const [destination, setDestination] = useState<string>();
  const { planning, navigating, setPlanning, setNavigating } = usePlanningMode();
  const [carry, setCarry] = useState(false);
  const [delay, setDelay] = useState(0);
  const [amount, setAmount] = useState('0');
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [inspectedHour, setInspectedHour] = useState<number | null>(null);
  const [referenceRequest, setReferenceRequest] = useState<{
    reference: ObjectReference;
    mode: 'observed' | 'now';
    identity: string;
  }>();
  const [referenceNotice, setReferenceNotice] = useState('');
  const referenceSequence = useRef(0);
  const [inspectFleet, setInspectFleet] = useState<{ request: number; id?: number }>();
  const uplink = useOnlineConnection(
    account,
    {
      onConnected: (next) => {
        onOpened?.(next.id);
        setSelected(
          (next.game.rocks.find((r) => r.owner === next.faction) ?? next.game.rocks[0]!).id,
        );
      },
      onReset: () => setInspectedHour(null),
      onCompleted(pending, next) {
        if (pending.kind === 'recover') {
          setSelected(
            (next.game.rocks.find((r) => r.owner === next.faction) ?? next.game.rocks[0]!).id,
          );
          setRecoveryInput('');
        }
        if (
          pending.kind === 'messages' ||
          pending.kind === 'channel-messages' ||
          pending.kind === 'groups'
        )
          setAcknowledged(pending.body.requestId);
        else if (
          pending.kind === 'orders' ||
          pending.kind === 'schedules' ||
          pending.kind === 'gifts' ||
          pending.kind === 'intercepts' ||
          pending.kind === 'recover' ||
          (pending.kind === 'haulers' && pending.body.action === 'course')
        ) {
          setSection(null);
          setDestination(undefined);
          setPlanning(false);
          setCarry(false);
          setDelay(0);
          setSelectedUnits([]);
          setNavigating(undefined);
        }
      },
    },
    operationId,
  );
  const {
    session,
    snapshot,
    url,
    setUrl,
    busy,
    error,
    setError,
    recoveryCode,
    setRecoveryCode,
    restored,
    rejectedSeat,
    setRejectedSeat,
    accountRestoreFailed,
    run,
    restoreAccount,
    linkAccountSeat,
    complete,
    createRecovery,
    accept,
  } = uplink;
  const enter = (join: boolean, reuse = false) =>
    uplink.enter(join, reuse, { invite, options, variant });
  const restoreSeat = () => uplink.restoreSeat(recoveryInput);
  const referenceIdentity = JSON.stringify([
    session?.url,
    session?.id,
    session?.token,
    snapshot?.faction,
  ]);
  function inspectTime(hour: number | null) {
    setReferenceRequest(undefined);
    setReferenceNotice('');
    setInspectedHour(hour);
    setDelay(0);
    setPlanning(false);
    setNavigating(undefined);
    setDestination(undefined);
  }
  function changeSection(next: OperationSection | null) {
    setReferenceRequest(undefined);
    setReferenceNotice('');
    setSection(next);
  }
  const mode = inspectionMode(snapshot?.game.hour ?? 0, inspectedHour);
  const past = mode === 'past';
  const history = useHistoricalView(
    session?.id && snapshot?.history
      ? { ...session, id: session.id, faction: snapshot.faction }
      : undefined,
    past ? inspectedHour : null,
  );
  useEffect(() => {
    setReferenceRequest(undefined);
    setReferenceNotice('');
    setInspectFleet({ request: ++referenceSequence.current });
  }, [referenceIdentity]);
  useEffect(() => {
    setPlanning(false);
    setNavigating(undefined);
    setDestination(undefined);
    setCarry(false);
    setSelectedUnits([]);
    setDelay(0);
  }, [mode, session?.url, session?.id, session?.token, setPlanning, setNavigating]);
  const resetCamera = useEffectEvent(() => {
    if (snapshot) setMapCamera(fitPlayerCamera(snapshot.game, snapshot.faction));
  });
  useEffect(() => {
    resetCamera();
  }, [session?.url, session?.id, snapshot?.faction, snapshot?.game.epoch]);
  const forecast = inspectionOffset(snapshot?.game.hour ?? 0, inspectedHour);
  useSoundCues(snapshot?.game, snapshot?.faction);
  useEffect(() => {
    if (error) playSound('error');
  }, [error]);
  const [acknowledged, setAcknowledged] = useState<string>();
  const [disconnect, setDisconnect] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const scroll = useRef<ScrollView>(null);
  const notificationDevice = useNotificationDevice();
  const notificationSeat = useMemo(
    () =>
      session?.id && session.pending?.kind !== 'recover' && snapshot?.id === session.id
        ? { ...session, id: session.id }
        : undefined,
    [session, snapshot?.id],
  );
  const notifications = useMessageNotifications(
    notificationSeat,
    notificationDeps(notificationDevice),
  );
  const tap = useNotificationTap({
    notification,
    seat: notificationSeat,
    session,
    restored,
    busy,
    rejectedSeat,
    accountRestoreFailed,
    deps: notificationDeps(notificationDevice),
    onRejected: (seat) => setRejectedSeat(seatIdentity(seat)),
    reconnect: () => {
      void run(uplink.reconnect);
    },
    restoreAccount: () => {
      void run(restoreAccount);
    },
    onHandled: onNotificationHandled,
    onOpen(request) {
      setReferenceRequest(undefined);
      if (request.kind === INCOMING_NOTIFICATION_KIND) {
        inspectTime(null);
        setInspectFleet({ request: ++referenceSequence.current });
        setSection(null);
      } else setSection('signals');
    },
  });
  const notificationNotice = tap.notice;
  const pendingKind =
    notification?.kind === INCOMING_NOTIFICATION_KIND
      ? 'An incoming attack alert'
      : 'A message notification';
  const pendingTap = notification && tap.needsRetry && (
    <View style={s.panel}>
      <Text accessibilityLiveRegion="polite" style={s.detail}>
        {notificationSeat
          ? `${pendingKind} is waiting. Notification settings for this seat could not be checked.`
          : `${pendingKind} is waiting for this operation to reconnect.`}
      </Text>
      <Action text="Retry notification" disabled={busy} onPress={tap.retry} />
      <Action text="Dismiss notification" onPress={tap.dismiss} />
    </View>
  );
  async function retry() {
    if (
      past &&
      session?.pending &&
      !['messages', 'groups', 'channel-messages', 'recovery', 'recover'].includes(
        session.pending.kind,
      )
    ) {
      setError('Historical views are read-only. Return to Now to retry an order.');
      return;
    }
    if (
      mode !== 'live' &&
      session?.pending &&
      [
        'pulse',
        'resign',
        'orders',
        'gifts',
        'intercepts',
        'haulers',
        'modules',
        'sites',
        'specialists',
        'funding',
      ].includes(session.pending.kind)
    ) {
      setError(
        'Return to Now to retry a live action. Scheduled orders can be retried from a forecast.',
      );
      return;
    }
    if (session?.id && session.pending) await complete(session, session.pending);
  }
  function submit(pending: Pending) {
    if (!session) return;
    if (
      past &&
      !['messages', 'groups', 'channel-messages', 'recovery', 'recover'].includes(pending.kind)
    ) {
      setError('Historical views are read-only. Return to Now to issue orders.');
      return;
    }
    if (
      pending.kind === 'resign' &&
      (mode !== 'live' ||
        busy ||
        session.pending ||
        snapshot?.status !== 'game.active' ||
        snapshot.game.version !== 2 ||
        snapshot.game.eliminated.includes(snapshot.faction))
    )
      return;
    uplink.submit(pending);
  }
  function siteAction(action: FutureAction) {
    if (
      !snapshot ||
      !operational ||
      !game ||
      game.winner ||
      game.draw ||
      game.eliminated.includes(snapshot.faction)
    )
      return;
    const base = { requestId: commandId(), revision: snapshot.revision };
    try {
      const executeAt = orderHour(snapshot.game.hour, inspectedHour, 0);
      if (executeAt > snapshot.game.hour) {
        submit({ kind: 'schedules', body: { ...base, executeAt, action } });
        return;
      }
      switch (action.type) {
        case 'hire':
          submit({ kind: 'specialists', body: { ...base, action: 'hire', kind: action.kind } });
          break;
        case 'promote':
        case 'release':
        case 'activate':
          submit({ kind: 'specialists', body: { ...base, action: action.type, unit: action.id } });
          break;
        case 'drill-mine':
          submit({ kind: 'sites', body: { ...base, rock: action.rock, action: 'mine' } });
          break;
        case 'shields':
          submit({
            kind: 'sites',
            body: { ...base, rock: action.rock, action: 'shields', disabled: action.disabled },
          });
          break;
        case 'gift': {
          const { type, ...gift } = action;
          submit({ kind: 'gifts', body: { ...base, ...gift } });
          break;
        }
        case 'intercept': {
          const { type, ...intercept } = action;
          submit({ kind: 'intercepts', body: { ...base, ...intercept } });
          break;
        }
        case 'hauler':
          submit({ kind: 'haulers', body: { ...base, ...action.change } });
          break;
        case 'funding':
          submit({
            kind: 'funding',
            body: { ...base, recipient: action.to, enabled: action.enabled },
          });
          break;
      }
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function sendTransfer() {
    if (!snapshot || !destination) return;
    const body = {
      requestId: commandId(),
      revision: snapshot.revision,
      from: selected,
      to: destination,
      drones: Number(amount),
      specialists: unitIds,
      carryModule: carry && !!snapshot.game.rocks.find((r) => r.id === selected)?.module,
    };
    try {
      const executeAt = orderHour(snapshot.game.hour, inspectedHour, delay);
      submit(
        executeAt > snapshot.game.hour
          ? { kind: 'schedules', body: { ...body, executeAt } }
          : { kind: 'orders', body },
      );
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const pendingEdit = session?.pending?.kind === 'edit-schedule' ? session.pending.body : undefined;
  const pendingPlan =
    pendingEdit && snapshot?.game.scheduled.find((plan) => plan.id === pendingEdit.planId);
  const recoveryPending =
    session?.pending?.kind === 'recover' || session?.pending?.kind === 'recovery';
  const game = useMemo(
    () =>
      past
        ? history.frame?.game
        : snapshot &&
          (forecast
            ? forecastObservation(snapshot.game, snapshot.faction, snapshot.game.hour + forecast)
            : snapshot.game),
    [past, history.frame?.game, snapshot, forecast],
  );
  const referenceFrame = useMemo<ReferenceFrame | undefined>(
    () =>
      forecast
        ? undefined
        : past
          ? history.frame && { ...history.frame, at: history.frame.history.at }
          : snapshot && { ...snapshot, at: snapshot.game.hour },
    [forecast, past, history.frame, snapshot],
  );
  function inspectReference(reference: ObjectReference, mode: 'observed' | 'now') {
    setPlanning(false);
    setNavigating(undefined);
    setDestination(undefined);
    setSelectedUnits([]);
    setCarry(false);
    setDelay(0);
    if (!snapshot) return;
    try {
      const hour = referenceInspectionHour(snapshot, reference, mode);
      inspectTime(hour);
      setReferenceRequest({ reference, mode, identity: referenceIdentity });
      setSection(null);
    } catch (error) {
      setReferenceRequest(undefined);
      setReferenceNotice((error as Error).message);
    }
  }
  useEffect(() => {
    if (!referenceRequest || referenceRequest.identity !== referenceIdentity || !referenceFrame)
      return;
    if (
      referenceRequest.mode === 'observed' &&
      referenceFrame.at !== referenceRequest.reference.hour
    )
      return;
    const target = resolveReference(
      referenceFrame,
      referenceRequest.reference,
      referenceRequest.mode,
    );
    setReferenceRequest(undefined);
    if (!target) {
      setReferenceNotice('Reference unavailable in your observations at this time.');
      setSection('signals');
      return;
    }
    setMapCamera((camera) => focusReferenceCamera(referenceFrame.game, camera, target.point));
    setInspectFleet({
      request: ++referenceSequence.current,
      ...(target.kind === 'hauler' ? { id: target.id } : {}),
    });
    if (target.kind === 'outpost') {
      setSelected(target.id);
      setSection('asset');
    } else setSection(null);
    setReferenceNotice(
      referenceRequest.mode === 'observed'
        ? `Reference · observed at ${gameClock(referenceFrame.at)}.`
        : 'Reference · current observations.',
    );
  }, [referenceRequest, referenceIdentity, referenceFrame]);
  function referenceText(
    kind: ObjectReference['kind'],
    id: string | number,
    label: string,
  ): string | undefined {
    const reference = referenceFrame && copyableReference(referenceFrame, kind, id);
    return reference ? `${label} ${encodeObjectReference(reference)}` : undefined;
  }
  const orders = past ? game : snapshot?.game;
  const rock = game?.rocks.find((r) => r.id === selected);
  const target = game?.rocks.find((r) => r.id === destination);
  const unitManifest =
    rock?.known && snapshot
      ? (rock.specialists ?? []).filter(
          (u) => selectedUnits.includes(u.id) && u.owner === snapshot.faction && !u.captive,
        )
      : [];
  const unitIds = unitManifest.map((u) => u.id);
  const operational =
    !past &&
    snapshot?.status === 'game.active' &&
    !snapshot.game.eliminated.includes(snapshot.faction) &&
    !session?.pending &&
    !busy;
  const immediate = operational && !forecast;
  const preparation = snapshot?.game.version === 2 ? LAUNCH_PREPARATION : 0;
  const launchAt = snapshot
    ? Math.max(snapshot.game.hour, inspectedHour ?? snapshot.game.hour) + delay
    : 0;
  const transfer =
    target && rock && game && snapshot && game.version === 2
      ? stationCourse(
          game,
          rock,
          target,
          specialistSpeed(game, snapshot.faction, unitManifest, target.owner === snapshot.faction),
          launchAt + preparation,
        )
      : undefined;
  const duration =
    target && rock && game
      ? transfer
        ? transfer.arrives - launchAt - preparation
        : travelHours(rock, target, carry ? rock.module : undefined, game.version)
      : 0;
  const diplomacy = useDiplomacyPanel({
    seat:
      notificationSeat && snapshot ? { ...notificationSeat, faction: snapshot.faction } : undefined,
    snapshot,
    origin: JSON.stringify([session?.url, session?.token]),
    disabled: busy || !!session?.pending,
    acknowledged,
    scroll,
    onSubmit: submit,
    onInspectReference: inspectReference,
  });
  const rulesGame = snapshot?.game;
  const roster = rulesGame ? playersIn(rulesGame) : [];
  const joined = snapshot ? roster.filter((f) => snapshot.members.includes(f)).length : 0;
  const variantControls = (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>Multiplayer variant</Text>
      <View style={s.row}>
        <Action
          text={variant ? 'Standard' : 'Standard · selected'}
          disabled={busy}
          onPress={() => setVariant(undefined)}
        />
        <Action
          text={variant ? 'Faction mode · selected' : 'Faction mode'}
          disabled={busy || !membership}
          onPress={() => setVariant('faction')}
        />
      </View>
      <Text style={s.detail}>
        {membership
          ? 'Faction mode adds your faction’s predetermined elite at your core. Each player fights for their own win.'
          : 'Faction mode is available after your first completed online operation and permanent faction choice.'}
      </Text>
    </View>
  );
  const rulesSummary = rulesGame && (
    <Text style={s.detail}>
      {snapshot?.variant === 'faction' ? 'Faction mode · ' : ''}
      {rulesGame.rules?.teams
        ? `${rulesGame.rules.teams.format} teams · ${rulesGame.rules.mode}`
        : rulesGame.rules?.mode === 'pulse'
          ? 'King’s Pulse'
          : rulesGame.rules?.mode === 'domination'
            ? 'Domination'
            : 'Mining'}{' '}
      · {roster.length} players ·{' '}
      {rulesGame.rules?.mode === 'pulse'
        ? 'last surviving King wins'
        : `${victoryTarget(rulesGame)} ${rulesGame.rules?.mode === 'domination' ? 'sites to control' : 'cargo quota'}`}
    </Text>
  );
  const connection = (
    <>
      {session ? (
        <View key="connected-seat" style={s.panel}>
          <Text style={s.label}>
            {session.accountId ? 'Connected to your account' : 'Connection retained on this device'}
          </Text>
          <Text style={s.detail}>{session.url}</Text>
          {rulesSummary}
          {!snapshot && session.options && (
            <Text style={s.detail}>
              Saved creation: {session.options.playerCount} players · {session.options.mode}.
              Reconnect repeats these options.
            </Text>
          )}
          <FactionPanel
            key={`${session.url}:${session.token}:${session.accountId}`}
            session={session}
            refreshKey={`${snapshot?.id}:${snapshot?.status}`}
            disabled={busy || !!session.pending}
            onMembership={setMembership}
          />
          {snapshot?.status === 'game.finished' && (
            <View style={{ gap: 12 }}>
              <Text style={s.label}>Next operation</Text>
              {variantControls}
              <GameSetup council value={options} onChange={setOptions} disabled={busy} />
              <Action
                text="Create next operation"
                disabled={busy || !!session.pending || (variant === 'faction' && !membership)}
                onPress={() => void enter(false, true)}
              />
              <TextInput
                accessibilityLabel="Next invitation code"
                autoCapitalize="none"
                autoCorrect={false}
                value={invite}
                onChangeText={setInvite}
                style={s.input}
                maxLength={24}
              />
              <Action
                text="Join next operation"
                disabled={busy || !!session.pending || invite.length !== 24}
                onPress={() => void enter(true, true)}
              />
            </View>
          )}
          {session.pending && (
            <>
              <Text style={s.error}>
                Request awaiting confirmation. Retry repeats the saved request.
              </Text>
              <Action
                text="Retry command"
                disabled={busy}
                onPress={() => void run(() => retry())}
              />
            </>
          )}
          {recoveryPending && (
            <Text style={s.error}>
              Confirm this recovery request before removing the uplink. The saved request may be
              needed to keep access to your seat.
            </Text>
          )}
          <Action
            text="Reconnect / refresh"
            disabled={busy || session.pending?.kind === 'recover'}
            onPress={() => void run(uplink.reconnect)}
          />
          {account && !session.accountId && (
            <>
              <Text style={s.detail}>
                Link this device’s seat to your account to return on another device. Linking revokes
                the old device token and recovery codes.
              </Text>
              <Action
                text="Link seat to my account"
                disabled={busy || !!session.pending || !session.id}
                onPress={() => void run(linkAccountSeat)}
              />
            </>
          )}
          {!!snapshot && !session.accountId && (
            <>
              <Text style={s.label}>Seat recovery</Text>
              <Text style={s.detail}>
                {snapshot.recoveryEnabled
                  ? 'A recovery code is active. Generating another replaces it.'
                  : 'Save a recovery code before leaving this device. Each code works once and replaces the old connection when used.'}
              </Text>
              <Action
                text={snapshot.recoveryEnabled ? 'Replace recovery code' : 'Generate recovery code'}
                disabled={busy || !!session.pending}
                onPress={createRecovery}
              />
            </>
          )}
          {!!recoveryCode && (
            <>
              <Text style={s.detail}>
                Save this code with the server address in a private place, such as a password
                manager. It controls your seat. This app only shows it until you leave this screen.
              </Text>
              <Text selectable style={s.code}>
                {recoveryCode}
              </Text>
              <Action text="Hide recovery code" onPress={() => setRecoveryCode('')} />
            </>
          )}
          {disconnect ? (
            <>
              <Text style={s.error}>
                {session.accountId
                  ? 'Removing this connection keeps the operation on your account. Use Restore account operation to return.'
                  : "Disconnecting removes this device's seat credential. You can return only with a recovery code saved earlier. The server operation continues."}
              </Text>
              <Action text="Keep connection" onPress={() => setDisconnect(false)} />
              <Action
                text="Remove seat from this device"
                disabled={busy || recoveryPending}
                onPress={() =>
                  void run(async () => {
                    await uplink.removeConnection();
                    setDisconnect(false);
                  })
                }
              />
            </>
          ) : (
            <Action
              text="Disconnect…"
              disabled={busy || recoveryPending}
              onPress={() => setDisconnect(true)}
            />
          )}
        </View>
      ) : (
        <View key="connection-entry" style={s.panel}>
          <Text style={s.label}>Game server</Text>
          <TextInput
            key="server-url"
            secureTextEntry={false}
            accessibilityLabel="Game server URL"
            autoCapitalize="none"
            autoCorrect={false}
            value={url}
            onChangeText={setUrl}
            style={s.input}
            keyboardType="url"
          />
          {account && (
            <Action
              text="Restore account operation"
              disabled={busy}
              onPress={() => void run(restoreAccount)}
            />
          )}
          <Text style={s.label}>New operation</Text>
          {variantControls}
          <GameSetup council value={options} onChange={setOptions} disabled={busy} />
          <Action
            text="Create private operation"
            disabled={busy}
            onPress={() => void enter(false)}
          />
          <Text style={s.label}>Invitation code</Text>
          <TextInput
            key="invite-code"
            secureTextEntry={false}
            accessibilityLabel="Invitation code"
            autoCapitalize="none"
            autoCorrect={false}
            value={invite}
            onChangeText={setInvite}
            style={s.input}
            maxLength={24}
          />
          <Action
            text="Join operation"
            disabled={busy || invite.length !== 24}
            onPress={() => void enter(true)}
          />
          <Text style={s.label}>Restore your seat</Text>
          <Text style={s.detail}>
            Use the server address above and a code you saved earlier. Restoring disconnects your
            old device and consumes the code. Generate a new code afterward.
          </Text>
          <TextInput
            key="seat-recovery"
            accessibilityLabel="Recovery code"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={recoveryInput}
            onChangeText={setRecoveryInput}
            style={s.input}
            maxLength={180}
          />
          <Action
            text="Restore seat and revoke old connection"
            disabled={busy || !recoveryInput.trim()}
            onPress={restoreSeat}
          />
        </View>
      )}
    </>
  );
  const setup = (
    <>
      <View style={s.panel}>
        <Text style={s.title}>Operation participation</Text>
        {snapshot?.game.eliminated.includes(snapshot.faction) && (
          <Text style={s.detail}>You are eliminated. Sensors and chat remain available.</Text>
        )}
        {snapshot?.inactivity && (
          <>
            <Text style={s.detail}>
              After 48 hours of inactivity, you are automatically resigned. Opening this operation
              in the foreground, issuing orders, or chatting counts as activity. Background
              refreshes do not.
            </Text>
            <Text style={s.detail}>
              {inactivityRemaining(snapshot.inactivity.expiresAt, snapshot.serverTime)} until
              automatic resignation without further activity. Deadline:{' '}
              {new Date(snapshot.inactivity.expiresAt).toLocaleString()}.
            </Text>
          </>
        )}
        <ResignationControl
          key={`${mode}:${session?.url}:${session?.id}:${session?.token}:${snapshot?.faction}:${snapshot?.status}:${snapshot?.game.eliminated.includes(snapshot.faction)}`}
          enabled={!!immediate && snapshot?.game.version === 2}
          onConfirm={() => {
            if (snapshot)
              submit({
                kind: 'resign',
                body: { requestId: commandId(), revision: snapshot.revision },
              });
          }}
        />
      </View>
      <MessageNotificationSettings state={notifications} />
      {snapshot?.history && session?.id && (
        <ReplayExport
          key={referenceIdentity}
          historyStart={snapshot.history.from}
          hour={snapshot.game.hour}
          disabled={busy || !!session.pending}
          createReplay={(from, through) => exportSharedReplay(session, from, through)}
        />
      )}
      {onOpenReplays && <Action text="Open shared replay" onPress={onOpenReplays} />}
      {connection}
    </>
  );
  function inspectSpecialistSite(id: string) {
    const site = game?.rocks.find((r) => r.id === id);
    if (!game || !site) return;
    setReferenceRequest(undefined);
    setReferenceNotice('');
    setPlanning(false);
    setNavigating(undefined);
    setDestination(undefined);
    setDelay(0);
    setCarry(false);
    setSelectedUnits([]);
    setSelected(site.id);
    setAmount(String(Math.floor((site.drones ?? 0) / 2)));
    setInspectFleet({ request: ++referenceSequence.current });
    setMapCamera((camera) => focusCamera(game, camera, site));
    setSection('asset');
  }
  function inspectSpecialistFleet(id: number) {
    const fleet = game?.fleets.find((f) => f.id === id);
    if (!game || !fleet) return;
    setReferenceRequest(undefined);
    setReferenceNotice('');
    setPlanning(false);
    setNavigating(undefined);
    setDestination(undefined);
    setDelay(0);
    setCarry(false);
    setSelectedUnits([]);
    setMapCamera((camera) => focusCamera(game, camera, fleetPosition(game, fleet)));
    setInspectFleet({ request: ++referenceSequence.current, id });
    setSection(null);
  }
  const scheduledOrders = snapshot && (
    <ScheduledOrders
      compact
      owner={snapshot.faction}
      key={`${session?.url}:${session?.id}:${session?.token}:${snapshot.faction}:${snapshot.game.epoch}`}
      units={selectableLaunchUnits(orders ?? snapshot.game, snapshot.faction)}
      preparation={snapshot.game.version === 2}
      onInspect={inspectTime}
      onEdit={(change) => {
        if (operational)
          submit({
            kind: 'edit-schedule',
            body: { requestId: commandId(), revision: snapshot.revision, ...change },
          });
      }}
      fleets={orders?.fleets}
      plans={orders?.scheduled ?? []}
      hour={orders?.hour ?? snapshot.game.hour}
      rocks={snapshot.game.rocks}
      disabled={!operational}
      onCancel={(planId) =>
        submit({
          kind: 'cancel-schedule',
          body: { requestId: commandId(), revision: snapshot.revision, planId },
        })
      }
    />
  );
  const timeline = snapshot && (
    <TimeMachine
      orders={scheduledOrders}
      opening={openingEnabled(game ?? snapshot.game)}
      forecastUncertain={game?.forecastUncertain}
      fleets={orders?.fleets}
      plans={orders?.scheduled}
      rocks={snapshot.game.rocks}
      compact
      hour={snapshot.game.hour}
      historyStart={snapshot.history?.from}
      inspectedHour={inspectedHour}
      onChange={inspectTime}
      events={[
        ...(game?.events.flatMap((event) =>
          event.discoveredAt === undefined ? [event.hour] : [event.hour, event.discoveredAt],
        ) ?? []),
        ...(game?.fleets.flatMap((f) => [
          f.arrives,
          ...(f.preparing ? [f.departed] : []),
          ...(f.pendingCourse ? [f.pendingCourse.executeAt] : []),
        ]) ?? []),
        ...(orders?.scheduled.map((p) => p.executeAt) ?? []),
      ]}
      online
    />
  );
  if (snapshot && past && !game) {
    const waiting = (
      <View style={s.panel}>
        <Text accessibilityRole={history.error ? 'alert' : undefined} style={s.detail}>
          {!snapshot.history
            ? 'Observed history is unavailable on this server.'
            : (history.error ?? 'Loading observed history…')}
        </Text>
        <Action text="Now" onPress={() => inspectTime(null)} />
        {history.error && <Action text="Retry history" onPress={history.retry} />}
      </View>
    );
    return (
      <OperationShell
        player={snapshot.faction}
        portraits={snapshot.game.rules?.portraits}
        colors={snapshot.game.rules?.colors}
        section={section}
        onSection={changeSection}
        panelScrollRef={scroll}
        status={
          <>
            {!!notificationNotice && (
              <Text accessibilityLiveRegion="polite" style={s.detail}>
                {notificationNotice}
              </Text>
            )}
            {pendingTap}
            <Text style={s.label}>
              {FACTIONS[snapshot.faction].name} · loading history · {gameClock(inspectedHour!)}
            </Text>
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {displayGameText(error, snapshot?.game ?? {})}
              </Text>
            )}
          </>
        }
        chart={<View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>{waiting}</View>}
        timeline={timeline}
        panels={{
          asset: { title: 'Historical asset', content: waiting },
          orders: { title: 'Historical orders', content: waiting },
          units: { title: 'Historical specialists', content: waiting },
          intel: { title: 'Historical intelligence', content: waiting },
          signals: {
            title: 'Diplomacy and signals',
            content: (
              <>
                <Text style={s.label}>Chat · current</Text>
                {diplomacy}
              </>
            ),
          },
          settings: { title: 'Setup', content: setup },
        }}
      />
    );
  }
  if (!snapshot || !game)
    return (
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.page}
      >
        <Text style={s.title}>Machination / uplink</Text>
        {!!notificationNotice && (
          <Text accessibilityLiveRegion="polite" style={s.detail}>
            {notificationNotice}
          </Text>
        )}
        {pendingTap}
        {!!error && (
          <Text accessibilityRole="alert" style={s.error}>
            {displayGameText(error, snapshot?.game ?? {})}
          </Text>
        )}
        {connection}
      </ScrollView>
    );
  const launchBlocked = launchBlockReason({
    game,
    owner: snapshot.faction,
    source: rock,
    target,
    liveHour: snapshot.game.hour,
    executeAt: launchAt,
    drones: Number(amount),
    units: unitIds.length,
    unavailable: past
      ? 'History is read-only. Return to Now or choose a future time.'
      : !operational
        ? 'Wait for the operation to be active and any pending request to finish.'
        : undefined,
  });
  return (
    <OperationShell
      player={snapshot.faction}
      portraits={game.rules?.portraits}
      colors={game.rules?.colors}
      section={section}
      onSection={changeSection}
      panelScrollRef={scroll}
      status={
        <>
          {!!notificationNotice && (
            <Text accessibilityLiveRegion="polite" style={s.detail}>
              {notificationNotice}
            </Text>
          )}
          {pendingTap}
          {!!referenceNotice && (
            <Text accessibilityLiveRegion="polite" style={s.detail}>
              {referenceNotice}
            </Text>
          )}
          <View style={s.row}>
            <Text style={[s.label, { flex: 1 }]}>
              {FACTIONS[snapshot.faction].name} ·{' '}
              {past
                ? 'history · read-only'
                : snapshot.game.eliminated.includes(snapshot.faction)
                  ? 'eliminated'
                  : snapshot.status.replace('game.', '')}
            </Text>
            <Text style={s.detail}>{gameClock(past ? history.frame!.history.at : game.hour)}</Text>
          </View>
          {!!error && (
            <Text accessibilityRole="alert" style={s.error}>
              {displayGameText(error, snapshot?.game ?? {})}
            </Text>
          )}
          {snapshot.status === 'game.finished' && (
            <Action text="Factions and next operation" onPress={() => setSection('settings')} />
          )}
          {snapshot.status !== 'game.finished' && (
            <Action text="Faction leaderboard" onPress={() => setSection('settings')} />
          )}
          {snapshot.status === 'game.lobby' && (
            <Action text="Open lobby and invitation" onPress={() => setSection('intel')} />
          )}
          {pendingEdit && (
            <Text style={s.detail}>
              Saved launch edit ·{' '}
              {pendingPlan
                ? scheduledOrderLabel(
                    pendingPlan,
                    snapshot.game.rocks,
                    snapshot.game.scheduled,
                    snapshot.game.fleets,
                  )
                : 'Queued launch'}{' '}
              · {pendingEdit.drones} drones · awaiting confirmation. Retry repeats this saved edit.
            </Text>
          )}
          {session?.pending && (
            <Action
              text="Retry pending command"
              disabled={busy}
              onPress={() => void run(() => retry())}
            />
          )}
          {game.draw && <Text style={s.code}>Operation ended in a draw.</Text>}
          {game.winner && (
            <Text style={s.code}>
              {forecast ? 'Projected: ' : ''}
              {game.rules?.teams
                ? `Team ${teamNumber(game, game.winner)}`
                : FACTIONS[game.winner].name}
              :{' '}
              {game.rules?.mode === 'domination'
                ? 'territory target reached.'
                : 'contract complete.'}
            </Text>
          )}
        </>
      }
      chart={
        <BeltMap
          fill
          combatObservation={{
            view: game,
            faction: snapshot.faction,
            observedAt: past ? game.hour : snapshot.game.hour,
          }}
          inspecting={section === 'asset'}
          transferRoute={transfer?.route}
          inspectFleet={inspectFleet}
          fleetReference={(fleet) => referenceText('hauler', fleet.id, 'Hauler')}
          timeInspection={{
            liveHour: snapshot.game.hour,
            historyStart: snapshot.history?.from,
            onInspect: inspectTime,
          }}
          viewport={{ camera: mapCamera, onChange: setMapCamera }}
          player={snapshot.faction}
          onInspectFleet={() => {
            setReferenceRequest(undefined);
            setSection(null);
          }}
          onManageFleet={() => setSection('orders')}
          onTransfer={
            operational && !game.winner && !game.draw && navigating === undefined
              ? (from, to) => {
                  setReferenceRequest(undefined);
                  setReferenceNotice('');
                  setSelected(from.id);
                  setDestination(to.id);
                  setPlanning(true);
                  setSection('asset');
                  setCarry(false);
                  setSelectedUnits([]);
                  setDelay(0);
                  setAmount(String(Math.floor((from.drones ?? 0) / 2)));
                }
              : undefined
          }
          game={game}
          selected={selected}
          destination={destination}
          onSelect={(r) => {
            setReferenceRequest(undefined);
            setReferenceNotice('');
            if (navigating !== undefined) {
              if (!r.destroyed)
                siteAction({
                  type: 'hauler',
                  change: { action: 'course', fleet: navigating, to: r.id },
                });
              setNavigating(undefined);
              setSection('orders');
              return;
            }
            if (planning && r.id !== selected) {
              setDestination(r.id);
              setSection('asset');
            } else if (!planning) {
              setSection('asset');
              setSelected(r.id);
              setDestination(undefined);
              setCarry(false);
              setSelectedUnits([]);
              if (r.known) setAmount(String(Math.floor(r.drones / 2)));
            }
          }}
        />
      }
      hint={
        (planning && !destination) || navigating !== undefined ? (
          <>
            <Text style={s.detail}>
              {navigating !== undefined
                ? 'Choose a new course destination.'
                : `From ${rock?.name}: choose a destination.`}
            </Text>
            <Action
              text="Cancel selection"
              onPress={() => {
                setNavigating(undefined);
                setPlanning(false);
                setSection('asset');
              }}
            />
          </>
        ) : undefined
      }
      timeline={timeline}
      panels={{
        asset: {
          title: planning
            ? `${rock?.name} → ${target?.name ?? 'Choose destination'}`
            : (rock?.name ?? 'Selected asset'),
          footer: planning ? (
            <View>
              <PulseMoveWarning game={game} owner={snapshot.faction} units={unitManifest} />
              {launchBlocked && (
                <Text accessibilityRole="alert" style={[s.detail, { marginBottom: 6 }]}>
                  {launchBlocked}
                </Text>
              )}
              <Text style={[s.detail, { color: '#e5eadc', marginBottom: 6 }]}>
                {launchCargoLabel(Number(amount), unitManifest, carry ? rock?.module : undefined)}
              </Text>
              <Text style={s.detail}>
                {Math.floor(rock?.drones ?? 0)} {forecast ? 'projected on station' : 'on station'}
                {target ? ` · arrives ${gameClock(launchAt + preparation + duration)}` : ''}
              </Text>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Action
                    text={
                      snapshot && launchAt > snapshot.game.hour
                        ? `Schedule at ${gameClock(launchAt)}`
                        : game.version === 2
                          ? 'Prepare launch · 10m'
                          : 'Launch hauler'
                    }
                    disabled={launchBlocked !== undefined}
                    onPress={sendTransfer}
                  />
                </View>
                <Action
                  text="Cancel"
                  onPress={() => {
                    setPlanning(false);
                    setDestination(undefined);
                    setDelay(0);
                  }}
                />
              </View>
            </View>
          ) : undefined,
          content: (
            <>
              {game.interceptionUncertain && (
                <View style={s.panel}>
                  <Text style={s.error}>
                    Interception outcome unknown. The target isn't in the current observations.
                  </Text>
                </View>
              )}
              {!!game.uncertain.length && (
                <View style={s.panel}>
                  <Text style={s.error}>
                    Arrival outcomes unknown at{' '}
                    {game.uncertain
                      .map((id) => game.rocks.find((r) => r.id === id)?.name)
                      .join(', ')}
                    . Scout and refresh before relying on this forecast.
                  </Text>
                </View>
              )}{' '}
              {rock && (
                <View style={{ gap: 8 }}>
                  <Text style={s.detail}>
                    {rock.known
                      ? `${Math.floor(rock.drones)} drones · ${siteDescription(rock, game)}`
                      : remoteSiteDescription(rock)}
                  </Text>
                  <Text style={s.detail}>
                    {target
                      ? `To ${target.name} / ${duration.toFixed(2)}h transit / arrival ${gameClock(launchAt + preparation + duration)}`
                      : planning
                        ? 'Select any other site as the destination.'
                        : 'Inspect assets or plan a transfer from a controlled site.'}
                  </Text>
                  {!planning && (
                    <Action
                      text="Choose transfer destination"
                      disabled={!operational || !!rock.destroyed || rock.owner !== snapshot.faction}
                      onPress={() => {
                        setPlanning(!planning);
                        setDestination(undefined);
                        setSection(planning ? 'asset' : null);
                      }}
                    />
                  )}
                  {rock.owner === snapshot.faction && (
                    <DroneManifest
                      compact
                      label="Online drone manifest"
                      value={amount}
                      available={rock.drones ?? 0}
                      disabled={!operational}
                      onChange={setAmount}
                    />
                  )}
                  <LaunchTiming
                    compact
                    future={!!forecast}
                    delay={delay}
                    disabled={!operational}
                    onChange={setDelay}
                  />

                  {rock.known &&
                    rock.owner === snapshot.faction &&
                    target &&
                    target.owner &&
                    target.owner !== snapshot.faction &&
                    !game.eliminated.includes(target.owner) &&
                    !delay && (
                      <GiftTransfer
                        key={`${rock.id}:${target.id}:${target.owner}:${amount}:${carry}:${rock.module}:${unitIds.join(',')}`}
                        scheduledAt={forecast ? inspectedHour! : undefined}
                        specialists={unitManifest}
                        legacy={game.version !== 2}
                        from={rock}
                        to={target}
                        recipient={target.owner}
                        drones={Number(amount)}
                        carry={carry}
                        disabled={
                          !operational ||
                          !!game.winner ||
                          !!game.draw ||
                          game.eliminated.includes(snapshot.faction) ||
                          !Number.isSafeInteger(Number(amount)) ||
                          Number(amount) < (unitIds.length ? 0 : 1) ||
                          Number(amount) > Math.floor(rock.drones)
                        }
                        onGift={() =>
                          siteAction({
                            type: 'gift',
                            from: rock.id,
                            to: target.id,
                            drones: Number(amount),
                            specialists: unitIds,
                            recipient: target.owner!,
                            carryModule: carry && !!rock.module,
                          })
                        }
                      />
                    )}
                  {!planning && game.pulse && (
                    <>
                      <PulseLocation game={game} owner={snapshot.faction} site={rock.id} />
                      <DisruptorControls
                        game={game}
                        owner={snapshot.faction}
                        site={rock.id}
                        enabled={!!operational && mode === 'live' && !game.winner && !game.draw}
                        onCommand={(request) =>
                          submit({
                            kind: 'pulse',
                            body: {
                              requestId: commandId(),
                              revision: snapshot.revision,
                              ...request,
                            },
                          })
                        }
                      />
                      <PulseControls
                        game={game}
                        owner={snapshot.faction}
                        enabled={!!operational && mode === 'live' && !game.winner && !game.draw}
                        onCommand={(action) =>
                          submit({
                            kind: 'pulse',
                            body: { requestId: commandId(), revision: snapshot.revision, action },
                          })
                        }
                      />
                    </>
                  )}
                  {!planning &&
                    game.version === 2 &&
                    rock.known &&
                    rock.owner === snapshot.faction && (
                      <SiteControls
                        mode={game.rules?.mode}
                        minesAllowed={minesAllowed(game)}
                        rock={rock}
                        cost={mineCost(
                          {
                            rules: game.rules,
                            minesDrilled: { you: 0, vesper: 0, null: 0, ...game.minesDrilled },
                          },
                          snapshot.faction,
                        )}
                        enabled={
                          !!operational &&
                          !game.winner &&
                          !game.draw &&
                          !game.eliminated.includes(snapshot.faction)
                        }
                        scheduledAt={forecast ? inspectedHour! : undefined}
                        onMine={() => siteAction({ type: 'drill-mine', rock: rock.id })}
                        onShields={() =>
                          siteAction({
                            type: 'shields',
                            rock: rock.id,
                            disabled: !rock.shieldsDisabled,
                          })
                        }
                      />
                    )}
                  {referenceText('outpost', rock.id, rock.name) && (
                    <CopyObjectReference
                      value={referenceText('outpost', rock.id, rock.name)!}
                      label="Copy site reference"
                    />
                  )}
                  {!planning && rock.known && rock.owner === snapshot.faction && (
                    <InterceptionTargets
                      game={game}
                      source={rock}
                      owner={snapshot.faction}
                      drones={Number(amount)}
                      specialists={unitIds}
                      scheduledAt={forecast ? inspectedHour! : undefined}
                      targetIds={
                        forecast
                          ? observedInterceptionIds(snapshot.game, snapshot.faction)
                          : undefined
                      }
                      disabled={
                        !operational ||
                        !!game.winner ||
                        !!game.draw ||
                        game.eliminated.includes(snapshot.faction)
                      }
                      onIntercept={(target) =>
                        siteAction({
                          type: 'intercept',
                          from: rock.id,
                          target,
                          drones: Number(amount),
                          ...(unitIds.length ? { specialists: unitIds } : {}),
                        })
                      }
                    />
                  )}
                  {game.version === 2 &&
                    rock.known &&
                    rock.owner === snapshot.faction &&
                    (!planning || !!rock.specialists?.length) && (
                      <SpecialistBay
                        mode="cargo"
                        game={game}
                        rock={rock}
                        owner={snapshot.faction}
                        enabled={
                          !!operational &&
                          !game.winner &&
                          !game.draw &&
                          !game.eliminated.includes(snapshot.faction)
                        }
                        scheduledAt={forecast ? inspectedHour! : undefined}
                        selectionEnabled={!!operational}
                        selected={unitIds}
                        onSelect={setSelectedUnits}
                        onHire={(kind) => siteAction({ type: 'hire', kind })}
                        onPromote={(id) => siteAction({ type: 'promote', id })}
                        onRelease={(id) => siteAction({ type: 'release', id })}
                        onActivate={(id) => siteAction({ type: 'activate', id })}
                      />
                    )}
                  {!planning && game.version === 2 && (
                    <SpecialistManifest
                      summary={mapSpecialistSummary(rock)}
                      heading="Specialists at this site"
                    />
                  )}
                  {game.version === 1 && rock.known && rock.owner === snapshot.faction && (
                    <ModuleBay
                      rock={rock}
                      enabled={!!immediate}
                      carry={carry}
                      onCarry={setCarry}
                      onBuild={(kind) =>
                        submit({
                          kind: 'modules',
                          body: {
                            requestId: commandId(),
                            revision: snapshot.revision,
                            rock: rock.id,
                            module: kind,
                          },
                        })
                      }
                    />
                  )}
                </View>
              )}
            </>
          ),
        },
        orders: {
          title: 'Your orders',
          content: (
            <>
              {game.version === 2 && (
                <HaulerOrders
                  courseDelay={mechanicsVersion(game) >= 10}
                  title={past ? 'Historical hauler orders · read-only' : undefined}
                  fleets={
                    forecast
                      ? futureCommandFleets(game, snapshot.game, snapshot.faction)
                      : game.fleets.filter((f) => f.owner === snapshot.faction)
                  }
                  rocks={game.rocks}
                  hour={game.hour}
                  scheduledAt={forecast ? inspectedHour! : undefined}
                  enabled={
                    !!operational &&
                    !game.winner &&
                    !game.draw &&
                    !game.eliminated.includes(snapshot.faction)
                  }
                  onNavigate={(id) => {
                    setSection(null);
                    setNavigating((current) => (current === id ? undefined : id));
                    setPlanning(false);
                    setDestination(undefined);
                  }}
                  onCommand={(change) => siteAction({ type: 'hauler', change })}
                />
              )}
              <View style={s.panel}>
                <Text style={s.title}>Haulers in transit</Text>
                {game.fleets.length ? (
                  game.fleets.map((f) => (
                    <Text key={f.id} style={s.detail}>
                      {FACTIONS[f.owner].name} → {flightDestination(game.rocks, f)} / {f.drones}{' '}
                      drones / {(f.arrives - game.hour).toFixed(1)}h
                      {f.module ? ` / ${MODULES[f.module].name}` : ''}
                    </Text>
                  ))
                ) : (
                  <Text style={s.detail}>No active transfers.</Text>
                )}
              </View>
            </>
          ),
        },
        units: {
          title: 'Specialist management',
          content:
            game.version === 2 ? (
              <SpecialistPanel
                game={game}
                owner={snapshot.faction}
                enabled={!!operational}
                scheduledAt={forecast ? inspectedHour! : undefined}
                onHire={(kind) => siteAction({ type: 'hire', kind })}
                onPromote={(id) => siteAction({ type: 'promote', id })}
                onRelease={(id) => siteAction({ type: 'release', id })}
                onActivate={(id) => siteAction({ type: 'activate', id })}
                onInspectSite={inspectSpecialistSite}
                onInspectFleet={inspectSpecialistFleet}
              />
            ) : (
              <Text style={s.detail}>Legacy modules are managed at their sites.</Text>
            ),
        },
        signals: {
          title: 'Diplomacy and signals',
          content: (
            <>
              <CouncilPanel
                key={`${referenceIdentity}:${mode}`}
                game={game}
                owner={snapshot.faction}
                enabled={
                  !busy && !session?.pending && mode === 'live' && snapshot.status === 'game.active'
                }
                notice={
                  snapshot.status === 'game.lobby'
                    ? 'The first ballot opens when the host starts the operation.'
                    : mode !== 'live'
                      ? 'Historical and forecast council views are read-only. Forecasts assume current public votes; future changes remain unknown.'
                      : undefined
                }
                onCommand={(action) =>
                  submit({ kind: 'council', body: { ...action, requestId: commandId() } })
                }
              />
              <Text style={s.label}>Chat · current</Text>
              {diplomacy}
              <View style={s.panel}>
                <Text style={s.title}>Signal log</Text>
                <SignalLog view={game} limit={12} />
              </View>
            </>
          ),
        },
        intel: {
          title: 'Operation intelligence',
          content: (
            <>
              <IntelligenceReports
                game={game}
                owner={snapshot.faction}
                forecast={!!forecast}
                enabled={
                  !!operational &&
                  !game.winner &&
                  !game.draw &&
                  !game.eliminated.includes(snapshot.faction)
                }
                scheduledAt={forecast ? inspectedHour! : undefined}
                onChange={(to, enabled) => siteAction({ type: 'funding', to, enabled })}
              />
              <View style={s.panel}>
                <Text
                  style={[
                    s.title,
                    {
                      color: playerAppearance(
                        snapshot.faction,
                        game.rules?.portraits,
                        game.rules?.colors,
                      ).color,
                    },
                  ]}
                >
                  {FACTIONS[snapshot.faction].name}
                </Text>
                <Text style={s.label}>
                  {past
                    ? 'history · read-only'
                    : snapshot.game.eliminated.includes(snapshot.faction)
                      ? 'eliminated'
                      : snapshot.status.replace('game.', '')}{' '}
                  · {joined}/{roster.length} players joined · hour{' '}
                  {(past ? history.frame!.history.at : game.hour).toFixed(2)}
                </Text>
                {rulesSummary}
                <Text style={s.detail}>Invitation code</Text>
                <Text selectable style={s.code}>
                  {snapshot.invite}
                </Text>
                {game.rules?.teams && (
                  <Text style={s.detail}>
                    Casual {game.rules.teams.format}. Teams are fixed by join order. Teammates share
                    sensors, future plans, and victory. Each player controls their own assets.
                  </Text>
                )}
                {roster.map((f) => (
                  <PlayerIdentity
                    key={f}
                    faction={f}
                    detail={[
                      game.rules?.teams ? `Team ${teamNumber(game, f)}` : '',
                      f === snapshot.faction ? 'You' : '',
                      snapshot.members.includes(f) ? 'Joined' : 'Awaiting player',
                      ...(snapshot.allegiances
                        ?.filter((a) => a.player === f)
                        .map(
                          (a) =>
                            `${ALLEGIANCES[a.faction].name} · ${SPECIALISTS[ALLEGIANCES[a.faction].elite].name}`,
                        ) ?? []),
                      game.eliminated.includes(f) ? 'Eliminated' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
                {snapshot.status === 'game.lobby' && snapshot.host && (
                  <Action
                    text="Start operation"
                    disabled={past || busy || joined < roster.length || !!session?.pending}
                    onPress={() => {
                      if (!past)
                        void run(async () =>
                          accept(await api(session!, `games/${snapshot.id}/start`, {})),
                        );
                    }}
                  />
                )}
                {snapshot.status === 'game.lobby' && (
                  <Text style={s.detail}>
                    {Math.max(0, roster.length - joined)} players remaining. Share the invitation to
                    fill the configured seats. Time begins when the host starts.
                  </Text>
                )}
                {game.draw && <Text style={s.code}>The operation ended in a draw.</Text>}
                {game.winner && (
                  <Text style={s.code}>
                    {forecast ? 'Projected: ' : ''}
                    {game.rules?.teams
                      ? `Team ${teamNumber(game, game.winner)}`
                      : FACTIONS[game.winner].name}
                    :{' '}
                    {game.rules?.mode === 'domination'
                      ? 'territory target reached.'
                      : 'contract complete.'}
                  </Text>
                )}
                <Text style={s.detail}>
                  {game.rules?.teams
                    ? 'Team total'
                    : game.rules?.mode === 'pulse'
                      ? 'Pulse material'
                      : game.rules?.mode === 'domination'
                        ? 'Your territory'
                        : 'Cargo'}
                  : {Math.floor(victoryProgress(game, snapshot.faction))}
                  {game.rules?.mode !== 'pulse' ? ` / ${victoryTarget(game)}` : ''}
                </Text>
                {game.pulse && (
                  <PulseControls
                    game={game}
                    owner={snapshot.faction}
                    enabled={!!operational && mode === 'live' && !game.winner && !game.draw}
                    onCommand={(action) =>
                      submit({
                        kind: 'pulse',
                        body: { requestId: commandId(), revision: snapshot.revision, action },
                      })
                    }
                  />
                )}
              </View>
            </>
          ),
        },
        settings: { title: 'Setup', content: setup },
      }}
    />
  );
}
const s = StyleSheet.create({
  backToList: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  backToListText: { color: '#b4c7ca', fontSize: 14 },
  page: {
    padding: 20,
    gap: 18,
    maxWidth: 820,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 50,
  },
  title: { color: '#e5eadc', fontSize: 24 },
  detail: { color: '#8c9f85', fontSize: 12, lineHeight: 20 },
  label: { color: '#96ad89', fontSize: 11, letterSpacing: 1 },
  panel: {
    padding: 18,
    gap: 12,
    backgroundColor: '#101b13',
    borderWidth: 1,
    borderColor: '#30402e',
  },
  input: {
    color: '#e5eadc',
    borderWidth: 1,
    borderColor: '#40563a',
    backgroundColor: '#0b140e',
    padding: 13,
    minHeight: 46,
    fontSize: 15,
  },
  button: { backgroundColor: '#b8e986', padding: 14, minHeight: 44, alignItems: 'center' },
  buttonText: { color: '#182312', fontSize: 12, fontWeight: '600' },
  code: { color: '#b8e986', fontSize: 16, letterSpacing: 1 },
  error: { color: '#e9a775', fontSize: 13, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 8 },
  message: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#30402e', gap: 6 },
  messageText: { color: '#d6e2cd', fontSize: 14, lineHeight: 21 },
});
