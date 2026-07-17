# Holtburger 3D Terrain Composition Lookup Plan

Status: Implemented architectural stubs. This plan supersedes the unresolved terrain-composition
GPU-packing portion of `holtburger-3d-shader-composited-terrain-plan.md`. Real host production,
terrain generation, and GLSL composition remain deliberately unimplemented.

## Goal

Encode retail TexMerge terrain composition as an explicit, data-driven lookup path:

```text
regional composition facts
    -> deterministic terrain texture-array facts
    -> compiled RGBA32UI composition table
    -> TerrainService-owned composition device resource
    -> frame terrain input alongside pcode surface and texture bindings
    -> future terrain fragment shader
```

The generated per-cell R32UI pcode field remains the authoritative per-landblock surface selection.
The composition table is stable regional presentation data shared by every interested landblock in
that region, and by every stride and transition geometry variant of each landblock.

## Ground Truth

The following behavior is established by retail and ACE, rather than inferred from current app
names:

- A terrain pcode has four 5-bit terrain codes at bits 15 through 0, four 2-bit road codes at
  bits 27 through 20, and a size field beginning at bit 28.
- Terrain codes select one base color texture and at most three terrain overlays.
- A one-hot terrain overlay code uses the corner alpha-map list. Other overlay codes use the side
  alpha-map list.
- The full pcode deterministically selects one map within the applicable ordered list. The chosen
  map's canonical code is rotated up to four times to match the requested overlay code.
- Road codes yield either a full road surface or at most two road overlays. Road maps use the same
  deterministic selection and rotation pattern.
- The road color texture is terrain descriptor type `0x20`; if absent, retail falls back to the
  first terrain descriptor. A road map supplies only an alpha-mask texture and a canonical road
  code.
- Terrain descriptor lookup for pcode values `0..31` falls back to the first descriptor when the
  selected terrain type is absent.
- Terrain descriptors, corner alpha maps, side alpha maps, and road maps are serialized as ordered
  DAT lists. Only the pcode terrain-code domain has a fixed size of 32.

Primary references:

- `acclient-eor-source/acclient.c`: `CLandBlockStruct::GetCellRotation`,
  `TexMerge::GetTerrain`, `TexMerge::FindTerrainAlpha`, and `TexMerge::FindRoadAlpha`.
- `ACE/Source/ACE.Server/Physics/Common/TexMerge.cs`: readable corroboration of base/overlay,
  alpha-map, rotation, and road selection.
- `crates/holtburger-content/src/landblock_scene_assets.rs`: current pcode packing helpers.
- `crates/holtburger-content/src/material_graph.rs`: current region composition resolution and its
  flattening of corner and side alpha-map lists.

## Design Decisions

### Preserve composition groups in source facts

Corner and side alpha maps must remain separate ordered lists. Flattening them loses the list count
and group boundary required by deterministic map selection.

Road color is represented by terrain descriptor type `0x20`, not repeated on every road map.

The pcode bit layout is a fixed terrain-domain constant. It is not host-provided regional data.

### Separate generation from presentation

Terrain mesh and pcode generation consume only canonical landblock heights and terrain samples.
Regional composition and texture facts are presentation input, not generation input.

```ts
interface TerrainGenerationSource {
  readonly heightBytes: Uint8Array;
  readonly terrainSamples: Uint16Array;
}

interface TerrainPresentationSource {
  readonly composition: TerrainCompositionFacts;
  readonly textures: ResolvedTerrainTextureFacts;
}

interface TerrainSourceInstallation {
  readonly landblockId: LandblockId;
  readonly generation: TerrainGenerationSource;
  readonly presentation: TerrainPresentationSource;
}
```

The terrain generator receives `TerrainGenerationSource` only. `TerrainService` owns device
realization of its generated output and the stable composition table.

### Compile one integer lookup texture

`TerrainShaderCompositionTable` is a compiled CPU upload shape, not an object graph mirrored into
the frame input:

```ts
interface TerrainShaderCompositionTable {
  readonly width: number;
  readonly texels: Uint32Array;
}
```

It uploads as a nearest-filtered, clamp-to-edge `RGBA32UI` texture. Its width is:

```text
max(33, cornerAlphaMapCount, sideAlphaMapCount, roadAlphaMapCount)
```

The fixed six-row record layout is:

```text
row 0, columns 0..32: terrain type: colorLayer, tiling, minBrightness, maxBrightness
row 1, columns 0..32: terrain type: minSaturation, maxSaturation, minHue, maxHue
row 2:                 corner alpha: maskLayer, canonicalTerrainCode, 0, 0
row 3:                 side alpha:   maskLayer, canonicalTerrainCode, 0, 0
row 4:                 road alpha:   maskLayer, canonicalRoadCode, 0, 0
row 5, column 0:       cornerCount, sideCount, roadCount, detailTiling
```

Columns `0..31` are complete terrain-type lookup entries. Missing authored entries use the first
terrain descriptor, matching retail fallback. Column `32` is the road-color descriptor, with the
same fallback. All values are exact integers, so the lookup texture avoids float packing and fixed
GLSL uniform-array capacities.

The table contains logical texture-array layer indices derived from the ordered texture facts. It
does not depend on a live `TextureManager` binding.

### Give regional composition one device owner

`TerrainService` maintains one `TerrainCompositionResourceKey` per resolved region through
`RendererResourceManager`. The region number is the stable composition identity: terrain sources
are idempotent while interest remains, and no source-revision dimension exists in this model.

The service retains that resource while one or more landblock installations from the region remain
interested. It creates the resource for the first installation and releases it when the final
installation is removed. It does not own the renderer or the texture manager.

```ts
interface TerrainDrawResources {
  readonly geometry: GeometryResourceKey;
  readonly indexStart: number;
  readonly indexCount: number;
  readonly surfaceField: TerrainSurfaceResourceKey;
  readonly composition: TerrainCompositionResourceKey;
  readonly textures: TerrainTextureKeys;
}
```

The service selects geometry and surface-field variants with the scene anchor. The composition key
and logical texture keys remain stable for each installation.

## Target Source Shapes

```ts
interface TerrainMaterialType {
  readonly terrainType: number;
  readonly colorTextureId: DatAssetId;
  readonly tiling: number;
  readonly colorVariation: TerrainColorVariation;
}

interface TerrainAlphaMap {
  readonly terrainCode: number;
  readonly blendMaskTextureId: DatAssetId;
}

interface TerrainRoadAlphaMap {
  readonly roadCode: number;
  readonly roadMaskTextureId: DatAssetId;
}

interface TerrainCompositionFacts {
  readonly regionNumber: number;
  readonly terrainTypes: readonly TerrainMaterialType[];
  readonly cornerTerrainAlphaMaps: readonly TerrainAlphaMap[];
  readonly sideTerrainAlphaMaps: readonly TerrainAlphaMap[];
  readonly roadAlphaMaps: readonly TerrainRoadAlphaMap[];
  readonly landscapeDetail: TerrainLandscapeDetail;
}
```

The exact numeric representation of color variation remains the one decoded from the terrain DAT
record. The table carries it now so the terrain-program contract is complete; the later GLSL stage
defines the visual equation that consumes those fields.

## Implementation Steps

1. Add `game/terrain/pcode.ts`.
   - Move fixed pcode constants and CPU decode helpers out of host contracts.
   - Add pure functions for terrain-code extraction, road-code extraction, deterministic variation
     selection, canonical-code rotation, terrain-overlay selection, and road-overlay selection.
   - Treat these functions as the executable CPU reference for the terrain program, not as a
     temporary fallback renderer.
   - Add test vectors from retail-compatible pcode packing and selection cases. The future GLSL
     implementation must match these vectors.

2. Replace flattened terrain-composition facts.
   - Update `game/terrain/types.ts` with separate corner and side map lists and road-mask-only maps.
   - Remove `alphaIndex`, `roadIndex`, repeated `roadTextureId`, and `TerrainPcodeEncoding`.
   - Split `TerrainGenerationSource` from terrain presentation facts as shown above.

3. Update host and resolver contracts.
   - Change `assets/host-contracts.ts` DTOs to transfer corner and side maps separately.
   - Update `resolution/landblock-layer.ts` and `resolve-landblock-layer.ts` to preserve exact list
     order and reject an empty terrain descriptor list.
   - Update the Rust host contract implementation when it is brought forward from legacy; do not
     retain a compatibility DTO that flattens the lists.

4. Correct texture-fact derivation.
   - Build the color array from terrain descriptors only, including descriptor `0x20` when present.
   - Build blend-mask membership from corner maps followed by side maps.
   - Build road-mask membership from road alpha maps.
   - Keep detail as one standalone texture.
   - Add tests for ordered membership, deduplication, road descriptor fallback, and absent map lists.

5. Add `game/terrain/composition-table.ts`.
   - Compile raw composition facts and ordered texture facts into the six-row `Uint32Array` table.
   - Normalize fixed terrain type entries `0..31` and road entry `32` using retail fallback.
   - Fail loudly if a referenced source texture is missing from its expected logical texture array.
   - Test dimensions, rows, fallback behavior, and logical layer assignment.

6. Add composition resource-manager support.
   - Define `TerrainCompositionResourceKey` and renderer resource-manager create/get/release methods.
   - Make WebGL2 upload `RGBA32UI` composition textures with nearest sampling and clamp wrapping.
   - Keep `TerrainSurfaceResourceKey` specifically for the per-stride R32UI pcode field.
   - Add resource lifecycle tests alongside existing terrain surface resource tests.

7. Install and expose composition resources through `TerrainService`.
   - Compile and allocate one composition resource for the first interested source in a region.
   - Reuse the regional resource for each additional landblock installation in that region.
   - Release it when the final installation for that region is removed or the service is destroyed.
   - Return its key from `getDrawResources`; remove raw composition facts from that return type.
   - Keep source installation non-blocking with respect to texture residency. Missing logical
     texture resources still make a terrain draw ineligible at frame assembly.

8. Simplify frame and renderer inputs.
   - Replace per-frame `createTerrainShaderInput()` composition compilation with a direct
     composition resource key.
   - Define a complete `TerrainProgramInput` with pcode surface, composition table, color array,
     blend-mask array, road-mask array, and detail texture bindings.
   - Have frame assembly resolve all six device resources and pass that input to the terrain draw
     path. This is the renderer-facing contract for the later compositing program.
   - Do not issue inert sampler-unit bindings against the current flat-color shader. The terrain
     program binds its declared samplers when the real GLSL implementation arrives.

9. Implement the GLSL terrain-composition program only after the shapes above exist.
   - Mirror the pcode algorithm using integer `texelFetch` reads.
   - Test shader output against CPU selection vectors before treating terrain visuals as evidence.
   - Do not reintroduce baked TexMerge color surfaces, `featureSlots`, per-road color layers, or
     fixed-capacity uniform arrays.

## Acceptance Criteria

- No runtime terrain type flattens corner and side alpha-map lists.
- No pcode-layout DTO crosses the host boundary.
- Terrain generation code has no dependency on regional composition or texture keys.
- TerrainService shares one stable composition device resource across interested landblocks in a
  resolved region, while each landblock retains its own generated geometry/surface resources.
- Every terrain draw references a pcode surface resource, composition lookup resource, and logical
  texture keys through `TerrainProgramInput`; no raw composition object is rebuilt per frame.
- Composition table dimensions support arbitrary DAT list cardinality without a shader source edit.
- CPU selection tests prove base, terrain-overlay, road-overlay, variation, rotation, and fallback
  behavior from retail-compatible vectors.
- Existing runtime texture residency semantics remain unchanged: absent device textures cause the
  frame to drop the terrain draw and report the terminal preparation failure.

## Explicitly Deferred

- Rust host implementation of the new DTOs.
- Real worker terrain geometry generation.
- Terrain GLSL blend equations, UV policy, detail visual policy, lighting, and effects.
- DAT-wide measurement of actual corner, side, and road alpha-map cardinalities. The table format
  deliberately does not require those maxima to be known first.
