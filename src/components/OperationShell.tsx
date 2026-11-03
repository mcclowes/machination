/**
 * ---
 * purpose: Persistent chart, contextual drawers, and operation navigation on phone and desktop.
 * ---
 */

import type { PlayerColor } from '../game/player-colors';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Pressable } from './Pressable';
import type { Faction } from '../game/players';
import { PlayerRoster } from './PlayerIdentity';
import type { CharacterId } from '../game/characters';
import { nativeDriver, useAmbientMotion } from './use-ambient-motion';
import { AppChromeContext } from './app-chrome';

export type OperationSection = 'asset' | 'orders' | 'units' | 'signals' | 'intel' | 'settings';
type Panel = { title: string; content: React.ReactNode; footer?: React.ReactNode };
type Props = {
  chart: React.ReactNode; timeline: React.ReactNode; status: React.ReactNode;
  player?: Faction;
  portraits?: readonly CharacterId[];
  colors?: readonly PlayerColor[];
  section: OperationSection | null; onSection: (section: OperationSection | null) => void;
  panels: Record<OperationSection, Panel>; hint?: React.ReactNode;
  panelScrollRef?: React.RefObject<ScrollView | null>; onPanelResize?: () => void;
};
const navigation = [
  [null, 'Chart', '◎'], ['orders', 'Orders', '↗'], ['units', 'Specialists', '◈'],
  ['signals', 'Signals', '≋'], ['intel', 'Intel', '▥'], ['settings', 'Setup', '⋯'],
] as const;
const COMPACT_OPERATION_HEIGHT = 400;
const COMPACT_SIDEBAR_WIDTH = 640;
const MIN_SHEET_HEIGHT = 148;
const MIN_DRAWER_BODY_HEIGHT = 96;
const PANEL_CONTENT_PADDING = 14;

export function OperationShell({ chart, timeline, status, player = 'you', portraits, colors, section, onSection, panels, hint, panelScrollRef, onPanelResize }: Props) {
  const { width, height, fontScale } = useWindowDimensions();
  const shellRef = useRef<View>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [availableHeight, setAvailableHeight] = useState<number>();
  const [stageHeight, setStageHeight] = useState<number>();
  const [headingHeight, setHeadingHeight] = useState(44);
  const [footerHeight, setFooterHeight] = useState<number>();
  const compact = (availableHeight ?? height) < COMPACT_OPERATION_HEIGHT;
  const enlarged = fontScale > 1;
  const wide = width >= 1000 || (compact && width >= COMPACT_SIDEBAR_WIDTH);
  const sheetHeight = stageHeight === undefined ? undefined : enlarged ? stageHeight : Math.min(stageHeight, Math.max(MIN_SHEET_HEIGHT, stageHeight * (section === 'intel' ? 0.9 : 0.55)));
  const panel = section && panels[section];
  const hideTimeline = (compact || enlarged) && !!panel;
  const drawerHeight = wide ? stageHeight : sheetHeight;
  const scrollFooter = compact || footerHeight === undefined || drawerHeight === undefined || Math.max(0, drawerHeight - headingHeight - footerHeight) < MIN_DRAWER_BODY_HEIGHT;
  const footer = panel && panel.footer && <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={[s.footer, scrollFooter && s.scrolledFooter]}>{panel.footer}</View>;
  const { animate } = useAmbientMotion();
  const chrome = useContext(AppChromeContext);
  const { claim } = chrome;
  useEffect(() => claim(), [claim]);
  const [entrance] = useState(() => new Animated.Value(1));
  useEffect(() => {
    entrance.setValue(1);
    if (!animate || !section) return;
    entrance.setValue(0);
    const reveal = Animated.timing(entrance, {
      toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver, isInteraction: false,
    });
    reveal.start();
    return () => reveal.stop();
  }, [animate, section, wide, entrance]);
  const sheet = useSheetGesture(!wide && !!panel, animate, onSection, section);
  const navigationBar = <View accessibilityRole="tablist" style={[s.navigation, enlarged && s.enlargedNavigation]}>{navigation.map(([key, label, glyph]) => {
      const selected = key === null ? section === null || section === 'asset' : section === key;
      return <Pressable key={label} accessibilityRole={Platform.OS === 'ios' ? 'button' : 'tab'} accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => onSection(key)} style={({ pressed }) => [s.tab, enlarged && s.enlargedTab, selected && s.selected, pressed && s.pressed, pressed && animate && s.pressScale]}><Text style={[s.glyph, selected && s.active]}>{glyph}</Text><Text style={[s.label, selected && s.active]}>{label}</Text></Pressable>;
    })}</View>;
  return <PlayerRoster portraits={portraits} colors={colors}><View ref={shellRef} style={s.shell} onLayout={() => {
    if (Platform.OS === 'ios') shellRef.current?.measureInWindow((_x, y) => setKeyboardOffset(y));
  }}><KeyboardAvoidingView style={s.shell} keyboardVerticalOffset={keyboardOffset} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={s.shell} onLayout={event => setAvailableHeight(event.nativeEvent.layout.height)}>
    {!!status && <View style={s.status}><ScrollView style={s.statusContent} contentContainerStyle={s.statusBody} keyboardShouldPersistTaps="handled">{status}</ScrollView></View>}
    <View style={[s.stage, compact && !!panel && s.compactStage, wide && s.wide]} onLayout={event => setStageHeight(event.nativeEvent.layout.height)}>
      <View style={s.chart}>{chart}{!!hint && <View pointerEvents="box-none" style={s.hint}>{hint}</View>}</View>
      {panel && <Animated.View testID="operation-drawer" style={[s.drawer, wide ? [s.sidebar, compact && { width: Math.min(370, width * 0.48) }] : [s.sheet, section === 'intel' && s.intelSheet, sheetHeight !== undefined && { maxHeight: sheetHeight }], {
        opacity: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
        transform: [wide
          ? { translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }
          : { translateY: Animated.add(entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }), sheet.offset) }],
      }, !wide && sheet.expanded && s.expandedSheet]}>
        <View {...(wide ? {} : sheet.handlers)} onLayout={event => setHeadingHeight(event.nativeEvent.layout.height)}>
          {!wide && <Pressable testID="operation-drawer-grip" accessibilityRole="button" accessibilityLabel={`${sheet.expanded ? 'Collapse' : 'Expand'} ${panel.title}`} accessibilityHint="Drag down to close" onPress={sheet.toggle} hitSlop={8} style={s.grip}><View style={s.gripBar} /></Pressable>}
          <View style={[s.heading, !wide && s.sheetHeading]}><Text accessibilityRole="header" style={s.title}>{panel.title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Close ${panel.title}`} onPress={() => onSection(null)} style={({ pressed }) => [s.close, pressed && s.pressed, pressed && animate && s.pressScale]}><Text style={s.text}>×</Text></Pressable></View>
        </View>
        <ScrollView key={section} ref={panelScrollRef} automaticallyAdjustKeyboardInsets={!enlarged} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" onContentSizeChange={onPanelResize} contentContainerStyle={s.content}>
          {section === 'settings' && chrome.exits.length > 0 && <View style={s.chrome}>
            {chrome.exits.map(exit => <Pressable key={exit.label} accessibilityRole="button" accessibilityLabel={exit.label} onPress={exit.onPress} style={({ pressed }) => [s.exit, pressed && s.pressed]}><Text style={s.exitText}>{exit.label}</Text></Pressable>)}
            <View style={{ flex: 1 }} />{chrome.tools}
          </View>}
          {panel.content}{scrollFooter && footer}
        </ScrollView>
        {!scrollFooter && footer}
      </Animated.View>}
    </View>
    <ScrollView style={[s.timeline, hideTimeline && s.hiddenTimeline]} accessibilityElementsHidden={hideTimeline} importantForAccessibility={hideTimeline ? 'no-hide-descendants' : 'auto'} contentContainerStyle={{ flexGrow: 1 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">{timeline}</ScrollView>
    {enlarged ? <ScrollView testID="operation-navigation" horizontal style={s.navigationScroll} contentContainerStyle={s.navigationContent} keyboardShouldPersistTaps="handled">{navigationBar}</ScrollView> : navigationBar}
    </View>
  </KeyboardAvoidingView></View></PlayerRoster>;
}
const DISMISS_DISTANCE = 90, EXPAND_DISTANCE = 40, FLICK_VELOCITY = 0.9;
type SheetTouch = { nativeEvent: { pageX: number; pageY: number; timestamp?: number } };

/** Phone drawers behave as sheets: drag the grip up to expand, down to collapse or close. */
function useSheetGesture(enabled: boolean, animate: boolean, onSection: (section: OperationSection | null) => void, section: OperationSection | null) {
  const [expanded, setExpanded] = useState(false);
  const [offset] = useState(() => new Animated.Value(0));
  const state = useRef({ expanded, animate, onSection });
  state.current = { expanded, animate, onSection };
  const motion = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => () => motion.current?.stop(), []);
  useEffect(() => { motion.current?.stop(); offset.setValue(0); if (!section) setExpanded(false); }, [section, offset]);
  const handlers = useMemo(() => {
    const run = (next: Animated.CompositeAnimation, done?: () => void) => {
      motion.current?.stop();
      motion.current = next;
      next.start(({ finished }) => { if (motion.current === next) motion.current = null; if (finished) done?.(); });
    };
    const settle = () => state.current.animate
      ? run(Animated.spring(offset, { toValue: 0, speed: 22, bounciness: 4, useNativeDriver: nativeDriver }))
      : offset.setValue(0);
    // Built on View responder props so the sheet needs no gesture library.
    const track = { x: 0, y: 0, lastY: 0, lastT: 0, vy: 0 };
    const at = (e: SheetTouch) => e.nativeEvent.timestamp ?? Date.now();
    const claims = (e: SheetTouch) => {
      if (!enabled) return false;
      const dx = e.nativeEvent.pageX - track.x, dy = e.nativeEvent.pageY - track.y;
      return Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx);
    };
    return {
      onStartShouldSetResponderCapture: (e: SheetTouch) => {
        Object.assign(track, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, lastY: e.nativeEvent.pageY, lastT: at(e), vy: 0 });
        return false;
      },
      onMoveShouldSetResponderCapture: claims,
      onMoveShouldSetResponder: claims,
      onResponderTerminationRequest: () => false,
      onResponderGrant: () => motion.current?.stop(),
      onResponderMove: (e: SheetTouch) => {
        const y = e.nativeEvent.pageY, t = at(e);
        if (t > track.lastT) track.vy = (y - track.lastY) / (t - track.lastT);
        track.lastY = y; track.lastT = t;
        const dy = y - track.y;
        // Upward travel meets resistance so the sheet never detaches from the bottom edge.
        offset.setValue(dy > 0 ? dy : dy / 4);
      },
      onResponderRelease: (e: SheetTouch) => {
        const dy = e.nativeEvent.pageY - track.y;
        const vy = at(e) - track.lastT > 100 ? 0 : track.vy;
        const { expanded: open, animate: moving, onSection: choose } = state.current;
        if (dy > DISMISS_DISTANCE || vy > FLICK_VELOCITY) {
          if (open) { setExpanded(false); settle(); return; }
          if (!moving) { choose(null); return; }
          run(Animated.timing(offset, { toValue: 480, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver, isInteraction: false }), () => choose(null));
          return;
        }
        if (dy < -EXPAND_DISTANCE || vy < -FLICK_VELOCITY) setExpanded(true);
        settle();
      },
      onResponderTerminate: settle,
    };
  }, [enabled, offset]);
  return { expanded, offset, handlers, toggle: () => setExpanded(open => !open) };
}

const s = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, backgroundColor: '#101b21' }, status: { maxHeight: '35%', flexShrink: 1, paddingHorizontal: 14, paddingVertical: 4, borderBottomWidth: 1, borderColor: '#23363e', gap: 12, flexDirection: 'row', alignItems: 'center' }, statusContent: { flex: 1, minWidth: 0 }, statusBody: { gap: 6 },
  stage: { flex: 1, minHeight: 120, overflow: 'hidden' }, compactStage: { minHeight: 0 }, wide: { flexDirection: 'row' }, chart: { flex: 1, minWidth: 0 },
  drawer: { backgroundColor: '#14232b', borderTopWidth: 1, borderColor: '#30454c', minHeight: 0, overflow: 'hidden' }, sidebar: { width: 370 }, sheet: { maxHeight: '55%', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  intelSheet: { maxHeight: '90%' }, expandedSheet: { minHeight: '70%', maxHeight: '92%' },
  grip: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 2 }, gripBar: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#4a6168' },
  sheetHeading: { borderTopWidth: 0 },
  footer: { paddingVertical: 12, paddingHorizontal: PANEL_CONTENT_PADDING, borderTopWidth: 1, borderColor: '#30454c', backgroundColor: '#14232b' }, scrolledFooter: { marginHorizontal: -PANEL_CONTENT_PADDING },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, borderBottomWidth: 1, borderColor: '#23363e' }, title: { flex: 1, color: '#e5eadc', fontSize: 15 }, close: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, text: { color: '#b8e986', fontSize: 22 }, content: { padding: PANEL_CONTENT_PADDING, gap: 14, paddingBottom: 24 },
  timeline: { maxHeight: '42%', flexGrow: 0, flexShrink: 1 }, hiddenTimeline: { display: 'none' },
  navigation: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#23363e', backgroundColor: '#101b21' }, tab: { flex: 1, minWidth: 44, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 3, borderTopWidth: 2, borderTopColor: 'transparent' }, selected: { borderTopColor: '#b8e986', backgroundColor: 'transparent' }, glyph: { color: '#8c9f85', fontSize: 17 }, label: { color: '#8c9f85', fontSize: 10 }, active: { color: '#b8e986' },
  navigationScroll: { flexGrow: 0, flexShrink: 0 }, navigationContent: { flexGrow: 1 }, enlargedNavigation: { flexGrow: 1 }, enlargedTab: { flex: 0, flexShrink: 0, paddingHorizontal: 18 },
  hint: { position: 'absolute', top: 8, left: 10, right: 112, padding: 10, backgroundColor: '#18291f', borderWidth: 1, borderColor: '#405b36', borderRadius: 10 },
  chrome: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: -6, paddingBottom: 8, borderBottomWidth: 1, borderColor: '#23363e' },
  exit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }, exitText: { color: '#b4c7ca', fontSize: 14 },
  pressed: { backgroundColor: '#24383c' }, pressScale: { transform: [{ scale: 0.96 }] },
});
