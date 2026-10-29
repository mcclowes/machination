/** Explicit, honest opt-in for incoming-message notifications on this device and seat. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MessageNotificationState } from './useMessageNotifications';

function Action({ text, onPress, disabled }: { text: string; onPress: () => void; disabled: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.buttonText}>{text}</Text></Pressable>;
}

export function MessageNotificationSettings({ state }: { state: MessageNotificationState }) {
  const { phase, settings, permission, working, error } = state;
  let status: string;
  let action: React.ReactNode = null;
  if (phase === 'unsupported') status = 'Message notifications are available in the iOS and Android apps.';
  else if (phase === 'idle') status = 'Connect to an operation to manage message notifications.';
  else if (phase === 'loading') status = 'Checking message notifications for this device…';
  else if (phase === 'error' || !settings) status = 'Notification settings are unavailable.';
  else if (settings.enabled) {
    status = !settings.available ? 'This server has stopped notification delivery. You can still turn notifications off for this device.'
      : permission === 'granted' ? 'On for this device and seat. Delivery is best effort; Signals remains the record.'
      : permission === 'provisional' ? 'On for this device and seat. iOS delivers these quietly to Notification Center until you allow alerts in system settings.'
      : 'On for this seat, but system notifications are blocked for Machination. Allow them in system settings, or turn this off.';
    action = <Action text="Turn off message notifications" disabled={working} onPress={state.disable} />;
  } else if (!settings.available) status = 'This server has not enabled notification delivery.';
  else {
    status = 'Off. Turning on asks for system permission and registers this device for new messages in this operation.';
    action = <Action text="Turn on message notifications" disabled={working} onPress={state.enable} />;
  }
  return <View style={s.panel}>
    <Text style={s.label}>Message notifications</Text>
    <Text accessibilityLiveRegion="polite" style={s.detail}>{status}</Text>
    {phase !== 'unsupported' && <Text style={s.detail}>Notifications say only “New transmission received.” Message text and senders stay in the app.</Text>}
    {action}
    {!!error && <><Text accessibilityRole="alert" style={s.error}>{error}</Text><Action text="Retry" disabled={working} onPress={state.retry} /></>}
  </View>;
}
const s = StyleSheet.create({
  panel: { padding: 18, gap: 12, backgroundColor: '#101b13', borderWidth: 1, borderColor: '#30402e' },
  label: { color: '#96ad89', fontSize: 11, letterSpacing: 1 }, detail: { color: '#8c9f85', fontSize: 12, lineHeight: 20 }, error: { color: '#e9a775', fontSize: 13, lineHeight: 20 },
  button: { backgroundColor: '#b8e986', padding: 14, minHeight: 44, alignItems: 'center' }, buttonText: { color: '#182312', fontSize: 12, fontWeight: '600' },
});
