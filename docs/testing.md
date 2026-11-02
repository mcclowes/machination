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

`npm run test:native-replay -- --app /path/to/simulator-QA.app` runs the real iOS picker and viewer in a fresh owned simulator. The [native acceptance guide](../native-tests/README.md) records prerequisites, fixture provenance, protected app identities, cleanup, and evidence, including iPad portrait/landscape commands and visible software-keyboard guards. Schema-1, schema-2, and packed schema-3 cases cover their distinct file paths and controls; cancellation and malformed imports must preserve the previous replay. This is a separate gate from the ordinary host suite and requires an explicitly prepared simulator QA app. Three process-runner regression tests run in the ordinary host suite without Xcode.

### Endgame failure evidence

The ordinary ten-seat HTTP/file acceptance in `server/shared-replay-endgame.test.ts` retains callback failures before cleaning up its temporary operation. It writes the exact saved `rooms.json` and `failure.json` beneath `.data/endgame-failures/case-*`, then rethrows the original exception. Metadata includes the error stack, client rejection status when available, elapsed time, Node/V8 executable identity, and state SHA-256. The directory is private (`0700`) and both files use `0600`; only its path is reported in test diagnostics. Captures contain private synthetic operation state and remain local and ignored by Git.

Successful checks produce no failure artifact. Capture or diagnostic errors preserve the original exception. Three focused checks verify cleanup survival, file privacy, the success path, and error identity; a deliberate private entrypoint fault verifies the normal wiring. Process termination and test-runner interruption can prevent capture, so missing evidence does not establish a pass.

[Endgame diagnosis #181](https://github.com/mcclowes/machination/issues/181) remains open. Sixteen fresh ordinary operations pass the unchanged acceptance assertions: fifteen isolated cases and one alongside three configuration workers. Their 32 client export calls take about 1.87–2.58 seconds locally; this is not a hosted capacity or latency budget. The three load workers are stopped after the endgame completes, and no configuration pass is claimed from that load experiment.

The subsequent full gate captures an actual `AbortError` on Node 24.14.1 before cleanup. The saved game is already finished at hour 402.5673841421317, with Prism winning and nine eliminations. The source state SHA-256 is `d7d0734dbe8864ba03c0ab60993bb5a564120d559c6dd27703972c40d9320f17`. At that diagnostic stage, remaining owned configuration workers are stopped to isolate the case, so that run has no full-gate pass.

The captured replay is valid and within existing limits: 1,154,571 bytes, 106,530 records, 159 groups, and 158 spans. Its public terminal cargo/rules and outcome match the observed game. Profiled generation takes about 10.74 seconds, versus 0.33 seconds encoding and 0.42 seconds decoding. A full trace carries 7,019 snapshot payloads, including 4,518 before the chosen eight-hour interval. The same saved case takes 14.67 seconds through the real HTTP client in isolation and aborts before response headers alongside three configuration workers. The client deadline remains 15 seconds. This pre-fix baseline establishes insufficient export headroom for that valid case.

Replay tracing now accepts an optional inclusive capture window. Snapshot allocation skips points and spans wholly outside that window, while reconstruction retains every original advance endpoint and command. Spans touching either boundary remain included. The default full trace remains available. A regression compares every bounded record and the final game against the full trace, covering equal-hour commands, interior span cuts, zero-width windows, and invalid bounds.

On the captured case, the optimized artifact is byte-identical to the baseline SHA-256 below, including all 106,530 records. The real HTTP client completes alongside three configuration workers in two checks taking 14.91 and 2.77 seconds with its existing 15-second deadline, and the saved game/archive remain unchanged. A repeat in isolation takes 1.97 seconds. Local timing varies considerably, and the slower loaded result leaves little headroom; these checks do not establish hosted capacity. The load workers are intentionally stopped afterward; their cancellation is not a test pass. The full gate passes on Node 24.14.1: 1,716 behavior checks and 13 packaged-server checks, with 14 database checks skipped without fixtures. This includes the ordinary fresh ten-seat HTTP endgame and the bounded-trace regression.

HTTP reproduction uses a private copy with only the host credential hash rebound to a new synthetic token, because the saved store contains hashes rather than the original token. Original capture bytes are immutable; all game, archive, rule, outcome, and other source bytes remain unchanged. Its valid exported artifact SHA-256 is `80e06739fff381737c1107582c6f42538d0a7993994bad6519733c67a950f611`.

Private investigation records are under `.data/acceptance/issue-181/`; the captured failure is under `.data/endgame-failures/case-as2SMe/`. The deliberate sentinel is archived separately. The first four reproduction records have an invalid `elapsedMs` field from an observer-name collision; use their parent process wall times instead. Their export timings and assertions are unaffected, and the raw records are unchanged. Initial pure probes incorrectly compared public output with private cargo/rules; the corrected oracle uses the player's observation. The earlier uncaptured failure cannot be identified retrospectively.

At the diagnostic commit, the targeted normal entrypoint and all three retention checks pass; source quality passes. Its full behavior run exposes the captured failure above and is intentionally stopped afterward. The later optimized full gate passes as recorded above. All 22 original acceptance assertions remain unchanged. No gameplay rule, replay limit, client deadline, or acceptance assertion is altered to obtain a pass.

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
