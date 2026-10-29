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
