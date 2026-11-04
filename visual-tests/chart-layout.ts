import { expect, type Locator, type Page } from '@playwright/test';
import type { Game } from '../src/game/simulation';
import { chartFit } from '../src/game/chart-projection';
import { fitPlayerCamera } from '../src/game/chart-camera';
import { worldDistance } from '../src/game/geometry';

export async function expectPlayerFit(page: Page, game: Game) {
  await waitForChartLayout(page);
  const sites = game.rocks.filter(site => site.owner === 'you' && game.rocks.filter(other => other.name === site.name).length === 1).slice(0, 2);
  expect(sites).toHaveLength(2);
  const distance = worldDistance(game, sites[0]!, sites[1]!);
  const scale = fitPlayerCamera(game, 'you').scale;
  await expect.poll(async () => {
    const measured = await page.getByTestId('belt-map').evaluate((chart, names) => {
      const bounds = chart.getBoundingClientRect();
      const points = names.map(name => Array.from(chart.querySelectorAll('[role="button"][aria-label]'))
        .filter(element => element.getAttribute('aria-label')?.startsWith(name + ','))
        .map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0)
        .map(rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })));
      return { width: bounds.width, height: bounds.height, distance: Math.min(...points[0]!.flatMap(a => points[1]!.map(b => Math.hypot(a.x - b.x, a.y - b.y)))) };
    }, sites.map(site => site.name));
    return Math.abs(measured.distance - distance * scale * chartFit(game, measured));
  }).toBeLessThan(1);
}

export async function waitForChartLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.getByTestId('belt-map').evaluate(element => {
    const chart = element as HTMLElement;
    const svg = chart.querySelector<SVGSVGElement>(':scope > svg[viewBox]');
    return !!svg && chart.offsetWidth > 0 && chart.offsetHeight > 0 &&
      Math.abs(svg.viewBox.baseVal.width - chart.offsetWidth) < 1 &&
      Math.abs(svg.viewBox.baseVal.height - chart.offsetHeight) < 1;
  })).toBe(true);
}

export async function chartCopy(page: Page, copies: Locator): Promise<Locator> {
  await waitForChartLayout(page);
  let index = -1;
  await expect.poll(async () => {
    index = await copies.evaluateAll(elements => {
      const chart = elements[0]?.closest('[data-testid="belt-map"]')?.getBoundingClientRect();
      if (!chart) return -1;
      return elements.findIndex(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 &&
          bounds.left >= Math.max(0, chart.left) && bounds.right <= Math.min(innerWidth, chart.right) &&
          bounds.top >= Math.max(0, chart.top) && bounds.bottom <= Math.min(innerHeight, chart.bottom);
      });
    });
    return index;
  }).toBeGreaterThanOrEqual(0);
  return copies.nth(index);
}
