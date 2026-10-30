/**
 * ---
 * purpose: Directional industrial hauler silhouette with upright drone counts and visible flight states.
 * ---
 */
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { nativeDriver, useAmbientMotion } from './use-ambient-motion';

type Props = { color: string; drones: number; heading: number; selected?: boolean; preparing?: boolean; enginesDisabled?: boolean };

export function ShipMarker({ color, drones, heading, selected, preparing, enginesDisabled }: Props) {
  const { animate } = useAmbientMotion();
  const [burn] = useState(() => new Animated.Value(1));
  const flying = !preparing && !enginesDisabled;
  useEffect(() => {
    burn.setValue(1);
    if (!animate || (!flying && !selected)) return;
    const timing = (toValue: number, duration: number) => Animated.timing(burn, {
      toValue, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver, isInteraction: false,
    });
    const pulse = Animated.loop(Animated.sequence([timing(0, 620), timing(1, 840)]));
    pulse.start();
    return () => pulse.stop();
  }, [animate, flying, selected, burn]);
  return <View pointerEvents="none" accessible={false} aria-hidden style={styles.marker}>
    {selected && <Animated.View testID="ship-selection-beacon" style={[styles.beacon, {
      borderColor: color,
      opacity: burn.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.35] }),
      transform: [{ scale: burn.interpolate({ inputRange: [0, 1], outputRange: [1.18, 1] }) }],
    }]} />}
    <Svg testID="ship-marker" width={44} height={44} viewBox="0 0 44 44" style={styles.ship} accessible={false}>
      {selected && <Circle testID="ship-selection" cx={22} cy={22} r={20} fill="none" stroke="#e5f3f4" strokeWidth={1.3} />}
      {preparing && <Circle testID="ship-docked" cx={22} cy={22} r={17} fill="none" stroke={color} strokeOpacity={0.6} strokeDasharray="2 4" />}
      <G testID="ship-hull" transform={`rotate(${heading} 22 22)`}>
        <G stroke="#243b46" strokeWidth={0.8} strokeLinejoin="miter">
          <Path d="M10 18 L27 18 L39 22 L27 26 L10 26 L13 22 Z" fill="#a5b5bb" />
          <Path d="M12 13 L24 13 L28 16 L25 18 L12 18 Z M12 26 L25 26 L28 28 L24 31 L12 31 Z" fill="#627984" />
          <Path d="M15 19 L27 19 L34 22 L27 25 L15 25 Z" fill="#344b56" />
        </G>
        <Path d="M14 14 L23 14 M14 30 L23 30" fill="none" stroke={color} strokeWidth={1.5} />
        <Path d="M28 20 L34 22 L28 24 Z" fill="#ccd8db" />
        <Path d="M17 19 L17 25 M21 19 L21 25 M25 19 L25 25" fill="none" stroke="#8c9fa8" strokeWidth={0.7} />
        <Line x1={12} y1={20} x2={12} y2={24} stroke={color} strokeWidth={1.5} />
      </G>
      {enginesDisabled && <G testID="ship-disabled" stroke="#efbe79" strokeWidth={1.5} strokeLinecap="round">
        <Circle cx={36} cy={8} r={5} fill="#17242a" strokeWidth={1} />
        <Path d="M34 6 L38 10 M38 6 L34 10" />
      </G>}
    </Svg>
    {flying && <Animated.View testID="ship-engine-glow" style={[styles.engine, {
      opacity: burn.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
    }]}>
      <Svg width={44} height={44} viewBox="0 0 44 44" accessible={false}>
        <G testID="ship-exhaust" transform={`rotate(${heading} 22 22)`}>
          <Path d="M12 14 L4 15.5 L12 17 Z M12 27 L4 28.5 L12 30 Z" fill={color} fillOpacity={0.35} />
          <Path d="M12 15 L8 15.5 L12 16 Z M12 28 L8 28.5 L12 29 Z" fill="#b8eff1" fillOpacity={0.9} />
        </G>
      </Svg>
    </Animated.View>}
    <View style={[styles.manifest, { borderColor: selected ? '#e5f3f4' : color }]}>
      <Text style={styles.count}>{drones}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  marker: { width: 44, height: 56, alignItems: 'center' },
  ship: { position: 'absolute', top: 6 },
  engine: { position: 'absolute', top: 6, width: 44, height: 44 },
  beacon: { position: 'absolute', top: 6, width: 44, height: 44, borderRadius: 22, borderWidth: 2 },
  manifest: { position: 'absolute', top: 40, minWidth: 24, height: 16, paddingHorizontal: 4, borderRadius: 2, borderWidth: 1, backgroundColor: '#0b1820', alignItems: 'center', justifyContent: 'center' },
  count: { color: '#e2eff0', fontSize: 12, lineHeight: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
