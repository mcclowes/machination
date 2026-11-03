import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable } from './Pressable';
import { PLAYER_COLORS, PLAYER_COLOR_IDS } from '../game/player-colors';
import { CHARACTERS, CHARACTER_IDS } from '../game/characters';
import { PlayerAvatar } from './PlayerIdentity';
import { ProfileFaction } from './ProfileFaction';
import { SoundToggle } from './SoundToggle';
import { PROFILE_NAME_MAX, loadProfile, normalizeProfileName, saveProfile, type PlayerProfile as Profile } from '../solo/profile';

const DEFAULT_PORTRAIT = 'admiral';

export function PlayerProfile() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>({});
  const [draftName, setDraftName] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  // Writes apply to the latest choice, so a name saved on blur can't drop the choice that caused the blur.
  const latest = useRef<Profile>({});
  useEffect(() => {
    let active = true;
    void loadProfile().then(loaded => { if (!active) return; latest.current = loaded; setProfile(loaded); setDraftName(loaded.name ?? ''); setReady(true); }).catch(() => { if (active) setError('Could not load your profile.'); });
    return () => { active = false; };
  }, [open]);
  async function update(change: Partial<Profile>) {
    const previous = latest.current;
    const next = { ...previous, ...change };
    latest.current = next;
    setProfile(next);
    try { await saveProfile(next); setError(''); return true; }
    catch { latest.current = previous; setProfile(previous); setError('Could not save your profile. Try again.'); return false; }
  }
  async function commitName() {
    const name = normalizeProfileName(draftName);
    setDraftName(name);
    if (!ready || name === (latest.current.name ?? '')) return true;
    const saved = await update({ name: name || undefined });
    if (!saved) setDraftName(latest.current.name ?? '');
    return saved;
  }
  async function close() { if (await commitName()) setOpen(false); }
  const portrait = profile.portrait ?? DEFAULT_PORTRAIT;
  const ring = profile.preferredColor ? PLAYER_COLORS[profile.preferredColor].color : CHARACTERS[portrait].color;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Player profile" onPress={() => { setReady(false); setError(''); setOpen(true); }} style={s.entry}>
      <PlayerAvatar faction="you" character={portrait} size={40} />
      <View style={s.entryText}>
        <Text numberOfLines={1} style={s.entryName}>{profile.name ?? 'Player profile'}</Text>
        <Text numberOfLines={1} style={s.detail}>{profile.name ? 'Player profile' : 'Set your name and preferences'}</Text>
      </View>
      <Text style={s.chevron}>›</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => void close()}>
      <SafeAreaView style={s.backdrop}>
        <View style={s.panel}>
          <Text accessibilityRole="header" style={s.heading}>Player profile</Text>
          <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <View style={s.hero}>
              <View style={[s.ring, { borderColor: ring }]}><PlayerAvatar faction="you" character={portrait} size={88} /></View>
              <View style={s.heroFields}>
                <Text style={s.label}>Name</Text>
                <TextInput accessibilityLabel="Player name" value={draftName} editable={ready} maxLength={PROFILE_NAME_MAX} placeholder="Enter a name" placeholderTextColor="#74877a" autoCapitalize="words" autoCorrect={false} returnKeyType="done" onChangeText={setDraftName} onBlur={() => void commitName()} onSubmitEditing={() => void commitName()} style={s.input} />
                <Text style={s.detail}>{CHARACTERS[portrait].label}{profile.portrait ? '' : ' (automatic)'}</Text>
              </View>
            </View>
            <Text style={s.note}>Your profile is saved on this device. Other players see your intelligence name, not this name.</Text>

            <View style={s.section}>
              <Text style={s.label}>Preferred color</Text>
              <View style={s.grid}>{[undefined, ...PLAYER_COLOR_IDS].map(color => {
                const checked = profile.preferredColor === color;
                return <Pressable key={color ?? 'automatic'} accessibilityRole="radio" accessibilityLabel={color ? `${color} player color` : 'Automatic player color'} aria-checked={checked} aria-disabled={!ready} accessibilityState={{ checked, disabled: !ready }} disabled={!ready} onPress={() => void update({ preferredColor: color })} style={[s.tile, checked && s.selected]}>
                  {color ? <View style={[s.swatch, { backgroundColor: PLAYER_COLORS[color].color }]} /> : <Text style={s.auto}>Auto</Text>}
                </Pressable>;
              })}</View>
              <Text style={s.detail}>Used for new solo operations, and in multiplayer when it’s available.</Text>
            </View>

            <View style={s.section}>
              <Text style={s.label}>Profile picture</Text>
              <View style={s.grid}>{[undefined, ...CHARACTER_IDS].map(id => {
                const checked = profile.portrait === id;
                return <Pressable key={id ?? 'automatic'} accessibilityRole="radio" accessibilityLabel={id ? `${CHARACTERS[id].label} profile picture` : 'Automatic profile picture'} aria-checked={checked} aria-disabled={!ready} accessibilityState={{ checked, disabled: !ready }} disabled={!ready} onPress={() => void update({ portrait: id })} style={[s.tile, checked && s.selected]}>
                  {id ? <PlayerAvatar faction="you" character={id} size={52} /> : <Text style={s.auto}>Auto</Text>}
                </Pressable>;
              })}</View>
            </View>

            <View style={s.section}>
              <Text style={s.label}>Settings</Text>
              <View style={s.setting}>
                <View style={s.entryText}>
                  <Text style={s.text}>Audio</Text>
                  <Text style={s.detail}>Music and control sounds</Text>
                </View>
                <SoundToggle />
              </View>
            </View>

            <View style={s.section}>{open && <ProfileFaction />}</View>
          </ScrollView>
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Close player profile" onPress={() => void close()} style={s.done}><Text style={s.doneText}>Done</Text></Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  entry: { minHeight: 60, paddingHorizontal: 12, paddingVertical: 9, gap: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#30442b', backgroundColor: '#0b140ecc' },
  entryText: { flex: 1, minWidth: 0, gap: 2 }, entryName: { color: '#e5eadc', fontSize: 15, fontWeight: '600' }, chevron: { color: '#96ad89', fontSize: 22 },
  backdrop: { flex: 1, backgroundColor: '#000c', justifyContent: 'center', padding: 12 },
  panel: { backgroundColor: '#0d171b', borderWidth: 1, borderColor: '#30454c', width: '100%', maxWidth: 560, maxHeight: '100%', alignSelf: 'center', flexShrink: 1 },
  heading: { color: '#e5eadc', fontSize: 20, padding: 16, borderBottomWidth: 1, borderColor: '#30454c' },
  scroll: { flexShrink: 1 }, body: { padding: 16, gap: 20 },
  hero: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }, ring: { borderWidth: 2, padding: 3 }, heroFields: { flex: 1, flexBasis: 180, gap: 6 },
  input: { minHeight: 44, paddingHorizontal: 12, color: '#e5eadc', fontSize: 16, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#0b140e' },
  section: { gap: 10, paddingTop: 16, borderTopWidth: 1, borderColor: '#223239' },
  label: { color: '#96ad89', fontSize: 11, letterSpacing: 1 }, text: { color: '#e5eadc', fontSize: 14 },
  detail: { color: '#a3b3a1', fontSize: 12, lineHeight: 18 }, note: { color: '#b8c5b5', fontSize: 13, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, tile: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#223239', backgroundColor: '#0b140e' },
  selected: { borderColor: '#b8e986', backgroundColor: '#263b23' }, swatch: { width: 30, height: 30, borderRadius: 15 }, auto: { color: '#b8c5b5', fontSize: 12 },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: '#ffbb91', paddingHorizontal: 16, paddingTop: 12 },
  done: { minHeight: 44, margin: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#b8e986', backgroundColor: '#263b23' }, doneText: { color: '#e5eadc', fontSize: 14, fontWeight: '600' },
});
