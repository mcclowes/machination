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

See the [specialists cheatsheet](docs/specialists-cheatsheet.md) for module effects, promotions, recruitment, and combat order.

Select a controlled rock, choose **Plan transfer**, tap a destination, and launch drones. Factories produce six drones every eight hours; generators raise the fleet-wide drone capacity. Drill mines on controlled sites to produce cargo based on territory size. Shields recharge and absorb attacks before drones. Reach 200 cargo or eliminate both rival cores. Existing version-one saves retain their original economy and 300-cargo target. Losing your core ends your operation.

Build modules with drones on a controlled rock, then explicitly load one onto a hauler. Routing daemons shorten transit, viruses convert defenders, scavenger rigs intercept moving haulers and recover combat losses, and self-destruct charges sacrifice a hauler to damage a garrison.

Choose a launch time from now to seven days ahead and manage private plans in **Scheduled transfers**. Plans use resources available at execution, and can be canceled before launch.

Launches prepare for ten minutes with reserved manifests. Edit or cancel before departure in **Your live hauler orders**. Opposing ordinary haulers fight when they pass on the same route. In new operations, gifts transfer on contact to the current destination owner or a passing hauler; gift orders have a ten-minute cancellation window. Eliminated intelligences retain territory, production, and launched haulers, but lose cargo and cannot issue orders. Version-one saves keep their original transport and elimination rules.

Haulers take hours to arrive. Time continues while the app is closed, and **Advance simulation +6h** speeds up solo play. The Time Machine scrubs up to seven days ahead, accepts minute-precision inspection, and schedules transfers directly from that future context. Tap haulers to inspect them; pinch or use chart controls to zoom, then drag to pan. Forecasts include known orders and rival decisions without changing the live operation. Local saves survive app restarts; resetting requires confirmation.

## Check

```sh
npm run check
npm run build:web
npx expo install --check
```

The simulation is pure TypeScript and independent of rendering and storage. Tests live alongside it. The command map uses SVG and shared React Native controls.

`npm run check` runs the behavior tests, TypeScript checks, and standalone server build/restart tests. CI uses the same command before container and platform export checks. See [testing](docs/testing.md) for targeted commands, execution limits, coverage, and device acceptance.

Use [hosted playtest packaging](docs/hosting.md) to build the standalone service and validate its container, persistent storage, and backups. Public hosting is not provisioned by these commands.

See [existing remake references](docs/remake-references.md) for reuse candidates and license findings.

Original native icons and launch artwork are generated from an editable vector. Run `npm run build:brand` to rebuild them and create a masked preview. See [artwork notes](assets/brand/README.md).

Open **Manual → Art archive** to browse all 24 generated illustrations from the Machination ChatGPT project. Project scenes also illustrate the manual, controlled-site inspectors, and specialist bay. [Project artwork notes](assets/artwork/README.md) record source chats, preserved originals, and display copies.

## Scope

This is a playable foundation, not a store release. Push notifications, public frontend hosting, and native distribution remain unimplemented. Shared Marginal Utility login through Clerk, cross-device seat restoration, and legacy seat linking are implemented; activation needs shared-instance configuration and native registration. See [account setup](docs/accounts.md). Players can save a single-use offline recovery code for their multiplayer seat. Invite-only multiplayer and private bilateral messages run against the included local service. Travel uses distance on a fixed map, not orbital physics. iOS simulator startup, clock progression, save restoration, core commands, private messaging, and seat recovery are verified. Android and physical-device behavior still need verification.

Run `npm run server` and open **Multiplayer uplink** to create or join a three-player operation. Online play uses sensor-limited views: unknown rocks display `?`, and scouts reveal nearby contacts. Forecasts leave hidden arrival outcomes unresolved. Solo remains a full-information training simulation. See [multiplayer setup and API](docs/multiplayer.md).

See [game design](docs/game-design.md) and [implementation tracking](https://github.com/mcclowes/machination/issues/1).

The current dependency audit flags Zod 3 in Expo CLI ([advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)). No major-version override is applied because the CLI declares a Zod 3 dependency. Recheck upstream before distribution.

A first-launch briefing introduces the objective and first transfer. Open **Manual** from either operation mode for the full rules, sensor limits, schedules, forecasts, and diplomacy. Dismissing the briefing stores a local preference separately from game saves.
