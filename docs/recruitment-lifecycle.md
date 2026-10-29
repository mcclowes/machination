# Recruitment lifecycle gap

Issue #18 remains open for undoable recruitment and promotion. The current engine applies a hire or promotion immediately when its command executes. It has no pending recruitment record, cancellation deadline, or finalization command. A queued future hire is an execution schedule with stable unit identities, rather than an undoable transaction. This gap prevents a full fidelity claim.

## What the reference establishes

The [official rulebook](https://subterfuge-game.com/rulebook/) establishes recruitment credits, hiring at the Queen's outpost, and promotion using a hiring opportunity. It doesn't specify a recruitment cancellation period, offer restoration, or finalization. Its ten-minute launch and gift windows don't establish recruitment timing.

The [official Time Machine tutorial](https://vimeo.com/114210812), published in 2014 and linked from the [official tutorial page](https://subterfuge-game.com/rulebook/Videos.html), provides stronger UI evidence. At 02:10, a future Infiltrator hire has Cancel Hire and Finalize Hire controls, an in-progress status, and a countdown. At 02:15, that specialist can be selected in a future zero-drone launch manifest. Captured frames are recorded in [queued launch editing](queued-launch-editing.md).

Those frames prove historical controls and future manifest selection. They don't prove when abilities activate, when the unit can physically depart, how cancellation refunds credits and restores offers, or whether early finalization executes a future hire immediately. The countdown in one frame isn't an exact duration specification. Promotion needs its own evidence. Historical community claims of a ten-minute period are useful leads, not confirmed current rules.

The public `play.subterfuge-game.com` entry returned an HTML redirect to the main website on October 28, 2026. It didn't provide a playable web client for these probes. Current original-client interaction remains unverified.

A fresh primary-frame review reads “Tap again to cancel hire (11m left)” at 02:10, while the forecast cursor is about +4.4h and the queued hire is labeled +4.5h. The remaining-time hint therefore cannot simply be the live-time interval until that future command. Neither the rounded labels nor the still frame establishes an exact cancellation clock, activation law, refund, or finalization action. The community Specialist 2 puzzle transcription specifically mentions permanence after ten minutes, but its original screenshot wasn't retrieved and that transcription alone isn't current-client acceptance. The [publisher's Steam page](https://store.steampowered.com/app/4831650/Subterfuge/?l=english) now offers a Mac demo; direct current-client investigation remains the next evidence route.

## Additional publisher evidence, October 29

The [v42.1 notes](https://www.secretplan.com/subterfuge-news/rules-v42-1.html) place War Hero in the Offensive recruitment deck. This directly supports category decks, which the rebuild already uses. It does not establish copy counts, how unchosen offers advance, cancellation restoration, or next-offer generation.

The [v42.2 notes](https://www.secretplan.com/subterfuge-news/rules-v42-2.html) explain that the original Navigator cancellation period ended at the next tick, leaving between one second and ten minutes. They replace that behavior with a course change that takes effect ten minutes after submission. That account is specifically about Navigator orders. Applying the old tick rule to hiring remains a hypothesis; it does not resolve the historical hire countdown or justify implementing a guessed cancellation clock.

The publisher-linked [Tutorial 2: Combat and specialists](https://vimeo.com/111760398) is another primary footage source, uploaded November 13, 2014. A partial visual review in Chrome now works despite the scripted-fetch block. The confirmed 04:08 frame shows a contextual Combat report, tracked in [#71](https://github.com/mcclowes/machination/issues/71), but the sampled frames do not resolve hiring or cancellation. The full recruitment sequence remains unreviewed; this is not evidence that those controls are absent. Its alpha-era behavior still needs comparison with current rules.

## Mobile gallery and historical FAQ follow-up

The publisher's [Google Play gallery](https://play.google.com/store/apps/details?id=com.snappytouch.subterfuge), image 7 in the October 29 capture, shows a Queen card with one unused hire and separate three-icon rows labeled Current hire options and Next hire options. The [Apple gallery](https://apps.apple.com/us/app/subterfuge/id702951905) also shows a next-hire row. This directly establishes a published preview approach. Machination exposes only current offers and the next credit time, so the missing preview is an implementation gap. Whether the displayed set changes after a choice, promotion, cancellation, or credit accumulation remains unverified; the images do not specify generation or depletion. Showing a hypothetical draw as a known future offer would be misleading.

A [June 2016 community FAQ](https://herbertzhb.wordpress.com/2016/06/28/subterfuge-2/) corroborates a current/next display, describes visible launches and hires during a confirmation period, and reports an unsupported future-promotion finalization action. These are historical secondary leads. Visibility does not establish ability activation, and an unsupported action does not establish absence of its control. The rulebook's silence about undo does not contradict these leads or prove immediate permanence. The original forum discussion about future-hire finalization remains inaccessible.

The gallery sweep reviewed five iPhone images, five iPad variants, and ten Google Play images. Local images and URL manifests are `/tmp/machination-mobile-reference/{apple-images,google-images}.json`; the explicit Queen preview is `google-7-large.png`. No reviewed gallery image establishes cancellation refunds, the deadline clock, or finalization behavior. The corrected source trace is `/tmp/machination-faq-trace/FINDINGS.md`.

## Behavior to resolve before implementation

| Question | Required observation |
| --- | --- |
| Deadline | Compare present time, submission time, future execution time, countdown, exact expiry, and reopening after expiry. |
| Activation | Measure a passive, local effect, timed ability, and speed change before execution, during cancellation rights, and after finalization. |
| Compensation | Compare credits, all offers, next cycle, multi-unit hires, and later consumed cycles before and after canceling. |
| Dependencies | Cancel a hire while its recruit is aboard a preparing launch with unrelated passengers, then repeat after departure, capture, gift, and death where permitted. |
| Early future finalize | Return to live time after finalizing a future hire; inspect unit presence, queue, credits, location, and cancellation rights. |
| Promotion | Verify separate cancel/finalize controls, target location restrictions, old/new ability timing, and clock restoration. |

## Implementation constraints

Separate submission, execution, cancellation rights, and finalization. Persist authoritative transaction identity and deadlines; don't infer them from the forecast cursor or UI timers. Treat cancellation as a new replay command, preserving the original history entry. Preserve existing queued hire IDs and command retry semantics.

Restore only the affected recruitment cycle and unit changes. Rolling back an entire Game would erase unrelated production, movement, and combat. Decrementing `used` and resetting the RNG seed can corrupt later recruitment cycles. Canceling one recruit must never delete a whole hauler containing the Queen and other passengers.

Any changed authoritative behavior needs a compatibility policy for old immediate-hire saves and replay fixtures. Integrate deadlines with `advance`, offline restoration, forecasting, history, strict save validation, authenticated commands, private projections, and duplicate-request receipts. Once reference timing is established, test equality with launch/capture/expiry, large versus split advancement, saved intermediate states, repeated cancellation/finalization, and foreign or stale identities.

The design constraints are ready. Behavioral implementation remains pending the observations above; no guessed activation delay or undo rule has been introduced.
