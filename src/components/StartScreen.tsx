import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SpaceBackground } from './SpaceBackground';

export function StartScreen({ children }: { children: React.ReactNode }) {
  return <View style={styles.viewport}><SpaceBackground /><ScrollView style={styles.viewport} contentContainerStyle={styles.screen}>
    <Image source={require('../../assets/brand/asteroid-frontier.png')} accessibilityLabel="Machination: ships and settlements in the asteroid frontier" resizeMode="contain" style={styles.artwork} />
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>Machination</Text>
      <Text style={styles.description}>Learn the controls in tactical exercises, start a solo operation, or negotiate with human rivals.</Text>
      {children}
    </View>
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  viewport: { flex: 1, minHeight: 0 },
  screen: { flexGrow: 1, paddingVertical: 16 },
  artwork: { width: '100%', maxWidth: 960, height: 200, alignSelf: 'center' },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 24, gap: 16 },
  heading: { color: '#e5eadc', fontSize: 26, fontWeight: '400' },
  description: { color: '#b8c5b5', fontSize: 14, lineHeight: 21 },
});
