/**
 * ---
 * purpose: Animated opening artwork — slow camera drift, engine burn, exhaust, debris, logo pulse, and city lights over the supplied illustration.
 * ---
 */
import React, { memo, useEffect, useId, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { CITY_LIGHTS, DUST, ENGINES, LOGO_CORE, LOGO_SATELLITES, coverFrame, heroHeight, type Anchor } from './title-art';
import { nativeDriver, useAmbientMotion } from './use-ambient-motion';

const SKY = '#0d1821';
const INTRO_DURATION = 1800;
const DRIFT_DURATION = 26000;
const DUST_LAP = 120000;
const EXHAUST_PARTICLES = 3;

const timing = (value: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.ease)) =>
  Animated.timing(value, { toValue, duration, easing, useNativeDriver: nativeDriver, isInteraction: false });
const swing = (value: Animated.Value, high: number, low: number, duration: number) =>
  Animated.loop(Animated.sequence([timing(value, high, duration / 2), timing(value, low, duration / 2)]));
const cycle = (value: Animated.Value, duration: number) =>
  Animated.loop(timing(value, 1, duration, Easing.linear), { resetBeforeIteration: true });
const phased = (value: Animated.Value, phase: number) => Animated.modulo(Animated.add(value, phase), 1);

const Glow = memo(function Glow({ size, inner, outer }: { size: number; inner: string; outer: string }) {
  const id = `glow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return <Svg width={size} height={size}>
    <Defs><RadialGradient id={id} cx="50%" cy="50%" r="50%">
      <Stop offset="0" stopColor={inner} stopOpacity="1" />
      <Stop offset="0.3" stopColor={outer} stopOpacity="0.7" />
      <Stop offset="1" stopColor={outer} stopOpacity="0" />
    </RadialGradient></Defs>
    <Rect width={size} height={size} fill={`url(#${id})`} />
  </Svg>;
});

const at = ({ x, y }: Anchor, width: number, height: number, size: number) =>
  ({ position: 'absolute' as const, left: x / 100 * width - size / 2, top: y / 100 * height - size / 2, width: size, height: size });

type Props = { scrollY?: Animated.Value };
export function TitleArt({ scrollY }: Props) {
  const { reduced, animate } = useAmbientMotion();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [values] = useState(() => ({
    intro: new Animated.Value(0),
    drift: new Animated.Value(0),
    dust: new Animated.Value(0),
    logo: new Animated.Value(0.5),
    city: [new Animated.Value(0.6), new Animated.Value(0.6)],
    burns: ENGINES.map(() => new Animated.Value(0.8)),
    exhaust: ENGINES.map(() => new Animated.Value(0)),
  }));
  const fadeId = `fade-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    if (reduced === undefined) return;
    if (reduced) { values.intro.setValue(1); return; }
    const intro = timing(values.intro, 1, INTRO_DURATION, Easing.out(Easing.cubic));
    intro.start();
    return () => intro.stop();
  }, [reduced, values]);

  useEffect(() => {
    if (!animate) return;
    const loops = [
      swing(values.drift, 1, 0, DRIFT_DURATION * 2),
      cycle(values.dust, DUST_LAP),
      swing(values.logo, 1, 0.2, 5200),
      swing(values.city[0]!, 1, 0.25, 3400),
      swing(values.city[1]!, 0.2, 1, 4700),
      ...values.burns.map((value, i) => Animated.loop(Animated.sequence([
        timing(value, 1, ENGINES[i]!.period * 0.3), timing(value, 0.6, ENGINES[i]!.period * 0.2),
        timing(value, 0.9, ENGINES[i]!.period * 0.25), timing(value, 0.7, ENGINES[i]!.period * 0.25),
      ]))),
      ...values.exhaust.map(value => cycle(value, 1500)),
    ];
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
  }, [animate, values]);

  const frame = coverFrame(viewport.width || 1, viewport.height || 1);
  const { width, height } = frame;
  const parallax = scrollY ? scrollY.interpolate({ inputRange: [-200, 0, 600], outputRange: [-60, 0, 240], extrapolate: 'clamp' }) : 0;
  const scrollFade = scrollY ? scrollY.interpolate({ inputRange: [0, viewport.height || 1], outputRange: [1, 0.3], extrapolate: 'clamp' }) : 1;
  const zoom = Animated.multiply(
    values.intro.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] }),
    values.drift.interpolate({ inputRange: [0, 1], outputRange: [1.03, 1.09] }),
  );

  return <View accessible accessibilityRole="header" accessibilityLabel="Machination"
    style={[styles.hero, viewport.width ? { height: heroHeight(viewport.width) } : styles.placeholder]}
    onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: heroHeight(layout.width) })}>
    {viewport.width > 0 && <Animated.View testID="title-art-canvas" style={{
      position: 'absolute', left: frame.left, top: frame.top, width, height,
      opacity: Animated.multiply(values.intro, scrollFade),
      transform: [
        { translateY: parallax },
        { translateX: values.drift.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.012, width * 0.012] }) },
        { scale: zoom },
      ],
    }}>
      <Image source={require('../../assets/brand/asteroid-frontier.png')} resizeMode="stretch" style={{ width, height }} />

      <Animated.View style={[at(LOGO_CORE, width, height, width * 0.11), {
        opacity: values.logo.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.4] }),
        transform: [{ scale: values.logo.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
      }]}><Glow size={width * 0.11} inner="#fff6dc" outer="#e8dfbb" /></Animated.View>
      {LOGO_SATELLITES.map((anchor, i) => <Animated.View key={i} style={[at(anchor, width, height, width * 0.03), {
        opacity: values.logo.interpolate({ inputRange: [0, 1], outputRange: i ? [0.7, 0.1] : [0.1, 0.7] }),
      }]}><Glow size={width * 0.03} inner="#fff1d6" outer="#e9a775" /></Animated.View>)}

      {CITY_LIGHTS.map((anchor, i) => <Animated.View key={i} style={[at(anchor, width, height, width * 0.012), { opacity: values.city[i % 2] }]}>
        <Glow size={width * 0.012} inner="#fff4d0" outer="#ffb35c" />
      </Animated.View>)}

      {ENGINES.map((engine, i) => {
        const size = engine.size / 100 * width;
        return <React.Fragment key={i}>
          {Array.from({ length: EXHAUST_PARTICLES }, (_, p) => {
            const t = phased(values.exhaust[i]!, p / EXHAUST_PARTICLES);
            return <Animated.View key={p} style={[at(engine, width, height, size * 0.3), styles.exhaust, {
              opacity: t.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.8, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 2.4] }) },
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, size * 0.2] }) },
                { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }) },
              ],
            }]} />;
          })}
          <Animated.View style={[at(engine, width, height, size * 2), {
            opacity: values.burns[i],
            transform: [{ scale: values.burns[i]!.interpolate({ inputRange: [0.6, 1], outputRange: [0.85, 1.15] }) }],
          }]}><Glow size={size * 2} inner="#fff3c4" outer="#ff8a2a" /></Animated.View>
        </React.Fragment>;
      })}

      {DUST.map((speck, i) => {
        const t = phased(Animated.multiply(values.dust, speck.speed), speck.phase);
        return <Animated.View key={i} style={[styles.dust, {
          top: `${speck.y}%`, width: speck.size, height: speck.size, borderRadius: speck.size, opacity: speck.opacity,
          transform: [
            { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [width * 1.04, -width * 0.04] }) },
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, width * 0.05] }) },
          ],
        }]} />;
      })}
    </Animated.View>}
    <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={`${fadeId}-v`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={SKY} stopOpacity="0.55" /><Stop offset="0.14" stopColor={SKY} stopOpacity="0" />
          <Stop offset="0.62" stopColor={SKY} stopOpacity="0" /><Stop offset="1" stopColor={SKY} stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id={`${fadeId}-h`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={SKY} stopOpacity="1" /><Stop offset="0.1" stopColor={SKY} stopOpacity="0" />
          <Stop offset="0.9" stopColor={SKY} stopOpacity="0" /><Stop offset="1" stopColor={SKY} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${fadeId}-h)`} />
      <Rect width="100%" height="100%" fill={`url(#${fadeId}-v)`} />
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  hero: { width: '100%', maxWidth: 960, alignSelf: 'center', overflow: 'hidden' },
  placeholder: { aspectRatio: 1 / 0.85, maxHeight: 520 },
  exhaust: { borderRadius: 999, backgroundColor: '#ffb066' },
  dust: { position: 'absolute', left: 0, backgroundColor: '#d8cdb4' },
});
