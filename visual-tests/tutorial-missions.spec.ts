import { expect, test } from '@playwright/test';
import { TRAINING_SCENARIOS } from '../src/game/training';
import { SPECIALISTS } from '../src/game/specialist-catalog';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!location.protocol.startsWith('http')) return;
    localStorage.setItem('machination.briefing.v1', '1');
    localStorage.setItem('machination.game.v1', 'untouched solo operation');
    localStorage.setItem('machination.online.v1', 'untouched online credentials');
    localStorage.setItem('machination.training-progress.v1', JSON.stringify({ version: 1, contentVersion: 1, completed: ['first-launch'] }));
  });
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Start tactical practice', exact: true }).click();
});

test('all catalog missions and existing completion marks are reachable', async ({ page }, info) => {
  await expect(page.getByRole('button', { name: /^Start:/ })).toHaveCount(28);
  await expect(page.getByText('1. Open a foothold · completed', { exact: true })).toBeVisible();
  for (const scenario of TRAINING_SCENARIOS) await expect(page.getByRole('button', { name: `Start: ${scenario.title}`, exact: true })).toHaveCount(1);
  await page.screenshot({ path: `.fettle/shots/tutorial-catalog-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Start: A test of character', exact: true }).click();
  await expect(page.getByText('Mission briefing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip dialogue', exact: true }).click();
  await expect(page.getByText('Save the core at Foundry while Vesper takes Core berth.', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/tutorial-final-mission-${info.project.name}.png` });
});

test('a new recruitment lesson completes through the rendered controls', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Start: Recruit a specialist', exact: true }).click();
  await page.getByRole('button', { name: 'Skip dialogue', exact: true }).click();
  for (let hour = 1; hour <= 4; hour++) {
    await page.getByRole('button', { name: 'Advance +1h', exact: true }).click();
    if (hour === 1) await page.getByRole('button', { name: 'Skip dialogue', exact: true }).click();
  }
  await page.getByRole('tab', { name: 'Units', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^Hire (?:1 )?${SPECIALISTS.lieutenant.name} for 1 credit and 5 cargo$`) }).click();
  await expect(page.getByText('Mission complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip dialogue', exact: true }).click();
  await expect(page.getByText('Exercise complete', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/tutorial-recruitment-passed-${info.project.name}.png` });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('machination.training-progress.v1')!).completed)).toEqual(['first-launch', 'hiring-specialists']);
  expect(await page.evaluate(() => localStorage.getItem('machination.game.v1'))).toBe('untouched solo operation');
  expect(await page.evaluate(() => localStorage.getItem('machination.online.v1'))).toBe('untouched online credentials');
});
