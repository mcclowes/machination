# Group diplomacy contract

Implements the server portion of #18. Keep #18 open for funding and UI integration.

## UI integration

`Snapshot.messages` remains the existing bilateral history, with its existing numeric seat-scoped IDs. Never combine it with public messages when rendering private threads.

New optional fields preserve compatibility with older snapshots and servers:

- `groups?: Group[]`: only private groups containing the caller. Each has `id`, `name`, fixed `members`, `createdBy`, and `createdAt`.
- `channels?: Channel[]`: public channel `{ id: 'public', kind: 'public', messages }`, followed by the caller's private channels `{ id: group.id, kind: 'private', messages }`. Message IDs are opaque strings. Each message has `id`, `from`, `text`, and `sentAt` (server milliseconds).

Use `groups ?? []` and `channels ?? []` when accepting old snapshots. The public channel includes room seats who join later; it is deliberately room-wide. Private membership is immutable. There are no membership editing, invite, leave, rename, list-all, or separate history endpoints. A different membership requires creating a different group, with empty history.

All commands return the caller's complete filtered `Snapshot` and require the existing Bearer seat token:

| Endpoint | Body | Client helper |
| --- | --- | --- |
| `POST /v1/games/:id/groups` | `CreateGroup: { requestId, name, members }` | `createGroup(session, body)` |
| `POST /v1/games/:id/channel-messages` | `ChannelTransmission: { requestId, channelId, text }` | `sendChannelMessage(session, body)` |

The caller must explicitly appear in `members`, alongside at least one other joined seat. Duplicate and unknown members are rejected. Membership ordering is canonicalized, so reordered retries are equivalent. Duplicate names are allowed; identify groups by ID. `DIPLOMACY_LIMITS` exports 60 characters for names, 1,000 for messages, 16 private groups per participant, and 100 retained messages per channel. String limits count JavaScript UTF-16 code units before trimming; whitespace-only input is rejected. There are at most three seats today.

`Pending` adds `groups` and `channel-messages` variants. The parent UI must store pending commands before sending and replay the exact body/request ID after uncertain responses, using the existing recovery pattern. Helpers send commands; they don't manage pending storage. Creation retries return the current filtered snapshot rather than a special created-group result, so diff group IDs against the previous snapshot if selection is needed. Unchanged accepted request IDs never create duplicate groups or messages, including after restart or credential recovery. Reusing a request ID for different content returns the existing `command.conflict.reused_id` failure. Receipt comparison preserves original name/text whitespace, so retries must preserve the exact body.

## Privacy, persistence, and bounds

Authorization runs on the server before any snapshot is returned. Nonmembers see neither private group metadata nor history. Unknown and inaccessible channel IDs both return `404 channel.not_found`; invalid seat tokens return `401`. Public messages have their own storage and never enter bilateral or private histories. Membership is checked against seats, not surviving assets, so eliminated seats can create groups and send public, group, and bilateral messages. Chat is available in lobbies and finished games too.

Group and channel-message IDs are random 128-bit hex values, with no counters exposing unrelated activity. Existing bilateral IDs retain their prior HMAC mapping. Recovery preserves group membership and IDs because membership belongs to the faction seat.

Each private channel and the public channel keeps its own last 100 messages. Traffic in another channel cannot evict that history. Every group's membership counts against each participant's 16-group cap; creation refuses once any selected participant is full, without evicting old groups. This bounds each participant to 1,700 retained channel messages across their private groups and public channel. An existing member can fill a shared channel or consume another participant's remaining group slots; there is no invitation acceptance or moderation policy in this first contract. Legacy bilateral retention remains unchanged (5,000 messages per room).

Commands share the existing durable receipt budget of 10,000 accepted commands per room. Exhaustion rejects further commands rather than discarding history or receipts. No promise of unlimited chatting is made. Failed validation, authorization, capacity checks, or durable writes commit no IDs, receipts, or history. Atomic database replacement publishes cloned state only after the durable write succeeds. Retried messages already evicted by retention aren't resurrected.

Database version 1 remains readable: missing diplomacy metadata initializes empty groups and public history while preserving old messages, seats, and receipts. New diplomacy metadata is validated when opening the database. Older server binaries must not be used to write these updated rooms, because they don't understand this contract.

## Research and interpretation limits

Consulted the [official Subterfuge site](https://play.subterfuge-game.com/) on October 28, 2026. It describes real-time diplomacy and coordination as part of play and links tutorials and a rulebook. A targeted search of the official domain did not produce a primary specification for group-chat creation, fixed membership, or retention. The site establishes the broad diplomacy context, not these exact group semantics.

Named private groups and a public room channel follow the requested scope. Fixed membership, quotas, retention, and retry behavior are implementation choices for privacy and bounded storage, not claims about original Subterfuge mechanics. This adds no enforced alliances, shared sonar, ownership changes, or gameplay effects. UI integration remains parent-owned.

## Verification

`node --import tsx --test server/*.test.ts src/online/*.test.ts` passed all 23 tests, including five new diplomacy scenarios covering HTTP authorization, member filtering, public separation, idempotency and reused IDs, recovery, restart, old-room migration, failed durable writes, eliminated-seat chat, participant caps, and independent retention. HTTP tests require permission to bind localhost in the sandbox.

`npm run typecheck` passed after concurrent parent-owned funding model changes landed. The initial run reported funding errors; those files were left untouched.
