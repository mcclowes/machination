# Machination

Slow orbits. Cold decisions.

An iOS and Android strategy game about rival machine intelligences in the asteroid belt. Built with Expo, React Native, and TypeScript. Play solo against two deterministic AI rivals, or connect three human players through the invite-only multiplayer service.

## Run

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Use `npm run ios` with the iOS Simulator, `npm run android` with an Android emulator, or `npm run web` for the browser. These commands generate and compile native projects and require the corresponding platform tooling. See [native playtest builds](docs/native-builds.md) for the bundled Android APK command, signing limits, and device checks. Expo's [SDK 55 reference](https://docs.expo.dev/versions/v55.0.0/) documents the supported native versions.

## Play

Select a controlled rock, choose **Plan transfer**, tap a destination, and launch drones. Mines produce cargo; reactors and cores produce drones. Reach 300 cargo or capture both rival cores. Losing your core ends your operation.

Build modules with drones on a controlled rock, then explicitly load one onto a hauler. Routing daemons shorten transit, viruses convert defenders, scavenger rigs intercept moving haulers and recover combat losses, and self-destruct charges sacrifice a hauler to damage a garrison.

Choose a launch time from now to seven days ahead and manage private plans in **Scheduled transfers**. Plans use resources available at execution, and can be canceled before launch.

Haulers take hours to arrive. Time continues while the app is closed, and **Advance simulation +6h** speeds up solo play. The timeline forecasts known orders and rival decisions without changing the live operation. Local saves survive app restarts; resetting requires confirmation.

## Check

```sh
npm test
npm run typecheck
npm run build:web
npx expo install --check
```

The simulation is pure TypeScript and independent of rendering and storage. Tests live alongside it. The command map uses SVG and shared React Native controls.

See [existing remake references](docs/remake-references.md) for reuse candidates and license findings.

## Scope

This is a playable foundation, not a store release. Push notifications, account recovery, public hosting, and native distribution remain unimplemented. Invite-only multiplayer and private bilateral messages run against the included local service. Travel uses distance on a fixed map, not orbital physics. iOS simulator startup, clock progression, and save restoration are verified. Native controls, multiplayer, and end-to-end gameplay still need device verification.

Run `npm run server` and open **Multiplayer uplink** to create or join a three-player operation. Online play uses sensor-limited views: unknown rocks display `?`, and scouts reveal nearby contacts. Forecasts leave hidden arrival outcomes unresolved. Solo remains a full-information training simulation. See [multiplayer setup and API](docs/multiplayer.md).

See [game design](docs/game-design.md) and [implementation tracking](https://github.com/mcclowes/machination/issues/1).

The current dependency audit flags Zod 3 in Expo CLI ([advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)). No major-version override is applied because the CLI declares a Zod 3 dependency. Recheck upstream before distribution.

A first-launch briefing introduces the objective and first transfer. Open **Manual** from either operation mode for the full rules, sensor limits, schedules, forecasts, and diplomacy. Dismissing the briefing stores a local preference separately from game saves.
