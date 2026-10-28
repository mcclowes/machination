# Shared observed replays

Issue #18 tracks player-facing replay creation, sharing, import, and offline viewing. The publisher's [version 11782 release note](https://apps.apple.com/us/app/subterfuge/id702951905) establishes creation and sharing of replays. It doesn't specify an artifact format, gestures, access policy, or postgame omniscience. The following is the rebuild contract; exact original-client behavior remains unverified.

The target is a complete observed chart timeline, including brief contacts, battles, and continuous visible movement. Fixed samples that miss activity don't establish this capability. Export capacity limits must fail explicitly rather than silently dropping events or replacing exact playback with samples.

## Disclosure and presentation

Export is an explicit player action with a disclosure preview. The recipient can inspect and redistribute the included creator-perspective chart observations. Actual observed/preparing haulers and visible manifests belong to that chart record; private future queues, recruitment offers/pools/seeds, funding identities, raw command history, chat, channel membership, session credentials, invitation/recovery data, map seeds, and internal contact bookkeeping don't. No artifact is automatically uploaded or sent to another person.

The presentation projection is an explicit allowlist over an already filtered `GameView`, not serialization of Game, ReplayArchive, or an entire authenticated snapshot. Known sites retain chart/inspector fields: identity/name/coordinates, owner/type, drones, destruction, core identity, shields, module, and visible specialist identity/kind/owner/captivity. Unknown sites retain only their normal public chart fields and type exceptions. Public rules retain roster and selected portraits, mode, victory target, mechanics version, and seed-free geometry/generator. Newly added public presentation metadata can be versioned deliberately; unknown properties aren't spread into exports.

Observed fleets retain route/arrival/manifest/mission fields needed by the chart, without private contact history or unit action clocks. Fleet/unit identities are remapped in an export-local namespace on first observed appearance, rather than publishing canonical counters or a donor's command aliases. Interception targets are included only when present in that same observed frame. Public cargo/sponsor counts, elimination/winner/draw, and the creator's coverage are retained. Private events and their free-form command prose are omitted; tactical effects come from the observed state timeline.

## Complete timeline

Trusted reconstruction stays on the creator's device or authenticated server. Engine tracing must preserve event and same-hour command ordering without changing physics or inserting sonar crossings as extra advancement targets. Between physical changes, observation is evaluated over continuous movement. Exact entry/exit intervals cover moving contacts, torus wrapping, incoming/owned exceptions, legacy mobile coverage, and inclusive boundary contacts.

Artifact records contain only allowed presentation changes and visible motion intervals. Boundaries introduced solely by hidden commands or unchanged internal state must disappear from the exported structure. No interpolation bridges an unobserved period or an unknown route change. The viewer doesn't run the authoritative simulation, apply commands, make network requests, or mount live session/save hooks. Import is strict, bounded, and separate from private save/replay decoding.

## Implementation and acceptance gates

Independent work can establish the allowlisted presentation projection while tracing and interval design are reviewed. Complete export generation, strict codec, authenticated generation, read-only viewer, and native/web file adapters must integrate before claiming the player-facing replay feature is delivered.

Required evidence includes short-lived contacts/battles absent at sample-grid endpoints, fractional boundary/tangent cases, torus and moving legacy sensors, same-hour effects, actual old replay fixtures, deterministic partition behavior, and paired worlds with identical allowed observations but different hidden orders/data. Private sentinels must be absent at every nesting level. Failed capacity/storage/import must produce no partial or misleading artifact and leave live state intact. Offline playback must work with networking disabled, while original-client gestures and physical-device acceptance remain separate.

## Foundation status

`acb352d` adds the allowlisted detached presentation projector and export-local identities. The integration also retains the newly committed public portrait choices. `fb1b7f0` and `be954ed` add private trace callbacks with trace-on/off, sink-mutation, same-hour ordering, queued execution, timed abilities, destruction, route/interception, legacy continuous economy, and actual old replay-fixture checks. Those callbacks remain private and add no public endpoint or serialized Game fields.

Continuous geometry helpers decompose clamped flights and solve closed affine sensor intersections, including tangency, moving legacy sensors, overlapping coverage, seams, multiple wraps beyond nine neighboring images, and explicit sweep capacity refusal. A fixed-span policy adapter reuses the actual incoming/own/preparation, officer, wreck, and legacy/mobile rules. Differential interior checks compare support against current wrapped/planar distance and observation predicates. These helpers never advance the engine or mutate trace state.

The trace/geometry boundary is not yet a complete public exporter. Binary64 tangent classification, epsilon-near due-time behavior, arbitrary-target/call-partition equivalence, legacy continuous counter laws, private-boundary coalescing, full import validation, viewer/file delivery, and offline/native acceptance remain proof and implementation gates. Analytic closed roots alone do not certify every adjacent floating-point observation. A read-only runtime diagnosis is checking those concrete timing cases before the timeline builder claims exact coverage.

The repository test command now includes `src/replay/*.test.ts`, so new replay tests run in the normal suite rather than only by direct invocation. No sampled replay endpoint, raw archive download, or incomplete viewer has been substituted for the required player-facing feature.

Foundation validation: 395 repository tests pass, including 19 presentation/interval tests in the newly included replay directory. TypeScript, web export, and the standalone production server's two checks pass. This verifies the implemented foundations and regressions, not complete artifact generation or recipient playback.
