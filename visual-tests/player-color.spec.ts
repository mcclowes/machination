import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { DEFAULT_GAME_OPTIONS } from '../src/game/rules';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-13T12:00:00Z');
const game = createConfiguredGame(DEFAULT_GAME_OPTIONS, epoch, 314159);
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);
const coreName = game.rocks.find((rock) => rock.coreOf === 'you')!.name;

test('solo player bases use teal while unclaimed sites stay neutral', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript((raw) => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await page.route('**/*', (route) =>
    ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  const core = page.getByTestId('map-site').filter({ hasText: coreName, visible: true }).first();
  await expect(core).toBeVisible();
  await expect(core.locator('feFlood').first()).toHaveAttribute('flood-color', '#58d6c7');
  const neutral = page.getByRole('button', { name: /, unclaimed,/ }).filter({ visible: true }).first();
  await expect(neutral.locator('feFlood').first()).toHaveAttribute('flood-color', '#829195');
  await page.screenshot({ path: `.fettle/shots/solo-player-color-${info.project.name}.png` });
});

test('profile color persists and colors a new solo operation without recoloring a resumed one', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript(() => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.briefing.v1', '1');
  });
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Player profile', exact: true }).click();
  await page.getByRole('radio', { name: 'gold player color', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'gold player color', exact: true })).toBeChecked();
  await page.screenshot({ path: `.fettle/shots/profile-color-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Close player profile' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Player profile', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'gold player color', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Close player profile' }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  const core = page.getByRole('button', { name: /, core site, Mnemosyne,/ }).filter({ visible: true }).first();
  await expect(core.locator('feFlood').first()).toHaveAttribute('flood-color', '#e3ba5e');
  await page.screenshot({ path: `.fettle/shots/solo-preferred-color-${info.project.name}.png` });
  await page.getByRole('button', { name: '‹ Games', exact: true }).click();
  await page.getByRole('button', { name: 'Player profile', exact: true }).click();
  await page.getByRole('radio', { name: 'violet player color', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'violet player color', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Close player profile' }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(core.locator('feFlood').first()).toHaveAttribute('flood-color', '#e3ba5e');
});
