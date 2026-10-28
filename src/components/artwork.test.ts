import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
import sharp from 'sharp';
import manifest from '../../assets/artwork/manifest.json';

const root = new URL('../../', import.meta.url);
test('every generated project image has a unique intact original and a decodable display asset', async () => {
  assert.equal(manifest.chats.length, 17);
  assert.equal(manifest.images.length, 24);
  assert.equal(new Set(manifest.images.map(image => image.id)).size, 24);
  assert.equal(new Set(manifest.images.map(image => image.sha256)).size, 24);
  for (const chat of manifest.chats) {
    const images = manifest.images.filter(image => image.chatId === chat.id);
    assert.equal(images.length, chat.generatedImages, chat.title);
    assert.deepEqual(images.map(image => image.ordinal).sort((a, b) => a - b), Array.from({ length: chat.generatedImages }, (_, i) => i + 1));
  }
  for (const image of manifest.images) {
    const original = await readFile(new URL(image.original, root));
    assert.equal(createHash('sha256').update(original).digest('hex'), image.sha256, image.id);
    const metadata = await sharp(original).metadata();
    assert.equal(metadata.width, image.width, image.id);
    assert.equal(metadata.height, image.height, image.id);
    const preview = await sharp(new URL(image.display, root).pathname).raw().toBuffer({ resolveWithObject: true });
    assert.equal(preview.info.width, 960, image.id);
    assert.equal(preview.info.height, 640, image.id);
  }
});
