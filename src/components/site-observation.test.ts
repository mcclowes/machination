import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteSiteDescription } from './site-observation';

test('remote descriptions distinguish public ownership and revealed type from hidden site strength', () => {
  const rival = remoteSiteDescription({ owner: 'vesper', kind: 'unknown' });
  assert.match(rival, /Vesper/);
  assert.match(rival, /type, drones, shields, and specialists unknown/);
  assert.doesNotMatch(rival, /Ownership unknown/);
  assert.match(remoteSiteDescription({ owner: null, kind: 'mine' }), /Unclaimed · mine/);
  assert.match(remoteSiteDescription({ owner: 'you', kind: 'generator' }), /Mnemosyne · reactor/);
  assert.match(remoteSiteDescription({ kind: 'factory' }), /Ownership unknown · factory/);
});
