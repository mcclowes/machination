# Tactical training

Issue #18 adds original assessed exercises using the same chart, manifest, hauler, specialist, and Time Machine controls as ordinary operations. The [official tutorial page](https://subterfuge-game.com/rulebook/Videos.html) teaches basic controls, specialists, and the Time Machine; the [official website](https://subterfuge-game.com/) also describes in-game single-player tactical puzzles. Exact original puzzle layouts, gating, and retry gestures haven't been verified. These scenarios teach Machination's corresponding rules without copying original level assets.

## Player contract

Practice is a separate entry beside solo and multiplayer. A scenario list shows objectives and completed exercises. Each attempt uses a deterministic, valid version-two game and private history with rival automation off. The player uses real gameplay controls, inspects forecasts/history, and commits orders through the same replay command path. A manual clock advances the actual scenario; forecast inspection alone cannot pass it. Visible objectives, optional hints, clear success/failure, retry, and next exercise provide the teaching loop.

Initial exercises cover a first launch and capture, shields plus defending drones, specialist-only transport while retaining the core, scheduling a transfer before future production, and intercepting an incoming raid. Success is assessed from actual game state and relevant submitted commands, rather than button clicks or a canned animation. Valid alternative solutions remain acceptable where they demonstrate the objective.

Practice never loads or saves the solo operation, reads or changes multiplayer credentials, submits HTTP commands, advances by wall time, or continues after an attempt finishes. Retrying recreates the same baseline and discards only that attempt. Completion marks use a separate validated storage key; storage errors don't become completed exercises. Leaving practice returns to the existing solo save or multiplayer connection through their normal lifecycle.

After submitting a launch or queued order, **Resolve orders** animates the actual clock until the first assessed outcome or the deadline. Preparation, travel, and arrivals play out on the chart at half a game hour per second, with the timeline following along. **Pause playback** stops at the current time so orders can be inspected or changed. It works from a future preview and returns to the actual chart with planning panels closed. Dialogue waits while playback runs. An unsuccessful plan reaches the deadline and offers a retry. Empty plans and historical views cannot resolve. Retrying or leaving cancels playback; a delayed animation frame cannot skip the action. The smaller clock steps remain available; jumping to an arrival still only previews it.

## Engine interface

`src/game/training.ts` owns scenario definitions, deterministic creation, and assessment. It exports `TRAINING_SCENARIOS`, `TrainingId`, `TrainingScenario`, `createTrainingAttempt(id): LocalOperation`, and `assessTrainingAttempt(id, operation): { status: 'active' | 'passed' | 'failed'; message: string }`.

Scenario fields are `id`, `title`, `instruction`, `objective`, `hints`, `deadline`, and `focus`. IDs are `first-launch`, `shield-combat`, `unit-transport`, `future-production`, and `interception`. Public site IDs include `home`, `works`, `relay`, and `rival-home`. Worlds retain valid configured-game site counts and current mechanics; scenarios don't patch combat or economy rules. Queued actions retain normal resource checks and preparation times. All attempts use `archive.rivals = false`.

The future-production objective must require a future transfer queued before the source's first production, then an actual capture by its deadline. Specialist transport requires the designated unit at its destination while the core remains safe. Interception requires the actual interception command and stopping the raid before it reaches the home site. Merely inspecting the answer in a forecast doesn't satisfy these objectives.

## Verification

Prove each scenario has at least one solution through public replay commands and ordinary advancement. Test wrong manifests, losing/tied combat, production timing, preparation, unit-only travel, interception, timeout/core loss, deterministic retry, mutation isolation, valid save/replay reconstruction, and identical large/split clock advancement. Integration must prove practice has no solo-save, session-storage, wall-clock, or network side effects and that historical views stay read-only. Completion persistence is separate from attempt state.

TypeScript, the complete suite, web export, and production server checks accompany integration. Rendered mouse, touch, keyboard, screen-reader, small-screen, and native acceptance remain separate requirements; pure engine tests don't prove UI usability.

## Implemented behavior and evidence

The five scenario baselines, actual solution traces, and command-aware assessment are implemented in `e9442ca`. The shared local lifecycle resolves solo versus practice storage and clocks once. Practice advances the ordinary engine with an optional stopping predicate at every settled event boundary, freezing at its first success or failure. Authoritative multiplayer and ordinary solo calls use unchanged default advancement. A regression proves one large step and quarter-hour steps stop at the same successful capture even when a later core loss was queued. Safe core relocation remains a valid capture solution; only the unit-transport objective requires the core to stay at home.

The app now opens an entry screen before mounting a live mode. Practice uses the normal operation component with its own lifecycle policy and retry key, preserving chart, manifest, preparation, scheduled-order, specialist, history, and forecast controls. The picker, objective/status, optional hints, manual clock, retry, next, and completion marks are player-facing. Save errors stay scoped to practice metadata. The field manual points new players to practice.

An actual React state/effect integration test (`17754c4`) drives cold entry, exercise selection, map/input/launch controls, future preview without completion, Now, manual capture, separate completion persistence, read-only history, retry reset, and retained picker marks. Native hosts and the online mount boundary are stubbed; real App, Practice, operation, chart, Time Machine, command, and engine components run. Storage, timer, AppState, network, and online-mount probes confirm that the exercised practice path leaves seeded solo and online state untouched. The renderer is pinned to the app's React version and is a deprecated testing dependency, not proof of real-device behavior.

Validation: 357 tests, TypeScript, web export, and both standalone production bundle checks pass. Chrome initially returned `cgWindowNotFound`, then became accessible while receiving concurrent user input; browser actions were stopped. No completed browser or physical-phone acceptance is claimed. Small-screen layout, native gestures, keyboard/screen-reader use, all five rendered solution traces, and save-error recovery remain manual acceptance gaps. Exact original puzzle layouts, progression, and gestures remain unverified. Shared replays and the rest of #18 remain open.
