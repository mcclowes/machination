# Solo responsiveness baseline

Measured November 2, 2026 for [#198](https://github.com/mcclowes/machination/issues/198). The optimization is tracked in [#200](https://github.com/mcclowes/machination/issues/200).

## Scope

These measurements use all 87 runtime game files frozen from `0b96c97`, verified against that commit. Runtime: Node 24.14.1, Darwin arm64, Apple M5. Each process starts a seeded game at hour zero, with no player commands. The default scenario has three players, King’s Pulse, stationary bases, and gravity. The larger scenario has ten players, mining, stationary bases, and gravity. Both use seed 0 and mechanics revision 19.

Solo catch-up calls `localLifecycle(...).advance`; history uses `replayTo`; observed forecasts use `observe` followed by `forecastObservation`. These are the engine paths called synchronously by the app. Creation, catch-up, observation, six-hour forecast, and history reconstruction are timed separately. Completed benchmark cases check input immutability and exact history/catch-up parity.

Concurrent multiplayer/bot work later changed four live engine files. Those uncommitted changes are preserved and excluded from this frozen baseline. Revalidate the current source before implementing the fix.

## Measurements

Elapsed milliseconds, rounded to the nearest millisecond. These are individual observations on a contended machine, not medians, percentiles, device budgets, or rendering measurements. Module loading is excluded; creation is a separate column.

| Scenario | Catch-up horizon | Creation | Catch-up | Observed forecast +6h | History |
| --- | ---: | ---: | ---: | ---: | ---: |
| Default three-player pulse | 6h | 17 | 129 | 6 | 115 |
| Default three-player pulse | 24h | 22 | 538 | 9 | 572 |
| Ten-player mining | 1h | 585 | 8 | 9 | 3 |
| Ten-player mining | 6h | 705 | 26,874 | 12 | 26,304 |
| Ten-player mining, no-rival engine control | 24h | 608 | 59 | 10 | 51 |

The ten-player, rival-enabled 24-hour process reaches its 60-second deadline during catch-up. It produces no completed state or history result. All nine completed benchmark cases, including two no-rival controls, pass their immutability and history-parity assertions.

A separate profiled six-hour advance reproduces the same result in 25.52 seconds elapsed and 25.89 seconds CPU. The documented isolated-commit reproduction also completes, in 33.66 seconds elapsed and 27.88 seconds CPU. Both return the same complete state. Its complete state hash is `333c90475d5a0071fbfb7567077bb55344bdd347938477806bd956b41e383ac7`, with 100 rocks, 19 fleets, and no winner or draw.

## Attribution and next action

82.5% of weighted profile time has `predictSpecialistDeaths` on the stack, through `advance → refreshForesight → predictSpecialistDeaths → advance`. Rival decision ancestry accounts for 11.7%; the actual rival forecast callbacks account for 11.0%. These are inclusive stack measurements; they overlap with simulation work. Gravity and cloning have small self costs in this profile.

[Foresight prediction](../src/game/temporal-intelligence.ts) runs a committed 24-hour simulation. The normal simulation refreshes it at natural boundaries, including curved-course vertices. Repeated prediction is the first optimization target; the profile does not support starting with gravity math or serialization.

A diagnostic `temporalForecast: true` control retains rival decisions while skipping warning refresh. It returns the identical six-hour state hash using 7.51 seconds CPU. Its elapsed time is worse, 51.78 seconds, under host contention. This isolates expensive work without establishing a latency improvement. It is not a production workaround: threatened games still need correct warnings.

Fix #200 must preserve warning horizon, cadence, events, audiences, recorded rules, AI decisions, and partition/replay/save parity. Browser/native input latency, physical-device performance, memory, and battery acceptance remain open. The synchronous call path makes this a responsiveness risk; the Node observations do not measure an actual phone stall.

## Reproduce the slow path

Run from the repository root after `nvm use`. This reads the baseline commit into a disposable snapshot, keeps the shared checkout unchanged, and uses installed dependencies. The complete Node process has a 60-second deadline. The default target is six hours; set `MACHINATION_BENCH_HOURS=1` for a quick command smoke check.

```sh
nvm use
python3 - <<'PY'
from pathlib import Path
from tempfile import TemporaryDirectory
import os, signal, subprocess

root = Path.cwd().resolve()
with TemporaryDirectory(prefix='machination-solo-baseline-') as temporary:
    snapshot = Path(temporary)
    with (snapshot / 'source.tar').open('wb') as archive:
        subprocess.run(['git', 'archive', '0b96c97', 'src/game'],
                       cwd=root, stdout=archive, check=True)
    subprocess.run(['tar', '-xf', str(snapshot / 'source.tar'), '-C', str(snapshot)], check=True)
    (snapshot / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
    code = r'''
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {createConfiguredGame} = require('./src/game/world.ts');
const {advance} = require('./src/game/simulation.ts');
assert.equal(process.version, 'v24.14.1');
const target = Number(process.env.MACHINATION_BENCH_HOURS ?? 6);
assert.ok([1, 6].includes(target));
const game = createConfiguredGame({playerCount:10, mode:'mining', driftingBases:false, gravity:true}, 0, 0);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inputHash = hash(game), start = performance.now(), cpu = process.cpuUsage();
const result = advance(game, target, {rivals:true});
const used = process.cpuUsage(cpu);
assert.equal(hash(game), inputHash);
console.log(JSON.stringify({source:'0b96c97', node:process.version, target,
  wallMs:performance.now()-start, cpuMs:(used.user+used.system)/1000,
  inputHash, resultHash:hash(result), hour:result.hour, fleets:result.fleets.length}));
'''
    child = subprocess.Popen(['node', '--import', 'tsx', '-e', code],
                             cwd=snapshot, start_new_session=True)
    try:
        status = child.wait(timeout=60)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        raise SystemExit('60-second process deadline reached; measurement incomplete.')
    raise SystemExit(status)
PY
```

Raw evidence is retained under `.data/acceptance/issue-198/`: frozen source and manifest, `runs.json`, `extended-runs.json`, phase logs, `ten-mining-six.cpuprofile`, `profile-summary.json`, and `measurement-summary.json`. Initial probes are archived as `probe-initial.ts`; extended probes record their script hash. A timed-out process is retained as an incomplete measurement, not a passing case. No gameplay code changes are made by this investigation.

## Rolling prediction feasibility

Follow-up probes for #200 compare a fresh committed prediction with continuation of the previous prediction endpoint, using the same frozen source. Ten-player mining at hour 3 matches complete state at hours 3.137, 4, and 5.999 plus the 24-hour horizon. Seven additional comparisons in a fixed two-player chart match complete state with a queued assassin transfer, including points just before, at, and after the threatened specialist enters the horizon. These ten matching examples support investigating reuse; they do not prove a cache is correct for every mechanic.

The threat probe exposes two requirements beyond endpoint equality:

- At hour 24.137, a transfer queued for hour 25 produces a warning naming the queued transfer. At hour 25, the same predicted death names an enemy hauler. Reusing the warning text would be wrong even when the death time is unchanged. Derive its source from the current committed state and the responsible encounter.
- A transfer queued for hour 49 becomes a warning only when its death enters the 24-hour window. The probe checks horizon entry at the recorded binary64 values and 1e-8 hours to either side. Extending a cached forecast must inspect the new interval and preserve exact endpoint inclusion.

A prospective rolling predictor needs bounded, per-advance ownership; exact validation that the current state still follows its committed trajectory; invalidation after divergent orders or specialist changes; and current-state warning derivation. It must retain the original fresh-prediction fallback. No cache is implemented or shipped by these probes, and no speedup is established. Raw scripts and outputs are under `.data/acceptance/issue-200/` (`rolling-probe` and `threat-probe`).

## Combined candidate

The candidate now owns one rolling death forecast per `advance` call. It validates the current committed trajectory exactly before reuse, extends its horizon, and starts fresh after divergence. It derives warning sources from the current state and keeps the original warning cadence, 24-hour horizon, and recorded rules. No cache is stored in a saved game or shared between operations.

A matched control preserves the concurrent bot changes and removes only the forecast optimization. Under the full-gate load, its six-hour advance takes 81.39 seconds elapsed / 41.35 seconds CPU, versus 10.40 / 8.17 for the rolling candidate. Both return the original complete state hash above. Those are individual contended-host measurements, not device latency budgets.

The subsequent export work also makes the forecast's private snapshot copies cheaper. Two cold-process advances of the frozen combined candidate take 2.01 and 2.23 seconds elapsed, using 2.75 and 2.94 seconds CPU. Both preserve the original input and complete state hashes. These later measurements have different host load from the control; do not turn them into a matched speedup percentage. Their 830-file source manifest SHA-256 is `36ccb661a4cdc93ba93bf3b2af6288386cec9e983316dbcabddecdf9ffcf55e1`.

Four forecast regressions cover warning-source changes on launch, exact horizon entry, cancellation/specialist divergence, and the complete ten-player six-hour result. Fourteen additional comparisons against the original implementation include revisions 18/19, queued attacks, curved routes, and Dilation. The preceding integrated full gate passes its configured-operation matrix but fails an HTTP endgame export; [testing](testing.md#november-2-export-headroom-recurrence) records the separate fix and loaded reproduction. The next combined gate retains a second natural-ending export timeout; both retained cases subsequently pass the real client under configuration load after further allocation reductions. The final integrated full gate passes 1,755 behavior and 20 packaged-server tests with zero failures or skips, including the unchanged configuration matrix and ordinary HTTP natural ending/restart/export case. PostgreSQL plaintext/TLS fixtures are stopped afterward. Native input latency and physical-device performance remain unverified.

## Native calibration

[Follow-up #203](https://github.com/mcclowes/machination/issues/203) measures the actual solo advance handler and forecast call in an instrumented simulator QA package based on `c2f8290`. All 194 files under `src/game`, including tests, are byte-identical to that commit; staged bot work is excluded. The private bundle fixes the map seed at zero and records phase timings and complete inputs/results. Normal automatic time, finite solo reserves, rival decisions, and player controls remain. The app reuses the verified `6aab7e3` native executable; this is a new Hermes bundle, not a new native compilation.

One default three-player pulse calibration on iPhone 18 Pro / iOS 27.0 advances from hour `0.008350555555555556` to `6.008350555555555`. Hermes execution takes 220.91 ms. The first and second JavaScript animation-frame callbacks arrive at 261.88 and 280.26 ms from the same start. Serializing the diagnostic record takes 0.66 ms, and writing it takes 5.65 ms, both after the second callback. XCTest's tap returns at 519.48 ms and observes the updated live clock at 1,600.24 ms. Frame callbacks don't prove native paint completion; XCTest timings include automation and idle/polling overhead. These are individual observations on a contended simulator host, not physical-device budgets or latency percentiles.

Re-running the captured input through the frozen engine on Node 24.14.1 preserves the input and matches the complete serialized native result exactly, without numeric tolerances. Both result hashes are `73528779c83caf6b0abc531758efd4408c59bcb58a2e11b197e41773fed26d1a`. The QA Hermes 96 bundle is 5,074,148 bytes, SHA-256 `8024087de74cbc094ffae08154265fdf2c7b6d14c58a281efa055eb694be44f1`; exact recompilation, all 62 assets, and strict ad-hoc signing pass. Evidence is retained under `.data/acceptance/native-solo-responsiveness/runtime-v2/`: `source-manifest.json`, `source-audit.json`, `artifact.json`, and `source/.data/native-replay-acceptance/run-B6k8se/measurements/partial-validation.json` beside the retained XCTest results. The corrected test driver has separate provenance under `driver-v2/` in the parent directory; it uses the same app bundle.

The combined default/ten-player mining and forecast flow is not accepted yet. The latest driver reaches the real ten-player mining advance after completing the default advance, forecast, and return to live. Advancing from hour `0.0026247222222222223` to `6.002624722222222` takes 19,852.28 ms inside the Hermes simulation call. The first and second JavaScript frame callbacks arrive at 19,946.12 and 20,003.47 ms. The unchanged ten-second live-clock readiness assertion fails before the engine finishes. The test command later reaches its original 360-second deadline; its raw result bundle is unfinalized, so no exported XCTest result summary is claimed. The 240-second build deadline also remains unchanged.

[Issue #204](https://github.com/mcclowes/machination/issues/204) tracks this reproduced stall. This input includes normal rivals, finite solo reserves, gravity, and mechanics revision 19. Replaying the complete six-hour captured input on Node preserves the input and matches the native serialized result hash `7843c07eb42bfb58d952bd553dfde5d3b6a4f41799edf8ca3c943f4aa27047e6`. That call finishes, but its profiling process reaches the separate 60-second diagnostic deadline during shutdown; it is not a passing process or a usable CPU profile.

A bounded four-hour prefix subsequently completes and produces a CPU profile. Its 1,112 samples place substantial work in committed death prediction and rival attack forecasts. Sample time deltas include host scheduling delays, so they are not CPU percentages. A separate instrumented prefix records 157 simulation calls, 1,041 event steps, and 36 death forecasts, with 35 successful trajectory reuses and one initial reset. Its complete result matches the profiled prefix and leaves the input unchanged. These diagnostic prefixes do not replace the six-hour native acceptance case. The exact capture, profiles, counters, and process outcomes are retained under `.data/acceptance/issue-204/`; the failed native flow is under `driver-v4/.data/native-replay-acceptance/run-03bj4X/` in the native evidence directory. No ten-player forecast result, complete native responsiveness gate, or physical-device result is claimed.

## Specialist queries within each simulation phase

The November 3 candidate passes the original two-scenario native flow: one case, zero failures or skips, a 155.41-second test build, and a 321.74-second UI command. The original 240-second build, 360-second UI command, ten-second live-clock readiness, and six-gesture reveal limits remain. Both scenarios advance six hours, inspect an owned site, forecast six hours, and return to live through visible controls. The public runner now exposes this case as `--flow solo-responsiveness`; [native acceptance](../native-tests/README.md) documents its scope.

The candidate builds fresh station manifests within each specialist phase, rebuilds them after assimilation before Envoy release, and reuses Admiral counts and Dilation radii within fleet refresh. It preserves normal rivals, finite reserves, event cadence, warning horizons, and mechanics revision 19. No index is saved or shared between operations. Eighty-one focused timing, temporal, capture/release, and trace checks pass, including new guards for an assimilated Envoy acting immediately and a preparing Dilation field disappearing when launch completes.

| Scenario and phase | Hermes call | First JS frame callback | Second JS frame callback | XCTest clock observed |
| --- | ---: | ---: | ---: | ---: |
| Three-player pulse, advance | 165.14 ms | 202.64 ms | 232.31 ms | 1,610.56 ms |
| Three-player pulse, forecast | 7.14 ms | 42.06 ms | 66.19 ms | 1,633.03 ms |
| Ten-player mining, advance | 7,751.74 ms | 7,828.40 ms | 7,880.09 ms | 9,799.11 ms |
| Ten-player mining, forecast | 12.61 ms | 75.61 ms | 98.10 ms | 1,851.60 ms |

These are individual observations on a contended simulator host, not matched speedup percentages, native paint measurements, physical-device budgets, or latency percentiles. The ten-player advance starts at hour `0.00023888888888888888` and ends at `6.000238888888889`; its epoch and initial automatic-clock interval differ from the earlier failed run. An aggregate sample during artifact preparation records ten CPU cores, 0% idle CPU, and a one-minute load average of 77.61. The original captured six-hour input separately retains its complete `7843c07e…` result and unchanged input under the candidate.

All four native results match the frozen candidate on Node exactly, without numeric tolerances or input mutation. The first verifier incorrectly required a private seed in public forecast observations and rejected the run after completing those result comparisons. Its replacement requires seed redaction and reconstructs each complete forecast input as the observation of its preceding seed-zero authoritative state advanced to the recorded time. Both input reconstructions and all original result comparisons pass. The ten-player advance result hash is `030ef2d0c68de68ac5b31ac897ebb7043e2510324899324c184fdfee3406ada0`.

The QA Hermes 96 bundle is 5,074,770 bytes, SHA-256 `77b3736a682c994588aff2b165606a7bcc6e2f66f9d82a19c8dea7d79652cb2f`. Exact recompilation, all 62 assets, unchanged native-input checks, and strict ad-hoc signing pass. It reuses the same verified `6aab7e3` native executable. The 833-file source manifest starts from the earlier QA source and changes four engine helpers plus the named regression tests; separately staged bot work is excluded. The integrated full-gate snapshot includes that bot work. Two Metro attempts expire at the original 240-second bound and are rejected, including one that returns zero despite expiry. A subsequent incremental build completes in 174.88 seconds using the retained transform cache, the same source, compiler, and two workers. This establishes no cold-build performance result.

Evidence is retained under `.data/acceptance/native-solo-responsiveness/runtime-v3/` (`source-manifest.json`, `artifact-incremental.json`, and `validation-v2-result.json`) and `driver-v5/.data/native-replay-acceptance/run-C1CW5b/` (`acceptance.json`, command timings, four captures, `validated-summary.json`, and exported screenshots). The public UI case has identical navigation and assertions; its two diagnostic scenario labels omit the private seed claim. Four original fixtures remain unchanged, picker cache copies are removed, and the owned simulator is deleted and verified absent.

The integrated full gate expires at its existing wrapper limit. Its behavior report contains 555 passes, two failures, and 140 cancellations; packaged-server checks do not run. The reported problems include harness startup/deadline failures and a ten-seat HTTP endgame timeout. The endgame worker still holds a listening socket after its case times out; its synthetic state and eventual abort evidence are retained for diagnosis. An initial private harness setup candidate fails its broader check and remains unapplied. A subsequent test-only fix keeps every registration, seed tuple, assertion, and deadline while avoiding repeated loader startup in the registration fixture; all five repository harness checks and formatting pass. That separate unit is committed as `8e46629`. The complete gate has not been rerun or accepted. Both disposable PostgreSQL fixtures are stopped and the original test process group is verified absent. No game-behavior commit is claimed. JavaScript still blocks for 7.75 seconds despite passing this coarse native ceiling. [Follow-up #205](https://github.com/mcclowes/machination/issues/205) covers interactive execution, safe cancellation, and complete-state publication while retaining the original acceptance scope. Physical-device, memory, and battery acceptance remain separate.
