# Notification code quality

Reviewed October 30, 2026, for [#51](https://github.com/mcclowes/machination/issues/51), using improve-code, separate-responsibilities, and flatten-branching. This supplements the earlier [code quality audit](code-quality-audit.md) and [lifecycle and schedule review](lifecycle-and-schedule-quality.md).

## Responsibility boundary

`server/notification-state.ts` owns the persisted notification schema, capacity limits, token syntax, and startup validation. Its validator accepts the database and checks binding ownership, revision floors, incoming-threat ledgers, leases, tickets, and job identity. It has no runtime dependencies, performs no I/O, and makes no delivery decisions.

`server/notifications.ts` owns transaction-local binding changes, enqueueing, delivery claims, and completion transitions. `DatabaseStore` imports the schema validator directly. Existing notification exports remain compatible, including the validator, constants, and types.

The earlier audit retained validation with delivery because they share state invariants. Moving the schema and its limits together gives validation a complete owner, without callbacks into delivery or a runtime import cycle. Moving the validator alone would leave a weaker boundary. Validation expressions, evaluation order, errors, stored shapes, and defaults are unchanged.

## Branching

| Decision | Before | After | Boundary |
| --- | --- | --- | --- |
| Send result | Three `result.kind` comparisons, with token cleanup nested in the terminal branch. | One switch; ticket and retry paths continue, and terminal results share job removal. | `finishSends` owns the result transition. |
| Receipt result | Five `result.kind` comparisons, including a retry-delay ternary and expiry handling nested in the recheck branch. | One switch; missing and retry cases pass their delay to one recheck operation. | `finishReceipts` selects the operation; `recheckReceipt` owns cadence and retention. |
| Notification content | Two job-kind comparisons plus separate renderer-result ternaries for payload kind and channel. | One job-kind guard resolves body, kind, and channel together; a separate guard rejects obsolete incoming work. | `notificationContent` runs before common lease and payload construction. |

Branch nesting within result dispatch falls from two statement levels to one. Expiry checks remain local to requeue/recheck operations. An incoming renderer still runs only for incoming jobs, before an attempt or lease is spent. Obsolete incoming work does not consume the batch limit. Empty rendered bodies, notification IDs, TTLs, token hashes, and payload shapes are preserved.

## Boundaries retained

- Keep queue claims, token invalidation, and completion mutations together. Their lease, attempt, token-rotation, and cancellation invariants share one state model; one file per transition would add navigation without an independent contract.
- Keep database transaction ownership in `DatabaseStore`, authorization and threat settlement in `GameService`, and provider I/O in the delivery worker. No generic workflow registry or callback layer is needed.
- Keep cohesive simulation/combat ordering and chart gesture/rendering state together. Their existing domain and geometry modules already provide useful boundaries.
- Preserve the concurrent game-rule, map, practice-dialogue, replay, and depletion changes. This pass does not split operation screens around unstable interfaces or combine local and online execution behind mode flags.
- Subsequent [container packaging](code-quality-audit.md#container-packaging-follow-up) and [client response contract](code-quality-audit.md#client-response-contract-follow-up) follow-ups resolve the separate source-context, numeric-runtime, and incomplete response-decoding findings.

## Verification

- Before extraction, a restart characterization test rejected 35 inconsistent metadata shapes without rewriting the damaged file, and accepted six valid queued, leased, ticketed, checking, ledger, and incoming states unchanged.
- Before branch cleanup, a mixed-claim test covered obsolete incoming alerts, the batch limit, empty bodies, message/attack kind and channel selection, payload keys, attempts, and duplicate-claim prevention.
- All 46 focused notification, preference, incoming-alert, delivery-worker, and persistence tests passed after both changes.
- A direct comparison against the original module matched 23,040 completion transitions and 7,680 claims across leases, attempt limits, expiry, receipt retention, token rotation, consent, renderer results, and batch limits. Runtime exports and constants matched. The validator source moved unchanged.
- Server frontmatter validation and owned diff checks passed. Bundling the persisted-state module confirmed that it has no runtime imports.

- The current shared tree passes `npm run typecheck`. A separate snapshot of committed base `f2db696` plus this refactor has three pre-existing AI type errors; compiling the original implementation through the same snapshot produces identical diagnostics. The refactor adds no diagnostics to that snapshot.
- The production server bundle and all three standalone build/restart tests pass, including offline and Clerk account restoration without project dependencies.
- The full `npm run check` failed at its 600-second suite deadline on the changing shared tree under host memory contention. It also reported a drifting-room test failure; that test passed in a subsequent focused rerun without changes to this task's code. There is no full-suite pass claim. The final notification rerun passes all 46 tests with no failures or skips.
- A second full check is queued on a fixed snapshot matching all 391 current source/configuration files. It reuses the installed dependencies through a symlink and leaves the shared checkout unchanged. Its result is pending in `/private/tmp/machination-notification-quality-snapshot-check.log`.
- A shared `.git/index.lock` delayed staging. It subsequently cleared outside this task; the lock was left untouched. Only the six owned notification files are included in this refactor, and all unrelated edits remain in place.

Native push delivery is outside these deterministic server checks. Evidence logs and the comparison scripts are under `/private/tmp/machination-notification-*`; a reviewable patch is saved as `/private/tmp/machination-notification-quality.patch`.
