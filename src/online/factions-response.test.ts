import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factionsApi } from './network';
import { snapshotResponse } from './snapshot-response';
import { testSnapshot } from './test-snapshot';

test('faction standings reject malformed identities, counts, and missing or duplicate leaderboard factions', async t => {
  const good = { completedGames: 1, faction: 'mnemosyne', leaderboard: [{ faction: 'mnemosyne', wins: 3 }, { faction: 'vesper', wins: 1 }, { faction: 'null', wins: 0 }] };
  let response: unknown = good;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  const session = { url: 'https://belt.example', token: 'seat' };
  assert.deepEqual(await factionsApi(session), good);
  for (const malformed of [null, {}, { ...good, faction: 'you' }, { ...good, completedGames: -1 }, { ...good, completedGames: 0.5 },
    { ...good, leaderboard: good.leaderboard.slice(1) }, { ...good, leaderboard: good.leaderboard.map(() => good.leaderboard[0]) },
    { ...good, leaderboard: good.leaderboard.map(row => ({ ...row, wins: -1 })) }]) {
    response = malformed;
    await assert.rejects(factionsApi(session), /Unsupported faction standings/);
  }
});

test('live faction rooms require exactly one valid allegiance for each joined seat', () => {
  const ordinary = testSnapshot();
  assert.equal(snapshotResponse(undefined, ordinary), ordinary);
  const variant = { ...ordinary, variant: 'faction', allegiances: ordinary.members.map(player => ({ player, faction: 'mnemosyne' })) };
  assert.equal(snapshotResponse(undefined, variant), variant);
  for (const malformed of [{ ...variant, variant: 'unknown' }, { ...variant, variant: undefined }, { ...variant, allegiances: undefined },
    { ...variant, allegiances: variant.allegiances.slice(1) }, { ...variant, allegiances: variant.allegiances.map(() => variant.allegiances[0]) },
    { ...variant, allegiances: variant.allegiances.map(a => ({ ...a, faction: 'you' })) }]) {
    assert.throws(() => snapshotResponse(undefined, malformed), /Unsupported server response/);
  }
});
