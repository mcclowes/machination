/** Imported project artwork, with static sources for Metro's native and web asset bundlers. */
import type { ImageSourcePropType } from 'react-native';
import manifest from '../../assets/artwork/manifest.json';

export const ARTWORK_SOURCES = {
  'mining-world': require('../../assets/artwork/display/mining-world.png'),
  'techno-gothic-duel': require('../../assets/artwork/display/techno-gothic-duel.png'),
  'ritual-tech-clash': require('../../assets/artwork/display/ritual-tech-clash.png'),
  'time-ship': require('../../assets/artwork/display/time-ship.png'),
  'gravity-well-arrows': require('../../assets/artwork/display/gravity-well-arrows.png'),
  'gravity-well': require('../../assets/artwork/display/gravity-well.png'),
  'exploding-planet': require('../../assets/artwork/display/exploding-planet.png'),
  'specialist-icons-color': require('../../assets/artwork/display/specialist-icons-color.png'),
  'specialist-icons-ivory': require('../../assets/artwork/display/specialist-icons-ivory.png'),
  'mining-drones': require('../../assets/artwork/display/mining-drones.png'),
  'cloaked-ship': require('../../assets/artwork/display/cloaked-ship.png'),
  'assassin': require('../../assets/artwork/display/assassin.png'),
  'bombardment': require('../../assets/artwork/display/bombardment.png'),
  'portraits-original': require('../../assets/artwork/display/portraits-original.png'),
  'portraits-retro': require('../../assets/artwork/display/portraits-retro.png'),
  'portraits-cyborg': require('../../assets/artwork/display/portraits-cyborg.png'),
  'portraits-cybernetic': require('../../assets/artwork/display/portraits-cybernetic.png'),
  'portraits-nomad': require('../../assets/artwork/display/portraits-nomad.png'),
  'faction-emblems': require('../../assets/artwork/display/faction-emblems.png'),
  'fleet-sheet': require('../../assets/artwork/display/fleet-sheet.png'),
  'drone-sheet': require('../../assets/artwork/display/drone-sheet.png'),
  'asteroid-frontier': require('../../assets/artwork/display/asteroid-frontier.png'),
  'command-bridge': require('../../assets/artwork/display/command-bridge.png'),
  'industrial-cockpit': require('../../assets/artwork/display/industrial-cockpit.png'),
} as const satisfies Record<string, ImageSourcePropType>;
export type ArtworkId = keyof typeof ARTWORK_SOURCES;
export const ARTWORK = manifest.images.map(image => ({ ...image, id: image.id as ArtworkId, source: ARTWORK_SOURCES[image.id as ArtworkId] }));
