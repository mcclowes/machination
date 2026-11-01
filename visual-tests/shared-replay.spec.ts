import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { advance } from '../src/game/simulation';
import { createArchive } from '../src/game/replay';
import { generateSharedReplay } from '../src/replay/generate';
import { generatePackedReplay } from '../src/replay/generate-packed';
import { encodeReplayArtifact } from '../src/replay/artifact';

const baseline = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 73);
const operation = { game: advance(baseline, 8, { rivals: false }), archive: createArchive(baseline) };

for (const format of ['legacy', 'packed'] as const) test(`local ${format} replay imports through the file picker and plays offline`, async ({ page, context }, info) => {
  const replay = (format === 'packed' ? generatePackedReplay : generateSharedReplay)(operation, 'you', 0, 8);
  const raw = encodeReplayArtifact(replay);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Open shared replay', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open replay', exact: true }).click();
  await (await chooser).setFiles({ name: `${format}-replay.json`, mimeType: 'application/json', buffer: Buffer.from(raw) });
  await expect(page.getByText('Unverified replay · recorded perspective', { exact: true })).toBeVisible();
  await expect(page.getByText(/^D01 · 08:00(?: · State \d+ of \d+)?$/).first()).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Beginning', exact: true }).click();
  await expect(page.getByText(/^D01 · 00:00(?: · State \d+ of \d+)?$/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Next state', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.getByText(/^D01 · 08:00(?: · State \d+ of \d+)?$/).first()).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: `.fettle/shots/replay-${format}-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Exit replay', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View imported replay', exact: true })).toBeVisible();
});
