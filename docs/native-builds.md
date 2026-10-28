# Native playtest builds

Machination uses Expo native project generation. `app.json`, config plugins, and package versions are the source of truth. The generated `android/` and `ios/` directories are ignored; do not put permanent changes directly into them. Follow [Expo's local build guide](https://docs.expo.dev/guides/local-app-development/) for tool installation.

## Android

Install Java 17 and Android Studio with SDK 36, build tools 36.0.0, and NDK 27.1.12297006. Accept the required Android SDK/NDK licenses in Android Studio’s SDK Manager before building. Set `ANDROID_HOME` to your Android SDK directory if it isn't already configured. On macOS the usual location is `$HOME/Library/Android/sdk`.

```sh
npm ci
npm run build:android:playtest
```

This generates the Android project and assembles an ARM64 release-mode APK with the JavaScript bundle included. No Metro server is required for solo play. The output is `android/app/build/outputs/apk/release/app-release.apk`.

The generated Expo template uses its development signing key for this build. This is an internal playtest artifact, not a store-signed release. It includes only `arm64-v8a`; use an ARM64 device or emulator. For another architecture, run the generated Gradle task with an appropriate `-PreactNativeArchitectures` value.

With a device connected and USB debugging enabled:

```sh
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.mcclowes.machination/.MainActivity
```

For native development with Metro, use `npm run android`. This compiles and installs through Expo. An Android device or configured emulator is required.

## Multiplayer endpoint

Set `EXPO_PUBLIC_GAME_SERVER` to the playtest service's HTTPS URL **before building**. Without it, the app starts with `http://localhost:8787`, suitable only for local development; localhost on a phone is the phone itself. A release-mode app may reject cleartext HTTP. Public hosting isn't provisioned by these commands. See [multiplayer service](multiplayer.md).

## iOS

Install Xcode with iOS SDKs, a simulator runtime, and CocoaPods. Then run:

```sh
npm ci
npm run ios
```

Expo generates the iOS project, installs pods, compiles, and launches in the simulator.

To compile a bundled simulator app without booting a simulator:

```sh
npm run build:ios:simulator
```

This builds Release configuration with local ad-hoc simulator signing to `ios/build/playtest/Build/Products/Release-iphonesimulator/Machination.app`. The local Expo config plugin raises dependency deployment targets to the project minimum (iOS 15.1 by default), preserving any higher target. Xcode 27.1 rejects the older targets declared by SVG and AsyncStorage resource bundles. The plugin applies during prebuild and CocoaPods installation, so the fix survives regeneration and also covers `npm run ios`. It does not modify dependency source. This artifact runs only in an iOS simulator. The signing step is required for SecureStore on the tested iOS 27.1 runtime; an unsigned Release build failed with a missing-entitlement error. No Apple team or distribution certificate is configured by this command.

The scene lifecycle plugin creates the React window inside `UIWindowScene` and forwards lifecycle and linking events through Expo. This is required for launch with the iOS 27 SDK; see [Apple’s scene migration guide](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle). Machination supports one scene per process.

Physical devices and distribution require Apple signing configuration. No signing credentials are included in the repository.

The simulator command retains full Xcode diagnostics. A subsequent Xcode 27.1 build failed with exit 65 and several SwiftCompile reports of exit code 0 with no further output. An [Expo issue](https://github.com/expo/expo/issues/50279) reports a similar failure associated with `-quiet`; removing that flag here preserves diagnostic context without asserting that it alone fixes every compiler failure. The current diagnostic retry uses the actual ARM64 simulator destination and a result bundle. Installation still requires a successful terminal build result; an older app left in the output directory isn't evidence that the retry passed. See [#8](https://github.com/mcclowes/machination/issues/8).

## Verification boundaries

An Expo JavaScript export proves bundling, not native compilation. A Gradle or Xcode build proves compilation, not installation or gameplay. Before distributing, verify first-launch dismissal, operation save/reload, foreground/background catch-up, map selection, transfers, module combat, invitation joining, private messages, and retry behavior on both native platforms. Include notched screens, the software keyboard, and enlarged text in layout checks.

## Current local evidence

Both native projects generated successfully. The ad-hoc-signed iOS Release simulator build completes without command-line deployment-target overrides. The compiled app contains ARM64 and Intel binaries, an embedded JavaScript bundle, and a resolved scene delegate manifest.

Installation and native startup succeed on iOS 27.1. React initializes, the clock advances, and AsyncStorage writes a save that passes the game validator. Terminating and relaunching preserves the operation epoch and resumes its clock. The previous UIKit scene-lifecycle launch failure is resolved. Device Hub now renders the app and exposes its native controls. Verified briefing dismissal, asset selection, manifest input, a 20-drone transfer, read-only forecast behavior, and matching results after two six-hour advances. An 80-drone scavenger interception defeated a 50-drone target and produced the expected 42-drone return fleet. Briefing dismissal, game time, and the module bay survived app replacement and relaunch.

The solo command scroll view now handles button taps while the keyboard is open; one native interception tap dispatched successfully. Horizontal safe areas keep the Manual control clear of the foldable status area. Ad-hoc simulator signing resolves the missing-entitlement failure in SecureStore. Verified native operation creation, a three-seat start with two synthetic local clients, a private transmission to Vesper withheld from Null, a fixture reply in the native UI, and restoration of the same connection after process termination/relaunch. Native recovery-code generation, local disconnection, code-based restoration, consumed-code status, and preservation of private messages also pass.

Native checks cover an iOS 27.1 foldable simulator and the ordinary iPhone 18 Pro profile on iOS 27.0. Android, physical devices, tablet layouts, push delivery, and store distribution still require verification or implementation.

On the fresh iPhone 18 Pro simulator, the same signed universal build installs and launches into the first-run briefing. Its heading, Close control, and body clear the status area. Return to command opens the solo operation. Entering a 20-drone manifest and launching toward Morrow reduces the core from 90 to 70 drones and creates one nine-hour hauler. The twelve-hour forecast includes rival activity and disables order controls. Terminating and relaunching restores the live clock, 70-drone core, and same 20-drone hauler without repeating the briefing; the forecast selection resets to live state. Ordinary-phone multiplayer, recovery, software-keyboard geometry, and enlarged text remain unverified.

The ordinary-phone full manual also reaches its later forecast, schedule, and diplomacy sections with Close clear of the status area; Return to command preserves the operation. Two native six-hour advances then match the earlier twelve-hour forecast: Morrow belongs to Vesper with 24 drones, the player core has 118 drones, cargo is 1/300, and two rival haulers remain in transit. This verifies the native solo arrival path with competing rival orders, rather than assuming the player's first transfer captures its destination.

Scheduled solo transfers also pass on that phone. A twelve-drone reinforcement from Mnemosyne to Suture queued for +1h leaves the core at 118 drones. Cancel removes the plan without a charge. Requeuing and cold relaunch preserve the order and both stations' inventories. Advancing six hours executes the one-hour delay and four-hour journey: the queue empties, the log records the twelve-drone dispatch, Mnemosyne reaches 130 drones (118 + 24 produced − 12 sent), and Suture reaches 120 (84 + 24 produced + 12 received). Real-time native multiplayer schedule execution and Android interaction remain separate verification boundaries.

Standard-phone multiplayer creation, lobby updates, host start, and automatic saved-seat restoration also pass against the local service with two synthetic rival seats. The native lobby disables orders before start. A twelve-drone +1h reinforcement queues without changing the 90-drone core; both rivals' HTTP game projections have empty scheduled-order arrays. Cold relaunch opens solo by default; selecting Multiplayer uplink restores the same active seat and queued order without entering credentials. Its manifest remains an ordinary text field. Canceling the restored order empties the queue and preserves 90 drones. Real-time execution of this multiplayer order was not tested: it was canceled before launch. Standard-phone code recovery, remote HTTPS, and Android remain unverified.

Standard-phone private messaging now also passes with the software keyboard explicitly shown. The entire composer and Transmit button remain above the keyboard before and after one native send. The synthetic Vesper seat receives exactly one copy of the test message; the unrelated Null seat receives none. This extends composer layout evidence to iOS 27.0 on a regular notched phone. Code recovery on this profile, enlarged text, remote HTTPS, and Android interaction remain unverified.

The first Android compile stopped before APK creation because NDK 27.1.12297006 is missing and its license is not accepted. Install that component through Android Studio, then rerun the playtest command. No Android device is connected and no Android emulator is configured. Android native gameplay remains unverified.

## Faithful rebuild acceptance, October 28

A signed current Release build compiled with the document picker, filesystem, and sharing modules. A separately identified QA copy (`com.mcclowes.machination.fidelityqa`) was installed alongside the existing Machination app on the iPhone 18 Pro / iOS 27.0 simulator. The original app and its saved operation/connection were preserved. This is simulator evidence, not physical-device or Android acceptance.

The current briefing clears the status area and dismisses to the entry screen. Native tactical practice completes its first exercise through the real map and manifest: six drones leave Foundry, arrival inspection forecasts Quiet landing with two survivors without awarding completion, and manual live advancement stops at 01:10 with actual capture and completion. Review images are `.fettle/shots/native-current-briefing.png`, `native-practice-arrival-forecast.png`, and `native-practice-complete.png`. The other four exercises still need native acceptance.

Native Hermes successfully generates an observed solo replay and its disclosure preview. Save replay opens the system share sheet; Save to Files writes the JSON locally under On My iPhone. The app returns with “Share sheet closed,” without claiming recipient delivery. The document picker finds that saved file, strict import opens the unverified replay viewer, Beginning seeks to the first state, and Play reaches the recorded end and disables further playback. The live operation is unmounted during imported viewing. No replay was sent to another person. `.fettle/shots/native-replay-imported.png` records the actual viewer. This short clip has no moving haulers; native battle/movement playback, offline network isolation, and physical-device providers remain separate checks.

Two UI gaps remain explicit. [#28](https://github.com/mcclowes/machination/issues/28) records swapped site/timeline accessibility roles after Practice-to-Solo transitions; a fresh Device Hub read reproduces the mismatch, but source inspection does not establish a safe recycling patch. React Native's iOS mapping of `tab` to no native trait is a separate confirmed issue; `934c5ec` uses selected buttons on iOS, with its native rebuild still queued at this checkpoint. [#31](https://github.com/mcclowes/machination/issues/31) records the replay viewer's controls displacing the chart on a phone. These findings prevent claiming complete native UI parity.

## Replay and entry follow-up

The subsequent arm64 Release build succeeds with the refreshed native dependencies and detailed Xcode output. Its separately signed QA copy replaces only `com.mcclowes.machination.fidelityqa`; the original app remains untouched. This establishes a current iOS simulator artifact, not Android or distribution readiness. Because the retry also refreshed dependencies and restricted the architecture, it doesn't isolate `-quiet` as the cause of the preceding compiler failure.

The opening artwork previously exceeded the phone viewport and displaced all four game actions. `c911d30` bounds the contained image and scroll content. The complete image and Practice, Solo, Multiplayer, and Open shared replay actions now appear together on the iPhone 18 Pro. Evidence: `.fettle/shots/native-entry-before-layout.png` and `native-entry-after-layout.png`. Desktop rendering remains open in [#25](https://github.com/mcclowes/machination/issues/25).

An actual document-picker import of a synthetic twelve-hour observed combat replay verifies the persistent chart layout. Exact seeking with the software keyboard open, same-hour battle states (40 versus 10 becomes 30 survivors), continuous quarter-speed movement, scrubber tapping, Fit chart, read-only fleet inspection, and arrival jumps all work. Opening Options pauses playback and leaves the time input stable while editing. Review images: `native-replay-exact-seek-keyboard.png`, `native-replay-paused-input.png`, `native-replay-battle-after.png`, `native-replay-flight.png`, `native-replay-playing.png`, and `native-replay-hauler-inspection.png`, all under `.fettle/shots/`. The local fixture server was stopped before these playback checks; networking itself wasn't disabled.

Adding `accessible` makes the replay timeline appear in native accessibility with its clock, causal-state value, and increment/decrement actions. Device Hub reports a button instead of an adjustable role. A separate fresh entry-to-library transition reports Open replay as a switch despite its explicit button source role, reproducing [#28](https://github.com/mcclowes/machination/issues/28) on the new artifact. These observations don't distinguish native trait retention from the inspection bridge's caching. The Device Hub window subsequently became unavailable (`cgWindowNotFound`), including after fresh application discovery and reconnection. Custom accessibility action execution, viewer pan/zoom and site inspection, zero-duration rendering, networking-disabled playback, and physical-device acceptance remain unverified; [#31](https://github.com/mcclowes/machination/issues/31) stays open.

## Native identity

Original icons and launch artwork are configured in `app.json`. Run `npm run build:brand` to regenerate their PNGs from the editable vector and inspect the masked and small-size preview. See [the artwork notes](../assets/brand/README.md).

All exported assets pass dimension, opacity, monochrome, and adaptive safe-area checks. Generated Android foreground and monochrome layers remain inside the safe area, and its resources select the dark system appearance. The generated iOS icon has identical pixels to the exported source. The signed iOS build compiles, installs, launches, and displays the new icon on the iOS 27.1 simulator home screen. Opening that icon returns to the saved operation; the launch overlay does not remain over gameplay. The compiled app includes the launch storyboard and asset catalog. Splash animation/timing, themed launcher appearance, and Android runtime rendering still need device checks. No store artwork upload or distribution signing was performed.

## Editor verification follow-up

The shared manual now provides safe-area context inside its native modal. On the iOS 27.1 closed foldable, Close and rule text stay clear of the status area. Native checks cover opening it from solo and multiplayer, reaching later sensor/forecast/schedule/diplomacy sections, closing back to the retained operation, and preserving briefing acknowledgment across app replacements. Solo reset still presents confirmation; Keep operation returns to the existing day-two save. TypeScript, all platform exports, and the signed iOS build pass. Before/after modal evidence is saved locally. Android manual interaction remains part of native Android QA.

Drone/module gifts pass native interaction checks on the signed iOS 27.1 build in closed-phone pose. Constructed and loaded a routing daemon, entered a five-drone manifest, and reviewed a gift to an observed Null collective rock. Canceling preserved the 78-drone source and its module with no hauler launched. Confirming transferred exactly five drones and the module to a Null-owned hauler, leaving 73 drones at the source. The recipient's synthetic HTTP seat sees its new hauler and gift telemetry; unrelated Vesper sees neither. Native review evidence is saved locally. Simulation and HTTP checks separately cover arrival, privacy, retries, restart, and offline delivery. iOS, Android, and web exports pass; Android native interaction remains unverified. See [#15](https://github.com/mcclowes/machination/issues/15).

The private editor now explicitly scrolls its whole composer above the keyboard after keyboard appearance and content layout changes, accounting for the scroll view's window offset. Insets alone left only the caret visible; sending also pushed controls down when message history grew. On the signed iOS 27.1 closed-phone build, the whole editor and Transmit control remain visible before and after sending. One tap with the keyboard open sends exactly once to the synthetic recipient, while the unrelated seat sees no message. An on-screen key can start the next draft without hiding the keyboard. Before/after evidence is saved locally. TypeScript, all platform exports, and native compilation/install/launch pass.

The post-recovery secure-role leak is resolved by opting iOS text-input component views out of Fabric's reuse pool. The local [input identity plugin](../plugins/withIosTextInputIdentity.cjs) generates the Objective-C++ category and registers it as an app source during prebuild. Only text inputs stop sharing recycled native views; other view pools and all secure/plain input properties remain unchanged. This trades a few input allocations on screen transitions for reliable native accessibility identities. The plugin checks the installed React Native factory contract and rejects a changed or newly overridden recycling policy so an upgrade requires review. Repeated generation registers one source, and the method is linked into the signed universal simulator binary.

On iOS 27.1 in closed-phone pose, two native recovery loops preserve the same seat and messages. Recovery entry remains a secure field, and a harmless sample is visibly masked. Online and solo manifests remain ordinary text fields after automatic restoration, code restoration, and mode switches; the recovered manifest accepts visible numeric input. The recovered private composer remains unmasked and above the open software keyboard before and after sending, with exactly one message delivered to the intended synthetic recipient and none to the unrelated seat. Native evidence contains no real recovery secrets. All 70 regression checks, TypeScript, platform exports, and native compilation/install/launch pass. See [#13](https://github.com/mcclowes/machination/issues/13). Regular phone profiles, physical devices, and Android interaction remain separate QA.
