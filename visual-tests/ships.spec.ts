import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { advance } from '../src/game/simulation';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-13T12:00:00Z');
const game = advance(createConfiguredGame({ playerCount: 2, mode: 'pulse' }, epoch, 42), 1, { rivals: false });
const size = game.rules!.map.width;
const from = game.rocks.find(r => r.coreOf === 'you')!;
const to = game.rocks.find(r => r.coreOf === 'vesper')!;
const point = (x: number, y: number) => ({ x: size * x, y: size * y });
game.fleets = [
  { id: 1, owner: 'you', from: from.id, to: to.id, drones: 1234, departed: 0, arrives: 4, route: { from: point(0.2, 0.2), to: point(0.6, 0.2) } },
  { id: 2, owner: 'vesper', from: to.id, to: from.id, drones: 87, departed: 0, arrives: 4, route: { from: point(0.7, 0.4), to: point(0.3, 0.4) } },
  { id: 3, owner: 'you', from: from.id, to: to.id, drones: 0, departed: 0, arrives: 4, route: { from: point(0.4, 0.65), to: point(0.7, 0.35) }, specialists: [{ id: 'ship-pilot', kind: 'helmsman', owner: 'you' }] },
  { id: 4, owner: 'you', from: from.id, to: to.id, drones: 24, departed: 1.1, arrives: 4, preparing: true, route: { from, to } },
  { id: 5, owner: 'vesper', from: to.id, to: from.id, drones: 6, departed: 0, arrives: 4, enginesDisabledUntil: 1.1, route: { from: point(0.75, 0.75), to: point(0.75, 0.3) } },
];
for (const fleet of game.fleets) fleet.specialists ??= [];
game.nextId = 6;
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);

test('directional ships keep counts and inspection readable', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript(raw => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  const ship = page.getByRole('button', { name: /hauler, 1234 drones/ }).filter({ visible: true }).first();
  await expect(ship.getByTestId('ship-hull')).toBeAttached();
  expect(parseFloat((await ship.getByTestId('ship-hull').getAttribute('transform'))!.slice(7))).toBeCloseTo(0, 5);
  await expect(ship.getByText('1234', { exact: true })).toBeVisible();
  const enemy = page.getByRole('button', { name: /hauler, 87 drones/ }).filter({ visible: true }).first();
  await expect(enemy.getByTestId('ship-hull')).toBeAttached();
  expect(Math.abs(parseFloat((await enemy.getByTestId('ship-hull').getAttribute('transform'))!.slice(7)))).toBeCloseTo(180, 5);
  const preparing = page.getByRole('button', { name: /hauler, preparing launch, 24 drones/ }).filter({ visible: true }).first();
  await expect(preparing.getByTestId('ship-docked')).toBeAttached();
  await expect(preparing.getByTestId('ship-exhaust')).toHaveCount(0);
  const disabled = page.getByRole('button', { name: /hauler, engines disabled, 6 drones/ }).filter({ visible: true }).first();
  await expect(disabled.getByTestId('ship-disabled')).toBeAttached();
  await expect(disabled.getByTestId('ship-exhaust')).toHaveCount(0);
  const bounds = await ship.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `.fettle/shots/ships-chart-${info.project.name}.png` });
  await ship.click();
  await expect(page.getByTestId('hauler-inspector')).toBeVisible();
  await expect(ship).toHaveAttribute('aria-selected', 'true');
  await expect(ship.getByTestId('ship-selection')).toBeAttached();
  await expect(page.getByTestId('hauler-inspector').getByText(/1234 drones/)).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/ships-inspection-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Close hauler details', exact: true }).click();
  await expect(ship.getByTestId('ship-selection')).toHaveCount(0);
});
