import { nearestImage, wrappedBounds, type GeometryWorld, type Point } from './geometry';
import type { MapCamera } from './chart-camera';

type Viewport = { width: number; height: number };

/** One scale in screen pixels per world unit, shared by geometry and touch targets. */
export function chartTransform(world: GeometryWorld, camera: MapCamera, viewport: Viewport) {
  const width = world.rules?.map.width ?? 100, height = world.rules?.map.height ?? 100;
  const fit = Math.min(Math.max(1, viewport.width) / width, Math.max(1, viewport.height) / height);
  const scale = fit * camera.scale;
  return { scale, x: viewport.width / 2 - width * scale / 2 + camera.x / 100 * width * fit, y: viewport.height / 2 - height * scale / 2 + camera.y / 100 * height * fit };
}

export function chartPosition(world: GeometryWorld, camera: MapCamera, point: Point, viewport?: Viewport): Point {
  const size = viewport ?? { width: world.rules?.map.width ?? 100, height: world.rules?.map.height ?? 100 };
  const transform = chartTransform(world, camera, size);
  return { x: (transform.x + point.x * transform.scale) / Math.max(1, size.width) * 100, y: (transform.y + point.y * transform.scale) / Math.max(1, size.height) * 100 };
}

export function chartOffsets(world: GeometryWorld, camera: MapCamera, viewport: Viewport): Point[] {
  const map = wrappedBounds(world);
  if (!map) return [{ x: 0, y: 0 }];
  const { scale } = chartTransform(world, camera, viewport);
  const columns = Math.max(1, Math.ceil(viewport.width / (2 * map.width * scale)));
  const rows = Math.max(1, Math.ceil(viewport.height / (2 * map.height * scale)));
  return Array.from({ length: columns * 2 + 1 }, (_, x) => x - columns).flatMap(x => Array.from({ length: rows * 2 + 1 }, (_, y) => ({ x: x * map.width, y: (y - rows) * map.height })));
}

export function chartRoute(world: GeometryWorld, from: Point, to: Point): { from: Point; to: Point } {
  return { from, to: nearestImage(world, from, to) };
}
