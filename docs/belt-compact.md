# The Belt compact

Implements the daily council direction in #39. The compact is an opt-in multiplayer rule set, selected before joining; it is enabled in the multiplayer creation UI and the service's default setup. Existing operations, explicit setups that omit the option, solo play, and tactical practice retain their rules.

## Fiction and authority

The corporations established the Belt compact after industrial catastrophes and territorial disputes. Their uplinks are now too distant for timely arbitration. Each local intelligence holds a council seat and a delegated authorization key. Navigation, fabrication, surveillance, and weapons systems enforce the inherited permissions.

The charter starts with six conventions in force:

| Convention | Reason | Effect of a council waiver |
| --- | --- | --- |
| Transit safety limits | High-thrust traffic caused a debris cascade. | New missions receive 50% more speed; ordinary specialist routing bonuses remain. |
| Replication moratorium | Runaway fabrication consumed a mining concession. | Factory output rises 50%, rounded down, within existing capacity. |
| Sensor sovereignty | A corporate settlement limits surveillance power. | Station sensor range rises 50% for everyone. This deliberately authorizes new observations. |
| Protected infrastructure | Installations remain corporate property during local conflicts. | Authorized self-destruct blasts can destroy installations, rather than only their garrisons and nearby haulers. |
| Strategic weapons prohibition | The Vesta incident left a permanent exclusion zone. | Self-destruct specialists can be recruited, promoted, and detonated. Existing units remain dormant when permission expires. King pulses are outside this convention. |
| Salvage protection | Corporate title to wreckage survives combat. | A surviving combat winner recovers 25% of opposing drones lost in direct drone combat, rounded down. Converted drones and damage before direct combat are excluded. Engineers retain ordinary repair abilities. Mutual destruction and self-destruct blasts yield no salvage. |

These are game conventions, not real-world orbital physics. There is no extra fuel, attrition, active-scan order, persistent wreckage field, or general demolition command in this version. The existing mechanics provide the policy effects above.

## Daily council

- A public, immutable motion opens at operation start and closes 24 real simulation hours later. Opening acceleration does not accelerate the council. The first motion concerns high-thrust transit.
- One ballot runs at a time. Each active seat can queue or replace one nomination for a later day, or withdraw it. Nominations are public.
- Agenda priority rotates through the configured seat order each day, skipping eliminated seats. The first queued proposal in that order is selected. Without a nomination, the charter supplies the next convention in a six-day rotation, so there is still a daily decision.
- The opening electorate is fixed. Each eligible active seat can vote yes, no, or abstain and change its position until closing. Abstention differs from absence. Passing requires more than half of the opening electorate to vote yes; ties and missing majorities fail. Eliminated players retain their prior ballots but cannot cast new votes.
- Votes never close early. All changes are public, timestamped, and recorded in replay. A ballot supports at most 256 changes; repeated identical votes add no change.
- A successful ballot grants a 48-hour waiver. Daily ballots therefore allow separate weapons and infrastructure permissions to overlap. There is no general power to confiscate assets or issue another player's orders.
- At a shared timestamp, the council resolves before economy, combat, and queued commands, so all effects and launches at the deadline use the same permission. Victory then cancels the remaining ballot. A finished operation cancels the remaining ballot without granting a new waiver.
- New transit missions retain their high-thrust authorization through that mission's arrival, even after the waiver expires. Existing missions are not accelerated by a vote. Launch edits and course changes retain the mission's authorization; automatic return journeys receive permission current when the return begins.
- Other permissions apply at the moment of production, observation, recruitment, or combat. At expiry the convention is in force again. A prior observation cannot be taken back, a recruited unit is not deleted, and a destroyed installation is not rebuilt.

## Interface and durability

The Signals drawer displays the charter, current motion, threshold, deadline, named positions, vote changes, public nominations, active waiver expiry times, and recent decisions alongside chat. Only live, active multiplayer seats can act; lobbies, history, forecasts, eliminated seats, and finished games remain readable.

Council commands use the existing seat/account authentication, saved pending-command flow, durable receipt IDs, and atomic transactions. A vote includes the motion ID, preventing a delayed command from voting on tomorrow's ballot. A nomination names the expected ballot for the same reason. Retries repeat the exact payload and never duplicate a ballot change.

The compact belongs to simulation state and private replay commands, so offline catch-up, observation history, reconnects, and restarts use the same deadlines and effects. Public snapshots contain only public council records, never private chats or orders. The most recent 128 decisions remain in state; the private command archive retains earlier votes subject to the existing operation history capacity. Council activity counts as seat activity. Push reminders and treaty cards are separate work.
