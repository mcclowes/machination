# Temporal, resource, and diplomacy ideas

Recorded from Max's November 5, 2026 idea batch. This maps the ideas to existing mechanics and remaining design work. Proposed options below don't change current operations.

## Temporal specialists

All six named specialists are implemented in [#116](https://github.com/mcclowes/machination/issues/116), following the design capture in [#96](https://github.com/mcclowes/machination/issues/96). The [temporal specialist contract](temporal-specialists.md) defines timing, visibility, and compatibility.

| Idea | Current behavior and tradeoff |
| --- | --- |
| Dilation → Anchor | Dilation halves friendly and hostile hauler speed in local sensor range, buying warning time while delaying your reinforcements. Anchor promotes that role into two hours of local stasis with a twelve-hour cooldown. |
| Anchor | Local production and work pause; incoming haulers wait until thaw. Reinforcements also wait outside. Enemy arrivals still resolve afterward, so it delays combat without shielding the site from emitted pulses. |
| Overclock | Four hours of double factory production speed followed by four hours without production. The observed site's deadlines are visible, and its debt survives moving or losing the specialist. |
| Hindsight | Reveals nearby successful enemy actions two hours after execution, including actions outside ordinary visibility. Reports retain the original action time; they don't reveal private unexecuted plans or change past state. |
| Foresight | Warns about committed actions predicted to kill your specialists within 24 hours. Warnings change with plans; they grant neither immunity nor a guaranteed response interval for immediate attacks. |
| Hastener | Hostile arrival pulls the defender's queued outbound transfers forward after combat, using current resources and normal ten-minute preparation. A later strike can exploit the departure. Empty queues yield nothing, and useful enemy reinforcements or escapes can leave early too. |

The opening seed, **drain power to accelerate friendly time so enemy actions come too late**, remains distinct from Overclock's production loan. It is recorded in [#213](https://github.com/mcclowes/machination/issues/213). Power currently means fleet capacity; literal power consumption and the clock being accelerated need a design. Accelerating the global clock equally wouldn't create a relative advantage.

Revenant is currently a character identity, without the proposed warning-compression or time-loan ability. Dilation's counter relationship to that proposed ability remains a design idea, rather than a current interaction. Keep those references when comparing future acceleration options with the existing roster.

## Mined resources can decrease

Several parts already exist:

- Newer operations charge 5 cargo and one hiring credit per specialist hire, including batch hires. Promotions use credits alone. See [#38](https://github.com/mcclowes/machination/issues/38) and the [economy rules](game-design.md#faithful-rules-upgrade).
- King's Pulse and Disruptor abilities spend mined pulse material, the pulse mode's name for cargo.
- Losing a mine removes 20% of the former owner's cargo, rounded upward. The captor receives no material. [Mine loss rules](mining-destruction.md) distinguish capture from destruction.

Actual material theft and destruction of accumulated material are recorded in [#214](https://github.com/mcclowes/machination/issues/214). Current site destruction preserves accumulated cargo unless the event also eliminates its owner. The Hijacker steals drones, not material. Cargo is a faction-wide balance, so local stockpiles can't be assumed.

Recommendation: explore one bounded raid or capture effect before adding cargo transport or local storage. Specify whether theft replaces the capture penalty, how repeated raids are limited, and how losses affect mining victory, pulse ammunition, and recruitment.

## Diplomacy and conversation

**Daily voting is the firm direction in this batch.** The [Belt compact](belt-compact.md), tracked in [#39](https://github.com/mcclowes/machination/issues/39), already implements one public ballot per 24 simulation hours, rotating nominations, named votes, and temporary policy waivers. It is enabled by default in the multiplayer creation UI and service default setup; existing operations keep their settings. Balance and physical-device acceptance remain separate work.

Public chat, private bilateral messages, and named private groups already provide conversation channels. See [group diplomacy](group-diplomacy.md). These existing proposals give players more reasons to use them:

| Feature | Conversation it supports | Tracking |
| --- | --- | --- |
| Treaty cards | Explicit ceasefires, handovers, and support commitments with participants and expiry. Initial treaties record promises that can be broken. | [#40](https://github.com/mcclowes/machination/issues/40) |
| Negotiation threads | Discussions attached to a site, hauler, or council motion, with a current offer and deadline. | [#41](https://github.com/mcclowes/machination/issues/41) |
| Intelligence exchanges | Selected timestamped observations and annotations as bargaining material, with explicit disclosure. | [#42](https://github.com/mcclowes/machination/issues/42) |
| Roleplay rooms | Machine personas, faction names, a founding charter, public communiques, and an out-of-character convention. | [#43](https://github.com/mcclowes/machination/issues/43) |
| Daily dispatch | Public vote results, declarations, and attributed player statements that give returning players something to discuss. | [#44](https://github.com/mcclowes/machination/issues/44) |

These remain proposals. Recommendation: test an opt-in roleplay preset with an invited group inside an existing operation before building persistent roleplay servers. Match-scoped rooms versus communities spanning matches remains open. The daily council supplies the recurring political decision; treaty cards and linked negotiations can make bargaining easier without requiring a new server system.
