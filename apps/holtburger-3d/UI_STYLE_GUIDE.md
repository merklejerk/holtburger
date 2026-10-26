# CSS UI themes

Client and Explorer share document-wide CSS themes. Components own arrangement and
interaction; themes own appearance. Renderer and host lifetimes do not depend on
stylesheet changes.

## Edit points

| Concern                                               | Owner                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| Shipped appearance, tokens, and shared control states | `src/app/ui-base.css`                                           |
| Stylesheet loading and replacement                    | `src/app/ui-theme.ts`                                           |
| Client selection and bootstrap                        | `src/app/ui-theme-selection.ts`, `src/client/main.ts`           |
| Desktop discovery and serving                         | `electron/ui-theme-catalog.ts`, `electron/ui-theme-protocol.ts` |
| Browser defaults and cascade order                    | `src/app/base.css`                                              |
| Initial client HUD arrangement                        | `src/client/client-ui-defaults.ts`                              |
| Explorer layout                                       | `src/explorer/explorer.css`                                     |

`mountEntry` imports the complete base appearance from `ui-base.css`. Its optional URL
arguments select a theme and an override sheet, loaded before mounting Svelte. Both
default to `null`, so ordinary startup requires no optional stylesheet. The client
then restores its selected theme after settings load and before mounting its UI.
Explorer retains Base.

## Authoring a replacement or override

The cascade order is `base, components, theme, overrides`. Svelte styles and
Explorer layout live in `components`. A replacement stylesheet uses `@layer theme`;
a small override uses `@layer overrides`. Follow that convention: unlayered rules
outrank ordinary layered rules, and `!important` reverses layer precedence.
Neither is necessary for supported customization.

For outward window frames, `--ui-window-frame-outset` is the shared CSS length
for frame paint and floating-window resize targets (Base: `0px`, Traveler’s Kit:
`5px`). Use it as the window's `border-image-outset`; the window shell extends
all eight resize targets to cover that paint, including the underlying 1px panel
border, without changing content layout or saved window dimensions. Compact
non-window overlays may use a separate decorative outset.

Optional themes inherit the shipped base appearance for properties they do not set.
Tokens belong on the scope root (`:scope`); styling hooks are ordinary classes under `.ui-theme`.
Wrap optional theme rules in `@scope (:root) to (.client-pregame-screen)` so
pregame and its descendants retain their independently authored appearance.
Base token defaults are declared again at that boundary to stop inherited theme
palette and component defaults. Typography preferences (font roles, text scale,
and icon scale) continue to inherit across modes; pregame retains its existing
body/heading font overrides. The scope also excludes modal dialogs in the
pregame subtree, even when the browser paints them in the top layer.
Traveler’s Kit follows this convention; custom stylesheets must follow it too.
For example, a theme can change materials as well as palette:

```css
@scope (:root) to (.client-pregame-screen) {
	@layer theme {
		:scope {
			--ui-color-surface: #172530;
			--ui-color-control: #304553;
			--ui-color-accent: #a2d7e9;
			--ui-font-heading: Arial, sans-serif;
		}
		.ui-theme .ui-panel {
			background: var(--ui-color-surface);
			border-style: dashed;
			box-shadow: none;
		}
		.ui-theme .ui-button {
			border-radius: 8px;
		}
	}
}
```

An override may change a single token or an entire appearance rule:

```css
@scope (:root) to (.client-pregame-screen) {
	@layer overrides {
		.ui-theme .ui-panel {
			background: var(--ui-color-surface);
			backdrop-filter: none;
		}
	}
}
```

Load a selection through the app-owned loader:

```ts
import { uiThemes } from "./src/app/mount";

await uiThemes.replace(themeUrl, overrideUrl); // either URL may be null
await uiThemes.replace(null, null); // restore the base appearance
```

Requests are serialized. All selected sheets load before publication; a resource failure
rejects the request and preserves the previous selection. Removing an override or
replacing a theme removes its stylesheet rather than retaining its declarations.
CSS syntax and property values follow browser parsing rules; successful loading
does not certify that every declaration is valid. The loader does not sanitize CSS.
`createUiThemeLoader(document)` provides an independent owner for isolated documents;
`dispose()` releases its sheets after pending requests finish.

Use URLs that the current app document can load. Relative `url(...)` and CSS imports
resolve from the stylesheet location, so distribute images/fonts beside the sheet.
Bundled optional stylesheets can be imported as Vite asset URLs, including in built entries.
The base appearance is a normal CSS import and updates through Vite CSS HMR.
Desktop theme discovery and asset serving are owned by Electron; a filesystem path
is not passed directly to the stylesheet loader.

## Built-in themes

**Traveler’s Kit** ships alongside Base and is available in pregame or in-game
**Settings → UI → Theme**. Traveler’s Kit is the client default. It uses leather,
stitching and copper fittings while retaining transparent content backgrounds.
Selection, reload and saved preferences use the same owner as local themes.
`src/app/ui-bundled-themes.ts` composes trusted Vite-emitted assets with the
validated desktop transport; native URL validation remains unchanged.

The name `Traveler’s Kit` is reserved. A local folder with that exact name makes
catalog refresh report a collision; rename the folder and refresh. Previously
available choices remain usable. Built-in choices remain available even if user
folder discovery fails or times out. No built-in files are installed into the
user-data directory.

## Installing and using local themes

In either client settings surface, open **UI → Theme → Open themes folder**. This
opens `themes/` under the current Electron user-data profile. Development and
packaged profiles have separate directories; overriding `--settings-file` does
not move the theme directory.

Each immediate subdirectory containing `theme.css` is a theme. The folder name is
its ID and display label. Spaces and Unicode are supported; use a portable folder
name without path separators or Windows-reserved filename characters.

```text
themes/
  Midnight Blue/
    theme.css
    styles/controls.css
    images/panel.png
    fonts/heading.woff2
```

For example, `theme.css` may contain (imported control styles must use the same scope):

```css
@import url("./styles/controls.css");

@font-face {
	font-family: "Midnight Heading";
	src: url("./fonts/heading.woff2") format("woff2");
}

@scope (:root) to (.client-pregame-screen) {
	@layer theme {
		:scope {
			--ui-font-heading: "Midnight Heading", serif;
			--ui-color-accent: #a2d7e9;
		}
		.ui-theme .ui-frame {
			background: url("./images/panel.png") repeat;
		}
	}
}
```

Click **Refresh list**, then select the theme. Selection applies immediately and
is remembered in the client UI settings section. **Reload theme** rereads the
selected bundle without restarting the client or clearing drafts/window layout.
Reload gives relative CSS imports, images, and font sources new URLs too. There
is no automatic filesystem watching. Keep asset URLs relative to their stylesheet
and within the theme folder; nested CSS may use `../` to reach sibling assets.

Supported files are CSS, PNG, JPEG, GIF, WebP, AVIF, SVG, ICO, WOFF, WOFF2, TTF, and
OTF. Electron serves these through `holtburger-theme://local/...`; it checks real
paths and rejects escapes outside a theme or the themes directory, including
symlink escapes. Remote resources are not enabled by this feature. The same
resource permissions apply in development and built-file entries.

Explicit Body/Heading/Monospace font preferences take precedence over inherited
theme defaults. Choose **Theme default** to use a theme's font. Existing scoped
pregame styling remains in the `overrides` layer. Custom CSS is not isolated from
layout; follow the shared hooks and layer conventions.

Base ships Arimo (body), Gelasio (headings), and Cousine (monospace), including
regular, bold, italic, and bold italic. Pregame and explicit font preferences use
these same families. `src/app/ui-fonts.css` loads the bundled files without host
font substitution or network requests. Generic fallbacks cover loading failures
and missing glyphs; `font-display: swap` allows text to appear while files load.
Sources and redistribution licenses ship in `public/fonts/` (built `dist/fonts/`).
Traveler’s Kit reuses those same bundled families; its serif HUD/header treatments
use Gelasio rather than introducing another font.

**Bundle any additional font your theme introduces.** Include its redistribution
license and every weight/style the theme uses, then load it with `@font-face`.
For local themes, keep font files inside the theme folder and use relative URLs
as in the example above. Shipped themes should package font files with the app
(e.g. under `public/fonts/`) and retain their notices. Avoid relying on a host
installation or `local()` substitution for consistent rendering and metrics;
generic fallback families should remain available for loading failures and
missing glyphs.

A failed selection keeps the previous appearance and preference. If a saved theme
is missing at startup, Base is active and the unavailable preferred ID remains
visible for retry. Restore its folder and use Reload, or explicitly select Base.
Refresh list alone never changes the saved preference. `--ignore-config` starts
with the current default Traveler’s Kit through the existing configuration bypass; it does not delete
installed themes.

The load deadline is `UI_THEME_LOAD_TIMEOUT_MS` in `src/app/ui-theme-contract.ts`.
Closing cancels pending selection work before settings flush; a selection still
loading when close begins is not saved. A disk-save error uses the existing
settings failure/retry path and does not roll back the applied appearance.

Stylesheet success is not whole-bundle validation. Invalid CSS follows browser
parsing rules; missing/corrupt images and fonts retain browser fallback behavior
and produce resource diagnostics. Combat font-load failures also show a warning
instead of failing application startup. Files are read live, so editing multiple
files during a reload is not an atomic bundle replacement.

The programmatic loader's optional override slot remains available for diagnostics
and composition. The user picker selects one theme; no manifest, editor, archive
installer, or Explorer theme picker is included.

Run `npm run probe:user-themes` for automated Electron checks of serving,
dependency reloads, fonts, cancellation/timeouts, both settings surfaces,
persistence, bundled assets, collisions, and missing-theme recovery. Pass `-- --package-root out/holtburger-3d-linux-x64` to `npm run probe:user-themes:built`
to also load the diagnostic entry and theme assets from a Forge package’s ASAR
(use the matching platform/architecture directory). The fixture fonts and images are original
checked-in diagnostic assets; no game files or system fonts are needed.

With local game content available, run
`npm run harness:browser -- --user-theme-lifecycle --brief` to switch themes on the
real ClientApp roster and during gameplay while verifying canvas/runtime retention.

## Tokens and styling hooks

Palette and font defaults live on `:root` in `ui-base.css`. Component variables are
optional: recipes resolve their defaults at the styled element. A component property
has the same name in every state; use CSS selectors to change its value for hover,
physical press, selection, an open panel, or disabled controls.

| Variables                                                                                                                                                   | Accepted values and consumers                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--ui-color-text`, `--ui-color-muted`, `--ui-color-surface`, `--ui-color-well`, `--ui-color-control`                                                        | Palette colors for text, secondary text, surfaces, recessed areas, and controls.                                                      |
| `--ui-color-border`, `--ui-color-highlight`, `--ui-color-shadow`, `--ui-color-accent`, `--ui-color-focus`                                                   | Palette colors for borders, highlights, decorative shadows, accents, and keyboard focus.                                              |
| `--ui-color-active`                                                                                                                                         | Foreground color for active or open HUD controls.                                                                                     |
| `--ui-color-danger`, `--ui-color-warning`, `--ui-color-success`                                                                                             | Status-feedback colors.                                                                                                               |
| `--ui-color-health`, `--ui-color-stamina`, `--ui-color-mana`                                                                                                | Vital-bar colors, independent of chat.                                                                                                |
| `--ui-font-body`, `--ui-font-heading`, `--ui-font-mono`                                                                                                     | CSS font-family lists.                                                                                                                |
| `--ui-font-size-body`, `--ui-font-size-heading-1`, `--ui-font-size-heading-2`, `--ui-font-size-heading-3`, `--ui-font-size-caption`, `--ui-font-size-micro` | Semantic font sizes for shared body, headings, captions, and compact HUD text.                                                        |
| `--ui-line-height-body`, `--ui-line-height-heading`                                                                                                         | Unitless line heights for shared body and heading text.                                                                               |
| `--ui-radius-surface`, `--ui-radius-control`                                                                                                                | CSS lengths.                                                                                                                          |
| `--ui-panel-background`                                                                                                                                     | Full CSS background for panels. Defaults to the surface palette color with surface opacity; nested panels default to opaque.          |
| `--ui-surface-shadow`                                                                                                                                       | Full CSS box-shadow for panels and tooltips, including `none`.                                                                        |
| `--ui-hud-background-color`                                                                                                                                 | CSS color for HUD backings and chat's color-based fade. Defaults to the surface palette color with surface opacity.                   |
| `--ui-surface-opacity`                                                                                                                                      | Number from 0 to 1 applied to default panel/HUD tints. Explicit backgrounds bypass it.                                                |
| `--ui-backdrop-filter`                                                                                                                                      | CSS backdrop-filter value, including `none`. Shared by panels and HUDs; scope it with selectors for different treatments.             |
| `--ui-easing`                                                                                                                                               | CSS easing function for small interactive motion details.                                                                             |
| `--ui-button-background-color`, `--ui-button-border-color`                                                                                                  | Background color and border color for text buttons and tabs. Disabled buttons desaturate the background color.                        |
| `--ui-hud-button-background`, `--ui-hud-button-indicator-color`                                                                                             | Optional full background for an icon's feathered backing (shared HUD tint by default), and underline color.                           |
| `--ui-hud-control-background`, `--ui-hud-control-indicator-color`                                                                                           | Independent full backing and underline for labelled/compound HUD controls and cells.                                                  |
| `--ui-combat-idle-opacity`, `--ui-combat-emphasis-duration`, `--ui-combat-opacity-transition-duration`                                                      | Whole-component idle opacity, full-emphasis hold time, and fade/hover transition time.                                                |
| `--ui-combat-foreground-color`, `--ui-combat-outline-color`, `--ui-combat-track-color`, `--ui-combat-charge-color`                                          | Combat gauge ink, handle outline, unfilled track, and animated charge colors at full emphasis.                                        |
| `--ui-combat-height-color`, `--ui-combat-height-selected-color`, `--ui-combat-height-hover-color`                                                           | Complete colors for the combat gauge's three attack-height button states.                                                             |
| `--ui-combat-handle-filter`, `--ui-combat-handle-focus-filter`, `--ui-combat-breakpoint-shadow`                                                             | Complete CSS filter and text-shadow recipes for the combat handle and breakpoint labels.                                              |
| `--ui-option-background`, `--ui-option-border-color`                                                                                                        | Full background and border color for `ui-option` list rows. Rows implemented as `ui-button` use button properties.                    |
| `--ui-input-background`, `--ui-input-border-color`                                                                                                          | Full background and border color for inputs. Use `::placeholder`, `:disabled`, and `[aria-invalid="true"]` for text and state colors. |

The Enchantments window shares the spell panel's padding, row, filter, and color
tokens. Its affected-stat headings use `--ui-enchantments-heading-margin`,
`--ui-enchantments-heading-font-size`, `--ui-enchantments-heading-letter-spacing`,
and `--ui-enchantments-heading-text-transform`. The overridden-spell tree uses
`--ui-enchantments-tree-gutter` for both disclosure width and branch indentation;
`--ui-enchantments-child-indent` offsets the child rows within that branch.
The inline More.../Less... school-filter toggle uses the shared `ui-inline-button`
style. Its pills retain the shared filter color, radius, and spacing tokens.

Combat material layers use `.gauge-decoration` (rim, engravings and fasteners)
and `.height-face` (button outlines). Base hides these optional SVG paint layers;
Traveler’s Kit reveals them and hides `.gauge-background`. The component derives
their paths from the same arc and row dimensions used by the hit targets, and
marks the layers as noninteractive. Its per-instance `--combat-metal` URL points
to a locally scoped gradient; it is an internal paint reference, not a theme-size
setting. Themes style the gradient stops with `.gauge-metal-light`,
`.gauge-metal-mid` and `.gauge-metal-dark`. Slider semantics, charge progression,
idle/emphasis opacity and shortcut disclosure remain component-owned.

Spell shortcuts use the same transparent cell face and feathered `ui-hud-control`
backing as action cells. Their blue palette is independent of the mana meter:

| Property                                                                            | Purpose                                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `--ui-spell-bar-color`                                                              | Spell shortcut palette; changing `--ui-color-mana` does not change it.       |
| `--ui-spell-cell-background-opacity`                                                | Opacity of the palette-derived cell backing.                                 |
| `--ui-spell-cell-background`                                                        | Optional complete cell backing (color or gradient).                          |
| `--ui-spell-tab-height`, `--ui-spell-tab-font-size`                                 | Compact tab geometry and typography; HUD extent follows the measured height. |
| `--ui-spell-tab-background-opacity`, `--ui-spell-tab-active-background-opacity`     | Default tab backing opacity for inactive and selected tabs.                  |
| `--ui-spell-tab-background`, `--ui-spell-tab-active-background`                     | Optional complete tab backings.                                              |
| `--ui-spell-tab-color`, `--ui-spell-tab-active-color`, `--ui-spell-tab-hover-color` | Tab text colors; fall back to the shared palette.                            |
| `--ui-spell-tab-border`, `--ui-spell-tab-radius`, `--ui-spell-tab-active-shadow`    | Tab decoration and selected indicator.                                       |
| `--ui-spell-drop-outline`                                                           | Drop-target feedback.                                                        |

Spell and action bar cells follow `--ui-shortcut-cell-size` (40px in Base),
multiplied once by `--ui-icon-scale`. The same measured size determines their
grids, clipping and HUD bounds. Both bars use
the same inward-facing grid button: click to toggle between one ten-cell strip
and two five-cell strips. Spell tabs retain their compact ten-button
row in either shape; toggling shape preserves spell addresses and selected tab.

Chat retains independent `--ui-chat-<category>-text` colors for `system`, `npc`,
`error`, `combat`, `trade`, `emote`, `party`, `tell`, `guild`, and `society`.
Ordinary speech inherits the chat's text color. These are data categories, not
interaction states.

Variables ending in `-background` accept gradients or `none`. The button background
color is also used in disabled-state color arithmetic. Color variables accept alpha and
`transparent`; `none` is not a color. The HUD indicator is an underline, separate
from text-control borders. Variables beginning `--_ui-` are private implementation
details, not theme controls.

For example, inside an optional stylesheet’s `@layer theme` block:

```css
.ui-button {
	--ui-button-background-color: #343c45;
}
.ui-button:hover:not(:disabled) {
	--ui-button-background-color: #455362;
}
.ui-button:active:not(:disabled) {
	--ui-button-background-color: #202933;
}
.shortcut-dock .ui-hud-button[aria-pressed="true"] {
	--ui-hud-button-background: none;
	--ui-hud-button-indicator-color: #8fc5ff;
}
.shortcut-dock .ui-hud-button:hover:not(:disabled) {
	--ui-hud-button-background: #456789;
}
.shortcut-dock .ui-hud-button:active:not(:disabled) {
	--ui-hud-button-background: #805c20;
}
.ui-input::placeholder {
	color: #9ca9b6;
}
.ui-tooltip {
	--ui-surface-shadow: none;
}
```

Normal CSS cascade rules apply: a declaration on the button takes precedence over
one inherited from a container or `:root`. Within a layer, specificity and then source
order decide competing selectors. Put your rules after the defaults, and use equally
specific state selectors (or `:where()` states) when source order should decide.
The base appearance uses selected/checked, then hover, then physical-press order.
Disabled controls are excluded from its interaction selectors.

Palette fallbacks still resolve locally when a component property is unset. Use the
palette tokens for shared text and state colors, then scope ordinary `color` rules to
an individual control when it needs an exception.

The base appearance defines `--ui-header-stripe-color` (color) and
`--ui-header-grain-opacity` (0–1) for the decorative header strip.
Optional themes can override these or replace the header background entirely. Use ordinary CSS for other styling;
a property does not need a variable for every state or component instance.

| Hook                                                            | Role                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `ui-hud-surface`                                                | HUD backing on an element itself (chat, meters, map frame)      |
| `ui-panel`                                                      | Window, inspector, or dialog surface                            |
| `ui-frame`, `ui-body`                                           | Panel header and content                                        |
| `ui-well`                                                       | Reading/editing area                                            |
| `ui-button`, `ui-tab`                                           | Buttons and tabs                                                |
| `ui-input`, `ui-label`                                          | Inputs/selects and field grouping                               |
| `ui-hud-input`                                                  | HUD chat entry, combined with `ui-input`                        |
| `ui-hud-button`, `ui-hud-control`, `ui-readout`, `ui-hud-group` | Standalone icon actions, compound controls, readouts and groups |
| `ui-meter`, `ui-meter--health/stamina/mana`                     | Vital meters                                                    |
| `ui-disclosure`, `ui-option`                                    | Expandable groups and selectable results                        |
| `ui-error`, `ui-tooltip`                                        | Errors and tooltips                                             |
| `ui-muted`, `ui-mono`, `ui-danger`, `ui-warning`, `ui-success`  | Text roles                                                      |
| `ui-layout-editable`, `ui-icon-button`, `ui-tabs`               | Edit outline, icon controls, tab groups                         |

Use actual `disabled`, `aria-pressed`, `aria-selected`, and `aria-invalid` states.
Keep keyboard focus distinct from selection. Native range and checkbox controls
retain their behavior. Theme authors should preserve visible focus and readable
contrast and respect the existing reduced-motion styling.

Selected tabs/options use `aria-selected="true"`; toggle buttons use `aria-pressed="true"`. Dock buttons use that same accessible toggle
state to indicate an open panel. Physical pointer press is `:active`.

HUD controls have two distinct style families. Use `ui-hud-button` for standalone
single-icon actions and `ui-hud-control` for labelled or compound controls, item
cells, party rows and spell tabs. They share Base interaction and focus styling
and retain identical default backing recipes, but expose independent theme hooks.
The standalone icon class is the safe target for circular nailhead treatments;
compound controls keep their feature-owned geometry. `ui-icon-button` remains the
shared icon-layout marker, including for ordinary `ui-button` controls.

`--ui-hud-button-background` and `--ui-hud-button-indicator-color` apply only to
standalone icons. Compound controls use `--ui-hud-control-background` and
`--ui-hud-control-indicator-color`. Backgrounds paint their feathered `::before`
backing, leaving the element transparent in Base. `ui-hud-group` owns one shared
backing for adjacent content; child readouts and both interactive families remain
transparent inside it. Ordinary text commands still use `ui-button` or `ui-tab`.
Item-strip arrows are compound controls with a continuous strip-sized click area;
their `ui-item-strip-arrow` hook can receive a full-width pill face independently
of standalone icon styling.

Recipes consume the same component
properties in every state and supply palette-based defaults when those properties
are unset. The theme chooses state colors through CSS selectors.

### Catalog and Nearby styling

Catalog rows share `--ui-catalog-row-padding`, `--ui-catalog-row-gap`,
`--ui-catalog-details-padding`, `--ui-catalog-details-line-height`,
`--ui-catalog-row-divider-tint`, and `--ui-catalog-details-divider-tint`.
Shared filters and category labels use `--ui-filter-gap`, `--ui-filter-max-height`,
`--ui-filter-pill-radius`, `--ui-filter-pill-padding`, `--ui-filter-tint`, and
`--ui-filter-active-tint`. These replace the former `--ui-spell-filter-*` geometry
and tint names; spell-specific category color tokens keep their existing names.

Entity category icons use `--ui-entity-category-icon-size`. New vector artwork has
`ui-vector-icon` on its SVG root and uses `--ui-icon-stroke-width`; authored fills
and strokes are presentation attributes, so normal CSS rules can override them.
The category icon, label pill, and filter button expose `data-entity-category`
with the stable category key, such as `monster` or `door-or-switch`. For example:

```css
@layer overrides {
	.ui-theme [data-entity-category="monster"] {
		color: #d68d78;
		--filter-color: #d68d78;
	}
}
```

Minimap rim controls share `--ui-minimap-button-size` and
`--ui-minimap-button-radius`. Tracked rings use `--ui-minimap-tracked-color`,
`--ui-minimap-tracked-width`, `--ui-minimap-tracked-gap`,
`--ui-minimap-tracked-dash-length`, and `--ui-minimap-tracked-dash-gap`.
Color values can reference palette variables; lengths support CSS units and
`calc()`. Width must be positive; spacing and dash lengths may be zero.
The existing theme loader's change notification resolves these values for
Canvas2D without recreating the minimap or reading CSS each frame.

`ui-action-row` fills the row when it contains one text button; grouped text
actions keep their natural widths. Inline forms and icon toolbars use their own
layout classes.

## Ownership and theme behavior

Components retain grids, positioning, scrolling, clipping, pointer routing, and
purpose-specific visualization. Inline panel rectangles belong to layout state.
Themes can change appearance and control spacing, but arbitrary CSS can disrupt
layout; cascade layers are an authoring convention, not isolation or enforcement.

Tracked minimap rings use the theme hooks above. Other map terrain/blips, texture
checkerboards, grading plots, world nameplates, selection
outlines, lighting, and scene colors remain visualization-owned. Chat classification
remains in client policy; CSS consumes its semantic roles.

The base appearance has no fixed aesthetic contract. Edit `ui-base.css` freely;
the shared hooks and optional stylesheet loader do not prescribe its look.

If a theme uses backdrop filtering, provide an opaque fallback when unsupported.
Avoid compounding filters on ordinary nested panels. Native modal dialogs can own
an independent filter because the browser top layer escapes ancestor composition.

## Backdrop controls

Set `--ui-backdrop-filter` on `:root` for shared filtering, or on specific surfaces
for local filtering. It accepts `none` or filter functions such as `blur(12px)`.
For example, a HUD-only treatment uses the same property:

```css
.ui-theme
	:is(
		.ui-readout,
		.ui-hud-group,
		.ui-hud-button,
		.ui-hud-control,
		.ui-hud-surface,
		.ui-meter
	) {
	--ui-backdrop-filter: blur(8px);
}
```

Filters apply to readout/button backing pseudo-elements and to
group backings and `ui-hud-surface`/`ui-meter` backings. Nested backings do not compound
filtering. Readout, group, and button masks feather the tint and filter together.

`--ui-hud-background-color` controls the shared HUD tint independently of filtering.
`--ui-hud-button-background` accepts a full background for icon backings specifically;
when unset, icon buttons use the shared HUD tint. Use `ui-hud-group` when adjacent icons
or readouts should share one feathered backdrop instead of rendering separate backings.

## Interactive production-component showcase

From `apps/holtburger-3d`, run:

```sh
npm run dev:ui
```

This opens `/harness/browser/?ui-showcase=1` in your browser. It mounts the real
character HUD, target HUD, chat, FPS readout, jump meter, shortcut dock, toast,
HUD layout wrappers, and draggable/resizable window. Window pages include real
character selection and the diagnostics panel's unavailable state, plus basic
control-state samples. Chat sends append local fixture messages; no server is
contacted. Actions that are unfinished in production remain unfinished here.

Character selection uses `ui-option` list rows with one Tab stop. Arrow keys,
Home/End, and typing a name move selection without entering the world. **Enter World**
is the separate action; double-clicking a row is its mouse shortcut. Selection is
locked while entry is pending.

The Backdrop selector offers checkerboard, fine grid, diagonal stripes, a sky/ground
gradient, and bright/dark backgrounds. **Custom color** exposes a live viewport color
picker and retains your color when switching backgrounds. Choose **Local image** to load a game screenshot
from your computer; it fills the viewport with proportional cropping and stays in
the browser. Background changes preserve component state. The showcase groups HUD
readouts beside chat and the component window, with a reserved area for theme controls.
Narrow viewports stack the specimens in a scrollable column. Production HUD move/resize
handles start hidden; **Unlock UI layout** reveals them and **Lock UI layout** hides them again. Fixed-size components retain their
production resize constraints. **Reset layout** restores the showcase arrangement.
The Debug shortcut reopens a
closed showcase window.

Edit `src/app/ui-base.css` to develop the shipped appearance; Vite updates the CSS
without remounting components. The **Base** selection removes optional stylesheets.
For the Steel fixture or opaque override, save its CSS and click **Reload theme**.
Reload requests fresh optional stylesheet URLs without remounting components,
preserving drafts, selection, and window placement. A failed load leaves the previous
selection active and displays an error. Fixture asset updates are accepted at the
Vite module boundary so edits wait for Reload theme. Changes to component source
still use Svelte’s normal development behavior.

The route loads its composition lazily. It does not load world/presentation owners,
create a canvas, or start a content host. A few shared tuning-policy modules and
the components' bounded UI sampling timers are still used. The GPU-backed minimap
and rendered world remain covered by the client/browser harness, not this showcase.

The sidebar’s **Minimap → Show waypoint guide** toggle sets a sample destination
through the fixture’s navigation owner. It previews the production off-disc arrow
and distance footer; clearing the destination in that footer also clears the
checkbox. This works with every showcase theme and retains the same minimap.
Traveler’s Kit styles the shared north letter and optional
`.minimap-north-ornament` SVG; Base keeps the original cardinal lettering.

The older `?ui-theme=1` recipe specimen remains a separate diagnostic for controlled
contrast and material tests; it is not the production-component showcase.

## Verification

Run the normal Svelte/TypeScript, ESLint, Knip, formatting, and build checks. The
browser specimen tests theme application, base restoration, override precedence/removal,
resource failure recovery, queued selections, DOM identity, interaction, contrast, and filter fallback.
Its Steel and opaque stylesheets are diagnostic fixtures, not shipped selections.

```sh
npm run dev:ui
npm run harness:browser -- --ui-theme --gpu --viewport-width 1280 --viewport-height 807 --building-radius 1 --camera-height 28 --camera-pitch -15 --camera-yaw 35 --settle-ms 2000 --screenshot /tmp/css-themes.png
npm run harness:browser -- --client-hud --brief --screenshot /tmp/css-client.png
```

For native Explorer checks, launch
`npm run dev:explorer -- --debug-port=0`, then run
`npm run probe:explorer:theme -- <printed CDP port> /tmp/css-explorer`.
Append `modal` to measure the texture dialog. This uses local content and changes
diagnostic controls; it restores the default theme when finished.

### Shortcut keycaps

Use `<kbd class="ui-keycap">W</kbd>` for a shortcut key. Settings removal buttons
use the same `ui-keycap` recipe on the button, with their semantic `kbd` content
inside; avoid nesting two keycap backings. The shared recipe uses theme text,
control, border, shadow and control-radius values. `--ui-keycap-size` sets the
minimum square dimension relative to the surrounding font (default `1.65em`);
longer chords can grow wider. It inherits font size and pointer ownership.

The precise-jump HUD places its configured increase/decrease keycaps on a row
below POWER. The bar remains the only pointer target in that HUD.
