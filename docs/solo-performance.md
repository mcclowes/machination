# Solo responsiveness baseline

Measured November 2, 2026 for [#198](https://github.com/mcclowes/machination/issues/198). The next fix is [#200](https://github.com/mcclowes/machination/issues/200).

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
