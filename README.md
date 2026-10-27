# Machination

Slow orbits. Cold decisions.

An iOS and Android strategy game about rival machine intelligences in the asteroid belt. Built with Expo, React Native, and TypeScript. The first playable is an offline solo operation with two deterministic AI rivals.

## Run

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Use `npm run ios` with the iOS Simulator, `npm run android` with an Android emulator, or `npm run web` for the browser. Native launch requires the corresponding platform tooling. Expo's [SDK 55 reference](https://docs.expo.dev/versions/v55.0.0/) documents the supported native versions.

## Play

Select a controlled rock, choose **Plan transfer**, tap a destination, and launch drones. Mines produce cargo; reactors and cores produce drones. Reach 300 cargo or capture both rival cores. Losing your core ends your operation.

Haulers take hours to arrive. Time continues while the app is closed, and **Advance simulation +6h** speeds up solo play. The timeline forecasts known orders and rival decisions without changing the live operation. Local saves survive app restarts; resetting requires confirmation.

## Check

```sh
npm test
npm run typecheck
npm run build:web
npx expo install --check
```

The simulation is pure TypeScript and independent of rendering and storage. Tests live alongside it. The command map uses SVG and shared React Native controls.

## Scope

This is a playable foundation, not a store release. Multiplayer, real diplomacy, fog of war, modules, push notifications, and native distribution remain unimplemented. Travel uses distance on a fixed map, not orbital physics. Native runtime behavior still needs iOS and Android device verification.

See [game design](docs/game-design.md) and [implementation tracking](https://github.com/mcclowes/machination/issues/1).

The current dependency audit flags Zod 3 in Expo CLI ([advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)). No major-version override is applied because the CLI declares a Zod 3 dependency. Recheck upstream before distribution.
