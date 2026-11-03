import { expect, test } from '@playwright/test';
import { createSoloGame } from '../src/game/depletion';
import { advance } from '../src/game/simulation';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const now = Date.parse('2026-11-03T10:00:00Z');
const initial = createSoloGame({ playerCount: 10, mode: 'mining', driftingBases: false, gravity: true }, now, 0);
const game = advance(initial, 3, { rivals: true });
const saved = encodeOperation({ game, archive: createArchive(initial, { rivals: true }) }, now - 3 * 3_600_000);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(raw => {
    localStorage.setItem('machination.game.v1', raw);
    localStorage.setItem('machination.briefing.v1', '1');
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
});

test('solo restoration yields to chart controls and preserves its save when canceled', async ({ page }) => {
  await page.getByRole('button', { name: /^(Open|Resume) solo operation$/ }).click();
  await expect(page.getByText('Restoring saved history and catching up…')).toBeVisible();
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Solo operation', exact: true })).toBeVisible();
  await expect(page.getByText('Restoring saved history and catching up…')).toBeVisible();
  await page.getByRole('button', { name: '‹ Games', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume solo operation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('machination.game.v1'))).toBe(saved);
});

test('solo restore completes with its validated history and full offline catch-up', async ({ page }, info) => {
  await page.getByRole('button', { name: /^(Open|Resume) solo operation$/ }).click();
  await expect(page.getByText('Restoring saved history and catching up…')).toBeHidden({ timeout: 50_000 });
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('machination.game.v1');
    return raw ? JSON.parse(raw).game.hour : null;
  })).toBe(6);
  await page.screenshot({ path: `.fettle/shots/solo-restored-${info.project.name}.png` });
});
