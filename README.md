# Machination

Slow orbits. Cold decisions.

An iOS and Android strategy game about rival machine intelligences in the asteroid belt. Built with Expo, React Native, and TypeScript. Play solo against one to nine deterministic AI rivals, or connect two to ten human players through the invite-only multiplayer service.

## Run

Use Node.js **24.14.1**, pinned in `.nvmrc`, for development and the full acceptance suite. The binary64 diagnostics require its certified V8 profile; other Node versions can refuse those checks. Gameplay and player replay exports remain portable across native and browser runtimes. See [testing prerequisites](docs/testing.md#acceptance-runtime).

With nvm installed, run these commands from the repository root:

```sh
nvm install
nvm use
npm ci
npm start
```

Use `npm run ios` with the iOS Simulator, `npm run android` with an Android emulator, or `npm run web` for the browser. These commands generate and compile native projects and require the corresponding platform tooling. See [native playtest builds](docs/native-builds.md) for the bundled Android APK command, signing limits, and device checks. Expo's [SDK 55 reference](https://docs.expo.dev/versions/v55.0.0/) documents the supported native versions.

## Play

Open **Manual → Specialists cheatsheet** for specialist effects, promotions, recruitment, and combat order. A [Markdown reference](docs/specialists-cheatsheet.md) and [terminology policy](docs/terminology.md) are also available.

Select a controlled site, choose **Plan transfer**, tap a destination, and launch drones. Factories produce six drones every eight hours; reactors raise the fleet-wide drone capacity. Drill mines on controlled sites to produce cargo based on territory size. Shields recharge and absorb attacks before drones. New operations default to **King’s Pulse**: the movable core is your King. Spend 100 mined pulse material, charge for six real hours while stationed, then fire manually from the asset inspector or Intel. The circular pulse destroys unprotected opposing sites, ships, specialists, and Kings. Your own assets are immune. Movement orders immediately cancel charging or emission without a refund; a dead King’s pulse disappears everywhere. The last surviving King wins, and simultaneous final kills draw. The Disruptor spends the same material on short-range, fading tactical waves that interrupt charging and temporarily disrupt enemy assets. Mining and domination remain selectable legacy modes; existing saves keep their rules.

In version-one operations, build modules with drones on a controlled site, then explicitly load one onto a hauler. Thrusters shorten transit, hijackers convert defenders, interceptors pursue moving haulers and recover combat losses, and meltdown charges sacrifice a hauler to damage a garrison.

Pulse shields have separate 100-energy reserves. Each hostile pulse drains 20 energy/hour; reserves recharge 5/hour only outside exposure. Shields protect stationed units and preparing haulers, never passing ships, and do not stop propagation. Inspect a site for your shield reserve, depletion, and estimated arrival times. Enemy charge information requires sensor visibility.

Choose a launch time from now to seven days ahead and manage private plans in the order queue beside the time controls. Select a row to inspect its time and edit its manifest, or use **×** to cancel. Plans use resources available at execution.

Launches prepare for ten minutes with reserved manifests. Edit or cancel before departure in **Your live hauler orders**. Opposing ordinary haulers fight when they pass on the same route. In new operations, gifts transfer on contact to the current destination owner or a passing hauler; gift orders have a ten-minute cancellation window. Eliminated intelligences retain territory, production, and launched haulers, but lose cargo and cannot issue orders. Version-one saves keep their original transport and elimination rules.

Haulers take hours to arrive. Time continues while the app is closed, and **Advance simulation +6h** speeds up solo play. The Time Machine scrubs up to seven days ahead, accepts minute-precision inspection, and schedules transfers directly from that future context. Tap haulers to inspect them; pinch, scroll the mouse wheel or trackpad, or use chart controls to zoom, then drag to pan. Chart controls are visible by default on web. Forecasts include known orders and rival decisions without changing the live operation. Local saves survive app restarts; resetting requires confirmation.

## Player guide

The [Docusaurus player guide](website/README.md) contains first-move tutorials, practice walkthroughs, planning and diplomacy guides, and generated rules and specialist references shared with the game. Run `npm ci --prefix website`, then `npm run docs` to open it locally. `npm run check:docs` builds and validates the site; `npm run test:docs` checks its desktop and phone navigation.

## Check

See [architecture and change boundaries](docs/architecture.md) for module ownership, source-quality checks, CI policy, and persistence benchmarks.

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

Background music follows known battles in the live operation, moving from calm to moderate tension to imminent battle. **Sound** mutes music and effects. Credits for Nikita Kondrashev, Sergii Pavkin, and Alex Morgan appear in **Manual → Music credits**; see [soundtrack notes](assets/music/README.md).

Open **Manual → Art archive** to browse all 24 generated illustrations from the Machination ChatGPT project. Project scenes also illustrate the manual, controlled-site inspectors, and specialist bay. [Project artwork notes](assets/artwork/README.md) record source chats, preserved originals, and display copies.

## Scope

See [multiplayer iOS release readiness](docs/ios-release-readiness.md) for the release gates, current gaps, and physical-device acceptance scenarios.

This is a playable foundation, not a store release. Opt-in message notification code is implemented, with delivery disabled by default; provider configuration and actual device delivery remain unverified. See [notification setup and boundaries](docs/notifications.md). Public frontend hosting and public store distribution remain unimplemented; an internal TestFlight build is out (see [native builds](docs/native-builds.md)). Clerk login with a dedicated Machination account, cross-device seat restoration, and legacy seat linking are implemented; production activation needs production-instance configuration and native registration. See [account setup](docs/accounts.md). Players can save a single-use offline recovery code for their multiplayer seat. Invite-only multiplayer and private bilateral messages run against the included local service or the [Railway playtest API](docs/railway.md). Travel uses distance on a fixed map, not orbital physics. iOS simulator startup, clock progression, save restoration, core commands, private messaging, and seat recovery are verified. Android and physical-device behavior still need verification.

Run `npm run server` and open **Multiplayer uplink** to create or join an operation of two to ten players. Online play uses sensor-limited views: unknown sites display `?`, and scouts reveal nearby contacts. Forecasts leave hidden arrival outcomes unresolved. Solo remains a full-information training simulation. See [multiplayer setup and API](docs/multiplayer.md).

See [game design](docs/game-design.md) and [implementation tracking](https://github.com/mcclowes/machination/issues/1).

The current dependency audit flags Zod 3 in Expo CLI ([advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)). No major-version override is applied because the CLI declares a Zod 3 dependency. Recheck upstream before distribution.

A first-launch briefing introduces the objective and first transfer. Open **Manual** from either operation mode for the full rules, sensor limits, schedules, forecasts, and diplomacy. Dismissing the briefing stores a local preference separately from game saves.

## Pulse balancing and abilities

Set `MACHINATION_PULSE_CONFIG` on the server to a JSON object overriding defaults, for example `'{"chargeDuration":3,"activationResourceCost":75,"propagationSpeed":6}'`. All simulation times are game hours and speeds are chart units/hour. The server validates and snapshots the settings into new games; changing the environment does not rebalance existing operations. Other settings are `shieldMaxEnergy`, `shieldDrainPerHour`, `shieldRechargePerHour`, and `miningDamage` (`destroy` or `disable`).

`applyPulseSpecialistEffect` is the trusted ability hook for charge rate, uniform pulse speed, shield drain, charge interruption, and emission termination. The hook requires a unique command ID and is replayable through the trusted `pulse-specialist-effect` command. Timed effects expire at simulation boundaries and never recalculate past progress. Ability handlers must validate ownership, range, costs, and cooldowns before applying an effect; clients cannot submit arbitrary multipliers. The [Disruptor](docs/disruptor.md), available in new revision-16 pulse operations, charges for 30 minutes using 10–25 material. Strong hits reset charging Kings or halve a firing King’s propagation speed for one hour. Affected Kings resist further interruption for six hours. Tactical waves persist after source movement or destruction and never directly destroy Kings. New revision-18 operations add [Dilation, Anchor, Overclock, Hindsight, Foresight, and Hastener](docs/temporal-specialists.md), with versioned timing, private disclosures, and site-owned production debt. Gravity abilities remain future work. Regional wave distortion, alliance immunity, and finite pulse fuel remain future rules.
