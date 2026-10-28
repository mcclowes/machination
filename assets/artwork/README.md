# Project artwork

Captured from Max's [Machination ChatGPT project](https://chatgpt.com/g/g-p-6ae25982e48481919ece752bcab9c398/project) on October 28, 2026. All 17 visible chats were checked: 16 contain 24 generated images, and Evolving Victory Conditions contains none. The five commander sheets contain 30 portraits.

`manifest.json` records each image's source chat, position within that chat, download filename, dimensions, and SHA-256. Original PNG downloads are preserved byte for byte in `originals/`. The five existing portrait sheets in `assets/players/` and the opening illustration in `assets/brand/` are referenced in place; their hashes match the downloads.

`display/` contains 960×640, 256-color PNG copies for the archive and illustrated panels. The complete collection is available through **Manual → Art archive**, with category filters and previous/next controls. Only the selected archive image is mounted. Existing commander selection and the opening screen continue to use their full-resolution originals.

The manual illustrates mining, transfers, specialist combat, gifts, sensors, time travel, and scheduled orders. Controlled-site inspectors show mining, drone, cockpit, or destruction scenes. Specialist cards use clipped insignia from the ivory icon sheet; names and descriptions remain authoritative. The revised priest scene and gravity well without arrows are used as the current concepts; both earlier versions remain available in the archive.

These images provide presentation only. The archive also contains concepts for ships, gravity wells, and cloaking that do not imply new simulation abilities. Generated sheet labels do not change the game's unit names or rules.

The catalog's `require` calls are static so Metro can bundle every display image for native and web builds. The original import doesn't require an active ChatGPT session at runtime. Run `npm test` to verify original hashes, per-chat coverage, unique images, dimensions, and decoded display copies. `npm run build:web` verifies bundling.

To regenerate display copies after intentionally replacing an original:

```sh
node --input-type=module - <<'JS'
import fs from 'node:fs/promises';
import sharp from 'sharp';
const manifest = JSON.parse(await fs.readFile('assets/artwork/manifest.json', 'utf8'));
for (const image of manifest.images) {
  await sharp(image.original).resize(960, 640)
    .png({ palette: true, colors: 256, effort: 10 }).toFile(image.display);
}
JS
```

Preserve source metadata when adding art, update the static catalog, and record any intentional original replacement in the manifest. Tracking: [issue #27](https://github.com/mcclowes/machination/issues/27).
