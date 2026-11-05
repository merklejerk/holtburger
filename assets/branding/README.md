# Project branding

The [portal emblem](portal-source.png) is Holtburger's project logo, generated
with imagegen and selected without artwork changes. Preserve this full-resolution
transparent PNG as the source; apps and docs consume the smaller generated exports:

- `portal-docs.png`: 192 px for README marks displayed at 64–96 px.
- `favicon.png`: 64 px for browser tabs and the docs site.
- `icon.png`: 512 px for native windows and Flatpak launchers.
- `icon.ico` and `icon.icns`: multi-resolution Windows and macOS application icons.

The original [animated portal SVG](portal.svg) supplies the client loading and
pregame artwork independently of the static emblem. The docs site publishes only
its small favicon rather than the full-resolution source or native icon exports.
Normal builds use the checked-in exports.

The generator lives in `scripts/branding/generate.ts`; its dependencies belong to
the repository-root tooling package.

Exports use alpha-aware Lanczos downscaling directly from the original PNG.
ICO and ICNS package those resized images without applying another resampling pass.

To update the static artwork, replace `portal-source.png`, then run these commands
from the repository root (run `npm ci` first if dependencies are not installed):

```sh
npm run generate:branding
npm run check:branding
```

Commit the resulting assets with the source change. The check verifies that the
generated assets match the source.
