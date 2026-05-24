# Holtburger 3D Polygon Sidedness Parity Plan

Status: draft implementation plan.

## Purpose

Bring Holtburger 3D polygon sidedness and culling behavior closer to the retail
Asheron's Call client, and remove renderer/material workarounds that currently
paper over incomplete geometry preparation.

The intended end state is simple:

- decoded polygon data determines render sides;
- prepared geometry emits the sides the retail client would render;
- Three.js materials do not reinterpret AC polygon sidedness;
- debug modes may override culling for diagnostics, but production game
  geometry should not depend on debug-style `DoubleSide` rendering.

## References

Retail client and ACE are the primary references for this plan:

- Retail `CullModeType` enum:
  [`acclient-eor-source/acclient.h`](../../acclient-eor-source/acclient.h)
- Retail `CPolygon::UnPack` and serialization behavior:
  [`acclient-eor-source/acclient.c`](../../acclient-eor-source/acclient.c)
- Retail immediate polygon drawing:
  `D3DPolyRender::DrawPolyInternal` in
  [`acclient-eor-source/acclient.c`](../../acclient-eor-source/acclient.c)
- Retail constructed mesh building:
  `D3DPolyRender::ConstructMesh` in
  [`acclient-eor-source/acclient.c`](../../acclient-eor-source/acclient.c)
- ACE DAT polygon unpacking:
  [`ACE/Source/ACE.DatLoader/Entity/Polygon.cs`](../../ACE/Source/ACE.DatLoader/Entity/Polygon.cs)
- ACE cull/stippling enums:
  [`ACE/Source/ACE.Entity/Enum/CullMode.cs`](../../ACE/Source/ACE.Entity/Enum/CullMode.cs)
  and
  [`ACE/Source/ACE.Entity/Enum/StipplingType.cs`](../../ACE/Source/ACE.Entity/Enum/StipplingType.cs)
- ACViewer renderer code:
  [`ACViewer/ACViewer/Render/`](../../ACViewer/ACViewer/Render/)

ACViewer is useful as a working renderer, but it is not the final authority for
this behavior. It contains approximations such as global `CullMode.None`, global
`CullClockwiseFace`, comments about missing negative UV handling, and env-cell
`NoPos` skips.

## Current Evidence

### DAT unpacking

ACE, Holtburger's DAT decoder, and the retail decompile agree on the stored
polygon side model:

- `stippling & NoPos` means the positive side has no UV data and should not use
  the normal positive textured side path.
- Negative UVs are stored only when `sides_type == Clockwise` and `NoNeg` is not
  set.
- When `sides_type == None`, the client aliases negative side data to the
  positive side:
  - `neg_surface = pos_surface`;
  - `neg_uv_indices = pos_uv_indices`.

This matters because `sides_type == None` does not mean "ignore side data." It
means "same material/UVs are valid from the opposite side."

Holtburger already preserves this decoding behavior in
`crates/holtburger-dat/src/graphics.rs`, so the parity problem is not DAT
unpacking. The known mismatch is later, when content preparation turns decoded
polygons into render geometry.

### Retail immediate polygon draw path

`D3DPolyRender::DrawPolyInternal` draws the positive side and sets D3D culling
like this:

- if `override_cull_state_0` or `p->sides_type == 1`, use `CULLMODE_NONE`;
- otherwise use `CULLMODE_CW`.

This path does not appear to switch per polygon to `CULLMODE_CCW` for
`sides_type == CounterClockwise`.

This path also uses the positive side surface and UV table. That makes it useful
for understanding old immediate polygon behavior, but Holtburger 3D primarily
needs parity with the constructed mesh path used by static `gfx-obj` rendering.

### Retail constructed mesh path

`D3DPolyRender::ConstructMesh` expands polygon sidedness into mesh geometry.
The important observed behavior:

- `sides_type == None`:
  - counts twice as many triangles;
  - emits a second pass for the same side using reversed winding;
  - uses the positive surface and positive UVs for both directions.
- `sides_type == Clockwise`:
  - emits a positive side;
  - emits a negative side using `neg_surface` and `neg_uv_indices`;
  - skips the negative side when negative UVs were not stored because `NoNeg`
    was set.
- other values appear to emit only the positive side in the constructed mesh
  path unless further retail evidence proves otherwise.

The retail mesh path therefore makes sidedness a geometry-expansion concern, not
a material flag concern.

The decompiled constructed mesh control flow has explicit branches for
`sides_type == None` and `sides_type == Clockwise`. We have not found a
constructed-mesh branch that flips positive geometry for
`sides_type == CounterClockwise`.

### ACViewer evidence level

ACViewer confirms several practical renderer choices but is not authoritative
for side expansion:

- `R_CellStruct` globally disables rasterizer culling and skips env-cell
  `NoPos` polygons with a comment calling it a hack for env cells/buildings.
- `R_GfxObj` has a TODO for two-sided faces and does not implement the retail
  negative-side expansion.
- several render paths use global `CullMode.None`, so ACViewer cannot be used
  to justify production `DoubleSide` material behavior in Holtburger.

## Current Holtburger Deviations

The current code has several mismatches:

- Rust `build_polygon_set_render_geometry` emits one side for most polygons and
  flips winding/normals for `sides_type == CounterClockwise`.
- Rust does not consistently expand `sides_type == None` into duplicated
  reversed geometry.
- Rust does not correctly emit separate positive and negative sides for
  `sides_type == Clockwise` using `neg_surface` and `neg_uv_indices`.
- Structured interior rendering passes `doubleSided: true` to the material cache
  to make shell geometry visible. This is a renderer workaround, not retail
  geometry parity.
- The TypeScript worker no longer builds fallback polygon geometry for `gfx-obj`
  payloads. It passes through Rust-provided `renderGeometry`, so sidedness parity
  now belongs entirely in Rust content preparation for production assets.
- Static `gfx-obj` rendering currently uses front-sided Three materials, while
  env-cell shells use double-sided material state. That difference is an
  artifact of our pipeline rather than a proven retail distinction.
- Rust records invalid polygons only for missing vertex ids today; malformed or
  missing UV data is counted as a skip without a reason that can diagnose
  `NoPos`, `NoNeg`, or bad side data.
- `PreparedPolygonSetRenderTriangle` currently has only `polygon_id`,
  `surface_id`, and `first_vertex`, so downstream debug tools cannot tell
  whether a triangle came from a positive side, negative side, or reversed
  duplicate.

## Target Model

Introduce one canonical polygon-side expansion model in Rust content
preparation.

Each renderable side should explicitly carry:

- side kind: `positive`, `negative`, or `positive-reversed`;
- surface id;
- UV index slice;
- triangle winding policy;
- normal scale;
- optional diagnostic reason/source.

Target expansion rules:

1. If positive side is renderable, emit the positive side.
2. If `sides_type == None`, emit a reversed duplicate using the positive
   surface and positive UVs.
3. If `sides_type == Clockwise` and negative side data is present, emit the
   negative side using `neg_surface` and `neg_uv_indices`.
4. If `sides_type == Clockwise` and `NoNeg` suppressed negative UVs, emit only
   the positive side.
5. Do not special-case `CounterClockwise` by flipping the positive side unless
   retail evidence proves that is required for the relevant render path.

For the first implementation, `CounterClockwise` should be treated as positive
only in constructed render geometry, plus a diagnostic count. If live asset data
shows important constructed assets using that value, re-open the rule only with
reference evidence or a focused ACViewer/client comparison.

The first implementation should keep unknown or unsupported combinations
diagnostic rather than silently inventing behavior.

## Non-Goals

- Do not rewrite material decoding or texture sampling in this plan.
- Do not use ACViewer's global rasterizer state as the final source of truth.
- Do not introduce renderer-specific compatibility shims.
- Do not add tests that require repo-local DAT/HBA assets.
- Do not solve portal visibility or BSP traversal in this plan.
- Do not remove debug render modes such as wireframe/no-material.

## Phase 0: Evidence Lockdown

Tasks:

- Add a short source comment near the Rust side-expansion helper that points to
  the retail and ACE evidence.
- Reference these source locations in the implementation comments or PR:
  - ACE `Polygon.Unpack` for `None` aliasing and `Clockwise` negative UV reads;
  - Holtburger DAT `Polygon` decoding for the same behavior;
  - retail `CPolygon::UnPack`;
  - retail `D3DPolyRender::DrawPolyInternal`;
  - retail `D3DPolyRender::ConstructMesh`.
- Add a small diagnostic/data-audit path, or a harness command if easier, that
  can count polygon `sides_type` and stippling combinations in live DAT-backed
  content without adding asset-dependent tests to this repo.
- Use that audit to answer whether `CounterClockwise` appears in constructed
  mesh assets we care about. If it does, record representative asset ids in this
  plan or a follow-up note before changing behavior.

Exit criteria:

- The implementation has a clear, source-backed rule table.
- `CounterClockwise` and unusual `NoPos`/`NoNeg` combinations are either backed
  by the audit or explicitly documented as unknown instead of guessed.

## Phase 1: Canonical Rust Side Expansion Helper

Tasks:

- Add an internal helper in `crates/holtburger-content/src/landblock_scene_assets.rs`.
- Suggested shape:

```rust
struct PreparedPolygonRenderSide<'a> {
    kind: PreparedPolygonRenderSideKind,
    surface_id: Option<i16>,
    uv_indices: &'a [u8],
    winding: PreparedPolygonWinding,
    normal_scale: f32,
}
```

- Fail or skip with diagnostics when a side requires UV indices that are missing
  or have the wrong length.
- Split "derive renderable sides" from "append triangulated side geometry" so
  rule tests do not need to inspect large geometry buffers for every case.
- Add explicit skip/diagnostic reasons for:
  - missing positive UVs;
  - malformed positive UVs;
  - missing negative UVs when a negative side is required;
  - malformed negative UVs;
  - unsupported/unknown side mode.
- Keep the helper small and fixture-testable.

Exit criteria:

- Both side derivation and triangulation can be tested without real assets.
- Existing geometry builders no longer encode side rules inline.

## Phase 2: Apply To GfxObj Geometry

Tasks:

- Update `build_gfx_obj_render_geometry` to use the canonical helper.
- Emit positive, positive-reversed, and negative sides according to the target
  model.
- Preserve material grouping through `surface_id` on each emitted triangle.
- Remove `CounterClockwise` positive-side winding flips unless Phase 0 proves
  they are retail-correct.
- Preserve the existing drawing-BSP polygon-id filter for `gfx-obj` meshes, but
  make side expansion independent of that filter.

Exit criteria:

- `gfx-obj` prepared geometry has retail-shaped sides.
- `sides_type == None` doubles triangles through geometry, not through material
  `DoubleSide`.
- `sides_type == Clockwise` can assign distinct front/back surfaces.

## Phase 3: Apply To Env-Cell Shell Geometry

Tasks:

- Update cell-structure render geometry to use the same helper.
- Keep the current decision to draw the full `CellStruct.polygons` list unless
  retail evidence later proves drawing BSP filtering is required.
- Emit per-side surfaces for env-cell shell geometry instead of relying on
  double-sided material state.
- Treat env-cell `NoPos` as non-renderable for the positive side. Do not invent
  untextured shell geometry unless retail or a focused client comparison proves
  that path exists.

Exit criteria:

- Env-cell shells and static `gfx-obj` geometry use one side-expansion model.
- Interior cell shell material groups can represent distinct negative surfaces.

## Phase 4: Remove Renderer/Material Ceremony

Tasks:

- Stop passing `doubleSided: true` for structured interior game geometry once
  env-cell shell geometry emits the proper sides.
- Keep `DoubleSide` for diagnostic-only render modes where it is intentionally
  useful:
  - wireframe;
  - no-material/debug material;
  - explicit debug overlays.
- Ensure static renderables and structured interiors both use normal
  front-sided materials in solid mode.
- Audit every `DoubleSide` use in
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts` and
  `apps/holtburger-3d/src/lib/world-display/material-resources.ts`; keep only
  diagnostic/no-material/wireframe/overlay cases with names that make their
  diagnostic role obvious.

Exit criteria:

- Production solid rendering does not depend on material-side double-sidedness
  for AC polygon sidedness.
- Debug modes are clearly diagnostic overrides, not correctness mechanisms.

## Phase 5: Keep TypeScript As Pass-Through

Tasks:

- Keep the TypeScript worker as a DTO validation/preparation boundary for
  `gfx-obj` payloads.
- Do not reintroduce TypeScript-side polygon triangulation or side expansion.
- Ensure tests and fixtures provide `renderGeometry` when they construct
  prepared `gfx-obj` payloads.
- If a future non-Tauri host path needs client-side geometry building, implement
  it by sharing or porting the Rust side-expansion rule table deliberately, not
  by adding ad hoc fallback knobs.

Exit criteria:

- There is one production interpretation of polygon sidedness.
- TypeScript cannot silently drift from Rust behavior because it does not
  reinterpret polygon sides.

## Phase 6: Fixture-Only Tests

Add tests that construct minimal synthetic polygons and vertex arrays.

Required cases:

- `NoPos` suppresses the normal positive side.
- `sides_type == None` emits reversed duplicate geometry with positive
  surface/UVs.
- `sides_type == Clockwise` emits positive and negative sides with separate
  surfaces and UVs.
- `sides_type == Clockwise | NoNeg` emits only the positive side.
- missing or malformed UV arrays produce diagnostics/skips according to the
  helper contract.
- `CounterClockwise` behavior is locked to the Phase 0 evidence.
- constructed-mesh `CounterClockwise` currently emits positive-only geometry
  unless the audit/reference work changes the target rule.

Assertions should cover:

- triangle count;
- surface id per triangle;
- first-vertex/winding order;
- normal scale;
- side kind if the DTO is extended to expose it;
- skipped/invalid polygon diagnostics.

Exit criteria:

- No tests depend on repo-local assets.
- Tests make the retail side model hard to regress.

## Phase 7: Validation

Automated checks:

- `cargo test -p holtburger-content landblock_scene_assets`
- `cargo check -p holtburger-3d`
- `npm run check` from `apps/holtburger-3d`
- focused TypeScript tests for material grouping/static renderable geometry if
  touched

Manual inspection scenarios:

- outdoor-linked interior env cells with visible shell walls and static objects;
- dungeon landblocks with walls, doors, and fixtures;
- outdoor static objects with surfaces visible from both sides;
- known scenes that previously required no-material/wireframe diagnostics to
  confirm missing geometry.

## Cleanup Checklist

- Replace `derive_environment_polygon_render_side` and `PolygonRenderSide` in
  `crates/holtburger-content/src/landblock_scene_assets.rs` with the canonical
  side-expansion helper.
- Remove `CULL_MODE_COUNTER_CLOCKWISE` winding/normal flipping from
  `build_polygon_set_render_geometry` unless Phase 0 proves it is retail-correct
  for constructed meshes.
- Remove inline side-rule branches from `build_polygon_set_render_geometry`; it
  should only validate common polygon shape, call the helper, and append emitted
  sides.
- Extend `PreparedPolygonSetInvalidPolygon` or add a sibling diagnostic type so
  skipped UV/sidedness cases are visible, not just counted.
- Remove `doubleSided: true` from
  `createStructuredInteriorCellMesh` in
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts` for solid
  game geometry.
- Keep `DoubleSide` only in explicit diagnostic material paths such as
  wireframe, no-material, portal overlays, or other debug overlays.
- Keep the TypeScript worker as pass-through for Rust-prepared `renderGeometry`;
  do not reintroduce fallback cull/side knobs.
- Keep `apps/holtburger-3d/src/workers/asset-worker.ts` limited to DTO
  validation and transfer normalization for prepared geometry.
- Update any docs or diagnostics that describe `sides_type` as a material cull
  mode rather than a polygon side expansion source.
- Keep debug render modes clearly labeled as diagnostic overrides.

## Resolved/Open Questions

- `CounterClockwise` constructed mesh behavior:
  - Reference status: no retail constructed-mesh branch found that flips or
    duplicates `CounterClockwise`; known special expansion branches are `None`
    and `Clockwise`.
  - Plan answer: do not implement a flip. Emit positive-only geometry and add a
    data audit/diagnostic for any live constructed assets using this mode.
- Env-cell `NoPos` shell behavior:
  - Reference status: DAT/ACE say positive UVs are absent; ACViewer skips
    env-cell `NoPos` polygons but labels the skip as a hack.
  - Plan answer: keep `NoPos` non-renderable for the positive side. Do not
    generate untextured geometry as a workaround.
- Immediate draw vs constructed mesh:
  - Reference status: retail has both paths. `CGfxObj` has a constructed mesh
    path, and Holtburger 3D consumes prepared static/interior geometry rather
    than issuing immediate polygon draws.
  - Plan answer: model production `gfx-obj` and env-cell shell geometry after
    retail constructed mesh expansion. Immediate draw behavior is reference
    context only unless we later implement a specific immediate-mode feature.
- Remaining unknown:
  - Live DAT frequency and importance of `CounterClockwise`, `NoPos`, and
    malformed side data in the asset families we render. Answer this with a
    local diagnostic/harness audit, not asset-dependent committed tests.
