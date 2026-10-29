import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';

const payload = { kind: 'machination.incoming', version: 1, gameId: 'a'.repeat(24), bindingId: 'binding-1', notificationId: 'attack-1' };

for (const platform of ['ios', 'android']) {
  test(`${platform} native incoming presentation and channel setup preserve explicit permission and opaque data`, async () => {
    const key = `__incomingAdapter_${randomUUID().replaceAll('-', '')}`;
    const globals = globalThis as typeof globalThis & Record<string, any>;
    const state = { requests: 0, tokens: 0, channels: [] as { id: string; options: any }[], handler: undefined as any };
    globals[key] = state;
    try {
      const g = `globalThis[${JSON.stringify(key)}]`;
      const output = await build({ entryPoints: ['src/online/notification-device.native.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
        define: { 'process.env.EXPO_PUBLIC_EAS_PROJECT_ID': JSON.stringify('12345678-1234-1234-1234-123456789abc') },
        plugins: [{ name: 'notification-native-boundary', setup(builder) {
          builder.onResolve({ filter: /^(react-native|expo-notifications)$/ }, args => ({ path: args.path, namespace: 'native-test' }));
          builder.onLoad({ filter: /.*/, namespace: 'native-test' }, args => ({ contents: args.path === 'react-native'
            ? `export const Platform={OS:${JSON.stringify(platform)}};`
            : `export const IosAuthorizationStatus={AUTHORIZED:1,PROVISIONAL:2,EPHEMERAL:3,DENIED:4,NOT_DETERMINED:5},AndroidImportance={DEFAULT:3,HIGH:4};
              export const setNotificationHandler=h=>{${g}.handler=h},getPermissionsAsync=async()=>({granted:true,ios:{status:1}}),
                requestPermissionsAsync=async()=>{${g}.requests++;return {granted:true,ios:{status:1}}},
                setNotificationChannelAsync=async(id,options)=>{${g}.channels.push({id,options});return {id}},
                getExpoPushTokenAsync=async()=>{${g}.tokens++;return {data:'ExponentPushToken[native-test]'}},
                addPushTokenListener=()=>({remove(){}}),getLastNotificationResponseAsync=async()=>null,
                addNotificationResponseReceivedListener=()=>({remove(){}}),clearLastNotificationResponseAsync=async()=>{};` }));
        } }],
      });
      const module = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
      const native = await module.loadNotificationDevice();
      assert.ok(native);
      assert.equal(state.requests, 0);
      assert.equal(state.tokens, 0);
      const presentation = (data: unknown) => state.handler.handleNotification({ request: { content: { data } } });
      assert.deepEqual(await presentation(payload), { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false });
      for (const data of [{ ...payload, kind: 'machination.message' }, { ...payload, version: 2 }, { ...payload, sender: 'hidden' }, null]) {
        assert.equal((await presentation(data)).shouldShowBanner, false);
      }
      await native.requestPermission();
      assert.equal(state.requests, 1);
      await native.prepareIncoming();
      assert.equal(state.requests, 1, 'Changing incoming consent never requests OS permission again');
      assert.equal(state.tokens, 0, 'Channel preparation does not contact the token provider');
      assert.deepEqual(state.channels.map(channel => channel.id), platform === 'android' ? ['machination-messages', 'machination-alerts'] : []);
      if (platform === 'android') assert.equal(state.channels[1]!.options.importance, 4);
    } finally { delete globals[key]; }
  });
}
