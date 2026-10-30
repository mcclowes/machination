import { expect, test } from '@playwright/test';

test('solo setup starts doubles and 4v4 with fixed teams', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date('2026-10-30T12:00:00Z') });
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  for (const [label, format, count] of [['Doubles (2v2)', '2v2', 4], ['4v4', '4v4', 8]] as const) {
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('radio', { name: label, exact: true }).click();
    await expect(page.getByRole('radio', { name: `${count} players`, exact: true })).toBeChecked();
    await expect(page.getByText(/form fixed teams in join order/)).toBeVisible();
    await page.screenshot({ path: `.fettle/shots/teams-${format}-setup-${info.project.name}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Replace operation', exact: true }).click();
    await expect(page.getByText(`${format} teams · ${count} intelligences · mining · target 300 cargo`, { exact: true })).toBeVisible();
  }
});
