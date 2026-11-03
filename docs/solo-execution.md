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
