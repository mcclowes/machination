/** Seat-authenticated device preferences and opaque message/attack notification routing. */
export type MessageNotificationSettings = {
  gameId: string;
  deviceId: string;
  revision: number;
  available: boolean;
  enabled: boolean;
  bindingId?: string;
  /** Present only in the negotiated version-two preference view. */
  incoming?: boolean;
};

export type SetMessageNotifications = {
  requestId: string;
  deviceId: string;
  revision: number;
  enabled: boolean;
  expoPushToken?: string;
  incoming?: boolean;
};

export const MESSAGE_NOTIFICATION_KIND = 'machination.message';
export const MESSAGE_NOTIFICATION_CHANNEL = 'machination-messages';
export const INCOMING_NOTIFICATION_KIND = 'machination.incoming';
export const INCOMING_NOTIFICATION_CHANNEL = 'machination-alerts';
export type MessageNotificationData = {
  kind: typeof MESSAGE_NOTIFICATION_KIND;
  version: 1;
  gameId: string;
  bindingId: string;
  notificationId: string;
};
export type IncomingNotificationData = Omit<MessageNotificationData, 'kind'> & { kind: typeof INCOMING_NOTIFICATION_KIND };
