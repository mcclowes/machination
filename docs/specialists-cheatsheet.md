# Specialists cheatsheet

Quick reference for current Machination operations. Specialists are movable machines with abilities. Cargo costs below use the name pulse material in King’s Pulse. The Subterfuge names below identify their original counterparts. Older saves retain their recorded mechanics; this sheet describes the current implementation, not a claim of complete original-game parity.

## Recruitment and transport

- Earn one hiring credit after 4 normal-rate hours, then one every 18 normal-rate hours. Credits accumulate. New operations run recruitment, production, shield recharge, and travel at 1.5× for the first 12 game hours, so the first credit arrives at 2h 40m.
- Choose one of three offers: one attack, one defense, and one other specialist. In new operations, a hire costs one credit and 5 cargo and appears at your controlled site containing the Intelligence core. Every player starts with 5 cargo and one mine. Batch hires pay the same 5-cargo fee. Older operations retain credit-only hiring. Hiring is unavailable while the core is in transit or cargo is insufficient.
- Diversion worm and Purger hires give **two units**; every other hire gives one.
- Promotion costs one credit, replaces the selected unit, and redraws the offers. The unit must be docked at one of your controlled sites; the core can be traveling elsewhere. Promoted specialists aren't directly hireable.
- Hires and promotions apply immediately when executed. There's currently no recruitment undo/finalize window; see the [recruitment lifecycle gap](recruitment-lifecycle.md).
- Load specialists explicitly onto haulers. They can travel without drones. Captive specialists provide no abilities; release, rescue, or conversion is needed to reactivate them.

“Local” means the specialist's site or hauler. “Global” applies to all your eligible assets, including while the specialist travels. Site abilities require a controlled site. Speed bonuses use the fastest applicable multiplier; they don't multiply together. Times below use game hours unless labeled normal-rate hours; Watchdog, Capacitor, and Navigator timers don't accelerate during the opening.

## Temporal specialists

New revision-18 operations add the following roles. Earlier saves retain their original decks. Activate Anchor and Overclock from the specialist panel or site; both support scheduled activation. See [temporal specialist rules](temporal-specialists.md) for timing, privacy, and counterplay.

| Specialist | Category | Effect and cost |
| --- | --- | --- |
| Dilation | Defense | Friendly and hostile haulers within its site's sensor range travel at half speed. Fields don't stack. Promotes to Anchor. |
| Anchor | Promotion | Two hours of local stasis, holding arrivals and pausing production and local clocks. Twelve-hour cooldown on the specialist and site. |
| Overclock | Other | Four hours of double local factory production speed, then four hours without output. Site-owned debt survives movement and capture. |
| Hindsight | Other | Reveals successful enemy actions within twice local sensor range two hours later, retaining the action and discovery times. |
| Foresight | Defense | Privately warns about committed actions that would kill one of your specialists within 24 hours. Predictions change with plans. |
| Hastener | Attack | After hostile arrival combat, pulls that defender's outbound transfers forward if it still controls the site. Present resources and normal preparation apply; failures abort once. |

## Core

| Specialist | Subterfuge name | Effect |
| --- | --- | --- |
| Intelligence core | Queen | +20 local shield capacity and +150 global drone capacity. Hosts recruitment while at a controlled site. Losing it triggers the nearest Fallback core's succession; without one, you're eliminated. |

## Attack hires

| Specialist | Subterfuge name | Effect |
| --- | --- | --- |
| Interceptor | Pirate | Can target moving enemy haulers at 2× speed. A genuine interception returns to the nearest friendly site at 4× speed. Ordinary site-bound travel and captive release get no Interceptor speed bonus. |
| Striker | Lieutenant | Destroys 5 opposing drones in combat; travels at 1.5× speed. Promotes to Warmind. |
| Breacher | Infiltrator | Drains all defending shields when attacking a site. In hauler combat, ends the encounter before drone combat. |
| Mauler | War Hero | Destroys 20 opposing drones in combat. Promotes to Watchdog. |
| Purger | Assassin | Destroys all opposing specialists present in combat. Two specialists per hire. |
| Hijacker | Thief | Converts 15% of opposing drones, rounded up per unit, when attacking a site or fighting another hauler. Doesn't convert while defending a site. |

## Defense hires

| Specialist | Subterfuge name | Effect |
| --- | --- | --- |
| Arbiter | Revered Elder | If present on exactly one side, suppresses local combat abilities after Meltdown charge. If both sides have one, those abilities resolve normally. |
| Diversion worm | Saboteur | In hauler combat, redirects a surviving opposing hauler to its nearest friendly site after combat in mechanics r13+. Profiles ≤12 redirect immediately and end combat. Two specialists per hire. |
| Custodian | Inspector | Fully charges local shields on friendly arrival and after combat. Combat refill is suppressed by a lone Arbiter; friendly-arrival refill isn't. Promotes to Bulwark. |
| Trojan | Double Agent | In hauler combat, destroys both drone manifests, swaps ownership of both haulers and their specialists, and ends combat. |
| Courier | Smuggler | Travels at 3× speed toward a friendly site. Promotes to Overseer. |
| Meltdown charge | Martyr | When participating in combat, destroys all sites, haulers, and specialists within 20% of standard sensor range (6.4 chart units), including friendly assets. Resolves before Arbiter. |

## Other hires

| Specialist | Subterfuge name | Effect |
| --- | --- | --- |
| Envoy | Diplomat | Releases your captive specialists held at sites within its site's full sensor range. Freed specialists travel home; they don't teleport. |
| Fabricator | Foreman | +4 drones per production cycle at your factories within half its site's sensor range, including its own factory. Promotes to Reclaimer. |
| Fallback core | Princess | +50% local site sensor range. The nearest active Fallback core, including one in transit, becomes Intelligence core when yours is lost. |
| Sensor mesh | Intelligence Officer | +25% global site sensor range; reveals distant site types, without revealing their hidden garrisons. |
| Capacitor | Tinkerer | Adds global drone capacity equal to 3× its site's maximum shields. Drains 1 local shield every 20 minutes, to a minimum of zero. Promotes to Power governor. |
| Navigator | Navigator | Changes its carrying hauler's course, with an 8h cooldown shared by the Navigators aboard. Current operations have a 10-minute cancelable delay before turning. Promotes to Swarm coordinator. |
| Thruster | Helmsman | Travels at 2× speed. |
| Assimilator | Hypnotist | Takes ownership of captive specialists at its site. An acquired enemy Intelligence core becomes a Fallback core. Promotes to Siege controller. |

## Promotions

| Specialist | Subterfuge name | Promoted from | Effect |
| --- | --- | --- | --- |
| Reclaimer | Engineer | Fabricator | Recovers 25% of drone losses after victories globally, rounded up per unit, plus another 25% locally. Recovery is capped at losses. The local bonus is suppressed by a lone Arbiter. |
| Warmind | General | Striker | Destroys 10 opposing drones globally in battles where you still have a local specialist after the specialist phase. Travels at 1.5× speed. |
| Watchdog | Sentry | Mauler | Every 2h, hits the enemy hauler with the most drones within half its site's sensor range. Destroys 5% of its drones, rounded up. |
| Power governor | Minister of Energy | Capacitor | +300 global drone capacity; each factory produces 1 fewer drone per cycle. |
| Bulwark | Security Chief | Custodian | +10 global shield capacity, plus another +10 at its site. |
| Overseer | Tycoon | Courier | +50% global factory production speed, plus 3 drones per cycle at its own factory. One Overseer changes an 8-normal-rate-hour cycle to 5h 20m. |
| Swarm coordinator | Admiral | Navigator | +50% speed for your haulers carrying no specialists; travels at 1.5× speed itself. Even captive specialists prevent a hauler from qualifying as empty. |
| Siege controller | King | Assimilator | After local specialist abilities, destroys 1 opposing drone per 4 of your remaining drones, rounded down. Multiple Siege controllers don't multiply this damage. Each Siege controller reduces global shield capacity by 20, floored at zero. |

Promotions replace the original ability. For example, Watchdog no longer deals Mauler's 20 combat damage, and Swarm coordinator no longer changes course.

## Combat order

Earlier abilities can end the encounter or remove specialists before later abilities fire. Equal-priority effects resolve simultaneously.

| Priority | Specialist | Resolution |
| --- | --- | --- |
| 1 | Meltdown charge | Detonates and ends combat. |
| 2 | Arbiter | Establishes suppression if present on exactly one side. |
| 3 | Diversion worm | r13+: marks the opposing hauler for redirection after combat if it survives; later priorities still resolve. Profiles ≤12 redirect immediately and end combat. |
| 4 | Hijacker | Converts drones from the opposing manifests before either conversion is applied. |
| 5 | Breacher | Drains site shields, or ends a hauler encounter. |
| 6 | Trojan | Swaps hauler ownership, removes drones, and ends combat. |
| 7 | Purger | Removes opposing specialists; reciprocal Purgers kill both sides' opposing specialists. |
| 8 | Striker and Mauler | Deal their drone damage simultaneously. |

If combat continues, Warmind and Siege controller apply global damage simultaneously, then shields absorb attacks at sites, then drones fight. Tied drone counts favor the side with more active local specialists; a complete hauler tie sends surviving specialists home. Victory recovery and combat shield refill follow. The current engine still applies global combat bonuses and global Reclaimer recovery under local Arbiter suppression.

Gift contacts transfer manifests and specialists without invoking these combat abilities. Captured specialists keep their original owner but become inactive captives.

## Rules and verification notes

The [catalog](../src/game/specialist-catalog.ts) defines the roster and promotions. The [combat resolver](../src/game/combat-abilities.ts), [effects](../src/game/specialist-effects.ts), [economy](../src/game/economy.ts), and [timed actions](../src/game/specialist-actions.ts) define the behavior summarized here. See [Pirate mission scope](pirate-missions.md) for interception details.

The [specialist acceptance audit](specialist-acceptance-audit.md) records tested interactions and unresolved original-game interpretations, including stacking and global effects under Arbiter suppression. Use it when comparing against Subterfuge rather than treating this quick reference as parity certification.
