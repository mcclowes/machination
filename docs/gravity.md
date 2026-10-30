# Gravity and curved flight paths

Gravity is enabled by default for new solo and multiplayer operations using mechanics revision 19. Uncheck **Gravity and curved flight paths** in setup to use straight routes. Enabling it turns off drifting bases; enabling drift turns gravity off. Existing operations retain their recorded rules and courses. Creating an older mechanics revision without an explicit gravity option still produces straight routes.

Two to five public giants occupy gaps between sites, depending on player count. Their dashed circles show where gravity affects flight. They bend ordinary hauler courses and change local speed. A longer arc can offset a slingshot's speed gain, so proximity to a giant isn't an automatic ETA improvement. Giants are chart features, not capturable sites or pulse targets.

A launch freezes a ballistic polyline and its integrated travel times. Ships follow that curve, face its current tangent, and use the same geometry for arrival forecasts, same-route encounters, sensors, pulses, saves, and observed replays. Routes crossing the chart seam remain continuous. The opening acceleration still applies to travel work. Speed changes and engine outages retain the remaining curve; a Navigator redirect or return mission plots a new one from the ship's current position.

Interceptors fly straight under power toward a rendezvous on the target's frozen curve. If the target changes course or speed, interception can miss, as in stationary operations. Same-pair ordinary traffic shares one canonical curve in both directions.

The model supports repulsive, owner-aware antigravity wells in recorded rules: they repel courses, speed their owner's haulers, and slow rivals. Setup currently places only neutral giants. Player-created wells, specialist abilities, manual waypoints, and gravity shadow overlays remain outside this first integration. These still need separate ability rules and balance work under [#104](https://github.com/mcclowes/machination/issues/104).

The original sandbox remains available with `node prototypes/gravity/run.mjs`. Its controls and tuning don't change saved operations.
