# Location names

The shared catalogue lives in [location-names.ts](../src/game/location-names.ts). It contains 300 names across six pools, ready for map generation or authored locations.

| Pool | Count | Tone | Examples |
| --- | ---: | --- | --- |
| `base` | 40 | Industry, fortifications, and institutional remnants | Cold forge, Dead letter, Thin margin |
| `asteroid` | 100 | Minerals, broken stone, and extraction | Anthracite, Clinker, Regolith |
| `planet` | 40 | Mythic and invented world names | Ananke, Erewhon, Nivara |
| `moon` | 40 | Reflected light, tides, and quiet companions | Borrowed light, Moth, Pale sister |
| `station` | 40 | Transit, trade, and orbital infrastructure | Counterweight, Free berth, Witness array |
| `region` | 40 | Sparse, cold geography at chart scale | Ashen reach, Outer dark, Rust sea |

Import `LOCATION_NAME_POOLS` and select a category, such as `LOCATION_NAME_POOLS.asteroid`. `LocationNameKind` is the union of supported category keys. The arrays are read-only in TypeScript; copy a pool before shuffling it.

This catalogue doesn't assign or rename locations. Generated charts still use their existing Relay labels, and saved operations retain their stored names. Planets, moons, stations, and regions are naming categories, not new gameplay entities.

Keep additions short enough for chart labels, ideally one or two words and at most 24 characters. Use sentence case except for proper names. Entries are unique across all pools, and commander identities are excluded. The asteroid pool covers the current maximum of 100 chart sites without repeats.

When connecting a pool to map generation, sample without replacement using a separate seeded naming stream. Names must not depend on ownership, hidden cores, or production type. Persist the chosen labels with the operation so catalogue changes don't rename existing sites.
