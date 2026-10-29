/** One original silhouette per specialist role at chart and roster sizes. */
import React from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { SpecialistKind } from '../game/specialist-catalog';
import { CAPTIVE_LOCK, CAPTIVE_LOCK_HEIGHT, CAPTIVE_LOCK_STROKE, CAPTIVE_LOCK_WIDTH, INSIGNIA_BACKGROUND, INSIGNIA_COLOR, INSIGNIA_STROKE, INSIGNIA_VIEWBOX, SPECIALIST_INSIGNIA, type Insignia } from './specialist-insignia';

export function SpecialistIcon({ kind, size = 36, color = INSIGNIA_COLOR }: { kind: SpecialistKind; size?: number; color?: string }) {
  return <Drawing icon={SPECIALIST_INSIGNIA[kind]} width={size} height={size} viewBox={`0 0 ${INSIGNIA_VIEWBOX} ${INSIGNIA_VIEWBOX}`} stroke={INSIGNIA_STROKE} color={color} />;
}
export function CaptiveLock() {
  return <Drawing icon={CAPTIVE_LOCK} width={CAPTIVE_LOCK_WIDTH} height={CAPTIVE_LOCK_HEIGHT} viewBox={`0 0 ${CAPTIVE_LOCK_WIDTH} ${CAPTIVE_LOCK_HEIGHT}`} stroke={CAPTIVE_LOCK_STROKE} color={INSIGNIA_COLOR} background={INSIGNIA_BACKGROUND} />;
}
function Drawing({ icon, width, height, viewBox, stroke, color, background }: { icon: Insignia; width: number; height: number; viewBox: string; stroke: number; color: string; background?: string }) {
  return <Svg {...(Platform.OS === 'web' ? { 'aria-hidden': true } : { accessible: false })} focusable={false} width={width} height={height} viewBox={viewBox} style={{ flexShrink: 0 }} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    {background && <Path d={`M0 0H${width}V${height}H0Z`} fill={background} stroke="none" />}
    {icon.outline.map((d, i) => <Path key={`outline-${i}`} d={d} />)}
    {icon.solid?.map((d, i) => <Path key={`solid-${i}`} d={d} fill={color} stroke="none" />)}
    {icon.circles?.map((circle, i) => <Circle key={`circle-${i}`} cx={circle.x} cy={circle.y} r={circle.radius} fill={circle.solid ? color : 'none'} stroke={circle.solid ? 'none' : color} />)}
  </Svg>;
}
