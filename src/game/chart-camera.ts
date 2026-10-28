import type { Faction } from './players';

export type MapCamera = { scale: number; x: number; y: number };
type Chart = { rocks: readonly { x: number; y: number; owner?: Faction | null }[]; rules?: { map: { width: number; height: number } } };

export function fitPlayerCamera(chart: Chart, player: Faction): MapCamera {
  const owned = chart.rocks.filter(rock => rock.owner === player);
  if (!owned.length) return { scale: 1, x: 0, y: 0 };
  const width = chart.rules?.map.width ?? 100, height = chart.rules?.map.height ?? 100;
  const xs = owned.map(rock => rock.x / width * 100), ys = owned.map(rock => rock.y / height * 100);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const padding = 20;
  const scale = Math.max(1, Math.min(4, 100 / (right - left + padding), 100 / (bottom - top + padding)));
  const bound = (scale - 1) * 50;
  const offset = (midpoint: number) => Math.max(-bound, Math.min(bound, (50 - midpoint) * scale)) || 0;
  return { scale, x: offset((left + right) / 2), y: offset((top + bottom) / 2) };
}
