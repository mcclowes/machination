/** Project scenes, specialist insignia, and the complete in-game art archive. */
import React, { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SpecialistKind } from '../game/specialist-catalog';
import { ARTWORK, ARTWORK_SOURCES, type ArtworkId } from './artwork-catalog';

export function ArtworkImage({ id }: { id: ArtworkId }) {
  const image = ARTWORK.find(entry => entry.id === id)!;
  return <View style={s.frame}><Image source={image.source} accessibilityLabel={image.title} resizeMode="contain" style={s.image} /></View>;
}

const specialistIcons = {
  queen: 9, diplomat: 17, elder: 12, foreman: 6, engineer: 7, pirate: 13,
  lieutenant: 1, general: 10, princess: 0, infiltrator: 5, warHero: 10,
  sentry: 15, intelligence: 0, tinkerer: 14, energy: 11, saboteur: 2,
  assassin: 1, inspector: 8, security: 9, doubleAgent: 4, thief: 14,
  smuggler: 13, tycoon: 6, navigator: 12, admiral: 13, martyr: 10,
  helmsman: 13, hypnotist: 3, king: 9,
} satisfies Record<SpecialistKind, number>;

export function SpecialistIcon({ kind, size = 36 }: { kind: SpecialistKind; size?: number }) {
  const cell = specialistIcons[kind];
  const scale = size / 216;
  return <View accessible={false} style={{ width: size, height: size, overflow: 'hidden', flexShrink: 0 }}>
    <Image accessible={false} source={ARTWORK_SOURCES['specialist-icons-ivory']} resizeMode="stretch" style={{ position: 'absolute', width: 1536 * scale, height: 1024 * scale, left: -(30 + cell % 6 * 252) * scale, top: -(60 + Math.floor(cell / 6) * 310) * scale }} />
  </View>;
}

const categories = ['All', 'Scenes', 'Commanders', 'Icons', 'Design sheets'] as const;
export function ArtArchive() {
  const scroll = useRef<ScrollView>(null);
  const [category, setCategory] = useState<string>('All');
  const [selected, setSelected] = useState<ArtworkId>(ARTWORK[0]!.id);
  const images = ARTWORK.filter(image => category === 'All' || image.category === category);
  const index = Math.max(0, images.findIndex(image => image.id === selected));
  const image = images[index]!;
  function selectImage(id: ArtworkId) {
    setSelected(id);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  return <ScrollView ref={scroll} contentContainerStyle={s.archive}>
    <Text style={s.intro}>The people, machines, and worlds of Machination. Browse all {ARTWORK.length} illustrations, including the original concepts.</Text>
    <View accessibilityRole="tablist" style={s.row}>{categories.map(name => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: category === name }} onPress={() => { setCategory(name); selectImage(ARTWORK.find(entry => name === 'All' || entry.category === name)!.id); }} style={[s.button, category === name && s.selected]}><Text style={s.buttonText}>{name}</Text></Pressable>)}</View>
    <Text accessibilityRole="header" style={s.title}>{image.title}</Text>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous artwork" accessibilityState={{ disabled: index === 0 }} disabled={index === 0} onPress={() => selectImage(images[index - 1]!.id)} style={[s.button, index === 0 && s.disabled]}><Text style={s.buttonText}>Previous</Text></Pressable>
      <Text accessibilityLiveRegion="polite" style={s.count}>{index + 1} / {images.length}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next artwork" accessibilityState={{ disabled: index === images.length - 1 }} disabled={index === images.length - 1} onPress={() => selectImage(images[index + 1]!.id)} style={[s.button, index === images.length - 1 && s.disabled]}><Text style={s.buttonText}>Next</Text></Pressable>
    </View>
    <ArtworkImage id={image.id} />
    {images.map(entry => <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`View ${entry.title}`} accessibilityState={{ selected: image.id === entry.id }} onPress={() => selectImage(entry.id)} style={[s.entry, image.id === entry.id && s.selected]}><Text style={s.buttonText}>{entry.title}</Text><Text style={s.count}>{entry.category}</Text></Pressable>)}
  </ScrollView>;
}

const s = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 3 / 2, backgroundColor: '#101310', borderRadius: 3, overflow: 'hidden' },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  archive: { width: '100%', maxWidth: 960, alignSelf: 'center', padding: 20, gap: 12 },
  intro: { color: '#a8b8a2', fontSize: 14, lineHeight: 22 },
  title: { color: '#e5eadc', fontSize: 19 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  button: { minHeight: 44, padding: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#15241a' },
  buttonText: { color: '#d6e2cd', fontSize: 12 }, count: { color: '#96ad89', fontSize: 12 },
  entry: { minHeight: 48, padding: 12, gap: 5, borderWidth: 1, borderColor: '#30442b' },
  selected: { borderColor: '#b8e986', backgroundColor: '#263c20' }, disabled: { opacity: 0.35 },
});
