# H3D Traveler’s Kit theme plan

Status: implementation and closeout complete. The user accepted the final visual baseline and promoted Traveler’s Kit to the client default. Final static, focused theme/settings and packaged-ASAR checks pass. Existing saved choices and Base remain available; user-requested shared HUD improvements are retained.

## Context and boundaries

**Goal:** Ship a restrained leather-and-copper default client theme that gives h3d an adventurer’s identity while preserving its clean information layout and translucent gameplay windows.

The user prefers concept 1, Traveler’s Kit, with less ornament than the generated reference. The first implementation pulled back too far: subsequent user feedback explicitly requests more skeuomorphism on borders and buttons as well as headers. Preserve current content-background transparency: the opaque interiors in the concept are not the target. Keep Base available, with the explicitly requested shared appearance improvements. The user has now approved Traveler’s Kit as the default client theme; saved explicit theme choices remain intact.

In scope:

- App-local CSS, small decorative assets, existing theme selection and bundled asset delivery.
- Window headers/frames, buttons, tabs, inputs, inventory wells, chat, vitals, minimap rim, shortcut bars, and common overlays.
- A small prototype, explicit user visual review, then consistent rollout and cleanup.
- Reference, intermediate, and production asset provenance tracked here.

Out of scope:

- Gameplay, Rust/shared-crate APIs, world rendering, layout redesign, new icons for game items, or control-policy changes.
- A general skinning engine, runtime slicing service, asset editor, or replacement theme-selection lifecycle.
- Agent visual checks or running the TUI client. The user owns visual review. Do not capture screenshots unless explicitly requested; use static and DOM/interaction checks for agent verification.
- Replacing pregame branding or redesigning Explorer. Shared primitives still need to remain usable in their existing consumers.

## Ground truth and existing patterns

Paths below are relative to the repository root.

| Source | Responsibility / evidence |
| --- | --- |
| `apps/holtburger-3d/AGENTS.md` | UI reuse, app-local boundaries, SVG asset convention, verification rules. |
| `apps/holtburger-3d/src/app/ui-base.css` | Shared palette, font roles, surface opacity, panel/frame/control styling. Panel backings and decorative chrome can be changed independently. |
| `apps/holtburger-3d/src/app/ui-fonts.css` | Existing body/heading font assets; reuse before adding fonts. |
| `apps/holtburger-3d/src/client/ClientHudWindow.svelte` | Shared window markup, drag/resize ownership, close-button hit targets and stacking. Decoration must not intercept these. |
| `apps/holtburger-3d/src/app/UiRange.svelte` | Native range input and its derived fill position; introduced after filled-track feedback. |
| `apps/holtburger-3d/src/app/ItemGridCell.svelte`, `ItemGridStrip.svelte` | Existing item-cell structure; inspect immediate consumers before changing wells or selection states. |
| `apps/holtburger-3d/src/client/ClientChat.svelte` | Independent chat fading/backing behavior; do not replace with a permanently opaque frame. |
| `apps/holtburger-3d/src/client/ClientPartyHud.svelte`, `ClientActionBar.svelte`, `ClientActionBars.svelte`, `ClientSpellBar.svelte` | HUD surfaces outside the common window shell. |
| `apps/holtburger-3d/src/app/Minimap.svelte` | Map/compass presentation and interaction; rim decoration must not alter projection or hit geometry. |
| `apps/holtburger-3d/src/app/ui-theme.ts` | Atomic stylesheet replacement and appearance notifications; switching appearance does not own component lifetime. |
| `apps/holtburger-3d/src/app/ui-theme-selection.ts`, `UiThemeControls.svelte` | Selection, persistence handoff, reload, catalog refresh, failure display, Base choice. |
| `apps/holtburger-3d/src/app/ui-theme-transport.ts`, `ui-theme-contract.ts` | Validates untrusted Electron results and restricts native resource URLs. |
| `apps/holtburger-3d/electron/ui-theme-catalog.ts`, `main.ts` | Native catalog serves user folders under userData; trusted bundled entries are composed in the renderer by `ui-bundled-themes.ts`. |
| `apps/holtburger-3d/forge.config.cjs` | Package includes compiled output; source-only theme files will not automatically ship. |
| `apps/holtburger-3d/src/harness/browser/UiShowcase.svelte`, `ui-showcase-themes.ts` | Existing browser showcase and injected theme capability; use the same production theme assets. |
| `apps/holtburger-3d/scripts/fixtures/user-theme/` | Relative CSS/image/font resources through the existing native theme path. |
| `apps/holtburger-3d/package.json` | Canonical check, lint, build, harness, and theme-probe scripts. |

No protocol or retail behavior changes are involved. The screenshot is a presentation reference, not evidence for gameplay contracts.

### Constraints and concessions

- Keep current translucent content backings and existing opacity settings/behavior. Avoid an opaque image center, overlapping full-panel texture, or new opacity multiplier that quietly obscures gameplay.
- Keep existing semantic colors, item artwork, information density, text/icon scaling, keyboard ownership, and window placement.
- Materials may be suggestive rather than photorealistic. If leather grain cannot remain subtle at UI scale, omit the grain and retain shading/stitching.
- Simplify ornament at minimum supported sizes; never shrink click targets to accommodate a fitting.
- Small reusable assets and CSS should suffice. Any additional abstraction must solve a demonstrated second use.

## North stars

1. Warm craftsmanship, restrained decoration: dark oxblood headers, muted copper edges, ivory text.
2. Gameplay stays visible through content; material detail lives primarily in headers and fittings.
3. Sans serif for dense data; serif for window names and selected section headings.
4. Quiet long borders, brighter small fittings. Avoid framing every row in bright metal.
5. Make materials survive actual UI scale, resizing, and text scaling before broad rollout.
6. One existing theme lifecycle, no per-feature skin state or asset loading owners.
7. Every production asset has a named consumer; every intermediate has a purpose and disposition.

## Illustrations and construction contract

```text
Application presentation layer
  trusted bundled theme URL + validated user-theme transport
                       ↓
           existing UiThemeSelection
                       ↓
           existing document CSS loader
                       ↓
   theme CSS + relative decorative asset URLs
                       ↓
  existing windows / controls / HUD component owners

Window paint, back to front
  existing translucent content backing
  independent border / fixed fittings / header-only material
  existing text, icons and interactive controls
  existing resize/close hit targets remain usable
```

Decorative overlays use `pointer-events: none`; do not disable events on their owning window. Keep resize strips and close-button stacking from `ClientHudWindow`. Reuse existing pseudo-elements carefully: inventory which are already occupied before assigning decoration.

```text
Optional nine-slice source
  fixed corner | horizontal edge | fixed corner
  vertical edge| transparent     | vertical edge
  fixed corner | horizontal edge | fixed corner
```

Nine-slicing preserves corners; it does not create seamless material. A stretched edge needs no periodic seam but may distort detail. A repeated edge must tile along its repeat axis. Corner-to-edge joins must match either way. A header is a separate material region; do not stretch its leather across the content body.

Initial construction used CSS rules/bevels, fixed SVG fittings, mathematically repeating stitches, and faint header grain. After user feedback that borders/buttons were too flat, the second candidate uses an authored SVG with CSS `border-image` for a continuous sculpted copper profile. See I4 for exact slice geometry. No custom slicing runtime.

## Reference and asset ledger

All links here are local and remain usable without the original chat image directory.

| ID | File | Role / status |
| --- | --- | --- |
| R0 | [Current UI](assets/h3d-travelers-kit/references/00-current-ui.png) | User-supplied screenshot; authoritative layout, density and transparency reference. |
| R1 | [Traveler’s Kit](assets/h3d-travelers-kit/references/01-travelers-kit.png) | Preferred generated direction; reduce ornament and restore R0 transparency. |
| R2 | [Field Journal](assets/h3d-travelers-kit/references/02-field-journal.png) | Comparison only; not a second implementation target. |
| R3 | [Portal Relic](assets/h3d-travelers-kit/references/03-portal-relic.png) | Comparison only; violet gems/runes are not part of the selected direction. |
| R4 | [HUD button feedback](assets/h3d-travelers-kit/references/04-hud-button-hybrid.png) | User screenshot of the unwanted hybrid feathered-glass/keycap treatment. Reference for the v09 correction. |
| R5 | [Inventory button feedback](assets/h3d-travelers-kit/references/05-hud-nailhead-overreach.png) | User-supplied screenshot showing nailheads incorrectly applied to pack labels and compound controls. Prompted explicit HUD families; later steering chooses full-width pill strip arrows. |
| R6 | [Combat HUD feedback](assets/h3d-travelers-kit/references/06-combat-hud-feedback.png) | User-supplied crop of the current combat HUD. User finds the shading mistaken/heavy and requests unobtrusive theme-compatible variants. Functional reference for the combat study. |

R1–R3 were produced with the built-in imagegen tool as screenshot edits. The prompts preserved the scene and approximate panel layout. R1 requested oxblood leather headers, restrained stitching, copper fittings, dark felt item wells and ivory text; R2 explored brass/compass/bookcloth; R3 explored charcoal enamel/geometric joints/violet accents. These are prompt summaries, not exact prompt transcripts. Generated layouts, labels, item counts and opacity are not implementation requirements.

Original R1 source: `exec-fe65548d-c85a-4568-8676-03a5e1fd1b40.png`; R2: `exec-272d1ad6-1c0a-4dd1-8b44-a9aea9b6931f.png`; R3: `exec-cc9e815c-c68f-4452-b7d5-62c69b219672.png`, originally under `/home/cluracan/.codex/generated_images/01a17667-62f7-7b63-99fa-3125420df80b/`.

### Intermediate assets

Use `docs/plans/assets/h3d-travelers-kit/intermediate/` for actual working assets. Do not create placeholder image files. Add a row on creation, and preserve the assembled parent before cropping/slicing generated material.

| ID | Artifact | Purpose / disposition |
| --- | --- | --- |
| I1 | [Header grain v01](assets/h3d-travelers-kit/intermediate/header-material-v01.svg) | Candidate; snapshot of production SVG, authored deterministically. 96 × 32 CSS-pixel repeat, fractal noise frequencies 0.375/0.5, 3 octaves, seed 11, periodic noise tiles, alpha slope 0.12. Consumer: theme `.ui-frame` background. No Imagen prompt. |
| I2 | [Copper fitting v01](assets/h3d-travelers-kit/intermediate/rivet-study-v01.svg) | Superseded after the first review; retained source snapshot of the original header-only fitting. Production asset deleted: the nine-sliced frame now owns all four fittings. Original 8 × 8 viewBox rendered at 6 × 6 CSS pixels. No Imagen prompt. |
| I3 | `assembled-frame-v01.png` | Not needed: deterministic materials were accepted. No placeholder file was created. |
| I4 | [Slice map v01](assets/h3d-travelers-kit/intermediate/slice-map-v01.md) | Current nine-slice construction contract: exact source cuts, rendered widths, outset, stretch and center behavior. |
| I5 | [First slice v01](assets/h3d-travelers-kit/intermediate/first-slice-v01.png) | Chromium capture at 1600 × 1000 CSS pixels, device scale 1, after the passing showcase interaction probe. Screenshot for user review, not agent visual acceptance. First candidate, superseded by user feedback. Parent assets I1/I2; synthetic item artwork uses existing app icons. |
| I6 | [Copper frame v01](assets/h3d-travelers-kit/intermediate/copper-frame-v01.svg) | Superseded detail pass; authored assembled SVG, 64 × 64, cuts at 16/48. Consumer: theme `.ui-panel` border image. Construction parameters in I4. No Imagen prompt. |
| I7 | [Theme v01](assets/h3d-travelers-kit/intermediate/theme-v01.css) | Superseded first implementation, preserved before revision. Source snapshot, not a standalone loadable theme. |
| I8 | [Theme v02](assets/h3d-travelers-kit/intermediate/theme-v02.css) | Previous candidate CSS snapshot: sculpted borders, stronger header stitching/bevel and raised/pressed/disabled copper controls. Source snapshot; relative resources resolve from its production location. |
| I9 | [First slice v02](assets/h3d-travelers-kit/intermediate/first-slice-v02.png) | Second candidate Chromium capture at 1600 × 1000, scale 1, after passing interaction probe. Parents I1/I6/I8. User judged it much better, but requested more prominent nailheads and stitching. |
| I10 | [Copper frame v02](assets/h3d-travelers-kit/intermediate/copper-frame-v02.svg) | Current source snapshot; parent I6. Nailhead radius grows from 3 to 4.5 source units (50% wider, 4.5 CSS-pixel face diameter), with 5.25-unit dark seats and stronger highlights. Same slice dimensions and frame footprint. |
| I11 | [Theme v03](assets/h3d-travelers-kit/intermediate/theme-v03.css) | Previous CSS snapshot; parent I8. Stitch thread is 2 CSS pixels high, a 4-pixel dash in an 8-pixel period, with a bright upper strand, darker body and recessed-hole shadow. No generation prompt; authored CSS. |
| I12 | [First slice v03](assets/h3d-travelers-kit/intermediate/first-slice-v03.png) | Current Chromium capture, 1600 × 1000, scale 1. Parents I1/I10/I11. Awaiting user review of the detail prominence. |
| I13 | [Theme v04](assets/h3d-travelers-kit/intermediate/theme-v04.css) | Previous CSS snapshot; parent I11. Removes the 12-pixel inset on both ends of all three stitch layers; stitching spans the title bar’s full width. |
| I14 | [Theme v05](assets/h3d-travelers-kit/intermediate/theme-v05.css) | Previous CSS snapshot; parent I13. Header close buttons use a circular copper cap with the existing X label and button-state treatment. Both dimensions use the larger existing hit dimension, so the target never shrinks. |
| I15 | [First slice v05](assets/h3d-travelers-kit/intermediate/first-slice-v05.png) | Previous Chromium capture, 1600 × 1000, scale 1, after the passing close/drag/resize probe. Parents I1/I10/I14. Awaiting user visual review. |
| I16 | [Checkbox check v01](assets/h3d-travelers-kit/intermediate/checkbox-check-v01.svg) | Authored 16 × 16 SVG; metal check with dark recessed edge, consumed only by checked native inputs in the theme. No Imagen prompt. |
| I17 | [Theme v06](assets/h3d-travelers-kit/intermediate/theme-v06.css) | Previous CSS snapshot; parent I14. Adds recessed checkbox wells and native slider troughs/copper thumbs, plus disabled/hover/pressed treatment. |
| I18 | [First slice v06](assets/h3d-travelers-kit/intermediate/first-slice-v06.png) | Previous Chromium capture, 1600 × 1000, scale 1, following native-input pointer/keyboard/focus and window-interaction checks. Parents I1/I10/I16/I17. User visual review pending. |
| I19 | [Theme v07](assets/h3d-travelers-kit/intermediate/theme-v07.css) | Previous CSS snapshot; parent I17. Restores the filled left portion of native sliders as copper against the recessed remainder. Custom track paint now targets `.ui-range`, leaving specialized controls with their own rendering. |
| I20 | [UiRange v01](assets/h3d-travelers-kit/intermediate/ui-range-v01.svelte) | Source snapshot of the shared app-local native-input wrapper. Numeric min/max/value own one derived CSS fill percentage; live input updates, bound values, callbacks and resets use the existing native event path. |
| I21 | [First slice v07](assets/h3d-travelers-kit/intermediate/first-slice-v07.png) | Previous Chromium capture, 1600 × 1000, scale 1. Parents I1/I10/I16/I19/I20. Visual acceptance pending. |
| I22 | [Expanded showcase v01](assets/h3d-travelers-kit/intermediate/showcase-coverage-v01.png) | Previous Chromium capture, 1600 × 1000, scale 1, with production action bars and party HUD. Uses the existing I19 theme; this expansion changes fixture coverage rather than theme artwork. |
| I23 | [Theme v08](assets/h3d-travelers-kit/intermediate/theme-v08.css) | Previous CSS snapshot; parent I19. Shared material pass for tabs, inputs/wells, popup/dialog frames, action-bar rails, shortcut hints, HUD buttons, party nameplates and enamel vital bars. Reuses existing source assets and consolidates repeated material/shadow recipes. |
| I24 | [Coordinated pass v01](assets/h3d-travelers-kit/intermediate/coordinated-pass-v01.png) | Previous Chromium capture, 1600 × 1000, scale 1; parents I1/I10/I16/I23. User review pending. |
| I25 | [Theme v09](assets/h3d-travelers-kit/intermediate/theme-v09.css) | Previous CSS snapshot; parent I23. HUD icon actions get contained leather insets and thin copper edges, replacing the oversized base glass backing and hover icon enlargement. Pressed/disabled states remain distinct. |
| I26 | [HUD fittings v01](assets/h3d-travelers-kit/intermediate/hud-fittings-v01.png) | Previous Chromium capture, 1600 × 1000, scale 1; parents I1/I10/I16/I25, correction reference R4. User review pending. |
| I27 | [Theme v10](assets/h3d-travelers-kit/intermediate/theme-v10.css) | Previous authored CSS snapshot; parent I25. Player/target HUD fittings, spell/combat bars, minimap rim and inventory/vendor/trade/inspection/book/salvage finishes. Same I1/I10/I16 artwork. |
| I28 | [HUD overview v10](assets/h3d-travelers-kit/intermediate/overview-rest-v01.png) | Current Chromium capture, 1600 × 1000, scale 1; parent I27. Production player vitals and selected entity are included. Capture for user review, not visual acceptance. |
| I29 | [Inventory / equipment v10](assets/h3d-travelers-kit/intermediate/surface-inventory-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I30 | [Vendor v10](assets/h3d-travelers-kit/intermediate/surface-vendor-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I31 | [Trade v10](assets/h3d-travelers-kit/intermediate/surface-trade-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I32 | [Inspection v10](assets/h3d-travelers-kit/intermediate/surface-inspection-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I33 | [Book reader v10](assets/h3d-travelers-kit/intermediate/surface-book-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I34 | [Spell bar v10](assets/h3d-travelers-kit/intermediate/surface-spells-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I35 | [Combat controls v10](assets/h3d-travelers-kit/intermediate/surface-combat-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I36 | [Minimap / compass v10](assets/h3d-travelers-kit/intermediate/surface-minimap-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I37 | [Salvage v10](assets/h3d-travelers-kit/intermediate/surface-salvage-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I27. Existing full-client production fixture embedded in the showcase; synthetic content, user review pending. |
| I38 | [Theme v11](assets/h3d-travelers-kit/intermediate/theme-v11.css) | Previous authored CSS snapshot; parent I27. Active chat shares the player-vitals copper rails, replacing its Base outline. Existing `.interactive` state controls the treatment; idle chat, buffer fading, opacity and input behavior are retained. |
| I39 | [Half-full XP showcase](assets/h3d-travelers-kit/intermediate/showcase-xp-v01.png) | Chromium capture, 1600 × 1000, scale 1; theme I38. Production vitals HUD reads a fixture character sheet with 500 / 1000 level XP. User visual review pending. |
| I40 | [Theme v12](assets/h3d-travelers-kit/intermediate/theme-v12.css) | Previous authored CSS snapshot; parent I38. Round copper HUD icon caps with domed lighting, rim bevels and cast shadows. Hover brightens the face; pressed/selected faces darken, disabled faces dull. Existing hit rectangles retained. |
| I41 | [HUD nailheads v01](assets/h3d-travelers-kit/intermediate/hud-nailheads-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I40. Captured after passing behavior checks for user review; no agent visual acceptance. |
| I42 | [Square HUD buttons](assets/h3d-travelers-kit/intermediate/hud-square-buttons-v01.png) | Chromium capture, 1600 × 1000, scale 1; theme I40. Shared tray sizing now includes grid gaps, preserving square shortcut buttons. User visual review pending. |
| I43 | [Larger selected-entity header](assets/h3d-travelers-kit/intermediate/selected-header-v01.png) | Chromium capture, 1600 × 1000, scale 1; theme I40. Shared component uses a 32px default header/action size, 18px label and 20px action glyphs; both themes inherit it. User visual review pending. |
| I44 | [Theme v13](assets/h3d-travelers-kit/intermediate/theme-v13.css) | Previous authored CSS snapshot; parent I40. Selected entity shares vitals header material, name typography, whole-content copper frame and enamel health-bar skin. Health height matches the focused vitals line; Base geometry unchanged. |
| I45 | [Coordinated target HUD](assets/h3d-travelers-kit/intermediate/selected-vitals-style-v01.png) | Chromium capture, 1600 × 1000, scale 1; parent I44. User review pending. |
| I46 | [Theme v14](assets/h3d-travelers-kit/intermediate/theme-v14.css) | Previous authored CSS snapshot; parent I44. Restores the selected-entity health strip to 5px and removes the header-to-strip gap, retaining the shared vitals materials and enclosing border. |
| I47 | [Party overflow](assets/h3d-travelers-kit/intermediate/party-overflow-v01.png) | Chromium capture, 1600 × 1000, scale 1; theme I46. Shared party HUD paints all roster rows beyond its saved height without a scroll container. User visual review pending. |
| I48 | [Theme v15](assets/h3d-travelers-kit/intermediate/theme-v15.css) | Previous authored CSS snapshot; parent I46. Party member cards reuse selected-entity copper rails, leather header and heading font. Party grid gap is 8px to separate outward rails; compact name/bar sizing and overflow remain. |
| I49 | [Theme v16](assets/h3d-travelers-kit/intermediate/theme-v16.css) | Previous authored CSS snapshot; parent I48. Nailheads require the existing `ui-icon-button` classification. Labelled/compound HUD controls use rectangular leather faces. Item-strip arrows paint centered circular caps within their existing hit areas. |
| I50 | [Theme v17](assets/h3d-travelers-kit/intermediate/theme-v17.css) | Previous authored CSS snapshot; parent I49. Targets the explicit Base icon/control families. Strip arrows regain full-width pill faces; their click geometry is retained. |
| I51 | [Base family split v01](assets/h3d-travelers-kit/intermediate/base-theme-v01.css) | Source snapshot of Base after splitting icon and compound control hooks while retaining the shared default recipes. Production consumers use `ui-hud-button` or `ui-hud-control`; no runtime dependency on this copy. |
| I52 | [Compass frame v01](assets/h3d-travelers-kit/intermediate/compass-frame-v01.svg) | Authored assembled SVG source, 400 × 400; outer radius 200, transparent aperture radius 178, matching the existing 5.5% minimap inset. Copper rolled lip, patterned leather, exactly 100 stitches and an inner retaining rim. Uniform scaling; no nine-slice or generated texture. Consumer: theme `.minimap-frame` background. Accepted with the current showcase direction; live-game review remains pending. |
| I53 | [Theme v18](assets/h3d-travelers-kit/intermediate/theme-v18.css) | Previous authored CSS snapshot; parent I50. Replaces the layered minimap border shadows with I52, retaining only an outer seat/cast shadow. Removes the old disc shadow so the authored inner rim owns that edge. |
| I54 | [Combat 1: engraved copper](assets/h3d-travelers-kit/intermediate/combat-hud/01-engraved-copper-v01.png) | Built-in imagegen; 1536 × 1024 concept plate, enlarged and smaller specimens. Parents R6 (functional) / R1 (material). Engraved copper/enamel direction selected by the user. Exact prompt: I57 variant 1. Inspiration for I58/I59; no raster runtime consumer. Original `exec-75e0f686-0536-404e-bb6f-a30dc618e4a2.png`. |
| I55 | [Combat 2: stitched leather](assets/h3d-travelers-kit/intermediate/combat-hud/02-stitched-leather-v01.png) | Built-in imagegen; 1536 × 1024 concept plate. Parents R6/R1. Oxblood strips, stitches and copper end fittings. Exact prompt: I57 variant 2. Comparison study; user selected I54 instead. No runtime consumer. Original `exec-58ef256a-9e03-4cff-b55c-c61091623829.png`. |
| I56 | [Combat 3: open instrument](assets/h3d-travelers-kit/intermediate/combat-hud/03-open-instrument-v01.png) | Built-in imagegen; 1536 × 1024 concept plate. Parents R6/R1. Sparse rails and one selected leather strip. Exact prompt: I57 variant 3. Comparison study; user selected I54 instead. No runtime consumer. Original `exec-cd67a1de-220e-4a87-a8d2-63f60490963d.png`. |
| I57 | [Combat study prompts v01](assets/h3d-travelers-kit/intermediate/combat-hud/prompts-v01.json) | Exact three prompts, tool designation, reference roles and constraints for I54–I56. Requested compact ~210px use-size specimens are illustrative generated layouts, not guaranteed pixel-accurate dimensions or acceptance evidence. |
| I58 | [Theme v19](assets/h3d-travelers-kit/intermediate/theme-v19.css) | Source snapshot; parent I53, chosen reference I54. Engraved copper combat rim, recessed track and fitted translucent height faces; broad leather backdrop removed. Combat implementation accepted by the user; current jump iteration is I60. |
| I59 | [Combat markup v01](assets/h3d-travelers-kit/intermediate/combat-bar-v01.svelte) | Source snapshot of the shared combat component. Optional SVG paint paths use existing gauge/row geometry, are hidden in Base and never catch input. No external artwork or generated raster dependency. Combat implementation accepted by the user. |
| I60 | [Theme v20](assets/h3d-travelers-kit/intermediate/theme-v20.css) | CSS source snapshot; parent I58. User accepted the engraved combat treatment and requested a matching jump HUD. Adds slim copper jump rails, quarter marks, a triangular level guide and ivory readout; no markup/input/charge changes. Jump treatment awaits user review. |
| I61 | [Theme v21](assets/h3d-travelers-kit/intermediate/theme-v21.css) | CSS source snapshot; parent I60. User reported weak jump-label contrast. Adds compact translucent dark plates and a pale verdigris percentage. Plates rejected by the user because they do not match combat label styling; superseded by I62. |
| I62 | [Theme v22](assets/h3d-travelers-kit/intermediate/theme-v22.css) | CSS source snapshot; parent I61. Removes the rejected label plates and directly reuses combat breakpoint labels’ soft dark text-shadow on jump mode/caption/readout. Verdigris percentage retained. User review pending. |
| I63 | [Theme v23](assets/h3d-travelers-kit/intermediate/theme-v23.css) | CSS snapshot; parent I62. Jump level guide now has a bronze face, lit upper edge and dark underside using the combat frame’s metal palette. Existing line geometry retained; user review pending. |
| I64 | [Theme v24](assets/h3d-travelers-kit/intermediate/theme-v24.css) | CSS snapshot; parent I63. Player-vitals and party-name header insets reduced from inherited 19px to 5px per side in Traveler’s Kit, removing feathering clearance. Base/vertical spacing unchanged; user review pending. |
| I65 | [Base theme v02](assets/h3d-travelers-kit/intermediate/base-theme-v02.css) | Shared Base source snapshot after user-directed density/HUD changes. Equipped-marker defaults now live in Base, with a translucent radial fade replacing the hard black rectangle. Consumer: shared `ItemCellVisual` on item/action cells. User review pending. |
| I66 | [Theme v25](assets/h3d-travelers-kit/intermediate/theme-v25.css) | CSS snapshot; parent I64. Larger vermilion north letter with copper scrollwork/diamond tip; the compass carries the ornament through its existing rotation. User review pending. |
| I67 | [Minimap markup v01](assets/h3d-travelers-kit/intermediate/minimap-v01.svelte) | Source snapshot of optional north ornament SVG in the existing north group. Base hides it; map projection, compass rotation, pointer geometry and waypoint presentation are unchanged. |
| I68 | [Theme v26](assets/h3d-travelers-kit/intermediate/theme-v26.css) | CSS snapshot; parent I66. Heavier gold north marker with shaded metal face/extruded edges, muted header stitches and stitch-free modal headers. User review pending. |
| I69 | [Minimap markup v02](assets/h3d-travelers-kit/intermediate/minimap-v02.svelte) | Source snapshot; parent I67. Component-unique SVG gold gradient for the north face/tip, consumed by the alternate theme. No font assets or map geometry changes. |
| I70 | [Accepted theme v27](assets/h3d-travelers-kit/intermediate/theme-v27.css) | Final CSS source snapshot; parent I68, material unchanged apart from removing candidate wording. Selected runtime treatment, accepted by the user and verified from packaged output. Resource consumers are listed below. |

Final selected material sources are I1 (grain), I10 (nine-slice), I16 (check), I52 (compass), I59 (combat geometry), I69 (north gradient/ornament) and I70 (stylesheet). Earlier ledger statuses describe the iteration at capture time; old pending-review text does not reopen the accepted baseline. I61’s framed jump-label plates and I55/I56’s alternate combat studies were rejected. Other CSS/capture entries are retained history, not runtime candidates.

For each created asset record: actual path, producer/tool, exact prompt or generation parameters when applicable, source/parent ID, intended dimensions and scale, named consumer, status (candidate/selected/rejected), and reason for selection/rejection. Log changes as new versions rather than overwriting comparisons. If generated output is used, copy its original into this directory before deriving pieces. Exact generation prompts belong in this plan or an explicitly linked adjacent text file.

Accepted production CSS is at `apps/holtburger-3d/src/app/themes/travelers-kit.css`; decorative SVG assets follow the existing `src/assets/icons/` convention. A selected raster texture belongs with app assets, referenced by the shipped CSS. Record final paths here during implementation. Production must never depend on `docs/plans`, `/tmp`, or Codex’s generated-image directory.

Current production asset consumers:

- `apps/holtburger-3d/src/assets/icons/travelers-kit-leather.svg`: header grain, imported by the shipped CSS.
- `apps/holtburger-3d/src/assets/icons/travelers-kit-check.svg`: checked checkbox marker, imported by the shipped CSS; source snapshot I16.
- `apps/holtburger-3d/src/assets/icons/travelers-kit-compass.svg`: uniformly scaled circular copper/leather assembly with transparent center; theme `.minimap-frame` background, source snapshot I52.
- `apps/holtburger-3d/src/assets/icons/travelers-kit-frame.svg`: assembled nine-slice copper moulding with four corner fittings; imported by the same CSS. The original header-only rivet asset is removed.
- `src/app/ui-bundled-themes.ts` imports the shipped stylesheet through Vite and composes it with the native or fixture transport. The client, showcase and settings specimen offer the same `Traveler’s Kit` ID; the showcase retains Steel and the opaque override as diagnostic extras.

### Showcase coverage and use

The showcase is the repeatable tuning surface. The user accepted the final presentation after iterative review; later gameplay contrast, occlusion and density feedback remains user-owned. Render production components with explicit fixture data rather than separate visual imitations. A style-sensitive frontend feature should bring a suitable specimen when it is added or changed.

| Surface / state | Current evidence / entry point |
| --- | --- |
| Character vitals, selected target, status buttons, chat, shortcuts, toast, FPS and jump preview | The production `ClientGameplayView` in `ClientHudHarness.svelte`, mounted once by the showcase. Half-full XP and an eight-teammate roster are seeded into its fixture owners. |
| Resizable window, tabs, inputs, buttons, item wells, checkbox states, sliders and dropdowns | `UiShowcaseWorkbench.svelte` supplies the Component showcase window using production `UiTabs` / `UiTabPanel`, native controls, `UiPaletteDropdown` and `PopupMenu`. Dropdowns are inside Controls; inactive tabs and hidden sample windows retain their contents. |
| Horizontal/vertical action bars, sparse/equipped/stacked/unavailable/loadout/cooldown cells | `ui-showcase-fixture.ts` seeds production action-bar bindings and the same item facts used by inventory. Real client owners handle menus, clones, rotation, shape changes, activation and keyboard scopes. |
| Keyboard and focus ownership | One mounted client keyboard policy handles the stage, sidebar editors, tabs, menus and dialogs. Spell/combat samples share one game consumer rather than installing scenario-specific consumers. |
| Cooldown animation and countdown | **Restart cooldown** in the sidebar supplies the shared item-cooldown source. No auto-looping mock timer. |
| Party roster/vitals/leader/visible overflow | Production `ClientPartyHud` reads the fixture session's party. Known teammates use normal selection; off-scene admission retains production policy. |
| Modal header, editor, actions and dismissal | **Open dialog** in Controls renders production `UiDialog`. |
| Minimap / compass, camera cone and sample markers | Always on the same client stage. Production wheel zoom, pan/reset, coordinates, markers and launcher controls remain interactive. No minimap navigation destination. |
| Low-vitals screen-edge effects | Sidebar health/stamina/mana sliders, **Low health**, **Low stamina**, **Low mana**, **Healthy**, and the admission checkbox update the same vitals consumed by the HUD and real warning overlay. Effects are contained to the stage. |
| Inventory/equipment, vendor, trade, inspection, book, spell/combat controls and salvage | **Open client windows** buttons seed the existing domain fixtures and open production windows in place. The canvas, minimap, theme owner and common-control drafts remain mounted. |
| Roster/pregame settings and diagnostics | Characters and Diagnostics sample tabs remain. Pregame preference controls update the same settings owner as the client and sidebar. |

App-local diagnostic composition:

```text
?ui-showcase → UiShowcase → ClientHudHarness(showcase)
                              ├─ existing session/content/input fixtures
                              ├─ production ClientGameplayView
                              └─ UiShowcaseWorkbench
                                   ├─ same theme/settings owner
                                   ├─ backdrop, scale, layout and vital controls
                                   └─ common control samples

?client-hud → ClientHudHarness(default) → same production client + automated probes
```

The previous separate HUD gallery, action-bar view owner, iframe wrapper, cross-frame message schemas and Surface navigation were removed. `UiShowcase.svelte` is now only the explicit showcase entry into the shared client fixture. Fixture setup and diagnostic commands stay app-local; no Rust or gameplay API changes are involved.

The workbench creates a containing block for the production fixed canvas/HUDs, so their existing viewport observer and positioning operate inside the preview stage. It does not replace those component shells. Theme replacement and panel launchers preserve that stage lifetime. **Hide control samples** hides the retained sample window; **Reset layout** resets actual client placements and representative bar bindings without constructing a second client.

Remaining review limits: synthetic item artwork and map inputs cannot establish real DAT palette or live-world density/contrast acceptance. Domain fixture commands are deterministic demonstrations, not a complete game server; spell and physical combat retain their normal mutually exclusive mode behavior. Shared pregame, social, journal and Explorer states still need broader user review. Visual review belongs entirely to the user; no new screenshots are captured unless explicitly requested.

## Phased implementation

**Current execution order:** complete. Phases 2 and 4 were coordinated during user review; native delivery and default promotion are implemented, and final cleanup/verification is recorded below. Earlier execution-log entries retain the state at the time of each iteration.

### Phase 1 — Inventory and deterministic first slice

Deliverables: proposed theme CSS, minimum header/corner assets, and one showcase sample using `ClientHudWindow`, ordinary controls and existing item cells. Reuse the current showcase rather than building another preview application.

- [x] Inspect actual consumers and occupied CSS decoration hooks; record affected selectors here.
- [x] Capture baseline opacity behavior from CSS/settings and preserve it in the candidate.
- [x] Implement one resizable window, leather header, restrained copper fittings, buttons and item wells.
- [x] Start with CSS/SVG materials. Record asset parameters and provenance in the ledger.
- [x] Keep content geometry, interaction owners, scaling and semantics intact.

Acceptance: candidate is selectable in the development showcase; referenced assets load; content backing matches baseline transparency behavior; no production changes depend on plan assets; targeted static checks pass.

Decisions/course corrections:

- No component shell changes or nine-slicing were needed for the first candidate (superseded). Fittings, stitches, grain and header shading are independent background layers; they create no pointer-catching overlay.
- First-candidate selectors (superseded): `.hud-window` (shadow only), `.ui-frame` (material/title role), `.ui-frame .ui-button` (retain body typography), `.ui-button` and its pressed state (bevel). Existing `--ui-item-*` hooks supply wells/selection; existing `.ui-item-cell[aria-pressed]::after` remains untouched.
- Preserve both `--ui-surface-opacity` and surface color. Chromium measured identical baseline/candidate backing `color(srgb 0.141176 0.145098 0.133333 / 0.74)` and opacity token `0.74`. This is evidence for the tested default configuration, not a new hardcoded opacity requirement.
- The showcase gets production `ItemGridCell` specimens using existing weapon/shield/cloak SVGs; these are explicitly synthetic rather than replacement game artwork. Empty/selected/count-bearing cells are included.
- Added asset-independent `--ui-showcase` mode to the canonical browser harness. Its probe checks material decoding, opacity preservation, Base restoration, retained state, selection, drag/resize and close without performing visual acceptance.

### Phase 2 — User visual review and resteering

- [x] Give the user instructions to compare the candidate and Base in the showcase and game; see the review instructions below.
- [x] Provide the background/size/scale/material review instructions and obtain user acceptance of the final baseline. The user’s final approval closes this aesthetic checkpoint; individual visual combinations were not separately certified by the agent.
- [x] Record review feedback and source versions here. The user accepted the final treatment after the gold north/header pass, then explicitly chose it as the default.
- [x] Choose CSS/fixed-corner construction or conditional nine-slice based on actual artwork: second candidate uses an authored nine-sliced copper moulding.
- [x] No additional Imagen material study is needed: the user accepted the deterministic material direction. Keep the existing concept references and authored sources.
- [x] Record I4’s slice contract and obtain user acceptance of the final frame treatment. The existing resizing/interaction evidence and final general visual approval close the first-slice checkpoint; no separate agent visual join inspection is claimed.
- [x] Reassess remaining surface inventory and scope before rollout. Production HUDs, action bars, minimap, dropdowns and the eight named panels now share the unified showcase; the final visual baseline is accepted, with further gameplay feedback treated as follow-up.

Acceptance: user explicitly accepts the first slice or supplies concrete revisions. Work on aesthetic-dependent rollout waits for that review; agreement to this plan is not visual acceptance.

Review instructions (first checkpoint):

1. Run `npm run dev:ui` from `apps/holtburger-3d` and open the printed local URL. Traveler’s Kit is selected by default; Base remains in the sidebar’s Theme selector.
2. Compare with Base over Bright, Dark, checkerboard and your own image. Leave Opaque override unchecked so the candidate retains current transparency.
3. Resize the Component showcase window and inspect the leather header, fitting size, stitches, control bevels and selected/empty item wells. Candidate currently uses the existing text/icon scale, with no new scale overrides.
4. Use **Open client windows** to inspect the panel specimens without leaving the stage. The minimap, player/target HUDs and bars stay mounted. Common controls and dropdowns live in the Component showcase window. Try the low-vital presets and sliders for the screen-edge effects; **Healthy** clears them.
5. Report whether the material is convincing, whether copper/stitching is too busy, and whether the transparent body still feels right. In the native client, choose **Settings → UI → Theme → Traveler’s Kit**. Compare with Base in both pregame and gameplay; restart to exercise the remembered preference. Any further live-game contrast and scaling feedback remains user-owned; the current baseline is accepted.

I28–I47 captures are historical comparisons of earlier showcase compositions. They do not depict the consolidated stage. No screenshots were captured for the consolidation; passing behavioral checks do not count as visual acceptance.

### Phase 3 — Ship an alternate through the existing selection path

Deliverables: bundled stylesheet/assets, minimal app-local bundled-theme integration, and focused behavior tests.

Preferred approach: a small trusted renderer-owned registry/composition over `UiThemeTransport`. Resolve the bundled theme through Vite’s emitted stylesheet URL; continue delegating user folders to the validated Electron transport. Feed the combined capability into the existing selection owner. Do not loosen the native URL schema to accept arbitrary web/file URLs. Reuse the same bundled assets and catalog composition in the showcase instead of a duplicate fixture implementation.

- [x] Inspect `src/client/main.ts`, settings persistence and probe consumers before implementing composition.
- [x] Use a stable descriptive built-in ID that the current string-based selector can display; retain `null` for Base.
- [x] Define and test name collision behavior: reserve the built-in ID, never silently override a user theme. Expose any collision through existing failure reporting; document the rename remedy.
- [x] Ensure a failed user-catalog refresh does not make the shipped theme disappear; retain the built-in entry while reporting the user-source failure. If the current catalog contract cannot express that honestly, make the narrow typed change and name its UI consumer here.
- [x] Verify select, reload, refresh, startup restore, return to Base, and user-folder behavior through the same lifecycle.
- [x] Confirm built CSS and relative assets are included in production output and packaged application. Avoid copying assets into userData or creating an installer path for a bundled theme.

Acceptance: a clean installation offers Base and Traveler’s Kit without a user theme folder; existing user themes remain usable; selected theme survives restart; assets load from compiled output; loader failures are surfaced and preserve the prior active appearance.

Decision checkpoint: if registry composition requires a framework or broad changes to catalog contracts, compare a narrowly extended native catalog before proceeding and record the simpler choice. Do not implement both delivery paths.

### Phase 4 — Complete the presentation surfaces

- [x] Implement window/control treatment through shared app primitives and the named surface-specific hooks. The user accepted the coordinated treatment and final refinements as the visual baseline.
- [x] Cover hover, pressed, selected and disabled states through theme/common control rules; inherit native/shared focus, warning and error semantics. Existing probes cover native input focus, selection, disabled samples and all three warning overlays; the theme does not replace semantic vital/error colors.
- [x] Adapt chat without defeating its fading/interaction behavior. Filter pills and history control receive shared material styling; buffer masks/backings and idle scrollbars are unchanged.
- [x] Add restrained player/selected-entity vitals and minimap fittings without changing map projection, clipping or input geometry.
- [x] Implement candidate finishes for inventory selection, hotbar/spell slots, tabs, tooltips, menus, dialogs and scrollbars; expose whole-panel specimens for review.
- [x] Preserve pregame/shared consumers: native checks render the real pregame and gameplay settings with the theme; font roles/preferences remain bundled and honored. Explorer retains Base and its existing entry/lifecycle. The user accepted the presentation baseline; no agent visual assessment of legibility is claimed.
- [x] Ask the user for acceptance after the coordinated pass. Final baseline accepted by the user; no separate styling approval is pending.

Acceptance: user accepts the complete treatment; no surface needs an independent skin state; existing item colors, data density, opacity behavior and input semantics remain intact.

### Phase 5 — Cleanup and verification

- [x] Remove superseded candidates from production, unused selectors/assets and prototype-only markup.
- [x] Keep useful source references/intermediates in this plan’s ledger, clearly marking rejected versions.
- [x] Remove any production dependency on working notes and avoid duplicate CSS constructions.
- [x] Run `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and `npm run build` from `apps/holtburger-3d`.
- [x] Run focused `npm run test:ts -- ...` tests for changed theme integration; extend existing transport/selection/probe tests rather than snapshot-testing CSS constants.
- [x] Use `npm run harness:browser -- ...` with existing showcase/theme-probe facilities for machine-verifiable asset loading, theme lifecycle and pointer behavior. Read harness options before choosing arguments. No autonomous visual acceptance checks.
- [x] Run applicable existing native theme probes when transport/bootstrap changes; verify bundled assets through packaged output, not only Vite development URLs.
- [x] Record commands, outcomes, user acceptance, final asset consumers and remaining concessions here.

Acceptance: required checks pass, theme selection and interaction evidence is recorded, user aesthetic acceptance is recorded, and production files contain only the chosen implementation.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Generated frame is crooked, inconsistent or nonperiodic | Use generation for materials/inspiration; reconstruct precise borders and stitches. Keep assembled parent and explicit slice map if used. |
| Nine-slice joins or stretched details become visible | Fixed corners; smooth stretchable profiles; periodic stitches; user review at several window sizes. |
| Materials make transparent windows effectively opaque | Header-only texture; transparent frame center; preserve existing backing rules and settings. |
| Fittings block close/resize or obscure text | Noninteractive decorative layers; existing stacking and content insets; interaction checks. |
| Bright repeated borders overwhelm gameplay | Muted copper on long runs, sparse highlights, early full-screen user review. |
| Shipped theme works only in development | Build-time asset URLs and packaged-output verification before completion. |
| Bundled theme integration duplicates lifecycle/security policy | Reuse selector/loader; keep trusted registry separate from strict native URL validation; focused integration tests. |
| Alternate diverges into per-panel overrides | Reuse common primitives; keep exceptions limited to real HUD geometry and behavior differences. |

## Definition of done

- [x] Traveler’s Kit ships as the default, with saved theme choices preserved; Base remains available, with only user-requested shared appearance/layout changes.
- [x] User accepts the restrained material direction with current content transparency preserved.
- [x] Accepted treatment covers common windows/controls and named HUD surfaces.
- [x] Existing geometry/input owners remain authoritative. Recorded focused evidence covers window gestures, native inputs, scale/shape geometry, warning overlays, map/waypoint presentation, semantic vital colors and retained owners. The final packaged theme/asset checks pass. This is functional/source evidence, not an exhaustive visual matrix.
- [x] No custom slicing engine or unnecessary theme framework exists.
- [x] Every final asset has a production consumer and traceable source; packaged loading is verified.
- [x] Appropriate checks and behavioral probes pass; outcomes and concessions are recorded.
- [x] Plan/intermediate assets are not runtime dependencies; no staging or commits occur without a separate request.

## Open questions

- Shipped display/persisted name: `Traveler’s Kit`; Base remains `null`.
- Stitching, grain and copper treatment accepted for the showcase direction; revisit only if gameplay review identifies a concrete readability issue.
- Window moulding uses the authored SVG nine-slice; minimap uses uniform scaling of one transparent circular SVG. No custom slicing engine.
- Resolved: the user explicitly chose Traveler’s Kit as the client default after visual acceptance. Base remains selectable and existing saved choices are retained.

## Execution log

- 2026-10-26: Plan drafted from code inspection and user direction. Preserved baseline screenshot and all three generated concepts under relative paths. No implementation or visual acceptance performed.

- 2026-10-26: Implemented Phase 1 deterministic material candidate and showcase integration. Recorded I1/I2 source snapshots and I5 browser capture. No runtime code refers to these working-note copies. Awaiting user visual review; Phase 3 and later remain incomplete.
- Verification: `npm run check` passed (0 Svelte errors/warnings); `npm run lint:ts`, `npm run lint:dead`, and `npm run format:check` passed. `npm run build` passed and emitted `dist/assets/travelers-kit-CuD3182r.css` with its SVG dependencies inlined. Build reports a >500 kB chunk advisory; no bundle-size claim or unrelated optimization is made here.
- Runtime: `npm run harness:browser -- --ui-showcase --viewport-width 1600 --viewport-height 1000 --screenshot /tmp/h3d-travelers-kit-first-slice.png` passed, with no browser errors. Both decorative assets decoded. Baseline opacity/color were preserved; Base restoration, retained draft/selection, drag, resize and native close clicks passed.
- Diagnostic correction: the first probe incorrectly parsed an inlined SVG URL at an internal `)`; corrected its quoted-URL parsing and reran successfully. No asset workaround was needed. Lint configuration now identifies this serialized-browser probe alongside the existing theme probes.
- Environment: sandbox restrictions prevented some loopback/Git subprocess checks; approved escalated reruns completed. No remaining environment blocker.
- Focused regression checks: `npm run test:ts -- src/app/ui-theme-selection.test.ts src/app/ui-theme-transport.test.ts` passed all 9 tests across 2 files.

- 2026-10-26, Phase 2 revision: user requests more skeuomorphism like R1, specifically beyond the header on borders and buttons. First candidate is not visually accepted. Implemented concentric copper moulding with four fixed fittings as a nine-sliced authored SVG, preserving the translucent body. Replaced subtle button shading with raised metal faces/dark sockets and recessed pressed/selected states; disabled controls retain a duller finish. No new component structure, layout dimensions, or pointer interception layers.
- Revision asset cleanup: removed the production header-only rivet SVG and its CSS layers; retained I2 as history. Recorded I4/I6–I9. Header grain remains I1, now paired with the frame. Static original references remain intact.
- Revised runtime probe also decodes the panel border-image resource. At 1600 × 1000 it passed with 2 decoded material assets, unchanged baseline backing/opacity, Base restoration, retained draft/selection, item selection, drag, resize and close; no browser errors. User aesthetic acceptance remains pending.
- Revision verification: `npm run lint:ts`, `npm run format:check` and `npm run build` passed. Build retains the noted chunk-size advisory. No TypeScript/component logic changed in this iteration.

- 2026-10-26, third candidate: user judged the second pass much better and requested more prominent nailheads/stitching. Enlarged nailhead faces by 50%, added dark seats and brighter highlights, and replaced the single faint stitch line with two-tone thread and recessed shadows. Frame dimensions, content opacity and controls remain unchanged. Recorded I10–I12; no Imagen generation involved.
- Third-candidate Chromium probe passed: 2 material assets decoded, baseline transparency preserved, Base restoration and retained state passed, as did selection, drag, resize and close; no browser errors. Visual acceptance remains with the user.
- Third-candidate formatting verification: `npm run format:check` passed.

- 2026-10-26: User noted stitching stopped short of both title-bar ends. Removed the 12px horizontal insets and reduced-width sizing from all three aligned thread/shadow layers. Preserved stitch period, material treatment and window geometry. Recorded I13; focused formatting passed.

- 2026-10-26: User requested round header close buttons resembling nailheads. Added a theme-local circular cap through `.hud-window-close`, retaining the X, accessible label, existing copper bevel/state rules and interaction owner. Diameter is the maximum of the existing width/height formulas: the target never shrinks; the title bar may grow slightly to accommodate the square footprint (2 CSS pixels at the default font size). Recorded I14/I15. Focused formatting and the full showcase interaction probe passed, including native close clicks and unchanged content transparency.

- 2026-10-26: User requested a thematic treatment for checkboxes and sliders omitted from the mockup. Added inset checkbox sockets with a metal checkmark, inset slider troughs and round copper thumbs, state-specific finishes, and unchecked/disabled showcase samples. Inputs remain native, with no component-level input/value/keyboard logic changes; styling is confined to the alternate theme and guarded by `forced-colors: none` so high-contrast mode retains platform rendering. Slider pseudo-elements target Electron/Chromium, the supported app runtime. This first control pass omitted filled progress; the subsequent user request below restores it through UiRange.
- Recorded I16–I18 and extended the browser probe to decode the checkmark and exercise checkbox clicks/Space, slider clicks/ArrowLeft, and visible native keyboard focus rings. The first attempt scrolled a checkbox against the bottom resize strip; DOM hit-testing identified that strip, and centering the specimen in the scroll area let the native-input probe run. No production interaction workaround was introduced.
- Controls verification: `npm run check` passed with 0 Svelte errors/warnings; lint and formatting checks passed. Chromium reported 3 decoded material assets, matching baseline content opacity/color, retained state and Base restoration, native checkbox/slider pointer and keyboard operation, focus rings, item selection, drag, resize and close; no browser errors.
- Controls production build and final lint rerun passed; the build retains the previously recorded chunk-size advisory.

- 2026-10-26: User requested the base slider’s differently filled left portion up to the handle. Added shared app-local `UiRange.svelte` because custom Chromium tracks no longer expose native filled-progress paint. One typed min/max/value contract derives the CSS percentage; live input updates it while preserving native callbacks, binding, keyboard and change-on-release behavior. Converted the showcase and ordinary Graphics/Audio/Appearance/Environment/vital-warning settings controls. This is an app UI primitive, not game state or shared Rust behavior.
- Limited the custom track/thumb CSS to `.ui-range`; remaining raw range controls (including specialized jump/scroll controls and as-yet-unconverted creator/explorer fields) retain native or feature-owned paint and native fill. Review these ordinary remaining consumers during Phase 4; do not reapply custom fill-less paint globally. No DOM-wide observer or scripted theme lifecycle was introduced. Base appearance remains native; only the alternate consumes the extra fill variable.
- Added a Reset charge specimen and extended the behavioral probe for Home/End fill endpoints and a programmatic bound-value reset. All pass alongside pointer/keyboard edits, focus rings, material decoding, unchanged panel opacity, Base restoration and window interactions. Existing settings-tabs probe passed. `npm run check` passed with 0 Svelte errors/warnings.
- Filled-slider verification completed: lint, dead-code, formatting and production build passed (same noted chunk-size advisory). Existing audio settings/playback probe passed, including slider mix edits and reset, with no browser errors.

- 2026-10-26: User requested treating the showcase as the ongoing tuning surface and adding omitted UI such as action bars. Audited coverage and added production horizontal/single and vertical/double action bars with sparse typed fixtures, real menus/collection operations, cooldown restart, edit handles, party vitals and a modal sample. Added an optional game-shortcut switch so focused/selected action-bar states use the existing keyboard owner. No production gameplay or theme paint changed in this expansion. Added the coverage matrix and remaining gaps above; recorded I22.
- Expanded showcase verification: `npm run check`, lint, dead-code, formatting and production build passed (same recorded chunk-size advisory). Chromium verifies both action-bar orientations, empty/unavailable/loadout states, activation feedback, cloning, rotation, cooldown restart, keyboard focus/selected cells, party selection, modal focus/Escape cancellation and action-bar retention across theme replacement. Earlier input/opacity/window checks continue passing; no browser errors. Final probe lint rerun passed.

- 2026-10-26: User likes the direction but notes unstyled components remain. Revised the execution sequence to prioritize the broader styling/coverage pass before shipping. This is direction approval, not completed Phase 2/4 acceptance.
- Implemented coordinated shared skin v08: primary modal frames reuse the existing window nine-slice; compact popups/tooltips use a smaller version; tabs become stamped leather with recessed selection; inputs/wells gain inset shading; filter pills retain category colors under shallow bevels; menu selection, panel/overlay scrollbar colors, action-bar rails/slot wells/key hints, HUD icon controls, party nameplates and semantic vital bars gain consistent finishes. No new artwork, component behavior, backing opacity or geometry changes. Existing material/shadow recipes are shared where there are multiple consumers.
- Scope/evidence: generic spell-bar rails inherit the shared rule, but spell/combat/minimap-specific finishes and real panel coverage remain open; do not infer acceptance from absent specimens. Chat’s buffer mask/backing/scrollbar selectors are not overridden. Styling remains entirely in the alternate stylesheet; Base is unchanged.
- Coordinated-pass browser checks passed, including preserved baseline vital fill colors and content backing, native input/focus behavior, action-bar keyboard/menu/shape/cooldown behavior, party selection, modal focus/Escape and window gestures. No browser errors. Formatting and production build passed (same recorded chunk-size advisory); final probe lint passed. Recorded I23/I24.

- 2026-10-26: User supplied R4, describing HUD icon actions as a hybrid of Base and chiclet keyboard styling. CSS inspection confirmed the v08 bevel was layered over Base’s oversized, radial-feathered `::before` backing. Replaced that backing on standalone icon actions with a bounded leather inset (1px inside the existing hit rectangle), removed its mask/backdrop filtering, reduced edge relief, and replaced hover icon enlargement with color/edge feedback. Cells, readouts, party members and spell tabs keep their own recipes. Pressed and disabled faces remain separate. No HUD layout or control behavior changes; recorded R4/I25/I26.
- HUD-fitting revision: focused formatting and the full showcase interaction probe passed with no browser errors. Panel backing and vital colors remain unchanged; theme replacement, native controls, bars/menus, modal behavior, party selection and window gestures continue passing.

- 2026-10-26: User authorized styling the remaining components and explicitly requested showcase coverage plus player vitals and selected entity. Implemented v10 with leather/copper HUD fittings, enamel readouts, spell/combat bar controls, minimap rim, inventory/equipment surfaces, vendor/trade rows, inspection/book sections and salvage queue/output. Semantic fill colors, backing opacity and feature-owned geometry remain intact. Added the missing shared class hooks to spell tabs and the book Retry button; no gameplay behavior changed.
- Showcase expansion reuses nine existing full-client fixture scenarios through a same-origin embedded document rather than copying feature markup or inventing a second session adapter. Parent appearance controls use validated messages and the existing theme-selection lifecycle. Scenario initialization awaits the actual session-start promise; salvage supplies the required authority estimate replies through the existing diagnostic owner. Failures are reported visibly.
- Recorded I27–I37. Browser checks cover all nine mounted production components, Base/candidate switching while retaining their exact DOM instances, synchronized opacity override, default panel opacity 0.74, and overview player/target presence. Existing material decoding, native controls/focus, semantic vital colors, action bars, modal and window gesture checks remain included. No agent visual acceptance was performed.
- Final v10 verification: `npm run check` (0 Svelte errors/warnings), `npm run lint:ts`, `npm run lint:dead`, `npm run format:check` and `npm run build` passed. Build reports the noted >500 kB chunk advisory. `npm run harness:browser -- --ui-showcase --viewport-width 1600 --viewport-height 1000 --screenshot /tmp/h3d-travelers-kit-rest.png` passed with all nine surfaces and no browser errors. All reference links resolve; the live showcase URL returned HTTP 200. User visual review is the next checkpoint before Phase 3.

- 2026-10-26: User requested the same border as player vitals for active chat. Shared the existing rail rule with `.chat-panel.interactive` and replaced that state’s Base outline. No new activity/focus logic, layout borders or buffer decoration; the existing interaction owner controls when the rails appear. Recorded I38.
- Active-chat revision verification: `npm run format:check` and the full `--ui-showcase` browser probe passed with no browser errors. Visual acceptance remains with the user.

- 2026-10-26: User requested half-full XP in the vitals showcase. Replaced its null character-sheet input with a read-only production owner populated with 500 / 1000 level XP; no production HUD or theme behavior changed. Type checks and showcase browser checks passed with no browser errors. Recorded I39.

- 2026-10-26: User requested round HUD icon buttons with more nailhead relief. Replaced the contained leather face with domed copper, circular rounding, edge highlights and cast shadows. Explicitly restored decorative faces for icon actions inside HUD groups. Item cells, readouts, party members and spell tabs retain their feature-specific treatments. Recorded I40; user visual review remains pending.
- Nailhead revision verification: `npm run format:check` and the full showcase browser probe passed with no browser errors. Recorded I41.

- 2026-10-26: Investigated vertically stretched shortcut-button backings in Base and Traveler’s Kit. Browser measurements proved the nominal 336px tray excluded seven 5px gaps, squeezing eight buttons to 37.625 × 42px. Removing gaps or adding their 35px to the tray yielded 42 × 42px. The production client harness reproduced the same defect; the difference from the user’s actual in-game appearance was not established.
- User authorized the fix. `ClientHudTray` now accepts an explicit additional gap count, adds the CSS-defined gaps along its long axis before icon scaling, and uses its existing measured extent for viewport fitting. `ClientShortcutDock` supplies its count minus one; status and diagnostic trays explicitly supply zero because their nominal sizing is retained. No saved placement migration or theme-specific compensation. Recorded I42.
- Square-button verification: direct browser measurements confirmed 42 × 42px, 52.5 × 52.5px and 63 × 63px buttons at 100%, 125% and 150% icon scale respectively, in both orientations and both Base/Traveler’s Kit. The full showcase browser probe passed with no browser errors. `npm run check` (0 Svelte errors/warnings), `npm run lint:ts` and `npm run format:check` passed. No agent visual acceptance performed.

- 2026-10-26: User requested a larger selected-entity header and label in Base and the alternate. Updated shared `ClientSelectedEntityHud.svelte` layout: default header/action size 24 → 32px, name uses the existing 18px heading token with text scaling, action glyphs 16 → 20px with icon scaling. Intrinsic header row grows for larger text, with the health bar below it; the reserved overall HUD placement is retained. No theme override or gameplay change. Recorded I43.
- Header revision checks: `npm run check` (0 Svelte errors/warnings), `npm run lint:ts`, `npm run format:check` and the full showcase browser probe passed with no browser errors. The previous review server had stopped; started a replacement at the updated review URL.
- Direct header measurements passed in Base and Traveler’s Kit: default 32px header / 18px label; 200% text produces a 45px header / 36px label; 150% icon scale produces a 48px header and buttons. Labels and buttons fit within each measured header and health remains below it. No agent aesthetic acceptance performed.

- 2026-10-26: User requested selected-entity styling closer to player vitals in Traveler’s Kit. Consolidated shared header typography, outer copper rails and meter/fill rules instead of maintaining a separate target recipe. The target border now encloses its actual header and health rows; its content height avoids framing unused reserved placement space. Health thickness uses the focused vitals text-line height (minimum 16px), and header-to-bar spacing uses the existing vitals gap token. Semantic health fill and translucent backing remain intact. Base is unchanged by this theme-only revision. Recorded I44/I45.
- v13 verification: computed header background, name font, outer border shadow and health-bar shadow match player vitals. At default, 200% text and 150% icon scale, labels/actions fit and the outer border ends exactly at the health bar. Full showcase browser probe passed with no browser errors; formatting and whitespace checks passed. User aesthetic acceptance remains pending.

- 2026-10-26: User clarified that the selected-entity health strip should remain thin and meet its header directly. Replaced the theme’s scaled thick health row with 5px and set its row gap to zero. Shared material, header font and whole-content border remain; Base is unchanged. Recorded I46.
- v14 verification: formatting passed. Browser geometry assertions confirmed 5px health height and zero gap in Traveler’s Kit at default, 200% text and 150% icon scale; label/action fit, shared materials and content-fitting border remain correct. Base retains its existing 5px bar and 3px gap. No aesthetic acceptance performed.

- 2026-10-26: User requested that party HUD overflow always remain visible instead of scrolling, in every theme. Removed the component’s scroll wrapper, height constraint and stable scrollbar gutter. The production grid now paints visible overflow directly; saved width still controls up to four columns and fixed cell dimensions are retained. Removed the obsolete scrollbar allowance token, geometry field/validation, minimum-width padding and diagnostic assumptions, including their README documentation. No party/session semantics changed. Recorded I47.
- Party overflow verification: `npm run check` (0 Svelte errors/warnings), `npm run lint:ts`, `npm run lint:dead` and `npm run format:check` passed. The existing `--client-vitals` browser probe passed its updated party checks for visible overflowing rows, no scrolling, column count, fixed geometry, resize minima, selection and theme overrides. The full `--ui-showcase` probe also passed with explicit visible-overflow/non-scrolling assertions and no browser errors. User visual acceptance remains pending.

- 2026-10-26: User reiterated that visual checks are their responsibility and identified hand-built showcase tabs that omitted the production tab treatment. Replaced custom nav/buttons and conditional content with `UiTabs`, `UiTabPanel` and the shared `ui-tabbed-panel` shell. This supplies the missing `ui-panel-tabs` hook, correct tab/panel ARIA relationships and retained inactive panels. Controls own their inner spacing while the shared panel owns scrolling. No stylesheet imitation or alternate tab behavior. No screenshots or agent visual checks in this revision.
- Shared-tabs verification: `npm run check` passed with 0 Svelte errors/warnings. Lint and formatting checks passed. The DOM/interaction showcase probe passed, including ArrowRight/Home selection through the existing opt-in keyboard policy, hidden/inert inactive panels and retained Controls panel identity; no browser errors. No screenshots were requested or captured.

- 2026-10-26: User requested party HUD header/border styling matching selected entity. Removed the party-specific shallow header and border recipes and added party members/nameplates to the existing shared rail, leather header, backing-replacement and heading typography rules. Candidate grid spacing grows to 8px so neighboring 3px outward rails have room; bar heights and compact name sizes are retained. Base is unchanged. Recorded I48.
- Party header revision verification: focused formatting and whitespace checks passed. The existing showcase DOM/interaction probe passed theme switching, visible non-scrolling overflow, party selection and shared tabs with no browser errors. No screenshots or visual checks performed.

- 2026-10-26: User requested dropdown and minimap previews. Added direct sidebar entry points for both, plus a retained Dropdowns tab using native selects, production `UiPaletteDropdown` (enabled/disabled) and `PopupMenu` (commands, disabled row, checked leaf and checked submenu). State is local to the specimen; transient menus close when its tab is hidden. The minimap button reuses the existing same-origin full-client fixture and theme lifecycle; that scenario now supplies the existing two-marker fixture and a rotated camera heading. No new map renderer or game state adapter.
- Preview verification: type checks passed with 0 Svelte errors/warnings; dead-code check passed. The showcase DOM/interaction probe passed palette selection, checked menu/submenu updates, disabled menu state, dismissal on tab change, the direct minimap entry point and all existing panel/theme/input checks with no browser errors. No screenshots or agent visual checks performed.
- Final preview lint and formatting checks passed. The dead-code check required an escalated rerun because sandbox restrictions blocked its Vite/Git subprocess; the rerun passed.

- 2026-10-26: User explicitly requested consolidating the two fixture presentations and carrying over features, particularly low-vitals screen-edge effects. `UiShowcase.svelte` now mounts the existing `ClientHudHarness` in showcase mode. `UiShowcaseWorkbench.svelte` wraps its one production client tree with theme/backdrop/scale/layout controls and a retained common-controls window. Removed `UiShowcasePanel.svelte`, `ui-showcase-panels.ts`, the separate `UiShowcaseActionBars.svelte` owner, cross-frame messages and page/surface navigation. Dropdowns moved into Controls.
- Carryover: real minimap, vitals and target, 50% XP, party/status/chat, both action-bar orientations and cell states, cooldown restart, jump charge toggle/slider, toast trigger, controls, modal, retained tabs, character/pregame samples, diagnostics and eight in-place panel launchers. Sidebar warning controls edit the real vital values and admission switch; named low-vital presets and Healthy exercise the actual screen-edge overlay. The same settings and theme selection owner serves the client, sidebar and samples. No screenshots or agent visual checks.
- Input finding: isolated spell/combat fixture beginnings each registered a game keyboard consumer, which conflicted when used on one stage. Shared spell seeding with its existing diagnostic path and introduced one showcase game consumer that dispatches to the active production handlers. Diagnostic probes retain their independent input lifetimes. The same item-cooldown context used by ClientApp now serves the fixture tree.
- Lifecycle/cleanup: explicit optional showcase mode preserves the ordinary diagnostic entry. Initialization waits for the real session-start promise, reports startup failures beside controls, and avoids publishing after teardown. Sample item GUIDs use a reserved range to avoid collisions with domain fixtures. The stage's containing block keeps fixed HUDs/canvas/effects inside the preview; actual component viewport measurements remain authoritative. Browser showcase screenshots are now conditional on an explicit screenshot argument, including the harness's final capture.
- Consolidation verification: `npm run check` passed with 0 Svelte errors/warnings; `npm run lint:ts`, `npm run lint:dead`, `npm run format:check` and `npm run build` passed. Build emits chunk-size and plugin-timing advisories; no unrelated optimization was introduced. The revised `--ui-showcase` DOM/interaction probe passed material loading, shared opacity/reload/Base restoration, retained client/minimap/sample drafts, 50% XP, party/bar presence, native controls, slider fill/reset, dialogs/tabs/dropdowns, all three edge-effect presets and their stage bounds, and all eight in-place panel launches. Existing `--client-vitals` and `--client-spells` regression probes passed with no browser errors. No screenshots or agent visual checks were performed.
- Relaunched the unified showcase with `npm run dev:ui` at the updated review URL. The native shipped alternate and final aesthetic acceptance remain pending; this consolidation does not complete Phase 3.

- 2026-10-26: User supplied inventory feedback: nailheads should be limited to single-icon controls, and equipment strip arrows should be circular rather than oval. Replaced broad HUD-button nailhead admission with the shared `ui-icon-button` marker, applied to actual standalone icon actions in the client, strip and theme specimen. Pack headers, currency totals, sort controls and compound selectors receive contained rectangular leather treatment instead. Strip caps use equal dimensions centered within their existing wide/tall click targets, preserving scrolling geometry. Updated the style guide. Recorded I49; no new artwork or screenshots.
- Icon classification verification: `npm run check` passed with 0 Svelte errors/warnings; lint, formatting and the full showcase interaction probe passed with no browser errors. No visual checks performed. Base rules do not change: added icon markers avoid the `ui-button` combination and no affected owner uses `ui-icon-actions`.

- 2026-10-26: User requested carrying the type distinction into Base without changing its appearance, and revised equipment arrows to full-width pills. `ui-hud-button` now identifies standalone icon actions; migrated labelled/compound controls, item cells, party rows, spell tabs, readouts and strip controls to `ui-hud-control`. Shared Base focus/state/backdrop recipes cover both with the same specificity and default paint. Each family resolves its own background and indicator hooks; spell-cell/tab overrides migrated to the control vocabulary. No compatibility aliases retained. Updated style guide, backdrop probe selectors and the alternate's positive icon selectors. Strip arrows keep the original click dimensions and use a full-size pill in Traveler’s Kit. Recorded I50/I51; no new raster assets or screenshots.
- Base preservation evidence: a disposable DOM comparison used current CSS/classes and the original Base CSS/classes against the same seven real controls (icon, pack header, currency, sort, item cell, party and arrow). Resolved paint, dimensions, masks, filtering, fonts, focus and glyph transforms matched in normal, hover, active, focus-visible and disabled states. This is a styling-contract check, not agent visual acceptance. The showcase probe now also verifies independent icon/control background and indicator overrides on actual controls.
- Startup integration correction: the standalone disposable browser exposed a focus-sensitive diagnostic self-test running during interactive showcase startup. Restricted that synthetic input assertion to the normal diagnostic entry; the interactive showcase still uses the same fixture and input owner. Runtime failures remain visible; no input-policy fallback was added.
- Family-split verification: `npm run check` passed with 0 Svelte errors/warnings; `npm run lint:ts`, `npm run format:check` and `npm run build` passed (the noted chunk-size advisory remains). The showcase interaction probe passed independent background/indicator hooks for both families and all existing shared-stage interactions, with no browser errors. The ordinary `--client-vitals` diagnostic route also passed, including its input self-test and party checks. No screenshots were captured and no agent visual review performed.

- 2026-10-26: User authorized a more sculpted minimap border, beginning with bezel and stitching before deciding on fittings. Authored `travelers-kit-compass.svg`: a 400-unit square assembly with a transparent radius-178 aperture and radius-200 outer edge matching Minimap’s 5.5% inset. Layered copper strokes form the rolled lip, dark undercut and inner retaining edge; a two-tone leather gradient and deterministic 13 × 11 grain pattern form the band. Stitch circles use pathLength 360 and 1.8/1.8 dash periods for exactly 100 repeats with no closing seam. No Imagen generation, raster assets, fittings or slicing. Recorded I52/I53.
- Candidate integration replaces the minimap frame background and superseded inset/disc shadows. No Minimap markup, projection, aperture, compass/cardinal geometry, control placement, pointer ownership or Base styles changed. Decorative paint adds no input layer. User visual review remains the next checkpoint.
- Compass verification: XML parsing and local gradient/pattern references pass; the updated showcase probe decodes all four decorative resources and passes existing shared-stage, theme, input and panel interaction checks with no browser errors. Lint, formatting, whitespace and production build passed; the noted chunk-size advisory remains. No screenshots or agent visual checks performed.

- 2026-10-26: User approved the current theming after the compass-bezel pass. Began Phase 3 using `withBundledUiThemes` in the renderer, shared by the client, settings probe and showcase. Reserved persisted/display ID: `Traveler’s Kit`; `null` remains Base. Added required transport `initialIds`, consumed once by `UiThemeSelection` to seed its catalog before asynchronous discovery; this preserves bundled choices on first failure or timeout. `UiThemeControls` consumes the existing catalog failure state and reports a reserved-name collision with a folder-rename remedy. A failed refresh retains the prior catalog, including previous user choices; the reserved ID always resolves the bundled asset, with collision reported on discovery. Native URL validation, selection/persistence ownership and user-data directory layout remain unchanged. Verification pending.

- Phase 3 cleanup/review: the registry owns trusted asset URLs and reserved-name policy; `UiThemeSelection` still owns ordering, cancellation, deadlines and catalog/selection state; `ClientApp` still commits successful IDs through its existing user-settings persistence. There is no second loader, schema relaxation, filesystem installation or renderer/game-state lifetime change. Explicit initial choices add one field to the transport instead of partial-catalog error types or another discovery owner. The showcase’s previous duplicate Traveler’s Kit preview entry was removed. All four source SVGs have named CSS consumers; no runtime source refers to the plan or intermediate directory. Existing historical snapshots remain working-note artifacts. The final review is bounded to the shipping seam and touched consumers, not a claim of aesthetic acceptance.

- Phase 3 verification: focused selection/transport/composition/bootstrap tests passed (18 tests). `npm run harness:browser -- --ui-showcase --viewport-width 1600 --viewport-height 1000` passed with all four assets decoded, retained client/minimap/drafts, shared theme controls, opacity/Base restoration, native inputs, warning overlays and all eight in-place panels; no browser errors or screenshots. `npm run build:electron:main` and `npm run build` passed; the frontend build retains the existing large-chunk advisory.
- Packaged verification: `npm exec -- electron-forge package` created the local Linux x64 package from the current built frontend/Electron output and existing release host (no Rust changes). `npm run check:package` passed. `npm run probe:user-themes:built -- --package-root out/holtburger-3d-linux-x64` passed all three modes: development HTTP, built `file:` entry and real `app.asar` entry. Each mode decoded the four selected decorative SVGs and eight baseline font checks; native serving/reload, cancellation, timeout/failure recovery, both settings surfaces, bundled-theme disk restoration, catalog failure, reserved-name collision/recovery and missing user-theme retry passed. Expected missing/corrupt diagnostic resources are deliberate fault injections. The first probe revision incorrectly parsed URL references inside embedded SVGs; it was replaced by computed-style URL extraction, matching the showcase. No artwork workaround was needed.
- Final review checkpoint: after restarting the native client, choose **Settings → UI → Theme → Traveler’s Kit**. Compare with Base in pregame and actual gameplay, over bright and dark scenery, at minimum/larger windows and your preferred text/icon scales. Inspect item-art contrast, transparent-body readability, thin target health, party overflow, minimap fittings and action bars. The general showcase direction is accepted; this gameplay/pregame review is still outstanding and must be performed by the user. No agent visual acceptance was performed.

- Final static verification: `npm run check` passed (0 Svelte errors/warnings, app/node/test/Electron TypeScript checks); `npm run lint:ts`, `npm run lint:dead` and `npm run format:check` passed. The initial sandboxed Knip invocation printed a Git metadata access error despite exiting zero; the unrestricted rerun completed cleanly. `git diff --check` passed, and all 58 relative asset-reference links in this plan resolve. No staging or commits. The goal remains incomplete solely at the recorded user-owned visual gates.

- User gameplay feedback: removed spacing between player HUD bars in both themes. Base `--ui-character-hud-gap` is now zero; shared `ClientCharacterHud` no longer separates vital rows or distributes spare height between identity/XP and vitals. Its minimum bar-area calculation no longer reserves the removed gaps. Focused formatting and `git diff --check` passed; `--client-vitals` passed its existing vitals/party behavior checks with no browser errors. No screenshots or agent visual checks. User review remains outstanding.

- Follow-up to contiguous bars: the player HUD section still filled its saved layout height, leaving empty space inside the alternate’s copper border. Shared `ClientCharacterHud` now uses `height: fit-content`, matching the selected-entity treatment, so painted chrome ends at the final vital row. Saved HUD placement/editing remains owned by `ClientHudPanel`; no setting migration or theme-specific patch. Focused formatting and diff whitespace checks passed; user visual confirmation pending.

- User requested larger default spell/action icons in Base, inherited by Traveler’s Kit. Added shared Base `--ui-shortcut-cell-size: 44px` and migrated both production bar metric elements from the 36px inventory basis. Existing metric observers propagate the size to cells, anchored bounds, tab widths, clipping and scroll geometry; global icon scale is still applied once. Both themes inherit the same size without a candidate override. Updated theme-author guidance. Formatting/diff checks and the existing `--client-spells` and `--ui-showcase` interaction probes passed with no browser errors; no screenshots or agent visual checks.

- Combat HUD resteering: user set `--ui-shortcut-cell-size` to 40px and requested Imagen variants for the combat HUD rather than another immediate code edit. R6 records the problem; R1 remains the material reference. Three independent built-in imagegen studies were generated: engraved copper, stitched leather and open instrument. Exact prompts and constraints are recorded in [combat study prompts v01](assets/h3d-travelers-kit/intermediate/combat-hud/prompts-v01.json). Preserve the semicircular power/accuracy meter, five markings, triangular handle and three attack-height choices; reduce heavy shading/visual mass and keep the unused interior transparent to gameplay. These are inspiration plates, not production assets or visual acceptance. Production combat CSS is unchanged; user selection/review is required before implementation.

- Combat concept delivery: I54–I57 and R6 are retained in the plan assets. All three outputs were produced with the built-in tool using separate direction-specific prompts, rendered inline and copied unchanged from the generated-images directory. Their backgrounds are concept presentation backdrops, not alpha-ready UI assets. No production code or the user’s 40px setting was changed; no agent visual acceptance was performed. Next step is user choice/revision, followed by an implementable SVG/CSS treatment.

- Engraved combat implementation: user chose I54 and explicitly authorized implementation. Added optional inline SVG paint layers to `ClientCombatBar`, hidden by default: a narrow metal bezel, three preset engraving marks, two small slotted end fasteners, and closed attack-height face paths calculated from the existing ellipse/row geometry. A component-unique gradient ID avoids collisions. Traveler’s Kit reveals these layers, uses translucent dark/oxblood row faces with thin copper outlines, removes the broad leather semicircle and heavy shadows, and narrows the colored track inside the bezel. The red charge state, pointer/keyboard handlers, labels, target geometry, shortcut disclosure, projectile readout and idle/emphasis behavior retain their owners. Base hides all added decorative layers. Recorded I58/I59; no new raster assets, custom slicing or production dependence on the concept files. User’s 40px shortcut setting retained.
- Focused showcase checks passed in Base and Traveler’s Kit: same combat DOM across replacement, optional decoration visibility, transparent background admission, finite fitted face paths, noninteractive decorative layers, native pointer clicks on all three heights, and Home/End slider adjustment. The broader HUD regression initially stopped before combat on an unchanged enchantment fixture lacking the required `cooldowns` array (the field is also required in HEAD). Temporary diagnostic repairs let the broader run reach and pass combat, but it later failed in the unrelated character-sheet probe. Those repairs were removed from this cosmetic change after the user questioned the broad regression scope. No runtime contracts were changed.

- Verification scope correction: user challenged repeated broad HUD regression runs for cosmetic work. The broad run is terminal and was not a passing acceptance gate; it ultimately failed in character-sheet diagnostics after combat. Removed all unrelated enchantment-fixture repairs from `client-hud-probe.mjs`. Future cosmetic iterations use proportionate formatting/build checks and focused interaction checks only where decoration can affect input; user owns visual acceptance. Current engraved-copper change passed `npm run check`, `npm run lint:ts`, focused formatting, production build and the showcase’s Base/alternate/input checks. No screenshots or agent visual acceptance.

- User accepted the implemented combat HUD and requested the same treatment for jump. Implemented I60 entirely in alternate-theme CSS over the existing `ClientJumpPowerBar`: narrow copper rails and a recessed track, quarter engravings on the two inner edges, subtle fill sheen, a small copper triangular guide at the live fill level, ivory heading-family readout and restrained caption ink. Decorative pseudo-elements do not receive pointer events. The fill’s color token, charge sampling, precise-mode range, keycaps, hit geometry, placement and Base rules are untouched. No new assets, SVG/component markup, runtime owners or tests were added. Verification is deliberately limited to formatting/build checks for this cosmetic change; user owns visual review.

- Jump-label readability feedback: user requested backing around the labels and a separate percentage color. Added noninteractive, locally isolated text-plate pseudo-elements to the existing mode label, moving caption/keycaps and readout. Plates use translucent dark ink and thin copper edges without padding/repositioning the meter or guide. The vertical label retains its previous bottom alignment while its element fits the lettering, keeping the backing compact. Percentage is pale verdigris `#9edbd2`; mode/caption ink is warm ivory. Recorded I61. CSS-only; focused formatting/build checks, no broad regression or agent visual checks.

- Jump-label correction: user rejected I61’s framed plates. Inspection confirmed the combat breakpoint labels use `--ui-combat-breakpoint-shadow` (two soft dark text shadows), not boxes. Removed the new plate pseudo-elements, isolation and vertical sizing rules; directly reused that existing shadow on jump mode/caption/readout. The percentage remains verdigris. Recorded I62; focused formatting passed. No visual checks or broad tests.

- Jump level guide: user requested bronze/3D treatment matching the combat frame. Recolored its existing border to the frame’s middle bronze and added a narrow upper highlight, dark underside and small contact shadow. This paints a shallow bevel without changing the line’s position, width, fill alignment, readout placement or input. Recorded I63; focused formatting/whitespace checks only.

- User requested tighter vitals/party header contents because the alternate has contained leather instead of Base’s feathered backing. Both headers inherited `ui-readout`’s 19px side padding (14px fade allowance plus 5px text inset). Theme-only rule now uses 5px for those two existing consumers, preserving vertical spacing and shared Base rules. Recorded I64; focused formatting/whitespace checks only.

- Equipped badge: user requested a translucent feathered backing in Base for inventory/action checkmarks. Moved the three existing equipped appearance defaults into `ui-base.css`; the background is now an elliptical radial fade from translucent black to transparent, while color/font defaults retain their existing values. `ItemCellVisual` reads the Base properties without hardcoded fallback paint. Positions above counts/beside structure bars, glyph sharpness and pointer passthrough are unchanged; Traveler’s Kit inherits the shared default. Recorded I65 and updated item theme guidance. Formatting/build checks only; no broad regression or agent visual checks.

- North marker and waypoint preview: user requested a more prominent/vibrant ornate N and a showcase guide toggle. Traveler’s Kit now renders N at 24 compass units in vermilion with dark outline/copper offset highlight; a small diamond tip and symmetric copper scrolls are optional inline SVG children of the existing rotating north group. Base hides that ornament and retains its original letters. Recorded I66/I67; no generated/raster asset or map-geometry changes.
- Added **Minimap → Show waypoint guide** to the unified showcase sidebar. `SHOWCASE_WAYPOINT` is a typed, off-disc sample destination. The same navigation owner used by the fixture drives the real minimap pointer/distance footer; checkbox state follows explicit set/clear/chat actions, including the footer clear button. No simulated guide markup or alternate map renderer. The destination remains session-local and does not enter saved preferences. Focused showcase checks passed enable/disable, native clear, arrow/footer visibility and retention of the exact minimap instance; no browser errors or screenshots. Type checks (0 Svelte errors/warnings), lint and formatting passed. Production build and `git diff --check` also passed; build retains the existing large-chunk advisory. No broad HUD regression or agent visual checks.

- User refinement pass: the north N is now 26 compass units, using the bundled Gelasio bold face with a gold gradient, heavier bronze outline, tight light upper edge and dark offset depth. The ornament tip shares the same per-instance SVG gradient. Header stitch colors/holes were reduced in opacity, and their independent background-layer property is set to `none` on native dialog headers, retaining leather/shading without thread. Recorded I68/I69; user owns visual acceptance.
- Selected-entity header stacking: the component now isolates its own stacking context and gives the header grid item positive local z priority, placing the icon buttons and their painted edges above the following health strip in both themes. No global z-index escalation or interaction/layout changes.
- Font audit: the alternate only consumes `--ui-font-body`, `--ui-font-heading` and existing size roles; it introduces no new font families or remote sources. Base already packages Arimo, Gelasio and Cousine, their regular/bold/italic variants and OFL notices under `public/fonts`, referenced by `ui-fonts.css`. Gelasio’s declared 700 weight supplies the heavier N; extra visual weight comes from the SVG outline/depth rather than an unbundled face. UI_STYLE_GUIDE now explicitly recommends bundling every introduced font, used weight/style and license, with relative `@font-face` URLs and no reliance on host/local substitution. Static checks/build only for this cosmetic pass; outcomes recorded below.

- Gold/header pass verification: `npm run check` passed (0 Svelte errors/warnings), `npm run lint:ts` and `npm run build` passed; focused formatting and diff whitespace checks passed. The existing build chunk-size advisory remains. No broad HUD regression, screenshot capture or agent visual review.

- User promoted Traveler’s Kit to the client default after accepting the visual direction. This supersedes the earlier Base-default shipping decision. `CLIENT_DEFAULT_THEME_ID` owns the preference policy for fresh/reset user settings and sections with no explicit `themeId`; explicit `null` still selects Base and saved user-theme IDs remain intact. The persisted bundled ID moved into the asset-free theme contract so renderer registration and node-side preference decoding share it without importing CSS into Electron. Explorer retains Base. The interactive showcase now applies the client default before becoming ready; controlled diagnostics still explicitly start with Base. Updated README/UI guide and focused absence/saved-choice/startup checks. Existing user settings are not rewritten merely because the default changed. No broad styling/review goal work was resumed by this focused request.

- Default-theme verification: the 46 focused settings/store/bootstrap/composition tests passed; the strengthened fresh-startup assertion passed in the 5-test bootstrap file. The showcase check passed with Traveler’s Kit selected and its stylesheet active before readiness, plus successful return to Base and no browser errors. Final type checks passed with 0 Svelte errors/warnings; lint and production build passed. Build retains its existing chunk-size advisory. No broad HUD regression, screenshot capture or visual acceptance check; the wider plan goal remains paused.

- Closeout after resuming the goal: the user’s final approval ("the theme looks pretty damn good") accepts the visual baseline, and the explicit default-theme request supersedes the alternate-first rollout. Reconciled current status/checklists and retained historical per-iteration review notes as history. Aesthetic checkpoint closure reflects that general approval, not a claim that the agent inspected every background/scale/window combination. No further user eyes are needed to close the implemented plan; future gameplay findings can be handled as follow-up.
- Final source review: shared primitives own native input/progress, HUD geometry and button families; production skin lives in one optional stylesheet over Base; the trusted bundled registry composes with validated native folders; selection/settings retain one existing lifetime. All four SVGs have production consumers and traceable sources. Showcase sample markup delegates to production components and one client fixture. Superseded gallery/navigation paths are removed; the separate recipe probe remains an intentional independent diagnostic. No shared Rust/game semantics or retail behavior changed. No remaining code-quality blocker was found in the reviewed theme, presentation and delivery changes.
- Cleanup corrected the documented shortcut size to the user’s 40px value, removed candidate wording from runtime CSS/harness help, consolidated ledger tables, replaced an obsolete preview URL with launch instructions, and added fresh-profile default assertions to the native theme probe. No unrelated HUD/character-sheet test-fixture repairs remain.
- Final verification: `npm run check` passed with 0 Svelte errors/warnings; `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, `npm run build` and `npm run build:electron:main` passed. The existing build chunk-size advisory remains. Focused selection/transport/bundled/default/settings/bootstrap tests passed: 55 tests across 6 files. The final behavior-affecting version also passed the showcase’s default loading, retained state, native controls, waypoint toggle/clear and Base restoration checks; cleanup changed only documentation/comments and native probe assertions.
- A fresh local Linux x64 Forge package was created from current frontend/Electron output and the unchanged release host with `npm exec -- electron-forge package`; `npm run check:package` passed. `npm run probe:user-themes:built -- --package-root out/holtburger-3d-linux-x64` passed development, built-file and real ASAR modes, decoding all four decorative assets and eight font checks. Native discovery, stylesheet/dependency reload, cancellation/timeouts, failures/recovery, name collision, both settings surfaces, disk restore, fresh default and missing-theme retry passed. No screenshots, agent visual checks, broad HUD regressions, staging or commits occurred during closeout.

- Completion audit: all 77 relative asset-reference links resolve. The four production decorative SVGs and the final combat/minimap/CSS sources match their recorded selected snapshots byte-for-byte. Final package checks prove current ASAR loading; fonts and redistribution notices are covered by the package verifier. All numbered phase deliverables and definition-of-done items are accounted for by source, recorded focused behavior checks, packaged checks or the user’s visual approval. Historical broad HUD/character-sheet failures were not used as passing evidence and were not expanded into this task. No required work or outstanding approval remains in the accepted plan scope.


## Pre-commit code-quality review

Reviewed the accumulated worktree against HEAD, including new production files,
diagnostic consumers, documentation and the reference/intermediate asset ledger.
Verdict: ready within this frontend theme and delivery scope; no confirmed
code-quality finding requires another implementation change.

- Theme delivery seam: traced the asset-free bundled ID through default creation,
  schema decoding, renderer composition, the existing selection queue and settings
  persistence. Inspected the unchanged native transport validation and stylesheet
  replacement owner. Bundled discovery failure, reserved-name collision, timeout,
  cancellation and retirement retain their existing ownership; no second loader or
  relaxed native URL boundary was introduced.
- Control seam: inspected UiRange and all migrated settings/specimen consumers;
  native input remains responsible for gestures and keyboard changes, and the
  wrapper owns only the numeric filled fraction. Checked the icon/compound HUD
  class migration and its independent paint hooks, shortcut metrics and all tray
  callers, equipped-marker defaults, party geometry and overflow, selected-header
  stacking, and decorative combat/minimap geometry against their consumers.
- Showcase seam: traced startup, theme selection, retained panel state, navigation
  set/clear, cooldown publication, keyboard registration and teardown through the
  workbench, shared session contract and client fixture. The fixture remains large,
  but sharing its existing owners removes the former duplicate gallery instead of
  adding another client lifetime. Production presentation does not import fixtures.
- Consolidation and maintenance: the shipped registry is the single bundled catalog;
  changing the default has one policy constant, and ordinary material edits stay
  in the theme stylesheet/assets. Base owns shared control behavior and dimensions.
  The separate recipe probe has a distinct loader diagnostic role and remains
  separate intentionally. Authored runtime SVGs have consumers and recorded source
  snapshots; historical raster references remain plan assets as requested.
- Evidence and limits: current focused tests, type/lint/format/build checks,
  showcase interactions and packaged native-theme checks are recorded above.
  This pass required no code changes or repeat broad HUD suite. The inherited
  character-sheet/enchantment diagnostic failures are not claimed as passing
  coverage. No visual acceptance checks, Rust/game-semantics audit, or live-server
  behavior review were performed. Dirty ACE and ACViewer submodules are excluded.
