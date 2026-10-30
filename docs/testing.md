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

The suite uses Node's test runner, TypeScript through `tsx`, and the real simulation. `npm test` recursively discovers `.test.ts`, `.test.tsx`, `.test.js`, `.test.cjs`, and `.test.mjs` files under `src`, `server`, `plugins`, and `scripts`. Hidden directories, dependencies, and generated output outside those roots are excluded. `scripts/build-server.test.mjs` runs separately through `npm run test:server-build` because it needs a freshly built production bundle. An empty default suite fails.

Four test files run concurrently, with process isolation between files. Tests within each file run sequentially by default, which protects tests that replace clocks or native adapters. Node's default test timeout is two minutes. A separate ten-minute deadline kills the test process group on macOS and Linux, including synchronous hangs that Node's test timeout can't interrupt. Runner tests verify discovery, failure diagnostics, empty-suite rejection, and synchronous-hang termination using temporary projects.

For focused checks:

```sh
# Run a single file.
node --import tsx --test src/game/configuration-invariants.test.ts

# Filter the discovered suite; use the equals form for runner options.
npm test -- --test-name-pattern='catch-up'

# Override the suite deadline in milliseconds when diagnosing a slow run.
npm test -- --suite-timeout=900000
```

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

## Device acceptance

Node component tests don't establish native/browser layout, touch gestures, keyboard focus, audio playback, platform permissions, or sign-in redirects. Before distributing a playtest build, exercise those on the target runtime using [native build checks](native-builds.md) and [account setup](accounts.md). Platform exports establish compilation and asset resolution; they don't replace those interaction checks.

## Screenshot comparisons

`npm run test:visual` runs the production web app in Expo against an isolated
browser context. A saved operation built by the real engine uses seed 314159
and a fixed epoch, so global random calls and real elapsed time cannot change
the chart. Reduced motion is enabled, the browser clock is fixed, and external
requests are blocked. Desktop and phone viewports cover the title actions and
selected-site chart. These web checks do not establish native iOS/Android gestures.

Run on the pinned Node version. Missing baselines fail; capture is pending an
unrestricted browser run. For an intentional change, run
`npm run test:visual:update`, review the expected/actual/diff images, and commit
the references beside `visual-tests/game.spec.ts`. Use the same OS, lockfile
Chromium, and fonts for recording and comparison. Reports and traces are in
`playwright-report` and `test-results`. Ordinary comparisons never record images.
