import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SpaceBackground } from './SpaceBackground';
import { TitleArt } from './TitleArt';
import { nativeDriver, useAmbientMotion } from './use-ambient-motion';

const ENTRANCE_DELAY = 700;
const ENTRANCE_STAGGER = 90;

export function StartScreen({ children }: { children: React.ReactNode }) {
  const { reduced } = useAmbientMotion();
  const items = [
    <Text key="tagline" style={styles.tagline}>Command the quiet belt.</Text>,
    <Text key="description" style={styles.description}>Learn the controls in tactical exercises, start a solo operation, or negotiate with human rivals.</Text>,
    ...React.Children.toArray(children),
  ];
  const [scrollY] = useState(() => new Animated.Value(0));
  const [entrance] = useState(() => items.map(() => new Animated.Value(0)));

  useEffect(() => {
    if (reduced === undefined) return;
    if (reduced) { entrance.forEach(value => value.setValue(1)); return; }
    const reveal = Animated.stagger(ENTRANCE_STAGGER, entrance.map(value => Animated.timing(value, {
      toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
    })));
    const timer = setTimeout(() => reveal.start(), ENTRANCE_DELAY);
    return () => { clearTimeout(timer); reveal.stop(); };
  }, [reduced, entrance]);

  return <View style={styles.viewport}><SpaceBackground /><Animated.ScrollView style={styles.viewport} contentContainerStyle={styles.screen} scrollEventThrottle={16}
    onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: nativeDriver })}>
    <TitleArt scrollY={scrollY} />
    <View style={styles.content}>
      {items.map((item, i) => {
        const value = entrance[i] ?? 1;
        return <Animated.View key={i} style={typeof value === 'number' ? undefined : {
          opacity: value,
          transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }}>{item}</Animated.View>;
      })}
    </View>
  </Animated.ScrollView></View>;
}

const styles = StyleSheet.create({
  viewport: { flex: 1, minHeight: 0 },
  screen: { flexGrow: 1, paddingBottom: 24 },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 24, marginTop: -28, gap: 14 },
  tagline: { color: '#e5eadc', fontSize: 28, fontWeight: '300', lineHeight: 34 },
  description: { color: '#b8c5b5', fontSize: 14, lineHeight: 21, marginBottom: 6 },
});
