# Native replay acceptance

Run the real iOS document picker and replay viewer in a new, un-cloned simulator:

```sh
nvm use
npm run test:native-replay -- --app '/path/to/Machination QA current.app'
```

Requires macOS, Xcode, the iOS 27.0 simulator runtime, and a signed simulator QA app. The default device is iPhone 18 Pro in portrait. `--runtime` and `--device-type` select other installed targets; those targets need their own acceptance evidence. `--orientation portrait|landscape` selects the requested interface orientation. Every case verifies the app frame matches it before interacting; the iPhone app supports portrait, while iPad also supports landscape. The UI cases use English system labels. Use a QA build with sign-in and push identifiers disabled; this runner does not change configuration already compiled into the supplied app.

The solo responsiveness flow exercises both the default three-player pulse operation and a replacement ten-player mining operation:

```sh
npm run test:native-replay -- --app '/path/to/simulator-QA.app' --flow solo-responsiveness
```

It uses visible controls to advance six hours, requires the live clock to change within ten seconds, inspects an owned site, forecasts six hours, and returns to live before replacing the operation. The original six-gesture reveal limit, 240-second test build, and 360-second UI command bounds remain. It requires one passing case with no skips and supports portrait only. The seed comes from the supplied app; a private seed-zero QA bundle makes the captured #204 comparison reproducible. XCTest clock observation includes automation overhead and does not measure paint completion, physical-device latency, or frame percentiles. The private calibration adds engine/frame instrumentation and complete-state comparisons; this public flow verifies visible controls and readiness.

For the iPad mini orientation matrix, run both commands:

```sh
npm run test:native-replay -- --app '/path/to/simulator-QA.app' --device-type com.apple.CoreSimulator.SimDeviceType.iPad-mini-A17-Pro --orientation portrait
npm run test:native-replay -- --app '/path/to/simulator-QA.app' --device-type com.apple.CoreSimulator.SimDeviceType.iPad-mini-A17-Pro --orientation landscape
```

Append `--content-size accessibility-extra-extra-extra-large` to exercise the largest accessibility text category. The default is explicitly `large`. The runner sets the category on its own fresh simulator before installing the app, reads it back, and verifies it remains applied after the cases. Each run records the category in `acceptance.json`. This exercises the existing picker, transport, keyboard, and inspection flows at that category; it does not enable VoiceOver or certify all text, screens, or accessibility behavior.

The first-player flow exercises a fresh tactical practice attempt on the smaller iPhone target:

```sh
npm run test:native-replay -- --app '/path/to/simulator-QA.app' --flow first-player --device-type com.apple.CoreSimulator.SimDeviceType.iPhone-17e
```

This flow currently supports portrait only and accepts the same `--content-size` option. It scrolls to the briefing’s end with Continue visible, reveals and selects all six operation tabs, restores Chart, selects Foundry, requires the whole cargo field inside its scroll viewport with the software keypad open, enters six drones, plans a transfer to Quiet landing, prepares the six-drone launch, and verifies capture with two survivors and completion after app relaunch. Drawer gestures wait for stable geometry and follow the target frame across keyboard dismissal. Bounded reveal gestures bring offscreen exercise and launch actions into view; an already visible fixed launch footer needs no scrolling. Horizontal navigation drags use the visible viewport and require stable, hittable tabs with selected state and compact height. Only navigation bounds allow half a physical pixel for native coordinate rounding. Chart and Orders must remain above the open keypad. This flow requires one passing case with no skips; the default replay flow retains its three cases and unchanged deadlines. It proves scripted simulator interaction, not unaided human usability or physical-device behavior.

The secure-editor flow chooses Restore and checks two in-process round trips between multiplayer recovery entry and Solo cargo entry:

```sh
npm run test:native-replay -- --app '/path/to/simulator-QA.app' --flow secure-editors
```

It requires portrait and supports the same content-size option. Recovery code must remain a native SecureTextField before and after entering the synthetic `qa-sample`, with a masked accessibility value and no ordinary recovery TextField. The following fresh or resumed Solo cargo field must remain an ordinary TextField, reject a secure classification, and accept `2` through the visible numeric keyboard. Server URL and site roles are also checked. No recovery request, online connection, or real credential is submitted. One case must pass without skips; the default replay flow still selects exactly its three replay cases, and first-player retains its separate case. Build and UI deadlines are unchanged. This verifies selected simulator input transitions, not seat restoration, VoiceOver, or physical-device behavior.

The shared-header flow checks visible titles and the global controls:

```sh
npm run test:native-replay -- --app '/path/to/simulator-QA.app' --flow shared-header
```

It supports portrait and the same content-size option. Apple Vision reads only the screenshot crop inside the shared heading's native frame; the complete title must be visible in pixels, since its accessibility label can remain complete while the rendered text truncates. Multiplayer entry and the practice list both require the Games, Sound, and Manual controls inside the app frame. Sound must toggle and restore its original state, Manual must open and close, and Games must return home. One case must pass without skips under the unchanged build and UI deadlines. This doesn't certify every manual page, operation navigation, or physical-device layout.

The app must use a separate `com.mcclowes.machination.*qa` identity, expose its Documents folder through `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace`, and contain a simulator executable. Device archives, IPAs, and the regular Machination identity are rejected. See [native builds](../docs/native-builds.md) for the current prepared QA artifact and its exact source/runtime boundaries.

The runner verifies the app signature and JavaScript hash, validates each decompressed fixture with the current decoder, installs only the QA identity, and seeds its Documents folder. It builds the standalone XCTest target before running any cases. Three host regression tests cover fast process completion, failed commands, and missing executables; they run through ordinary test discovery without Xcode. The default replay flow requires three passing cases with no skips:

- Schema 3: actual natural ten-seat endgame import, exact endpoint hours, same-hour causal state order, actual playback advancement and stable paused time, Play/Pause/End, sheet dismissal, malformed-file recovery, and preservation of the previously imported ending.
- Schema 1: import, exact endpoint hours, visible software-key taps and actual clock seeking, timeline scrubbing, and recorded site inspection.
- Schema 2: drifting-base import, visible drift descriptions, exact endpoint hours, and causal state stepping.

Each case first rejects a saved multiplayer-seat indicator. No multiplayer, account, notification, or provider flow is selected. Picker navigation waits for either the local Files sidebar or the phone's Browse control before choosing its path, and recognizes a fixture folder already open from an earlier import. At large text sizes, file tiles can extend below the viewport: the runner scrolls the interactive file cell's thumbnail into view, waits for its position to settle, and touches its center. Cancellation taps the navigation bar's real Cancel button when available, or drags from the sheet edge above the bar otherwise; a Files menu's “Cancel” item does not cancel document picking.

The iPad keyboard case covers the floating numeric popover and a docked software keyboard. The docked setup repeats the erase/focus transition from the original failure before numeric entry through onscreen keys. The input, Seek, and Close controls must be reachable in the docked viewport, and the playback clock must change to `00:30`. Keyboard surfaces are selected by a visible, hittable zero key inside the app frame; the offscreen docked-keyboard placeholder cannot satisfy this guard. The numeric popover is dismissed through its exposed background before the app's Seek action. Full-screen captures preserve landscape geometry.

Expanded-text panels change the available chart area. Before closing Options, the runner waits for the Close button's frame to settle, requires a visible hit target, and verifies the panel disappears and the transport returns. Each readiness poll reads one frame; failed checks retain the target's accessibility description and app bounds. The original replay assertions and test deadlines remain unchanged.

The packed ending also checks the destroyed-site cross in a screenshot of Jasper: a colored-marker precondition rejects background samples, and dark ink must cover more than 3% of the central 12-point square. This fails on the original largest-text runtime and passes with fixed-size SVG artwork. Core and unknown-site captures support visual review; chart-edge crops can be clipped and cannot alone establish legibility. Site labels retain text scaling and parent accessibility descriptions.

The original fixture files must remain byte-identical after the suite, and the picker cache directory must be empty. Input app bytes are never changed. Evidence is retained under `.data/native-replay-acceptance/run-*`: commands, logs, source copy, fixture hashes, test results, screenshots, summary, and acceptance metadata. A successful run shuts down and deletes only its own simulator. A failed run shuts down its owned simulator and retains it for diagnosis; its UUID is in `result.json`.

## Fixtures

Compressed storage preserves every original byte; decompressed byte counts and SHA-256 values are enforced by `fixtures/manifest.json`. The packed fixture is the public export of the synthetic natural ending retained for [#181](https://github.com/mcclowes/machination/issues/181), with 1,154,571 bytes and 106,530 records. Its private game, archive, credentials, and messages are excluded. The schema-1 and schema-2 fixtures contain short public timelines generated by the recorded engine factories. The malformed case is deliberately truncated JSON.

Don't regenerate fixtures to make a changed decoder pass. Investigate compatibility failures while preserving their recorded rules, values, causal states, and output bytes.

This gate proves simulator picker and replay interaction for the recorded artifact. It does not prove network-denied playback, physical-device behavior, complete accessibility, device frame rate/memory/battery budgets, production sign-in/push, service rollout, or distribution. Those remain separate release gates.
