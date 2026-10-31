/**
 * Scoped message confirmation; receipt and uncertain intent remain owned by useMessageReports.
 * @format
 */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { FACTIONS } from '../game/players';
import { REPORT_REASONS, type ReportReason } from '../contracts/message-reports';
import type { MessageReportState } from './useMessageReports';

const labels: Record<ReportReason, string> = {
  harassment: 'Harassment',
  spam: 'Spam',
  threat: 'Threats',
  other: 'Other concern',
};

export function MessageReportDialog({ state }: { state: MessageReportState }) {
  if (!state.selection || !state.dialogOpen) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={state.close}>
      <SafeAreaProvider>
        <SafeAreaView style={s.overlay} accessibilityViewIsModal>
          <KeyboardAvoidingView
            style={s.keyboard}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={s.frame}>
              <View style={s.heading}>
                <Text accessibilityRole="header" style={s.title}>
                  {state.receipt ? 'Report received' : 'Report message'}
                </Text>
                <Action text="Close report" onPress={state.close} />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
                <Text style={s.detail}>Message from {FACTIONS[state.selection.sender].name}</Text>
                <Text numberOfLines={4} style={s.preview}>
                  {state.selection.text}
                </Text>
                {state.receipt ? (
                  <>
                    <Text accessibilityLiveRegion="polite" style={s.detail}>
                      Saved for operator review.
                    </Text>
                    <Text selectable style={s.receipt}>
                      Receipt: {state.receipt.caseId}
                    </Text>
                  </>
                ) : (
                  <ReportForm state={state} />
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function ReportForm({ state }: { state: MessageReportState }) {
  const [reason, setReason] = useState<ReportReason>(state.submission?.reason ?? 'harassment');
  const [detail, setDetail] = useState(state.submission?.detail ?? '');
  const locked = state.working || state.uncertain;
  return (
    <>
      <Text style={s.detail}>
        The game’s operators receive this message, your report, and your operation and seat
        reference. Other players can’t see your report.
      </Text>
      <Text style={s.detail}>
        Reporting doesn’t block this player. Message blocking is available in Diplomacy.
      </Text>
      <Text style={s.label}>Reason</Text>
      <View style={s.reasons}>
        {REPORT_REASONS.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={labels[value]}
            accessibilityState={{ checked: reason === value, disabled: locked }}
            disabled={locked}
            onPress={() => setReason(value)}
            style={[s.button, s.reason, reason === value && s.selected, locked && s.disabled]}
          >
            <Text style={s.action}>{labels[value]}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Report details (optional)"
        multiline
        maxLength={500}
        value={detail}
        onChangeText={setDetail}
        editable={!locked}
        style={s.input}
        placeholder="Add context for the operators (optional)"
        placeholderTextColor="#8c9f85"
      />
      <Text style={s.detail}>{detail.length}/500 characters</Text>
      {state.working && (
        <Text accessibilityLiveRegion="polite" style={s.detail}>
          Sending report… You can close this view and return to the same report from Diplomacy.
        </Text>
      )}
      {state.uncertain && (
        <Text accessibilityRole="alert" style={s.error}>
          The server may have received this report. Retry to check the same request.
        </Text>
      )}
      {!!state.error && (
        <Text accessibilityRole="alert" style={s.error}>
          {state.error}
        </Text>
      )}
      {!state.available && !state.working && (
        <Text style={s.detail}>Reporting is currently unavailable for this operation.</Text>
      )}
      {state.uncertain ? (
        <Action text="Retry same report" disabled={state.working} onPress={state.retry} />
      ) : (
        <Action
          text="Send report"
          disabled={state.working || !state.available}
          onPress={() => state.submit(reason, detail)}
        />
      )}
    </>
  );
}

function Action({
  text,
  disabled = false,
  onPress,
}: {
  text: string;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.action}>{text}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(5, 12, 16, 0.92)', padding: 12 },
  keyboard: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  frame: { flexShrink: 1, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#101b13' },
  heading: { padding: 12, gap: 10, borderBottomWidth: 1, borderColor: '#30402e' },
  content: { padding: 12, gap: 12 },
  title: { color: '#e5eadc', fontSize: 18, lineHeight: 25 },
  detail: { color: '#a4b69d', fontSize: 13, lineHeight: 20 },
  label: { color: '#e5eadc', fontSize: 14 },
  preview: {
    color: '#d6e2cd',
    fontSize: 14,
    lineHeight: 21,
    padding: 10,
    backgroundColor: '#0b140e',
  },
  receipt: { color: '#b8e986', fontSize: 12, lineHeight: 20 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: { minWidth: 100, flexGrow: 1 },
  button: {
    minHeight: 44,
    padding: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#40563a',
    backgroundColor: '#15241a',
  },
  selected: { borderColor: '#b8e986', backgroundColor: '#263c20' },
  action: { color: '#b8e986', fontSize: 13, lineHeight: 20 },
  input: {
    minHeight: 100,
    color: '#d6e2cd',
    borderWidth: 1,
    borderColor: '#40563a',
    backgroundColor: '#0b140e',
    padding: 12,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  disabled: { opacity: 0.45 },
  error: { color: '#e9a775', fontSize: 13, lineHeight: 20 },
});
