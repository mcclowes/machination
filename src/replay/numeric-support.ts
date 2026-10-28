/** Private binary64 support tools. No geometry or certificates are serialized. */
import { wrappedBounds, type GeometryWorld, type Point } from '../game/geometry';

export type NumericFlight = { from: Point; to: Point; departed: number; arrives: number };
export type NumericMotion = { position: Point; velocity: Point; source?: NumericFlight; origin?: number; wrapped?: boolean };
type Bounds = [number, number];
const bits = new DataView(new ArrayBuffer(8));
export function ordinal(value: number): bigint {
  bits.setFloat64(0, value === 0 ? 0 : value);
  return bits.getBigUint64(0);
}
export function atOrdinal(value: bigint): number {
  bits.setBigUint64(0, value);
  return bits.getFloat64(0);
}
export const nextHour = (hour: number): number => atOrdinal(ordinal(hour) + 1n);
export const previousHour = (hour: number): number => hour === 0 ? -Number.MIN_VALUE : atOrdinal(ordinal(hour) - 1n);
export class UnsupportedVisibilityNumericError extends Error {
  readonly code = 'unsupported-visibility-numeric';
  constructor() { super('Replay visibility numeric support could not be established.'); }
}
export const MAX_NUMERIC_REGIONS = 32_768;
export const VISIBILITY_NUMERIC_RUNTIME = '13.6.233.17-node.44';
const nativeHypot = Math.hypot;
const nativeSqrt = Math.sqrt;
export function requireNumericRuntime(): void {
  if (typeof process === 'undefined' || process.versions?.v8 !== VISIBILITY_NUMERIC_RUNTIME || Math.hypot !== nativeHypot || Math.sqrt !== nativeSqrt || !Function.prototype.toString.call(nativeHypot).includes('[native code]') || !Function.prototype.toString.call(nativeSqrt).includes('[native code]')) throw new UnsupportedVisibilityNumericError();
}

/** Bounds the pinned V8 two-argument implementation, without assuming hypot monotonicity.
 * https://chromium.googlesource.com/v8/v8/+/refs/tags/13.6.233.17/src/builtins/math.tq
 */
export function hypotBounds(x: Bounds, y: Bounds): Bounds {
  if (x[0] === x[1] && y[0] === y[1]) {
    const value = Math.hypot(x[0], y[0]);
    return [value, value];
  }
  const max: Bounds = [Math.max(x[0], y[0]), Math.max(x[1], y[1])];
  if (max[1] === 0) return [0, 0];
  if (max[0] === 0) return [0, Math.sqrt(2) * max[1]];
  let a: Bounds, b: Bounds;
  if (x[0] >= y[1]) { a = [1, 1]; b = [y[0] / x[1], y[1] / x[0]]; }
  else if (y[0] >= x[1]) { b = [1, 1]; a = [x[0] / y[1], x[1] / y[0]]; }
  else {
    a = [x[0] / max[1], Math.min(1, x[1] / max[0])];
    b = [y[0] / max[1], Math.min(1, y[1] / max[0])];
  }
  return [Math.sqrt(a[0] * a[0] + b[0] * b[0]) * max[0], Math.sqrt(a[1] * a[1] + b[1] * b[1]) * max[1]];
}

export function motionPosition(motion: NumericMotion, origin: number, hour: number): Point {
  const source = motion.source;
  if (source) {
    if (![source.from.x, source.from.y, source.to.x, source.to.y, source.departed, source.arrives, source.arrives - source.departed, source.to.x - source.from.x, source.to.y - source.from.y].every(Number.isFinite) || source.arrives <= source.departed) throw new UnsupportedVisibilityNumericError();
    const progress = Math.max(0, Math.min(1, (hour - source.departed) / (source.arrives - source.departed)));
    return { x: source.from.x + (source.to.x - source.from.x) * progress, y: source.from.y + (source.to.y - source.from.y) * progress };
  }
  return { x: motion.position.x + motion.velocity.x * (hour - (motion.origin ?? origin)), y: motion.position.y + motion.velocity.y * (hour - (motion.origin ?? origin)) };
}
const ordered = (a: number, b: number): Bounds => [Math.min(a, b), Math.max(a, b)];
function remainder(range: Bounds, size: number): Bounds {
  // Remainder is monotone only within a single signed quotient cell.
  const [lo, hi] = range;
  if (lo % size <= hi % size && Math.trunc(lo / size) === Math.trunc(hi / size) && Math.abs(lo / size) < 2 ** 48 && Math.abs(hi / size) < 2 ** 48) return ordered(lo % size, hi % size);
  return [lo < 0 ? -size : 0, hi > 0 ? size : 0];
}
function wrap(range: Bounds, size: number): Bounds {
  const first = remainder(range, size);
  return remainder([first[0] + size, first[1] + size], size);
}
function absolute(range: Bounds): Bounds {
  return [range[0] <= 0 && range[1] >= 0 ? 0 : Math.min(Math.abs(range[0]), Math.abs(range[1])), Math.max(Math.abs(range[0]), Math.abs(range[1]))];
}
function distanceAxis(point: Bounds, sensor: Bounds, size?: number): Bounds {
  let delta: Bounds = [point[0] - sensor[1], point[1] - sensor[0]];
  if (size !== undefined) {
    delta = remainder(delta, size);
    if (delta[0] > size / 2) delta = [delta[0] - size, delta[1] - size];
    else if (delta[1] < -size / 2) delta = [delta[0] + size, delta[1] + size];
    else if (delta[0] < -size / 2 || delta[1] > size / 2) return [0, size / 2];
  }
  return absolute(delta);
}

/** Endpoint arithmetic encloses monotone flight expressions, including their rounding plateaus. */
export function distanceBounds(world: GeometryWorld, point: NumericMotion, sensor: NumericMotion, origin: number, from: number, through: number): Bounds {
  const p = [motionPosition(point, origin, from), motionPosition(point, origin, through)];
  const s = [motionPosition(sensor, origin, from), motionPosition(sensor, origin, through)];
  if (![...p, ...s].every(v => Number.isFinite(v.x) && Number.isFinite(v.y))) throw new UnsupportedVisibilityNumericError();
  const map = wrappedBounds(world);
  function axis(key: 'x' | 'y', size?: number): Bounds {
    const a = point.source, b = sensor.source;
    if (a && b && a.departed === b.departed && a.arrives === b.arrives && a.from[key] === b.from[key] && a.to[key] === b.to[key]) return [0, 0];
    if (!a && !b && point.position[key] === sensor.position[key] && point.velocity[key] === sensor.velocity[key] && (point.origin ?? origin) === (sensor.origin ?? origin)) return [0, 0];
    let pb = ordered(p[0]![key], p[1]![key]), sb = ordered(s[0]![key], s[1]![key]);
    // Only fleetPosition wraps coordinates; plain affine callers use unwrapped coordinates.
    if (size !== undefined && (point.source || point.wrapped)) pb = wrap(pb, size);
    if (size !== undefined && (sensor.source || sensor.wrapped)) sb = wrap(sb, size);
    return distanceAxis(pb, sb, size);
  }
  const x = axis('x', map?.width), y = axis('y', map?.height);
  if (![...x, ...y].every(Number.isFinite)) throw new UnsupportedVisibilityNumericError();
  return hypotBounds(x, y);
}
