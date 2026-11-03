import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const resolvePackage = createRequire(`${process.cwd()}/package.json`).resolve;

test('title scroll parallax follows the live reduced-motion preference', async ({ page }) => {
  const output = await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Animated, View} from 'react-native';
      import {TitleArt} from './src/components/TitleArt';
      function Demo() {
        const [scrollY] = useState(() => new Animated.Value(0));
        return <Animated.ScrollView testID="title-scroll" style={{height:300}}
          scrollEventThrottle={16}
          onScroll={Animated.event([{nativeEvent:{contentOffset:{y:scrollY}}}], {useNativeDriver:false})}>
          <TitleArt scrollY={scrollY}/><View style={{height:1200}}/>
        </Animated.ScrollView>;
      }
      createRoot(document.getElementById('root')).render(<Demo/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    alias: { 'react-native': 'react-native-web', 'react-native-svg': resolvePackage('react-native-svg/src/elements.web.ts') },
    resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
    loader: { '.png': 'dataurl' },
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{height:300px;display:flex;flex-direction:column}</style></head><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: output.outputFiles[0]!.text });
  const canvas = page.getByTestId('title-art-canvas');
  const scroll = page.getByTestId('title-scroll');
  const offset = () => canvas.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42);
  const scrollTo = async (top: number) => {
    await scroll.evaluate((element, top) => { element.scrollTop = top; }, top);
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(top);
  };
  await expect(canvas).toHaveCSS('opacity', '1');
  await scrollTo(120);
  await expect.poll(offset).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await scrollTo(180);
  await expect.poll(offset).toBeGreaterThan(50);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(offset).toBe(0);
  await scrollTo(240);
  await expect.poll(offset).toBe(0);
  expect(errors).toEqual([]);
});
