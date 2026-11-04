# Testing

Run `npm run check` before committing behavior changes. It runs source quality (hooks/boundary lint, formatting, architecture, and TypeScript), behavior tests, and standalone server build/restart tests. GitHub Actions runs these as independent jobs alongside server containers, platform exports, the player guide, and browser smoke. Its final `check` requires every job to succeed. See [architecture and change boundaries](architecture.md) for ownership, formatter adoption, and main protection.

## Acceptance runtime

Use **Node 24.14.1 / V8 `13.6.233.17-node.44`** for the full acceptance suite. `.nvmrc` pins that Node release, and CI reads the same file and logs both versions. Run `nvm install` and `nvm use` from the repository root before installing dependencies or running checks. A source snapshot under `/tmp` can otherwise select a different system Node executable even when the original checkout uses the certified version. Confirm the active runtime with:

```sh
node -p 'JSON.stringify({node: process.versions.node, v8: process.versions.v8})'
```

The separate binary64 visibility diagnostics depend on the exact V8 profile declared in `src/replay/numeric-support.ts`. They fail with `unsupported-visibility-numeric` on uncertified runtimes, including the observed Node 26 runtime; this is an explicit refusal, not a skipped check. Don't weaken guards or assertions to make a different runtime pass. Updating the acceptance runtime requires validating the numerical assumptions against the proposed V8 implementation and rerunning the diagnostic cases before changing the pin.

This prerequisite applies to certified diagnostics. Gameplay and [player replay exports](shared-replays.md) use portable continuous geometry and don't require native Hermes or browsers to match the pinned Node/V8 version. The development pin doesn't narrow that contract.

## Behavior tests

The suite uses Node's test runner, TypeScript through `tsx`, and the real simulation. `npm test` recursively discovers `.test.ts`, `.test.tsx`, `.test.js`, `.test.cjs`, and `.test.mjs` files under `src`, `server`, `plugins`, `scripts`, and `native-tests`. Hidden directories, dependencies, and generated output outside those roots are excluded. `scripts/build-server.test.mjs` runs separately through `npm run test:server-build` because it needs a freshly built production bundle. An empty default suite fails.

Four test files run concurrently, with process isolation between files. Tests within each file run sequentially by default, which protects tests that replace clocks or native adapters. The configuration matrix uses twelve files under `src/game/configuration-invariants`, one for each player-count, victory-mode, and drifting-base combination. Each file retains both rival settings and all three seeds, preserving the original 24 tests and 72 scenarios while allowing the existing four-file pool to distribute their CPU work. The inventory regression runs the real wrappers and registration through default discovery with only the costly scenario body replaced, proving every original name and seeded tuple appears exactly once without running the matrix twice.

That registration-only fixture uses one Node process for all twelve wrappers and retains its fifteen-second deadline. The real game matrix keeps its normal file isolation. The synchronous-hang fixture uses a CommonJS CPU loop and retains its three-second deadline; the separate discovery fixture still exercises TypeScript and TSX. These checks preserve every original name, seeded tuple, failure diagnostic, and exit-status assertion while avoiding unrelated loader startup in the short deadline probes.

Node's default test timeout is two minutes. A separate deadline kills the test process group on macOS and Linux, including synchronous hangs that Node's test timeout can't interrupt. Plain `npm test` keeps its ten-minute default; `npm run check` and the CI behavior job use a bounded thirty-minute acceptance window. Two October 30 full runs took about 927 seconds each on the shared Mac, exceeding the shorter default while completing the unchanged configuration matrix. Partitioning changes no assertions, scenarios, simulation budgets, or numeric guards. Performance work remains [#52](https://github.com/mcclowes/machination/issues/52). Runner tests verify discovery, failure diagnostics, empty-suite rejection, and synchronous-hang termination using temporary projects.

For focused checks:

```sh
# Run a single file.
node --import tsx --test src/game/configuration-invariants/10-seat-mining-drifting.test.ts

# Filter the discovered suite; use the equals form for runner options.
npm test -- --test-name-pattern='catch-up'

# Override the suite deadline in milliseconds when diagnosing a slow run.
npm test -- --suite-timeout=900000
```


### Native replay files

`npm run test:native-replay -- --app /path/to/simulator-QA.app` runs the real iOS picker and viewer in a fresh owned simulator. Append `--content-size accessibility-extra-extra-extra-large` for the largest accessibility text category; the default is explicitly `large`, and both settings are read back before and after the cases. The [native acceptance guide](../native-tests/README.md) records prerequisites, fixture provenance, protected app identities, cleanup, and evidence, including iPad portrait/landscape commands and visible software-keyboard guards. Schema-1, schema-2, and packed schema-3 cases cover their distinct file paths and controls; cancellation and malformed imports must preserve the previous replay. This is a separate gate from the ordinary host suite and requires an explicitly prepared simulator QA app. Three process-runner regression tests run in the ordinary host suite without Xcode.

### Endgame failure evidence

The ordinary ten-seat HTTP/file acceptance in `server/shared-replay-endgame.test.ts` retains callback failures before cleaning up its temporary operation. It writes the exact saved `rooms.json` and `failure.json` beneath `.data/endgame-failures/case-*`, then rethrows the original exception. Metadata includes the error stack, client rejection status when available, elapsed time, Node/V8 executable identity, and state SHA-256. The directory is private (`0700`) and both files use `0600`; only its path is reported in test diagnostics. Captures contain private synthetic operation state and remain local and ignored by Git.

Its HTTP fixture owns every listener across restarts. Cancellation closes sockets immediately and prevents a later asynchronous continuation from opening another listener. Teardown waits for pending request handlers and failure capture before removing storage; unexpected handler failures remain test failures. Five focused regressions cover this lifetime contract. A November 3 phase probe still reaches the unchanged 120-second deadline during activity and pulse requests, before export, but retains its evidence and exits without the outer process deadline. This is a cleanup fix, not a passing endgame acceptance check; performance remains tracked in [#52](https://github.com/mcclowes/machination/issues/52).

Successful checks produce no failure artifact. Capture or diagnostic errors preserve the original exception. Three focused checks verify cleanup survival, file privacy, the success path, and error identity; a deliberate private entrypoint fault verifies the normal wiring. Process termination and test-runner interruption can prevent capture, so missing evidence does not establish a pass.

[Endgame diagnosis #181](https://github.com/mcclowes/machination/issues/181) records the preceding failure and fix. Sixteen fresh ordinary operations pass the unchanged acceptance assertions: fifteen isolated cases and one alongside three configuration workers. Their 32 client export calls take about 1.87–2.58 seconds locally; this is not a hosted capacity or latency budget. The three load workers are stopped after the endgame completes, and no configuration pass is claimed from that load experiment.

The subsequent full gate captures an actual `AbortError` on Node 24.14.1 before cleanup. The saved game is already finished at hour 402.5673841421317, with Prism winning and nine eliminations. The source state SHA-256 is `d7d0734dbe8864ba03c0ab60993bb5a564120d559c6dd27703972c40d9320f17`. At that diagnostic stage, remaining owned configuration workers are stopped to isolate the case, so that run has no full-gate pass.

The captured replay is valid and within existing limits: 1,154,571 bytes, 106,530 records, 159 groups, and 158 spans. Its public terminal cargo/rules and outcome match the observed game. Profiled generation takes about 10.74 seconds, versus 0.33 seconds encoding and 0.42 seconds decoding. A full trace carries 7,019 snapshot payloads, including 4,518 before the chosen eight-hour interval. The same saved case takes 14.67 seconds through the real HTTP client in isolation and aborts before response headers alongside three configuration workers. The client deadline remains 15 seconds. This pre-fix baseline establishes insufficient export headroom for that valid case.

Replay tracing now accepts an optional inclusive capture window. Snapshot allocation skips points and spans wholly outside that window, while reconstruction retains every original advance endpoint and command. Spans touching either boundary remain included. The default full trace remains available. A regression compares every bounded record and the final game against the full trace, covering equal-hour commands, interior span cuts, zero-width windows, and invalid bounds.

On the captured case, the optimized artifact is byte-identical to the baseline SHA-256 below, including all 106,530 records. The real HTTP client completes alongside three configuration workers in two checks taking 14.91 and 2.77 seconds with its existing 15-second deadline, and the saved game/archive remain unchanged. A repeat in isolation takes 1.97 seconds. Local timing varies considerably, and the slower loaded result leaves little headroom; these checks do not establish hosted capacity. The load workers are intentionally stopped afterward; their cancellation is not a test pass. The full gate passes on Node 24.14.1: 1,716 behavior checks and 13 packaged-server checks, with 14 database checks skipped without fixtures. This includes the ordinary fresh ten-seat HTTP endgame and the bounded-trace regression.

HTTP reproduction uses a private copy with only the host credential hash rebound to a new synthetic token, because the saved store contains hashes rather than the original token. Original capture bytes are immutable; all game, archive, rule, outcome, and other source bytes remain unchanged. Its valid exported artifact SHA-256 is `80e06739fff381737c1107582c6f42538d0a7993994bad6519733c67a950f611`.

Private investigation records are under `.data/acceptance/issue-181/`; the captured failure is under `.data/endgame-failures/case-as2SMe/`. The deliberate sentinel is archived separately. The first four reproduction records have an invalid `elapsedMs` field from an observer-name collision; use their parent process wall times instead. Their export timings and assertions are unaffected, and the raw records are unchanged. Initial pure probes incorrectly compared public output with private cargo/rules; the corrected oracle uses the player's observation. The earlier uncaptured failure cannot be identified retrospectively.

At the diagnostic commit, the targeted normal entrypoint and all three retention checks pass; source quality passes. Its full behavior run exposes the captured failure above and is intentionally stopped afterward. The later optimized full gate passes as recorded above. All 22 original acceptance assertions remain unchanged. No gameplay rule, replay limit, client deadline, or acceptance assertion is altered to obtain a pass.

### November 2 export-headroom recurrence

The integrated #200 candidate completes 1,741 of 1,742 behavior tests, with no skips, but its ordinary HTTP endgame export aborts at the existing client deadline. Packaged-server checks do not run after that failure. The new retained game ends naturally at hour 403.6021691300724, with Prism winning and nine eliminated seats. Its immutable source SHA-256 is `54dacfcde10951aaae35833de5bdb04f2ca1602437dda71d2671c79292a2f2a0`.

The final eight-hour packed replay is valid: 1,002,276 bytes, 92,313 records, 137 groups, and 136 spans. Its SHA-256 is `77a190053041e3bb5ec45f8e6d0c9a04375de6c4762c5859c56a10e296af6559`. Generation takes 29.21 seconds under configuration load. The operation has no Foresight units or hire commands, so its new death-prediction cache is unused. [Export #158](https://github.com/mcclowes/machination/issues/158) retains this recurrence.

The follow-up removes temporary snapshot-cloning allocations, skips projection of exact duplicate consecutive points, and combines validation and tracing into one reconstruction. The final canonical frontier check remains mandatory; recorder output is provisional until it succeeds. Recorder errors retain their identity. Small schema-1/schema-3 goldens retain all three equal-hour command states, warning changes, and delayed discoveries. Existing trace mutation and snapshot independence tests remain in place.

The exact retained case now passes through the real HTTP client alongside three verified active configuration workers: 9.91 seconds to response headers and 11.49 seconds total, with the original 15-second deadline and byte-identical artifact. The source game and archive remain unchanged. The load workers are terminated during cleanup; their cancellation is not a configuration pass. The fresh combined gate retains another natural-ending export timeout, at hour 403.63051575180714. Its source SHA-256 is `3b324839e3726ffea316d84ae6c25bfd42c801b8ce5db785d4cf3a77a885a124`; its valid replay SHA-256 is `9bc00fff0632942a678b5e858f134e6796ac55e5dcdd557d687b3bac70bf1892`. That failed run is stopped with both SQL fixtures cleaned up, preserving the capture and partial results. No full-gate pass is claimed. Subsequent allocation work hoists pure geometry helpers and replaces recursive comparator callbacks with direct loops, preserving their arithmetic and exact-value comparisons. All 46 focused geometry/numeric checks pass. Both retained endings then pass the actual client alongside three active configuration workers in about 2.38 seconds each, with their respective byte-identical artifacts and unchanged games/archives. The final full gate passes on Node 24.14.1: 1,755 behavior tests and 20 packaged-server tests, with zero failures, cancellations, or skips. It completes in 321.73 seconds with fresh PostgreSQL 17.11 plaintext and CA-verified TLS fixtures; both fixtures are stopped afterward. The original configuration matrix, assertions, and client deadlines remain unchanged. Evidence is under `.data/acceptance/issue-200/`, including immutable captures, profiles, comparison runs, loaded HTTP results, and all gate records.

### Message notifications

At `2d368b2`, an isolated committed-source snapshot passes `npm run check` on Node 24.14.1: 946 regular tests, TypeScript, and three production server bundle checks. The notification subset comprises 23 service/worker/transport tests and 34 client tests, including twelve real App/OnlineOperation/HTTP tap cases. The shared tree also passes 947 regular tests; that extra case belongs to concurrent map work and is excluded from this committed-source count. Logs are `/tmp/machination-notification-retries-final-check.log` and `/tmp/machination-notification-retries-check.log`.

Web, iOS, and Android exports pass from the same commit at `/tmp/machination-notifications-final-platform-export`. The fresh native compilation and installed QA bundle are recorded in [native builds](native-builds.md#message-notification-build-october-29). Provider fakes, host-rendered taps, exports, and simulator installation do not establish notification permission or real background/closed-app delivery.

### Ten-seat contested matches

The ordinary suite runs the three-seat contested scenarios. The extended profile runs the same contest, privacy, save, replay, advancement-partition, and victory assertions with ten independent observation-limited seats in both modes at seeds 7 and 8:

```sh
MACHINATION_TEN_SEAT_ACCEPTANCE=1 node scripts/test.mjs --test-name-pattern='^contested ' --test-timeout=1200000 --suite-timeout=1800000
```

Use the pinned acceptance runtime. This command runs four large scenarios. Other test bodies are skipped, though the runner still loads their files. It uses the existing runner's 30-minute process-group deadline as well as per-advance event budgets. That deadline is a total run budget and can stop a later case before its individual timeout. Node's per-test timers alone cannot interrupt synchronous simulation. Stage messages distinguish the match, canonical replay, partitioned reconstruction, save loading, and ending checks. A completed simulation summary is not a passing test until those later checks finish.

The controllers spread the original three-seat risk range across the ten seats. They protect visible Queens and begin mining after a military opening. They are bounded acceptance fixtures, not an original AI, a balance model, or a substitute for human diplomacy and current-original-client comparison.

Seats act in a fixed order; each sees earlier same-hour orders when its observation permits. This does not establish seat-order fairness. The ongoing outcome depends on these controllers and risk levels, not just the seed: repeating the three risk profiles changes which domination fixture reaches quota.

Both mining fixtures and domination seed 7 reach the configured quota. Domination seed 8 remains contested through hour 2160: multiple players survive, nobody reaches quota, and no winner or draw is invented at the fixture cutoff. Every round checks for missed victory conditions; the final 240 hours must still contain orders and combat or ownership turnover. That scenario retains the full long-history checks and compares another 100 hours of play with canonical replay. A fixture's cutoff is not a game-ending rule. If a changed controller or engine legitimately finishes this fixture, review and redeclare its expectation instead of suppressing victory.

## What the tests establish

| Boundary | Evidence |
| --- | --- |
| Simulation rules | Command validation, economy, combat, specialist effects, deterministic event timing, and completed match scenarios |
| Generated configurations | Two-, six-, and ten-seat operations in both victory modes, with drift and automatic rivals independently enabled or disabled, at three fixed seeds |
| Catch-up and history | The configuration matrix compares one 24-hour advance with irregular polling and save restoration around the opening-clock boundary, then reconstructs current and historical states from persisted replay data; frozen inputs detect mutation |
| Persistence and authority | Damaged saves, failed writes, retries, authentication, hidden information, restart recovery, and private commands through real local HTTP servers |
| UI integration | Real React components and hooks, with native adapters replaced in Node; practice, replay, and account flows exercise controls and lifecycle boundaries |
| Message notifications | Real service/HTTP audience and revision checks, durable worker transitions with a fake provider, and App → OnlineOperation → HTTP tap routing with only native I/O replaced; this does not establish device delivery |
| Production packaging | Standalone server boot without project dependencies, authenticated access, offline catch-up, shutdown draining, and restart persistence; container checks in CI |

Add regressions at the boundary where behavior can fail. Prefer observable results and real collaborators; replace platform I/O only when a Node test can't run it. Use fixed seeds and explicit clocks so failures can be reproduced. Keep tests beside the behavior, and keep slow packaging prerequisites explicit. A coverage percentage alone doesn't establish these guarantees.

Container builds include the same root TypeScript configuration as the host standalone build. Use `scripts/test-server-image.mjs` for the generic image and `scripts/test-railway-image.mjs` for Railway; their mount initialization, process ownership, and data paths intentionally differ. The [current AMD64 image checkpoint](railway.md#local-amd64-checkpoint-october-31) records exact artifacts, copied-backup restoration, and SQL/TLS checks inside both actual service containers under local emulation. The [preceding ARM64 checkpoint](railway.md#local-image-checkpoint-october-31) separately records the complete host packaging suite against extracted image bytes without rebuilding them.

## Postgres runtime

The server-packaging workflow supplies a disposable Postgres 17.11 service and sets `MACHINATION_TEST_DATABASE_URL` for both the real-driver test and standalone bundle checks. The bundle scenarios use isolated schemas and explicitly select the adapter's local plaintext mode. They cover accepted writes during shutdown, restart/retry, failed imports, listener failures, and a write held behind a real SQL lock until the shutdown deadline. The deadline case requires a failure exit, rollback of the interrupted write, preservation of prior state, and safe retry after restart.

The same CI job runs `npm run test:postgres-tls`, which requires Docker and OpenSSL and owns separate plaintext and TLS containers plus a short-lived CA. A guard verifies the TLS fixture rejects unencrypted sessions. Real-driver and packaged-service checks cover trusted certificates, unknown CA and hostname rejection, plaintext refusal, rollback, fencing, restored state/retries, damaged-row quarantine over TLS, and legacy recovery imports. To run the full gate with those fixtures locally, use `npm run test:postgres-tls -- --full`.

Without the fixture variables, local checks explicitly skip the SQL/TLS cases; the ordinary JSON/Clerk and configuration checks still run. Only use disposable databases: the separate driver test drops Machination tables, and lifecycle cases create and remove their own schemas. These loopback checks don't establish the selected hosted Supabase endpoint, cloud backup/restore, or native-device behavior. See [Postgres operations](postgres.md).

Recovery tests exercise exact file archives and permissions, failed archives and source replacement, duplicate identities, shared-metadata refusals, notification isolation, SQL rollback/fencing, missing version metadata, and import races. The connection-hook integration uses the actual HTTP API and GameService with stubbed native storage. It retains pending transmissions and recovery attempts through a 503, then retries the same identity after a controlled fixture restoration. It does not establish native keychain behavior or a production restore/merge. See [storage recovery](storage-recovery.md).

The standalone storage-requirement scenario imports a real legacy file, accepts a later SQL-only private message, and refuses missing/blank URLs and contradictory file selection without changing either store or writer ownership. An absent legacy path stays absent. Restoring the required Postgres configuration retains private access and deduplicates the original command. This checks the current bundle; it does not certify older rollback images or Railway's live variables.

## Device acceptance

Node component tests don't establish native/browser layout, touch gestures, keyboard focus, audio playback, platform permissions, or sign-in redirects. Before distributing a playtest build, exercise those on the target runtime using [native build checks](native-builds.md) and [account setup](accounts.md). Platform exports establish compilation and asset resolution; they don't replace those interaction checks.

### Short-layout interaction checks

Run `npm run test:visual -- visual-tests/landscape-operations.spec.ts` for local multiplayer checks across short phone, narrow portrait, and tablet viewports. Controls must fit fully inside both the viewport and every clipping ancestor, rather than merely exist in the page. The cases retain a private draft and unfinished time entry through resizing, verify exactly one private delivery with an excluded third seat, and submit a launch after rotating its manifest into landscape. Disposable local services and browser storage isolate these checks from production. Screenshots land in `.fettle/shots/`.

These are browser interactions with shared React Native styles. Browser viewport resizing doesn't prove native keyboard avoidance, orientation, Dynamic Type, or physical-device behavior.

### Solo camera restoration

Run `npm run test:visual -- visual-tests/solo-camera.spec.ts` to check a fixed seeded save against equal and different initial timestamps. Both cases must frame and inspect the restored core without pressing Focus your territory. The App-level `solo-camera-integration.test.ts` additionally covers same-epoch replacement, failed replacement, and preserving manual pan through commands, automatic ticks, and manual catch-up. Its native and presentation hosts are stubbed; the browser check supplies rendered framing evidence.

## Screenshot comparisons

Fixed-state checks use `visual-tests/wall-time.ts` when they need a frozen wall clock and real browser scheduling. It pins `Date.now()`, zero-argument `new Date()`, and callable `Date()` while retaining native performance, timers, and animation frames. Save restoration, screenshots, launch editing, and other fixed-state fixtures share this helper. The battle-marker case verifies the exact epoch before and after forecasting.

The November 4 forecast diagnosis keeps the same seed-42 two-player mining save, controls, perimeter/expiry assertions, and five-second deadline. Three Playwright-clock controls stall with no frame callbacks and overdue layout timers in the emulated queue; three Date-only controls finish in 141–170 ms with 8–9 frame callbacks. A separate profiled comparison changes the timing and isn't accepted as a performance baseline. The normal desktop/phone battle case then passes ten repetitions without increasing any timeout. Raw controls, profiles, and clock-state records remain under `.data/acceptance/aaa-browser-current/forecast-probe/`. This fixture repair changes neither game rules nor the cooperative execution budget.

Disruptor charging explicitly advances virtual timers. Its fixture loads with a running clock, pauses at the recorded epoch, and drives callbacks inside the existing five-second assertions. Two of three automatic-clock controls stall during charging; all three paused controls pass. The final desktop/phone fixture passes six repetitions, retaining the 45-minute jump, both material deductions, cancellation without refund, wave fading, and the original deadlines. Raw controls remain under `.data/acceptance/aaa-browser-current/disruptor-clock-probe/`.

`npm run test:visual` runs the production web app in Expo against an isolated
browser context. A saved operation built by the real engine uses seed 314159
and a fixed epoch, so global random calls and real elapsed time cannot change
the chart. Reduced motion is enabled, the browser clock is fixed, and external
requests are blocked. Desktop and phone viewports cover the title actions and
selected-site chart. These web checks do not establish native iOS/Android gestures.

Run on the pinned Node version. Six reviewed [macOS references](../visual-tests/game.spec.ts-snapshots/README.md)
cover the home screen, selected core, and six-hour forecast in desktop and phone contexts.
The fixture acknowledges the briefing and identifies the core through its accessible
name, which remains available when collision suppression omits the visible label.
Before capture, it requires the chart's projection SVG viewport to match the measured
chart bounds, including after opening time controls. Pixel stability alone can precede
delivery of the asynchronous resize notification.
Missing or changed baselines fail. Other operating systems need their own reviewed references.

For an intentional visual change, run `npm run test:visual:update -- visual-tests/game.spec.ts`,
review the expected/actual/diff images, update the reference provenance, and commit the
images beside `visual-tests/game.spec.ts`. Use the same OS, lockfile Chromium, and fonts
for recording and comparison. Reports and traces are in `playwright-report` and
`test-results`. Ordinary comparisons never record images. An isolated inverted-render
control verified rejection of a visual mismatch without changing the references.
