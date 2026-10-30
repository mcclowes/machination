import { expect, test } from '@playwright/test';
import { createSoloGame } from '../src/game/depletion';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-30T12:00:00Z');

for (const reserves of [24, 0]) test(`solo site inspection exposes ${reserves} remaining reserves`, async ({ page }, info) => {
  test.setTimeout(120_000);
  const game = createSoloGame({ playerCount: 2, mode: 'mining' }, epoch, 42);
  const core = game.rocks.find(r => r.coreOf === 'you')!;
  core.reserves = reserves;
  const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);
  await page.clock.install({ time: new Date(epoch) });
  await page.addInitScript(raw => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${core.name},.*intelligence core`) }).filter({ visible: true }).first().click();
  if (reserves) {
    await expect(page.getByText(/24 \/ 120 reserves · low/)).toBeVisible();
  } else {
    await expect(page.getByText(/Reserves exhausted · no production/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Drill mine/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Plan transfer ↗', exact: true })).toBeEnabled();
  }
  await page.screenshot({ path: `.fettle/shots/solo-reserves-${reserves}-${info.project.name}.png`, animations: 'disabled' });
});
