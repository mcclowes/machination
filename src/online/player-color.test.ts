import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('client create/join sends the saved preference and reconnect keeps the recorded request', async () => {
  const result = await build({
    stdin: { contents: "export * from './src/online/client'; export {requests} from './src/online/network';", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'color-client-hosts', setup(builder) {
      builder.onResolve({ filter: /^file:\/\// }, args => ({ path: args.path, external: true }));
      builder.onResolve({ filter: /\/network$/ }, () => ({ path: 'network', namespace: 'color-host' }));
      builder.onResolve({ filter: /^(react-native|expo-crypto|expo-secure-store)$/ }, args => ({ path: args.path, namespace: 'color-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'color-host' }, args => ({ contents: {
        network: `export const requests=[]; export const api=async(session,path,payload)=>{requests.push({path,payload});return {id:'room'};};
          export { creationPayload, RejectedCommand } from ${JSON.stringify(pathToFileURL(resolve('src/online/network.ts')).href)};`,
        'react-native': `export const Platform={OS:'ios'},AppState={currentState:'active'};`,
        'expo-crypto': `export const randomUUID=()=>'',getRandomBytesAsync=async()=>new Uint8Array(32);`,
        'expo-secure-store': `const bytes=new Map();export const getItemAsync=async k=>bytes.get(k)??null,setItemAsync=async(k,v)=>{bytes.set(k,v);},deleteItemAsync=async k=>{bytes.delete(k);};`,
      }[args.path]! }));
    } }],
  });
  const client = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString('base64')}`) as typeof import('./client') & { requests: { path: string; payload?: unknown }[] };
  const base = { url: 'https://belt.example', token: 'a'.repeat(64) };
  const host = await client.connect({ ...base, preferredColor: 'gold' });
  assert.deepEqual(client.requests.at(-1), { path: 'games', payload: { preferredColor: 'gold' } });
  assert.equal((await client.restoreSession())!.preferredColor, 'gold');
  await client.connect({ ...base, invite: 'b'.repeat(24), preferredColor: 'violet' });
  assert.deepEqual(client.requests.at(-1), { path: 'join', payload: { invite: 'b'.repeat(24), preferredColor: 'violet' } });
  await client.connect(host.session);
  assert.deepEqual(client.requests.at(-1), { path: 'games/room', payload: undefined });
});
