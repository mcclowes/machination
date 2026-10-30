/**
 * ---
 * purpose: PROTOTYPE (#104). Canvas sandbox for gravity courses on a real generated chart. Throwaway.
 * ---
 */
import { generateWorld } from '../../src/game/generated-world';
import type { Faction } from '../../src/game/players';
import { contour, pull, ringStep } from './layers';
import { coastable, DEFAULT_TUNING, placeGiants, plotCourse, positionAt, speedFactor, wrapPoint, type Course, type Point, type Tuning, type Well } from './model';

const PLAYERS: Faction[] = ['you', 'vesper', 'null'];
const OWNER_COLORS: Record<string, string> = { you: '#4fb3ff', vesper: '#ff6b6b', null: '#e0c84f', aether: '#ff9ae6', umbra: '#9a9aff', orbit: '#5fe0e0' };
const SPEED_UP = '#7be08a', SLOW_DOWN = '#ff8a5c';
type Mode = 'select' | 'antigravity' | 'waypoint';
type Site = { id: string; name: string; x: number; y: number; owner: string | null; kind: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('chart');
const ctx = canvas.getContext('2d')!;

const state = {
  seed: 7, players: 3, giants: 3, giantMass: 1, giantRadius: 3.5, siteMass: 0, antigravityMass: 1.5,
  tuning: { ...DEFAULT_TUNING } as Tuning,
  mode: 'select' as Mode, antigravityOwner: 'you',
  sites: [] as Site[], width: 100, height: 100,
  antigravity: [] as Well[], waypoints: [] as Point[],
  from: null as Site | null, to: null as Site | null,
  allRoutes: false, field: false, chord: true, shadows: true, rings: false, pull: false,
  shadowCells: [] as Point[], shadowKey: '',
  travelTimes: [] as number[][], travelKey: '',
  course: null as Course | null, launchedAt: null as number | null, hour: 0, playRate: 2,
};

function rebuildWorld(): void {
  const world = generateWorld(PLAYERS.slice(0, state.players).concat((['aether', 'umbra', 'orbit'] as Faction[]).slice(0, Math.max(0, state.players - 3))), state.seed, true);
  state.sites = world.rocks.map(r => ({ id: r.id, name: r.name, x: r.x, y: r.y, owner: r.owner, kind: r.kind }));
  state.width = world.width; state.height = world.height;
  state.from = state.to = null; state.waypoints = []; state.antigravity = []; state.course = null; state.launchedAt = null;
}

function wells(excluding: readonly string[] = []): Well[] {
  const giants = placeGiants(state, state.sites, state.giants).map((p, i): Well => ({ id: `giant-${i}`, ...p, mass: state.giantMass, radius: state.giantRadius }));
  const sites = state.siteMass > 0 ? state.sites.filter(s => !excluding.includes(s.id)).map((s): Well => ({ id: s.id, x: s.x, y: s.y, mass: state.siteMass * (s.kind === 'core' ? 2 : 1), radius: 1 })) : [];
  const anti = state.antigravity.map(w => ({ ...w, mass: -state.antigravityMass }));
  return [...giants, ...sites, ...anti];
}

function course(from: Site, to: Site, waypoints: readonly Point[] = []): Course {
  return plotCourse(state, from, to, wells([from.id, to.id]), state.tuning, from.owner, waypoints);
}

const scale = () => canvas.width / state.width;
const toCanvas = (p: Point) => ({ x: p.x * scale(), y: p.y * scale() });
const toWorld = (x: number, y: number) => ({ x: x / scale(), y: y / scale() });

function eachImage(draw: (ox: number, oy: number) => void): void {
  for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) draw(ox * canvas.width, oy * canvas.height);
}

function drawField(all: Well[]): void {
  const cells = 50, size = canvas.width / cells;
  const owner = state.from?.owner ?? 'you';
  const images = all.flatMap(w => [-1, 0, 1].flatMap(ox => [-1, 0, 1].map(oy => ({ ...w, x: w.x + ox * state.width, y: w.y + oy * state.height }))));
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const f = speedFactor(toWorld((i + 0.5) * size, (j + 0.5) * size), images, state.tuning, owner);
    if (Math.abs(f - 1) < 0.03) continue;
    ctx.fillStyle = f > 1 ? `rgba(123,224,138,${Math.min(0.5, (f - 1) * 0.5)})` : `rgba(255,138,92,${Math.min(0.5, (1 - f) * 0.9)})`;
    ctx.fillRect(i * size, j * size, size + 0.5, size + 0.5);
  }
}

const SHADOW_CELLS = 45;

/** Cells a coasting hauler from the selected site can't reach. Cached because each cell is a full course solve. */
function shadowCells(all: Well[]): Point[] {
  const from = state.from!;
  const key = JSON.stringify([from.id, all, state.tuning, state.sites.length, state.seed]);
  if (key === state.shadowKey) return state.shadowCells;
  const blocking = all.filter(w => w.id !== from.id);
  const size = state.width / SHADOW_CELLS, cells: Point[] = [];
  for (let i = 0; i < SHADOW_CELLS; i++) for (let j = 0; j < SHADOW_CELLS; j++) {
    const p = { x: (i + 0.5) * size, y: (j + 0.5) * size };
    if (blocking.some(w => Math.hypot(w.x - p.x, w.y - p.y) < w.radius * 1.3)) continue;
    if (!coastable(state, from, p, blocking, state.tuning)) cells.push(p);
  }
  state.shadowKey = key; state.shadowCells = cells;
  return cells;
}

function drawShadows(all: Well[]): void {
  const size = canvas.width / SHADOW_CELLS;
  ctx.fillStyle = 'rgba(150, 110, 255, 0.28)';
  for (const p of shadowCells(all)) {
    const c = toCanvas(p);
    ctx.fillRect(c.x - size / 2, c.y - size / 2, size + 0.5, size + 0.5);
  }
}

const RING_CELLS = 30;
// Coarser integration is ~3× faster and within 0.01h of the full solve, which is plenty for contours.
const RING_SAMPLES = 16;

/** Hours from the selected site to each cell centre, NaN inside a body's clearance. Cached; each cell is a full course solve. */
function travelTimes(all: Well[]): number[][] {
  const from = state.from!;
  const key = JSON.stringify([from.id, all, state.tuning, state.sites.length, state.seed]);
  if (key === state.travelKey) return state.travelTimes;
  const blocking = all.filter(w => w.id !== from.id);
  const size = state.width / RING_CELLS, tuning = { ...state.tuning, samples: RING_SAMPLES };
  state.travelTimes = Array.from({ length: RING_CELLS }, (_, i) => Array.from({ length: RING_CELLS }, (_, j) => {
    const p = { x: (i + 0.5) * size, y: (j + 0.5) * size };
    if (blocking.some(w => Math.hypot(w.x - p.x, w.y - p.y) < w.radius * 1.3)) return NaN;
    return plotCourse(state, from, p, blocking, tuning, from.owner).duration;
  }));
  state.travelKey = key;
  return state.travelTimes;
}

/** Repeat the first row and column so contours close across the torus seam. */
const wrapGrid = (values: number[][]) => [...values, values[0]!].map(col => [...col, col[0]!]);

function drawRings(all: Well[]): void {
  const times = travelTimes(all);
  const max = Math.max(...times.flat().filter(t => !Number.isNaN(t)));
  const step = ringStep(max), size = canvas.width / RING_CELLS, origin = toCanvas(state.from!);
  ctx.strokeStyle = '#7fd8ffaa'; ctx.lineWidth = 1.25;
  for (let level = step; level < max; level += step) {
    const segments = contour(wrapGrid(times), level, size);
    ctx.beginPath();
    for (const [a, b] of segments) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    // Label where the ring crosses the ray toward the chart centre, so labels stack into a readable scale with room around them.
    const ray = { x: canvas.width / 2 - origin.x, y: canvas.height / 2 - origin.y }, rayLength = Math.hypot(ray.x, ray.y) || 1;
    const offRay = (a: Point) => Math.abs(((a.x - origin.x) * ray.y - (a.y - origin.y) * ray.x) / rayLength);
    const along = (a: Point) => ((a.x - origin.x) * ray.x + (a.y - origin.y) * ray.y) / rayLength;
    // Prefer the nearest crossing so wrapped copies of a ring on the far side of the torus lose.
    const score = (a: Point) => offRay(a) + along(a) * 0.5;
    const anchor = segments.map(([a]) => a).filter(a => along(a) > 0).reduce<Point | null>((best, a) => !best || score(a) < score(best) ? a : best, null);
    if (anchor) label(toWorld(anchor.x, anchor.y), `${level}h`, '#7fd8ff', 4);
  }
}

const PULL_CELLS = 28;

function drawPull(all: Well[]): void {
  const size = canvas.width / PULL_CELLS;
  const images = all.flatMap(w => [-1, 0, 1].flatMap(ox => [-1, 0, 1].map(oy => ({ ...w, x: w.x + ox * state.width, y: w.y + oy * state.height }))));
  ctx.lineWidth = 1.25;
  for (let i = 0; i < PULL_CELLS; i++) for (let j = 0; j < PULL_CELLS; j++) {
    const cx = (i + 0.5) * size, cy = (j + 0.5) * size;
    const g = pull(toWorld(cx, cy), images, state.tuning), m = Math.hypot(g.x, g.y);
    if (m < 0.02) continue;
    const len = Math.min(size * 0.85, size * 1.6 * m), ux = g.x / m, uy = g.y / m;
    const x0 = cx - ux * len / 2, y0 = cy - uy * len / 2, x1 = cx + ux * len / 2, y1 = cy + uy * len / 2;
    ctx.strokeStyle = `rgba(201,162,255,${Math.min(0.9, 0.25 + m)})`;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * 4 + uy * 3, y1 - uy * 4 - ux * 3);
    ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * 4 - uy * 3, y1 - uy * 4 + ux * 3);
    ctx.stroke();
  }
}

function drawPath(points: readonly Point[], color: string, width: number, dash: number[] = []): void {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  eachImage((ox, oy) => {
    ctx.beginPath();
    points.forEach((p, i) => { const c = toCanvas(p); i ? ctx.lineTo(c.x + ox, c.y + oy) : ctx.moveTo(c.x + ox, c.y + oy); });
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

/** Colour each segment by local speed so slingshot stretches are visible. */
function drawCourse(c: Course): void {
  const base = state.tuning.baseSpeed;
  eachImage((ox, oy) => {
    for (let i = 1; i < c.points.length; i++) {
      const a = toCanvas(c.points[i - 1]!), b = toCanvas(c.points[i]!);
      const f = (c.speeds[i]! + c.speeds[i - 1]!) / 2 / base;
      ctx.strokeStyle = Math.abs(f - 1) < 0.05 ? '#e8e8f0' : f > 1 ? SPEED_UP : SLOW_DOWN;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x + ox, a.y + oy); ctx.lineTo(b.x + ox, b.y + oy); ctx.stroke();
    }
  });
}

function dot(p: Point, r: number, fill: string, stroke?: string): void {
  const c = toCanvas(wrapPoint(state, p));
  eachImage((ox, oy) => {
    ctx.beginPath(); ctx.arc(c.x + ox, c.y + oy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  });
}

function label(p: Point, text: string, color: string, dy = -10): void {
  const c = toCanvas(p);
  ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = '#0b0d14cc'; const w = ctx.measureText(text).width + 6;
  ctx.fillRect(c.x - w / 2, c.y + dy - 10, w, 13);
  ctx.fillStyle = color; ctx.fillText(text, c.x, c.y + dy);
}

function render(): void {
  ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const all = wells();
  if (state.field) drawField(all);
  if (state.shadows && state.from) drawShadows(wells([state.from.id]));
  if (state.pull) drawPull(all);
  if (state.rings && state.from) drawRings(wells([state.from.id]));

  for (const w of all) {
    if (w.id.startsWith('giant')) {
      const reach = (state.tuning.reach + w.radius) * scale();
      const c = toCanvas(w);
      eachImage((ox, oy) => { ctx.beginPath(); ctx.arc(c.x + ox, c.y + oy, reach, 0, Math.PI * 2); ctx.strokeStyle = '#c9a2ff55'; ctx.lineWidth = 1; ctx.stroke(); });
      dot(w, w.radius * scale(), '#6b4fa8', '#c9a2ff');
    } else if (w.mass < 0) {
      const reach = (state.tuning.reach + w.radius) * scale(), c = toCanvas(w), color = OWNER_COLORS[w.owner ?? ''] ?? '#fff';
      eachImage((ox, oy) => { ctx.beginPath(); ctx.arc(c.x + ox, c.y + oy, reach, 0, Math.PI * 2); ctx.strokeStyle = `${color}66`; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); });
      dot(w, 8, '#1a1a24', color);
    }
  }

  if (state.from && state.allRoutes) {
    for (const s of state.sites) {
      if (s === state.from) continue;
      const c = course(state.from, s);
      drawPath(c.points, '#ffffff26', 1);
      const delta = c.duration / c.straightDuration - 1;
      label(s, `${c.duration.toFixed(1)}h`, Math.abs(delta) < 0.03 ? '#ccc' : delta < 0 ? SPEED_UP : SLOW_DOWN, 18);
    }
  }

  if (state.course) {
    if (state.chord) drawPath([state.course.points[0]!, ...state.waypoints, state.course.points[state.course.points.length - 1]!], '#ffffff55', 1, [4, 4]);
    drawCourse(state.course);
  }
  for (const p of state.waypoints) dot(p, 4, '#fff');

  for (const s of state.sites) {
    const selected = s === state.from || s === state.to;
    dot(s, s.kind === 'core' ? 7 : 5, OWNER_COLORS[s.owner ?? ''] ?? '#666', selected ? '#fff' : undefined);
  }

  if (state.course && state.launchedAt !== null) {
    const c = state.course;
    const h = Math.min(state.hour, c.duration);
    const straightEnd = c.points[c.points.length - 1]!, straightStart = c.points[0]!;
    const u = Math.min(1, h / c.straightDuration);
    dot({ x: straightStart.x + (straightEnd.x - straightStart.x) * u, y: straightStart.y + (straightEnd.y - straightStart.y) * u }, 4, '#ffffff66');
    dot(positionAt(c, h), 6, '#ffd84f', '#000');
  }
  readout();
}

function readout(): void {
  const c = state.course;
  const lines: string[] = [];
  if (!state.from) lines.push('Click a site to start a course.');
  else if (!c) lines.push(`From ${state.from.name}. Click a destination.`);
  if (c && state.from && state.to) {
    const delta = (c.duration / c.straightDuration - 1) * 100;
    lines.push(
      `${state.from.name} → ${state.to.name}${state.waypoints.length ? ` via ${state.waypoints.length} waypoint(s)` : ''}`,
      `straight  ${c.straightLength.toFixed(1)}u  ${c.straightDuration.toFixed(2)}h`,
      `gravity   ${c.length.toFixed(1)}u  ${c.duration.toFixed(2)}h  (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)`,
      `bend      ${c.maxDeflection.toFixed(1)}u off chord, ${c.burns ? `${c.burns} burn(s)` : 'coasting'}`,
      `speed     ${c.minSpeed.toFixed(1)}–${c.maxSpeed.toFixed(1)} u/h (base ${state.tuning.baseSpeed})`,
    );
    if (state.launchedAt !== null) lines.push(`flight    ${Math.min(state.hour, c.duration).toFixed(2)}h / ${c.duration.toFixed(2)}h`);
  }
  $('readout').textContent = lines.join('\n');
}

function replot(): void {
  state.course = state.from && state.to ? course(state.from, state.to, state.waypoints) : null;
  render();
}

function siteAt(p: Point): Site | undefined {
  return state.sites.find(s => Math.hypot(s.x - p.x, s.y - p.y) < 2.5);
}

canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect();
  const p = toWorld((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height);
  if (state.mode === 'antigravity') {
    state.antigravity.push({ id: `anti-${state.antigravity.length}`, ...p, mass: -state.antigravityMass, radius: 1.5, owner: state.antigravityOwner });
    return replot();
  }
  if (state.mode === 'waypoint') { state.waypoints.push(p); return replot(); }
  const site = siteAt(p);
  if (!site) return;
  if (!state.from || state.to) { state.from = site; state.to = null; state.waypoints = []; state.launchedAt = null; }
  else if (site !== state.from) state.to = site;
  replot();
});

function bindNumber(id: string, apply: (value: number) => void, rebuild = false): void {
  const input = $<HTMLInputElement>(id);
  const output = document.querySelector(`output[for="${id}"]`);
  const update = () => { apply(Number(input.value)); if (output) output.textContent = input.value; if (rebuild) rebuildWorld(); replot(); };
  input.addEventListener('input', update);
  if (output) output.textContent = input.value;
  apply(Number(input.value));
}
function bindCheck(id: string, apply: (value: boolean) => void): void {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('change', () => { apply(input.checked); replot(); });
  apply(input.checked);
}

bindNumber('seed', v => { state.seed = v; }, true);
bindNumber('players', v => { state.players = v; }, true);
bindNumber('giants', v => { state.giants = v; });
bindNumber('giantMass', v => { state.giantMass = v; });
bindNumber('giantRadius', v => { state.giantRadius = v; });
bindNumber('siteMass', v => { state.siteMass = v; });
bindNumber('antigravityMass', v => { state.antigravityMass = v; });
bindNumber('bend', v => { state.tuning.bend = v; });
bindNumber('speedGain', v => { state.tuning.speedGain = v; });
bindNumber('reach', v => { state.tuning.reach = v; });
bindNumber('playRate', v => { state.playRate = v; });
bindCheck('ownerAware', v => { state.tuning.ownerAware = v; });
bindCheck('allRoutes', v => { state.allRoutes = v; });
bindCheck('field', v => { state.field = v; });
bindCheck('rings', v => { state.rings = v; });
bindCheck('pull', v => { state.pull = v; });
bindCheck('chord', v => { state.chord = v; });
bindCheck('shadows', v => { state.shadows = v; });
$<HTMLSelectElement>('mode').addEventListener('change', e => { state.mode = (e.target as HTMLSelectElement).value as Mode; });
$<HTMLSelectElement>('antiOwner').addEventListener('change', e => { state.antigravityOwner = (e.target as HTMLSelectElement).value; });
$('clear').addEventListener('click', () => { state.antigravity = []; state.waypoints = []; state.launchedAt = null; replot(); });
$('launch').addEventListener('click', () => { if (!state.course) return; state.launchedAt = performance.now(); state.hour = 0; });

function tick(now: number): void {
  if (state.launchedAt !== null && state.course) {
    state.hour = (now - state.launchedAt) / 1000 * state.playRate;
    render();
    if (state.hour > state.course.duration + 1) state.launchedAt = null;
  }
  requestAnimationFrame(tick);
}

rebuildWorld();
replot();
requestAnimationFrame(tick);
