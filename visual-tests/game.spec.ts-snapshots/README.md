# macOS screenshot references

Reviewed Chromium references for the home screen, selected Lodestone core, and six-hour forecast. Each state has desktop (1440×1000) and mobile-touch (390×844) coverage.

- Runtime source: `d56f5c50c2fb243be060ab5d1f60b5ded1cbd62f`.
- Node: `24.14.1`; Playwright: `1.62.1`; bundled Chromium: `151.0.7922.34`, revision `1234`.
- Fixture: seed `314159`, epoch `2026-10-13T12:00:00Z`, UTC, `en-GB`, and reduced motion.
- The fixture acknowledges the briefing, selects the seeded core by its accessible name, and checks its inspector heading before capture. Collision suppression may omit the visible map label.
- Capture waits for the projection SVG viewport to match the chart's measured bounds before and after layout changes. This preserves the chart's retained zoom while waiting for resize delivery.
- All six references were inspected and passed two comparisons without updates. An isolated inverted render failed on 94% pixel difference; reference hashes stayed unchanged.

Run `npm run test:visual -- visual-tests/game.spec.ts` to compare. For an intentional visual change, record with `npm run test:visual:update -- visual-tests/game.spec.ts`, review every changed image, and update this provenance before committing. Comparison never records missing references automatically.

These files cover macOS Chromium. Other operating systems need their own reviewed references. They do not certify native iOS rendering, gestures, or accessibility. Tracking: [#88](https://github.com/mcclowes/machination/issues/88).
