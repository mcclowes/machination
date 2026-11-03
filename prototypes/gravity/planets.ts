// PROTOTYPE (#104): measures what planetary sites (option B) do to courses on real generated charts.
// Run from the repo root: npx tsx prototypes/gravity/planets.ts
import { generateWorld } from '../../src/game/generated-world';
import { ALL_PLAYERS } from '../../src/game/players';
import { DEFAULT_TUNING, placeGiants, plotCourse, type Course, type Point, type Well } from './model';

type Planets = { label: string; mass: number; reach: number; radius: number; every: number };
const CONFIGS: Planets[] = [
  { label: 'm0.3 r4', mass: 0.3, reach: 4, radius: 0.6, every: 5 },
  { label: 'm0.5 r4', mass: 0.5, reach: 4, radius: 0.6, every: 5 },
  { label: 'm0.3 r6', mass: 0.3, reach: 6, radius: 0.6, every: 5 },
  { label: 'm0.5 r6', mass: 0.5, reach: 6, radius: 0.6, every: 5 },
  { label: 'm0.8 r6', mass: 0.8, reach: 6, radius: 0.6, every: 5 },
];
const PLAYER_COUNTS = [2, 4, 6, 8];
const SEEDS = [1, 2, 3, 4, 5];
const MAX_HOP = 30; // Ignore cross-chart routes nobody sends in practice.

const quantile = (values: number[], q: number) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const torus = (size: number, a: Point, b: Point) => {
  const d = (v: number) => { const m = Math.abs(v) % size; return Math.min(m, size - m); };
  return Math.hypot(d(a.x - b.x), d(a.y - b.y));
};
/** Largest gap between two courses, sampled at matching fractions of their length. */
function separation(a: Course, b: Course): number {
  const at = (c: Course, u: number): Point => {
    const target = u * c.length; let walked = 0;
    for (let i = 1; i < c.points.length; i++) {
      const p = c.points[i - 1]!, q = c.points[i]!, seg = Math.hypot(q.x - p.x, q.y - p.y);
      if (walked + seg >= target) { const t = seg ? (target - walked) / seg : 0; return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }
      walked += seg;
    }
    return c.points.at(-1)!;
  };
  let gap = 0;
  for (let k = 0; k <= 24; k++) { const p = at(a, k / 24), q = at(b, k / 24); gap = Math.max(gap, Math.hypot(p.x - q.x, p.y - q.y)); }
  return gap;
}

type Row = { routes: number; touched: number; bentByGiants: number; deltas: number[]; signed: number[]; burns: number; ms: number; overlapping: number; planets: number };
const rows = new Map<string, Row>();
for (const players of PLAYER_COUNTS) for (const seed of SEEDS) {
  const { rocks, width } = generateWorld(ALL_PLAYERS.slice(0, players), seed, true);
  const map = { width, height: width };
  const giants: Well[] = placeGiants(map, rocks, Math.max(2, Math.ceil(players / 2))).map((p, i) => ({ ...p, id: `giant-${i + 1}`, mass: 1, radius: 1.5 }));
  const pairs: [Point, Point][] = [];
  for (let i = 0; i < rocks.length; i++) for (let j = i + 1; j < rocks.length; j++) if (torus(width, rocks[i]!, rocks[j]!) <= MAX_HOP) pairs.push([rocks[i]!, rocks[j]!]);
  const baseline = pairs.map(([a, b]) => plotCourse(map, a, b, giants, DEFAULT_TUNING, null));
  for (const config of CONFIGS) {
    // Public site order is already shuffled, so every fifth site is an unbiased sample for measurement.
    const planets: Well[] = rocks.filter((_, i) => i % config.every === 0).map(r => ({ id: `planet-${r.id}`, x: r.x, y: r.y, mass: config.mass, radius: config.radius, reach: config.reach }));
    const wells = [...giants, ...planets];
    const key = `${players}p ${config.label}`;
    const row = rows.get(key) ?? { routes: 0, touched: 0, bentByGiants: 0, deltas: [], signed: [], burns: 0, ms: 0, overlapping: 0, planets: 0 };
    row.planets += planets.length;
    for (const p of planets) if (planets.some(q => q !== p && torus(width, p, q) < 2 * (config.reach + config.radius))) row.overlapping++;
    pairs.forEach(([a, b], k) => {
      const start = performance.now();
      const course = plotCourse(map, a, b, wells, DEFAULT_TUNING, null);
      row.ms += performance.now() - start;
      const base = baseline[k]!, delta = course.duration / base.duration - 1;
      row.routes++;
      if (base.maxDeflection > 0.25) row.bentByGiants++;
      if (separation(course, base) > 0.25 || Math.abs(delta) > 0.01) { row.touched++; row.deltas.push(Math.abs(delta)); }
      row.signed.push(delta);
      row.burns += course.burns - base.burns;
    });
    rows.set(key, row);
  }
}

console.log(`Planets: every 5th site (20%), radius 0.6. Giants unchanged. Routes: site pairs within ${MAX_HOP}u, ${SEEDS.length} seeds each.\n`);
console.log(['chart', 'planets', 'reach overlaps', 'routes', 'giants bend', 'planets change', 'median |ΔETA| of changed', 'p90 |ΔETA|', 'mean ΔETA all', 'extra burns', 'ms/course'].join(' | '));
for (const [key, r] of rows) console.log([
  key, (r.planets / SEEDS.length).toFixed(0), pct(r.overlapping / r.planets), r.routes, pct(r.bentByGiants / r.routes), pct(r.touched / r.routes),
  pct(quantile(r.deltas, 0.5)), pct(quantile(r.deltas, 0.9)), pct(r.signed.reduce((s, v) => s + v, 0) / r.signed.length), r.burns, (r.ms / r.routes).toFixed(2),
].join(' | '));
