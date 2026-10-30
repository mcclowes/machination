import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { advance, dispatch } from '../src/game/simulation';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-13T12:00:00Z');
let game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, epoch, 42);
const source = game.rocks.find(site => site.coreOf === 'you')!;
const target = game.rocks.find(site => !site.owner)!;
game = dispatch(game, source.id, target.id, 5, 'you');
game = advance(game, game.fleets[0]!.arrives, { rivals: false });
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);

test('recent battles appear on the chart and expire in forecast', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript(raw => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  const marker = page.locator('[id^="battle-marker-"]').first();
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('aria-label', 'Battle, just now');
  await page.screenshot({ path: `.fettle/shots/recent-battle-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Time Machine', exact: true }).click();
  await page.getByRole('button', { name: '+6h', exact: true }).click();
  await expect(page.locator('[id^="battle-marker-"]')).toHaveCount(0);
});
