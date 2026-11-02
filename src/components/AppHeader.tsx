/**
 * ---
 * purpose: Keep shared screen titles readable without competing with global controls.
 * ---
 *
 * @format
 */
import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from './Pressable';

export function AppHeader({
  title,
  onExit,
  children,
}: {
  title?: string;
  onExit: () => void;
  children: ReactNode;
}) {
  return (
    <View style={[s.header, !title && s.home]}>
      <View style={s.controls}>
        {!!title && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="‹ Games"
            onPress={onExit}
            style={s.back}
          >
            <Text style={s.backText}>‹ Games</Text>
          </Pressable>
        )}
        <View style={s.tools}>{children}</View>
      </View>
      {!!title && (
        <Text accessibilityRole="header" style={s.title}>
          {title}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 12, gap: 8 },
  home: { paddingTop: 8 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  back: { minHeight: 44, minWidth: 64, maxWidth: '100%', justifyContent: 'center' },
  backText: { color: '#b4c7ca', fontSize: 14 },
  tools: {
    marginLeft: 'auto',
    maxWidth: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  title: { color: '#e5eadc', fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
