/** Group observed specialists into compact chart badges and place the badge row beside its anchor. */
import { SPECIALISTS, isSpecialistKind, type SpecialistKind } from '../game/specialist-catalog';
import { ALL_PLAYERS, FACTIONS, isFaction, type Faction } from '../game/players';
import type { Specialist } from '../game/specialists';
import { mapMarkerHitBounds, type Rect } from './map-labels';

export type SpecialistGroup = { kind: SpecialistKind; owner: Faction; captive: boolean; count: number };
export type SpecialistSummary = { groups: SpecialistGroup[]; displayed: SpecialistGroup[]; overflow: number; total: number };
export type SpecialistMarkerPlacement = { left: number; top: number; width: number; height: number; side: 'above' | 'below' };
export const MAX_SPECIALIST_BADGES = 3;
export const SPECIALIST_BADGE_SIZE = 24, SPECIALIST_BADGE_GAP = 2, SPECIALIST_BADGE_HIT_SLOP = 10;
export const SPECIALIST_BADGE_OFFSET = SPECIALIST_BADGE_HIT_SLOP + 4;

const KIND_ORDER = Object.keys(SPECIALISTS) as SpecialistKind[];
const isUnit = (u: unknown): u is Specialist => !!u && typeof u === 'object' && isSpecialistKind((u as Specialist).kind) && isFaction((u as Specialist).owner);

export function mapSpecialistSummary(asset: { known?: boolean; destroyed?: boolean; specialists?: readonly Specialist[] }): SpecialistSummary {
  const units = asset.known === false || asset.destroyed || !Array.isArray(asset.specialists) ? [] : asset.specialists.filter(isUnit);
  const byKey = new Map<string, SpecialistGroup>();
  for (const u of units) {
    const key = `${u.kind}|${u.owner}|${!!u.captive}`;
    const group = byKey.get(key);
    if (group) group.count++;
    else byKey.set(key, { kind: u.kind, owner: u.owner, captive: !!u.captive, count: 1 });
  }
  // Sorted by catalog order (queen first), owner, then captive, so unit arrival order never changes the badges.
  const groups = [...byKey.values()].sort((a, b) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || ALL_PLAYERS.indexOf(a.owner) - ALL_PLAYERS.indexOf(b.owner) || Number(a.captive) - Number(b.captive));
  const hidden = groups.slice(MAX_SPECIALIST_BADGES);
  return { groups, displayed: groups.slice(0, MAX_SPECIALIST_BADGES), overflow: hidden.reduce((n, g) => n + g.count, 0), total: units.length };
}

export function specialistManifestDescription(summary: SpecialistSummary, ownerName: (owner: Faction) => string = owner => FACTIONS[owner].name): string {
  return summary.groups.map(g => `${g.count > 1 ? `${g.count} × ` : ''}${SPECIALISTS[g.kind].name} (${ownerName(g.owner)}${g.captive ? ', captive' : ''})`).join(', ');
}

export function specialistMarkerPlacement(point: { x: number; y: number }, radius: number | undefined, viewport: { width: number; height: number }, summary: SpecialistSummary, obstacles: readonly Rect[] = []): SpecialistMarkerPlacement | undefined {
  const badges = summary.displayed.length + (summary.overflow > 0 ? 1 : 0);
  if (!badges || point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) return undefined;
  const r = radius ?? 18, height = SPECIALIST_BADGE_SIZE;
  const width = badges * SPECIALIST_BADGE_SIZE + (badges - 1) * SPECIALIST_BADGE_GAP;
  if (width + 2 * SPECIALIST_BADGE_HIT_SLOP > viewport.width) return undefined;
  const above = point.y - r - SPECIALIST_BADGE_OFFSET - height, below = point.y + r + SPECIALIST_BADGE_OFFSET;
  const left = Math.max(SPECIALIST_BADGE_HIT_SLOP, Math.min(viewport.width - width - SPECIALIST_BADGE_HIT_SLOP, point.x - width / 2));
  for (const [side, top] of [['above', above], ['below', below]] as const) {
    if (top < SPECIALIST_BADGE_HIT_SLOP || top + height + SPECIALIST_BADGE_HIT_SLOP > viewport.height) continue;
    const hit = badgeHitBounds({ left, top, width, height, side });
    if (obstacles.some(rect => hit.x < rect.x + rect.width && hit.x + hit.width > rect.x && hit.y < rect.y + rect.height && hit.y + hit.height > rect.y)) continue;
    return { left, top, width, height, side };
  }
  return undefined;
}

function badgeHitBounds(row: SpecialistMarkerPlacement): Rect {
  return { x: row.left - SPECIALIST_BADGE_HIT_SLOP, y: row.top - SPECIALIST_BADGE_HIT_SLOP, width: row.width + 2 * SPECIALIST_BADGE_HIT_SLOP, height: row.height + 2 * SPECIALIST_BADGE_HIT_SLOP };
}
type SpecialistAnchor = { key: string; x: number; y: number; radius?: number; priority: number; specialists: SpecialistSummary; drones?: number; controlWidth?: number; controlHeight?: number };
export function layoutSpecialistMarkers(anchors: readonly SpecialistAnchor[], viewport: { width: number; height: number }): Map<string, SpecialistMarkerPlacement> {
  const placed = new Map<string, SpecialistMarkerPlacement>();
  const obstacles = anchors.map(mapMarkerHitBounds);
  for (const anchor of [...anchors].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))) {
    const row = specialistMarkerPlacement(anchor, anchor.radius, viewport, anchor.specialists, obstacles);
    if (!row) continue;
    placed.set(anchor.key, row);
    obstacles.push(badgeHitBounds(row));
  }
  return placed;
}
