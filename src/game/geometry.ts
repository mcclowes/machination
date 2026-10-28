/**
 * ---
 * purpose: Shared planar and toroidal distance, coordinate, and image geometry.
 * ---
 */
export type Point = { x: number; y: number };
export type MapGeometry = { width: number; height: number; topology?: 'torus' };
export type GeometryWorld = { rules?: { map: MapGeometry } };
export function wrappedBounds(world: GeometryWorld): MapGeometry | undefined {
  return world.rules?.map.topology === 'torus' ? world.rules.map : undefined;
}
export function displacement(world: GeometryWorld, from: Point, to: Point): Point {
  const map = wrappedBounds(world);
  const shortest = (delta: number, size: number) => { const value = delta % size; return value > size / 2 ? value - size : value < -size / 2 ? value + size : value; };
  return map ? { x: shortest(to.x - from.x, map.width), y: shortest(to.y - from.y, map.height) } : { x: to.x - from.x, y: to.y - from.y };
}
export function worldDistance(world: GeometryWorld, from: Point, to: Point): number {
  const delta = displacement(world, from, to);
  return Math.hypot(delta.x, delta.y);
}
export function nearestImage(world: GeometryWorld, from: Point, to: Point): Point {
  if (!wrappedBounds(world)) return { x: to.x, y: to.y };
  const delta = displacement(world, from, to);
  return { x: from.x + delta.x, y: from.y + delta.y };
}
export function wrapPoint(world: GeometryWorld, point: Point): Point {
  const map = wrappedBounds(world);
  const wrap = (value: number, size: number) => ((value % size) + size) % size;
  return map ? { x: wrap(point.x, map.width), y: wrap(point.y, map.height) } : { x: point.x, y: point.y };
}
export function mapOffsets(world: GeometryWorld): Point[] {
  const map = wrappedBounds(world);
  return map ? [-1, 0, 1].flatMap(x => [-1, 0, 1].map(y => ({ x: x * map.width, y: y * map.height }))) : [{ x: 0, y: 0 }];
}
