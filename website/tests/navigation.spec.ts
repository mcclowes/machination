import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('learners can follow the tutorial to a worked combat example', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  if (process.env.MACHINATION_DOCS_SCREENSHOTS === '1') {
    await page.screenshot({ path: resolve(__dirname, `../../.fettle/shots/player-guide-${testInfo.project.name}.png`), fullPage: true });
  }
  await page.getByRole('link', { name: 'Your first 10 minutes', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Your first 10 minutes', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Combat examples', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Combat examples', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(el => el.clientWidth));
  expect(errors).toEqual([]);
});

test('specialist deep links and glossary work after a direct load', async ({ page }) => {
  await page.goto('/specialists/#pirate');
  await expect(page.locator('h2#pirate')).toBeInViewport();
  await page.goto('/specialists/#foreman');
  await page.locator('article').getByRole('link', { name: 'Repair mesh', exact: true }).click();
  await expect(page).toHaveURL(/#engineer$/);
  await expect(page.locator('h2#engineer')).toBeInViewport();
  await page.goto('/glossary/');
  await expect(page.getByRole('heading', { name: 'Glossary', exact: true })).toBeVisible();
  await expect(page.locator('#pulse-material')).toBeAttached();
});

test('local search can find a specialist without a hosted search service', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phone navigation is exercised separately.');
  await page.goto('/');
  const search = page.getByLabel('Search', { exact: true });
  await search.focus();
  await expect(search).toHaveAttribute('role', 'combobox');
  await search.fill('Scavenger');
  await page.getByRole('option').filter({ hasText: 'Specialist reference' }).filter({ hasText: 'Scavenger rig' }).first().click();
  await expect(page).toHaveURL(/specialists/);
});

test('phone navigation exposes rules and preserves a readable page width', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile menu only.');
  await page.goto('/');
  await page.getByRole('button', { name: /toggle navigation bar/i }).click();
  await page.locator('.navbar-sidebar').getByRole('link', { name: 'Rules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(el => el.clientWidth));
});
