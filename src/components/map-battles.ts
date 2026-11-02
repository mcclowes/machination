/** Chart placement for battle markers. */
import type { ObservedEvent } from '../game/events';
import { mapShields } from './map-shields';

// Matches the unshielded site radius used for chart layout in BeltMap.
const SITE_RADIUS = 18;
export type BattleSite = Parameters<typeof mapShields>[0] & { id: string };

/** Station battles burst from the site's outer edge on the side the attacker approached from. */
export function battlePoint(battle: NonNullable<ObservedEvent['battle']>, scale: number, sites: readonly BattleSite[] = []): { x: number; y: number } {
  const site = battle.site === undefined ? undefined : sites.find(s => s.id === battle.site);
  const radius = battle.toward && site ? mapShields(site).at(-1)?.radius ?? SITE_RADIUS : 0;
  return { x: battle.x * scale + (battle.toward?.x ?? 0) * radius, y: battle.y * scale + (battle.toward?.y ?? 0) * radius };
}
