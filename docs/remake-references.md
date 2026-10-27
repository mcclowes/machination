# Existing remake references

Reviewed public repositories for the Machination rebuild. No source code or artwork has been copied into the current implementation. The module milestone uses the behavior references noted below, with original TypeScript implementations and Machination-specific balance rules.

## Subterfuge Revived

The most promising source for direct adaptation is [Remake-Core](https://github.com/Subterfuge-Revived/Remake-Core). Its repository declares [CC0 1.0](https://github.com/Subterfuge-Revived/Remake-Core/blob/master/LICENSE). The C# code shares game logic between Unity and server validation and includes engine and server tests. The organization also has CC0-declared [Unity](https://github.com/Subterfuge-Revived/Remake-Unity) and [older backend](https://github.com/Subterfuge-Revived/Remake-Backend) repositories.

Next inspection targets: combat scenarios, specialist behaviors, time-machine event handling, visibility, and map geometry. Port relevant rules and tests into TypeScript rather than replacing the mobile app with a different runtime. Check individual file and asset provenance before importing material, and record paths and source commits for each adaptation.

## Arkoc's remake

[arkoc/subterfuge-remake](https://github.com/arkoc/subterfuge-remake), inspected at `a6e5d669d682c3a40eda3eb295795919823067b2`, documents a pure TypeScript simulation shared by a Node server and a React/Pixi client. The server uses an event log, and the Time Machine projects forward using the same simulation. Its README emphasizes fixed-point accumulation and equivalence between one large tick and split ticks.

Its README lists the license as TBD, and the repository metadata doesn't declare a license. Keep this as a design reference until an explicit reuse license is available. Useful lessons: test arbitrary time-step partitions, avoid accumulated floating-point economy drift, and filter server views before exposing fog-of-war information.

## Solaris

[solaris-games/solaris](https://github.com/solaris-games/solaris), inspected at `ba044868dc5320ceecd2939cfcbb209326d13317`, declares [GPL-3.0](https://github.com/solaris-games/solaris/blob/master/LICENSE). Its README describes specialists, trade, group chat, and games with up to 64 players. Its implementation uses a Node/Express/MongoDB backend and Vue/Pixi client.

Useful product references: group diplomacy, specialist affordances, trade, and managing longer games. Any source adoption needs an explicit project licensing decision and preserved notices; current work uses no Solaris source.


## Module behavior references

Reviewed CC0 Remake-Core commit `213d4a45833bf0d1b58e1334790bf0a8c8df0776`:

- [`Helmsman.cs`](https://github.com/Subterfuge-Revived/Remake-Core/blob/213d4a45833bf0d1b58e1334790bf0a8c8df0776/Core/SubterfugeCore/Core/Entities/Specialists/Specialists/Helmsman.cs): faster travel while attached, with the bonus removed on departure/capture. Machination implements an explicitly carried routing module with a fixed ×1.5 speed multiplier and no levels.
- [`Martyr.cs`](https://github.com/Subterfuge-Revived/Remake-Core/blob/213d4a45833bf0d1b58e1334790bf0a8c8df0776/Core/SubterfugeCore/Core/Entities/Specialists/Specialists/Martyr.cs): destruction triggered through combat participation. Machination's charge instead caps damage at twice its drone payload and leaves ownership and cores intact.
- [`Pirate.cs`](https://github.com/Subterfuge-Revived/Remake-Core/blob/213d4a45833bf0d1b58e1334790bf0a8c8df0776/Core/SubterfugeCore/Core/Entities/Specialists/Specialists/Pirate.cs): direct targeting of enemy submarines. This is a reference for the still-missing interception mechanic. The current scavenger module recovers attack losses and isn't a port of Pirate behavior.

Conversion and salvage rules are original choices for this prototype. Costs, effects, transport, collision behavior, and limitations are recorded in game-design.md and tested through the simulation and HTTP boundary.
