import { expect, test, type Locator } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const resolvePackage = createRequire(`${process.cwd()}/package.json`).resolve;

async function opacityRange(locator: Locator, duration: number) {
  return locator.evaluate((element, duration) => new Promise<number[]>(resolve => {
    const values: number[] = [];
    const start = performance.now();
    function sample() {
      values.push(Number(getComputedStyle(element).opacity));
      if (performance.now() - start >= duration) resolve([Math.min(...values), Math.max(...values)]);
      else requestAnimationFrame(sample);
    }
    sample();
  }), duration);
}

test('isolated haulers and operation drawers animate and honor reduced motion', async ({ page }, info) => {
  const output = await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Pressable, Text, View} from 'react-native';
      import {ShipMarker} from './src/components/ShipMarker';
      import {OperationShell} from './src/components/OperationShell';
      function Demo() {
        const [selected, select] = useState(false);
        const [section, setSection] = useState(null);
        const panels = Object.fromEntries(['asset','orders','units','signals','intel','settings'].map(key => [key, {
          title: key === 'orders' ? 'Orders' : key,
          content: <Text style={{color:'#e5eadc'}}>Observed operation details</Text>,
        }]));
        return <OperationShell section={section} onSection={setSection} panels={panels} status={null}
          timeline={<Text style={{color:'#e5eadc',padding:16}}>Live · D01 · 00:00</Text>}
          chart={<View style={{flex:1,alignItems:'center',justifyContent:'center'}}>
            <Pressable accessibilityRole="button" accessibilityLabel="Inspect motion hauler" onPress={()=>select(!selected)}>
              <ShipMarker color="#73d6dc" drones={1234} heading={-25} selected={selected}/>
            </Pressable>
          </View>}/>;
      }
      createRoot(document.getElementById('root')).render(<Demo/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    alias: { 'react-native': 'react-native-web', 'react-native-svg': resolvePackage('react-native-svg/src/elements.web.ts') },
    resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
    plugins: [{ name: 'motion-portrait-context', setup(builder) {
      builder.onResolve({ filter: /\/PlayerIdentity$/ }, () => ({ path: 'portraits', namespace: 'motion-portrait-context' }));
      builder.onLoad({ filter: /.*/, namespace: 'motion-portrait-context' }, () => ({ contents: `export const PlayerPortraits={Provider:({children})=>children};` }));
    } }],
  });
  page.on('pageerror', error => { throw error; });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: output.outputFiles[0]!.text });
  const ship = page.getByRole('button', { name: 'Inspect motion hauler', exact: true });
  const engine = ship.getByTestId('ship-engine-glow');
  const [low, high] = await opacityRange(engine, 900);
  expect(high! - low!).toBeGreaterThan(0.15);
  await ship.click();
  const beacon = ship.getByTestId('ship-selection-beacon');
  const [dim, bright] = await opacityRange(beacon, 900);
  expect(bright! - dim!).toBeGreaterThan(0.08);

  const values = await page.getByRole('tab', { name: 'Orders', exact: true }).evaluate(element => new Promise<number[]>(resolve => {
    (element as HTMLElement).click();
    const values: number[] = [];
    const start = performance.now();
    function sample() {
      const drawer = document.querySelector('[data-testid="operation-drawer"]');
      if (drawer) values.push(Number(getComputedStyle(drawer).opacity));
      if (performance.now() - start >= 400) resolve(values);
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  expect(Math.min(...values)).toBeLessThan(0.99);
  const drawer = page.getByTestId('operation-drawer');
  await expect(drawer).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `.fettle/shots/animation-components-${info.project.name}.png` });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(engine).toHaveCSS('opacity', '1');
  const [stillLow, stillHigh] = await opacityRange(engine, 350);
  expect(stillLow).toBe(1);
  expect(stillHigh).toBe(1);
  await page.getByRole('tab', { name: 'Signals', exact: true }).click();
  await expect(drawer).toHaveCSS('opacity', '1');
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await page.screenshot({ path: `.fettle/shots/animation-components-reduced-${info.project.name}.png` });
});
