# Bundled UI fonts

Base uses Arimo for body text, Gelasio for headings, and Cousine for monospace.
Pregame styling and explicit client font preferences use the same bundled faces.
Each family includes upright and italic faces, with regular and bold weights;
Arimo and Gelasio are variable fonts covering weights 400–700.

The font binaries are unmodified files from the Google Fonts repository at revision
`e7db6ca603fd4862010383ff17ffd6cc4ffac1c0`:

- [Arimo](https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/arimo)
- [Gelasio](https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/gelasio)
- [Cousine](https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/cousine)

Each family's `OFL.txt` contains its original copyright and SIL Open Font License
1.1. These fonts retain that license rather than the application's AGPL license.
The notices normalize trailing whitespace only. Keep them alongside the fonts when distributing them.

Vite copies this directory, including the licenses, into `dist/fonts/`; Electron
packages `dist/`. Runtime loading is entirely local, without a font service or
host-installed font dependency. The CSS definitions are in `src/app/ui-fonts.css`.
They omit `local()` so a host font cannot replace the shipped version. Generic
fallbacks still cover loading failures and characters absent from these fonts.
