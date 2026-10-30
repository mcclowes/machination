import { nearestImage, wrappedBounds, type GeometryWorld, type Point } from './geometry';
import { constrainCamera, type CameraPadding, type MapCamera } from './chart-camera';

export type ChartViewport = { width: number; height: number; fitScale?: number };

export function chartFit(world: GeometryWorld, viewport: ChartViewport): number {
  return Math.min(Math.max(1, viewport.width) / (world.rules?.map.width ?? 100), Math.max(1, viewport.height) / (world.rules?.map.height ?? 100));
}

/** One scale in screen pixels per world unit, shared by geometry and touch targets. */
export function chartTransform(world: GeometryWorld, camera: MapCamera, viewport: ChartViewport) {
  const width = world.rules?.map.width ?? 100, height = world.rules?.map.height ?? 100;
  const fit = viewport.fitScale ?? chartFit(world, viewport);
  const scale = fit * camera.scale;
  return { scale, x: viewport.width / 2 - width * scale / 2 + camera.x / 100 * width * fit, y: viewport.height / 2 - height * scale / 2 + camera.y / 100 * height * fit };
}

export function chartPosition(world: GeometryWorld, camera: MapCamera, point: Point, viewport?: ChartViewport): Point {
  const size = viewport ?? { width: world.rules?.map.width ?? 100, height: world.rules?.map.height ?? 100 };
  const transform = chartTransform(world, camera, size);
  return { x: (transform.x + point.x * transform.scale) / Math.max(1, size.width) * 100, y: (transform.y + point.y * transform.scale) / Math.max(1, size.height) * 100 };
}

export function chartOffsets(world: GeometryWorld, camera: MapCamera, viewport: ChartViewport): Point[] {
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

const REVEAL_MARGIN = 22;

/** Camera lift that lets an untiled chart's lower edge clear a bottom overlay of `coveredBottom` pixels. */
export function overlayLift(world: GeometryWorld, viewport: ChartViewport, coveredBottom: number): number {
  if (wrappedBounds(world) || coveredBottom <= 0) return 0;
  const height = world.rules?.map.height ?? 100;
  const fit = viewport.fitScale ?? chartFit(world, viewport);
  return (coveredBottom + REVEAL_MARGIN) / (height * fit) * 100;
}

/** Pans vertically so a point sits mid-way through the chart band left uncovered by a bottom overlay, unless it is already clear. */
export function revealAboveCamera(world: GeometryWorld, camera: MapCamera, point: Point, viewport: ChartViewport, coveredBottom: number): MapCamera {
  const clear = Math.max(0, viewport.height - coveredBottom);
  const target = Math.max(REVEAL_MARGIN, clear / 2);
  const transform = chartTransform(world, camera, viewport);
  const images = chartOffsets(world, camera, viewport).map(offset => transform.y + (point.y + offset.y) * transform.scale);
  const nearest = images.reduce((best, y) => Math.abs(y - target) < Math.abs(best - target) ? y : best);
  if (nearest >= REVEAL_MARGIN && nearest <= clear - REVEAL_MARGIN) return camera;
  const fit = transform.scale / camera.scale;
  const height = world.rules?.map.height ?? 100;
  return constrainCamera(world, { ...camera, y: camera.y - (nearest - target) / (height * fit) * 100 }, overlayLift(world, viewport, coveredBottom));
}

/** Pans a route's points into the chart band above a bottom overlay at the current zoom; a route too long to fit keeps its first point in view. */
export function revealRouteCamera(world: GeometryWorld, camera: MapCamera, points: readonly Point[], viewport: ChartViewport, coveredBottom: number): MapCamera {
  const [first] = points;
  if (!first) return camera;
  const clear = Math.max(0, viewport.height - coveredBottom);
  const transform = chartTransform(world, camera, viewport);
  const screen = (p: Point) => ({ x: transform.x + p.x * transform.scale, y: transform.y + p.y * transform.scale });
  const fromCentre = (p: Point) => { const s = screen(p); return Math.hypot(s.x - viewport.width / 2, s.y - clear / 2); };
  const anchor = chartOffsets(world, camera, viewport)
    .map(offset => ({ x: first.x + offset.x, y: first.y + offset.y }))
    .reduce((best, p) => fromCentre(p) < fromCentre(best) ? p : best);
  const route = points.map(p => screen(nearestImage(world, anchor, p)));
  const xs = route.map(p => p.x), ys = route.map(p => p.y);
  const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  if (box.left >= REVEAL_MARGIN && box.right <= viewport.width - REVEAL_MARGIN && box.top >= REVEAL_MARGIN && box.bottom <= clear - REVEAL_MARGIN) return camera;
  const fits = box.right - box.left <= viewport.width - 2 * REVEAL_MARGIN && box.bottom - box.top <= clear - 2 * REVEAL_MARGIN;
  const focus = fits ? { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 } : screen(anchor);
  const fit = transform.scale / camera.scale;
  const width = world.rules?.map.width ?? 100, height = world.rules?.map.height ?? 100;
  return constrainCamera(world, {
    ...camera,
    x: camera.x - (focus.x - viewport.width / 2) / (width * fit) * 100,
    y: camera.y - (focus.y - clear / 2) / (height * fit) * 100,
  }, overlayLift(world, viewport, coveredBottom));
}

export function siteCameraPadding(world: GeometryWorld, viewport: ChartViewport, coveredBottom: number, margin: number): CameraPadding {
  if (wrappedBounds(world)) return 0;
  const fit = chartTransform(world, { scale: 1, x: 0, y: 0 }, viewport).scale;
  const width = (world.rules?.map.width ?? 100) * fit, height = (world.rules?.map.height ?? 100) * fit;
  return { left: margin / width * 100, right: margin / width * 100, top: margin / height * 100, bottom: (coveredBottom + margin) / height * 100 };
}

/** Reveal once when inspecting or resizing, without centering an already visible site. */
export function revealSiteCamera(world: GeometryWorld, camera: MapCamera, point: Point, viewport: ChartViewport, coveredBottom: number, margin: number): MapCamera {
  const clear = Math.max(0, viewport.height - coveredBottom);
  const target = { x: viewport.width / 2, y: clear / 2 };
  const inset = { x: Math.min(margin, target.x), y: Math.min(margin, target.y) };
  const transform = chartTransform(world, camera, viewport);
  const images = chartOffsets(world, camera, viewport).map(offset => ({ x: transform.x + (point.x + offset.x) * transform.scale, y: transform.y + (point.y + offset.y) * transform.scale }));
  const distance = (p: Point) => (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
  const shown = images.reduce((best, p) => distance(p) < distance(best) ? p : best);
  const dx = shown.x < inset.x || shown.x > viewport.width - inset.x ? shown.x - target.x : 0;
  const dy = shown.y < inset.y || shown.y > clear - inset.y ? shown.y - target.y : 0;
  if (!dx && !dy) return camera;
  const fit = transform.scale / camera.scale;
  return constrainCamera(world, { ...camera, x: camera.x - dx / ((world.rules?.map.width ?? 100) * fit) * 100, y: camera.y - dy / ((world.rules?.map.height ?? 100) * fit) * 100 }, siteCameraPadding(world, viewport, coveredBottom, margin));
}
