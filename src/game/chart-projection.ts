import { nearestImage, type GeometryWorld, type Point } from './geometry';
import type { MapCamera } from './chart-camera';

export function chartPosition(world: GeometryWorld, camera: MapCamera, point: Point): Point {
  const width = world.rules?.map.width ?? 100, height = world.rules?.map.height ?? 100;
  return { x: (point.x / width * 100 - 50) * camera.scale + 50 + camera.x, y: (point.y / height * 100 - 50) * camera.scale + 50 + camera.y };
}

export function chartRoute(world: GeometryWorld, from: Point, to: Point): { from: Point; to: Point } {
  return { from, to: nearestImage(world, from, to) };
}
