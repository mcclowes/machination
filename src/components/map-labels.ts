/** Place secondary names without covering site markers or more important names. */
type MarkerPoint = { x: number; y: number; radius?: number; drones?: number; controlWidth?: number; controlHeight?: number };
/** Only flexible (selected) names may flip above; others hide so names read consistently below. */
type SiteAnchor = MarkerPoint & { key: string; priority: number; flexible?: boolean };
export type Rect = { x: number; y: number; width: number; height: number };
export const MAP_DRONE_COUNT_SIZE = 11;
export const MAP_DRONE_COUNT_OFFSET = 9;
export const MAP_DRONE_COUNT_PADDING = 4;
const DRONE_DIGIT_WIDTH = Math.ceil(MAP_DRONE_COUNT_SIZE * 0.7);
const NAME_WIDTH = 88, NAME_HEIGHT = 14;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function mapMarkerBounds(point: MarkerPoint): Rect {
  const radius = point.radius ?? 18;
  const digits = point.drones === undefined ? 2 : point.drones > 0 ? String(Math.floor(point.drones)).length : 0;
  const right = Math.max(radius, digits ? MAP_DRONE_COUNT_OFFSET + digits * DRONE_DIGIT_WIDTH + 2 * MAP_DRONE_COUNT_PADDING : 0);
  return { x: point.x - radius, y: point.y - radius, width: radius + right, height: radius * 2 };
}

export function mapMarkerHitBounds(point: MarkerPoint): Rect {
  const bounds = mapMarkerBounds(point);
  const halfWidth = (point.controlWidth ?? 64) / 2, halfHeight = (point.controlHeight ?? 44) / 2;
  const left = Math.min(bounds.x, point.x - halfWidth), top = Math.min(bounds.y, point.y - halfHeight);
  return { x: left, y: top, width: Math.max(bounds.x + bounds.width, point.x + halfWidth) - left, height: Math.max(bounds.y + bounds.height, point.y + halfHeight) - top };
}

export function layoutSiteNames(sites: SiteAnchor[], viewport: { width: number; height: number }, obstacles: readonly Rect[] = []): Map<string, 'above' | 'below'> {
  const markers = sites.map(mapMarkerBounds);
  const blocked = [...markers, ...obstacles];
  const names: Rect[] = [];
  const result = new Map<string, 'above' | 'below'>();
  for (const site of [...sites].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))) {
    for (const placement of site.flexible ? (['below', 'above'] as const) : (['below'] as const)) {
      const radius = site.radius ?? 18;
      const box = { x: site.x - NAME_WIDTH / 2, y: site.y + (placement === 'below' ? radius + 2 : -radius - 16), width: NAME_WIDTH, height: NAME_HEIGHT };
      if (box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) continue;
      if (blocked.some(marker => overlaps(box, marker)) || names.some(name => overlaps(box, name))) continue;
      names.push(box); result.set(site.key, placement); break;
    }
  }
  return result;
}
