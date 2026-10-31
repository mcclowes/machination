/** @format */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  useMessageReports,
  type MessageReportDeps,
  type MessageReportState,
} from './useMessageReports';
import type { MessageBlockSeat } from './useMessageBlocks';
import type { MessageReportReceipt, SubmitMessageReport } from '../contracts/message-reports';
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
const selected = {
  target: { kind: 'private' as const, id: 123 },
  sender: 'vesper' as const,
  text: 'Unwanted transmission',
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function receipt(body: SubmitMessageReport, selectedSeat = seat): MessageReportReceipt {
  return {
    gameId: selectedSeat.id,
    faction: selectedSeat.faction,
    requestId: body.requestId,
    caseId: 'c'.repeat(32),
    receivedAt: 1000,
  };
}
async function mount(deps: MessageReportDeps, current: MessageBlockSeat | undefined = seat) {
  const out: { current?: MessageReportState } = {};
  function Probe({ selectedSeat }: { selectedSeat?: MessageBlockSeat }) {
    out.current = useMessageReports(selectedSeat, deps);
    return null;
  }
  let renderer: any;
  await act(async () => {
    renderer = create(React.createElement(Probe, { selectedSeat: current }));
  });
  return {
    out,
    rerender: (next?: MessageBlockSeat) =>
      act(async () => renderer.update(React.createElement(Probe, { selectedSeat: next }))),
    unmount: () => act(async () => renderer.unmount()),
  };
}

test('report confirmation publishes only the server receipt and prevents duplicate taps', async () => {
  const gate = deferred<MessageReportReceipt>();
  const writes: SubmitMessageReport[] = [];
  const m = await mount({
    read: async () => ({ gameId: seat.id, faction: seat.faction, available: true }),
    requestId: () => 'message-report-request-1',
    write: async (_seat, body) => {
      writes.push(body);
      return gate.promise;
    },
  });
  assert.equal(m.out.current!.available, true);
  await act(async () => m.out.current!.select(selected));
  await act(async () => {
    m.out.current!.submit('harassment', 'Repeated insults');
    m.out.current!.submit('harassment', 'Repeated insults');
  });
  assert.equal(writes.length, 1);
  assert.equal(m.out.current!.working, true);
  assert.equal(m.out.current!.receipt, undefined);
  assert.deepEqual(writes[0], {
    requestId: 'message-report-request-1',
    target: selected.target,
    reason: 'harassment',
    detail: 'Repeated insults',
  });
  await act(async () => m.out.current!.close());
  await act(async () => gate.resolve(receipt(writes[0]!)));
  assert.equal(m.out.current!.working, false);
  assert.equal(m.out.current!.dialogOpen, false);
  assert.equal(m.out.current!.receipt!.caseId, 'c'.repeat(32));
  await act(async () => m.out.current!.submit('spam', 'Another reason'));
  assert.equal(writes.length, 1);
  await m.unmount();
});

test('throttled and server-side refusals remain uncertain and retryable with the same request', async () => {
  for (const failure of [
    new RejectedCommand(429, 'Throttled'),
    new RejectedCommand(503, 'Unavailable'),
  ]) {
    const writes: SubmitMessageReport[] = [];
    const m = await mount({
      read: async () => ({ gameId: seat.id, faction: seat.faction, available: true }),
      requestId: () => 'message-report-request-1',
      write: async (_seat, body) => {
        writes.push(body);
        if (writes.length === 1) throw failure;
        return receipt(body);
      },
    });
    await act(async () => m.out.current!.select(selected));
    await act(async () => m.out.current!.submit('spam', ''));
    assert.equal(m.out.current!.uncertain, true);
    await act(async () => m.out.current!.retry());
    assert.deepEqual(writes[0], writes[1]);
    await m.unmount();
  }
});

test('an uncertain report survives close/resume and retries the identical intent without permitting another', async () => {
  const writes: SubmitMessageReport[] = [];
  let ids = 0;
  const m = await mount({
    read: async () => ({ gameId: seat.id, faction: seat.faction, available: true }),
    requestId: () => `message-report-request-${++ids}`,
    write: async (_seat, body) => {
      writes.push(body);
      if (writes.length === 1) throw new Error('Response lost');
      return receipt(body);
    },
  });
  await act(async () => m.out.current!.select(selected));
  await act(async () => m.out.current!.submit('threat', 'Please review'));
  assert.equal(m.out.current!.uncertain, true);
  assert.equal(m.out.current!.canSelect, false);
  await act(async () => m.out.current!.close());
  assert.equal(m.out.current!.dialogOpen, false);
  await act(async () =>
    m.out.current!.select({ ...selected, target: { kind: 'private', id: 456 } }),
  );
  assert.equal(m.out.current!.selection!.target.id, 123);
  await act(async () => m.out.current!.refresh());
  assert.equal(m.out.current!.uncertain, true);
  await act(async () => m.out.current!.resume());
  assert.equal(m.out.current!.dialogOpen, true);
  await act(async () => m.out.current!.retry());
  assert.equal(ids, 1);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(m.out.current!.receipt!.requestId, writes[0]!.requestId);
  assert.equal(m.out.current!.uncertain, false);
  await m.unmount();
});

test('confirmed receipts reopen without producing another report for that message', async () => {
  let writes = 0;
  const m = await mount({
    read: async () => ({ gameId: seat.id, faction: seat.faction, available: true }),
    requestId: () => `message-report-request-${writes + 1}`,
    write: async (_seat, body) => {
      writes++;
      return receipt(body);
    },
  });
  await act(async () => m.out.current!.select(selected));
  await act(async () => m.out.current!.submit('spam', ''));
  await act(async () => m.out.current!.close());
  await act(async () =>
    m.out.current!.select({ ...selected, target: { kind: 'private', id: 456 } }),
  );
  await act(async () => m.out.current!.submit('spam', ''));
  await act(async () => m.out.current!.select(selected));
  assert.ok(m.out.current!.receipt);
  await act(async () => m.out.current!.submit('other', 'Changed my reason'));
  assert.equal(writes, 2);
  await m.unmount();
});

test('late report and availability responses cannot cross operation, account, credential, URL, or away-and-back transitions', async () => {
  for (const next of [
    { ...seat, id: 'b'.repeat(24) },
    { ...seat, token: 'b'.repeat(64) },
    { ...seat, accountId: 'user_alice', getToken: async () => 'session' },
    { ...seat, url: 'https://other.example' },
    { ...seat, faction: 'vesper' as const },
  ]) {
    const gate = deferred<MessageReportReceipt>();
    let body!: SubmitMessageReport;
    const m = await mount({
      read: async (selected) => ({
        gameId: selected.id,
        faction: selected.faction,
        available: true,
      }),
      requestId: () => 'message-report-request-1',
      write: async (_seat, command) => {
        body = command;
        return gate.promise;
      },
    });
    await act(async () => m.out.current!.select(selected));
    await act(async () => m.out.current!.submit('spam', ''));
    await m.rerender(next);
    assert.equal(m.out.current!.selection, undefined);
    await m.rerender(seat);
    await act(async () => gate.resolve(receipt(body)));
    assert.equal(m.out.current!.receipt, undefined);
    assert.equal(m.out.current!.selection, undefined);
    assert.equal(m.out.current!.working, false);
    assert.equal(m.out.current!.reported(selected.target), false);
    await m.unmount();
  }
  const gate = deferred<{ gameId: string; faction: 'you'; available: boolean }>();
  let reads = 0;
  const m = await mount({
    read: async (current) =>
      ++reads === 1
        ? gate.promise
        : { gameId: current.id, faction: current.faction, available: false },
    requestId: () => 'message-report-request-1',
    write: async (_seat, body) => receipt(body),
  });
  await m.rerender({ ...seat, token: 'b'.repeat(64) });
  await m.rerender(seat);
  await act(async () => gate.resolve({ gameId: seat.id, faction: 'you', available: true }));
  assert.equal(m.out.current!.available, false);
  await m.unmount();
});

test('definitive refusal permits correction; unavailable and unmounted controls never submit', async () => {
  let writes = 0;
  const m = await mount({
    read: async () => ({ gameId: seat.id, faction: seat.faction, available: true }),
    requestId: () => `message-report-request-${writes + 1}`,
    write: async (_seat, body) => {
      if (++writes === 1)
        throw new RejectedCommand(404, 'Message unavailable', 'report.not_found.target');
      return receipt(body);
    },
  });
  await act(async () => m.out.current!.select(selected));
  await act(async () => m.out.current!.submit('spam', ''));
  assert.equal(m.out.current!.uncertain, false);
  assert.match(m.out.current!.error!, /Message unavailable/);
  await act(async () => m.out.current!.submit('harassment', 'Additional context'));
  assert.ok(m.out.current!.receipt);
  assert.equal(writes, 2);
  await m.unmount();
  m.out.current!.select(selected);
  m.out.current!.submit('spam', '');
  m.out.current!.retry();
  assert.equal(writes, 2);
  for (const read of [
    async () => ({ gameId: seat.id, faction: seat.faction, available: false }),
    async () => {
      throw new RejectedCommand(404, 'Endpoint missing');
    },
  ]) {
    const unavailable = await mount({
      read,
      requestId: () => 'message-report-request-1',
      write: async (_seat, body) => {
        writes++;
        return receipt(body);
      },
    });
    assert.equal(unavailable.out.current!.available, false);
    await act(async () => {
      unavailable.out.current!.select(selected);
      unavailable.out.current!.submit('spam', '');
    });
    assert.equal(writes, 2);
    await unavailable.unmount();
  }
});

test('a retained submit callback cannot send first-seat private context through a newly selected seat', async () => {
  const writes: { selectedSeat: MessageBlockSeat; body: SubmitMessageReport }[] = [];
  const m = await mount({
    read: async (selectedSeat) => ({
      gameId: selectedSeat.id,
      faction: selectedSeat.faction,
      available: true,
    }),
    requestId: () => 'message-report-request-1',
    write: async (selectedSeat, body) => {
      writes.push({ selectedSeat, body });
      return receipt(body, selectedSeat);
    },
  });
  await act(async () => m.out.current!.select(selected));
  const staleSubmit = m.out.current!.submit;
  await m.rerender({
    ...seat,
    id: 'b'.repeat(24),
    accountId: 'user_bob',
    getToken: async () => 'bob-session',
  });
  await act(async () =>
    m.out.current!.select({
      ...selected,
      target: { kind: 'private', id: 456 },
      text: 'Second-seat message',
    }),
  );
  await act(async () => staleSubmit('other', 'First-account private context'));
  assert.equal(writes.length, 0);
  await act(async () => m.out.current!.submit('spam', 'Second-seat context'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.body.detail, 'Second-seat context');
  await m.unmount();
});

test('all retained actions are revoked by scope transitions, including away-and-back generations', async () => {
  for (const next of [
    { ...seat, id: 'b'.repeat(24) },
    { ...seat, token: 'b'.repeat(64) },
    { ...seat, accountId: 'user_bob', getToken: async () => 'bob-session' },
    { ...seat, url: 'https://other.example' },
    { ...seat, faction: 'vesper' as const },
  ])
    for (const returnToFirst of [false, true]) {
      let reads = 0;
      const writes: { selectedSeat: MessageBlockSeat; body: SubmitMessageReport }[] = [];
      const m = await mount({
        read: async (selectedSeat) => {
          reads++;
          return { gameId: selectedSeat.id, faction: selectedSeat.faction, available: true };
        },
        requestId: () => `message-report-request-${writes.length + 1}`,
        write: async (selectedSeat, body) => {
          writes.push({ selectedSeat, body });
          if (writes.length === 2) throw new Error('Current-seat response lost');
          return receipt(body, selectedSeat);
        },
      });
      await act(async () => m.out.current!.select(selected));
      await act(async () => m.out.current!.submit('spam', 'First-seat report'));
      const stale = m.out.current!;
      assert.equal(stale.reported(selected.target), true);
      await m.rerender(next);
      if (returnToFirst) await m.rerender(seat);
      const currentSelection = {
        target: { kind: 'private' as const, id: 456 },
        sender: 'null' as const,
        text: 'Current-seat message',
      };
      await act(async () => m.out.current!.select(currentSelection));
      await act(async () => stale.select(selected));
      assert.deepEqual(
        m.out.current!.selection,
        currentSelection,
        'stale selection cannot show previous-seat text',
      );
      await act(async () => stale.submit('other', 'First-seat private context'));
      assert.equal(writes.length, 1, 'stale submit cannot send through the current seat');
      assert.equal(
        stale.reported(selected.target),
        false,
        'stale predicates expose no previous-seat receipt',
      );
      await act(async () => stale.close());
      assert.equal(m.out.current!.dialogOpen, true);
      await act(async () => m.out.current!.close());
      await act(async () => stale.resume());
      assert.equal(m.out.current!.dialogOpen, false);
      await act(async () => m.out.current!.resume());
      assert.equal(m.out.current!.dialogOpen, true);
      const readCount = reads;
      await act(async () => {
        stale.refresh();
        stale.retry();
      });
      assert.equal(reads, readCount, 'stale refresh/retry cannot read through the current seat');
      await act(async () => m.out.current!.submit('other', 'Current-seat context'));
      assert.equal(m.out.current!.uncertain, true);
      await act(async () => stale.retry());
      assert.equal(writes.length, 2, 'stale retry cannot replay the current seat intent');
      await act(async () => m.out.current!.retry());
      assert.equal(writes.length, 3);
      assert.deepEqual(writes[1], writes[2]);
      assert.equal(writes[2]!.body.detail, 'Current-seat context');
      assert.equal(m.out.current!.reported(currentSelection.target), true);
      assert.equal(stale.reported(currentSelection.target), false);
      await act(async () => m.out.current!.refresh());
      assert.equal(reads, readCount + 1, 'the current generation retains working refresh controls');
      await m.unmount();
    }
});

test('a previous message dialog cannot attach its context to another message in the same seat', async () => {
  const writes: SubmitMessageReport[] = [];
  const m = await mount({
    read: async (selectedSeat) => ({
      gameId: selectedSeat.id,
      faction: selectedSeat.faction,
      available: true,
    }),
    requestId: () => 'message-report-request-1',
    write: async (_seat, body) => {
      writes.push(body);
      return receipt(body);
    },
  });
  await act(async () => m.out.current!.select(selected));
  const oldDialog = m.out.current!;
  await act(async () => m.out.current!.close());
  await act(async () =>
    m.out.current!.select({ ...selected, target: { kind: 'private', id: 456 } }),
  );
  await act(async () => oldDialog.submit('other', 'Context for the previous message'));
  assert.equal(writes.length, 0);
  await act(async () => oldDialog.close());
  assert.equal(m.out.current!.dialogOpen, true);
  await act(async () => m.out.current!.submit('spam', 'Current message'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.target.id, 456);
  await m.unmount();
});
