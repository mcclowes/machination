import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

for (const name of ['factory', 'generator', 'mine']) {
  test(`${name} artwork is centered inside its selection ring`, async () => {
    const { data, info } = await sharp(new URL(`../../assets/bases/${name}.png`, import.meta.url).pathname)
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 256);
    assert.equal(info.height, 256);
    let left = info.width, right = -1, top = info.height, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const alpha: number = data[(y * info.width + x) * 4 + 3]!;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) assert.equal(alpha, 0, 'transparent outer padding');
      if (alpha < 128) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    assert.ok(right > left && bottom > top, 'visible artwork');
    assert.ok(Math.abs(left - (info.width - 1 - right)) <= 2, `uneven horizontal padding: ${left}, ${info.width - 1 - right}`);
    assert.ok(Math.abs(top - (info.height - 1 - bottom)) <= 2, `uneven vertical padding: ${top}, ${info.height - 1 - bottom}`);
  });
}
