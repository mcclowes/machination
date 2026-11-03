import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

test.use({ hasTouch: true });

test('vertical scrolling preserves cargo while horizontal dragging and tapping adjust it', async ({ page }) => {
  const output = await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ScrollView, View} from 'react-native';
      import {DroneManifest} from './src/components/DroneManifest';
      function Demo() {
        const [value, setValue] = useState('6');
        return <ScrollView testID="manifest-scroll" style={{height:260}}>
          <View style={{height:40}}/>
          <DroneManifest value={value} available={30} onChange={setValue} compact/>
          <View style={{height:1000}}/>
        </ScrollView>;
      }
      createRoot(document.getElementById('root')).render(<Demo/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { 'react-native': 'react-native-web' },
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
  });
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{height:260px;display:flex;flex-direction:column}</style></head><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: output.outputFiles[0]!.text });
  const input = page.getByRole('textbox', { name: 'Drones to dispatch' });
  const track = page.getByLabel('Drone cargo', { exact: true });
  const scroll = page.getByTestId('manifest-scroll');
  await expect(input).toHaveValue('6');
  const mouseBox = (await track.boundingBox())!;
  await track.click({ position: { x: mouseBox.width / 2, y: mouseBox.height / 2 } });
  await expect(input).toHaveValue('15');
  await page.mouse.move(mouseBox.x + mouseBox.width * 0.2, mouseBox.y + mouseBox.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(mouseBox.x + mouseBox.width * (0.2 + 0.6 * step / 8), mouseBox.y + mouseBox.height / 2);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await expect.poll(() => input.inputValue().then(Number)).toBeGreaterThan(20);
  await track.click({ position: { x: mouseBox.width * 0.3, y: mouseBox.height / 2 } });
  await expect(input).toHaveValue('9');
  await input.fill('6');
  await expect(input).toHaveValue('6');
  const cdp = await page.context().newCDPSession(page);
  async function drag(x: number, y: number, dx: number, dy: number) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 8, y: y + dy * step / 8 }] });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  let box = (await track.boundingBox())!;
  await drag(box.x + box.width / 2, box.y + box.height / 2, 0, -65);
  await expect(input).toHaveValue('6');
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(20);
  await scroll.evaluate(element => new Promise<void>(resolve => {
    let previous = element.scrollTop, stable = 0;
    function sample() {
      const next = element.scrollTop;
      stable = next === previous ? stable + 1 : 0;
      previous = next;
      if (stable >= 8) resolve();
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  await scroll.evaluate(element => { element.scrollTop = 0; });
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
  box = (await track.boundingBox())!;
  await drag(box.x + box.width * 0.2, box.y + box.height / 2, box.width * 0.6, 0);
  await expect.poll(() => input.inputValue().then(Number)).toBeGreaterThan(20);
  await track.tap({ position: { x: box.width * 0.3, y: box.height / 2 } });
  await expect(input).toHaveValue('9');
  await page.getByRole('button', { name: 'Send one more drone', exact: true }).tap();
  await expect(input).toHaveValue('10');
  await cdp.detach();
});
