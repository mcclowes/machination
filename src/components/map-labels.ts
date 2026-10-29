/** Place secondary names without covering site markers or more important names. */
type SiteAnchor = { key: string; x: number; y: number; priority: number; radius?: number };
export type Rect = { x: number; y: number; width: number; height: number };
const NAME_WIDTH = 88, NAME_HEIGHT = 14;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function mapMarkerBounds(point: { x: number; y: number; radius?: number }): Rect {
  const radius = point.radius ?? 18;
  return { x: point.x - radius, y: point.y - radius, width: radius + Math.max(radius, 38), height: radius * 2 };
}

export function layoutSiteNames(sites: SiteAnchor[], viewport: { width: number; height: number }, obstacles: readonly Rect[] = []): Map<string, 'above' | 'below'> {
  const markers = sites.map(mapMarkerBounds);
  const blocked = [...markers, ...obstacles];
  const names: Rect[] = [];
  const result = new Map<string, 'above' | 'below'>();
  for (const site of [...sites].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))) {
    for (const placement of ['below', 'above'] as const) {
      const radius = site.radius ?? 18;
      const box = { x: site.x - NAME_WIDTH / 2, y: site.y + (placement === 'below' ? radius + 2 : -radius - 16), width: NAME_WIDTH, height: NAME_HEIGHT };
      if (box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) continue;
      if (blocked.some(marker => overlaps(box, marker)) || names.some(name => overlaps(box, name))) continue;
      names.push(box); result.set(site.key, placement); break;
    }
  }
  return result;
}
