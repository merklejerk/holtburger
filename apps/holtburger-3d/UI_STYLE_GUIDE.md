# UI themes and Espresso Aero

Both client and Explorer use one app-local appearance contract. Theme data changes
colors and materials; component CSS owns arrangement. Renderer and host lifetimes
do not depend on theme changes.

## Edit points

| Concern                                                   | Owner                              |
| --------------------------------------------------------- | ---------------------------------- |
| Default palette, fonts, radii, material strengths         | `src/app/themes/espresso-aero.ts`  |
| Complete configuration and preference types               | `src/app/ui-theme-contract.ts`     |
| Pure CSS-variable projection and explicit DOM application | `src/app/ui-theme.ts`              |
| Shared materials and control states                       | `src/app/ui-theme-recipes.css`     |
| Browser reset                                             | `src/app/base.css`                 |
| Initial client HUD arrangement                            | `src/client/client-ui-defaults.ts` |
| Explorer tool layout and diagnostic row density           | `src/explorer/explorer.css`        |

The shared `mountEntry` publishes Espresso Aero on `document.documentElement`
before mounting either application. It marks `#app` with `ui-theme`; isolated
diagnostic roots may carry the same scope class. Theme-specific names belong only
in theme data and documentation, not component classes.

The stable default identifier is `espresso-aero`; its display name is
**Espresso Aero**. Edit the exported definition directly for app defaults.
The contract contains 20 opaque color roles, three font stacks, two corner radii,
and five material parameters. Colors use the existing `hexRgb` constructor.
Numeric strengths must be finite and within 0–1; dimensions must be finite and
nonnegative. Projection validates these before mutating the root.

## Visual direction

Espresso Aero is flat warm charcoal glass, ivory text, muted brass controls, and a
narrow walnut header detail. Warmth comes from accents rather than brown-filled
surfaces. It borrows a glass finish, not desktop-window proportions.

- Actual windows and inspectors get glass, a thin edge, and a restrained shadow.
  Their headers carry a 3px walnut strip; wood never fills a reading area.
- Window controls are flat brass. Hover lightens them, pressing darkens them,
  and selection adds an underline. No bevels or glossy meter fills.
- HUDs remain information over the game: borderless, compact, and mostly unpainted.
  Readout backings fade horizontally and vertically beyond their text; glyph
  controls have small radial backings. Empty layout space stays transparent.
- Character vitals keep their descending bar heights. Targets keep a name,
  glyph actions, and a thin health bar. Chat fades into the scene and keeps its
  quiet filters/input at the bottom. Shortcuts are an unenclosed glyph row.
- Default body text is 13px sans-serif. Headings use a restrained serif;
  diagnostic values may use tabular monospace. Remove unnecessary labels and
  padding before shrinking text.

Layout dimensions are not theme fields. Shared controls start at 24px high,
with small gaps, 2–7px control padding, and 8px window-body padding. Components
may adapt geometry to their actual function, but must not recreate materials.
Existing HUD rectangles describe layout and hit-testing allocations, not painted
panels.

## Recipe vocabulary

Recipes are ordinary classes, not component wrappers or a UI framework.

| Recipe                                                         | Use                                                 |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `ui-glass`                                                     | Owning window/inspector surface                     |
| `ui-frame`, `ui-body`                                          | Window header finish and compact content padding    |
| `ui-well`                                                      | Opaque reading/data area within a window            |
| `ui-button`, `ui-tab`                                          | Flat window buttons and tabs                        |
| `ui-input`, `ui-label`                                         | Inputs/selects and local form-field grouping        |
| `ui-hud-input` with `ui-input`                                 | Transparent chat entry, not a window well           |
| `ui-hud-button`, `ui-readout`                                  | Compact glyph controls and text over the game       |
| `ui-meter` with health/stamina/mana modifier                   | Solid vital fills                                   |
| `ui-disclosure`                                                | Compact expandable diagnostic group                 |
| `ui-option`                                                    | Selected autocomplete result, using `aria-selected` |
| `ui-error`, `ui-tooltip`                                       | Error surface and compact tooltip                   |
| `ui-muted`, `ui-mono`, `ui-danger`, `ui-warning`, `ui-success` | Text roles                                          |

Example window structure:

```html
<section class="ui-glass">
	<header class="ui-frame">Diagnostics</header>
	<div class="ui-body">
		<button class="ui-button" aria-pressed="true">Profiling</button>
	</div>
</section>
```

Use actual `disabled`, `aria-pressed`, or `aria-selected` state rather than
parallel styling-only active flags. Keep selection distinct from keyboard focus.
Native checkboxes/ranges share the accent and focus rules; do not rebuild their
behavior or draw a second metallic slider system.

Shared readout decoration uses low-specificity relative positioning so local
absolute/fixed placement wins. Its pseudo-elements are non-interactive and stay
behind their owner. Decorative effects must not own pointer routing. Clip overflowing
text inside the readout rather than clipping its feathered decoration.

`LayoutControls.svelte` owns the shared move/resize corner buttons for HUD panels
and the minimap. Their owners provide the gesture handlers and use
`ui-layout-editable` for the edit outline. Keep map-specific square resizing in
the minimap rather than adding it to the shared controls.

## Transparency, focus, and motion

The explicit `UiThemePreferences.reducedTransparency` preference forces surface
opacity to 1 and turns backdrop filtering off. It does not flatten useful HUD
edge fades into large rectangles. The unsupported-filter baseline is opaque;
feature detection enhances it with transparency. Zero blur produces `none`,
not a zero-radius filter that still creates a containing block.

Apply changes through the cold, injected seam:

```ts
applyUiTheme(document.documentElement, completeTheme, {
	reducedTransparency: true,
});
```

This updates variables in place. Do not put theme state into renderer/session
construction effects, frame loops, or network projections.

Filter once per owning surface. Nested ordinary glass surfaces use an opaque
well-like presentation without another filter. True modal dialogs use native
`showModal()`: the browser top layer escapes filtered ancestor containing blocks.
DOM ancestry alone does not describe a top-layer dialog's compositing ancestry.
Let the browser close the connected dialog and restore focus before removing the
component. A modal still owns an independent viewport-input-gate blocker.

Reduced motion disables control transitions; never animate blur or layout.
Project specimen targets are 4.5:1 for informational text and 3:1 for essential
boundaries/focus against adjacent composited colors. Disabled text remains
readable. A different user palette needs fresh contrast checks; type safety cannot
prove visual accessibility.

## Extension rules and exceptions

Add a role only for a named consumer that genuinely needs independent control.
Do not add per-component token registries, arbitrary CSS objects, fallback aliases,
or a theme framework. A shared recipe must own its state treatment, not merely
rename scattered color literals.

Component-local CSS may retain dimensions, grids, clipping, scrolling, text
wrapping, semantic role mappings, and purpose-specific visualization. Legitimate
exceptions include:

- Chat classification remains in `client-chat-policy.ts`; CSS maps its roles to
  theme colors without classifying messages again.
- Map terrain, blips, view cones, and high-contrast SVG visualization strokes
  remain map-owned. DOM minimap controls and coordinate text are themed.
- Texture atlas checkerboards, bounds, selected placements, and preview pixels
  remain diagnostic visualization. The surrounding modal is themed.
- Color-grading curve/channel visualization remains grading-owned.
- World nameplates, selection outlines, particles, portals, lighting, and scene
  colors remain renderer/game tuning, not UI appearance.
- Black in an alpha mask is opacity information, not a competing text/surface
  color. Transparent decorative borders and geometry likewise are not palette roles.

The walnut detail is original procedural CSS, not a borrowed image. Grain strength
zero gives a texture-free frame; there are no theme bitmap assets or remote fonts.

## Verification and future settings

Use `npm run test:ts -- src/app/ui-theme.test.ts` for projection invariants.
Tests use explicit fixture values, never freeze the current default palette.
Run the normal type/Svelte, ESLint, Knip, and formatting checks too.

The browser specimen is diagnostic infrastructure:

```sh
npm run harness:browser -- --ui-theme --gpu --viewport-width 1280 --viewport-height 807 --building-radius 1 --camera-height 28 --camera-pitch -15 --camera-yaw 35 --settle-ms 2000 --screenshot /tmp/espresso-aero.png
npm run harness:browser -- --client-hud --brief --screenshot /tmp/espresso-client.png
```

For native Explorer tabs/modal checks and repeated transparency measurements,
launch `HOLTBURGER_ELECTRON_REMOTE_DEBUGGING_PORT=0 npm run dev:explorer`, then run
`npm run probe:explorer:theme -- <printed CDP port> /tmp/espresso-explorer`.
It uses local content, not a game server. It changes the diagnostic scene/control
state and temporarily intercepts the report export instead of writing the clipboard.
The probe restores the default theme and clipboard implementation when finished.
Append `modal` after the output prefix to measure the settled full-size texture
dialog instead of the Frame panel. Its browser/compositor window is modal-only;
the renderer aggregate is exported after dismissal and includes surrounding frames.
Do not edit application source during a browser capture.

The alternate specimen fixture proves complete-theme injection without shipping
a second product theme. Per-install persistence, override precedence, import/export,
untrusted-data validation, and an in-app editor remain future work. Resolve those
settings into one complete theme plus explicit preferences before application;
components should not learn where the configuration came from.
