import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import sharp from 'sharp';
import { SPECIALISTS, type SpecialistKind } from '../game/specialist-catalog';
import { SPECIALIST_INSIGNIA, captiveLockSvg, insigniaSvg, INSIGNIA_BACKGROUND, INSIGNIA_CAPTIVE_OPACITY, INSIGNIA_COLOR, INSIGNIA_VIEWBOX } from './specialist-insignia';

test('every catalog role has its own complete insignia rather than an alias', () => {
  const kinds = Object.keys(SPECIALISTS) as SpecialistKind[];
  assert.deepEqual(Object.keys(SPECIALIST_INSIGNIA).sort(), [...kinds].sort());
  const drawings = kinds.map(kind => JSON.stringify(SPECIALIST_INSIGNIA[kind]));
  assert.equal(new Set(drawings).size, kinds.length);
});

test('the actual icon renderer retains distinct visible silhouettes at chart and roster sizes', async () => {
  const require = createRequire(import.meta.url);
  const output = await build({ stdin: { contents: `import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {CaptiveLock,SpecialistIcon} from './src/components/SpecialistIcon';
    export const render=(kind,size,color)=>renderToStaticMarkup(React.createElement(SpecialistIcon,{kind,size,color}));
    export const lock=()=>renderToStaticMarkup(React.createElement(CaptiveLock));`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom/server'],
    alias: { 'react-native': 'react-native-web', 'react-native-svg': require.resolve('react-native-svg/src/elements.web.ts') },
    resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
  });
  const module = { exports: {} as { render: (kind: SpecialistKind, size?: number, color?: string) => string; lock: () => string } };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(require, module, module.exports);
  assert.match(module.exports.render('queen'), /width="36"/);
  assert.match(module.exports.render('queen', 20), /aria-hidden="true"/);
  assert.match(module.exports.render('queen', 20), /tabindex="-1"/);
  assert.match(module.exports.render('queen', 20, '#00ff00'), /stroke="#00ff00"/);
  const lock = module.exports.lock();
  assert.match(lock, /width="8" height="10"/);
  assert.match(lock, /aria-hidden="true"/);
  assert.deepEqual(await sharp(Buffer.from(lock)).ensureAlpha().raw().toBuffer(), await sharp(Buffer.from(captiveLockSvg())).ensureAlpha().raw().toBuffer());
  for (const size of [20, 36]) {
    const hashes = new Set<string>();
    for (const kind of Object.keys(SPECIALISTS) as SpecialistKind[]) {
      const markup = module.exports.render(kind, size);
      const { data, info } = await sharp(Buffer.from(markup)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, size); assert.equal(info.height, size);
      const ink = [...data].filter((_, i) => i % 4 === 3 && data[i]! > 0).length;
      assert.ok(ink > size * 2, `${kind} remains visible at ${size}px`);
      const hash = createHash('sha256').update(data).digest('hex');
      assert.ok(!hashes.has(hash), `${kind} must not duplicate another rendered role at ${size}px`);
      hashes.add(hash);
      const exported = await sharp(Buffer.from(insigniaSvg(kind, size))).ensureAlpha().raw().toBuffer();
      assert.deepEqual(data, exported, `The contact sheet must match the actual ${kind} renderer`);
    }
  }
});

test('role strokes fit inside the icon without clipping at the supported display sizes', async () => {
  for (const size of [20, 36]) for (const kind of Object.keys(SPECIALISTS) as SpecialistKind[]) {
    const margin = 2 * INSIGNIA_VIEWBOX / size;
    const padded = insigniaSvg(kind, size + 4).replace(`viewBox="0 0 ${INSIGNIA_VIEWBOX} ${INSIGNIA_VIEWBOX}"`,
      `viewBox="${-margin} ${-margin} ${INSIGNIA_VIEWBOX + 2 * margin} ${INSIGNIA_VIEWBOX + 2 * margin}"`);
    const { data, info } = await sharp(Buffer.from(padded)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (x >= 2 && y >= 2 && x < size + 2 && y < size + 2) continue;
      assert.equal(data[(y * info.width + x) * 4 + 3], 0, `${kind} has no clipped stroke at ${size}px`);
    }
  }
});

test('active and muted captive strokes retain contrast on the actual badge background', () => {
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (channels: number[]) => channels.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0);
  const background = rgb(INSIGNIA_BACKGROUND), ink = rgb(INSIGNIA_COLOR);
  for (const opacity of [1, INSIGNIA_CAPTIVE_OPACITY]) {
    const composite = ink.map((n, i) => n * opacity + background[i]! * (1 - opacity));
    const contrast = (luminance(composite) + 0.05) / (luminance(background) + 0.05);
    assert.ok(contrast >= 3, `Stroke/background contrast ${contrast.toFixed(2)}:1 at opacity ${opacity}`);
  }
});
