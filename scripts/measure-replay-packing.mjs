/** @format */
/** Offline experiment only. This envelope is not a supported replay format. */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function exactKey(value) {
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (Array.isArray(value)) return ['array', value.map(exactKey)];
  if (value && typeof value === 'object')
    return [
      'object',
      Object.keys(value)
        .sort()
        .map((key) => [key, exactKey(value[key])]),
    ];
  return [typeof value, value];
}

function records(value) {
  return (
    1 +
    (value && typeof value === 'object'
      ? Object.values(value).reduce((n, child) => n + records(child), 0)
      : 0)
  );
}

export function measureReplayPacking(replay) {
  assert.equal(replay.kind, 'machination.observed-timeline');
  assert.ok(replay.schemaVersion === 1 || replay.schemaVersion === 2);
  const rocks = [],
    rules = [],
    rockKeys = new Map(),
    ruleKeys = new Map();
  function intern(value, dictionary, keys) {
    const key = JSON.stringify(exactKey(value));
    let index = keys.get(key);
    if (index === undefined) {
      index = dictionary.length;
      keys.set(key, index);
      dictionary.push(structuredClone(value));
    }
    return index;
  }
  function pack(scene) {
    const { rocks: sites, rules: publicRules, ...rest } = scene;
    return {
      ...rest,
      rocks: sites.map((site) => intern(site, rocks, rockKeys)),
      ...(publicRules === undefined ? {} : { rules: intern(publicRules, rules, ruleKeys) }),
    };
  }
  const packed = {
    ...replay,
    groups: replay.groups.map((group) => ({ ...group, states: group.states.map(pack) })),
    spans: replay.spans.map((span) => ({ ...span, scene: pack(span.scene) })),
  };
  const envelope = { experiment: 'exact-site-dictionary', rocks, rules, timeline: packed };
  function unpack(scene) {
    return {
      ...scene,
      rocks: scene.rocks.map((id) => structuredClone(rocks[id])),
      ...(scene.rules === undefined ? {} : { rules: structuredClone(rules[scene.rules]) }),
    };
  }
  const restored = {
    ...packed,
    groups: packed.groups.map((group) => ({ ...group, states: group.states.map(unpack) })),
    spans: packed.spans.map((span) => ({ ...span, scene: unpack(span.scene) })),
  };
  // Includes every intermediate ordinal, anchor, field, and binary64 value, including negative zero.
  assert.deepStrictEqual(restored, replay);
  const size = (value) => ({
    records: records(value),
    bytes: Buffer.byteLength(JSON.stringify(value)),
  });
  return {
    original: size(replay),
    packed: size(envelope),
    uniqueSites: rocks.length,
    uniqueRules: rules.length,
    groups: replay.groups.length,
    states: replay.groups.reduce((n, group) => n + group.states.length, 0),
    spans: replay.spans.length,
    exactRoundTrip: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  assert.ok(path, 'Usage: node scripts/measure-replay-packing.mjs observed-timeline.json');
  assert.ok(
    (await stat(path)).size <= 64 * 1024 * 1024,
    'Input exceeds the 64 MiB diagnostic budget',
  );
  console.log(
    JSON.stringify(measureReplayPacking(JSON.parse(await readFile(path, 'utf8'))), null, 2),
  );
}
