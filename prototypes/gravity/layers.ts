/**
 * ---
 * purpose: PROTOTYPE (#104). Pure helpers for optional chart layers: gravity pull vectors and travel-time contours.
 * ---
 */
import { influence, type Point, type Tuning, type Well } from './model';

/** The same steering vector `fly` uses, so arrows show which way a passing course turns. */
export function pull(p: Point, wells: readonly Well[], tuning: Tuning): Point {
  let x = 0, y = 0;
  for (const w of wells) {
    const wx = w.x - p.x, wy = w.y - p.y, r2 = wx * wx + wy * wy, r = Math.sqrt(r2);
    if (r < 1e-9) continue;
    const k = w.mass * influence(r2, tuning.reach, w.radius) / r;
    x += wx * k; y += wy * k;
  }
  return { x, y };
}

const STEPS = [0.5, 1, 2, 3, 6, 12, 24, 48];
/** Smallest readable ring interval that keeps roughly `rings` rings on the chart. */
export function ringStep(maxHours: number, rings = 5): number {
  return STEPS.find(s => maxHours / s <= rings) ?? STEPS[STEPS.length - 1]!;
}

export type Segment = [Point, Point];

/**
 * Marching squares over values sampled at cell centres (`values[i][j]` at ((i+0.5)·size, (j+0.5)·size)).
 * Squares touching a NaN (unreachable or inside a body) are skipped.
 */
export function contour(values: readonly (readonly number[])[], level: number, size: number): Segment[] {
  const segments: Segment[] = [];
  const at = (i: number, j: number): Point => ({ x: (i + 0.5) * size, y: (j + 0.5) * size });
  for (let i = 0; i < values.length - 1; i++) for (let j = 0; j < values[i]!.length - 1; j++) {
    const corners: [Point, number][] = [[at(i, j), values[i]![j]!], [at(i + 1, j), values[i + 1]![j]!], [at(i + 1, j + 1), values[i + 1]![j + 1]!], [at(i, j + 1), values[i]![j + 1]!]];
    if (corners.some(([, v]) => Number.isNaN(v))) continue;
    const crossings: Point[] = [];
    for (let k = 0; k < 4; k++) {
      const [pa, va] = corners[k]!, [pb, vb] = corners[(k + 1) % 4]!;
      if ((va < level) === (vb < level)) continue;
      const t = (level - va) / (vb - va);
      crossings.push({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t });
    }
    for (let k = 0; k + 1 < crossings.length; k += 2) segments.push([crossings[k]!, crossings[k + 1]!]);
  }
  return segments;
}
