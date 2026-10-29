/** Collects notification taps, including the one that cold-started the app, as at most one pending open request. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationDevice } from './notification-device';
import { parseNotificationData, type NotificationRequest } from './message-notifications';

export type NotificationLaunchDeps = {
  /** false on web and offline-only installations. Checked before the native adapter is loaded. */
  shouldListen: () => Promise<boolean>;
  onRegistered: (listener: () => void) => () => void;
  load: () => Promise<NotificationDevice | undefined>;
};
const CONSUMED_LIMIT = 64;

export function useNotificationLaunch(deps: NotificationLaunchDeps | undefined) {
  const [request, setRequest] = useState<NotificationRequest>();
  const consumed = useRef<string[]>([]);
  const device = useRef<NotificationDevice | undefined>(undefined);
  const depsRef = useRef(deps);

  const receive = useCallback((data: unknown) => {
    const parsed = parseNotificationData(data);
    // Foreign, malformed, and repeated responses are cleared without navigation.
    if (!parsed || consumed.current.includes(parsed.notificationId)) { void device.current?.clearOpened().catch(() => {}); return; }
    setRequest(current => current?.notificationId === parsed.notificationId ? current : parsed);
  }, []);

  useEffect(() => {
    const deps = depsRef.current;
    if (!deps) return;
    let stopped = false, unsubscribe: (() => void) | undefined;
    const start = async () => {
      if (stopped || device.current || !await deps.shouldListen().catch(() => false)) return;
      const native = await deps.load().catch(() => undefined);
      if (stopped || !native || device.current) return;
      device.current = native;
      unsubscribe = native.onOpened(open => receive(open.data));
      const last = await native.lastOpened().catch(() => null);
      if (!stopped && last) receive(last.data);
    };
    void start();
    const offRegistered = deps.onRegistered(() => void start());
    return () => { stopped = true; offRegistered(); unsubscribe?.(); };
  }, [receive]);

  const consume = useCallback((notificationId: string) => {
    consumed.current = [...consumed.current.filter(id => id !== notificationId), notificationId].slice(-CONSUMED_LIMIT);
    setRequest(current => current?.notificationId === notificationId ? undefined : current);
    void device.current?.clearOpened().catch(() => {});
  }, []);

  return { request, consume };
}
