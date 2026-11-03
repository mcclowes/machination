# Current chart acceptance

Tracking: [chart acceptance #180](https://github.com/mcclowes/machination/issues/180), [short layouts #146](https://github.com/mcclowes/machination/issues/146), and [release goal #124](https://github.com/mcclowes/machination/issues/124).

The November 1, 2026 checkpoint starts from `1b005e7`, including the committed compact operation chrome, map panning/zooming, planned-route origin, and observed gravity work. Removing the outer header left 375- and 390-pixel-high windows above the old 360-pixel compact cutoff. Their time tray stayed open alongside Signals, leaving only 74 pixels visible in a 90-pixel composer even after scrolling. The shell now uses compact drawers below 400 pixels of available height. The existing time tray stays mounted, so closing a drawer restores its draft and controls.

The landscape acceptance keeps every visibility, draft, privacy, and accepted-launch assertion. It centers controls before measuring clearance, avoiding fractional nearest-edge scrolling that left 1.2 pixels clipped after tablet-to-phone rotation. After entering destination selection, it uses the normal Fit chart control and waits for measured chart layout before choosing Suture; the planning hint otherwise covers that destination after portrait resizing. No click is forced and no private game state determines the selected control.

Four operation screenshot references are visually reviewed and updated for the already committed compact chrome and resulting chart extent. Screenshot tolerance, fixed time/seed, and functional assertions are unchanged. Start-screen references are unchanged.

## Retained verification

Node 24.14.1; all 37 top-level installed dependency versions match the lockfile.

- All 94 desktop/phone browser cases pass, including ten landscape flows, route dragging, gravity course/headings, time travel, restored framing, private messaging, reporting/blocking, practice, and packed/legacy file-picker import with offline playback.
- The five landscape sizes are 844×390, 667×375, 568×320, 320×568, and 1024×768 in both browser projects. The flows rotate through phone portrait, preserve private drafts and time entry, transmit exactly once to the intended recipient, exclude another seat, and launch twelve drones after resizing the manifest.
- `npm run check` passes quality, architecture, TypeScript, 1,712 behavior tests, and 13 server-build tests. Seven behavior and seven server-build SQL/TLS cases are explicitly skipped because this run has no database fixtures. No current database acceptance follows from these skips.
- Before/after hashes match for all 788 browser inputs and 661 runtime/check inputs. These manifests describe the tested code before acceptance notes were added. The only runtime change is the compact-height cutoff. The shared checkout's unowned `supabase/` directory is untouched.

Evidence is retained under `.data/acceptance/issue-180/`, ignored by Git, with process ownership, bounded child results, source manifests, dependency audit, original/current baseline hashes, logs, and selected captures. The browser process has a 15-minute limit; the full gate has a 34-minute outer limit and the existing 30-minute behavior-suite limit. Both complete without expiry. The 25-file inventory SHA-256 is `e4bf4493b8fba4f921a08fe3c80c06f4f116599d471b830ce5fe709ccfda8ce6`.

Earlier temporary diagnostic directories and their running processes disappeared before final results could be recovered. The retained run above is the current acceptance evidence. An earlier full-suite run reported a natural ten-seat replay-test failure; one fresh captured reproduction and the retained full-gate run pass. Its error and original state were not retained, so its cause remains unexplained and is recorded separately under the replay work. This is not claimed as fixed by the layout change.

These are browser and host-test checks, not native keyboard/Dynamic Type/VoiceOver, physical-device, frame-time, battery, hosted-capacity, deployment, account-provider, push, or whole-release acceptance. Native candidates must include the new cutoff before publication; no upload, push, or deployment occurred.
