import { expect, test, type Page } from '@playwright/test';
import { TRAINING_SCENARIOS } from '../src/game/training';
import { SPECIALISTS } from '../src/game/specialist-catalog';

async function dismissDialogue(page: Page) {
  await page.getByRole('button', { name: 'Skip dialogue', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

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
  await expect(page.getByRole('button', { name: /^Start:/ })).toHaveCount(TRAINING_SCENARIOS.length);
  await expect(page.getByText('1. Open a foothold · completed', { exact: true })).toBeVisible();
  for (const scenario of TRAINING_SCENARIOS) await expect(page.getByRole('button', { name: `Start: ${scenario.title}`, exact: true })).toHaveCount(1);
  await page.screenshot({ path: `.fettle/shots/tutorial-catalog-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Start: A test of character', exact: true }).click();
  await expect(page.getByText('Mission briefing', { exact: true })).toBeVisible();
  await dismissDialogue(page);
  await expect(page.getByText('Keep Foundry throughout and deliver the sensor courier without combat.', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/tutorial-final-mission-${info.project.name}.png` });
});

test('a new recruitment lesson completes through the rendered controls', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Start: Recruit a specialist', exact: true }).click();
  await dismissDialogue(page);
  for (let hour = 1; hour <= 4; hour++) {
    await page.getByRole('button', { name: 'Advance +1h', exact: true }).click();
    if (hour === 1) await dismissDialogue(page);
  }
  await page.getByRole('tab', { name: 'Units', exact: true }).click();
  await page.getByRole('button', { name: `Hire 2 ${SPECIALISTS.saboteur.name} for 1 credit and 5 cargo`, exact: true }).click();
  await expect(page.getByText('Exercise complete', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Chart', exact: true }).click();
  await page.getByRole('button', { name: /^Foundry,/ }).click();
  await page.getByRole('button', { name: 'Plan transfer ↗', exact: true }).click();
  if (!await page.getByRole('button', { name: 'Fit chart', exact: true }).isVisible()) await page.getByRole('button', { name: 'Map controls', exact: true }).click();
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  await page.getByRole('button', { name: /^Distant anchor,/ }).filter({ visible: true }).first().click();
  await page.getByRole('checkbox', { name: `Load ${SPECIALISTS.saboteur.name} onto the next hauler`, exact: true }).first().click();
  await page.getByRole('button', { name: 'Prepare launch · 10m', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve orders', exact: true }).click();
  await expect(page.getByText('Mission complete', { exact: true })).toBeVisible({ timeout: 15_000 });
  await dismissDialogue(page);
  await expect(page.getByText('Exercise complete', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/tutorial-recruitment-passed-${info.project.name}.png` });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('machination.training-progress.v1')!).completed)).toEqual(['first-launch', 'hiring-specialists']);
  expect(await page.evaluate(() => localStorage.getItem('machination.game.v1'))).toBe('untouched solo operation');
  expect(await page.evaluate(() => localStorage.getItem('machination.online.v1'))).toBe('untouched online credentials');
});

test('mine construction enables playback without a hauler or queued launch', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Start: Drill a mine', exact: true }).click();
  await dismissDialogue(page);
  const resolve = page.getByRole('button', { name: 'Resolve orders', exact: true });
  await expect(resolve).toBeDisabled();
  await page.getByRole('button', { name: /^Foundry,/ }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Drill mine · 50 drones', exact: true }).click();
  await expect(resolve).toBeEnabled();
  await expect(page.getByText('Exercise complete', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Live · D01 · 00:00', { exact: true })).toBeVisible();
  await resolve.click();
  await expect(page.getByText('Live · D01 · 00:00', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await dismissDialogue(page);
  await expect(resolve).toBeEnabled();
  await page.screenshot({ path: `.fettle/shots/tutorial-mine-playback-${info.project.name}.png` });
});

test('mission instructions can be hidden and restored without losing controls or hints', async ({ page }) => {
  await page.getByRole('button', { name: 'Start: A test of character', exact: true }).click();
  await dismissDialogue(page);
  const instruction = page.getByText('Keep Foundry throughout and deliver the sensor courier without combat.', { exact: true });
  await expect(instruction).toBeVisible();
  const hint = page.getByText(TRAINING_SCENARIOS.find(scenario => scenario.id === 'test-of-character')!.hints[0]!, { exact: true });
  await page.getByRole('button', { name: 'Show hint', exact: true }).click();
  await expect(hint).toBeVisible();
  await page.getByRole('button', { name: 'Hide instructions', exact: true }).click();
  await expect(instruction).toHaveCount(0);
  await expect(hint).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Advance +1h', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry exercise', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show instructions', exact: true }).click();
  await expect(instruction).toBeVisible();
  await expect(hint).toBeVisible();
});
