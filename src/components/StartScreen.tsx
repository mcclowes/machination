import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

export function StartScreen({ children }: { children: React.ReactNode }) {
  return <ScrollView contentContainerStyle={styles.screen}>
    <Image source={require('../../assets/brand/asteroid-frontier.png')} accessibilityLabel="Machination: ships and settlements in the asteroid frontier" resizeMode="contain" style={styles.artwork} />
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>Machination</Text>
      <Text style={styles.description}>Learn the controls in tactical exercises, start a solo operation, or negotiate with human rivals.</Text>
      {children}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  artwork: { width: '100%', maxWidth: 960, aspectRatio: 3 / 2 },
  content: { width: '100%', maxWidth: 520, padding: 24, gap: 16 },
  heading: { color: '#e5eadc', fontSize: 26, fontWeight: '400' },
  description: { color: '#b8c5b5', fontSize: 14, lineHeight: 21 },
});
