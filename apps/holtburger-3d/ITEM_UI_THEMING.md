# Item UI theme hooks

`ItemGridCell` and `ItemGridStrip` own square sizing, overflow, and scroll behavior.
Their appearance comes from shared recipes in `src/app/ui-base.css`. Theme CSS
belongs in the `theme` layer, after `components`; user overrides belong in
`overrides`. Properties can be scoped to a panel or inherited from the theme root.
Grid density, artwork scaling, strip glyphs and inventory layout defaults are declared
in the `:root` block of `src/app/ui-base.css`; components consume those variables
without repeating defaults. Palette-dependent appearance recipes still resolve
their fallbacks at the consumer.

## Selection

Cells and inventory section headers share `.ui-item-selection[aria-pressed="true"]`.
Selection does not change their geometry. These optional properties control the
whole selection decoration, rather than prescribing a colored border:

| Property | Base fallback |
| --- | --- |
| `--ui-item-selection-color` | `--ui-color-active` |
| `--ui-item-selection-outline` | `2px solid currentColor` |
| `--ui-item-selection-outline-offset` | `-2px` |
| `--ui-item-selection-shadow` | `none` |
| `--ui-item-selection-background` | `transparent` |

Holtburger Standard sets the outline to `none`, adds an inset/outer golden glow,
and uses warm gold text and a light gold tint. The inset glow remains visible
when a cell is against a clipping boundary. Keyboard focus has its own outline
using `--ui-color-focus`, independent of selection. Cells repeat the selection
outline/glow on a pointer-transparent overlay above opaque icon artwork.

## Cells and empty slots

`.ui-item-cell` supports `--ui-item-cell-background`, `--ui-item-cell-border`,
`--ui-item-cell-radius`, `--ui-item-cell-color`, and `--ui-item-cell-hover-color`.
Empty cells expose `[data-empty="true"]` and support `--ui-item-empty-background`,
`--ui-item-empty-border`, and `--ui-item-empty-opacity`. They remain disabled.
The inherited HUD backing can also be changed with the existing
`--ui-hud-button-background` property scoped to these classes.

## Strip arrows

`.ui-item-strip-arrow` supports `--ui-item-strip-arrow-background`,
`--ui-item-strip-arrow-border`, `--ui-item-strip-arrow-radius`,
`--ui-item-strip-arrow-color`, and `--ui-item-strip-arrow-hover-color`.
`--ui-item-strip-up-glyph` and `--ui-item-strip-down-glyph` accept CSS content
strings (default `"▲"` and `"▼"`); accessible button labels remain independent.

## Density and layout

| Property | Default |
| --- | --- |
| `--ui-item-cell-padding` | `1px` |
| `--ui-item-cell-min-size` | `36px` |
| `--ui-item-grid-gap` | `5px` |
| `--ui-item-strip-inset` | `5px` |
| `--ui-item-strip-arrow-height` | `18px` |
| `--ui-inventory-padding` | `10px` |
| `--ui-inventory-section-gap` | `14px` |
| `--ui-inventory-divider` | `1px solid currentColor` |

`--ui-item-cell-min-size` is the shared cell-size basis: contents-grid cells start
at that size and expand to fill each row; pack-strip cells use that size exactly.
The strip adds its horizontal insets, and the inventory panel allocates space for
the resulting width plus its divider. No independent strip-width setting is needed.
Cell-edge navigation measures the rendered layout, so changing the basis does not
require changing the scroll implementation.

## Stack counts

`ItemGridCell` accepts an optional `count`, displaying it only above one on occupied
cells. Quantity is an entity fact, independent of prepared artwork and its cache key.
The bottom-right overlay does not consume pointer events or alter cell geometry and
sits above artwork/selection. The button's accessible label and tooltip contain the
full quantity. Its visual snippet receives that full label, so an `ItemIcon` diagnostic
tooltip can preserve quantity while the fallback text keeps the item name.

Defaults are declared in `ui-base.css`:

| Property | Default |
| --- | --- |
| `--ui-item-count-font` | `bold 20px / 1 Arial, Helvetica, sans-serif` |
| `--ui-item-count-color` | `#fff` |
| `--ui-item-count-shadow` | Four 1px black diagonal shadows |
| `--ui-item-count-background` | `transparent` |
| `--ui-item-count-inset` | `1px` |

Counts through 999 use integer text. Larger counts use `K`, `M`, or `B` with one
decimal place (`1000 → 1.0K`, `1250000 → 1.3M`). Rounding can advance to the next
suffix (`999950 → 1.0M`). The exact quantity remains in accessible labels and
tooltips. Exceptionally narrow theme settings can still ellipsize the overlay;
adjust the shared cell-size basis or count font/inset when more room is needed.

## Icon artwork and ownership

`ItemGridCell` accepts a decorative `visual` snippet while retaining the accessible
name and tooltip on its button. `ItemIcon` displays a prepared 32×32 PNG or the item
name while loading/unavailable. Degraded/failed visuals include diagnostic detail
in their tooltip; the button keeps the item name as its accessible label. Empty slots render neither art nor fallback text.
`--ui-item-icon-rendering` defaults to `pixelated`; themes may select another CSS
`image-rendering` value. Cell padding and size control enlargement without changing
prepared-image identity or baking selection decoration into the image.

`ClientApp` creates `ClientInventoryState` and `ItemIconRepository` before lifecycle
startup. Inventory maintains references while hidden and derives sorted sections
when consumed. Equal specifications share a retained URL across items and surfaces.
The mounted panel borrows display references until Svelte commits replacements;
closing it releases those temporary borrows, while inventory retains its resources.
A future persistent consumer can use the same repository's owner/retain/read/release
API without depending on inventory or scene rendering. Dispose that consumer's owner
when its actual model lifetime ends. Missing required artwork reports context once
per retained failure and leaves a selectable name fallback; missing optional artwork
retains the available composite and reports its omitted layer.
