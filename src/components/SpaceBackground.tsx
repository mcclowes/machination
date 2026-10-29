/**
 * ---
 * purpose: Decorative space sky shared by title and charts, with motion and foreground lifecycle support.
 * ---
 */
import React, { memo, useEffect, useId, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

const TWINKLE_PERIODS = [8400, 12600, 17800];
const SHOOTING_STAR_INTERVAL = 26000;
// Fixed positions keep the sky stable through game ticks and viewport changes.
const stars = Array.from({ length: 90 }, (_, i) => ({
  left: `${((i * 73.137 + 11.3) % 100).toFixed(3)}%` as `${number}%`,
  top: `${((i * i * 17.173 + i * 31.7 + 7) % 100).toFixed(3)}%` as `${number}%`,
  size: i % 11 === 0 ? 2 : i % 3 === 0 ? 1.5 : 1,
  opacity: 0.2 + (i % 5) * 0.09,
  color: i % 7 === 0 ? '#b6cddd' : i % 13 === 0 ? '#dfd5bd' : '#d5e2e5',
}));

export const SpaceBackground = memo(function SpaceBackground() {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [twinkles] = useState(() => TWINKLE_PERIODS.map(() => new Animated.Value(0.5)));
  const [nebula] = useState(() => new Animated.Value(0));
  const [shootingStar] = useState(() => new Animated.Value(0));
  const gradient = `space-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    let disposed = false, preferenceChanged = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => {
      preferenceChanged = true;
      setReducedMotion(reduced);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!disposed && !preferenceChanged) setReducedMotion(reduced);
    }).catch(() => {});
    const foreground = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { disposed = true; motion?.remove(); foreground?.remove(); };
  }, []);

  useEffect(() => {
    if (reducedMotion || !active) return;
    const timing = (value: Animated.Value, toValue: number, duration: number, delay = 0) => Animated.timing(value, {
      toValue, duration, delay, easing: Easing.inOut(Easing.ease),
      useNativeDriver: Platform.OS !== 'web', isInteraction: false,
    });
    const animations = twinkles.map((value, i) => Animated.loop(Animated.sequence([
      timing(value, 0.95, TWINKLE_PERIODS[i]! / 2),
      timing(value, 0.3, TWINKLE_PERIODS[i]! / 2),
    ])));
    animations.push(Animated.loop(Animated.sequence([timing(nebula, 1, 22000), timing(nebula, 0, 22000)])));
    animations.push(Animated.loop(timing(shootingStar, 1, 1800, SHOOTING_STAR_INTERVAL)));
    animations.forEach(animation => animation.start());
    return () => {
      animations.forEach(animation => animation.stop());
      twinkles.forEach(value => value.setValue(0.5));
      nebula.setValue(0);
      shootingStar.setValue(0);
    };
  }, [active, reducedMotion, twinkles, nebula, shootingStar]);

  const renderStar = (star: typeof stars[number], i: number) => <View key={i} style={{
    position: 'absolute', left: star.left, top: star.top, width: star.size, height: star.size,
    borderRadius: star.size, opacity: star.opacity, backgroundColor: star.color,
  }} />;
  return <View testID="space-background" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.sky}>
    <Animated.View style={[styles.nebula, {
      opacity: nebula.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.65] }),
      transform: [{ translateX: nebula.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }],
    }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`${gradient}-blue`} cx="24%" cy="32%" rx="65%" ry="48%">
            <Stop offset="0" stopColor="#406c83" stopOpacity="0.22" /><Stop offset="1" stopColor="#406c83" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`${gradient}-violet`} cx="85%" cy="78%" rx="52%" ry="60%">
            <Stop offset="0" stopColor="#655677" stopOpacity="0.16" /><Stop offset="1" stopColor="#655677" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradient}-blue)`} />
        <Rect width="100%" height="100%" fill={`url(#${gradient}-violet)`} />
      </Svg>
    </Animated.View>
    <View style={StyleSheet.absoluteFillObject}>{stars.slice(0, 54).map(renderStar)}</View>
    {twinkles.map((opacity, group) => <Animated.View key={group} style={[StyleSheet.absoluteFillObject, { opacity }]}>
      {stars.slice(54 + group * 12, 66 + group * 12).map(renderStar)}
    </Animated.View>)}
    <Animated.View style={[styles.shootingStar, {
      opacity: shootingStar.interpolate({ inputRange: [0, 0.08, 0.65, 1], outputRange: [0, 0.45, 0.3, 0] }),
      transform: [
        { translateX: shootingStar.interpolate({ inputRange: [0, 1], outputRange: [-100, 180] }) },
        { translateY: shootingStar.interpolate({ inputRange: [0, 1], outputRange: [0, 140] }) },
        { rotate: '27deg' },
      ],
    }]}>
      {Array.from({ length: 10 }, (_, i) => <View key={i} style={{ width: 8, height: 1, backgroundColor: '#c3dbe4', opacity: (i + 1) / 10 }} />)}
      <View style={styles.starHead} />
    </Animated.View>
  </View>;
});

const styles = StyleSheet.create({
  sky: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', backgroundColor: '#0d1821' },
  nebula: { position: 'absolute', top: -24, bottom: -24, left: -24, right: -24 },
  shootingStar: { position: 'absolute', left: '22%', top: '12%', flexDirection: 'row', alignItems: 'center' },
  starHead: { width: 2, height: 2, borderRadius: 1, backgroundColor: '#dcebf0' },
});
