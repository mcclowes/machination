import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { advance, dispatch } from '../src/game/simulation';
import { gravityCourse } from '../src/game/gravity';
import { fleetVelocity } from '../src/game/flight';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-13T12:00:00Z');
let game = createConfiguredGame({ playerCount: 2, mode: 'mining', gravity: true }, epoch, 7);
let best = { bend: 0, from: '', to: '' };
for (const from of game.rocks.filter(r => r.owner === 'you' && r.drones > 0)) for (const to of game.rocks.filter(r => r.id !== from.id)) {
  const { route } = gravityCourse(game, from, to, 8, 0, 'you')!;
  const dx = route.to.x - route.from.x, dy = route.to.y - route.from.y;
  const bend = Math.max(...route.course!.map(p => Math.abs((p.x - from.x) * dy - (p.y - from.y) * dx) / Math.hypot(dx, dy)));
  if (bend > best.bend) best = { bend, from: from.id, to: to.id };
}
if (best.bend < 0.5) throw new Error('Visual fixture requires a visibly bent real launch.');
game = dispatch(game, best.from, best.to, 1, 'you');
const hour = (game.fleets[0]!.departed + game.fleets[0]!.arrives) / 2;
game = advance(game, hour, { rivals: false });
const velocity = fleetVelocity(game, game.fleets[0]!);
const heading = Math.atan2(velocity.y, velocity.x) * 180 / Math.PI;
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);

test('gravity giants and curved routes are visible, with ships facing along their course', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript(raw => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  await expect(page.getByTestId('gravity-body').first()).toBeAttached();
  const paths = page.getByTestId('gravity-flight-route');
  await expect(paths.first()).toBeAttached();
  expect((await paths.first().getAttribute('d'))!.split('L').length).toBeGreaterThan(10);
  const ship = page.getByRole('button', { name: /hauler, 1 drones/ }).filter({ visible: true }).first();
  await expect(ship).toBeVisible();
  expect(parseFloat((await ship.getByTestId('ship-hull').getAttribute('transform'))!.slice(7))).toBeCloseTo(heading, 5);
  await page.screenshot({ path: `.fettle/shots/gravity-chart-${info.project.name}.png` });
  await ship.click();
  await expect(page.getByTestId('hauler-inspector')).toBeVisible();
});
