import { expect, type Locator, type Page } from '@playwright/test';

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
