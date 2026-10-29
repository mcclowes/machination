# Specialist insignia

Each of the 29 catalog roles has an original vector silhouette. The chart, roster, recruitment offers, and manual all use `SpecialistIcon`; the old atlas remains available in the art archive.

Geometry lives in [specialist-insignia.ts](../../src/components/specialist-insignia.ts). The React Native SVG renderer and the contact sheet export use that geometry, including the captive lock and its dark backing. Chart badges retain owner colors, muted captive symbols, dashed captive borders, and grouped counts.

Regenerate the [contact sheet](insignia-contact-sheet.svg) and the ignored Fettle review PNG with:

```sh
node --import tsx scripts/render-specialist-insignia.ts
```

The sheet shows each role at 36px and 20px, plus count and captive examples. Its badge examples use the default player roster colors. Text and layout are static approximations; native fonts, dynamic type, and interaction need separate checks.

`specialist-insignia.test.ts` renders the actual web component and checks catalog coverage, distinct raster output at both sizes, agreement with the sheet exporter, unclipped strokes, and active/muted contrast on the badge background. These checks establish geometry and rendering contracts, not human recognition or native acceptance. Full names remain available through the existing accessible manifest and inspection.

Tracking: [#73](https://github.com/mcclowes/machination/issues/73), under the [fidelity goal](https://github.com/mcclowes/machination/issues/18).
