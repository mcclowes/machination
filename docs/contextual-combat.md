# Contextual combat predictions

Tracking: [#71](https://github.com/mcclowes/machination/issues/71), under the [fidelity goal](https://github.com/mcclowes/machination/issues/18).

## Reference

The publisher-linked [Tutorial 2: Combat and specialists](https://vimeo.com/111760398), uploaded November 13, 2014, shows a selected SUB and contextual Combat action at 04:08. The report compares six attacking drillers with 46 defending drillers plus three shields, predicts 43 defending survivors, and qualifies its result by current knowledge. Confirmed frame: `.fettle/shots/subterfuge-tutorial2-04m08s-combat-report.png`.

This establishes a historical UI approach. It does not establish current-client calculations, whether every future production cycle is included, or recruitment cancellation semantics. Partial sampling of the tutorial does not establish that unobserved controls are absent. The older file labeled 04:38 was a stale frame after seeking and is not report evidence.

## Rebuild behavior

An inspected hauler has a Combat action in local and online operations. Opening it shows the prediction and outcome near the top of the bounded, scrollable hauler card, preserving chart space. Closing Combat retains the hauler inspection. Normal clock updates refresh the open prediction instead of dismissing it.

The prediction includes observed route contacts and interceptions before the hauler docks or disappears. It also includes combat that absorbs the inspected preparing launch into its departure site's defence. Each encounter displays the relevant forces, specialist priorities, global damage, shields, repair, captures, and survivors. Friendly arrivals produce no combat report; unknown destinations and lost interception targets remain unknown.

The label distinguishes the observation time from an inspected future time. A historical observation predicts from what was known then; it is not a recording of the actual historical outcome. Shared public replay prediction is outside this implementation.

## Calculation and privacy

`simulationFromObservation` builds the same redacted simulation for the time machine and combat inspector. It retains opaque hauler identities, private own schedules, public ownership, and explicit unknown destination/interception placeholders. No authoritative Game reaches the report calculator.

`advance` accepts an optional encounter sink. The existing arrival, route, and interception resolvers capture snapshots around their actual mutations. Specialist steps follow the catalog priority resolver table; the report does not implement another combat calculator. Sink-free advancement retains the existing state and serialized outcomes, with no save or mechanics revision change.

Production, recharge, earlier encounters, and known scheduled orders settle through the real engine before the inspected battle. Only specialists present in the observation contribute global effects. Rival future orders and recruitment are not invented. Unobserved territory remains a conditional limitation, including global bonuses, leadership, and victory. The UI states these limits.

Predictions stop when the inspected hauler disappears, the operation ends, or seven days elapse. A surviving interception rig's report records the immediate combat result before its caller orders its return; it is not a complete route-change history. Reports contain immutable asset snapshots rather than references to live game objects.

## Acceptance

The configured revision-12 and revision-13 specialist sweeps cover 14 kinds in both dispatch orders: 784 encounters preserve advanced game JSON with and without the sink, and report survivors match engine state. Other engine checks cover preparing defenders, shields, ties, ability termination, suppression, global damage, gifts, interception, and route-before-arrival ordering.

Observation checks cover the six-versus-49 example, hidden global specialists and rival schedules, unknown destinations and interceptions, opaque IDs, earlier route losses, production/recharge, and a preparing launch absorbed into defence. The preparing-defender regression failed with zero reports before its filter fix. A component check exercises opening, observation changes, and closing.

Native source `686050c` opens the report with its predicted 12-survivor outcome and force breakdown visible immediately in the shield exercise. Closing the report and hauler restores the chart, and resolving the encounter produces the predicted 12 drones at 00:50. Artifact hashes and interaction limits are recorded in [native builds](native-builds.md#contextual-combat-prediction).

Long-report scrolling, native online/historical report interactions, physical devices, and current-original-client comparison remain unverified. Device Hub coordinate drag and scroll calls returned `noWindowsAvailable` while accessibility actions and screenshots continued to work. That tool failure does not establish a game scrolling defect. #71 remains open for the outstanding native acceptance.
