# Packed observed replay schema 3

Tracking: [export capacity #158](https://github.com/mcclowes/machination/issues/158). Schema 3 is integrated locally into solo export, multiplayer export, local import, disclosure preview, and playback. It has not been deployed or included in a new native candidate. Released clients keep schemas 1 and 2 through explicit negotiation.

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

The standalone `packSharedReplay` helper still validates a bounded legacy timeline first. Production export uses the separate incremental generator described below, so it never constructs an oversized legacy timeline as an intermediate step. Full HTTP/SQL endgame acceptance, baseline-device profiling, and a fresh native candidate remain required before release. Do not mark #158 complete from the opening baseline alone.

## Reproduced terminal failure, November 1

A fresh pure-engine reproduction removes the dependency on the missing earlier capture. Create `createConfiguredGame({ playerCount: 10, mode: 'pulse' }, 0, 2026)` with its unmodified default rules. Create its archive, then apply `START_CHARGE` through `applyCommand` for every roster owner at `knownThrough: 384`, with `rivals: false`. Before charging, each owner's observation of ordinary advancement to hour 384 must show at least 100 material. Apply `FIRE_PULSE` for every owner at `knownThrough: 392`, then advance normally to hour 416. Use unique command IDs and retain the same archive throughout.

The operation stops naturally at hour `402.2372847909963`, with `prism` winning and nine eliminated factions. `generateSharedReplay(operation, 'you', game.hour - 8, game.hour)` rejects with `replay-capacity`. No resources, rules, winners, or terminal state were edited. This deterministic engine reproduction is not the HTTP/SQL lifecycle acceptance in #157 and does not replace it.

The synthetic game/archive capture is retained privately at `/private/tmp/machination-packed-endgame-J9VCd3/operation.json` (110,321 bytes; SHA-256 `ae0e6fbab0165b9835f907c76eae53053b729352bd0f4ec64f2c82aec5399b1e`). The recipe above can recreate it if temporary files are removed. Incremental packed generation must preserve the complete final eight-hour interval of this case before #158 can close.

A bounded scratch incremental generator subsequently exported that entire failing interval through the implemented codec without increasing any stored-data limits. It retained 165 groups, 216 causal states, and 164 spans, with 120 dictionary entries, 111,544 stored nodes, and 1,213,794 serialized bytes. Sorted structural SHA-256 comparisons, preserving signed-zero distinctions, matched all 216 committed source states and all 164 original span anchors after packing/decoding. This comparison uses the existing canonical trace and motion kernel; it is not an independent engine proof of every interior value.

The scratch prototype and its successful result are retained beside the capture as `prototype.ts` and `prototype-result-exact.log`. It caps source projections at 4,000 and pending expanded data at 8,000,000 nodes, checks committed stored nodes against the unchanged codec limit, and submits its final timeline to the strict schema-3 encoder and decoder. It delays dictionary insertion until a pending boundary is committed, so coalesced boundaries leave no unreachable entries. Its repeated whole-envelope budget scans and expanded pending-state retention are diagnostic choices, not the production incremental-retention implementation. No source generator or endpoint was changed by this experiment.

Codec checkpoint `7eeafaf` verification on Node 24.14.1: `npm run check` passed source quality, 1,698 behavior tests, and 13 standalone server-build tests with zero failures or cancellations. Seven behavior and seven server-build Postgres/TLS checks were explicitly skipped because fixture variables were absent. `npm run test:postgres-tls -- --full` could not create fixtures: the Docker socket was absent both inside and outside the sandbox. These skips are not database acceptance evidence. The successful unrestricted gate log is `/private/tmp/machination-packed-check-unrestricted.log`.


## Integrated generation and negotiation

`src/replay/trace-observed.ts` owns the unchanged frozen canonical trace, visibility boundaries, projection, and original scene anchors. Both legacy and packed generators consume it. `generatePackedReplay` interns only exact whole-site values, retains packed scenes, and counts dictionary references. Removing a coalesced pending boundary releases its references; entries with no remaining references are removed and their slots reused. Final compaction rewrites only dictionary indexes. It does not change site values, fleet/specialist aliases, group order, timestamps, or anchors.

Incremental storage and expanded-validation accounting preserve the existing final limits. Temporary accounting permits the same bounded two-frame pending-boundary/candidate slack used by the legacy recorder. Final validation permits no slack. A capacity refusal produces no artifact and leaves the authoritative game/archive unchanged. Tests compare all legacy-compatible causal states, span anchors, and interior samples on static and drifting charts; hidden scheduled commands and private prose produce byte-identical packed exports.

Multiplayer exports explicitly advertise `Accept: application/vnd.machination.v2+json; replay=3, application/json`. The server enables schema 3 only when that capability is present on a preferred, positive-quality current representation. An absent capability, zero/invalid quality, unsupported replay version, or preferred legacy representation keeps the legacy behavior. The response varies on Accept and uses the schema-3 serializer so negative zero survives the actual HTTP response path. Other endpoints and game mechanics support retain their existing negotiation.

An older server can ignore the replay parameter and return schema 1/2; the updated client decodes it without another request. Released clients never send the capability and continue receiving schema 1/2 or the existing explicit capacity refusal. Their actual bundled decoders pass the compatibility suite. A schema-3 file needs an updated decoder; older installed apps cannot import it.

The client artifact boundary dispatches strict decoding, encoding, selected-frame seeking, and public rules lookup across all three schemas. Import and playback retain the packed timeline and materialize only the selected frame. Export preview keeps its separate explicit Save action and stale-work guards. Browser/native-host lifecycle tests run all legacy and packed scenarios independently.

A fresh ordinary ten-seat operation also passes through actual loopback HTTP and file persistence, with real response validators and rate limiting and an explicitly injected clock. Controllers use only their own snapshots, keep seats active every eight game hours, accumulate material naturally, charge at hour 384, fire at hour 392, and require a natural ending by hour 416. They verify the complete final-eight-hour schema-3 export, immutable rules, final winner/eliminations/cargo, absence of room credentials, restart, and exact export retention after retrying an already accepted fire command. No seed, resources, rules, or winners are injected. This is file-backed HTTP evidence, not SQL acceptance or the full lost-acknowledgment protocol in #157.

`visual-tests/shared-replay.spec.ts` passes file-picker import, causal stepping, playback, end seeking, and return to the library for legacy and packed files on desktop and touch-phone browser viewports, with networking disabled after import. Screenshots are saved in `.fettle/shots/`. These browser checks do not establish native document-provider, device performance, or physical-device acceptance.

Two additional bounded file-backed HTTP profiles pass against the same frozen source: two seats firing at hour 392 produce a persistent natural draw, and delaying the second seat until hour 393 makes the earlier emitter the sole winner. Both retain natural material accumulation, sensor-limited controllers, immutable default rules, complete final-eight-hour export, restart, and identical output after a repeated accepted fire command. The privately retained drivers/results are `/private/tmp/machination-packed-two-seat-nMcOuv/`. They create ordinary HTTP operations without injected seeds/resources and capture a failed room before cleanup. Together with the ten-seat regression, these cover the three outcome profiles over HTTP/file storage; they do not establish SQL, uncertain-response recovery before acknowledgment, native-device, or hosted-service acceptance.

Integrated checkpoint verification, November 1, 2026, Node 24.14.1: `npm run check` passed lint, formatting, architecture, TypeScript, 1,711 behavior tests, and 13 standalone server-build tests, with zero failures or cancellations. Seven behavior and seven server-build SQL/TLS cases were explicitly skipped because the Docker fixture socket is absent; no database acceptance is claimed. The final log is `/private/tmp/machination-packed-integrated-final-check.log`. The final-source web export and all four desktop/phone browser cases also pass (`machination-packed-integrated-final-web.log` and `machination-packed-integrated-final-browser.log` under `/private/tmp`). Current incremental generation reproduces the original scratch metrics for the retained terminal capture: 111,544 records, 1,213,794 bytes, 165 groups, 216 causal states, and 164 spans.
