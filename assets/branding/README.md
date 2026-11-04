# Project branding

The portal is Holtburger's project logo. Its [canonical animated SVG](portal.svg)
also supplies the client loading animation. The [static mark](portal-static.svg),
PNG, Windows ICO, and macOS ICNS in this directory are generated from its still
geometry, centered on a square canvas. Browser favicons and the CLI Flatpak icon
are generated copies. Normal builds use the checked-in exports.

To update the artwork, edit `portal.svg`, then run these commands from the
repository root:

```sh
cd apps/holtburger-3d
npm ci
npm run generate:branding
npm run check:branding
```

Commit the resulting assets with the source change. The check verifies that the
generated assets match the source.
