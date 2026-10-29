/** Seat-authenticated device preferences and opaque incoming-message notification routing. */
export type MessageNotificationSettings = {
  gameId: string;
  deviceId: string;
  revision: number;
  available: boolean;
  enabled: boolean;
  bindingId?: string;
};

export type SetMessageNotifications = {
  requestId: string;
  deviceId: string;
  revision: number;
  enabled: boolean;
  expoPushToken?: string;
};

export const MESSAGE_NOTIFICATION_KIND = 'machination.message';
export const MESSAGE_NOTIFICATION_CHANNEL = 'machination-messages';
export type MessageNotificationData = {
  kind: typeof MESSAGE_NOTIFICATION_KIND;
  version: 1;
  gameId: string;
  bindingId: string;
  notificationId: string;
};
