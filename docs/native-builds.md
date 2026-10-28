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

## Verification boundaries

An Expo JavaScript export proves bundling, not native compilation. A Gradle or Xcode build proves compilation, not installation or gameplay. Before distributing, verify first-launch dismissal, operation save/reload, foreground/background catch-up, map selection, transfers, module combat, invitation joining, private messages, and retry behavior on both native platforms. Include notched screens, the software keyboard, and enlarged text in layout checks.

## Current local evidence

Both native projects generated successfully. The ad-hoc-signed iOS Release simulator build completes without command-line deployment-target overrides. The compiled app contains ARM64 and Intel binaries, an embedded JavaScript bundle, and a resolved scene delegate manifest.

Installation and native startup succeed on iOS 27.1. React initializes, the clock advances, and AsyncStorage writes a save that passes the game validator. Terminating and relaunching preserves the operation epoch and resumes its clock. The previous UIKit scene-lifecycle launch failure is resolved. Device Hub now renders the app and exposes its native controls. Verified briefing dismissal, asset selection, manifest input, a 20-drone transfer, read-only forecast behavior, and matching results after two six-hour advances. An 80-drone scavenger interception defeated a 50-drone target and produced the expected 42-drone return fleet. Briefing dismissal, game time, and the module bay survived app replacement and relaunch.

The solo command scroll view now handles button taps while the keyboard is open; one native interception tap dispatched successfully. Horizontal safe areas keep the Manual control clear of the foldable status area. Ad-hoc simulator signing resolves the missing-entitlement failure in SecureStore. Verified native operation creation, a three-seat start with two synthetic local clients, a private transmission to Vesper withheld from Null, a fixture reply in the native UI, and restoration of the same connection after process termination/relaunch. Native recovery-code generation, local disconnection, code-based restoration, consumed-code status, and preservation of private messages also pass.

These native checks cover one iOS 27.1 foldable simulator. Android, physical devices, regular phone/tablet layouts, push delivery, and store distribution still require verification or implementation.

The first Android compile stopped before APK creation because NDK 27.1.12297006 is missing and its license is not accepted. Install that component through Android Studio, then rerun the playtest command. No Android device is connected and no Android emulator is configured. Android native gameplay remains unverified.
