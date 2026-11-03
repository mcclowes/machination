import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

test('profile color persists separately from games, clears, validates, and reports storage failures', async () => {
  const output = await build({
    stdin: { contents: "export * from './src/solo/profile'; export { bytes, default as storage } from '@react-native-async-storage/async-storage';", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'profile-storage', setup(builder) {
      builder.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: 'storage', namespace: 'profile-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'profile-host' }, () => ({ contents: `
        export const bytes = new Map();
        export default { getItem: async key => bytes.get(key) ?? null, setItem: async (key, value) => { bytes.set(key, value); } };
      ` }));
    } }],
  });
  const profile = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`) as typeof import('./profile') & { bytes: Map<string, string>; storage: { setItem: (key: string, value: string) => Promise<void> } };
  assert.deepEqual(await profile.loadProfile(), {});
  await profile.saveProfile({ preferredColor: 'gold' });
  assert.deepEqual(await profile.loadProfile(), { preferredColor: 'gold' });
  await assert.rejects(() => profile.saveProfile({ preferredColor: 'invalid' as never }), /known player color/);
  assert.deepEqual(await profile.loadProfile(), { preferredColor: 'gold' });
  await profile.saveProfile({ preferredColor: 'gold', portrait: 'pilot' });
  assert.deepEqual(await profile.loadProfile(), { preferredColor: 'gold', portrait: 'pilot' });
  await assert.rejects(() => profile.saveProfile({ portrait: 'invalid' as never }), /known profile picture/);
  await profile.saveProfile({});
  assert.deepEqual(await profile.loadProfile(), {});
  assert.equal(profile.normalizeProfileName('  Ada \n\t Vance\u0007 '), 'Ada Vance');
  assert.equal(Array.from(profile.normalizeProfileName('🛰'.repeat(profile.PROFILE_NAME_MAX + 5))).length, profile.PROFILE_NAME_MAX);
  await profile.saveProfile({ name: 'Ada Vance' });
  assert.deepEqual(await profile.loadProfile(), { name: 'Ada Vance' });
  for (const name of ['', ' padded ', 'x'.repeat(profile.PROFILE_NAME_MAX + 1), 7]) await assert.rejects(() => profile.saveProfile({ name: name as never }), /valid name/);
  await profile.saveProfile({});
  for (const invalid of ['null', '[]', '{"preferredColor":"invalid"}', '{"portrait":"invalid"}', '{"name":""}', '{"name":7}', 'broken json']) {
    profile.bytes.set('machination.profile.v1', invalid);
    await assert.rejects(() => profile.loadProfile());
    assert.equal(profile.bytes.get('machination.profile.v1'), invalid);
  }
  profile.storage.setItem = async () => { throw new Error('disk failure'); };
  await assert.rejects(() => profile.saveProfile({ preferredColor: 'teal' }), /disk failure/);
});
