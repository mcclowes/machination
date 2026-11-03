# Responsive solo execution

Opening a valid solo save can involve two long simulations: reconstructing its recorded history to validate the saved frontier, then advancing the time spent away. Both now run as resumable work rather than blocking JavaScript until the entire operation finishes. No save reset or mechanics revision change is required.

The rules engine exposes generator entry points alongside its synchronous APIs. Both consume the same implementation, including nested Foresight and rival forecasts, so servers retain synchronous advancement and recorded games retain their exact results. The client also uses resumable work for commands, clock advancement, historical inspection, and observed forecasts. Practice playback retains its existing small animation steps.

## Scheduling

The client runs approximately 16 milliseconds of work before yielding through a host timer. Checkpoints occur between simulation phases, arrivals, rival orders, and nested forecast work. An individual checkpoint can exceed the batch target; this is a cooperative budget, not a hard real-time guarantee.

The budget comes from an isolated Hermes/iOS simulator probe for [#205](https://github.com/mcclowes/machination/issues/205). Each of 64 synthetic 16-millisecond batches allowed a frame callback during the computation. They consumed 1,025 ms of work over 1,066 ms elapsed, with a maximum observed scheduling gap of 1.18 ms. Four-millisecond batches also allowed frames but stretched 257 ms of work over 1,067 ms. These are individual synthetic measurements, not device latency percentiles or proof of paint or touch delivery.

`setImmediate` and React Native scheduler tasks were rejected: both completed their synthetic workload without allowing any animation-frame callbacks. The probe sources, complete samples, separately identified QA bundles, and disposable-simulator cleanup records are retained privately under `.data/acceptance/issue-205/scheduler-*`.

## Ownership and cancellation

One execution owner serializes operation mutations. While it is busy, the last completed game remains visible and order-changing controls are unavailable. Chart navigation and exits remain available. Replacing an operation or leaving its screen cancels the old generation; its result cannot publish over a newer operation. Only complete game/archive pairs reach persistence.

Automatic clock notifications received during computation leave the elapsed-time anchor intact. The next available tick catches up from that anchor. Time spent restoring is included, and a failed advance does not consume elapsed time. Saves and retries record the simulation’s clock anchor, preserving computation time across a subsequent quit and reload. Forecasts and historical views have their own cancelable computation; changing the requested time or archive discards stale results. Forecasts also restart when the live game changes. Fixed historical requests remain valid across clock-only updates, so a long reconstruction can finish.

The original save is retained if restoration fails or is canceled. Existing save, replay, and recorded-mechanics validation remain in force.

## Verification

`src/game/cooperative.test.ts` checks immutable inputs, cancellation, the exact captured revision-19 ten-player native result while host timers run, and synchronous/cooperative parity under the current solo revision. `src/solo/execution.test.ts` covers atomic publication and superseded generations. `src/solo/useLocalOperation.test.ts` exercises replacement during restore, complete-only saving, retained elapsed time, and duplicate clock notifications through the actual hook.

`visual-tests/solo-loading.spec.ts` covers ten-player mining saves under both recorded revision 19 and current revision 20, with gravity, finite reserves, and normal rivals. Desktop and phone cases navigate Setup and exit while restoration is still busy, requiring byte-for-byte preservation of the canceled save. Completed restoration reconstructs history and catches up from hour three to six. It compares the entire persisted game, replay history, and wall-clock anchor against the synchronous restore result, then forecasts six more hours, inspects a controlled site, requires enabled future-transfer planning, and returns to live without changing the save. All eight browser cases pass on November 3, 2026, with the existing 60-second case and 50-second restoration limits. The four engine checks and seven execution/hook checks also pass. Screenshots are retained locally in `.fettle/shots/solo-restored-r{19,20}-{desktop,mobile}.png`.

Native interaction and physical-device verification must be reported separately from these engine and browser checks. The work changes execution scheduling, not total simulation complexity; a very old or large game can still take time to finish loading.

## Current local native candidate

The November 3 QA package freezes `2c084c7`. All engine files match that commit. Three client files add private diagnostics: new operations use seed zero and recorded revision 19, and manual advances and inspections record complete inputs/results and animation-frame opportunities. A separate helper writes those synthetic records. Normal rivals, warnings, finite reserves, clock behavior, and the original scenario sizes remain in place.

Artifact: `.data/acceptance/issue-205/native-current/Machination QA cooperative.app`, with Hermes bundle SHA-256 `35cec8059da303ae338537dc59f863128ed96e7ceeaf13fa1c2d7575e998cc66` (5,140,045 bytes). Exact Hermes 96 recompilation, source/header/footer hashes, all 62 unchanged assets, and deep/strict ad-hoc signing pass. Native inputs match the verified `6aab7e3` executable, which is reused unchanged; this is a new JavaScript package, not a new native compilation. Metro completes in 10.56 seconds using the retained transform cache, within the original 240-second bound. This is no cold-build performance claim.

The private driver retains the three-player pulse and ten-player mining flows, six-hour advance and forecast, site inspection, return to live, six-gesture reveal limit, 240-second test build, and 360-second UI command bound. It additionally requires a Chart touch to close Setup while the ten-player operation is still updating, with the previous live clock intact, followed by complete publication within ten seconds of the advance action. At packaging, that test and the full source gate remain queued in Turnstile; no native interaction or release pass is claimed. Sources, manifests, scripts, artifact checks, and logs are retained beside the package. No user save, provider setting, installed regular app, or distribution changes.
