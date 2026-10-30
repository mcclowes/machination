/**
 * ---
 * purpose: Relative time roller with a fixed needle, moving ribs, and shared touch, mouse, and keyboard input.
 * ---
 */
import React, { useId, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop } from 'react-native-svg';
import { MAX_PLAN_DELAY } from '../game/orders';
import { relativeInspectionTime } from '../game/time-machine';

type Props = { hour: number; inspectedHour: number | null; historyStart?: number; events: readonly number[]; onChange: (hour: number | null) => void };
const PIXELS_PER_HOUR = 28;
const HEIGHT = 52;

export function TimeWheel({ hour, inspectedHour, historyStart, events, onChange }: Props) {
  const [width, setWidth] = useState(320);
  const id = useId().replaceAll(':', '');
  const selected = inspectedHour ?? hour;
  const start = Math.min(hour, historyStart ?? hour);
  const latest = useRef({ hour, start, selected, onChange });
  latest.current = { hour, start, selected, onChange };
  const origin = useRef(selected);
  function inspect(target: number) {
    const current = latest.current;
    const offset = Math.round((target - current.hour) * 60) / 60;
    const next = Math.max(current.start, Math.min(current.hour + MAX_PLAN_DELAY, current.hour + offset));
    current.selected = next;
    current.onChange(next === current.hour ? null : next);
  }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => { origin.current = latest.current.selected; },
    onPanResponderMove: (_event, gesture) => inspect(origin.current - gesture.dx / PIXELS_PER_HOUR),
    onPanResponderTerminationRequest: () => false,
  })).current;
  const webInput = {
    onWheel: (event: { nativeEvent: { deltaX: number; deltaY: number; deltaMode: number } }) => {
      const { deltaX, deltaY, deltaMode } = event.nativeEvent;
      const pixels = (Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY) * (deltaMode === 1 ? 16 : deltaMode === 2 ? width : 1);
      inspect(latest.current.selected + pixels / PIXELS_PER_HOUR);
    },
    onKeyDown: (event: { nativeEvent: { key: string; shiftKey: boolean }; preventDefault: () => void }) => {
      const { key, shiftKey } = event.nativeEvent;
      const step = shiftKey ? 1 : 1 / 60;
      const current = latest.current;
      const target = key === 'ArrowRight' || key === 'ArrowUp' ? current.selected + step
        : key === 'ArrowLeft' || key === 'ArrowDown' ? current.selected - step
        : key === 'Home' ? current.hour : key === 'End' ? current.hour + MAX_PLAN_DELAY : undefined;
      if (target === undefined) return;
      event.preventDefault();
      inspect(target);
    },
  };
  const halfSpan = width / PIXELS_PER_HOUR / 2;
  const firstRib = Math.ceil(Math.max(start, selected - halfSpan) * 2);
  const lastRib = Math.floor(Math.min(hour + MAX_PLAN_DELAY, selected + halfSpan) * 2);
  const x = (at: number) => width / 2 + (at - selected) * PIXELS_PER_HOUR;
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)} {...pan.panHandlers} {...webInput}
    accessible focusable accessibilityRole="adjustable" accessibilityLabel="Operation timeline"
    accessibilityHint="Drag left for the future and right for history. Arrow keys move one minute; Shift moves one hour. Home returns to now."
    accessibilityValue={{ min: Math.round((start - hour) * 60), max: MAX_PLAN_DELAY * 60, now: Math.round((selected - hour) * 60), text: selected === hour ? 'Live time' : relativeInspectionTime(hour, selected) }}
    accessibilityActions={[{ name: 'increment', label: 'One hour later' }, { name: 'decrement', label: 'One hour earlier' }]}
    onAccessibilityAction={event => {
      if (event.nativeEvent.actionName === 'increment') inspect(latest.current.selected + 1);
      if (event.nativeEvent.actionName === 'decrement') inspect(latest.current.selected - 1);
    }} style={s.wheel}>
    <Svg width="100%" height={HEIGHT} pointerEvents="none" aria-hidden>
      <Defs>
        <LinearGradient id={`${id}rim`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#59666a" /><Stop offset="0.45" stopColor="#273339" /><Stop offset="1" stopColor="#6a7779" /></LinearGradient>
        <LinearGradient id={`${id}roller`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#060b0e" /><Stop offset="0.3" stopColor="#2b373c" /><Stop offset="0.55" stopColor="#354147" /><Stop offset="1" stopColor="#070e12" /></LinearGradient>
        <LinearGradient id={`${id}shade`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#030709" /><Stop offset="0.2" stopColor="#030709" stopOpacity="0" /><Stop offset="0.8" stopColor="#030709" stopOpacity="0" /><Stop offset="1" stopColor="#030709" /></LinearGradient>
      </Defs>
      <Rect x="0.5" y="1.5" width={Math.max(0, width - 1)} height="49" rx="17" fill={`url(#${id}rim)`} stroke="#080f13" />
      <Rect x="4" y="5" width={Math.max(0, width - 8)} height="42" rx="13" fill={`url(#${id}roller)`} stroke="#080d10" strokeWidth="2" />
      {Array.from({ length: Math.max(0, lastRib - firstRib + 1) }, (_, index) => {
        const rib = firstRib + index;
        const at = rib / 2;
        const left = x(at);
        if (left < 14 || left > width - 14) return null;
        return <React.Fragment key={rib}>
          <Rect x={left - 2} y={rib % 2 ? 13 : 10} width="4" height={rib % 2 ? 26 : 32} rx="2" fill="#0a1115" />
          <Line x1={left + 2} y1="13" x2={left + 2} y2="39" stroke="#637075" strokeOpacity="0.55" />
        </React.Fragment>;
      })}
      {events.filter(at => Math.abs(at - selected) < halfSpan - 0.5).map(at => <Circle key={at} cx={x(at)} cy="14" r="2" fill="#d3b77b" />)}
      {Math.abs(hour - selected) < halfSpan - 0.5 && <Line x1={x(hour)} y1="10" x2={x(hour)} y2="42" stroke="#b8e986" strokeWidth="3" />}
      <Rect x="5" y="6" width={Math.max(0, width - 10)} height="40" rx="12" fill={`url(#${id}shade)`} />
      <Path d={`M${width / 2 - 4} 2 L${width / 2 + 4} 2 L${width / 2} 8 Z`} fill="#e5eadc" />
      <Line x1={width / 2} y1="11" x2={width / 2} y2="41" stroke="#e5eadc" strokeWidth="2" />
      <Path d={`M${width / 2 - 4} 50 L${width / 2 + 4} 50 L${width / 2} 44 Z`} fill="#e5eadc" />
    </Svg>
  </View>;
}

const s = StyleSheet.create({ wheel: { height: HEIGHT, width: '100%', cursor: 'pointer', userSelect: 'none' } });
