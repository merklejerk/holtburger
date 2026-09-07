# CSS UI themes

Client and Explorer share document-wide CSS themes. Components own arrangement and
interaction; themes own appearance. Renderer and host lifetimes do not depend on
stylesheet changes.

## Edit points

| Concern                                   | Owner                                    |
| ----------------------------------------- | ---------------------------------------- |
| Holtburger Standard colors and decoration | `src/app/themes/holtburger-standard.css` |
| Neutral tokens and shared control states  | `src/app/ui-base.css`                    |
| Stylesheet loading and replacement        | `src/app/ui-theme.ts`                    |
| Startup selection                         | `src/app/mount.ts`                       |
| Browser defaults and cascade order        | `src/app/base.css`                       |
| Initial client HUD arrangement            | `src/client/client-ui-defaults.ts`       |
| Explorer layout                           | `src/explorer/explorer.css`              |

`mountEntry` loads the selected theme before mounting Svelte. Its optional URL
arguments select a replacement theme and an override sheet; the defaults select
Holtburger Standard with no override. Both bundled and caller-supplied stylesheets use
this same loader. There is no theme picker or saved selection yet.

## Authoring a replacement or override

The cascade order is `base, components, theme, overrides`. Svelte styles and
Explorer layout live in `components`. A replacement stylesheet uses `@layer theme`;
a small override uses `@layer overrides`. Follow that convention: unlayered rules
outrank ordinary layered rules, and `!important` reverses layer precedence.
Neither is necessary for supported customization.

A replacement starts from the neutral base and does not inherit Holtburger Standard.
Tokens belong on `:root`; styling hooks are ordinary classes under `.ui-theme`.
For example, a replacement can change materials as well as palette:

```css
@layer theme {
	:root {
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
```

An override may change a single token or an entire appearance rule:

```css
@layer overrides {
	.ui-theme .ui-panel {
		background: var(--ui-color-surface);
		backdrop-filter: none;
	}
}
```

Load a selection through the app-owned loader:

```ts
import { uiThemes } from "./src/app/mount";

await uiThemes.replace(themeUrl, overrideUrl); // null means no override
```

Requests are serialized. Both sheets load before publication; a resource failure
rejects the request and preserves the previous selection. Removing an override or
replacing a theme removes its stylesheet rather than retaining its declarations.
CSS syntax and property values follow browser parsing rules; successful loading
does not certify that every declaration is valid. The loader does not sanitize CSS.
`createUiThemeLoader(document)` provides an independent owner for isolated documents;
`dispose()` releases its sheets after pending requests finish.

Use URLs that the current app document can load. Relative `url(...)` and CSS imports
resolve from the stylesheet location, so distribute images/fonts beside the sheet.
Bundled Holtburger Standard is imported as a Vite asset URL, including in built entries.
User-file discovery and an Electron file-serving policy remain separate work;
a filesystem path is not automatically a browser-loadable URL.

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
| `--ui-option-background`, `--ui-option-border-color`                                                                                                        | Full background and border color for `ui-option` list rows. Rows implemented as `ui-button` use button properties.                    |
| `--ui-input-background`, `--ui-input-border-color`                                                                                                          | Full background and border color for inputs. Use `::placeholder`, `:disabled`, and `[aria-invalid="true"]` for text and state colors. |

Chat retains independent `--ui-chat-<category>-text` colors for `system`, `npc`,
`error`, `combat`, `trade`, `emote`, `party`, `tell`, `guild`, and `society`.
Ordinary speech inherits the chat's text color. These are data categories, not
interaction states.

Variables ending in `-background` accept gradients or `none`. The button background
color is also used in disabled-state color arithmetic. Color variables accept alpha and
`transparent`; `none` is not a color. The HUD indicator is an underline, separate
from text-control borders. Variables beginning `--_ui-` are private implementation
details, not theme controls.

For example, inside Holtburger Standard's existing `@layer theme` block:

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
The default theme uses selected/checked, then hover, then physical-press order.
Disabled controls are excluded from its interaction selectors.

Palette fallbacks still resolve locally when a component property is unset. Use the
palette tokens for shared text and state colors, then scope ordinary `color` rules to
an individual control when it needs an exception.

Holtburger Standard additionally owns `--holtburger-header-stripe-color` (color) and
`--holtburger-header-grain-opacity` (0–1), limited to its decorative header strip.
Replacement themes need not implement them. Use ordinary CSS for other styling;
a property does not need a variable for every state or component instance.

| Hook                                                           | Role                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `ui-hud-surface`                                               | HUD backing on an element itself (chat, meters, map frame) |
| `ui-panel`                                                     | Window, inspector, or dialog surface                       |
| `ui-frame`, `ui-body`                                          | Panel header and content                                   |
| `ui-well`                                                      | Reading/editing area                                       |
| `ui-button`, `ui-tab`                                          | Buttons and tabs                                           |
| `ui-input`, `ui-label`                                         | Inputs/selects and field grouping                          |
| `ui-hud-input`                                                 | HUD chat entry, combined with `ui-input`                   |
| `ui-hud-button`, `ui-readout`, `ui-hud-group`                  | HUD icon actions, readouts, and shared HUD backings        |
| `ui-meter`, `ui-meter--health/stamina/mana`                    | Vital meters                                               |
| `ui-disclosure`, `ui-option`                                   | Expandable groups and selectable results                   |
| `ui-error`, `ui-tooltip`                                       | Errors and tooltips                                        |
| `ui-muted`, `ui-mono`, `ui-danger`, `ui-warning`, `ui-success` | Text roles                                                 |
| `ui-layout-editable`, `ui-icon-button`, `ui-tabs`              | Edit outline, icon controls, tab groups                    |

Use actual `disabled`, `aria-pressed`, `aria-selected`, and `aria-invalid` states.
Keep keyboard focus distinct from selection. Native range and checkbox controls
retain their behavior. Theme authors should preserve visible focus and readable
contrast and respect the existing reduced-motion styling.

Selected tabs/options use `aria-selected="true"`; toggle buttons and the showcase's
page buttons use `aria-pressed="true"`. Dock buttons use that same accessible toggle
state to indicate an open panel. Physical pointer press is `:active`.

HUD icon backgrounds affect their feathered `::before` backing, keeping the button
itself transparent. `ui-hud-group` owns one shared backing for adjacent HUD content;
child readouts and icon buttons remain transparent inside it. Use `ui-button` or `ui-tab`
for text controls even when they live in the HUD; reserve `ui-hud-button` for icon actions.
Recipes consume the same component
properties in every state and supply palette-based defaults when those properties
are unset. The theme chooses state colors through CSS selectors.

## Ownership and theme behavior

Components retain grids, positioning, scrolling, clipping, pointer routing, and
purpose-specific visualization. Inline panel rectangles belong to layout state.
Themes can change appearance and control spacing, but arbitrary CSS can disrupt
layout; cascade layers are an authoring convention, not isolation or enforcement.

Map terrain/blips, texture checkerboards, grading plots, world nameplates, selection
outlines, lighting, and scene colors remain visualization-owned. Chat classification
remains in client policy; CSS consumes its semantic roles.

Holtburger Standard is the bundled default, with no fixed aesthetic contract.
Edit its stylesheet freely; the shared hooks and loader do not prescribe its look.

If a theme uses backdrop filtering, provide an opaque fallback when unsupported.
Avoid compounding filters on ordinary nested panels. Native modal dialogs can own
an independent filter because the browser top layer escapes ancestor composition.

## Backdrop controls

Set `--ui-backdrop-filter` on `:root` for shared filtering, or on specific surfaces
for local filtering. It accepts `none` or filter functions such as `blur(12px)`.
For example, a HUD-only treatment uses the same property:

```css
.ui-theme
	:is(.ui-readout, .ui-hud-group, .ui-hud-button, .ui-hud-surface, .ui-meter) {
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

Save `src/app/themes/holtburger-standard.css`, then click **Reload theme**. Reload
requests fresh stylesheet URLs without remounting components, preserving drafts,
selection, and window placement. A failed load leaves the previous theme active
and displays an error. Theme asset updates are accepted at the Vite module boundary
so edits do not trigger a full-page reload. Changes to component source still use
Svelte's normal development behavior.

The route loads its composition lazily. It does not load world/presentation owners,
create a canvas, or start a content host. A few shared tuning-policy modules and
the components' bounded UI sampling timers are still used. The GPU-backed minimap
and rendered world remain covered by the client/browser harness, not this showcase.

The older `?ui-theme=1` recipe specimen remains a separate diagnostic for controlled
contrast and material tests; it is not the production-component showcase.

## Verification

Run the normal Svelte/TypeScript, ESLint, Knip, formatting, and build checks. The
browser specimen tests independent replacement, override precedence/removal,
resource failure recovery, queued selections, DOM identity, interaction, contrast, and filter fallback.
Its Steel and opaque stylesheets are diagnostic fixtures, not shipped selections.

```sh
npm run harness:browser -- --ui-showcase --screenshot /tmp/ui-showcase.png
npm run harness:browser -- --ui-theme --gpu --viewport-width 1280 --viewport-height 807 --building-radius 1 --camera-height 28 --camera-pitch -15 --camera-yaw 35 --settle-ms 2000 --screenshot /tmp/css-themes.png
npm run harness:browser -- --client-hud --brief --screenshot /tmp/css-client.png
```

For native Explorer checks, launch
`HOLTBURGER_ELECTRON_REMOTE_DEBUGGING_PORT=0 npm run dev:explorer`, then run
`npm run probe:explorer:theme -- <printed CDP port> /tmp/css-explorer`.
Append `modal` to measure the texture dialog. This uses local content and changes
diagnostic controls; it restores the default theme when finished.
