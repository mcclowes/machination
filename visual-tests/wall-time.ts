/** @format */
import type { Page } from '@playwright/test';

function pinDate(time: number) {
  const NativeDate = Date;
  const now = () => time;
  Date = new Proxy(NativeDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [time], newTarget);
    },
    apply() {
      return new NativeDate(time).toString();
    },
    get(target, name, receiver) {
      return name === 'now' ? now : Reflect.get(target, name, receiver);
    },
  });
}

/** Pin save/clock inputs while exercising real browser scheduling. */
export async function freezeWallTime(page: Page, epoch: number) {
  await page.addInitScript(pinDate, epoch);
}
