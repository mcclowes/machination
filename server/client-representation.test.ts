/** @format */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientRepresentation } from './client-representation';

test('Accept preferences only enable newer rules when the current representation is supported and preferred', () => {
  for (const [accept, version] of [
    [undefined, 18],
    ['*/*', 18],
    ['application/vnd.machination.v2+json;q=0, application/json', 18],
    ['application/vnd.machination.v2+json;q=0.9, application/json;q=0.1', 19],
    ['APPLICATION/VND.MACHINATION.V2+JSON', 19],
    ['application/vnd.machination.v2+json;q=0.2, application/json;q=1', 18],
    ['application/vnd.machination.v999+json, application/json', 18],
    ['application/vnd.machination.v2+json;q=invalid, application/json', 18],
    ['application/*;q=1, application/json;q=0, application/vnd.machination.v2+json;q=0.5', 19],
  ] as const)
    assert.equal(
      clientRepresentation(accept).mechanicsVersion,
      version,
      accept ?? 'no Accept header',
    );
});

test('packed replay negotiation requires an explicit preferred current-representation capability', () => {
  for (const [accept, expected] of [
    ['application/vnd.machination.v2+json; replay=3, application/json', true],
    ['application/vnd.machination.v2+json, application/json', false],
    ['application/json; replay=3', false],
    ['application/vnd.machination.v2+json; replay=3;q=0, application/json', false],
    [
      'application/vnd.machination.v2+json; replay=3;q=0.1, application/vnd.machination.v2+json;q=1',
      false,
    ],
    ['application/vnd.machination.v2+json; replay=3;q=0.5, application/json;q=1', false],
    ['application/vnd.machination.v2+json; replay=999, application/json', false],
    ['application/vnd.machination.v2+json; replay=3;q=invalid, application/json', false],
  ] as const)
    assert.equal(clientRepresentation(accept).packedReplay, expected, accept);
});

test('the negotiated HTTP serializer preserves packed signed-zero site values', async () => {
  const { responseJson } = await import('./client-representation');
  const { packSharedReplay, decodePackedReplay } = await import('../src/replay/packed');
  const scene = {
    hour: 0,
    rocks: [{ id: 'a', name: 'Site', x: -0, y: 0, known: false, kind: 'unknown' as const }],
    fleets: [],
    coverage: [],
    cargo: {},
    eliminated: [],
    winner: null,
  };
  const packed = packSharedReplay({
    kind: 'machination.observed-timeline',
    schemaVersion: 1,
    presentationVersion: 1,
    history: 'canonical-events',
    perspective: 'you',
    from: 0,
    through: 0,
    groups: [{ hour: 0, states: [scene] }],
    spans: [],
  });
  const raw = responseJson(
    packed,
    clientRepresentation('application/vnd.machination.v2+json; replay=3, application/json'),
  );
  assert.ok(Object.is(decodePackedReplay(raw).siteDictionary[0]!.x, -0));
});
