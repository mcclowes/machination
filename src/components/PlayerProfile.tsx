import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PLAYER_COLORS, PLAYER_COLOR_IDS } from '../game/player-colors';
import { CHARACTERS, CHARACTER_IDS } from '../game/characters';
import { PlayerAvatar } from './PlayerIdentity';
import { ProfileFaction } from './ProfileFaction';
import { loadProfile, saveProfile, type PlayerProfile as Profile } from '../solo/profile';

export function PlayerProfile() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>({});
  const preferred = profile.preferredColor;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadProfile().then(profile => { if (active) { setProfile(profile); setReady(true); } }).catch(() => { if (active) setError('Could not load your profile.'); });
    return () => { active = false; };
  }, [open]);
  async function choose(change: Partial<Profile>) {
    setBusy(true);
    try { const next = { ...profile, ...change }; await saveProfile(next); setProfile(next); setError(''); }
    catch { setError('Could not save your profile. Try again.'); }
    finally { setBusy(false); }
  }
  return <>
    <Pressable accessibilityRole="button" onPress={() => { setReady(false); setOpen(true); }} style={s.button}><View style={s.identity}><PlayerAvatar faction="you" character={profile.portrait ?? 'admiral'} size={36} /><Text style={s.text}>Player profile</Text></View></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={s.backdrop}><ScrollView contentContainerStyle={s.panel}>
        <Text accessibilityRole="header" style={s.heading}>Player profile</Text>
        <Text style={s.text}>Profile picture</Text>
        <PlayerAvatar faction="you" character={profile.portrait ?? 'admiral'} size={80} />
        <Text style={s.detail}>Choose a commander portrait for your profile. Picture and color preferences are saved on this device.</Text>
        <View style={s.colors}>{[undefined, ...CHARACTER_IDS].map(portrait => <Pressable key={portrait ?? 'automatic'} accessibilityRole="radio" accessibilityLabel={portrait ? `${CHARACTERS[portrait].label} profile picture` : 'Automatic profile picture'} aria-checked={profile.portrait === portrait} aria-disabled={!ready || busy} accessibilityState={{ checked: profile.portrait === portrait, disabled: !ready || busy }} disabled={!ready || busy} onPress={() => void choose({ portrait })} style={[s.choice, profile.portrait === portrait && s.selected]}>
          {portrait && <PlayerAvatar faction="you" character={portrait} size={44} />}
          <Text style={s.text}>{portrait ? CHARACTERS[portrait].label : 'Automatic'}</Text>
        </Pressable>)}</View>
        <Text style={s.text}>Preferred color</Text>
        <Text style={s.detail}>Used for new solo operations. Multiplayer uses your color when it’s available. Changes apply to future operations and are saved on this device.</Text>
        <View style={s.colors}>{[undefined, ...PLAYER_COLOR_IDS].map(color => <Pressable key={color ?? 'automatic'} accessibilityRole="radio" accessibilityLabel={color ? `${color} player color` : 'Automatic player color'} aria-checked={preferred === color} aria-disabled={!ready || busy} accessibilityState={{ checked: preferred === color, disabled: !ready || busy }} disabled={!ready || busy} onPress={() => void choose({ preferredColor: color })} style={[s.choice, preferred === color && s.selected]}>
          {color && <View style={[s.swatch, { backgroundColor: PLAYER_COLORS[color].color }]} />}
          <Text style={s.text}>{color ? color[0]!.toUpperCase() + color.slice(1) : 'Automatic'}</Text>
        </Pressable>)}</View>
        {open && <ProfileFaction />}
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Close player profile" onPress={() => setOpen(false)} style={s.button}><Text style={s.text}>Done</Text></Pressable>
      </ScrollView></View>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  button: { minHeight: 44, padding: 13, borderWidth: 1, borderColor: '#30442b', alignItems: 'center' },
  text: { color: '#e5eadc', fontSize: 14 }, detail: { color: '#b8c5b5', fontSize: 13, lineHeight: 20 },
  heading: { color: '#e5eadc', fontSize: 24 }, backdrop: { flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: 24 },
  panel: { backgroundColor: '#101b21', padding: 20, gap: 16, width: '100%', maxWidth: 520, alignSelf: 'center' },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 48, padding: 10, gap: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#30454c' },
  selected: { borderColor: '#b8e986' }, swatch: { width: 24, height: 24, borderRadius: 12 }, error: { color: '#ffbb91' },
});
