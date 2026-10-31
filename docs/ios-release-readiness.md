# Multiplayer iOS release readiness

Tracking: [release goal #124](https://github.com/mcclowes/machination/issues/124). Updated October 31, 2026.

The immediate target is a polished, invite-only multiplayer TestFlight release. Public App Store distribution adds the gates below. “AAA” means a consistent quality bar across play, presentation, reliability, and support; it isn't evidence of readiness or a reason to add more mechanics.

## Current baseline

The game has versioned deterministic rules, an authoritative multiplayer service, sensor-limited observations, retry-safe commands, private diplomacy, recovery codes, optional Clerk integration, opt-in notification workflows, solo rivals, practice missions, audio, and original artwork. Internal TestFlight build [0.1.0 (3)](native-builds.md#build-3-october-31) is distributed with the HTTP and client-recovery fixes below, recorded in [#122](https://github.com/mcclowes/machination/issues/122). Physical-device acceptance remains open. See [native evidence](native-builds.md) for exact artifacts and verification boundaries.

Code, a passing host test, a simulator session, a signed IPA, and a successful physical-device playtest prove different things. Record the source commit, runtime/device, command or scenario, result, and evidence for each gate. Earlier passing suites don't certify the current source.

## Client recovery

The root React boundary contains descendant render and lifecycle errors, including account-provider rendering, and offers a safe-area-aware retry screen. Retry remounts the application without clearing saves, seat credentials, or notification settings. It makes no persistence or network writes itself. Unsaved input can be lost when the failed screen unmounts. A persistent failure leaves retry available rather than automatically looping or resetting progress.

Four host tests exercise the actual entry-point wiring with synthetic descendants: healthy rendering, a failed operation, account initialization, repeated failure, effect cleanup, and successful retry. Browser fixture checks cover 320-, 390-, and 1024-pixel viewports with a 48-pixel retry target and no horizontal overflow. These checks don't prove native layout, VoiceOver behavior, or physical-device recovery. The boundary logs a component stack locally and doesn't provide remote crash reporting.

[React error boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary) don't catch native process crashes, module-load failures, ordinary event-handler errors, or arbitrary asynchronous callbacks. Existing expected command, storage, and network failures retain their own handling. Track this containment and its verification in [#126](https://github.com/mcclowes/machination/issues/126).

## Delivery order and gates

| Priority | Player outcome | Release gate | Current gap / owner |
| --- | --- | --- | --- |
| 1 | Operations and identities survive failures | Import existing state without changing recorded rules; concurrent commands remain atomic; backup and restore preserve seats, histories, and retries; damaged state doesn't silently reset progress | [Supabase migration](postgres-deployment.md) verified TLS, preserved original operations, and passed synthetic command/retry/privacy checks across restart. Daily backup was observed; paid PITR was declined. Provider-managed isolated cloud restore and cross-region performance remain unverified ([persistence #111](https://github.com/mcclowes/machination/issues/111)). |
| 1 | A full operation can stay connected | Separate client budgets behind HTTPS ingress; abuse cannot throttle health checks; unchanged command IDs survive rate limits and uncertain responses | [HTTP limits #125](https://github.com/mcclowes/machination/issues/125). [Fresh topology audit and bounded verification](railway-ingress.md) are available; production still uses direct mode, and live client separation requires a second network. |
| 1 | Players can return after changing devices | Production native sign-in, sign-out, seat linking/restoration, expired sessions, and recovery tested against the release service without exposing another seat | [Accounts #37](https://github.com/mcclowes/machination/issues/37). Production native configuration and device evidence are incomplete. |
| 1 | Players receive timely, private alerts | Real APNs/Expo delivery while backgrounded and terminated; permission denial, rotation, withdrawal, retries, and taps respect current seat and consent | [Notifications #74](https://github.com/mcclowes/machination/issues/74), [incoming attacks #80](https://github.com/mcclowes/machination/issues/80). Provider/device delivery remains unverified. |
| 2 | First-time players understand and control the game | Complete onboarding and first reinforcement without assistance; select crowded assets, edit/cancel orders, inspect forecasts, and understand failures on a phone | Existing practice and UI work provides the foundation. Record observed usability issues before adding features. |
| 2 | Presentation feels deliberate on every supported screen | No obscured controls or clipped copy on small/large iPhones and iPad, keyboard, largest supported text, VoiceOver, and reduced motion; readable assets, feedback, audio, and foreground/background behavior | Simulator evidence covers selected iPhone flows. Physical devices, iPad, and a complete accessibility matrix remain open. |
| 2 | The game remains responsive during real play | Measure map interaction, forecast/history, memory, and battery on baseline devices; test a full ten-seat operation and retained history under declared load | [Ten-seat SQL functional acceptance](service-capacity.md#ten-seat-sql-acceptance-october-31) passes for mixed released/current clients and current gravity rules, including a lost response and restart. Hosted capacity, long histories, device responsiveness, and budgets still need measured baselines. |
| 3 | A release can be reproduced and recovered | Full current-source gate, native build, signed immutable IPA, staged backend compatibility, healthy deployment, backup, restore, and rollback evidence tied to commits | [Release #122](https://github.com/mcclowes/machination/issues/122), [testing](testing.md), and [native builds](native-builds.md). Keep release work independent of concurrent edits. |

Don't change old mechanics revisions to achieve these gates. Keep speculative mechanics outside the release path. Persisted rules and wire compatibility take precedence over adding features.

## Multiplayer acceptance session

Use a disposable operation against the intended release endpoint, with at least two physical iOS devices and a third independent client for privacy checks. Also fill all ten seats with independent clients for capacity checks. Synthetic clients supplement physical devices.

1. Install the signed build, complete the briefing, create/join by invitation, and start only when the lobby is full. Confirm the same options and start state on each seat.
2. Launch, edit, cancel, and schedule orders. Disconnect after submitting a command but before seeing its response, then reconnect and retry. Confirm one accepted effect and the same command receipt after service restart.
3. Background, terminate, relaunch, switch Wi-Fi/mobile networks, and use airplane mode. Confirm accurate live catch-up, clear stale/reconnecting feedback, persisted private plans, and no duplicate actions.
4. Send private and group messages. Verify that the excluded client cannot read them or hidden assets through snapshots, histories, forecasts, replay exports, notifications, or guessed references.
5. Restore a seat on a second device, verify old credentials lose access, and check that drafts/notification taps cannot cross seat boundaries. Test account expiry and sign-out separately from offline recovery.
6. Verify real opt-in notification receipt and safe navigation with the app backgrounded and terminated. Test denied permission and withdrawn consent. A provider ticket alone isn't delivery evidence.
7. Restart and replace the service; restore an operational backup in an isolated environment. Confirm the expected recovery point and preserved operation, credentials, and retry history.
8. Finish a complete game, including elimination, simultaneous terminal outcomes, and reconnect after completion. Check results and replay consistency under the recorded mechanics revision.

## Additional public-launch gates

Before opening public access, ship and test in-app account deletion where accounts are created, privacy/support information, accurate store privacy declarations, and reporting/blocking/moderation for player messaging. Apple's [account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/) and [review guidelines](https://developer.apple.com/app-store/review/guidelines/) define the relevant store requirements. Establish incident monitoring, support ownership, recovery objectives, measured capacity limits, and a staged rollout. Review the current Apple requirements when preparing the submission; this document doesn't replace that review.

[Operation-scoped message blocking](message-blocking.md) adds private seat preferences, server filtering, direct/group contact restrictions, and message-alert cancellation without hiding tactical activity. It requires a later client artifact than the prepared build 3. Blocking alone doesn't close the public messaging gate.

[Message reporting and operator review](message-reporting.md) adds private canonical evidence, durable acknowledgements, and separately authenticated operator dispositions. Collection is disabled by default. Its client controls require a later native artifact than build 3; production operator access, actual handling, native acceptance, and retention/deletion policy remain unverified. Neither stored flags nor a host/browser pass proves the full public messaging gate.

These remain release requirements, not claims that the current implementation or store metadata satisfies them. Paid service changes, public distribution, and production configuration should be tied to a concrete tested release.
