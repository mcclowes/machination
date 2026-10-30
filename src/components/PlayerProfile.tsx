import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PLAYER_COLORS, PLAYER_COLOR_IDS, type PlayerColor } from '../game/player-colors';
import { loadProfile, saveProfile } from '../solo/profile';

export function PlayerProfile() {
  const [open, setOpen] = useState(false);
  const [preferred, setPreferred] = useState<PlayerColor>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadProfile().then(profile => { if (active) { setPreferred(profile.preferredColor); setReady(true); } }).catch(() => { if (active) setError('Could not load your profile.'); });
    return () => { active = false; };
  }, [open]);
  async function choose(color?: PlayerColor) {
    setBusy(true);
    try { await saveProfile({ preferredColor: color }); setPreferred(color); setError(''); }
    catch { setError('Could not save your color. Try again.'); }
    finally { setBusy(false); }
  }
  return <>
    <Pressable accessibilityRole="button" onPress={() => { setReady(false); setOpen(true); }} style={s.button}><Text style={s.text}>Player profile</Text></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={s.backdrop}><ScrollView contentContainerStyle={s.panel}>
        <Text accessibilityRole="header" style={s.heading}>Player profile</Text>
        <Text style={s.text}>Preferred color</Text>
        <Text style={s.detail}>Used for new solo operations. Multiplayer uses your color when it’s available. Changes apply to future operations and are saved on this device.</Text>
        <View style={s.colors}>{[undefined, ...PLAYER_COLOR_IDS].map(color => <Pressable key={color ?? 'automatic'} accessibilityRole="radio" accessibilityLabel={color ? `${color} player color` : 'Automatic player color'} accessibilityState={{ checked: preferred === color, disabled: !ready || busy }} disabled={!ready || busy} onPress={() => void choose(color)} style={[s.choice, preferred === color && s.selected]}>
          {color && <View style={[s.swatch, { backgroundColor: PLAYER_COLORS[color].color }]} />}
          <Text style={s.text}>{color ? color[0]!.toUpperCase() + color.slice(1) : 'Automatic'}</Text>
        </Pressable>)}</View>
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Close player profile" onPress={() => setOpen(false)} style={s.button}><Text style={s.text}>Done</Text></Pressable>
      </ScrollView></View>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  button: { minHeight: 44, padding: 13, borderWidth: 1, borderColor: '#30442b', alignItems: 'center' },
  text: { color: '#e5eadc', fontSize: 14 }, detail: { color: '#b8c5b5', fontSize: 13, lineHeight: 20 },
  heading: { color: '#e5eadc', fontSize: 24 }, backdrop: { flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: 24 },
  panel: { backgroundColor: '#101b21', padding: 20, gap: 16, width: '100%', maxWidth: 520, alignSelf: 'center' },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 48, padding: 10, gap: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#30454c' },
  selected: { borderColor: '#b8e986' }, swatch: { width: 24, height: 24, borderRadius: 12 }, error: { color: '#ffbb91' },
});
