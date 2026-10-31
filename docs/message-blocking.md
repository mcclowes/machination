# Operation-scoped message blocking

Tracking: [#138](https://github.com/mcclowes/machination/issues/138), part of [release goal #124](https://github.com/mcclowes/machination/issues/124).

Signals → Message blocking lets a joined seat block or unblock another joined player in that operation. The UI shows confirmed server choices and does not claim success after an uncertain response. Blocks belong to the seat, so they survive reconnection, service restart, account linking, and recovery-code credential replacement. They do not follow a person into another operation or constitute a service-wide sanction.

## Delivery policy

- The server filters retained bilateral, private group, and public messages from blocked senders out of the blocker's snapshots. Current clients also hide already-rendered messages once the server confirms a block. Canonical history remains stored and visible to other authorized recipients. Unblocking lets retained messages appear again on refresh; it does not recover messages evicted by normal retention.
- Neither participant can send a new bilateral message while either has blocked the other. A blocked player cannot create a new private group containing the blocker, and a blocker cannot create a group with a blocked player. Existing groups retain their fixed membership. Another participant can still create a shared group; the block continues filtering messages from the blocked sender.
- Previously accepted command retries remain accepted without creating another group or message. A new blocked direct message returns `409 message.conflict.blocked`; a refused group returns `409 group.conflict.blocked`. Responses do not return another seat's private preferences.
- New blocked-sender message alerts are not queued. Adding a block clears the blocker's outstanding generic message jobs across that seat's devices. Existing jobs coalesce multiple messages without retaining a sender, so this can also clear an allowed sender's pending generic alert. It does not revoke notification consent or cancel incoming attack alerts. Already handed-off or delivered notifications cannot be recalled.
- Game activity, attacks, observations, group membership and names, player names, and recorded mechanics remain unchanged. Shared replays and game history do not include chat. This is a communication preference, not concealment of another player's tactical activity.

## API and persistence

Both endpoints use the operation's existing Bearer seat credential or the account credential controlling that seat. They accept no query parameters and expose only the authenticated seat's preferences. They remain accessible when a client's game decoder cannot open the recorded mechanics revision.

```text
GET /v1/games/:id/message-blocks
POST /v1/games/:id/message-blocks
```

GET returns `{ gameId, faction, revision, blocked }`. `blocked` contains joined player IDs, excluding the caller. POST takes exactly `{ requestId, revision, player, blocked }`, where `blocked` is a boolean, and returns the current settings. Request IDs contain 16–80 ASCII letters, digits, or hyphens. Revisions are independent of game orders and notification preferences. Malformed input returns `400`; an unknown seat credential returns `401`.

Each new accepted request checks the current revision, increments it once, and durably records its exact body. Retrying one of the last 32 accepted request IDs returns the current view without reapplying an older choice; changed content returns `409 command.conflict.reused_id`. A different request with an old revision returns `409 message_block.conflict.stale`, including after an old receipt is evicted. Concurrent updates at one revision cannot both succeed. The client reloads stale settings for review rather than silently applying the old intent again.

Preferences and bounded receipts live in optional server-only seat metadata, with no new snapshot fields. Older rooms have no blocks by default. Startup validates stored preferences and refuses or quarantines damaged rooms rather than dropping a block. A preference update neither settles game time, renews activity, changes game-order revisions, nor enters replay. The existing storage transaction commits the preference and job cancellation together; a failed write publishes neither.

Deploy the supporting server before a client that offers these controls. Earlier server binaries do not enforce this policy and must not be used as a rollback once players rely on it. The immutable build 3 artifact prepared from `2702155` predates this feature; a later client artifact is required for the UI. Older servers return an unavailable state in the new UI rather than a false successful block.

## Verification and remaining release work

Behavior coverage uses the real HTTP adapter, service, persistence, released build 2 decoder, current transport, React hook, and App/Diplomacy wiring. It covers scope privacy, retained history, direct/group refusals, independent revisions, retries, receipt eviction, concurrent updates, failed writes, restart/recovery, corrupt state, stale asynchronous completions, unavailable servers, SQL adapter restart, generic alert cancellation, and preserved incoming attacks.

Browser acceptance runs a disposable local service at 320- and 1024-pixel viewport widths, verifies actual block/unblock effects, checks 44-pixel controls and horizontal overflow, and saves `.fettle/shots/message-blocks-*-mobile.png`. These are browser layout checks, not native Dynamic Type, VoiceOver, physical-device, or production-delivery evidence.

This feature does not close public messaging readiness. Reporting and retained evidence, operator review and timely responses, service-wide enforcement, objectionable-content filtering, published contact information, and native acceptance remain open. Apple's current [user-generated content guidance](https://developer.apple.com/app-store/review/guidelines/#user-generated-content) requires broader safeguards; this implementation is not a claim of App Review approval.
