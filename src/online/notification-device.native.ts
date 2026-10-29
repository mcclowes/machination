/** Expo SDK 55 adapter, loaded by multiplayer settings or after a prior opt-in for tap handling. */
import { Platform } from 'react-native';
import { INCOMING_NOTIFICATION_CHANNEL, INCOMING_NOTIFICATION_KIND, MESSAGE_NOTIFICATION_CHANNEL } from './notification-contract';
import { parseNotificationData } from './message-notifications';
import type { NotificationDevice, NotificationPermission, loadNotificationDevice as Load } from './notification-device';
export type { NotificationDevice, NotificationOpen, NotificationPermission } from './notification-device';

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let loaded: Promise<NotificationDevice | undefined> | undefined;

export const loadNotificationDevice: typeof Load = () => {
  loaded ??= import('expo-notifications').then(Notifications => {
    Notifications.setNotificationHandler({ handleNotification: async notification => {
      const incoming = parseNotificationData(notification.request.content.data)?.kind === INCOMING_NOTIFICATION_KIND;
      return { shouldShowBanner: incoming, shouldShowList: incoming, shouldPlaySound: false, shouldSetBadge: false };
    } });
    const { IosAuthorizationStatus: Ios } = Notifications;
    // iOS reports granular authorization; the top-level flag alone hides provisional and ephemeral delivery.
    const status = (p: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>): NotificationPermission => {
      const ios = Platform.OS === 'ios' ? p.ios?.status : undefined;
      if (ios === Ios.AUTHORIZED) return 'granted';
      if (ios === Ios.PROVISIONAL || ios === Ios.EPHEMERAL) return 'provisional';
      if (ios === Ios.DENIED) return 'denied';
      if (ios === Ios.NOT_DETERMINED) return 'undetermined';
      return p.granted ? 'granted' : p.status === 'undetermined' ? 'undetermined' : 'denied';
    };
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
    const device: NotificationDevice = {
      permission: async () => status(await Notifications.getPermissionsAsync()),
      async requestPermission() {
        // Android 13 needs a channel before the prompt can appear.
        if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(MESSAGE_NOTIFICATION_CHANNEL, { name: 'Messages', importance: Notifications.AndroidImportance.DEFAULT });
        return status(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } }));
      },
      async prepareIncoming() {
        if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(INCOMING_NOTIFICATION_CHANNEL, { name: 'Incoming attacks', importance: Notifications.AndroidImportance.HIGH });
      },
      async pushToken() {
        if (!projectId || !PROJECT_ID.test(projectId)) throw new Error('This build has no push project configured.');
        return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      },
      onTokenChange(listener) { const subscription = Notifications.addPushTokenListener(() => listener()); return () => subscription.remove(); },
      async lastOpened() { const response = await Notifications.getLastNotificationResponseAsync(); return response ? { data: response.notification.request.content.data } : null; },
      onOpened(listener) { const subscription = Notifications.addNotificationResponseReceivedListener(response => listener({ data: response.notification.request.content.data })); return () => subscription.remove(); },
      clearOpened: () => Notifications.clearLastNotificationResponseAsync(),
    };
    return device;
  }).catch(() => { loaded = undefined; return undefined; });
  return loaded;
};
