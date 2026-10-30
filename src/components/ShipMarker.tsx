/**
 * ---
 * purpose: Directional industrial hauler silhouette with upright drone counts and visible flight states.
 * ---
 */
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
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
    <Svg testID="ship-marker" width={32} height={32} viewBox="0 0 44 44" style={styles.ship} accessible={false}>
      {selected && <Circle testID="ship-selection" cx={22} cy={22} r={20} fill="none" stroke="#e5f3f4" strokeWidth={1.3} />}
      {preparing && <Circle testID="ship-docked" cx={22} cy={22} r={17} fill="none" stroke={color} strokeOpacity={0.6} strokeDasharray="2 4" />}
      <G testID="ship-hull" transform={`rotate(${heading} 22 22)`}>
        <G stroke="#243b46" strokeWidth={0.9} strokeLinejoin="round">
          <Rect x={10} y={10} width={17} height={6} rx={1} fill="#627984" />
          <Rect x={10} y={28} width={17} height={6} rx={1} fill="#627984" />
          <Rect x={9} y={14} width={25} height={16} rx={1.5} fill="#a5b5bb" />
          <Rect x={13} y={16} width={17} height={12} rx={0.5} fill="#344b56" />
          <Path d="M34 18 H38 V26 H34 Z" fill="#ccd8db" />
          <Rect x={7} y={12} width={5} height={5} rx={0.7} fill="#344b56" />
          <Rect x={7} y={27} width={5} height={5} rx={0.7} fill="#344b56" />
        </G>
        <Path d="M14 11.5 H25 M14 32.5 H25 M35.5 20 V24" fill="none" stroke={color} strokeWidth={1.5} />
        <Rect x={19} y={18} width={5} height={8} fill={color} fillOpacity={0.8} />
        <Path d="M15 17 V27 M28 17 V27 M10 19 V25" fill="none" stroke="#8c9fa8" strokeWidth={0.8} />
        <Path d="M8 13.5 V15.5 M8 28.5 V30.5" stroke={color} strokeWidth={1.5} />
      </G>
      {enginesDisabled && <G testID="ship-disabled" stroke="#efbe79" strokeWidth={1.5} strokeLinecap="round">
        <Circle cx={36} cy={8} r={5} fill="#17242a" strokeWidth={1} />
        <Path d="M34 6 L38 10 M38 6 L34 10" />
      </G>}
    </Svg>
    {flying && <Animated.View testID="ship-engine-glow" style={[styles.engine, {
      opacity: burn.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
    }]}>
      <Svg width={32} height={32} viewBox="0 0 44 44" accessible={false}>
        <G testID="ship-exhaust" transform={`rotate(${heading} 22 22)`}>
          <Path d="M7 12 L0 14.5 L7 17 Z M7 27 L0 29.5 L7 32 Z" fill={color} fillOpacity={0.35} />
          <Path d="M7 13.5 L3 14.5 L7 15.5 Z M7 28.5 L3 29.5 L7 30.5 Z" fill="#b8eff1" fillOpacity={0.9} />
        </G>
      </Svg>
    </Animated.View>}
    <View style={styles.manifest}>
      <Text style={styles.count}>{drones}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  marker: { width: 44, height: 56, alignItems: 'center' },
  ship: { position: 'absolute', top: 12 },
  engine: { position: 'absolute', top: 12, width: 32, height: 32 },
  beacon: { position: 'absolute', top: 12, width: 32, height: 32, borderRadius: 16, borderWidth: 2 },
  manifest: { position: 'absolute', top: 40, minWidth: 24, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  count: { color: '#e2eff0', fontSize: 12, lineHeight: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
