# Item UI theme hooks

`ItemGridCell` and `ItemGridStrip` own square sizing, overflow, and scroll behavior.
Their appearance comes from shared recipes in `src/app/ui-base.css`. Theme CSS
belongs in the `theme` layer, after `components`; user overrides belong in
`overrides`. Properties can be scoped to a panel or inherited from the theme root.

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
using `--ui-color-focus`, independent of selection.

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
| `--ui-item-cell-padding` | `4px` |
| `--ui-item-cell-min-size` | `56px` |
| `--ui-item-grid-gap` | `5px` |
| `--ui-item-strip-inset` | `5px` |
| `--ui-item-strip-arrow-height` | `18px` |
| `--ui-inventory-strip-width` | `68px` |
| `--ui-inventory-padding` | `10px` |
| `--ui-inventory-section-gap` | `14px` |
| `--ui-inventory-divider` | `1px solid currentColor` |

Keep strip width large enough for the desired cell width, horizontal insets, and
divider. Cell-edge navigation measures the rendered layout, so changing these
values does not require changing the scroll implementation.
