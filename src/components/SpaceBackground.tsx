/**
 * ---
 * purpose: Decorative space sky shared by title and charts, with motion and foreground lifecycle support.
 * ---
 */
import React, { memo, useEffect, useId, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { Point } from '../game/geometry';

const TWINKLE_PERIODS = [8400, 12600, 17800];
const SHOOTING_STAR_QUIET_MIN = 12000;
const SHOOTING_STAR_QUIET_VARIATION = 20000;
const DISTANT_STAR_PARALLAX = 0.12;
const NEAR_STAR_PARALLAX = 0.24;
const STILL = { x: 0, y: 0 };
const wrap = (value: number, period: number) => ((value % period) + period) % period;
const panDelta = (value: number, period?: number) => period ? wrap(value + period / 2, period) - period / 2 : value;
// Fixed positions keep the sky stable through game ticks and viewport changes.
const stars = Array.from({ length: 90 }, (_, i) => ({
  id: i,
  left: (i * 73.137 + 11.3) % 100,
  top: (i * i * 17.173 + i * 31.7 + 7) % 100,
  size: i % 11 === 0 ? 2 : i % 3 === 0 ? 1.5 : 1,
  opacity: 0.2 + (i % 5) * 0.09,
  color: i % 7 === 0 ? '#b6cddd' : i % 13 === 0 ? '#dfd5bd' : '#d5e2e5',
}));

type Props = { pan?: Point; panPeriod?: Point };
export const SpaceBackground = memo(function SpaceBackground({ pan = STILL, panPeriod }: Props) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [twinkles] = useState(() => TWINKLE_PERIODS.map(() => new Animated.Value(0.5)));
  const [nebula] = useState(() => new Animated.Value(0));
  const [shootingStar] = useState(() => new Animated.Value(0));
  const [shootingPosition, setShootingPosition] = useState({ left: '22%' as `${number}%`, top: '12%' as `${number}%` });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [travel, setTravel] = useState({ pan, offset: pan });
  if (travel.pan.x !== pan.x || travel.pan.y !== pan.y) {
    // Accumulate the short movement across a wrapped chart's camera seam.
    setTravel({ pan, offset: {
      x: travel.offset.x + panDelta(pan.x - travel.pan.x, panPeriod?.x),
      y: travel.offset.y + panDelta(pan.y - travel.pan.y, panPeriod?.y),
    } });
  }
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
    const timing = (value: Animated.Value, toValue: number, duration: number) => Animated.timing(value, {
      toValue, duration, easing: Easing.inOut(Easing.ease),
      useNativeDriver: Platform.OS !== 'web', isInteraction: false,
    });
    const animations = twinkles.map((value, i) => Animated.loop(Animated.sequence([
      timing(value, 0.95, TWINKLE_PERIODS[i]! / 2),
      timing(value, 0.3, TWINKLE_PERIODS[i]! / 2),
    ])));
    animations.push(Animated.loop(Animated.sequence([timing(nebula, 1, 22000), timing(nebula, 0, 22000)])));
    animations.forEach(animation => animation.start());
    return () => {
      animations.forEach(animation => animation.stop());
      twinkles.forEach(value => value.setValue(0.5));
      nebula.setValue(0);
    };
  }, [active, reducedMotion, twinkles, nebula]);

  useEffect(() => {
    if (reducedMotion || !active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let animation: Animated.CompositeAnimation | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        if (disposed) return;
        shootingStar.setValue(0);
        setShootingPosition({ left: `${10 + Math.random() * 60}%`, top: `${8 + Math.random() * 55}%` });
        animation = Animated.timing(shootingStar, {
          toValue: 1, duration: 1800, easing: Easing.linear,
          useNativeDriver: Platform.OS !== 'web', isInteraction: false,
        });
        animation.start(({ finished }) => { if (finished && !disposed) schedule(); });
      }, SHOOTING_STAR_QUIET_MIN + Math.random() * SHOOTING_STAR_QUIET_VARIATION);
    };
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      animation?.stop();
      shootingStar.setValue(0);
    };
  }, [active, reducedMotion, shootingStar]);

  const offset = reducedMotion ? STILL : travel.offset;
  const renderStar = (star: typeof stars[number]) => <View key={star.id} testID={`space-star-${star.id}`} style={{
    position: 'absolute',
    left: `${wrap(star.left + offset.x / size.width * 100 * (star.id < 54 ? DISTANT_STAR_PARALLAX : NEAR_STAR_PARALLAX), 100)}%`,
    top: `${wrap(star.top + offset.y / size.height * 100 * (star.id < 54 ? DISTANT_STAR_PARALLAX : NEAR_STAR_PARALLAX), 100)}%`,
    width: star.size, height: star.size,
    borderRadius: star.size, opacity: star.opacity, backgroundColor: star.color,
  }} />;
  return <View testID="space-background" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.sky} onLayout={({ nativeEvent: { layout } }) => {
    if (layout.width > 0 && layout.height > 0) setSize({ width: layout.width, height: layout.height });
  }}>
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
    <Animated.View testID="space-shooting-star" style={[styles.shootingStar, shootingPosition, {
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
  shootingStar: { position: 'absolute', flexDirection: 'row', alignItems: 'center' },
  starHead: { width: 2, height: 2, borderRadius: 1, backgroundColor: '#dcebf0' },
});
