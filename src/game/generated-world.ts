/** Deterministic chart sampling, independent of simulation and recruitment RNG. */
import { isFaction, type Faction } from './players';
import { OUTPOSTS_PER_PLAYER } from './rules';
import type { Rock } from './simulation';

type Point = { x: number; y: number };
type Candidate = { points: Point[]; territories: number[][]; score: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

function sampler(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(values: T[], random: () => number): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j]!, values[i]!];
  }
  return values;
}

function candidate(count: number, size: number, random: () => number): Candidate {
  const points: Point[] = [];
  for (let attempt = 0; points.length < count * OUTPOSTS_PER_PLAYER && attempt < 20000; attempt++) {
    const point = { x: 3 + random() * (size - 6), y: 3 + random() * (size - 6) };
    if (points.every(other => distance(point, other) >= 5)) points.push(point);
  }
  if (points.length !== count * OUTPOSTS_PER_PLAYER) throw new Error('Unable to space chart sites.');
  const interior = points.map((_, i) => i).filter(i => points[i]!.x > size * 0.12 && points[i]!.x < size * 0.88 && points[i]!.y > size * 0.12 && points[i]!.y < size * 0.88);
  if (interior.length < count) interior.splice(0, interior.length, ...points.map((_, i) => i));
  const starts = [interior[Math.floor(random() * interior.length)] ?? 0];
  while (starts.length < count) {
    let best = -1, bestDistance = -1;
    for (const i of interior) {
      const separation = Math.min(...starts.map(start => distance(points[i]!, points[start]!)));
      if (separation > bestDistance) { best = i; bestDistance = separation; }
    }
    starts.push(best);
  }
  const territories = starts.map(start => [start]);
  const available = new Set(points.map((_, index) => index).filter(index => !starts.includes(index)));
  // Round-robin nearest claims prevent one start from consuming another's home sites.
  for (let rank = 1; rank < OUTPOSTS_PER_PLAYER; rank++) {
    for (let player = 0; player < count; player++) {
      let nearest = -1, nearestDistance = Infinity;
      for (const index of available) {
        const d = distance(points[index]!, points[starts[player]!]!);
        if (d < nearestDistance) { nearest = index; nearestDistance = d; }
      }
      territories[player]!.push(nearest);
      available.delete(nearest);
    }
  }
  const expansionCounts = Array<number>(count).fill(0);
  const access = territories.map(() => [] as number[]);
  for (const territory of territories) for (const index of territory.slice(5)) {
    const distances = territories.map(home => Math.min(...home.slice(0, 5).map(i => distance(points[index]!, points[i]!))));
    const winner = distances.indexOf(Math.min(...distances));
    expansionCounts[winner] = expansionCounts[winner]! + 1;
    distances.forEach((d, player) => access[player]!.push(d));
  }
  const accessMeans = access.map(ds => ds.sort((a, b) => a - b).slice(0, 3).reduce((a, b) => a + b, 0) / 3);
  return { points, territories, score: spread(expansionCounts) + spread(accessMeans) / size };
}

export function generateWorld(players: readonly Faction[], seed: number): { rocks: Rock[]; width: number; height: number } {
  if (!Array.isArray(players) || players.length < 2 || players.length > 10 || new Set(players).size !== players.length || !players.every(isFaction))
    throw new Error('Choose 2–10 unique known players.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Chart seed must be a uint32.');
  const random = sampler(seed);
  const size = Math.sqrt(players.length * OUTPOSTS_PER_PLAYER * (1000 / 3));
  let best: Candidate | undefined;
  for (let attempt = 0; attempt < 500; attempt++) {
    const next = candidate(players.length, size, random);
    if (!best || next.score < best.score) best = next;
    if (best.score < 0.02) break;
  }
  const generatorCount = 3 + Math.floor(random() * 4);
  const types = shuffle(Array.from({ length: OUTPOSTS_PER_PLAYER }, (_, i): 'factory' | 'generator' => i < generatorCount ? 'generator' : 'factory'), random);
  const shields = shuffle(Array.from({ length: OUTPOSTS_PER_PLAYER }, (_, i) => i < 3 ? 10 : 20), random);
  const rocks: Rock[] = [];
  best!.territories.forEach((territory, player) => {
    territory.forEach((pointIndex, rank) => {
      const index = rocks.length;
      const id = index < 26 ? String.fromCharCode(97 + index) : `site-${String(index).padStart(3, '0')}`;
      const owner = rank < 5 ? players[player]! : null;
      const core = rank === 0;
      const shieldMax = shields[rank]!;
      rocks.push({
        id, name: core ? `${players[player]} core` : `Site ${index + 1}`, ...best!.points[pointIndex]!,
        owner, kind: types[rank]!,  drones: owner && !core ? 40 : 0,
        shield: 0, shieldMax, shieldAt: 48 / (shieldMax + (core ? 20 : 0)), shieldsDisabled: false, productionAt: 8,
        specialists: core && owner ? [{ id: `core-${owner}`, owner, kind: 'queen' }] : [],
        ...(core && owner ? { coreOf: owner } : {}),
      });
    });
  });
  return { rocks, width: size, height: size };
}
