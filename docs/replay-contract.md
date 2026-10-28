# Private replay contract

Foundation for issue #18. This module does not complete observed-history UI, server routing, local storage, or a persistence format.

## API

`createArchive(baseline, { rivals: false })` captures an independent private copy of a trusted, complete `Game`. Its hour is the earliest available history. An imported old game starts at its saved hour; earlier state cannot be recovered or invented. The default rival mode is false. Set true only for solo games whose rival actions come from `advance`.

`applyCommand(archive, command, { rivals, knownThrough })` reconstructs the current live frontier, executes the canonical command, and returns `{ archive, game }`. Replace both values together only after success. The original archive remains valid. A rejected action throws and produces no entry or state change. There is no API to append an already-applied command: route live actions through this function so validation, recording, and execution cannot diverge. Submission is always at `knownThrough`, never a user-selected inspection hour. Future launches use the schedule command.

`replayTo(archive, targetHour, { rivals, knownThrough })` returns a fresh internal `Game`. Target and frontier must be finite; target cannot precede the baseline or exceed the frontier. The frontier cannot precede a recorded submission. `knownThrough` is a trusted caller assertion, not authorization obtained from the archive: the owner must maintain a monotonic live clock, including during periods without commands. Never accept a client's claimed frontier. The engine stops at victory/draw; seeking beyond that point returns its terminal game hour, and submitting beyond it is rejected.

Commands at the target hour are included, in exact submission order. Array position is the tie breaker; do not sort by actor, command kind, or ID. Replay advances to each submission before executing it, then advances to the target. Engine events, due scheduled actions, and automatic rivals at that hour run before the new player submission, matching live execution. Generated fleet/unit IDs, recruitment seeds, pools, offers, and partial economy clocks come from the baseline and deterministic engine. No tick snapshots are stored. Each append copies the command list; reconstruction costs grow with history length. This is a correctness foundation, with no checkpoint optimization yet.

The rival mode is fixed when creating an archive and must match every replay/submission. With automatic rivals enabled, only `you` player commands may be recorded. Automatic rival decisions and scheduled launch executions are derived engine effects, never extra command entries. Multiplayer uses rivals false and logs each authenticated player's canonical commands once. Do not log the same rival action while also enabling automatic rivals.

`GameCommand` and `executeCommand(game, command)` centralize dispatch, gifts, interception, hauler changes, scheduling/cancellation, hiring/promotion/release, mines, shields, funding, and legacy module installation. The executor clones its inputs and does not record history. Its inputs are trusted canonical data, not raw wire payloads: validate action shape, authenticate the owner, and translate opaque external fleet/unit aliases into internal IDs before calling. Interception enforces engine contact checks. Hauler changes include launch edit/cancel, course changes, and gift mark/cancel.

The clone uses plain object/array recursion supported by Hermes, with no `structuredClone` or dependencies. Engine state and commands must remain acyclic plain data. Optional undefined fields and numeric values are preserved. Dates, maps, sets, class instances, and cycles are outside this contract.

## Observation and integration

Archives are opaque, immutable handles backed by private module storage. They contain hidden baseline state and all factions' private commands. They must never be returned to clients, placed in public game views, logged in public diagnostics, or persisted to client-accessible multiplayer storage. Serializing a handle yields `{}`; it is not a saved archive. Returned `Game` values are also private and need redaction.

1. Establish one authoritative archive per operation and its fixed rival mode. For existing games, use the current complete saved game as the explicit baseline. Keep the old live game if migration fails; do not fabricate past commands.
2. Route server/local actions through `applyCommand`. Preserve the existing request validation and faction authorization, then resolve fleet/unit IDs to canonical internal IDs. Serialize submissions per operation so two concurrent requests cannot overwrite each other's archive. Commit the returned archive and live game atomically with the existing request receipt.
3. Keep polling and wall-clock advancement outside the log. Use the same rival policy for live advancement and replay; test equivalence before replacing existing entry points. The module reconstructs state itself on submission rather than trusting a supplied mutable live game.
4. For historical requests, clamp or reject against the server's known live frontier and archive baseline. Reconstruct with `replayTo`, then call existing `observe(historicalGame, authenticatedFaction, identifyFleet, identifyUnit)`. Use that historical game's coverage, units, events, and recruitment. Never redact an old game using current sonar or merge current knowledge into past observations. Keep alias mappings private and scoped through the existing server identity boundary.
5. Give the UI a redacted historical view and explicit available bounds. Keep forecast behavior separate. The historical view must not replace the live command clock or turn inspection into backdated submissions.

Request receipts still own retry idempotency. Repeating an accepted command through `applyCommand` is a new submission and can execute twice. Preserve receipt lookup and response reuse before applying a retry, including across restart. Schedule IDs only deduplicate schedules, not all commands. Do not publish intermediate state if persistence or receipt writes fail.

## Persistence validation requirements

No archive import/export or storage adapter is supplied in this foundation. Before shipping durable replay, define a private versioned envelope containing a complete baseline, fixed rival policy, ordered `{ hour, command }` entries, and an authoritative live frontier. Save it transactionally with the live state and request receipts. Do not attempt to JSON-serialize the handle.

A future trusted loader must validate the baseline through the existing save validation/migration boundary, validate the envelope and engine/replay version, and reject unsupported future versions. Validate finite nonnegative hours, baseline/frontier bounds, nondecreasing entry hours, preserved equal-hour order, command discriminants and every field, faction values, IDs, integer quantities, payload sizes, and rival policy. Replay each action to validate semantic success, including contact and ownership; never silently skip invalid entries. Enforce bounded archive size and reconstruction work. Verify the reconstructed frontier against the stored live state, accounting explicitly for terminal games and migrations. A valid TypeScript type assertion is not runtime validation.

Preserve recruitment seeds, next IDs, and all timing fields exactly; never regenerate them from current time. Pin or migrate deterministic engine semantics when rules change, with old fixtures that reproduce identical historical results. Define transaction recovery, corruption handling, retention, and private access before enabling restart support. The current engine version fields alone do not version every future rule change.

Resignation and inactivity are future integration needs. They currently have no canonical replay commands. Any external state changes for those features, administration, or other future rules must be modeled and validated before replay can claim complete history for them. Do not add unlogged mutations to a replay-backed live game.
