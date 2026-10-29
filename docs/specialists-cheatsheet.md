# Specialists cheatsheet

Quick reference for current Machination operations. Specialists are called **modules** in the UI. The Subterfuge names below identify their original counterparts. Older saves retain their recorded mechanics; this sheet describes the current implementation, not a claim of complete original-game parity.

## Recruitment and transport

- Earn one hiring credit after 4 normal-rate hours, then one every 18 normal-rate hours. Credits accumulate. New operations run recruitment, production, shield recharge, and travel at 1.5× for the first 12 game hours, so the first credit arrives at 2h 40m.
- Choose one of three offers: one attack, one defense, and one other specialist. A hire costs one credit and appears at your controlled site containing the Intelligence core. Hiring is unavailable while the core is in transit.
- Diversion worm and Kill protocol hires give **two units**; every other hire gives one.
- Promotion costs one credit, replaces the selected unit, and redraws the offers. The unit must be docked at one of your controlled sites; the core can be traveling elsewhere. Promoted specialists aren't directly hireable.
- Hires and promotions apply immediately when executed. There's currently no recruitment undo/finalize window; see the [recruitment lifecycle gap](recruitment-lifecycle.md).
- Load modules explicitly onto haulers. They can travel without drones. Captive modules provide no abilities; release, rescue, or conversion is needed to reactivate them.

“Local” means the specialist's site or hauler. “Global” applies to all your eligible assets, including while the specialist travels. Site abilities require a controlled site. Speed bonuses use the fastest applicable multiplier; they don't multiply together. Times below use game hours unless labeled normal-rate hours; Sentry, Capacitor, and Navigator timers don't accelerate during the opening.

## Core

| Module | Subterfuge name | Effect |
| --- | --- | --- |
| Intelligence core | Queen | +20 local shield capacity and +150 global power capacity. Hosts recruitment while at a controlled site. Losing it triggers the nearest Fallback core's succession; without one, you're eliminated. |

## Attack hires

| Module | Subterfuge name | Effect |
| --- | --- | --- |
| Scavenger rig | Pirate | Can target moving enemy haulers at 2× speed. A genuine interception returns to the nearest friendly site at 4× speed. Ordinary site-bound travel and captive release get no Pirate speed bonus. |
| Combat daemon | Lieutenant | Destroys 5 opposing drones in combat; travels at 1.5× speed. Promotes to War controller. |
| Shield breaker | Infiltrator | Drains all defending shields when attacking a site. In hauler combat, ends the encounter before drone combat. |
| Siege unit | War Hero | Destroys 20 opposing drones in combat. Promotes to Sentry array. |
| Kill protocol | Assassin | Destroys all opposing modules present in combat. Two units per hire. |
| Conversion virus | Thief | Converts 15% of opposing drones, rounded up per unit, when attacking a site or fighting another hauler. Doesn't convert while defending a site. |

## Defense hires

| Module | Subterfuge name | Effect |
| --- | --- | --- |
| Precedence kernel | Revered Elder | If present on exactly one side, suppresses local combat abilities after Self-destruct charge. If both sides have one, those abilities resolve normally. |
| Diversion worm | Saboteur | In hauler combat, redirects the opposing hauler to its nearest friendly site and ends the encounter. Two units per hire. |
| Shield servitor | Inspector | Fully charges local shields on friendly arrival and after combat. Combat refill is suppressed by a lone Precedence kernel; friendly-arrival refill isn't. Promotes to Defense controller. |
| Handoff virus | Double Agent | In hauler combat, destroys both drone manifests, swaps ownership of both haulers and their modules, and ends combat. |
| Courier daemon | Smuggler | Travels at 3× speed toward a friendly site. Promotes to Industrial controller. |
| Self-destruct charge | Martyr | When participating in combat, destroys all sites, haulers, and modules within 20% of standard sensor range (6.4 chart units), including friendly assets. Resolves before Precedence kernel. |

## Other hires

| Module | Subterfuge name | Effect |
| --- | --- | --- |
| Envoy protocol | Diplomat | Releases your captive modules held at sites within its site's full sensor range. Freed units travel home; they don't teleport. |
| Assembler daemon | Foreman | +4 drones per production cycle at your factories within half its site's sensor range, including its own factory. Promotes to Repair mesh. |
| Fallback core | Princess | +50% local site sensor range. The nearest active Fallback core, including one in transit, becomes Intelligence core when yours is lost. |
| Sensor mesh | Intelligence Officer | +25% global site sensor range; reveals distant site types, without revealing their hidden garrisons. |
| Capacitor daemon | Tinkerer | Adds global power capacity equal to 3× its site's maximum shields. Drains 1 local shield every 20 minutes, to a minimum of zero. Promotes to Fusion controller. |
| Routing controller | Navigator | Changes its carrying hauler's course, with an 8h cooldown shared by the Navigators aboard. Current operations have a 10-minute cancelable delay before turning. Promotes to Fleet controller. |
| Routing daemon | Helmsman | Travels at 2× speed. |
| Assimilation daemon | Hypnotist | Takes ownership of captive modules at its site. An acquired enemy Intelligence core becomes a Fallback core. Promotes to Siege controller. |

## Promotions

| Module | Subterfuge name | Promoted from | Effect |
| --- | --- | --- | --- |
| Repair mesh | Engineer | Assembler daemon | Recovers 25% of drone losses after victories globally, rounded up per unit, plus another 25% locally. Recovery is capped at losses. The local bonus is suppressed by a lone Precedence kernel. |
| War controller | General | Combat daemon | Destroys 10 opposing drones globally in battles where you still have a local module after the specialist phase. Travels at 1.5× speed. |
| Sentry array | Sentry | Siege unit | Every 2h, hits the enemy hauler with the most drones within half its site's sensor range. Destroys 5% of its drones, rounded up. |
| Fusion controller | Minister of Energy | Capacitor daemon | +300 global power capacity; each factory produces 1 fewer drone per cycle. |
| Defense controller | Security Chief | Shield servitor | +10 global shield capacity, plus another +10 at its site. |
| Industrial controller | Tycoon | Courier daemon | +50% global factory production speed, plus 3 drones per cycle at its own factory. One controller changes an 8-normal-rate-hour cycle to 5h 20m. |
| Fleet controller | Admiral | Routing controller | +50% speed for your haulers carrying no modules; travels at 1.5× speed itself. Even captive modules prevent a hauler from qualifying as empty. |
| Siege controller | King | Assimilation daemon | After local specialist abilities, destroys 1 opposing drone per 4 of your remaining drones, rounded down. Multiple Kings don't multiply this damage. Each King reduces global shield capacity by 20, floored at zero. |

Promotions replace the original ability. For example, Sentry array no longer deals Siege unit's 20 combat damage, and Fleet controller no longer changes course.

## Combat order

Earlier abilities can end the encounter or remove modules before later abilities fire. Equal-priority effects resolve simultaneously.

| Priority | Module | Resolution |
| --- | --- | --- |
| 1 | Self-destruct charge | Detonates and ends combat. |
| 2 | Precedence kernel | Establishes suppression if present on exactly one side. |
| 3 | Diversion worm | Hauler redirection ends combat. |
| 4 | Conversion virus | Converts drones from the opposing manifests before either conversion is applied. |
| 5 | Shield breaker | Drains site shields, or ends a hauler encounter. |
| 6 | Handoff virus | Swaps hauler ownership, removes drones, and ends combat. |
| 7 | Kill protocol | Removes opposing modules; reciprocal Assassins kill both sides' opposing modules. |
| 8 | Combat daemon and Siege unit | Deal their drone damage simultaneously. |

If combat continues, War controller and Siege controller apply global damage simultaneously, then shields absorb attacks at sites, then drones fight. Tied drone counts favor the side with more active local modules; a complete hauler tie sends surviving modules home. Victory recovery and combat shield refill follow. The current engine still applies global combat bonuses and global Repair mesh recovery under local Precedence kernel suppression.

Gift contacts transfer cargo and modules without invoking these combat abilities. Captured modules keep their original owner but become inactive captives.

## Rules and verification notes

The [catalog](../src/game/specialist-catalog.ts) defines the roster and promotions. The [combat resolver](../src/game/combat-abilities.ts), [effects](../src/game/specialist-effects.ts), [economy](../src/game/economy.ts), and [timed actions](../src/game/specialist-actions.ts) define the behavior summarized here. See [Pirate mission scope](pirate-missions.md) for interception details.

The [specialist acceptance audit](specialist-acceptance-audit.md) records tested interactions and unresolved original-game interpretations, including stacking and global effects under Elder suppression. Use it when comparing against Subterfuge rather than treating this quick reference as parity certification.
