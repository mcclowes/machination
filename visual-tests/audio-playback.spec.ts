/** @format */
import { expect, test } from '@playwright/test';

type Attempt = { source: string; state: 'pending' | 'played' | 'failed' };

test('press sounds retry failed sources and mute without interrupting navigation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('machination.briefing.v1', '1');
    const attempts: Attempt[] = [];
    Object.defineProperty(window, 'machinationAudioAttempts', { value: attempts });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const attempt: Attempt = { source: this.src, state: 'pending' };
      attempts.push(attempt);
      return play.call(this).then(
        () => {
          attempt.state = 'played';
        },
        (error) => {
          attempt.state = 'failed';
          throw error;
        },
      );
    };
  });
  let denyMedia = false;
  await page.route('**/*', (route) => {
    const local = ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname);
    return local && !(denyMedia && route.request().resourceType() === 'media')
      ? route.continue()
      : route.abort();
  });
  const attempts = () =>
    page.evaluate(
      () => (window as unknown as { machinationAudioAttempts: Attempt[] }).machinationAudioAttempts,
    );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open field manual', exact: true }).click();
  await expect
    .poll(async () => (await attempts()).some((attempt) => attempt.state === 'played'))
    .toBe(true);
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await expect
    .poll(async () => (await attempts()).filter((attempt) => attempt.state === 'played').length)
    .toBe(2);
  denyMedia = true;
  await page.getByRole('button', { name: 'Start tactical practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tactical practice', exact: true })).toBeVisible();
  await expect
    .poll(async () => (await attempts()).some((attempt) => attempt.state === 'failed'))
    .toBe(true);
  const failed = (await attempts()).find((attempt) => attempt.state === 'failed')!.source;
  expect(errors).toEqual([]);
  denyMedia = false;
  await page.getByRole('button', { name: '‹ Games', exact: true }).click();
  await page.getByRole('button', { name: 'Start tactical practice', exact: true }).click();
  await expect
    .poll(async () =>
      (await attempts()).some((attempt) => attempt.source === failed && attempt.state === 'played'),
    )
    .toBe(true);
  await page.getByRole('switch', { name: 'Sound', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Sound', exact: true })).not.toBeChecked();
  const mutedAttempts = (await attempts()).length;
  await page.getByRole('button', { name: '‹ Games', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Machination', exact: true })).toBeVisible();
  expect((await attempts()).length).toBe(mutedAttempts);
  expect(errors).toEqual([]);
});
