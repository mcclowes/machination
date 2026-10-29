/** Native notification IO boundary. Web and tests resolve this file, so it never loads the native SDK. */
/** provisional: iOS quiet (provisional or ephemeral) delivery that can still register. */
export type NotificationPermission = 'granted' | 'provisional' | 'denied' | 'undetermined';
export const canRegister = (permission?: NotificationPermission) => permission === 'granted' || permission === 'provisional';
export type NotificationOpen = { data: unknown };
export interface NotificationDevice {
  /** Reads the current OS permission without prompting. */
  permission(): Promise<NotificationPermission>;
  /** Prepares OS channels, then prompts. Call only from an explicit opt-in action. */
  requestPermission(): Promise<NotificationPermission>;
  /** Prepares the incoming-alert channel without prompting or registering a token. */
  prepareIncoming?(): Promise<void>;
  pushToken(): Promise<string>;
  onTokenChange(listener: () => void): () => void;
  lastOpened(): Promise<NotificationOpen | null>;
  onOpened(listener: (open: NotificationOpen) => void): () => void;
  clearOpened(): Promise<void>;
}

export async function loadNotificationDevice(): Promise<NotificationDevice | undefined> { return undefined; }
