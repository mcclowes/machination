import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeReplayArtifact, decodeReplayArtifact, seekReplayArtifact, replayArtifactRules } from './artifact';
import { packSharedReplay } from './packed';
import type { SharedReplay } from './timeline';

function fixture(): SharedReplay {
  return { kind: 'machination.observed-timeline', schemaVersion: 1, presentationVersion: 1, history: 'canonical-events', perspective: 'you', from: 0, through: 0,
    groups: [{ hour: 0, states: [{ hour: 0, rocks: [], fleets: [], coverage: [], cargo: {}, eliminated: [], winner: null }] }], spans: [] };
}

test('the artifact boundary reads legacy and packed files without expanding stored packed scenes', () => {
  const original = fixture();
  for (const replay of [original, packSharedReplay(original)]) {
    const decoded = decodeReplayArtifact(encodeReplayArtifact(replay));
    assert.equal(decoded.schemaVersion, replay.schemaVersion);
    assert.deepEqual(seekReplayArtifact(decoded, 0), original.groups[0]!.states[0]);
    assert.equal(replayArtifactRules(decoded), undefined);
  }
});

test('schema dispatch does not invoke encoder getters or serialization hooks', () => {
  let invoked = false;
  const replay = fixture();
  Object.defineProperty(replay, 'schemaVersion', { enumerable: true, get() { invoked = true; return 3; } });
  assert.throws(() => encodeReplayArtifact(replay));
  assert.equal(invoked, false);
  const hooked = packSharedReplay(fixture());
  Object.defineProperty(hooked, 'toJSON', { value() { invoked = true; return {}; } });
  assert.throws(() => encodeReplayArtifact(hooked)); assert.equal(invoked, false);
});
