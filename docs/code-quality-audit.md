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
