/** @format */
import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { DEFAULT_GAME_OPTIONS } from '../src/game/rules';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-13T12:00:00Z');
const game = createConfiguredGame(DEFAULT_GAME_OPTIONS, epoch, 314159);
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);
const core = game.rocks.find((rock) => rock.coreOf === 'you')!;

for (const offset of [0, 1])
  test(`restored core is framed without refocusing at epoch offset ${offset}`, async ({
    page,
  }, info) => {
    await page.clock.setFixedTime(new Date(epoch + offset));
    await page.addInitScript((raw) => {
      if (location.protocol.startsWith('http')) {
        localStorage.setItem('machination.game.v1', raw);
        localStorage.setItem('machination.briefing.v1', '1');
      }
    }, saved);
    await page.route('**/*', (route) =>
      ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue()
        : route.abort(),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Solo', exact: true }).click();
    const site = page
      .getByRole('button', { name: new RegExp(`^${core.name},.*intelligence core`) })
      .filter({ visible: true })
      .first();
    await expect(site).toBeInViewport();
    await site.click();
    await expect(page.getByRole('heading', { name: core.name, exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('machination.game.v1')!).game.rules.map.seed,
      ),
    ).toBe(314159);
    await page.screenshot({
      path: `.fettle/shots/solo-camera-restored-${offset}-${info.project.name}.png`,
    });
  });
