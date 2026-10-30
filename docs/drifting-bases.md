# Drifting asteroid bases

Fresh solo and multiplayer setup starts with a stationary chart. Enable **Drifting asteroid bases** to opt into the experiment, as required by [#32](https://github.com/mcclowes/machination/issues/32). Explicit creation options without the flag are also stationary. Existing drifting operations, their saved histories, and retries without new setup options retain their recorded motion. Resetting an existing operation initially presents that operation's current settings; the checkbox remains editable before replacement.

The variant converts two initially neutral sites per player into small asteroid installations. Starting stations stay fixed. Selection alternates between starting territories, taking each core's closest remaining neutral sites. This provides equal counts, not a guarantee of equal expansion opportunity throughout a match. Drift directions differ between territories and between their two asteroids.

Asteroids move in straight lines at 0.5 chart units per game hour, or 12 per day. Both map axes wrap. The smaller chart marker and gold dotted course distinguish them from stations. Selecting an asteroid highlights its position 24 hours ahead. The Time Machine shows its position at the inspected time. Bodies can pass each other without collision damage.

Capture carries the garrison, specialists, and sensor coverage along the asteroid's course. Ownership, mine conversion, and moving an intelligence core aboard never change that course. Asteroids use existing factories, generators, and mine construction rules; they don't grant free producing mines. A destroyed asteroid keeps drifting as a wreck with its existing owner and sonar, without production, power, shields, or mining.

Launch preparation remains aboard the departure body. Haulers launch from its position after preparation and rendezvous with the destination's future position. Once airborne, a hauler keeps its fixed departure point and committed straight route. Edited manifests, speed changes, navigator redirection, interceptions, and return missions use the same motion geometry. The transfer preview uses the selected manifest's speed and departure time.

Motion origins and velocities are public chart information even outside sonar. Garrison details remain subject to the existing observation rules. Live sensors follow their base; forecasts advance public motion while retaining uncertainty about hidden state. Timed range abilities use current positions. Envoy rescues also schedule range-entry events so a long advance and split polling release captives at the same time.

## Compatibility

Revision 6 operations imply drift; from mechanics revision 7, `rules.driftingBases` records the variant independently of the revision. Each moving site's `drift` stores an immutable hour-zero origin and velocity; its `x` and `y` reflect the current simulation hour. Positions are calculated from the origin instead of accumulating elapsed deltas, avoiding polling-dependent drift. Save validation requires finite, bounded motion, a wrapped chart, drifting enabled in the saved rules, and coordinates consistent with the saved hour.

Shared replays with drift use schema version 2 and preserve only disclosed motion. Readers continue to accept stationary schema version 1. Version 2 validates immutable courses and coordinates across frames; playback evaluates both sites and coverage between recorded boundaries. Analytic visibility intervals retain brief observations as moving sensors enter or leave range. Older readers reject the new schema instead of showing frozen bases.

## Verification and limits

Regression scenarios cover movement with split polling; seam-crossing arrivals; moving departure preparation; launch edits; speed changes; redirection; interception and return; mine conversion and wrecks; envoy range entry; hidden garrison redaction; save/history reconstruction; replay round trips, arbitrary-time seeking, and sensor visibility transitions. The server scenario covers setup immutability, idempotent launch, capture, forecast agreement, historical inspection, and restart.

An isolated browser preview of the real chart and setup components verified the smaller asteroid markers, projected courses, and movement from hour 0 to hour 24. Review captures are under `.fettle/shots/drifting-bases-hour-*.png`. At the initial variant checkpoint, full application web export was blocked by Expo audio resolving `expo-asset` 58 against Expo 55 (`expo/internal/bundle-origin` was missing), tracked separately in [#34](https://github.com/mcclowes/machination/issues/34). That obstruction has been cleared in the current tree. Physical-device interaction and multiplayer balance over full drifting matches remain unverified.

The October 29 default correction restores the issue's opt-in requirement. Before the fix, the real HTTP default-creation scenario returned mechanics revision 6 instead of stationary revision 5. Afterward, fresh default rooms are stationary, explicit drifting creation still produces two moving sites per player, and an existing drifting room retains its state across restart and a creation retry without options. A real React setup harness verifies the unchecked initial checkbox, opt-in, preservation through player-count/mode edits, opt-out, and unchanged defaults for subsequent setups. All 596 repository tests, TypeScript, and web export pass.

The exported app also passes a rendered Chrome check on a fresh local origin: a new solo operation's replacement settings show the unchecked drift option, clicking it shows the checked option, and Keep operation dismisses the draft without replacing the operation. Evidence: `.fettle/shots/stationary-default-web.png` and `drift-explicit-opt-in-web.png`. Existing browser sessions on other origins were preserved. The corrected initial checkbox still needs native-phone acceptance.

Tracked in [#32](https://github.com/mcclowes/machination/issues/32).
