import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { DEFAULT_GAME_OPTIONS } from '../src/game/rules';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';
import { waitForChartLayout } from './chart-layout';

const epoch = Date.parse('2026-10-13T12:00:00Z');
const game = createConfiguredGame(DEFAULT_GAME_OPTIONS, epoch, 314159);
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);
const coreName = game.rocks.find(rock => rock.coreOf === 'you')!.name;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript(raw => {
    if (location.protocol === 'http:' || location.protocol === 'https:') { localStorage.setItem('machination.game.v1', raw); localStorage.setItem('machination.briefing.v1', '1'); }
  }, saved);
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort();
  });
});

test('start screen retains its primary actions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Machination', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start tactical practice', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('start-screen.png');
});

test('fixed solo chart and selected site remain readable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^(Open|Resume) solo operation$/ }).click();
  const core = page.getByRole('button', { name: new RegExp('^' + coreName + ',.*intelligence core') }).filter({ visible: true }).first();
  await expect(core).toBeVisible();
  await waitForChartLayout(page);
  await core.click();
  await expect(page.getByRole('heading', { name: coreName, exact: true })).toBeVisible();
  await waitForChartLayout(page);
  await expect(page).toHaveScreenshot('solo-chart-selected-site.png');
});

test('forecast retains the chart and future-order context', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^(Open|Resume) solo operation$/ }).click();
  await expect(page.getByRole('button', { name: new RegExp('^' + coreName + ',.*intelligence core') }).filter({ visible: true }).first()).toBeVisible();
  await waitForChartLayout(page);
  await page.getByRole('button', { name: 'Time Machine', exact: true }).click();
  await page.getByRole('button', { name: '+6h', exact: true }).click();
  await expect(page.getByText(/Forecast ·/)).toBeVisible();
  await waitForChartLayout(page);
  await expect(page).toHaveScreenshot('six-hour-forecast.png');
});
