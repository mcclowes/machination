/** Production dependencies for message notifications. Web resolves no device and never touches secure storage. */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { loadNotificationDevice, type NotificationDevice } from './notification-device';
import { installationDeviceId, markRegistered, onRegistered, wasRegistered } from './message-notifications';
import { messageNotificationsApi, setMessageNotificationsApi } from './network';
import type { MessageNotificationDeps } from './useMessageNotifications';
import type { NotificationLaunchDeps } from './useNotificationLaunch';
import { commandId } from './client';

const native = Platform.OS !== 'web';
export function useNotificationDevice(): NotificationDevice | undefined | 'loading' {
  const [device, setDevice] = useState<NotificationDevice | undefined | 'loading'>(native ? 'loading' : undefined);
  useEffect(() => { if (native) void loadNotificationDevice().then(setDevice); }, []);
  return device;
}
export function notificationDeps(device: MessageNotificationDeps['device']): MessageNotificationDeps {
  return {
    device,
    deviceId: () => installationDeviceId(SecureStore, Crypto.getRandomBytesAsync),
    read: messageNotificationsApi, write: setMessageNotificationsApi,
    requestId: commandId,
    markRegistered: () => markRegistered(SecureStore),
  };
}
export const launchDeps: NotificationLaunchDeps | undefined = native
  ? { shouldListen: () => wasRegistered(SecureStore), onRegistered, load: loadNotificationDevice } : undefined;
