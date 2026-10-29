# Base emblems

Max supplied `Industrial Relay and Mining Emblems.png` on October 29, 2026. `original.png` preserves that download unchanged. The factory, satellite dish, and crystal cluster represent factories, generators, and mines, respectively. Legacy cores and reactors use factory and generator art.

`transparent-sheet.png` is the built-in imagegen background extraction. Runtime PNGs are 256×256 crops, bundled through static imports in `BeltMap.tsx`. The chart tints their alpha silhouettes with faction colors; unclaimed bases use gray. Intelligence cores retain a diamond badge, drifting bases retain an asteroid backing, and destroyed or unknown sites retain their text markers.

Extraction prompt:

> Use case: background-extraction. Input image: edit target, supplied three industrial base emblems. Remove only the near-black background, including the black spaces inside each emblem and black distressed cracks. Return the same three ivory emblems on actual transparent alpha, in the same left-to-right order (factory, satellite relay dish, mining crystals), in one wide sheet. Preserve their exact silhouettes, circular broken arcs, ivory color, distressed details, positions, equal spacing, and proportions. No labels or additional elements, no shadows or glow, no redesign. Preserve the 3:1 wide composition.

Regenerate runtime crops with the installed `sharp` dependency. The script centers each crop on its visible alpha bounds, so transparent sheet gutters don't shift the emblem inside the selection ring. It preserves the common crop size and artwork scale.

```sh
node scripts/build-base-icons.mjs
node --import tsx --test src/components/base-icons.test.ts
```

Tracking: [issue #58](https://github.com/mcclowes/machination/issues/58).
