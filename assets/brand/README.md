# Machination identity

`mark.svg` is original artwork: an angular M inside a core enclosure, with an amber port. Its colors match the command UI. The platform supplies the outer launcher mask; the exported icon has no baked-in rounded corners or shadow.

Run `npm run build:brand` to export the committed PNGs and create `.data/brand-preview.png` with launcher masks and small-size previews. The pinned Sharp renderer is a development dependency. No font or external artwork is used in the mark.

| Export | Use |
| --- | --- |
| `icon.png` | Opaque 1024×1024 iOS and legacy Android icon; web favicon source |
| `adaptive-foreground.png` | Transparent Android color layer |
| `adaptive-monochrome.png` | White artwork on transparency for Android themed icons |
| `splash.png` | Transparent launch mark on the configured dark background |

The export command checks dimensions, icon opacity, monochrome color, and containment of every visible adaptive-layer pixel within Android's central safe circle. It previews circular and rounded masks without modifying the actual layers. See [Android's adaptive icon requirements](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive) and [Expo's icon and splash configuration](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/).

`app.json` owns native configuration. Regenerate native projects after changing these assets. Launcher appearance, wallpaper tinting, and launch-screen timing still require native runtime review; a PNG preview or successful export doesn't prove that behavior.
