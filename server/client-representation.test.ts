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
