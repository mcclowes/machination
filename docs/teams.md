# Doubles and 4v4

Tracked in [#78](https://github.com/mcclowes/machination/issues/78). Select **Doubles (2v2)** or **4v4** in solo or multiplayer setup. Teams support mining and domination. Selecting a team format from King’s Pulse switches the objective to mining.

Join order fixes the teams: seats 1–2 against 3–4 for doubles, or 1–4 against 5–8 for 4v4. The lobby shows each seat’s team before the host starts. Every seat must be filled. Players control their own assets; sharing a team never grants command authority over another seat.

Teammates share sensors, incoming contacts, preparing haulers, delayed courses, and scheduled orders. Each player can inspect and forecast a teammate’s plans, but only the owner can edit or cancel them. Opposing plans, preparations, recruitment state, and distant garrisons stay private. Private messages retain their existing recipients.

Mining sums the team’s cargo toward 300. Domination sums its sites toward half the chart. Every member shares the team result, including an eliminated member. Per-seat elimination, cargo loss, production, and ownership remain unchanged. The last active team wins; teams reaching the objective at the same simulation instant draw. Saves, history, canonical replay, and shared replay retain team membership. Shared replay exports omit scheduled intentions.

Mine prices count lifetime builds across the team, including each player’s starting mine. Doubles therefore starts with the next mine costing 200 drones; 4v4 starts at 400. The builder pays from their own station. Prices follow the existing 50, 100, 200, 300, … curve. Pirates cannot target allied haulers, including scheduled interceptions or a target that changes owner. Solo AI avoids attacking teammates. Ordinary combat and explicit gift rules still apply between different owners.

## Source and limits

The publisher’s [October 12, 2026 team preview](https://www.secretplan.com/subterfuge-news/rules-v43-preview.html) specifies casual 4v4 and 3v3v3, pooled mining/domination, shared sonar and future actions, team mine prices, and the allied Pirate restriction. The captured source is `/tmp/machination-recruitment-preview-source/rules-v43-preview.html`. This implementation integrates the earlier isolated checkpoint recorded on #78 into current revision-17 games, with an explicit `teams.preview.v1` rule profile. Old individual games retain their rules. The API also accepts the checkpoint’s 3v3v3 format; setup exposes the requested doubles and 4v4 formats.

Doubles is interpreted as two fixed pairs. No official doubles specification was found. Join-order membership, simultaneous draws, elimination outcomes, starting-mine pricing, and later mine prices are Machination rules, not verified publisher parity. Persistent team directories, captain enrollment, ratings, and medals remain outside this fixed-seat implementation. Native and human multiplayer acceptance remain open on #78.
