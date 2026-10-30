import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-13T12:00:00Z');
const game = createConfiguredGame({ playerCount: 2, mode: 'pulse' }, epoch, 42);
const core = game.rocks.find(r => r.coreOf === 'you')!;
core.specialists!.push({ id: 'visual-disruptor', kind: 'disruptor', owner: 'you' });
game.cargo.you = 100;
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);

test('Disruptor controls commit material and display an independent fading wave', async ({ page }, info) => {
  await page.clock.install({ time: new Date(epoch) });
  await page.addInitScript(raw => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  const site = page.getByRole('button', { name: new RegExp(`^${core.name},.*intelligence core`) }).filter({ visible: true }).first();
  await site.click();
  const material = page.getByRole('textbox', { name: 'Tactical pulse material' });
  await material.fill('26');
  await expect(page.getByRole('button', { name: 'Charge Disruptor', exact: true })).toBeDisabled();
  await material.fill('20');
  await page.getByRole('button', { name: 'Charge Disruptor', exact: true }).click();
  await expect(page.getByText('Movement cancels this charge without a refund.', { exact: true })).toBeVisible();
  await expect(page.getByText(/available 80/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel Disruptor charge', exact: true }).click();
  await expect(page.getByText(/available 80/)).toBeVisible();
  await page.getByRole('button', { name: 'Charge Disruptor', exact: true }).click();
  await expect(page.getByText(/available 60/)).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/disruptor-charging-${info.project.name}.png` });
  await page.clock.fastForward(45 * 60_000);
  const wave = page.locator('[id^="tactical-wave-"]').first();
  await expect(wave).toBeAttached();
  await expect(wave).toHaveAttribute('stroke-width', '1');
  expect(Number(await wave.getAttribute('stroke-opacity'))).toBeGreaterThan(0);
  expect(Number(await wave.getAttribute('stroke-opacity'))).toBeLessThan(1);
  await expect(page.getByRole('button', { name: 'Charge Disruptor', exact: true })).toBeEnabled();
  await page.screenshot({ path: `.fettle/shots/disruptor-wave-${info.project.name}.png` });
});
