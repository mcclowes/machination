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
  iterations: number;
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
  minSpeed: number;
  maxSpeed: number;
};
export type MapSize = { width: number; height: number };

export const DEFAULT_TUNING: Tuning = { bend: 1, speedGain: 0.6, reach: 10, ownerAware: true, baseSpeed: 8, samples: 48, iterations: 500 };
const CLEARANCE = 1.3;
const RELAXATION = 1.8;
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
    if (segmentDistance(image, a, b) <= reach + w.radius * CLEARANCE) result.push(image);
  }
  return result;
}

/** Canonical direction makes A→B and B→A the same physical course. */
function relaxLeg(a: Point, b: Point, wells: readonly Well[], tuning: Tuning): Point[] {
  const swap = a.x > b.x || a.x === b.x && a.y > b.y;
  const [start, end] = swap ? [b, a] : [a, b];
  const n = tuning.samples;
  const chord = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.hypot(chord.x, chord.y) || 1;
  const side = { x: -chord.y / length, y: chord.x / length };
  const h2 = (length / n) ** 2;
  const points = Array.from({ length: n + 1 }, (_, i) => ({ x: start.x + chord.x * i / n, y: start.y + chord.y * i / n }));
  for (let k = 0; k < tuning.iterations; k++) {
    for (let i = 1; i < n; i++) {
      const p = points[i]!, prev = points[i - 1]!, next = points[i + 1]!;
      const tx = next.x - prev.x, ty = next.y - prev.y, tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      let force = 0;
      for (const w of wells) {
        const dx = w.x - p.x, dy = w.y - p.y, r2 = dx * dx + dy * dy, r = Math.sqrt(r2);
        const pull = tuning.bend * w.mass / tuning.reach * influence(r2, tuning.reach, w.radius);
        // A well dead on the chord pulls straight along the normal; break the tie to the canonical left.
        force += r < 1e-9 ? pull : pull * (dx * nx + dy * ny) / r;
      }
      const targetX = (prev.x + next.x) / 2 + nx * force * h2 / 2;
      const targetY = (prev.y + next.y) / 2 + ny * force * h2 / 2;
      p.x += RELAXATION * (targetX - p.x);
      p.y += RELAXATION * (targetY - p.y);
      for (const w of wells) {
        const min = w.radius * CLEARANCE, dx = p.x - w.x, dy = p.y - w.y, r = Math.hypot(dx, dy);
        if (r >= min) continue;
        const ux = r < 1e-9 ? side.x : dx / r, uy = r < 1e-9 ? side.y : dy / r;
        p.x = w.x + ux * min; p.y = w.y + uy * min;
      }
    }
  }
  return swap ? points.reverse() : points;
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
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    const legWells = relevantWells(map, wells, a, b, tuning.reach);
    near = near.concat(legWells);
    const leg = relaxLeg(a, b, legWells, tuning);
    points.push(...(i ? leg.slice(1) : leg));
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
    maxDeflection, minSpeed: Math.min(...speeds), maxSpeed: Math.max(...speeds),
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
