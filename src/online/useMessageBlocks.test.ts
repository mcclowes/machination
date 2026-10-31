/** @format */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  useMessageBlocks,
  type MessageBlockDeps,
  type MessageBlockSeat,
  type MessageBlockState,
} from './useMessageBlocks';
import type { MessageBlockSettings, SetMessageBlock } from '../contracts/message-blocks';
import { RejectedCommand } from './network';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const seat: MessageBlockSeat = {
  url: 'https://belt.example',
  token: 'a'.repeat(64),
  id: 'a'.repeat(24),
  faction: 'you',
};
const initial: MessageBlockSettings = { gameId: seat.id, faction: 'you', revision: 0, blocked: [] };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(deps: MessageBlockDeps, selected: MessageBlockSeat | undefined = seat) {
  const out: { current?: MessageBlockState } = {};
  function Probe({ selected }: { selected?: MessageBlockSeat }) {
    out.current = useMessageBlocks(selected, deps);
    return null;
  }
  let renderer: any;
  await act(async () => {
    renderer = create(React.createElement(Probe, { selected }));
  });
  return {
    out,
    rerender: (next?: MessageBlockSeat) =>
      act(async () => renderer.update(React.createElement(Probe, { selected: next }))),
    unmount: () => act(async () => renderer.unmount()),
  };
}

test('block controls publish only confirmed server choices', async () => {
  const gate = deferred<MessageBlockSettings>();
  const writes: SetMessageBlock[] = [];
  const m = await mount({
    read: async () => initial,
    write: async (_seat, body) => {
      writes.push(body);
      return gate.promise;
    },
    requestId: () => 'message-block-request-1',
  });
  assert.equal(m.out.current!.phase, 'ready');
  await act(async () => m.out.current!.setBlocked('vesper', true));
  assert.equal(m.out.current!.working, true);
  assert.deepEqual(m.out.current!.settings!.blocked, []);
  assert.deepEqual(writes, [
    { requestId: 'message-block-request-1', revision: 0, player: 'vesper', blocked: true },
  ]);
  await act(async () => gate.resolve({ ...initial, revision: 1, blocked: ['vesper'] }));
  assert.equal(m.out.current!.working, false);
  assert.deepEqual(m.out.current!.settings!.blocked, ['vesper']);
  await m.unmount();
});

test('an uncertain save retries the same request and holds other changes until reconciled', async () => {
  const writes: SetMessageBlock[] = [];
  let ids = 0;
  const m = await mount({
    read: async () => initial,
    requestId: () => `message-block-request-${++ids}`,
    write: async (_seat, body) => {
      writes.push(body);
      if (writes.length === 1) throw new Error('Response lost');
      return { ...initial, revision: 1, blocked: ['vesper'] };
    },
  });
  await act(async () => m.out.current!.setBlocked('vesper', true));
  assert.equal(m.out.current!.phase, 'error');
  assert.match(m.out.current!.error!, /Response lost/);
  assert.deepEqual(m.out.current!.settings!.blocked, []);
  await act(async () => m.out.current!.setBlocked('null', true));
  assert.equal(writes.length, 1);
  await act(async () => m.out.current!.retry());
  assert.equal(ids, 1);
  assert.deepEqual(writes[0], writes[1]);
  assert.deepEqual(m.out.current!.settings!.blocked, ['vesper']);
  await m.unmount();
});

test('stale writes load current choices without reapplying the old intent', async () => {
  let reads = 0,
    writes = 0;
  const changed = { ...initial, revision: 2, blocked: ['null'] as const };
  const m = await mount({
    requestId: () => 'message-block-request-1',
    read: async () => (++reads === 1 ? initial : { ...changed, blocked: [...changed.blocked] }),
    write: async () => {
      writes++;
      throw new RejectedCommand(409, 'Changed elsewhere', 'message_block.conflict.stale');
    },
  });
  await act(async () => m.out.current!.setBlocked('vesper', true));
  assert.equal(writes, 1);
  assert.deepEqual(m.out.current!.settings!.blocked, ['null']);
  assert.match(m.out.current!.error!, /changed elsewhere/);
  await act(async () => m.out.current!.retry());
  assert.equal(writes, 1);
  assert.equal(m.out.current!.phase, 'ready');
  await m.unmount();
});

test('late completions cannot cross an operation, credential, account, or away-and-back transition', async () => {
  for (const next of [
    { ...seat, id: 'b'.repeat(24) },
    { ...seat, token: 'b'.repeat(64) },
    { ...seat, accountId: 'user_alice', getToken: async () => 'account-session' },
    { ...seat, faction: 'vesper' as const },
  ]) {
    const gate = deferred<MessageBlockSettings>();
    const m = await mount({
      requestId: () => 'message-block-request-1',
      read: async (selected) => ({ ...initial, gameId: selected.id, faction: selected.faction }),
      write: () => gate.promise,
    });
    await act(async () => m.out.current!.setBlocked('vesper', true));
    await m.rerender(next);
    await m.rerender(seat);
    await act(async () => gate.resolve({ ...initial, revision: 1, blocked: ['vesper'] }));
    assert.equal(m.out.current!.settings!.revision, 0);
    assert.deepEqual(m.out.current!.settings!.blocked, []);
    await m.unmount();
  }
});

test('unsupported servers cannot claim a block, and unmounted controls never write', async () => {
  let writes = 0;
  const m = await mount({
    requestId: () => 'message-block-request-1',
    read: async () => {
      throw new RejectedCommand(404, 'Endpoint missing');
    },
    write: async () => {
      writes++;
      return initial;
    },
  });
  assert.equal(m.out.current!.phase, 'unsupported');
  assert.equal(m.out.current!.settings, undefined);
  await act(async () => m.out.current!.setBlocked('vesper', true));
  assert.equal(writes, 0);
  await m.unmount();
  m.out.current!.setBlocked('vesper', true);
  m.out.current!.retry();
  assert.equal(writes, 0);
});
