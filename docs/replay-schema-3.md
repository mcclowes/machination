# Packed observed replay schema 3

Tracking: [export capacity #158](https://github.com/mcclowes/machination/issues/158). This codec is implemented locally. The exporter, importer, viewer, and HTTP service still use schemas 1 and 2. No endpoint negotiates or returns schema 3 yet.

## Purpose and compatibility

Schema 3 removes repeated whole-site payloads and public rules from scenes without changing their values, timestamps, order, or evaluation anchors. It does not merge motion laws, round numbers, sample events, shorten intervals, or change simulation rules. Schemas 1 and 2 keep their existing shapes and validators. Their decoder explicitly rejects schema 3.

The implementation is in `src/replay/packed.ts`. `packSharedReplay` accepts a valid legacy timeline under the existing limits and produces a detached packed timeline. `encodePackedReplay` and `decodePackedReplay` validate schema 3. `seekPackedReplay` accepts a validated packed timeline and returns one detached scene. The existing next/previous causal-step functions also accept packed timelines.

## Wire shape

Schema 3 retains the legacy `kind`, `presentationVersion`, `history`, `perspective`, `from`, and `through` fields. The additional fields are:

| Field | Meaning |
| --- | --- |
| `schemaVersion: 3` | Explicitly selects this format |
| `geometryVersion: 1 \| 2` | Original static/drifting chart contract |
| `siteDictionary` | Array of complete disclosed site objects, using the existing site allowlist |
| `rules` | Optional single public-rules object shared by every scene |
| `groups` | Ordered boundary groups with ordered causal states |
| `spans` | One original anchored scene for each open interval between groups |

Each scene keeps its existing fields, except `rocks` is an array of nonnegative integer dictionary indexes, and `rules` is forbidden inside scenes. Indexes can reference only the site dictionary; dictionaries cannot reference other dictionaries. Each selected frame must still have unique site and specialist identities, valid fleet endpoints, valid disclosures, and the same chart. Every dictionary entry must be reachable from at least one scene. The shared public rules must include the recorded perspective when present.

Interning uses exact structural identity. Object key order is ignored; array order, signed zero, adjacent binary64 values, nulls, and absent fields remain distinct. Packing refuses differing public-rules values instead of silently choosing one. The serializer emits the valid JSON token `-0` explicitly; ordinary `JSON.stringify` would normalize it. Parsing uses ordinary JSON syntax and preserves that token's value. No engine-private fields or new disclosure allowances are introduced.

## Resource and ownership limits

- The stored envelope retains the existing 64 MiB serialized-byte, 250,000-node, and 32-level depth limits. Dictionary nodes and every reference count toward storage.
- Each expanded scene retains the existing 250,000-node and depth limits, plus the existing site, fleet, and specialist caps.
- Aggregate expanded validation data is limited to 8,000,000 nodes, or 32 times the stored-node budget. This is a separate validation-work bound, not an increase in storage or selected-frame capacity. Existing per-scene collection caps also bound cross-reference checks.
- A preflight counts dictionary entries once, adds their costs for every reference, and checks the complete expansion budget before semantic validation. Dangling, fractional, negative, or nonnumeric indexes and unreachable entries fail explicitly.
- Validation materializes one shallow scene at a time. The decoded result stays packed. Seeking copies only the selected expanded scene and evaluates its original motion law. Mutating that result cannot mutate the dictionary, public rules, or a later seek.
- Encoding inspects plain-data descriptors before reading fields, preventing getters, hooks, cycles, or hidden extra properties from participating in serialization. Import also checks bytes and nesting before parsing.

These bounds do not promise a particular mobile latency. Baseline-device profiling remains required before integration.

## Verification and remaining work

Nine focused tests cover every causal frame and sampled interiors of a real ten-seat pulse/gravity timeline, authoritative curved-flight observations and positions, original causal stepping, drifting charts, scenes without rules, negative zero and neighboring values, detached ownership, malformed/private/unreachable references, hooks/cycles, and separate expansion budgets. A repeated 20,000-specialist dictionary is accepted at 90 states and refused at 101; stored data remains below the unchanged node cap in both cases.

On Node 24.14.1, the ten-seat default pulse/gravity baseline from the [measurement experiment](replay-packing-experiment.md) has 43,691 nodes and 663,646 bytes in legacy form, versus 10,285 nodes and 97,347 bytes in schema 3. It retains all 14 groups, 27 causal states, and 13 spans. This is not the missing terminal failure capture.

The current packer validates a complete bounded legacy timeline first. It cannot yet repair an export that already exceeds the legacy limit. Incremental interning during generation, exact same-hour/coalescing retention, bounded dictionary reclamation, explicit HTTP negotiation with released-client fallback, client integration, endgame reproduction, and full release acceptance remain required. Do not mark #158 complete based on this codec or the smaller baseline.

## Reproduced terminal failure, November 1

A fresh pure-engine reproduction removes the dependency on the missing earlier capture. Create `createConfiguredGame({ playerCount: 10, mode: 'pulse' }, 0, 2026)` with its unmodified default rules. Create its archive, then apply `START_CHARGE` through `applyCommand` for every roster owner at `knownThrough: 384`, with `rivals: false`. Before charging, each owner's observation of ordinary advancement to hour 384 must show at least 100 material. Apply `FIRE_PULSE` for every owner at `knownThrough: 392`, then advance normally to hour 416. Use unique command IDs and retain the same archive throughout.

The operation stops naturally at hour `402.2372847909963`, with `prism` winning and nine eliminated factions. `generateSharedReplay(operation, 'you', game.hour - 8, game.hour)` rejects with `replay-capacity`. No resources, rules, winners, or terminal state were edited. This deterministic engine reproduction is not the HTTP/SQL lifecycle acceptance in #157 and does not replace it.

The synthetic game/archive capture is retained privately at `/private/tmp/machination-packed-endgame-J9VCd3/operation.json` (110,321 bytes; SHA-256 `ae0e6fbab0165b9835f907c76eae53053b729352bd0f4ec64f2c82aec5399b1e`). The recipe above can recreate it if temporary files are removed. Incremental packed generation must preserve the complete final eight-hour interval of this case before #158 can close.

A bounded scratch incremental generator subsequently exported that entire failing interval through the implemented codec without increasing any stored-data limits. It retained 165 groups, 216 causal states, and 164 spans, with 120 dictionary entries, 111,544 stored nodes, and 1,213,794 serialized bytes. Sorted structural SHA-256 comparisons, preserving signed-zero distinctions, matched all 216 committed source states and all 164 original span anchors after packing/decoding. This comparison uses the existing canonical trace and motion kernel; it is not an independent engine proof of every interior value.

The scratch prototype and its successful result are retained beside the capture as `prototype.ts` and `prototype-result-exact.log`. It caps source projections at 4,000 and pending expanded data at 8,000,000 nodes, checks committed stored nodes against the unchanged codec limit, and submits its final timeline to the strict schema-3 encoder and decoder. It delays dictionary insertion until a pending boundary is committed, so coalesced boundaries leave no unreachable entries. Its repeated whole-envelope budget scans and expanded pending-state retention are diagnostic choices, not the production incremental-retention implementation. No source generator or endpoint was changed by this experiment.

Current-source verification on Node 24.14.1: `npm run check` passed source quality, 1,698 behavior tests, and 13 standalone server-build tests with zero failures or cancellations. Seven behavior and seven server-build Postgres/TLS checks were explicitly skipped because fixture variables were absent. `npm run test:postgres-tls -- --full` could not create fixtures: the Docker socket was absent both inside and outside the sandbox. These skips are not database acceptance evidence. The successful unrestricted gate log is `/private/tmp/machination-packed-check-unrestricted.log`.
