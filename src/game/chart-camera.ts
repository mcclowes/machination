import type { Faction } from './players';
import { wrappedBounds, type GeometryWorld, type Point } from './geometry';

export type MapCamera = { scale: number; x: number; y: number };
type Chart = GeometryWorld & { rocks: readonly { x: number; y: number; owner?: Faction | null }[] };

function axisBounds(values: number[], wrapped: boolean): [number, number] {
  const sorted = values.map(value => wrapped ? ((value % 100) + 100) % 100 : value).sort((a, b) => a - b);
  if (!wrapped) return [sorted[0]!, sorted[sorted.length - 1]!];
  let gap = -1, start = 0;
  sorted.forEach((value, i) => {
    const next = sorted[(i + 1) % sorted.length]! + (i === sorted.length - 1 ? 100 : 0);
    if (next - value > gap) { gap = next - value; start = next % 100; }
  });
  return [start, start + 100 - gap];
}

/** `lift` lets an untiled chart pan its lower edge further up, in camera units, while a bottom overlay covers it. */
export function constrainCamera(world: GeometryWorld, camera: MapCamera, lift = 0): MapCamera {
  const scale = Math.max(1, Math.min(4, camera.scale));
  const period = scale * 100, bound = (scale - 1) * 50;
  const offset = (value: number, extra = 0) => wrappedBounds(world)
    ? ((value + period / 2) % period + period) % period - period / 2
    : Math.max(-bound - extra, Math.min(bound, value)) || 0;
  return { scale, x: offset(camera.x), y: offset(camera.y, lift) };
}

export function zoomCamera(world: GeometryWorld, camera: MapCamera, requestedScale: number, lift = 0): MapCamera {
  const scale = Math.max(1, Math.min(4, requestedScale));
  const ratio = wrappedBounds(world) ? scale / camera.scale : 1;
  return constrainCamera(world, { scale, x: camera.x * ratio, y: camera.y * ratio }, lift);
}

export function focusCamera(world: GeometryWorld, camera: MapCamera, point: Point): MapCamera {
  const scale = Math.max(2, camera.scale);
  return constrainCamera(world, { scale, x: (50 - point.x / (world.rules?.map.width ?? 100) * 100) * scale, y: (50 - point.y / (world.rules?.map.height ?? 100) * 100) * scale });
}

export function fitPlayerCamera(chart: Chart, player: Faction): MapCamera {
  const owned = chart.rocks.filter(rock => rock.owner === player);
  if (!owned.length) return { scale: 1, x: 0, y: 0 };
  const width = chart.rules?.map.width ?? 100, height = chart.rules?.map.height ?? 100;
  const xs = owned.map(rock => rock.x / width * 100), ys = owned.map(rock => rock.y / height * 100);
  const [left, right] = axisBounds(xs, !!wrappedBounds(chart));
  const [top, bottom] = axisBounds(ys, !!wrappedBounds(chart));
  const padding = 20;
  const scale = Math.max(1, Math.min(4, 100 / (right - left + padding), 100 / (bottom - top + padding)));
  return constrainCamera(chart, { scale, x: (50 - (left + right) / 2) * scale, y: (50 - (top + bottom) / 2) * scale });
}
