/**
 * ---
 * purpose: Own multiplayer restoration, polling, durable pending requests, and recovery without screen state.
 * related:
 *   - ./client.ts - persisted seat credentials and pending commands
 *   - ./network.ts - typed transport and definitive rejection classification
 * ---
 *
 * @format
 */

import { loadProfile } from '../solo/profile';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Snapshot } from '../contracts/protocol';
import type { GameOptions } from '../game/rules';
import type { AccountAccess } from './account-auth';
import { api, accountSessionApi, RejectedCommand } from './network';
import {
  commandId,
  connect,
  DEFAULT_GAME_SERVER,
  newCredential,
  newSession,
  restoreSession,
  storeSession,
  type Pending,
  type Session,
} from './client';
import { presenceDue } from './presence';
import { formatRecoveryCode, parseRecoveryCode } from './recovery';

export const seatIdentity = (session?: Session | null) =>
  session
    ? JSON.stringify([
        session.url,
        session.id,
        session.accountId ?? null,
        session.accountId ? null : session.token,
      ])
    : undefined;
type Events = {
  onConnected(snapshot: Snapshot): void;
  onCompleted(pending: Pending, snapshot: Snapshot): void;
  onReset(): void;
};

/** With an account, `operationId` picks one of its operations; without one, it opens setup or a creation in flight. */
export function useOnlineConnection(
  account: AccountAccess | undefined,
  events: Events,
  operationId?: string,
) {
  const callbacks = useRef(events);
  callbacks.current = events;
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [url, setUrl] = useState(DEFAULT_GAME_SERVER);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [restored, setRestored] = useState(false);
  const [rejectedSeat, setRejectedSeat] = useState<string>();
  const [accountRestoreFailed, setAccountRestoreFailed] = useState(false);
  const latestSession = useRef(session);
  latestSession.current = session;
  const lock = useRef(false);
  const lastActivity = useRef(0);
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await work();
      setError('');
    } catch (e) {
      if (e instanceof RejectedCommand && e.status === 401) {
        setSnapshot(undefined);
        setRecoveryCode('');
        setRejectedSeat(seatIdentity(latestSession.current));
      }
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function accept(next: Snapshot) {
    setRejectedSeat(undefined);
    if (
      next.inactivity &&
      next.inactivity.expiresAt !== latestSnapshot.current?.inactivity?.expiresAt
    )
      lastActivity.current = Date.now();
    latestSnapshot.current = next;
    setSnapshot(next);
  }
  const restoreStored = useEffectEvent(() =>
    run(async () => {
      let stored: Session | null;
      if (!account) stored = await restoreSession();
      else if (!operationId)
        stored = (await restoreSession(account.accountId)) ?? (await restoreSession());
      else {
        stored = await restoreSession(account.accountId, operationId);
        if (!stored) {
          const device = await restoreSession();
          stored =
            device?.id === operationId
              ? device
              : {
                  ...(await newSession(url)),
                  ...account,
                  id: operationId,
                };
        }
      }
      if (!stored) return;
      const saved = stored.accountId && account ? { ...stored, ...account } : stored;
      setUrl(saved.url);
      setSession(saved);
      if (saved.pending?.kind === 'recover') {
        await complete(saved, saved.pending);
        return;
      }
      const result = await connect(saved);
      setSession(result.session);
      accept(result.snapshot);
      callbacks.current.onConnected(result.snapshot);
    }),
  );
  useEffect(() => {
    void restoreStored().then(() => setRestored(true));
  }, []);
  useEffect(() => {
    if (!session?.id || session.pending?.kind === 'recover') return;
    const refresh = (foregroundEvent = false) =>
      void run(async () => {
        const active = AppState.currentState === 'active';
        const presence = presenceDue({
          now: Date.now(),
          lastActivity: lastActivity.current,
          active,
          eligible: !!latestSnapshot.current?.inactivity,
          foregroundEvent,
        });
        const next = await api(
          session,
          `games/${session.id}${presence ? '/activity' : ''}`,
          presence ? {} : undefined,
        );
        if (presence) lastActivity.current = Date.now();
        accept(next);
      });
    const timer = setInterval(() => refresh(), 15000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh(true);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [session]);
  async function restoreAccount() {
    try {
      await restoreAccountSeat();
      setAccountRestoreFailed(false);
    } catch (error) {
      setAccountRestoreFailed(!(error instanceof RejectedCommand && error.status === 401));
      throw error;
    }
  }
  async function restoreAccountSeat() {
    if (!account) return;
    const fresh = { ...(await newSession(url)), ...account };
    const restored = await accountSessionApi(fresh);
    if (!restored) {
      setSession(null);
      setSnapshot(undefined);
      return;
    }
    const connected = { ...fresh, id: restored.id };
    await storeSession(connected);
    setSession(connected);
    accept(restored);
    callbacks.current.onConnected(restored);
  }
  async function linkAccountSeat() {
    if (!session?.id || !account || session.pending) return;
    const linked = { ...session, ...account };
    let snapshot: Snapshot;
    try {
      snapshot = await api(linked, 'account/link', { id: session.id, token: session.token });
    } catch (error) {
      // Only an account rejection is about the link credential; a rejected seat token keeps the general seat-loss path.
      if (
        error instanceof RejectedCommand &&
        error.status === 401 &&
        error.issue?.startsWith('account.unauthorized.')
      )
        throw new Error(`Your account could not link this seat. ${error.message}`);
      throw error;
    }
    await storeSession(linked);
    await storeSession(null);
    setSession(linked);
    accept(snapshot);
    setRecoveryCode('');
  }
  async function enter(
    join: boolean,
    reuse: boolean,
    { invite, options, variant }: { invite: string; options: GameOptions; variant?: 'faction' },
  ) {
    await run(async () => {
      const { preferredColor } = await loadProfile();
      const created: Session =
        reuse && session
          ? {
              ...session,
              id: undefined,
              pending: undefined,
              requestId: join ? undefined : commandId(),
              invite: join ? invite : undefined,
              options: join ? undefined : options,
              variant: join ? undefined : variant,
            }
          : {
              ...(await newSession(
                url,
                join ? invite : undefined,
                join ? undefined : options,
                join ? undefined : variant,
              )),
              ...account,
            };
      created.preferredColor = preferredColor;
      await storeSession(created);
      setSnapshot(undefined);
      callbacks.current.onReset();
      setSession(created);
      const result = await connect(created);
      setSession(result.session);
      accept(result.snapshot);
      callbacks.current.onConnected(result.snapshot);
    });
  }
  async function complete(saved: Session, pending: Pending) {
    try {
      const next = await api(saved, `games/${saved.id}/${pending.kind}`, pending.body);
      const cleared = { ...saved, pending: undefined };
      await storeSession(cleared);
      setSession(cleared);
      accept(next);
      if (pending.kind === 'recovery')
        setRecoveryCode(formatRecoveryCode(saved.id!, pending.body.secret));
      callbacks.current.onCompleted(pending, next);
    } catch (error) {
      if (error instanceof RejectedCommand) {
        const cleared = { ...saved, pending: undefined };
        await storeSession(pending.kind === 'recover' ? null : cleared);
        setSession(pending.kind === 'recover' ? null : cleared);
        try {
          accept(await api(cleared, `games/${cleared.id}`));
        } catch {
          /* Keep the last confirmed snapshot. */
        }
      }
      throw error;
    }
  }
  function createRecovery() {
    if (!session?.id) return;
    setRecoveryCode('');
    void run(async () => {
      const pending: Pending = {
        kind: 'recovery',
        body: { requestId: commandId(), secret: await newCredential() },
      };
      const saved = { ...session, pending };
      await storeSession(saved);
      setSession(saved);
      await complete(saved, pending);
    });
  }
  function restoreSeat(recoveryInput: string) {
    void run(async () => {
      const code = parseRecoveryCode(recoveryInput);
      const fresh = await newSession(url);
      const pending: Pending = { kind: 'recover', body: { secret: code.secret } };
      const saved = { ...fresh, id: code.id, pending };
      await storeSession(saved);
      setSnapshot(undefined);
      callbacks.current.onReset();
      setSession(saved);
      await complete(saved, pending);
    });
  }

  async function reconnect() {
    if (!session) return;
    const result = await connect(session);
    setSession(result.session);
    accept(result.snapshot);
  }
  async function removeConnection() {
    if (!session) return;
    await storeSession(null, session.accountId, session.id);
    setSession(null);
    setSnapshot(undefined);
    setRecoveryCode('');
  }
  function submit(pending: Pending) {
    if (!session) return;
    void run(async () => {
      const saved = { ...session, pending };
      await storeSession(saved);
      setSession(saved);
      await complete(saved, pending);
    });
  }
  return {
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
    enter,
    complete,
    createRecovery,
    restoreSeat,
    reconnect,
    removeConnection,
    submit,
    accept,
  };
}
