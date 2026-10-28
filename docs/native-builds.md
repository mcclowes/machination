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

This builds Release configuration without signing to `ios/build/playtest/Build/Products/Release-iphonesimulator/Machination.app`. The command sets iOS 15.1 consistently across app and dependency targets because Xcode 27.1 rejects the older deployment targets declared by SVG and AsyncStorage resource bundles. It does not change the dependency source or generated project files. This artifact runs only in an iOS simulator. On Xcode 27.1, use this command to avoid the dependency deployment-target failure in the ordinary `npm run ios` path.
 Physical devices and distribution require Apple signing configuration. No signing credentials are included in the repository.

## Verification boundaries

An Expo JavaScript export proves bundling, not native compilation. A Gradle or Xcode build proves compilation, not installation or gameplay. Before distributing, verify first-launch dismissal, operation save/reload, foreground/background catch-up, map selection, transfers, module combat, invitation joining, private messages, and retry behavior on both native platforms. Include notched screens, the software keyboard, and enlarged text in layout checks.

## Current local evidence

Both native projects generated successfully. The first Android compile stopped before APK creation because NDK 27.1.12297006 is missing and its license is not accepted. Install that component through Android Studio, then rerun the playtest command. No Android device is connected and no Android emulator is configured. Native gameplay remains unverified on both platforms.
