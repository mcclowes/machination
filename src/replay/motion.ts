import { sitePosition } from '../game/drift';
import type { ReplayScene } from './presentation';

/** Evaluate only disclosed motion; membership and garrisons remain those of the recorded span. */
export function moveReplayScene(scene: ReplayScene, hour: number): ReplayScene {
  return { ...scene, hour,
    rocks: scene.rocks.map(r => r.drift ? { ...r, ...sitePosition(scene, r, hour) } : r),
    coverage: scene.coverage.map(s => s.drift ? { ...s, ...sitePosition(scene, s, hour) } : s),
  };
}
