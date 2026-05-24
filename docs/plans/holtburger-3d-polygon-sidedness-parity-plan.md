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

ACE and the retail decompile agree on the stored polygon side model:

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

### Retail immediate polygon draw path

`D3DPolyRender::DrawPolyInternal` draws the positive side and sets D3D culling
like this:

- if `override_cull_state_0` or `p->sides_type == 1`, use `CULLMODE_NONE`;
- otherwise use `CULLMODE_CW`.

This path does not appear to switch per polygon to `CULLMODE_CCW` for
`sides_type == CounterClockwise`.

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
- Record the exact retail line/function names in the implementation PR
  description or update this plan with more precise offsets after final review.
- Verify whether `sides_type == CounterClockwise` has any special constructed
  mesh handling in retail beyond the evidence already found.

Exit criteria:

- The implementation has a clear, source-backed rule table.
- Unknown behavior is explicitly documented as unknown instead of guessed.

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

Assertions should cover:

- triangle count;
- surface id per triangle;
- first-vertex/winding order;
- normal scale;
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

- Remove inline side-rule branches from `build_polygon_set_render_geometry`.
- Remove renderer `doubleSided` usage for structured interior solid game
  rendering.
- Keep the TypeScript worker as pass-through for Rust-prepared `renderGeometry`;
  do not reintroduce fallback cull/side knobs.
- Update any docs or diagnostics that describe `sides_type` as a material cull
  mode rather than a polygon side expansion source.
- Keep debug render modes clearly labeled as diagnostic overrides.

## Open Questions

- Does retail ever use `sides_type == CounterClockwise` for constructed static
  meshes, and if so is it handled by data winding, rasterizer state, or an
  omitted branch in the decompile evidence reviewed so far?
- Are there env-cell shell cases where `NoPos` should still produce untextured
  geometry, or is ACViewer's env-cell `NoPos` skip closer to retail?
- Does any live asset path still use immediate polygon drawing instead of
  constructed mesh behavior for geometry we care about in Holtburger 3D?
