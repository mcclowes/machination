/**
 * ---
 * purpose: Keep a recoverable screen after client render failures without resetting saved progress or credentials.
 * related:
 *   - ../../index.ts - root boundary around account initialization and the application
 * ---
 *
 * @format
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export class AppRecovery extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: unknown, info: React.ErrorInfo) {
    console.error('Machination could not render.', info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.screen}>
          <StatusBar style="light" />
          <ScrollView contentContainerStyle={s.content}>
            <Text accessibilityRole="header" style={s.title}>
              The game hit a problem
            </Text>
            <Text accessibilityRole="alert" style={s.detail}>
              Try again to reopen the game. This won’t reset your saved games or multiplayer seat.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={() => this.setState({ failed: false })}
              style={({ pressed }) => [s.retry, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.retryText}>Try again</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080f0d' },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    padding: 24,
    gap: 20,
  },
  title: { color: '#e5eadc', fontSize: 26, fontWeight: '600' },
  detail: { color: '#b4c7ca', fontSize: 16, lineHeight: 24 },
  retry: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#b8e986',
    borderRadius: 8,
  },
  retryText: { color: '#080f0d', fontSize: 16, fontWeight: '600' },
});
