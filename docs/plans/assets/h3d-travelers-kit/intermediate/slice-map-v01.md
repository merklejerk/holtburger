# Copper frame v01 slice map

Candidate: second visual iteration of Traveler’s Kit. Authored as an assembled SVG; no Imagen output, raster crop, or seamless texture is involved.

- Parent artwork: [copper-frame-v01.svg](copper-frame-v01.svg), the original source snapshot of `apps/holtburger-3d/src/assets/icons/travelers-kit-frame.svg`. The current [copper-frame-v02.svg](copper-frame-v02.svg) enlarges nailheads and adds dark seats without changing any slice coordinates or frame dimensions.
- Reference: Traveler’s Kit concept R1. User feedback on the first implementation: stronger skeuomorphism on borders and buttons, beyond the header.
- Source canvas/viewBox: 64 × 64.
- Slice coordinates: x = 16 and 48; y = 16 and 48. Corners are 16 × 16 source units; the center is 32 × 32.
- CSS: `border-image-slice: 16` (without `fill`), `border-image-width: 8px`, `border-image-outset: 5px`, `border-image-repeat: stretch`.
- Each source corner renders at 8 × 8 CSS pixels. Straight edge segments stretch along their length; their cross section remains fixed.
- Geometry: preserve the base 1px layout border and all content padding. Painting extends 5px outside the panel; the original window/resize/close hit geometry is retained. A window flush against the viewport can have its outward decoration clipped; do not move the window or expand interactive geometry just to preserve this ornamental overhang.
- Center: intentionally transparent in the source and excluded from border-image painting. The existing panel backing independently controls content translucency.
- Construction: concentric dark socket/copper/highlight/inner-recess profiles, with corner straps and studs. Light comes from above-left. There is no noise or repeated detail on the stretched edges; the independent header grain tiles and stitches repeat through CSS.
- Header: no separate corner studs; the frame now owns fittings at all four corners. The superseded header rivet asset was removed from production.
- Consumer: `.ui-theme .ui-panel` in `src/app/themes/travelers-kit.css`.
- Behavioral evidence: material image decoding, unchanged content backing, return to Base, retained selection/draft, drag, resize and close pass in the browser showcase at 1600 × 1000. User visual acceptance of joins and weight remains pending.
