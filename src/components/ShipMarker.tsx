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
      <Circle cx={22} cy={22} r={20} fill="#0b1820" fillOpacity={0.8} />
      {selected && <Circle testID="ship-selection" cx={22} cy={22} r={20} fill="none" stroke="#e5f3f4" strokeWidth={1.3} />}
      {preparing && <Circle testID="ship-docked" cx={22} cy={22} r={17} fill="none" stroke={color} strokeOpacity={0.6} strokeDasharray="2 4" />}
      <G testID="ship-hull" transform={`rotate(${heading} 22 22)`}>
        <G stroke="#07131b" strokeWidth={1.4} strokeLinejoin="round">
          <Path d="M12 17 L21 14 L29 17 L38 22 L29 27 L21 30 L12 27 L15 22 Z" fill={color} />
          <Path d="M10 10 L22 10 L27 14 L22 16 L10 16 Z M10 28 L22 28 L27 30 L22 34 L10 34 Z" fill={color} />
        </G>
        <Path d="M17 18 L24 17 L28 20 L28 24 L24 27 L17 26 Z" fill="#102731" fillOpacity={0.65} />
        <Path d="M29 19 L34 22 L29 25 Z" fill="#e2f5ef" />
        <Path d="M13 12 L21 12 M13 30 L21 30" fill="none" stroke="#e2f5ef" strokeOpacity={0.55} strokeWidth={1} />
        <Line x1={19} y1={19} x2={19} y2={25} stroke={color} strokeWidth={1} />
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
          <Path d="M11 11 L1 13 L11 15 Z M11 29 L1 31 L11 33 Z" fill={color} fillOpacity={0.35} />
          <Path d="M11 12 L5 13 L11 14 Z M11 30 L5 31 L11 32 Z" fill="#b8eff1" fillOpacity={0.9} />
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
  manifest: { position: 'absolute', top: 40, minWidth: 24, height: 16, paddingHorizontal: 4, borderRadius: 8, borderWidth: 1, backgroundColor: '#0b1820', alignItems: 'center', justifyContent: 'center' },
  count: { color: '#e2eff0', fontSize: 12, lineHeight: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
