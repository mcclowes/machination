# Lifecycle and schedule quality review

Reviewed October 30, 2026, for [#51](https://github.com/mcclowes/machination/issues/51), using improve-code, separate-responsibilities, and flatten-branching. This supplements [the earlier audit](code-quality-audit.md).

## Scope and decisions

Revisited application composition, local operation policy, online operation workflows, server command orchestration, HTTP dispatch, queued-order decoding, simulation, pulse mechanics, notification preferences, and replay validation. The review targets responsibilities and repeated decisions; it doesn't certify every source line or impose file-size limits.

Existing map and dialogue edits, and concurrent branding, location-name, recruitment, pulse-geometry, time-wheel, and website work, belong to their respective tasks. Only the lifecycle policy, schedule payload owner, their tests, and this review are part of this change.

## Resolve operation mode once

`src/game/local-lifecycle.ts` previously consulted the training-mode condition eight times, across assessment, initialization, loading, saving, advancement, and submission. It now chooses solo or practice policy once when constructing the lifecycle.

- Solo owns restoration, creation when no saved operation exists, persistence, wall-clock advancement, and rivals.
- Practice owns detached attempts, explicit advancement, deadline limits, outcome detection, and refusal of further commands after an outcome. It never calls solo persistence.
- Both policies use the same command submission and archive-capacity check. No command or replay rule is duplicated.

The mode decision falls from eight consultations to one. Mode-dependent ternaries fall from four to zero. Practice's remaining clock and assessment guards describe its own behavior and remain local. The common lifecycle contract stays in the same module; separate files would add navigation without a new responsibility boundary.

## Give queued payloads their own owner

`server/service.ts` mixed strict payload decoding and canonical copying with authorization, settlement, receipts, and replay execution. `server/schedule-payload.ts` now owns decoding new queued orders and queued launch-manifest edits. It accepts unknown input and returns detached, validated commands, with no database, clock, credentials, or service callbacks.

The service still owns transaction boundaries, authorization, revision checks, alias resolution, receipt handling, execution, and returned observations. Decoding remains before the transaction and before seat authorization, as it was previously. Public service signatures, failure identity, error details, and validation order are preserved.

Action canonicalization now selects the action type once in a switch instead of up to three comparisons. Hauler canonicalization uses one action switch instead of a two-level nested ternary. Omitted manifests, explicit empty manifests, optional flags, and property ordering retain their existing canonical JSON, so retry receipts remain compatible. These are local decisions within the payload owner, without introducing dispatch registries or a generic command framework.

## Boundaries retained

- Application screens keep their composition, selection, and rendering together. A presentation extraction requiring dozens of neighboring workflow values would leave neither half independently understandable. Local persistence and online authority remain distinct.
- Simulation and combat keep chronological transitions together. Economy, geometry, travel, observations, and specialist effects already have independent owners. Pulse commands, configuration, propagation, and saved-state validation also have established boundaries.
- Notification preferences retain their transaction-local owner. Delivery queues, leases, expiry, and retry invariants remain with the durable notification model.
- Save and replay validators retain their format-specific rules. Similar field checks don't establish an interchangeable format contract.
- Existing domain catalogs and timing constants stay with their owners. Capacity literals and similar-looking controls weren't abstracted without evidence that they represent the same policy.

## Verification

- Two lifecycle characterizations passed before the policy change: empty-save creation versus read failure, and practice deadline/failure freezing. Existing coverage also proves storage isolation, stopped wall-clock progression, first-outcome detection, immutable attempts, and retry behavior.
- Three schedule contract tests cover canonical property order for all supported action variants, detached manifests, omitted versus empty edits, malformed envelopes, injected fields, and shared failure identity.
- Direct comparison with the pre-extraction service at `8516296` matched 3,793 decoder outcomes, including canonical JSON and error class, status, code, and message.
- The focused lifecycle, training, real-component practice, schedule, edit, and future-fleet suites passed all 57 tests without failures or skips.
- TypeScript, server frontmatter validation, the web production export, and all three standalone server build/restart tests passed.
- Committed-source verification uses a temporary snapshot of `c676b1a`, without a worktree or copied dependencies. All 447 source, configuration, and asset files were checked against that commit's blob hashes. Its web export passed. Acceptance explicitly selects Node 24.14.1 because the build scheduler's default runtime is Node 26.
- The full Node 24 run completed 1,113 tests: 1,111 passed, two failed, and none were skipped. Map generation exceeded its ten-second budget under load, and an incoming-notification test reached its fixed settling limit before clearing the tap. Both passed when rerun serially without code changes; map generation took 3.4 seconds in isolation versus 19.2 seconds in the full run. These results are consistent with host contention and a timing-sensitive test, rather than an established refactor regression. No thresholds were relaxed. The isolated rerun also passed TypeScript and all three production server build/restart tests under Node 24.14.1.

Native device gestures and notification delivery weren't exercised. This refactor doesn't change rendered output, gesture handlers, notification delivery, persisted formats, or game rules. The snapshot establishes behavior for the committed refactors; it doesn't validate concurrent uncommitted work in the shared checkout. A single uninterrupted all-green full-suite run wasn't obtained on this loaded host. Results and the timing limitation are also recorded on #51.
