/**
 * ---
 * purpose: PROTOTYPE (#104). Gravity course plotting and timing; arithmetic and sqrt only so it could run deterministically on server and client.
 * ---
 */
export type Point = { x: number; y: number };
export type Well = { id: string; x: number; y: number; mass: number; radius: number; owner?: string | null };
export type Tuning = {
  bend: number;
  speedGain: number;
  reach: number;
  ownerAware: boolean;
  baseSpeed: number;
  samples: number;
};
export type Course = {
  points: Point[];
  times: number[];
  speeds: number[];
  length: number;
  duration: number;
  straightLength: number;
  straightDuration: number;
  maxDeflection: number;
  burns: number;
  minSpeed: number;
  maxSpeed: number;
};
export type MapSize = { width: number; height: number };

export const DEFAULT_TUNING: Tuning = { bend: 1, speedGain: 0.6, reach: 10, ownerAware: true, baseSpeed: 8, samples: 48 };
const CLEARANCE = 1.3;
/** Compact falloff: full strength at the centre, zero at the reach circle, so influence is legible. */
export function influence(r2: number, reach: number, radius: number): number {
  const edge = (reach + radius) ** 2;
  return r2 >= edge ? 0 : (1 - r2 / edge) ** 2;
}

const shortest = (delta: number, size: number) => { const value = delta % size; return value > size / 2 ? value - size : value < -size / 2 ? value + size : value; };
export function nearestImage(map: MapSize, from: Point, to: Point): Point {
  return { x: from.x + shortest(to.x - from.x, map.width), y: from.y + shortest(to.y - from.y, map.height) };
}
export function wrapPoint(map: MapSize, p: Point): Point {
  const wrap = (v: number, s: number) => ((v % s) + s) % s;
  return { x: wrap(p.x, map.width), y: wrap(p.y, map.height) };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const u = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
}

/** Copies wells at torus offsets and keeps only those close enough to the chord to matter. */
function relevantWells(map: MapSize, wells: readonly Well[], a: Point, b: Point, reach: number): Well[] {
  const result: Well[] = [];
  for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) for (const w of wells) {
    const image = { ...w, x: w.x + ox * map.width, y: w.y + oy * map.height };
    if (segmentDistance(image, a, b) <= reach * 3 + w.radius) result.push(image);
  }
  return result;
}

type Flight = { points: Point[]; miss: number; valid: boolean };

/**
 * Fly from a with an initial heading `aim` off the chord until crossing b's perpendicular.
 * Gravity turns the heading toward each well, so the course curves with the mass on the inside.
 * Shape ignores owner speed so every intelligence flies the same course between two sites.
 */
export function fly(a: Point, b: Point, aim: number, wells: readonly Well[], tuning: Tuning): Flight {
  const cx = b.x - a.x, cy = b.y - a.y, length = Math.hypot(cx, cy) || 1;
  const ux = cx / length, uy = cy / length, nx = -uy, ny = ux;
  const steps = tuning.samples * 3, ds = length / steps;
  // Rational parametrisation spans ±90° without trig: aim ±1 is perpendicular to the chord.
  let dx = ux * (1 - aim * aim) + nx * 2 * aim, dy = uy * (1 - aim * aim) + ny * 2 * aim;
  let dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
  let p = { x: a.x, y: a.y };
  const points = [p];
  for (let i = 0; i < steps * 4; i++) {
    let gx = 0, gy = 0;
    for (const w of wells) {
      const wx = w.x - p.x, wy = w.y - p.y, r2 = wx * wx + wy * wy, r = Math.sqrt(r2);
      if (r < w.radius * CLEARANCE) return { points, miss: 0, valid: false };
      const k = w.mass * influence(r2, tuning.reach, w.radius) / r;
      gx += wx * k; gy += wy * k;
    }
    const curvature = tuning.bend * (gx * -dy + gy * dx) / tuning.reach;
    const turn = curvature * ds; [dx, dy] = [dx - dy * turn, dy + dx * turn];
    dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
    const next = { x: p.x + dx * ds, y: p.y + dy * ds };
    const before = (p.x - a.x) * ux + (p.y - a.y) * uy, after = (next.x - a.x) * ux + (next.y - a.y) * uy;
    if (after >= length) {
      const t = (length - before) / (after - before);
      const hit = { x: p.x + (next.x - p.x) * t, y: p.y + (next.y - p.y) * t };
      points.push(hit);
      return { points, miss: (hit.x - a.x) * nx + (hit.y - a.y) * ny, valid: true };
    }
    if (after < -length) break;
    p = next; points.push(p);
  }
  return { points, miss: 0, valid: false };
}

const AIMS = 61, MAX_AIM = 0.9, BISECTIONS = 48;

const pathLength = (points: readonly Point[]) => points.reduce((sum, q, i) => i ? sum + Math.hypot(q.x - points[i - 1]!.x, q.y - points[i - 1]!.y) : 0, 0);

/** Shooting method: scan headings, bisect each sign change of the miss, keep the shortest coasting course. */
function coast(start: Point, end: Point, wells: readonly Well[], tuning: Tuning): Point[] | null {
  let best: Point[] | null = null, bestLength = Infinity;
  let prevAim = -MAX_AIM, prev = fly(start, end, prevAim, wells, tuning);
  for (let i = 1; i < AIMS; i++) {
    const aim = -MAX_AIM + 2 * MAX_AIM * i / (AIMS - 1), next = fly(start, end, aim, wells, tuning);
    if (prev.valid && next.valid && Math.sign(prev.miss) !== Math.sign(next.miss)) {
      let lo = prevAim, hi = aim, loMiss = prev.miss, flight = next;
      for (let k = 0; k < BISECTIONS; k++) {
        const mid = (lo + hi) / 2;
        flight = fly(start, end, mid, wells, tuning);
        if (!flight.valid) break;
        if (Math.sign(flight.miss) === Math.sign(loMiss)) { lo = mid; loMiss = flight.miss; } else hi = mid;
      }
      const length = flight.valid ? pathLength(flight.points) : Infinity;
      if (length < bestLength) { best = flight.points.slice(0, -1).concat([{ x: end.x, y: end.y }]); bestLength = length; }
    }
    prevAim = aim; prev = next;
  }
  return best;
}

/**
 * Coast if any heading reaches the target. Otherwise (a giant would capture the course, or an antigravity shadow hides the target)
 * burn once at a waypoint beside a blocking well. Canonical direction makes A→B and B→A the same course.
 */
function shootLeg(a: Point, b: Point, wells: readonly Well[], tuning: Tuning): { points: Point[]; burns: number } {
  const swap = a.x > b.x || a.x === b.x && a.y > b.y;
  const [start, end] = swap ? [b, a] : [a, b];
  const orient = (points: Point[], burns: number) => ({ points: swap ? points.reverse() : points, burns });
  const direct = coast(start, end, wells, tuning);
  if (direct) return orient(direct, 0);
  const cx = end.x - start.x, cy = end.y - start.y, length = Math.hypot(cx, cy) || 1;
  const nx = -cy / length, ny = cx / length;
  let best: Point[] | null = null;
  for (const w of wells) for (const side of [1, -1]) {
    const offset = (tuning.reach * 0.75 + w.radius) * side;
    const waypoint = { x: w.x + nx * offset, y: w.y + ny * offset };
    const first = coast(start, waypoint, wells, tuning), second = first && coast(waypoint, end, wells, tuning);
    if (!first || !second) continue;
    const points = first.concat(second.slice(1));
    if (!best || pathLength(points) < pathLength(best)) best = points;
  }
  return best ? orient(best, 1) : orient([{ ...start }, { ...end }], 0);
}

/** True when a hauler can coast from `from` to `to` without a burn. Used to shade shadows. */
export function coastable(map: MapSize, from: Point, to: Point, wells: readonly Well[], tuning: Tuning): boolean {
  const end = nearestImage(map, from, to);
  const near = relevantWells(map, wells, from, end, tuning.reach);
  // A straight chord that never enters any influence circle is already a coasting course.
  if (near.every(w => segmentDistance(w, from, end) >= tuning.reach + w.radius)) return true;
  const swap = from.x > end.x || from.x === end.x && from.y > end.y;
  return swap ? coast(end, from, near, tuning) !== null : coast(from, end, near, tuning) !== null;
}

export function speedFactor(p: Point, wells: readonly Well[], tuning: Tuning, owner: string | null): number {
  let factor = 1;
  for (const w of wells) {
    const dx = w.x - p.x, dy = w.y - p.y;
    const strength = tuning.speedGain * Math.abs(w.mass) * influence(dx * dx + dy * dy, tuning.reach, w.radius);
    const sign = w.mass > 0 ? 1 : tuning.ownerAware && owner !== null && w.owner === owner ? 1 : -1;
    factor += sign * strength;
  }
  return Math.max(0.25, Math.min(3, factor));
}

export function plotCourse(map: MapSize, from: Point, to: Point, wells: readonly Well[], tuning: Tuning, owner: string | null, waypoints: readonly Point[] = []): Course {
  const stops: Point[] = [from];
  for (const w of [...waypoints, to]) stops.push(nearestImage(map, stops[stops.length - 1]!, w));
  const points: Point[] = [];
  let near: Well[] = [];
  let burns = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    const legWells = relevantWells(map, wells, a, b, tuning.reach);
    near = near.concat(legWells);
    const leg = shootLeg(a, b, legWells, tuning);
    burns += leg.burns;
    points.push(...(i ? leg.points.slice(1) : leg.points));
  }
  const speeds = points.map(p => tuning.baseSpeed * speedFactor(p, near, tuning, owner));
  const times = [0];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    length += seg;
    times.push(times[i - 1]! + seg / ((speeds[i]! + speeds[i - 1]!) / 2));
  }
  let straightLength = 0;
  for (let i = 1; i < stops.length; i++) straightLength += Math.hypot(stops[i]!.x - stops[i - 1]!.x, stops[i]!.y - stops[i - 1]!.y);
  const end = stops[stops.length - 1]!;
  const maxDeflection = Math.max(...points.map(p => segmentDistance(p, from, end)));
  return {
    points, times, speeds, length, duration: times[times.length - 1]!,
    straightLength, straightDuration: straightLength / tuning.baseSpeed,
    maxDeflection, burns, minSpeed: Math.min(...speeds), maxSpeed: Math.max(...speeds),
  };
}

export function positionAt(course: Course, hour: number): Point {
  const { points, times } = course;
  if (hour <= 0) return points[0]!;
  if (hour >= course.duration) return points[points.length - 1]!;
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid]! <= hour) lo = mid; else hi = mid; }
  const u = (hour - times[lo]!) / (times[hi]! - times[lo]!);
  return { x: points[lo]!.x + (points[hi]!.x - points[lo]!.x) * u, y: points[lo]!.y + (points[hi]!.y - points[lo]!.y) * u };
}

/** Greedy farthest-point placement in the chart's voids; deterministic without RNG. */
export function placeGiants(map: MapSize, sites: readonly Point[], count: number): Point[] {
  const giants: Point[] = [];
  const grid = 48;
  const torusDistance = (a: Point, b: Point) => Math.hypot(shortest(a.x - b.x, map.width), shortest(a.y - b.y, map.height));
  for (let g = 0; g < count; g++) {
    let best: Point | undefined, bestScore = -1;
    for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) {
      const p = { x: (i + 0.5) * map.width / grid, y: (j + 0.5) * map.height / grid };
      const score = Math.min(...sites.map(s => torusDistance(p, s)), ...giants.map(s => torusDistance(p, s) * 0.6));
      if (score > bestScore) { bestScore = score; best = p; }
    }
    giants.push(best!);
  }
  return giants;
}
