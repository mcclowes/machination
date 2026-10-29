# Specialist markers on the chart

Tracking: [#72](https://github.com/mcclowes/machination/issues/72), under the [fidelity goal](https://github.com/mcclowes/machination/issues/18).

The publisher-linked [Combat and specialists tutorial](https://vimeo.com/111760398) shows specialist insignia beside outposts and traveling subs. The [official visibility rules](https://subterfuge-game.com/rulebook/) also establish that observable outposts and subs expose their specialists. These support the map information and inspection approach; they do not prescribe Machination's artwork or exact layout.

## Behavior

Observed outposts and haulers now show compact specialist badges. A specialist-only hauler retains its zero-drone counter and crew marker. Both the asset and the floating badge row open the existing site or hauler inspection without changing time or issuing a command. The same chart serves local play, online observations, forecasts, history, and shared replay scenes.

Groups distinguish specialist kind, owner, and captive status. Matching units share a badge with a count. Owner colors follow the current portrait roster. Captives use a dashed border, muted artwork, and a lock. Queen groups lead, followed by stable catalog/owner ordering, so arrival order does not reshuffle the display.

At most three groups display, followed by an overflow badge counting additional units. Individual counts and overflow above 99 display `99+`; accessible descriptions and inspection retain the exact manifest. Unknown or destroyed sites produce neither badges nor specialist identities in their chart labels. No extra authoritative state or unit IDs enter the marker summary.

## Placement and interaction

Badge rows prefer the space above the asset and fall below when necessary. The layout reserves their full padded touch bounds, not just the drawn circles, and avoids neighboring controls, shield/body footprints, variable-width drone counts, and other crew targets. Site names avoid the drawn rows. Inspected assets receive priority, then existing ownership priorities and stable keys.

A crowded row is omitted when neither side fits; the asset's complete accessible description and inspection remain available. Rows do not move onto an unrelated asset merely to fit. Horizontal and vertical bounds preserve the full touch target inside the chart. Preparing haulers clear their source's shield arcs.

An open hauler inspector reserves additional chart height for specialists and their touch targets. Marker placement uses the uncovered chart band, while camera reveal retains its existing measured-card behavior. Large type and physical-device behavior remain unverified.

## Verification and limits

Source `7e63341` passes 869/869 checks, 39 focused checks, TypeScript, and web export from its exact source archive. Targeted checks cover grouping, captives, overflow, hidden sites, zero-drone transport, direct badge selection, deterministic priorities, neighboring touch/count bounds, chart edges, inspector clearance, and shared replay inspection/locality. The independent review reproduced three geometry/text defects in the initial version and verified their fixes. See `/tmp/machination-map-specialists/REVIEW.md` for the bounded review.

The signed QA artifact is packaged and installed, with a fresh Release Hermes bundle and the unchanged native binary from `a45505b`. It has not been opened or visually accepted: the computer-use tool returned `cgWindowNotFound` for both Device Hub and Chrome. The target simulator remains booted, but no supported app-launch fallback is exposed. Successful tests, export, signing, and installation do not establish rendered or native acceptance. [Native build notes](native-builds.md#specialist-marker-build) record the artifact.

The existing artwork maps 29 specialist kinds to 17 atlas cells. Some roles therefore share a symbol even though their full names remain available. Distinct, legible role insignia are tracked in [#73](https://github.com/mcclowes/machination/issues/73). Marker association, small-size readability, touch/drag behavior, current-original-client comparison, and physical devices still need visual/native checks. #72 and the fidelity goal remain open.
