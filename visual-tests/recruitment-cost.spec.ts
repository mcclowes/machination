import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { advance } from '../src/game/simulation';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-30T12:00:00Z');

for (const cargo of [4, 5]) test(`recruitment displays and enforces the five-cargo fee with ${cargo} cargo`, async ({ page }, info) => {
  const game = advance(createConfiguredGame({ playerCount: 2, mode: 'mining' }, epoch, 73), 3, { rivals: false });
  game.cargo.you = cargo;
  const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);
  await page.clock.install({ time: new Date(epoch) });
  await page.addInitScript(raw => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('tab', { name: 'Units', exact: true }).click();
  const hire = page.getByRole('button', { name: /^Hire .* for 1 credit and 5 cargo$/ }).first();
  await expect(hire).toBeVisible();
  if (cargo < 5) {
    await expect(hire).toBeDisabled();
    await expect(page.getByText('4 cargo available. Recruitment needs 5 cargo.', { exact: true })).toBeVisible();
  } else {
    await expect(hire).toBeEnabled();
    await expect(page.getByText('5 cargo available.', { exact: true })).toBeVisible();
    await hire.click();
    await expect(page.getByText('0 cargo available. Recruitment needs 5 cargo.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Hire .* for 1 credit and 5 cargo$/ }).first()).toBeDisabled();
  }
  await page.screenshot({ path: `.fettle/shots/recruitment-${cargo}-cargo-${info.project.name}.png` });
});
