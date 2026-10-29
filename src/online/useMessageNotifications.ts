/** Opt-in message notifications for one server, seat, operation, and installation. Stale completions never cross seats. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RequestSession } from './account-auth';
import type { MessageNotificationSettings, SetMessageNotifications } from './notification-contract';
import { canRegister, type NotificationDevice, type NotificationPermission } from './notification-device';
import { RejectedCommand } from './network';

export type NotificationSeat = RequestSession & { id: string };
export type MessageNotificationDeps = {
  /** undefined: this platform cannot receive native notifications. 'loading': adapter not ready yet. */
  device: NotificationDevice | undefined | 'loading';
  deviceId: () => Promise<string>;
  read: (seat: NotificationSeat, deviceId: string) => Promise<MessageNotificationSettings>;
  write: (seat: NotificationSeat, body: SetMessageNotifications) => Promise<MessageNotificationSettings>;
  requestId: () => string;
  markRegistered: () => Promise<void>;
};
export type MessageNotificationState = {
  phase: 'unsupported' | 'idle' | 'loading' | 'ready' | 'error';
  settings?: MessageNotificationSettings;
  permission?: NotificationPermission;
  working: boolean;
  error?: string;
  enable(): void;
  disable(): void;
  retry(): void;
};

export const notificationScope = (seat?: NotificationSeat) => seat && JSON.stringify([seat.url, seat.id, seat.accountId ?? null, seat.accountId ? null : seat.token]);

type Failure = { message: string; retry: 'read' | 'enable' | { body: SetMessageNotifications } };
export function useMessageNotifications(seat: NotificationSeat | undefined, deps: MessageNotificationDeps): MessageNotificationState {
  const scope = notificationScope(seat);
  const latest = useRef({ seat, deps, scope });
  latest.current = { seat, deps, scope };
  const [state, setState] = useState<{ scope?: string; settings?: MessageNotificationSettings; permission?: NotificationPermission; loading: boolean; working: boolean; failure?: Failure }>({ loading: false, working: false });
  const stateRef = useRef(state);
  stateRef.current = state;
  const busy = useRef(false);
  const mounted = useRef(false);
  const registeredToken = useRef<{ scope: string; token: string } | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const device = deps.device;
  const settingsFor = (started: string) => stateRef.current.scope === started ? stateRef.current.settings : undefined;

  // Each async step re-checks that the seat it started for is still current before publishing.
  const current = (started?: string) => mounted.current && started !== undefined && latest.current.scope === started;
  const publish = (started: string, change: Partial<typeof state>) => { if (current(started)) setState(prev => prev.scope === started ? { ...prev, ...change } : prev); };

  const read = useCallback(async (started: string) => {
    const { seat, deps } = latest.current;
    if (!current(started) || !seat || deps.device === undefined || deps.device === 'loading') return;
    publish(started, { loading: true, failure: undefined });
    try {
      const deviceId = await deps.deviceId();
      if (!current(started)) return;
      const [settings, permission] = await Promise.all([deps.read(seat, deviceId), deps.device.permission()]);
      publish(started, { settings, permission, loading: false });
      return settings;
    } catch (error) {
      publish(started, { loading: false, failure: { message: `Could not read notification settings. ${(error as Error).message}`, retry: 'read' } });
    }
  }, []);

  useEffect(() => {
    busy.current = false;
    setState({ scope, loading: false, working: false });
    if (scope && device && device !== 'loading') void read(scope);
  }, [scope, device, read]);

  async function write(started: string, body: SetMessageNotifications, reconcileToken = false): Promise<void> {
    const { seat, deps } = latest.current;
    if (!current(started) || !seat) return;
    try {
      const settings = await deps.write(seat, body);
      if (settings.enabled) await deps.markRegistered().catch(() => {});
      if (!current(started)) return;
      registeredToken.current = settings.enabled && body.expoPushToken ? { scope: started, token: body.expoPushToken } : undefined;
      publish(started, { settings, failure: undefined });
    } catch (error) {
      if (!current(started)) return;
      registeredToken.current = undefined;
      if (error instanceof RejectedCommand && error.issue === 'notification.conflict.stale') {
        const settings = await read(started);
        if (reconcileToken && settings?.enabled && current(started)) {
          await register(started, settings.revision, true);
          return;
        }
        if (!settings) return;
        publish(started, { failure: { message: 'This device’s notification setting changed elsewhere. Review it and try again.', retry: 'read' } });
        return;
      }
      // Retrying repeats the identical request, so a lost response cannot apply an old enable twice.
      const retryable = !(error instanceof RejectedCommand) || error.status === 429;
      publish(started, { failure: { message: (error as Error).message, retry: retryable ? { body } : 'read' } });
    }
  }

  async function guarded(work: (started: string) => Promise<void>) {
    const started = latest.current.scope;
    if (!started || busy.current) return;
    busy.current = true; publish(started, { working: true });
    try { await work(started); } finally { if (current(started)) { busy.current = false; publish(started, { working: false }); } }
  }

  async function register(started: string, revision: number, onlyIfChanged = false) {
    const { deps } = latest.current;
    const native = deps.device;
    if (!native || native === 'loading') return;
    let token: string;
    try { token = await native.pushToken(); }
    catch (error) {
      publish(started, { failure: { message: `This build could not register for push notifications. ${(error as Error).message}`, retry: 'enable' } });
      return;
    }
    if (!current(started)) return;
    if (onlyIfChanged && registeredToken.current?.scope === started && registeredToken.current.token === token) return;
    await write(started, { requestId: deps.requestId(), deviceId: await deps.deviceId(), revision, enabled: true, expoPushToken: token });
  }

  const enable = () => void guarded(async started => {
    const { deps } = latest.current;
    const native = deps.device;
    const settings = settingsFor(started);
    if (!native || native === 'loading' || !settings || !settings.available) return;
    let permission: NotificationPermission;
    try { permission = await native.requestPermission(); }
    catch (error) { publish(started, { failure: { message: `Notification permission could not be requested. ${(error as Error).message}`, retry: 'enable' } }); return; }
    publish(started, { permission });
    if (!canRegister(permission)) {
      publish(started, { failure: { message: 'Notifications are blocked for Machination. Allow them in system settings, then try again.', retry: 'enable' } });
      return;
    }
    if (!current(started)) return;
    await register(started, settings.revision);
  });

  const disable = () => void guarded(async started => {
    const { deps } = latest.current;
    const settings = settingsFor(started);
    if (!settings) return;
    await write(started, { requestId: deps.requestId(), deviceId: settings.deviceId, revision: settings.revision, enabled: false });
  });

  const retry = () => {
    const failure = stateRef.current.scope === scope ? stateRef.current.failure : undefined;
    if (!failure) return;
    if (failure.retry === 'read') { if (scope) void read(scope); }
    else if (failure.retry === 'enable') enable();
    else { const body = failure.retry.body; void guarded(async started => {
      if (!body.enabled) return write(started, body);
      const { deps } = latest.current;
      const native = deps.device;
      if (!native || native === 'loading') return;
      try {
        const token = await native.pushToken();
        if (!current(started)) return;
        const changed = token !== body.expoPushToken;
        await write(started, changed ? { ...body, requestId: deps.requestId(), expoPushToken: token } : body, changed);
      } catch (error) {
        publish(started, { failure: { message: (error as Error).message, retry: { body } } });
      }
    }); }
  };

  // Token rotation re-registers the current seat only. The listener is replaced whenever the seat changes.
  const enabled = state.scope === scope && !!state.settings?.enabled && !!state.settings.available;
  useEffect(() => {
    if (!scope || !enabled || !device || device === 'loading') return;
    return device.onTokenChange(() => void guarded(async started => {
      const settings = settingsFor(started);
      if (settings?.enabled) await register(started, settings.revision, true);
    }));
  }, [scope, enabled, device]);

  const visible = state.scope === scope ? state : { loading: false, working: false } as typeof state;
  const phase: MessageNotificationState['phase'] = device === undefined ? 'unsupported' : !seat ? 'idle'
    : visible.settings ? 'ready' : visible.failure ? 'error' : 'loading';
  return { phase, settings: visible.settings, permission: visible.permission, working: visible.working || visible.loading, error: visible.failure?.message, enable, disable, retry };
}
