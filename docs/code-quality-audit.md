# Code quality audit

Reviewed October 29, 2026, for [#51](https://github.com/mcclowes/machination/issues/51), using improve-code, separate-responsibilities, flatten-branching, and consolidate.

## Scope

Indexed responsibilities and scanned branching across 119 production TypeScript files in `App.tsx`, `src`, and `server`. Read the main orchestration, rendering, persistence, transport, validation, and replay hotspots and their relevant tests. Branch counts identify candidates; they aren't quality thresholds.

This is a review of the current design, not a permanent guarantee. Game-rule and route-eligibility work underway in the shared checkout was preserved separately.

## Changes

| Lens | Finding | Resolution | Behavior retained |
| --- | --- | --- | --- |
| Responsibilities | `GameService` owned stored-room validation, compatibility defaults, transaction scheduling, disk I/O, and game commands. | `server/database.ts` owns the database format and serialized atomic transactions. `server/service.ts` owns authorized game orchestration. | Validation errors, default metadata, reference-key migration, write permissions, rollback, restart behavior, and isolated returned snapshots. |
| Branching | HTTP routing repeatedly checked the request method and compared each POST action in a 19-case chain. | `gameRequest` selects the method once and the action once within each method. Middleware retains CORS, authentication, rate limits, and response formatting. | All routes, query validation, body parsing before POST dispatch, status codes, and issue envelopes. |
| Branching | Future-action decoding had 12 action-type comparisons plus a second dispatch, with action-selection ternaries nested four levels deep. | One action switch validates and constructs each payload. Nested hauler changes have their own local switch. | Accepted shapes, rejected missing or injected fields, optional-field semantics, error messages, and copied manifests. |
| Duplication | Thirteen command handlers separately incremented operation and seat revisions. | `reviseOrders` owns revision updates; callers name the affected owners. | Opponent revisions remain private. Legacy gifts also invalidate the recipient's revision. Retries and failed writes don't advance revisions. |
| Branching | Chart-marker symbols were selected through six nested ternaries inside JSX. | Local `siteSymbol` uses ordered guards and a kind switch. The chart remains one component. | All symbols, including destroyed-site priority and unknown-site redaction before core display. |

## Boundaries deliberately retained

- **Game orchestration:** `GameService` is still substantial, but its remaining methods coordinate authorization, receipts, seat-scoped identities, replay, and commands. Moving each endpoint into a separate file would expose these internals or require a large callback contract. Command-specific validation and errors remain local.
- **Operation screens:** local and online operations already share `OperationShell` and focused controls. Their lifecycle, network authority, and recovery policies differ. Merging them behind mode flags or splitting their rendering into a large prop contract would add coupling. Submission and retry guards also have different forecast behavior.
- **Chart interactions:** gesture refs, drag state, camera updates, and chart rendering belong together. Geometry, projection, camera calculations, and name placement already have independent modules. Extracting the marker decision earns a local function, not another component or module.
- **Simulation and combat:** event ordering and the mutations around combat, captures, and leadership share invariants. File size alone doesn't justify splitting them. Existing domain modules already own economy, travel, abilities, retirement, and visibility.
- **Replay and saves:** encoding, decoding, compatibility checks, and reconstruction checks retain their format owners. Numeric visibility calculations aren't presentation helpers. Native and web file adapters remain separate because their I/O and cleanup contracts differ.
- **Parsing and queue labels:** bounded object-reference scanning retains its local parser state. Queue labels retain distinct observed-fleet, queued-launch, and unavailable-target cases. Their local branches don't warrant generic dispatch machinery.
- **Constants and primitives:** existing domain catalogs and timing constants remain with their owners. Similar capacity numbers and button styles don't by themselves establish shared policy or a shared control contract.

## Verification

Characterized persistence concurrency, caller mutation isolation, legacy defaults, HTTP method/body/query handling, and future-action payloads before the corresponding refactors. Existing server tests cover authorization, idempotency, rollback, recovery, history, and privacy across restart.

- Persistence extraction: all 82 server tests passed at that checkpoint.
- HTTP routing and revision consolidation: all 83 server tests passed at each checkpoint.
- Future-action decoding: all 41 selected validation, scheduling, save, and replay tests passed.
- Chart cleanup: all 53 component and online tests passed. An exhaustive comparison of the original symbol expression and the replacement preserved all 96 tested combinations.
- TypeScript checks passed after each code change.
- Final `npm test`: all 749 tests passed with no skips or failures, including the concurrent test-runner and configuration additions.
- Web production export passed.
- All three standalone-server build tests passed, including offline restoration and Clerk session restoration.

Native-device layout and gestures weren't exercised. No layout or gesture handlers changed.

## Notification follow-up

The same goal was revisited against `e0707cb`, after account, notification, combat-report, and specialist work expanded the production tree to 149 TypeScript files. Indexed the current tree and revisited the service, notification lifecycle, operation screens, and simulation/combat boundaries. The original review remains the record for unchanged areas; this follow-up doesn't claim a fresh line-by-line review of every file.

### Changes

- **Responsibilities:** preference decoding, binding views, revisions, token ownership, device limits, and consent changes now belong to `server/notification-preferences.ts`. Its transaction-local interface accepts an authorized seat and returns settings plus whether incoming threats need seeding. `GameService` retains authorization, transaction ownership, time advancement, and threat seeding. The preference module needs no service callbacks or persistence access.
- **Responsibilities:** `server/failure.ts` owns the failure class shared by authentication, HTTP, preferences, and service commands. Existing service exports retain the same class identity for callers.
- **Branching:** token validation previously nested two ternaries and consulted token-property presence in two alternative paths. It now resolves presence once, then uses two guards for disabled requests and requests requiring a token. Ternary nesting falls from two levels to zero; the guards have no nested statements. Version-two omission still means a consent-only update, while an explicitly invalid token is rejected.
- **Shared policy:** settlement and preferences consult the same seat-consent predicate in `server/notifications.ts`.

### Boundaries retained

Notification delivery and durable-state validation remain in `server/notifications.ts`: their lease, expiry, token, and retry invariants share one state model. The client notification hook retains its async lifecycle because cancellation, seat changes, queued token rotations, and confirmed revisions must coordinate. Local and online screens retain their different authority models. Combat and simulation retain their ordered transitions. None warrants splitting solely to reduce file size.

Pre-existing `BeltMap`, map-layering test, and `PracticeDialogue` changes remain outside this refactor. Game rules, rendered output, API payloads, errors, persisted formats, and public service signatures are preserved.

### Evidence

- Before extraction, two added service tests passed for omitted versus invalid tokens, validation before authorization, atomic preference rollback, identical retries, and restart.
- All 46 focused preference, incoming-alert, delivery-worker, account, and HTTP-routing tests passed after extraction.
- A direct comparison against the original decoder matched accepted values and failure status/code/message across 648 combinations of versions, enablement, consent, and omitted/invalid/valid tokens.
- TypeScript, server frontmatter validation, and the web production export passed.
- Final `npm run check` passed: 1,045 behavior tests, TypeScript, and three standalone server build/restart tests. No tests failed or were skipped. The shared-tree count includes the pre-existing map-layering test. The acceptance runtime was Node 24.14.1.
- Native delivery and device interactions weren't exercised; this refactor changes server ownership only.

## Pulse geometry follow-up

Reviewed October 30, 2026, for [#51](https://github.com/mcclowes/machination/issues/51), starting at `9b65a6e`. This supplements the earlier audit with the strategic and tactical pulse implementation. Other agents concurrently changed lifecycle policy, queued-order decoding, game setup, recruitment, branding, and documentation; those changes have separate owners.

### Responsibility boundary

`pulse-simulation.ts` owned both geometric contact calculation and strategic effects such as shield drain, destruction, and victory. Tactical simulation imported its contact solver, creating a direct runtime cycle between the two effect modules.

`src/game/pulse-contact.ts` now owns asset motion and expanding-circle entry/exit times. Both effect modules import it directly. It depends on flight, drift, opening-clock, and map geometry, with no runtime import of either pulse effect module. Strategic simulation keeps its existing `expandingIntersection` export for compatibility. This removes the direct effect-module cycle; it doesn't claim to eliminate every indirect engine cycle.

The numerical operations, tolerances, wrapped-image selection, preparation behavior, engine-outage handling, and opening-rate behavior are unchanged. Four characterization tests passed against the original implementation before extraction and the extracted implementation afterward. They cover planar versus wrapped contacts, event bounds, moving-site entry and exit, tangency, equal-speed roots, preparing haulers, disabled engines, and the opening-rate boundary.

### Boundaries retained

- Tactical site and hauler effects stay local. Their short shared loop preserves contact recording, sensor jamming, site/engine damage, King effects, and event order. A descriptor with callbacks would replace the local asset checks with an additional protocol; separate loops would duplicate the shared sequence. Neither earns an extraction here.
- Strategic shield exposure and destruction remain with strategic effects. The shared geometry module doesn't own damage or balancing policy.
- Solo/practice lifecycle policy and queued-order request decoding were already being refactored by another active session. This follow-up leaves those files and the other concurrent changes untouched.
- The earlier container-packaging and incomplete network-response validation findings remain recorded in #51. They aren't resolved by this behavior-preserving pulse refactor.

### Verification

- All 39 focused geometry, strategic pulse, tactical pulse, and authoritative-server pulse tests pass, with no skips.
- TypeScript and the production web export pass.
- All three standalone server build/restart tests pass outside the sandbox, including offline and Clerk account restoration.
- Game frontmatter validation passes.
- The full behavior run failed while the shared tree was changing, with setup/economy mismatches and test timeouts. It does not establish a green full suite. Two initial focused pulse failures also reproduced with the original pulse implementation; after the other session updated the affected rule fixtures, the focused suite passed all 39 tests.
- Native-device interactions weren't exercised. This change doesn't modify UI, gestures, persisted formats, or wire contracts.

Implementation: `7070329` (Refactor: Separate pulse contact geometry from effects). Evidence logs: `/tmp/machination-quality-pulse-final.log`, `/tmp/machination-quality-server-build.log`, `/tmp/machination-quality-web.log`, and `/tmp/machination-quality-baseline.log`.

## Container packaging follow-up

Reviewed October 30, 2026, for #51. The actual Docker build reproduced four unresolved server imports: shared replay generation, numeric support, the notification contract, and presence policy. The build-stage COPY instructions and restrictive context allowlist both omitted their owners.

Both Dockerfiles now include shared replay sources and the two online runtime modules. The allowlist admits those sources while retaining the existing exclusions for tests, credentials, local state, dependencies, and native build trees. The runtime image still contains only the standalone bundle and source map.

The first corrected build exposed another hidden deployment dependency: the floating `node:24-bookworm-slim` image resolved to Node 24.22.2, which failed the replay engine's existing certified numeric-runtime guard. Both build/runtime stages now use one `NODE_VERSION=24.14.1` argument per Dockerfile, matching `.nvmrc`. No numeric checks were weakened.

One shared smoke helper bundles and executes the real `requireNumericRuntime` function inside each container. This checks the runtime contract directly instead of copying the supported V8 value into a test. Existing CI already builds and exercises both complete images, so no second Dockerfile or context parser was added.

Verification: both image builds and both existing smoke lifecycles pass, including the numeric probe, non-root execution, authenticated persistence, graceful shutdown, and container replacement. The generic image also passes backup restoration; Railway also passes missing-volume rejection and root-owned mount/private state permission checks. The numeric probe failed against the floating Node 24.22.2 image before the pin and passes against both pinned images. Test containers and volumes were cleaned up. These are local container checks; nothing was published or deployed.

Client response decoding is addressed in the follow-up below. Notification cleanup is committed separately as `3f2a4ef`. Full-suite evidence and limitations remain in [the notification review](notification-quality.md#verification). Container logs are under `/private/tmp/machination-quality-container-*` and `/private/tmp/machination-quality-railway-*`.

## Client response contract follow-up

The client previously accepted an incomplete successful response with only an operation ID, visibility marker, faction, empty messages, and `game.scheduled`. The screen could then fail while accessing missing rocks, fleets, or other required state. Existing successful-response fixtures also omitted those fields.

`src/game/observation-format.ts` now validates the observed game contract, independently of HTTP. It checks assets, manifests, routes, schedules, public rules, economy/recruitment fields, sensor coverage, compact state, and strategic/tactical pulses. It reuses the existing catalogs and rule, drift, future-action, and compact validators. It does not apply authoritative-save requirements to redacted observations or require hidden Kings to be disclosed.

`src/online/snapshot-response.ts` owns live/historical envelopes, operation and roster binding, diplomacy, optional recovery/inactivity/history metadata, and reference sidecars. Transport receives JSON as `unknown` and selects the appropriate decoder once. Reference ID validation is selected once per collection. Known and hidden site details have separate local branches. Message validation shares its common fields without threading a bilateral-mode flag through every item.

Valid wire data is returned unchanged, including additive fields and supported legacy omissions. Historical requested time remains independent of a terminal game's hour. Account restoration retains an existing operation binding and also supports a new connection with no operation ID. Authentication, cancellation, request timing, notification negotiation, and valid server errors retain their behavior. Malformed errors now produce a safe fallback message while preserving definitive 4xx versus uncertain 429/5xx semantics.

No schema dependency, generalized registry, or broad file move was introduced. Observation validation lives with the observed-game contract, envelope validation lives with the shared online protocol, and request effects remain in transport. Moving every wire type into a new directory would add churn without improving these interfaces.

Verification: 50 focused client, native-cancellation, notification, and real server/client tests pass on explicit Node 24.14.1. Three real HTTP scenarios exercise mining, domination, and pulse lobbies, drift, the compact, private diplomacy, launch manifests, queued transfers/hires/shield actions, history, and notification settings; decoded results match the exact response bytes. Regression tests first reproduced malformed envelope, asset, metadata, pulse, and error acceptance. Valid legacy views, redacted Kings, charges, tactical waves, and strategic pulses remain accepted. The strict decoder dependency graph and game/online frontmatter checks pass. Broader acceptance remains separate from this focused evidence.

## Operation test boundaries and acceptance

The operation integration hosts repeated incomplete native motion mocks. The new title presentation caused unrelated scheduling, practice, and notification-tap tests to fail before exercising their workflows. `src/test-support/operation-motion-host.ts` now supplies their shared reduced-motion preference and static animation values. Each test retains its own storage, network, clock, and device boundaries. Real web/iOS motion lifecycle tests remain independent and unchanged.

Practice asserts the title's accessible header rather than requiring text children from illustrated artwork. Shield-capacity export compares the replay's revision with the source game's revision, preserving the contract independently of constructor defaults. The destroyed-economy fixture disables unrelated rival decisions during its 48-hour advance. Production gameplay and lifecycle assertions are unchanged. The title phase helper accepts the actual input type of `Animated.add`, including composed animation values.

Verification: all 17 notification-tap scenarios, solo scheduling, practice isolation, and both real motion lifecycle tests pass. The final nine shield-capacity tests pass. The combined focused run had one historical replay failure in concurrent gameplay work; that exact test passes against committed source. The latest web export, three standalone server build/restart tests, and source-frontmatter validation pass. Earlier strict TypeScript verification passed before concurrent faction changes; the final repeat was stopped without a result to yield the Ambient release window.

Full acceptance is unresolved. The historical replay and profile-identity findings recorded on #106 and #107 now pass in the resumed current-tree run, and the earlier committed rival-AI dependency gap is resolved by `d4ea0a7`. The resumed acceptance results below supersede the earlier hold state; earlier green checkpoints above remain historical evidence.

The motion-host changes were included by a concurrent commit, `270581d`; that history was left intact. Fixture isolation and its source-revision correction are committed as `e1e3910` and `d7f0d97`. No changes were pushed or deployed.

### Resumed acceptance #3234

A fixed copy of the current tree captured 610 source, configuration, and asset files plus the owned cadence-fixture correction. Dependencies were shared through a symlink. Node 24.14.1 and the existing bounded runner were selected explicitly, with a single Turnstile job and no duplicate acceptance or compiler jobs.

The cadence comparison and historical mine-replay restoration pass. Buffered output records 23 failing test cases in shared-replay UI, contested/generated matches, and historical archive tracing; the configuration-invariant matrix was interrupted separately. No final suite summary exists, and the chained typecheck and standalone-build stages weren't reached. The full goal remains unverified.

At the release owner's request, a one-second stack sample and two process snapshots inspected only this job. The remaining configuration test consumed CPU while its RSS fell from about 255 MB to 240 MB; the first full process-tree reading was about 443 MB. These observations don't establish a growing leak or explain the scheduler's earlier 5 GB estimate. The already-failing run was stopped to release the Ambient window. All observed child processes exited, and the requested notification was delivered to Saggar session `0C10F5B2`. New heavy work remains held.

Evidence: `/private/tmp/machination-quality-resumed-final.log`, `/private/tmp/machination-quality-resumed-acceptance/QUALITY_SOURCE_MANIFEST.json`, `/private/tmp/machination-quality-3234-processes.json`, and `/private/tmp/machination-quality-3234-stack.txt`. The next acceptance attempt must inspect the recorded failures before scheduling a retry.

### Targeted acceptance repairs

All 23 assertion failures recorded in #3234 now pass in focused checks. Match assertions include battle coordinates while retaining exact event order, audiences, and simulation state. Historical restoration still matches the entire stored record; traced and ordinary reconstruction agree, and historical simulation comparison excludes only later map annotations. Replay UI tests cover badge inspection at an unobstructed endpoint and site inspection while a departing hauler overlaps its site. Complete accessible labels use the terminology catalog.

- `fe549f6`: all 20 generated and contested match scenarios pass.
- `40aa3a8`: all 22 simulation-trace and battle-marker tests pass.
- `5bf334a`: all 16 shared-replay UI and specialist-placement tests pass on the web/iOS hosts.

These checks have no failures or skips. They do not establish full acceptance: the configuration matrix and current quality guards remain in the final gate. A fixed candidate captures 640 current files and their SHA-256 hashes, with installed dependencies shared by symlink. The working tree matched every captured file when the gate was submitted. The single pending command is `npm run check` on explicit Node 24.14.1 through Turnstile, with existing deadlines and floors. Evidence is in `/private/tmp/machination-quality-completion-check.log`; no full-suite pass is claimed while it is pending.
