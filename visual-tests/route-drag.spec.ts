import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { DEFAULT_GAME_OPTIONS } from '../src/game/rules';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-30T12:00:00Z');
const game = createConfiguredGame(DEFAULT_GAME_OPTIONS, epoch, 314159);
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);

for (const steps of [1, 20]) test(`dragging from a selected solo base plots a route (${steps} mouse moves)`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript(raw => {
    localStorage.setItem('machination.game.v1', raw);
    localStorage.setItem('machination.briefing.v1', '1');
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('button', { name: 'Focus your territory', exact: true }).click();
  const core = game.rocks.find(rock => rock.coreOf === 'you')!;
  const source = page.getByRole('button', { name: new RegExp(`^${core.name},`) }).filter({ visible: true }).first();
  await source.click();
  await expect(page.getByRole('button', { name: `Close ${core.name}`, exact: true })).toBeVisible();
  const candidates = page.getByTestId('belt-map').getByRole('button').filter({ visible: true });
  const from = (await source.boundingBox())!;
  let to: { x: number; y: number; width: number; height: number } | undefined;
  const chart = (await page.getByTestId('belt-map').boundingBox())!;
  for (const candidate of await candidates.all()) {
    const label = await candidate.getAttribute('aria-label');
    if (!label?.includes(' drones') || label.startsWith(`${core.name},`)) continue;
    const bounds = await candidate.boundingBox();
    if (bounds && bounds.x > chart.x + 32 && bounds.x + bounds.width < chart.x + chart.width - 32 && bounds.y > chart.y + 32 && bounds.y + bounds.height < chart.y + chart.height - 32) { to = bounds; break; }
  }
  expect(to).toBeDefined();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps });
  await expect.soft(page.getByText(/^Release at /)).toBeVisible();
  await page.mouse.up();
  await expect(page.getByLabel('Drones to dispatch', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /transfer destination/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /hauler, preparing launch/ })).toHaveCount(0);
  await page.screenshot({ path: `.fettle/shots/solo-route-drag-${info.project.name}-${steps}.png` });
});

for (const steps of [1, 20]) test(`dragging from a base plots a route without launching (${steps} mouse moves)`, async ({ page }, info) => {
  page.on('pageerror', error => { throw error; });
  await page.addInitScript(() => localStorage.setItem('machination.briefing.v1', '1'));
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Start tactical practice', exact: true }).click();
  await page.getByRole('button', { name: 'Start: Open a foothold', exact: true }).click();
  await page.getByRole('button', { name: 'Skip dialogue', exact: true }).click();
  const source = page.getByRole('button', { name: /^Foundry,/ }).filter({ visible: true }).first();
  const target = page.getByRole('button', { name: /^Quiet landing,/ }).filter({ visible: true }).first();
  await expect(source).toBeInViewport();
  await expect(target).toBeInViewport();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps });
  await expect.soft(page.getByText('Release at Quiet landing', { exact: true })).toBeVisible();
  await page.mouse.up();
  await expect(page.getByLabel('Drones to dispatch', { exact: true })).toBeVisible();
  await expect(target).toHaveAttribute('aria-label', /transfer destination/);
  await expect(page.getByRole('button', { name: /hauler, preparing launch/ })).toHaveCount(0);
  await page.screenshot({ path: `.fettle/shots/route-drag-${info.project.name}-${steps}.png` });
});
