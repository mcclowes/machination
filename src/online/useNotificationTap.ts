/**
 * Validate each tap against freshly read binding and consent before opening a connected operation.
 *
 * @format
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { INCOMING_NOTIFICATION_KIND } from '../contracts/notifications';
import type { Session } from './client';
import { notificationDisposition, type NotificationRequest } from './message-notifications';
import { RejectedCommand } from './network';
import { seatIdentity } from './useOnlineConnection';
import type { MessageNotificationDeps, NotificationSeat } from './useMessageNotifications';

type Options = {
  notification?: NotificationRequest;
  seat?: NotificationSeat;
  session: Session | null;
  restored: boolean;
  busy: boolean;
  rejectedSeat?: string;
  accountRestoreFailed: boolean;
  deps: Pick<MessageNotificationDeps, 'read' | 'deviceId'>;
  onRejected(seat: NotificationSeat): void;
  onOpen(notification: NotificationRequest): void;
  onHandled?: (notificationId: string, opened: boolean) => void;
  reconnect(): void;
  restoreAccount(): void;
};
type TapCheck = { key: string; bindingId?: string | null; incoming?: boolean; failed?: true };

export function useNotificationTap(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const { notification, seat, session, restored, busy, rejectedSeat, accountRestoreFailed } =
    options;
  const [notice, setNotice] = useState('');
  const [check, setCheck] = useState<TapCheck>();
  const sequence = useRef(0);
  const key =
    notification && seat?.id === notification.gameId
      ? JSON.stringify([notification.notificationId, seatIdentity(session)])
      : undefined;
  function read() {
    if (!key || !seat) return;
    const startedKey = key,
      startedSeat = seat,
      started = ++sequence.current;
    setCheck({ key });
    void (async () => {
      const { deps } = latest.current;
      try {
        const settings = await deps.read(startedSeat, await deps.deviceId());
        if (sequence.current === started)
          setCheck({
            key: startedKey,
            bindingId: (settings.enabled && settings.bindingId) || null,
            incoming: settings.incoming,
          });
      } catch (error) {
        if (sequence.current !== started) return;
        if (error instanceof RejectedCommand && error.status === 401)
          latest.current.onRejected(startedSeat);
        setCheck({ key: startedKey, failed: true });
      }
    })();
  }
  const checkTap = useEffectEvent(() => {
    if (key && check?.key !== key) read();
  });
  useEffect(() => {
    checkTap();
  }, [key]);
  const seatRejected = !!session && rejectedSeat === seatIdentity(session);
  const confirming =
    !!notification &&
    ((!!session?.id && session.id === notification.gameId && !seat && !seatRejected) ||
      (!session && accountRestoreFailed));
  const current = check?.key === key ? check : undefined;
  const disposition =
    notification &&
    notificationDisposition(notification, {
      restored: restored && !busy && !confirming,
      gameId: seatRejected ? undefined : session?.id,
      bindingId: seat ? current?.bindingId : null,
      incoming: current?.incoming,
    });
  const finishTap = useEffectEvent(() => {
    if (!notification || !disposition || disposition === 'wait') return;
    if (disposition === 'open') {
      setNotice('');
      latest.current.onOpen(notification);
    } else
      setNotice(
        notification.kind === INCOMING_NOTIFICATION_KIND &&
          current?.bindingId === notification.bindingId &&
          current?.incoming !== true
          ? 'This attack alert was not opened because incoming alerts are off for this device.'
          : 'A notification was not opened because it does not match the connected operation and seat.',
      );
    latest.current.onHandled?.(notification.notificationId, disposition === 'open');
  });
  useEffect(() => {
    finishTap();
  }, [notification, disposition]);
  return {
    notice,
    needsRetry: disposition === 'wait' && restored && !busy && (!seat || current?.failed),
    retry() {
      if (seat) read();
      else if (session) latest.current.reconnect();
      else if (accountRestoreFailed) latest.current.restoreAccount();
    },
    dismiss() {
      if (notification) {
        setNotice('');
        latest.current.onHandled?.(notification.notificationId, false);
      }
    },
  };
}
