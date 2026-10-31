import { test, expect } from '@playwright/test';

test('player profile keeps picture and color choices after a reload', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('machination.briefing.v1', '1'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Player profile', exact: true }).click();
  await page.getByRole('radio', { name: 'Pilot profile picture', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Pilot profile picture', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'gold player color', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'gold player color', exact: true })).toBeChecked();
  await expect(page.getByText('Open the multiplayer uplink to sign in or connect, then choose your faction here after completing your first online operation.')).toBeVisible();
  await page.getByRole('button', { name: 'Close player profile' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Player profile', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Pilot profile picture', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'gold player color', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Automatic profile picture', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.fettle/shots/player-profile-${testInfo.project.name}.png` });
  await page.getByRole('button', { name: 'Close player profile' }).click();
});
