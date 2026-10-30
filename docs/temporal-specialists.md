# Temporal specialists

Design proposal for [#96](https://github.com/mcclowes/machination/issues/96). These abilities aren't in the playable roster. Names are working names; outposts, subs, and drillers correspond to Machination's sites, haulers, and drones.

Overclock now names the playable promoted combat specialist. The production concept below needs a different name if adopted.

The shared theme is control over timing and information, with a cost the opponent can exploit. Dilation promotes to Anchor. The other specialists are separate proposals; their recruitment categories and promotion relationships remain open.

## Dilation

Haulers within range of its controlled site move at half speed, friend and foe alike. A hauler resumes its normal speed when it leaves the field or the field ends. Movement already completed isn't recalculated.

This stretches the defender's warning window and could counter the proposed Revenant's compressed warning. It also delays your reinforcements, retreats, and specialist deliveries. Overlapping Dilation fields should keep the same half-speed effect rather than repeatedly halving speed.

Only travel slows. Production, private order timestamps, launch preparation, and the operation clock continue normally. Range and interactions with interception, drifting sites, engine outages, and pulse propagation need balance rules; a travel field doesn't automatically slow a pulse.

## Anchor

Dilation promotes to Anchor, which temporarily freezes an outpost. Local drone production stops, and incoming friendly and hostile haulers hold at its boundary until stasis lifts. Existing garrisons and manifests remain intact.

It buys time to stage reinforcements nearby, but they can't enter during stasis. Enemy arrivals are delayed too, so lifting the field can release an attack alongside your reinforcements. The held arrivals need a deterministic release rule that doesn't give either side a free first strike.

Private queued orders and traveling haulers are different things. The proposal preserves the danger waiting when stasis ends; it doesn't teleport queued launches to their destinations. Orders originating at the frozen site need an explicit hold-or-abort policy. They mustn't silently launch drones through stasis.

Stasis also needs a decision on local mining, shield recharge, pulse charging, combat, and outgoing movement. Duration must be finite, with a reuse limit that prevents permanent stasis. Production resumes from its remaining progress without catch-up output.

## Overclock

Double local factory production speed for a chosen interval, then produce nothing there for the same interval. The bonus creates extra production cycles, leaving drones per cycle unchanged. After repayment, resume ordinary production without catch-up output.

The benefit is access to drones earlier. The catch is a visible repayment period that opponents can target. Both phases and their end times should be shown when the site is observed. Normal fleet capacity still limits output; an Overclock at capacity can waste its benefit while still creating debt.

Treat the debt as belonging to the site: moving, losing, capturing, or promoting the specialist mustn't erase it. Proposed rule: no overlapping loans at the same site. Whether debt persists through a site changing industry or being destroyed needs a decision before implementation.

This uses the proposed Revenant's loan pattern economically. Revenant currently has a character identity, but its temporal ability isn't defined in the specialist catalog; its warning compression remains a separate design dependency.

## Hindsight

Reveal previously unseen enemy actions after they have happened, retaining their original timestamps. This can explain a vanished garrison, a specialist movement, or an attack launched outside ordinary coverage.

Each disclosure has two times: when the action happened and when you learned about it. The Time Machine may annotate the past with newly learned information, but historical controls stay read-only. A replay of what the player knew at the time must preserve the later discovery time.

Reveal an action record, not the enemy's entire historical state or current queue. The catch is that the information arrives too late to stop that action and may already be stale. Lookback, disclosure delay, eligible action types, and geographic scope remain balance choices. Hiring Hindsight shouldn't automatically expose the entire match history.

## Foresight

Reveal queued enemy actions that, under the current committed plans, would cause one of your specialists to die. This is an explicit exception to queue privacy: the player receives a warning before the predicted lethal action resolves, even when ordinary sensors wouldn't reveal it.

The warning identifies the threatened specialist, predicted death time, and the relevant enemy action. It grants information, not immunity. Capture and defeat without specialist death need a separate scope decision.

The catch is that a warning describes the current plan. A changed route, canceled order, reinforcement, or new attack can invalidate it. Warnings must update or be marked superseded; the absence of a warning can't promise safety against actions the enemy hasn't ordered yet. Detection must run when a qualifying order is committed or changed, before it can execute.

The phrase “you can't kill it without the player knowing” could instead mean protection only for the Foresight carrier. Proposed interpretation here is any friendly specialist; coverage, prediction horizon, and the minimum useful warning interval remain open. If late live attacks are meant to be impossible without advance notice, that requires an additional attack delay or commitment rule.

## Hastener

On hostile arrival, pull the enemy's queued orders originating at that outpost forward to the arrival time. Their drones can leave early and strip the defense, creating an opening for a follow-up strike.

The catch is that the orders must exist and be executable now. A passive defender gives it nothing to pull forward. It can also accelerate a useful enemy reinforcement or specialist escape. It needs a read on the opponent's plans, and its result can favor either player.

Recommended first scope: outbound transfer orders only. “Any queued orders” would also accelerate shield changes, recruitment, promotions, funding, and cancellation chains, making its result much harder to read. Preserve the broader version as an alternative for playtesting.

Snapshot the eligible queue once, preserve its existing order, and validate each order against current resources. An order depending on future production gets no free drones; define whether an early failure consumes it or leaves it scheduled. Don't recursively pull new orders created by resolving the snapshot, and don't expose unrelated private plans.

Launch preparation matters: today's launches reserve drones immediately but depart after ten minutes. If Hastener must make drones leave before combat, it needs an explicit exception to that window. Otherwise it should affect the follow-up attack, with ordinary reservation and combat rules preserved. Its trigger must also specify whether it happens before combat, after survival, or only after capture; requiring capture would remove much of its proposed purpose.

## Power for time

Original seed: spend power to speed up your time so enemy actions happen too late. The useful effect needs a specific clock: faster production, faster travel, and delayed hostile orders produce different tactics.

Machination's power currently means fleet capacity, not stored energy. A capacity penalty can suppress future production, but it doesn't drain a resource or remove existing drones. A consumable-power version would introduce another economy.

Recommendation: prototype this through Overclock's production loan first. If a distinct accelerator is still useful, define which friendly clock advances and how power is paid before adding it. Advancing the whole operation would advance enemy actions too, defeating the intended relative advantage.

## Acceptance before playable release

- Dilation halves travel only inside its field, slows both sides, and preserves completed progress across entry, exit, overlapping fields, save/load, and split simulation advances.
- Anchor holds both sides, pauses production without catch-up, and releases simultaneous arrivals consistently. Queued launches cannot bypass the freeze, and repeated activations cannot hold a site forever.
- Overclock gives equal-duration acceleration and repayment. Capacity limits, moving or losing the specialist, capture, and industry changes cannot erase debt or create output during repayment.
- Hindsight discloses only eligible past actions, records discovery separately from occurrence, and preserves what each player knew in private and shared replays.
- Foresight warns before a qualifying committed lethal action resolves, handles plan changes, and exposes only the information authorized by the ability. Forecasts clearly distinguish conditional warnings from guaranteed outcomes.
- Hastener handles empty queues, insufficient present resources, dependent orders, simultaneous arrivals, preparation windows, and repeated arrivals without duplicate execution or unrelated queue disclosure.
- New mechanics are versioned for new operations. Existing saves, recruitment decks, command retries, and replays retain their recorded behavior. Online observations, AI decisions, and local forecasts use the same ability rules and disclosure boundaries.

Exact ranges, activation costs, durations, cooldowns, hire categories, and pulse interactions remain open. These are design acceptance scenarios, not claims of implemented or tested behavior. The [current specialist reference](specialists-cheatsheet.md), [future-action rules](future-actions.md), and [Disruptor rules](disruptor.md) describe the existing game.
