# Holtburger 3D Terrain Loading Pipeline Plan

Status: Implemented for the terrain loading boundary. Visual comparison against reference
applications is deliberately user-owned work.

## Implementation Record

### 2026-07-23 — Superseded regional terrain payload

The active-region data pipeline supersedes this plan's original `HBTR` boundary. `HBTR` now
contains raw height indices, terrain samples, and typed availability only. The 3D frontend
bootstraps one `HBAR` active-region payload, derives heights from `LandDefs`, uses fixed outdoor
topology from shared world constants, and resolves terrain composition/detail facts locally. The
older record below remains historical evidence for the original host boundary; it must not be read
as the current transport contract.

### 2026-07-23 — Shared terrain facts and repository discovery

Completed:

- `RegionDesc` now retains `LandDefs.LandHeightTable`; `CellLandblockFact` resolves authored
  height indices against that table rather than using `height * 2.0`.
- `TerrainGridSource` now carries canonical row-major height indices, resolved heights, and full
  terrain samples. The DAT column-major to canonical-order conversion occurs once during shared
  terrain assembly; mesh generation consumes the canonical grid directly.
- Generated scenery height sampling now uses the same regional table, keeping terrain and scenery
  authoritative and mutually aligned.
- `ResolvedTerrainMaterialTable` now preserves ordered corner and side terrain alpha-map groups.
  The legacy adapter alone projects them back into its combined historical payload shape.
- `ContentRepository::discover` now owns the CLI-proven explicit override, `HOLTBURGER_DATS`,
  portable-directory, and platform-data lookup order. The CLI uses it instead of carrying a copy.
- The 3D host initializes that same discovery API with no app-local override. Consequently, a
  development or packaged 3D run can use precisely the CLI's `HOLTBURGER_DATS`, `./dats`, and
  platform-data behavior; a Tauri-specific content-archive setting is neither required nor
  desired for this pipeline.
- The evidence pass found no authored landscape-detail fade field in ACE's parsed region/material
  records, ACViewer, or the retail-decompile search. The only `10.0`/`50.0` values are legacy
  adapter constants consumed directly by its WebGL detail-fade uniform. They remain frontend
  renderer policy and do not belong in the client-agnostic terrain or IPC contracts.

Decisions and concessions:

- Cell IDs, rather than caller mode or residency, establish the only proven content distinction:
  `xxxxFFFF` addresses the outdoor `CellLandblock`, while `xxxx0100+` addresses `EnvCell` interior
  records in the same high-word landblock. ACE explicitly says an `EnvCell` can be either a dungeon
  or a building interior, so its presence cannot classify the owner as a terrainless dungeon.
  Normalizing interior interest to the owner `xxxxFFFF` and attempting terrain is therefore the
  correct common path.
- There is no authoritative companion-record shape that distinguishes an intentionally absent
  outdoor `CellLandblock` from an incomplete archive. A missing record is represented as
  terrain-absent with a diagnostic; decode/validation errors remain failures. We must not label an
  absence a “dungeon” or hide it as expected content merely because an `EnvCell` is also present.
  This is an evidence-backed limitation, not an invitation to revive an interior-only source mode.
- `LandblockSceneLodContext::Interior` was removed from content, core caching, legacy projection,
  and diagnostics. Every scene-LoD request now has the one cumulative outdoor content shape.
  `CanonicalTerrainMesh` and `TerrainPcodeField` replace the misleading prior names atomically.
- The post-cutover consumer audit confirms that numeric scene levels still express only cumulative
  complete-family inclusion. `holtburger-content` builds each newly required family once;
  `holtburger-core` may satisfy a lower request from a higher cached asset, but projects it by
  retaining every layer at or below the requested family level. Cache extension appends only the
  missing complete families. The Tauri terrain-source command deliberately requests Level 0, and
  the legacy adapter preserves the caller's requested scene level. No consumer treats a scene level
  as terrain-mesh simplification, material quality, or a partial family selection.
- The legacy JSON adapter retains its positional combined alpha-map payload solely as an app-local
  compatibility projection. New IPC must use the separate source groups.

Verification:

- Focused terrain-grid and mesh tests pass, including a nonlinear height-table/orientation fixture
  and a non-finite-table rejection.
- Content-discovery precedence test passes.
- `cargo check -p holtburger-content -p holtburger-core -p holtburger-3d`,
  `cargo check -p holtburger-content -p holtburger-3d-legacy`, and
  `cargo check -p holtburger-cli -p holtburger-content` pass at this checkpoint.

### 2026-07-23 — Typed terrain and texture host boundaries

Completed:

- `apps/holtburger-3d/src-tauri` now owns managed `ContentAssetRuntime` state initialized through
  `ContentRepository::discover` and exposes only `load_terrain_source` for this slice. Its
  repository-injection constructor lets host projection tests avoid discovery and Tauri entirely.
- The command normalizes an eight-digit landblock ID, requests cumulative Level 0 content plus the
  regional terrain material table and render profile, and rejects mismatched content identities.
- The `HBTR` response carries versioned JSON metadata and aligned binary sections for `u8` height
  indices, `f32` resolved heights, and `u16` terrain samples. It returns `terrain: null` only with
  the typed `missing-cell-landblock` status rather than fabricating a grid or masking bad content.
- The frontend now has separate `LandblockTerrainSource` and `TexturePixelSource` ports. The
  generic `AssetBridge`, generic landblock-layer Tauri command, and JSON-array terrain decoder were
  deleted from the terrain path. `decodeTerrainSource` validates the binary response before making
  typed arrays and deriving terrain texture requirements.
- `load_texture_pixels` now accepts only a `surface-texture/<eight-hex-digit-id>` source and one
  terrain semantic purpose. It maps color/detail to RGBA8 and blend/road masks to R8, then returns
  a versioned `HBTP` binary response containing one declared pixel section.
- `ContentRepository::resolve_surface_texture_pixels` preserves the AC source-level rule: select
  the first _available_ `RenderSurface` declared by a `SurfaceTexture`, not mechanically the first
  ID. This matters in the active archive, where several terrain mask textures list a missing first
  level followed by the usable `CustomLandscapeAlpha` level.
- The shared pixel normalizer is client-agnostic and deliberately supports the terrain formats
  proven by the current archive: `A8R8G8B8` becomes RGBA8 via BGRA channel reordering, while
  `CustomLandscapeAlpha` (and `A8`) becomes R8 without a lossy color expansion. It validates the
  authored byte length before either conversion.
- `TauriTexturePixelSource` and `decodeTexturePixels` now consume that command. The frontend
  validates response magic/version/length, requested identity and purpose, semantic channel
  format, dimensions, and the one bounded binary pixel section before handing it to the existing
  texture preparer.
- `HBTR` terrain-material entries now carry `colorVariation` as one nested composite, matching the
  frontend's terrain source contract. The terrain decoder now rejects malformed source texture IDs,
  absent required texture families, invalid selectors, non-finite variation values, and non-positive
  tilings before it derives texture identities.
- `HBTR` now also carries a typed terrain-availability outcome. `missing-cell-landblock` is the
  sole terrain-absent result; `cell-landblock-decode-failed` and `terrain-assembly-failed` are
  decoder errors. This preserves the shared assembler's missing-versus-decode-failed diagnostic
  distinction at the app boundary instead of flattening both into `terrain: null`.
- `PreparedTerrainMesh` is now `CanonicalTerrainMesh`, and the generated `TerrainSurfaceField` is
  now `TerrainPcodeField`. These are clean cutovers across shared content, the legacy projection,
  and new-app terrain types; the landblock grid had already correctly been named
  `terrain_samples`, while regional material-table `terrain_types` remains intentionally distinct.
- `inspect_terrain_loading` is a non-interactive debug harness for a chosen archive and landblock.
  It uses `ContentAssetService` plus the shared pixel resolver to report the canonical grid, height
  range, terrain/road codes, and every resolved texture's source surface, output format, dimensions,
  and byte length. Running it against `DA55FFFF` proved the end-to-end source facts from the active
  archive without launching either UI.
- Texture materialization failures now enter the frontend's structured logger after releasing the
  failed owner's leases. They no longer rely solely on `console.error`, so a missing or unsupported
  terrain texture is observable through runtime diagnostics and cannot leave a drawable unit with
  stale texture ownership.
- A withdrawn terrain owner now has an explicit async-preparation regression test: when the final
  lease disappears before pixels resolve, `TextureManager` observes the absent lease and creates no
  device texture. Regional terrain texture facts are also tested to remain identical across separate
  composition instances for the same region.
- `GameRuntime` now has a deferred-commit regression proving that a terrain artifact completed
  after its scene-interest layer is withdrawn is discarded before installation. The test uses a
  poison commit payload, so it would fail immediately if the runtime touched a stale artifact.
- The shader-composited terrain plan now treats `LandblockTerrainSource`, `TexturePixelSource`,
  `HBTR`, and `HBTP` as completed prerequisites. It no longer describes the deleted generic bridge
  or claims that a Rust host producer is out of scope; its remaining work starts at generator and
  renderer realization.

Concessions and debt:

- Static-object and env-cell source commands have no replacement yet. The commit pipeline now
  rejects those layers explicitly rather than pretending the terrain capability can answer them.
- The decoder currently copies individual binary sections to guarantee valid typed-array alignment
  in every JavaScript host. This is a small, bounded copy (81 samples per terrain grid), not a JSON
  element conversion; revisit only if terrain-grid resolution changes materially.
- The app-wide TypeScript check now passes. The remaining app-wide lint failures are unrelated
  unused-code findings in `commit/pipeline.ts` and `texture-manager.test.ts`.
- DXT, indexed/paletted, and mip-chain preparation remain intentionally out of this terrain slice.
  The active terrain-material scan found 41 source `SurfaceTexture`s: usable terrain color/detail
  levels are `A8R8G8B8`, and usable mask levels are `CustomLandscapeAlpha`; no terrain source
  requires DXT or palette resolution. Those source formats remain work for their first proven
  non-terrain consumer rather than speculative shared infrastructure.

Verification:

- `cargo test -p holtburger-3d --lib` passes, covering binary header/version/length fields,
  terrain-section alignment and offsets, landblock-ID normalization, texture source-ID validation,
  purpose mapping, missing-versus-decode-failed terrain availability, pixel payload framing, and a
  synthetic-HBA `ContentAssetRuntime` texture load through `HBTP`.
- Focused shared-pixel tests cover direct-color channel ordering, single-channel alpha preservation,
  semantic format rejection, and source-level fallback from a missing first render-surface record.
  Focused frontend terrain/texture decoders, texture-preparer, terrain-fact, and texture-manager tests pass (18
  tests), including truncated, mismatched-landblock, non-finite-height, and invalid-texture-ID
  terrain fixtures. The decoder additionally accepts only `missing-cell-landblock` as a null
  terrain result and rejects a `cell-landblock-decode-failed` response.
- `cargo clippy -p holtburger-content -p holtburger-core -p holtburger-3d --all-targets -- -D
warnings` passes.
- `cargo run -p holtburger-debug-harness --bin inspect_terrain_loading -- dats/assets.hba DA55FFFF`
  succeeds. It reports a 9×9 grid at 24-unit spacing, height range `[20, 20]`, terrain codes
  `{3, 21}`, road codes `{0, 1}`, usable fallback `CustomLandscapeAlpha` mask levels, RGBA8 color
  textures, R8 road/mask textures, and the 256×256 RGBA8 landscape detail texture.
- The complete frontend suite passes 89 tests across 24 files, and `npm run check` passes.
- Final verification also passes `cargo check` for the legacy adapter, CLI, and debug harness, in
  addition to strict clippy for content, core, the new host, and the debug harness. This confirms
  the shared request-variant addition and terminology cutover did not leave an unhandled legacy
  match arm.

## Context

`apps/holtburger-3d` can express terrain interest and carry a source-only terrain commit. The
Tauri host now serves authentic terrain source and terrain texture pixels through two narrow typed
capabilities. The terrain worker is still a stub and the renderer still draws placeholder terrain.

The legacy application proves the necessary DAT-backed content path:

- `holtburger-content` assembles landblock scene content, canonical terrain geometry, regional
  terrain material tables, render profiles, texture dependency graphs, and the HBA-backed
  `ContentRepository`.
- `holtburger-core::ContentAssetService` provides cached, asynchronous access to those
  client-agnostic products.
- The legacy Tauri adapter projects the Rust products into transport DTOs and uses a binary envelope
  for typed payloads.
- Legacy TypeScript performs coordinate adaptation, runtime identity construction, dependency
  selection, and frontend packaging. It is not the authoritative source of terrain semantics.

The evidence pass also identified a correctness defect in the current shared terrain facts:
`CellLandblockFact` resolves each authored height byte as `height * 2.0`, while ACE and ACViewer use
that byte as an index into the active `RegionDesc.LandDefs.LandHeightTable`. Correct height-table
resolution is therefore part of this pipeline, not a deferred rendering concern.

This plan connects that existing Rust content pipeline to the new frontend. It covers loading the
canonical terrain source and preparing its referenced texture pixels. Terrain mesh-variant
generation, GPU realization, shader implementation, and final draw submission remain governed by
the shader-composited terrain plan.

This plan supersedes only the host-loading assumptions in
`docs/plans/holtburger-3d-shader-composited-terrain-plan.md`. It does not supersede that plan's
generation, ownership, shader, or rendering phases.

## Goals

- Load a requested landblock's canonical terrain source through the same content-repository
  discovery policy already proven by `holtburger-cli`.
- Keep AC content interpretation and dependency resolution in client-agnostic Rust.
- Keep Tauri DTOs, IPC framing, browser-facing identities, and runtime policy app-local.
- Deliver compact typed terrain grids and regional composition facts to the frontend.
- Prepare the referenced color, blend-mask, road-mask, and detail texture pixels through a separate
  typed host capability.
- Feed the resulting source through the existing scene-interest and source-only commit lifecycle.
- Establish precise terminology before adding more similarly named layers.
- Fail loudly on missing, malformed, mismatched, or unsupported content.

## Non-goals

- Implement terrain mesh LOD generation or transition stitching.
- Implement terrain shaders, WebGL texture arrays, or final draw submission.
- Couple scene interest to camera placement or camera residency.
- Move scene-interest, texture leasing, retry, cancellation, or UI policy into Rust.
- Promote Tauri request/response DTOs into `holtburger-content`, `holtburger-core`, or another shared
  crate.
- Port the legacy generic string-addressed asset router wholesale.
- Generalize the terrain route for buildings, objects, generated scenery, or env cells before those
  consumers prove the shared transport shape.
- Add permanent tests that require a repo-local or user-installed HBA archive.

## Ground Truth

Implementation must be checked against these sources rather than inferred from the current stubs:

- `crates/holtburger-content/src/landblock_scene_assets.rs`
  - `CellLandblockFact`
  - `PreparedTerrainMesh`
  - `LandblockSceneLodAssetAssembler`
  - terrain triangulation, pcode construction, bounds, and BVH assembly
- `crates/holtburger-content/src/material_graph.rs`
  - regional terrain material tables
  - corner and side terrain alpha-map source groups
  - texture dependency resolution
  - render-surface and palette relationships
- `crates/holtburger-content/src/repository.rs`
  - `ContentRepository::from_hba_dir`
  - `ContentRepository::from_hba_path`
- `apps/holtburger-cli/src/bin/tui.rs`
  - established explicit-path, `HOLTBURGER_DATS`, portable-directory, and platform-data-directory
    discovery precedence
- `apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.yaml`
  - packaged-content placement through `HOLTBURGER_DATS`
- `crates/holtburger-core/src/content_assets.rs`
  - `ContentAssetService`
  - `ContentAssetRuntime`
  - landblock-scene caching
- `apps/holtburger-3d-legacy/src-tauri/src/adapter/`
  - content repository/runtime initialization
  - landblock and terrain-material projection
  - prepared texture and palette texture conversion
  - the `HBAB` binary response envelope
- `apps/holtburger-3d-legacy/src/lib/static/resolver/`
  - the remaining frontend adaptation and dependency-selection responsibilities
- `ACE/Source/ACE.DatLoader/FileTypes/CellLandblock.cs`
  - source grid dimensions, column-major ordering, terrain sample bitfields, and authored height
    indices
- `ACE/Source/ACE.DatLoader/Entity/LandDefs.cs`
  - the active region's 256-entry land-height table
- `ACE/Source/ACE.Server/Entity/LandblockMesh.cs`
  - height-index lookup and vertex construction
- `ACViewer/ACViewer/Physics/Common/LandblockStruct.cs`
  - independent height-table lookup in the ACViewer physics path
- `ACViewer/` and `ACE/`
  - terrain pcode interpretation, texture selection, and format behavior
- `acclient-eor-source/`
  - secondary evidence for retail terrain LOD and composition behavior

Any disagreement between the legacy app and shared crates must be resolved from the reference
implementations before changing a shared semantic.

## Established Source Facts

- A `CellLandblock` contains an authored 9x9 grid: 81 height indices and 81 `u16` terrain samples.
- `xxxxFFFF` is the outdoor `CellLandblock` address. `xxxx0100+` addresses indoor `EnvCell`
  records owned by the same high-word landblock; ACE documents those cells as both dungeon and
  building-interior capable. An interior record is therefore not a terrain-negation signal.
- DAT grid index `x * 9 + y` walks the western edge south-to-north before moving east.
- Each height byte indexes the active region's 256-entry `LandHeightTable`; `height * 2.0` is not the
  authoritative conversion.
- Each terrain sample retains road, terrain-type, and scenery bitfields and must remain lossless.
- `ContentAssetService` already supplies the active `RegionDesc` identity with assembled landblock
  content.
- The legacy terrain material planner consumes only the landscape detail role, although the shared
  region render profile correctly preserves all four client-agnostic roles.
- `TexMerge` stores corner and side terrain alpha maps as separate ordered collections. The retail
  client preserves the same distinction. The current shared resolver flattens both collections,
  and legacy TypeScript reconstructs the lost category from `alphaIndex < 4`; that positional
  inference must not cross into the new contract.
- `holtburger-cli` resolves content in this order: an explicit `--dats` path,
  `HOLTBURGER_DATS`, `./dats`, then the platform project-data `dats` directory. It passes a
  directory to `ContentRepository::from_hba_dir` and any other path to
  `ContentRepository::from_hba_path`. Flatpak packaging uses the same policy by setting
  `HOLTBURGER_DATS=/app/share/holtburger/dats`.

### Why the Legacy Shortcut Looked Correct

An audit of the active Dereth `RegionDesc` and every `CellLandblock` in `dats/assets.hba` explains
why `height * 2.0` survived visual testing:

- Dereth's `LandHeightTable` is exactly `index * 2.0` for indices 0 through 200. It becomes
  nonlinear only for indices 201 through 255.
- Of 65,025 landblocks, 402 use at least one divergent height index: approximately 0.618 percent.
- Of the 5,267,025 authored terrain vertices, 7,936 use divergent indices: approximately 0.151
  percent.
- The commonly exercised `0xDA55FFFF` landblock uses height index 10 for all 81 vertices, so the
  shortcut produces the exact authoritative height of 20 throughout that fixture.
- The nonlinear table remains monotonic. Affected high terrain was vertically compressed rather
  than topologically corrupted, so it continued to resemble plausible mountain terrain.
- Generated scenery placement samples the same `CellLandblock::get_height()` shortcut. Terrain and
  generated scenery therefore remained mutually aligned even where both were too low, hiding the
  more obvious symptom of floating or buried scenery.

The scan examined every `eor/cell` entry ending in `0xFFFF` and compared its 81 authored indices
with the extracted active region table. The highest index present was 253, which resolves to 670 in
the table but only 506 under the shortcut. The defect is low-incidence, not low-severity.

The shortcut was also structurally easy to retain because `holtburger-dat::RegionDesc::unpack`
currently skips `LandDefs`, including the 256-entry height table. The implementation must expose
that authoritative regional data instead of restoring a fallback whose usual-case output happens
to match.

### Landblock Scene LOD Semantics

`LandblockSceneLodLevel` is a cumulative content-inclusion LOD, not a geometry simplification
setting:

| Level    | Complete content included                                |
| -------- | -------------------------------------------------------- |
| `Level0` | Terrain                                                  |
| `Level1` | Level 0 plus outdoor buildings                           |
| `Level2` | Level 1 plus explicit outdoor objects                    |
| `Level3` | Level 2 plus generated outdoor scenery                   |
| `Level4` | Level 3 plus the env-cell system and portal connectivity |

Every included family is complete for that source level: full canonical geometry, material facts,
placements, spatial data, and diagnostics as applicable. A scene LOD must not substitute
unmaterialed geometry, silhouettes, reduced terrain meshes, or another degraded representation for
an included family. Terrain mesh stride/transition selection is a separate renderer-level LOD.

Legacy production requests use the outdoor cumulative scene source even when interest originates in
an interior cell. The demand planner normalizes the env-cell ID to its owning `xxxxFFFF` landblock
and requests Level 4 content. A surface landblock supplies terrain and every later family; a dungeon
landblock has no `CellLandblock`, so terrain assembly produces no terrain mesh while applicable
building-transition and env-cell content still loads.

`LandblockSceneLodContext::Interior` does not model that production behavior. It suppresses all
outdoor layers and permits only the env-cell system, contradicting the cumulative Level 4 contract.
No production legacy source request currently uses it. Phase 0 must remove it unless a distinct
authoritative content shape is proven.

## Architectural North Stars

### One semantic owner

`holtburger-content` owns client-agnostic AC content interpretation and assembly. The Tauri adapter
does not re-resolve terrain; it loads content products and projects a minimal app-local transport
shape. TypeScript does not decode DAT semantics; it validates the transport, creates frontend
identities, and applies frontend coordinate/runtime conventions.

### Two narrow host capabilities

Terrain source loading and texture pixel preparation have different request granularity, caching,
payload size, and consumers. They should be represented by two frontend ports even if one Tauri
adapter implements both:

```text
LandblockTerrainSource
    loadTerrainSource(landblockId)

TexturePixelSource
    loadTexturePixels(request)
```

This replaces the current `AssetBridge`, whose name and method set conflate content loading with
pixel preparation.

### One content discovery policy

Runtime content discovery belongs in `holtburger-content`. Extract the CLI's proven precedence into
a shared discovery API that accepts an optional explicit path, then have both CLI and Tauri
initialize `ContentRepository` through it. `holtburger-core` receives parsed content/runtime state;
it does not learn disk paths, environment variables, packaging layout, or archive policy.

The new Tauri host calls that API with no override, so it follows the CLI policy exactly. A future
app configuration override may be added only as an explicit argument to the shared API; it must not
create a parallel search order or block the first renderable terrain slice. Tests inject an
initialized repository or in-memory mounts and do not consult the host filesystem.

### Source loading is independent of scene policy

The host answers a terrain content request for a normalized landblock ID. It does not know why the
frontend is interested, which landblock anchors terrain LOD selection, where the camera is, or
whether camera follow mode is active.

### Scene content LOD remains cumulative and complete

Preserve the numeric `LandblockSceneLodLevel` ordering. A cached higher level legitimately satisfies
a lower request, and extending a cached lower level adds the complete next content families. Keep
this content-inclusion LOD distinct from terrain mesh LOD, texture mip levels, and frontend interest
policy through qualified type names.

### Source-only commit remains the lifecycle boundary

The loading pipeline returns immutable authored/source facts. It does not create renderer resources.
The existing commit/runtime path owns installation, interest races, texture leases, generation,
realization, and teardown.

### Binary where representation matters

Terrain grids and texture pixels cross IPC as typed binary sections. Small descriptive metadata may
remain structured data. Numeric arrays must not silently round-trip through JSON number arrays once
the command is functional.

## Terminology Contract

The first implementation phase must make a clean terminology cutover. Do not add aliases or retain
the ambiguous names for compatibility.

| Current term                                                      | Problem                                                                                                                       | Target term                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AssetBridge`                                                     | Conflates semantic content loading and texture pixel preparation                                                              | `LandblockTerrainSource` and `TexturePixelSource`                                                                      |
| `resolveLandblockLayer`                                           | Suggests the frontend/Tauri adapter performs semantic resolution and is generic before it is                                  | `loadTerrainSource`                                                                                                    |
| `normalizeHostLandblockLayer`                                     | Performs decoding, validation, and adaptation, not normalization alone                                                        | `decodeTerrainSource`                                                                                                  |
| `HostTerrainLayerSourceDto`                                       | `Host` describes transport location, not semantics                                                                            | `TerrainSourceDto` inside an app-local `ipc` module                                                                    |
| `ResolvedTerrainLayerSource`                                      | “Resolved” collides with Rust material/dependency resolution                                                                  | `TerrainLayerSource`                                                                                                   |
| `ResolvedTerrainTextureFacts`                                     | These are deterministic frontend requirements/identities                                                                      | `TerrainTextureRequirements`                                                                                           |
| Unqualified `Lod`/`LodLevel`                                      | Can ambiguously mean scene-family inclusion, terrain mesh selection, or texture mip selection                                 | Keep `LandblockSceneLodLevel`; use `TerrainMeshStride`/`TerrainMeshLod` and `TextureMipLevel` for the other dimensions |
| `LandblockSceneLodContext::Interior`                              | Suppresses cumulative outdoor content even though legacy interior interest uses the owning landblock's outdoor Level 4 source | Remove unless an authoritative distinct content shape is proven                                                        |
| `PreparedTerrainMesh`                                             | “Prepared” also means decoded texture pixels and frontend/GPU preparation                                                     | `CanonicalTerrainMesh`                                                                                                 |
| `heightBytes`                                                     | The bytes are indices into the active region's height table, not direct heights                                               | `heightIndices`                                                                                                        |
| `terrain_types` on the landblock grid                             | Values contain the complete terrain/road sample bitfield                                                                      | `terrain_samples`                                                                                                      |
| Flattened `terrain_alpha_maps`                                    | Erases the authored corner-versus-side selector domain and forces positional inference                                        | Preserve ordered `corner_terrain_alpha_maps` and `side_terrain_alpha_maps`                                             |
| `TerrainSurfaceField`                                             | The object is a generated pcode field, not a material surface                                                                 | `TerrainPcodeField`                                                                                                    |
| `TerrainSurfaceTextureKey`                                        | Same collision at renderer-resource identity level                                                                            | `TerrainPcodeTextureKey`                                                                                               |
| `StaticLandblockLayerCommitTerrain`                               | Type reads as an implementation stack rather than a domain message                                                            | `TerrainLayerCommit`                                                                                                   |
| `TerrainService` in the rendering plan vs `TerrainSystem` in code | Two authoritative names for one runtime owner                                                                                 | Keep `TerrainSystem` unless a broader service boundary is proven                                                       |

The shared terminology remains:

```text
LandblockSceneLodRequest
LandblockSceneLodLevel
LandblockSceneLodAsset
LandblockSceneLodLayer
LandblockSceneLodAssetAssembler
TerrainMeshStride
CanonicalTerrainMesh
terrain_samples
```

The cumulative numeric scene levels are intentional gameplay/content LOD. They preserve the
invariant that a higher scene level contains every complete lower-level family. Do not replace them
with arbitrary content-family selections as part of this terrain pipeline.

Use these verbs consistently:

- **decode**: parse bytes or validate an IPC payload.
- **assemble**: combine decoded AC records into a client-agnostic content product.
- **resolve**: follow semantic AC references or dependency graphs.
- **project**: map a shared content product into an app-local DTO.
- **load**: request an already defined product through a service/transport boundary.
- **prepare**: convert source texture data into a requested pixel representation.
- **commit/install**: transfer source ownership into the runtime lifecycle.
- **generate**: derive terrain mesh variants or pcode fields.
- **realize**: allocate renderer/device resources.
- **resident**: retained because world/scene interest currently requires it.

## Target Data Flow

```text
SceneInterestManager
    -> StandardCommitPipeline requests terrain for a landblock
        -> LandblockTerrainSource.loadTerrainSource(landblockId)
            -> Tauri command: load_terrain_source
                -> ContentAssetRuntime
                    -> landblock terrain content
                    -> terrain material table for the landblock region
                    -> region render profile
                -> app-local Rust projection
                -> versioned binary terrain response
            -> decodeTerrainSource
                -> validate identity, sizes, enum/discriminant values, and references
                -> construct typed arrays
                -> derive TerrainTextureRequirements
            -> TerrainLayerCommit
                -> GameRuntime/TerrainSystem installs immutable source
                -> TextureManager leases required texture identities
                    -> TexturePixelSource.loadTexturePixels(request)
                        -> Tauri command: load_texture_pixels
                            -> existing Rust surface/palette preparation logic
                            -> versioned binary pixel response
                -> later terrain generation and renderer realization phases
```

The commands are capability-shaped, not camera-shaped and not generic route-shaped.

## Target Terrain Source Contract

The client-agnostic content product must expose the authored grid directly. The frontend should not
reverse-engineer heights or pcodes from `PreparedTerrainMesh`. Rust must preserve the authored
height-table indices while also resolving them through the active `RegionDesc`; treating those
indices as direct heights is a semantic error.

Recommended shared representation:

```rust
pub struct TerrainGridSource {
    /// Number of authored vertices along either axis.
    pub grid_size: usize,
    /// World-space distance between adjacent authored vertices.
    pub tile_size: f32,
    /// Authored height-table indices in canonical row-major order.
    pub height_indices: Vec<u8>,
    /// World-space heights resolved through the active region's land-height table.
    pub heights: Vec<f32>,
    /// Row-major terrain and road pcode samples.
    pub terrain_samples: Vec<u16>,
}
```

`TerrainGridSource` uses one documented canonical row-major order. Decoding must transpose the
source DAT order exactly once. It must not expose a mixture of DAT-column-major indices and
canonical-row-major resolved values.

The terrain content layer may also retain `CanonicalTerrainMesh` for spatial queries, canonical
triangulation, and BVH consumers. The grid and mesh are different useful products; neither should
be reconstructed from the other at the app boundary.

The app-local response contains:

- normalized landblock ID;
- grid size and tile size;
- row-major `u8` height-table indices;
- row-major `f32` heights;
- row-major `u16` terrain samples;
- region number;
- ordered terrain material entries and color-variation facts;
- ordered corner and side blend-mask entries;
- ordered road-mask entries;
- landscape detail texture and tiling;
- landscape detail fade distances only if Phase 0 proves they are authoritative content facts;
- source diagnostics sufficient to explain unavailable optional records;
- explicit binary contract version.

The response does not contain:

- frontend texture keys;
- renderer resource keys;
- scene-interest generation tokens;
- camera position or residency;
- terrain mesh stride selection;
- WebGL formats or handles;
- renderer-policy fade constants;
- TypeScript enum names.

The frontend decoder converts the response into `TerrainLayerSource` and derives
`TerrainTextureRequirements` with existing texture identity constructors.

## Phase 0: Lock Terminology and Contracts

### Deliverables

- Apply the terminology contract above across the new app and affected shared Rust APIs.
- Preserve and document the cumulative `LandblockSceneLodLevel` contract.
- Remove `LandblockSceneLodContext::Interior` unless reference-backed production behavior requires
  it.
- Define diagnostic semantics for a missing outdoor `CellLandblock` without using interior interest
  or `EnvCell` presence as a dungeon classifier.
- Define the shared content-repository discovery API while preserving the CLI's established
  precedence.
- Preserve corner and side terrain alpha-map groups explicitly in the shared and transport
  contracts.
- Record the terrain source DTO and binary-section layout beside the Tauri adapter.
- Record coordinate-space and row-order invariants in both Rust and TypeScript types.
- Record the established height-index/region-table rule in the shared source contract.
- Determine whether landscape-detail fade distances are authored facts or renderer policy before
  including them in the DTO.
- Reconcile the rendering plan's `TerrainService`, `AssetBridge`, and host-resolution terminology.

### Tasks

- [x] Confirm every `LandblockSceneLodLevel` consumer preserves cumulative full-family semantics;
      retain scalar cache containment and incremental extension.
- [x] Trace and remove `LandblockSceneLodContext::Interior` and its test-only transport restrictions
      if no authoritative caller is found.
- [x] Preserve legacy's data-driven terrain applicability: Level 4 still represents the complete
      cumulative landblock source, while an absent dungeon `CellLandblock` yields no terrain mesh.
- [x] Establish that `xxxxFFFF` versus `xxxx0100+` distinguishes outdoor-record versus interior-cell
      addressing only; ACE permits both dungeon and building interiors, so no companion record
      proves expected terrain absence. Preserve missing-record diagnostics and decode failures
      rather than inventing a dungeon classification.
- [x] Specify a `holtburger-content` discovery API that accepts an optional explicit path and
      retains `HOLTBURGER_DATS`, `./dats`, and platform project-data lookup in that order.
- [x] Specify corner and side terrain alpha maps as distinct ordered selector domains; do not infer
      the domain from a combined index or collection length.
- [x] Rename `PreparedTerrainMesh` to `CanonicalTerrainMesh` and the frontend pcode field to
      `TerrainPcodeField` in one cutover. The grid is already `terrain_samples`; retain
      material-table `terrain_types`, whose meaning is genuinely different.
- [x] Split the frontend `AssetBridge` into the two narrow ports.
- [x] Rename terrain source, commit, decoder, and texture requirement types.
- [x] Specify the DAT column-major to canonical row-major mapping with named southwest, southeast,
      northwest, and northeast indices.
- [x] Trace the legacy `10.0`/`50.0` landscape-detail fade constants: they appear only as legacy
      adapter constants driving a WebGL uniform, with no ACE/ACViewer/retail source field. Treat
      them as frontend renderer policy and keep them out of shared content and IPC.
- [ ] Update tests and architecture documentation in the same change; retain no aliases.
- [x] Define the small versioned `HBTR` terrain and `HBTP` prepared-texture response headers and
      section tables; do not extract the legacy generic asset router or JSON-variant framing.

### Acceptance criteria

- `LandblockSceneLodLevel` explicitly means cumulative complete-family inclusion.
- Terrain mesh LOD and texture mip levels use distinct qualified terminology.
- Every layer included by a scene level retains complete geometry, material, placement, spatial, and
  diagnostic content rather than a degraded proxy.
- A surface Level 4 source contains Levels 0 through 4 regardless of whether interest originated
  outdoors or inside one of its env cells.
- A dungeon Level 4 source omits terrain because terrain source content is structurally absent, not
  because the caller selected an interior-only projection.
- Missing terrain is classified without hiding an incomplete or corrupt surface archive.
- “Prepared texture” refers only to a concrete pixel representation.
- The source contract distinguishes authored height indices from resolved world-space heights.
- The transport contract states both source DAT order and canonical grid order.
- The content and transport contracts preserve corner-versus-side alpha-map identity without an
  `alphaIndex < 4` convention.
- The discovery contract preserves the CLI's precedence, has one proposed owner in
  `holtburger-content`, and permits injected repository tests to bypass filesystem discovery.
- Landscape-detail fade behavior has a proven owner and is not copied from unexplained legacy
  constants.
- A repository search finds no active new-app use of the displaced ambiguous names.
- The transport contract is reviewable without reading the legacy generic asset router.

### Steering checkpoint

Review the terminology diff and binary contract before implementation continues. This is the
cheapest point to reject a leaky name or an accidentally generic transport.

## Phase 1: Expose the Client-Agnostic Terrain Source

### Deliverables

- `TerrainGridSource` is part of the terrain layer assembled by `holtburger-content`.
- Height-table resolution, terrain sample ordering, and constants are defined once in shared Rust.
- Regional terrain composition preserves separate ordered corner and side alpha-map groups.
- The content service can return the terrain grid and regional composition dependencies needed by
  an app adapter.

### Tasks

- [x] Preserve authored height indices and terrain samples when decoding `CellLandblock`; do not
      discard them after canonical mesh construction.
- [x] Replace the incorrect `height * 2.0` conversion with lookup through the active
      `RegionDesc.LandDefs.LandHeightTable`.
- [x] Require exactly 256 finite height-table entries and fail loudly when an index cannot be
      resolved.
- [x] Normalize height indices, resolved heights, and terrain samples from DAT column-major order
      into the same canonical row-major order.
- [x] Retain both `u8` height indices and resolved world-space `f32` heights in the client-agnostic
      product.
- [x] Preserve full `u16` terrain samples, including road and scenery bits.
- [x] Keep canonical full-resolution mesh/BVH assembly in content for spatial consumers.
- [x] Make terrain material-table and region-profile lookup available through the existing content
      service; do not create a parallel app-specific resolver in a shared crate.
- [x] Replace the flattened `terrain_alpha_maps` result with separate ordered corner and side
      collections, or an equally lossless typed category if another proven consumer requires one
      collection.
- [ ] Add fixture-backed unit tests using in-memory resource sources.

### Acceptance criteria

- A Rust test assembles a known 9x9 terrain grid with 81 height indices, 81 resolved heights, and 81
  terrain samples.
- A deliberately non-linear 256-entry height table proves every resolved height equals
  `land_height_table[height_index]`; a `* 2.0` implementation cannot pass.
- An asymmetric fixture identifies southwest, southeast, northwest, and northeast values after
  canonicalization and proves the grid is not transposed or reflected.
- The canonical mesh and grid agree at all authored vertices.
- An asymmetric material fixture proves corner and side selectors, ordering, and texture references
  survive resolution without index-threshold inference.
- No shared type imports or reproduces Tauri, serde DTO, browser, or TypeScript concepts.
- Tests do not require runtime assets outside the repository.

## Phase 2: Add the Typed Tauri Terrain Source

### Deliverables

- The new Tauri host initializes `ContentRepository`, `ContentDecodeCache`,
  `ContentAssetService`, and `ContentAssetRuntime` as managed app state.
- CLI and Tauri initialize `ContentRepository` through the same shared discovery policy.
- A `load_terrain_source` command accepts a normalized landblock ID.
- An app-local projector combines the terrain grid, regional material table, and render profile into
  one transport response.
- Typed arrays use binary sections rather than JSON number arrays.

### Tasks

- [x] Add the required workspace crate dependencies to `apps/holtburger-3d/src-tauri`.
- [x] Extract the CLI's proven HBA discovery policy into `holtburger-content`.
- [x] Cut the CLI over to the shared discovery API before using it from Tauri so the policy has one
      production owner.
- [x] Initialize Tauri with the shared discovery API and no app-local override, honoring the
      CLI-compatible `HOLTBURGER_DATS`, `./dats`, and platform-data fallbacks.
- [x] Preserve directory-versus-file mounting through `ContentRepository::from_hba_dir` and
      `ContentRepository::from_hba_path`; do not add a Tauri-specific archive locator.
- [x] Decide that the two small app-local `HBTR`/`HBTP` encoders are clearer than extracting the
      legacy generic framing; do not port its string route parser, payload enum, diagnostics
      routes, or unrelated assets.
- [x] Inject content state into the command/service so projector tests can use a synthetic
      repository rather than filesystem discovery.
- [x] Normalize and validate the requested landblock ID at the boundary.
- [x] Load terrain content, material table, and render profile through
      `ContentAssetRuntime`.
- [x] Project shared Rust products into private app-local DTOs.
- [x] Return height indices as a `u8` section, resolved heights as an `f32` section, and terrain
      samples as a `u16` section with declared counts.
- [x] Include a response version and reject unsupported versions.
- [x] Preserve contextual error chains for repository startup, missing landblock records, missing
      region data, invalid cross-references, and serialization failures.
- [x] Bound concurrent blocking decode/preparation work using the existing runtime pattern.

### Acceptance criteria

- A service-level Rust test loads a terrain response from an in-memory content source.
- A focused discovery test proves explicit override, environment, portable, and platform-data
  precedence without requiring installed game assets.
- CLI and Tauri repository startup use the same `holtburger-content` discovery implementation.
- A malformed landblock ID and missing required content produce distinct actionable errors.
- Array byte lengths and element counts are checked before serialization.
- The command does not accept layer kinds, camera state, interest state, or generic asset IDs.
- The Tauri adapter contains projection and transport code, not AC terrain algorithms.
- `cargo test` and clippy pass for affected crates and the app host.

### Steering checkpoint

Inspect one decoded Rust response and its binary layout before adding frontend consumption. Confirm
that the payload is canonical source data rather than a mirror of current TypeScript internals.

## Phase 3: Decode and Commit Terrain in the Frontend

### Deliverables

- `TauriLandblockTerrainSource` invokes `load_terrain_source`.
- `decodeTerrainSource` validates and adapts the response into typed frontend source facts.
- `StandardCommitPipeline` creates a source-only `TerrainLayerCommit`.
- The placeholder generic landblock-layer Tauri call is removed.

### Tasks

- [x] Implement a small binary decoder with explicit bounds, alignment, count, and version checks.
- [x] Validate the returned landblock ID against the requested ID.
- [x] Construct `Uint8Array` height indices, `Float32Array` heights, and `Uint16Array` terrain
      samples without element-wise JSON conversion.
- [x] Validate `gridSize * gridSize` against all three arrays.
- [x] Validate regional composition ordering, required fallback entries, finite tiling values, and
      asset ID formats.
- [ ] Apply frontend coordinate adaptation exactly once and document whether the authored grid
      remains AC-oriented until worker generation.
- [x] Derive `TerrainTextureRequirements` in frontend terrain code from canonical composition facts.
- [x] Inject `LandblockTerrainSource` into `StandardCommitPipeline`.
- [x] Preserve interest-generation race handling: a completed request is discarded if its interest
      was withdrawn before the runtime tick.
- [x] Delete the nonexistent `resolve_landblock_layer` command path and unused generic host DTOs for
      terrain.
- [x] Replace broad fake bridges in tests with focused terrain-source fakes.

### Acceptance criteria

- A terrain interest request reaches the typed Tauri source and yields a source-only commit.
- Decoder tests reject truncated sections, wrong versions, wrong IDs, wrong counts, non-finite
  values, and invalid references.
- No renderer or texture allocation occurs inside the decoder or commit pipeline.
- Scene interest and camera placement remain independent.
- Type checking, frontend tests, lint, and formatting pass without ignores.

## Phase 4: Add the Typed Texture Pixel Source

### Deliverables

- A `load_texture_pixels` Tauri command prepares one requested source texture for a declared purpose.
- Proven terrain `SurfaceTexture` selection and render-surface normalization lives in a reusable
  client-agnostic Rust module at the narrowest correct boundary.
- Pixel payloads use the versioned binary response.

### Tasks

- [x] Enumerate the texture purposes required by terrain: color, blend mask, road mask, and detail.
- [x] Prove each purpose's channel interpretation and output format from the active archive and
      legacy normalization implementation. Color-space treatment remains frontend/GPU policy until
      shader work supplies a consumer that makes it observable.
- [x] Resolve `SurfaceTexture` dependencies through `holtburger-content`, selecting the first
      available source level.
- [x] Decode the terrain-referenced `RenderSurface` records through existing DAT/content APIs.
      Palette records are not part of the proven current terrain corpus.
- [x] Preserve source dimensions and reject inconsistent source byte lengths.
- [x] Return explicit width, height, pixel format, and pixel bytes.
- [x] Reuse bounded worker concurrency and content-runtime in-flight coalescing independent of the
      legacy app.
- [x] Keep frontend texture-array membership, leases, and upload format selection out of Rust.
- [x] Add in-memory fixture tests for the direct-color and landscape-alpha inputs currently
      supported by terrain. Paletted and DXT fixtures are deferred with their first proven terrain
      or non-terrain consumer.

### Acceptance criteria

- Every terrain texture purpose returns a documented, validated pixel representation.
- Unsupported source formats fail with the source asset ID and format in the error.
- Pixel buffers never pass through JSON arrays.
- The shared preparation module has no dependency on Tauri or frontend names.
- Rust tests and clippy pass with warnings treated as errors.

## Phase 5: Connect Texture Preparation to Runtime Loading

### Deliverables

- `TauriTexturePixelSource` implements the frontend `TexturePixelSource` port.
- The existing texture preparation/management path uses the typed source.
- Shared regional terrain textures coalesce and are leased independently of landblock source
  loading.

### Tasks

- [x] Replace the old generic prepared-texture request path with `loadTexturePixels`.
- [x] Keep `TexturePreparer` responsible for frontend-purpose validation and complete pixel-bearing
      results; rename it if the host now performs all preparation and it only coordinates requests.
- [x] Coalesce identical in-flight requests through `ContentAssetRuntime` and the frontend
      `WorkerTexturePreparer`.
- [ ] Preserve retryable versus terminal failure state explicitly.
- [x] Ensure source withdrawal releases leases without corrupting an in-flight shared request.
- [x] Verify landblocks in the same region share color, blend-mask, road-mask, and detail identities.
- [x] Surface preparation failures through existing runtime/explorer diagnostics.

### Acceptance criteria

- Installing a terrain source requests every required texture identity exactly once per shared
  in-flight load.
- Releasing one landblock does not evict textures still leased by another.
- A failed texture load is visible and does not produce a silently incomplete terrain installation.
- Texture loading remains independent of camera placement and graphical terrain LOD.

### Steering checkpoint

Use the explorer diagnostics to inspect one terrain source and all derived texture requirements.
Confirm identities, dimensions, formats, and sharing before implementing GPU texture arrays.

## Phase 6: Prove the Vertical Slice

### Deliverables

- A focused host-to-frontend integration harness exercises terrain source and texture loading.
- The explorer reports terrain loading progress and failures for a user-entered landblock.
- The resulting runtime source is ready for the terrain generator without placeholder data.

### Worker terrain-generator handoff

`WorkerTerrainGenerator.generate` receives one immutable `TerrainGenerationSource` only after the
host decoder has already normalized the DAT's `x * 9 + y` order to canonical
`row * 9 + column` order (rows south-to-north, columns west-to-east). The source carries both the
raw height-table indices and resolved world-space heights, plus lossless terrain samples; it does
not carry mesh vertices, texture pixels, GPU handles, scene interest, or camera placement.

No host or decoder basis conversion is performed. The generator is the single future owner of the
AC-canonical-grid-to-render-local-position adaptation and must emit positions suitable for the
runtime's identity local transform. It must preserve source grid order for pcode selection and
produce every stride/transition variant plus one `TerrainPcodeField` per stride, as enforced by the
terrain system's generation-result validation. Texture pixel loading remains independently owned
by `TextureManager` and may race the generator safely.

### Tasks

- [x] Add a Rust service harness that can load a selected landblock without launching the Tauri UI.
- [x] Add frontend binary-contract tests using synthetic fixtures, not installed game assets.
- [x] Add optional manual diagnostics that summarize: - landblock ID and region; - grid dimensions and height range; - distinct terrain/road pcodes; - material and mask counts; - texture IDs, dimensions, and formats; - current source/texture load state.
- [ ] Exercise one known outdoor landblock manually through the explorer.
- [x] Hand comparison of the loaded facts with the legacy app and ACViewer to the user as separate
      visual-parity review, not an implementation gate.
- [ ] Confirm removal/re-entry does not leave stale commits or leaked texture leases.
- [x] Document the handoff contract expected by `WorkerTerrainGenerator`.

### Acceptance criteria

- A user-entered landblock establishes scene interest and loads authentic terrain source data.
- All required texture pixels reach frontend texture management.
- No placeholder height, pcode, composition, or texture facts remain on the production path.
- The path can be exercised without coupling scene interest to camera placement.
- The Tauri application is not used as an automated diagnostic target.

## Phase 7: Cleanup and Plan Reconciliation

### Deliverables

- Dead stubs and legacy-shaped compatibility code are removed.
- Architecture documentation and the rendering plan reflect the implemented boundary.
- The next rendering phase begins from one authoritative terrain source contract.

### Tasks

- [ ] Remove unused generic asset DTOs, adapters, fake implementations, and comments.
- [ ] Remove any temporary logs, asset-dependent tests, and captured proprietary payloads.
- [x] Update `docs/plans/holtburger-3d-shader-composited-terrain-plan.md` to use the final names and
      mark host-loading tasks as satisfied by this plan.
- [ ] Update per-crate/app architecture docs if public responsibilities changed.
- [x] Run repository searches for displaced terminology and duplicate terrain conversions.
- [x] Run Rust formatting, tests, and clippy for affected crates.
- [ ] Run frontend formatting, lint, type checking, tests, and dead-code analysis.

### Acceptance criteria

- There is one production route for terrain source loading and one for texture pixel loading.
- No compatibility aliases preserve the old generic bridge or ambiguous unqualified LOD names.
- No `Interior` scene-source context bypasses the cumulative landblock LOD contract.
- `holtburger-content` remains client agnostic.
- Tauri remains a narrow typed adapter.
- The rendering plan consumes the same source contract implemented here.

## Test Strategy

### Shared Rust

- Unit-test terrain grid construction, orientation, height-table resolution, and mesh agreement with
  in-memory resource sources.
- Use a non-linear synthetic land-height table so tests cannot accidentally bless `height * 2.0`.
- Use an asymmetric 9x9 source grid with named corners to detect transposition and reflection.
- Unit-test material graph resolution separately from Tauri projection.
- Use asymmetric corner and side alpha-map groups so tests cannot bless combined-index inference.
- Use small synthetic fixtures that encode meaningful pcodes, roads, diagonals, and height changes.

### Tauri adapter

- Construct the service with an injected in-memory repository.
- Test DTO projection and binary encoding without launching Tauri.
- Test identity mismatch, missing source, corrupt section lengths, and dependency failures.

### Frontend

- Test binary decoding independently from Tauri invocation.
- Test semantic validation independently from transport decoding.
- Test commit races with deferred focused fakes.
- Test shared texture coalescing and lease release with deterministic fake pixel sources.

### Manual validation

- Use the explorer's landblock input to request a known outdoor landblock.
- Compare source summaries with the legacy app and ACViewer.
- Do not run the TUI or use the interactive Tauri client as an automated diagnostic.

## Risks and Mitigations

### Terrain height resolution depends on active regional content

The authored byte is a `RegionDesc.LandDefs.LandHeightTable` index, not a direct height. Resolving
it without the active region silently produces incorrect terrain. Assemble the grid with the same
repository/decode-cache context that supplies `RegionDesc`, retain both index and resolved height,
and test with a non-linear table. Remove the current `height * 2.0` conversion rather than keeping a
fallback. Although only approximately 0.151 percent of vertices in the current archive use
divergent indices, the highest observed vertex is understated by 164 world units.

### Landscape-detail fade is renderer policy, not source content

The only `10.0`/`50.0` values found are constants in the legacy Tauri adapter, passed to legacy
WebGL uniforms. ACE's parsed region/material records, ACViewer, and the retail-decompile search
provide no authored field or source-format evidence for them. Keep any new defaults with the
renderer that implements the detail pass; do not add unproven fade values to shared content or IPC.

### Flattened alpha maps discard selector semantics

The source region format and retail client retain separate corner and side alpha-map collections,
but the current shared material table concatenates them and legacy TypeScript recovers the category
with an `alphaIndex < 4` convention. Preserve the category in `holtburger-content` and carry it
through IPC explicitly. Test asymmetric groups so collection ordering, selector interpretation, and
rotation inputs cannot accidentally depend on the current four-corner count.

### Duplicated content discovery can drift by packaging target

The CLI already supports explicit paths, environment configuration, portable `./dats` installs,
platform data directories, archive paths, archive base paths, and HBA directories. Extract that
policy into `holtburger-content` and reuse it from both apps. Keep Flatpak and future package
configuration as inputs to the policy rather than branches in Tauri. Repository consumers receive
an initialized repository through dependency injection.

### A missing outdoor record has no proven dungeon classification

`xxxxFFFF` addresses the outdoor `CellLandblock`; `xxxx0100+` addresses `EnvCell` interiors.
Because ACE documents an `EnvCell` as either a dungeon or a building interior, env-cell presence
cannot distinguish intentional outdoor-record absence from an incomplete archive. Represent a
missing `CellLandblock` as terrain-absent with diagnostics, preserve decode errors as failures, and
never select that behavior from interior interest or caller residency. A future authoritative
archive-completeness manifest may refine the diagnostic, but no such inference belongs here.

### Binary framing can become an accidental framework

Support only the sections needed by terrain source and prepared pixels. Reuse the small proven
framing primitives, but do not revive the legacy string asset namespace, generic JSON payload
variant, or all-purpose batch router.

### Coordinate conversion can be duplicated

Declare the terrain grid's source coordinate system in the shared Rust type and the frontend type.
Perform basis conversion in one named generation/adaptation step and test asymmetric fixtures so an
axis swap cannot pass unnoticed.

### Texture “preparation” may hide renderer policy

Rust may decode, depalette, decompress, and normalize source pixels into a declared semantic format.
Array packing, GPU format choice, mip policy, sampling, and resource lifetime remain frontend or
renderer responsibilities.

### A successful load can race withdrawn interest

The commit pipeline must retain its generation/token check. The host request itself does not become
authoritative merely because it completed.

## Definition of Done

- The explorer can request authentic terrain for a landblock through scene interest.
- The Tauri host loads the terrain grid and regional composition through existing shared content
  services.
- The frontend receives validated typed arrays and canonical composition facts.
- Corner and side terrain alpha maps retain their authored selector domains through shared content,
  IPC, and frontend decoding.
- Authored height indices and height-table-resolved world-space heights reach the frontend in one
  documented canonical grid order.
- The runtime derives and loads every required terrain texture through a separate typed host
  capability.
- Source installation remains source-only and independent from camera placement.
- CLI and Tauri use one `holtburger-content` repository-discovery policy.
- No app-specific contract leaks into `holtburger-content`.
- No generic legacy asset router is ported.
- Naming clearly distinguishes cumulative scene-content LOD, terrain mesh LOD, texture mip levels,
  semantic resolution, transport projection, pixel preparation, generation, realization, and
  residency.
- Surface and dungeon landblocks follow one cumulative scene LOD model, with terrain applicability
  discovered from authoritative content rather than caller residence.
- All affected Rust and frontend validation passes.
- Documentation and the shader-composited terrain plan agree with the implemented boundary.

## Open Questions Requiring Evidence

These questions should be resolved during the named phase, not guessed upfront:

1. What exact semantic pixel formats should each terrain texture purpose request? Resolve in Phase 4
   from ACViewer and legacy preparation code.
2. Should regional material table and render profile remain separate content requests internally or
   become one client-agnostic terrain composition product? Resolve in Phase 1 based on whether they
   have independent non-terrain consumers.

## Dry Run

Walking the plan against the current tree produces this implementation order:

1. Lock the qualified LOD terminology, preserve cumulative scene levels, and remove the unsupported
   interior-only scene-source context.
2. Correct height resolution through `RegionDesc.LandHeightTable`, then extend the existing content
   terrain layer with canonicalized indices, heights, and samples; do not add a second resolver.
3. Extract the proven CLI content-discovery policy into `holtburger-content`, cut the CLI over, and
   stand up injected content runtime state in the new Tauri host.
4. Add one terrain-specific binary command and one frontend decoder.
5. Feed the decoded source into the existing commit lifecycle.
6. Add the separate texture pixel command and connect texture management.
7. Validate the complete loading slice in the explorer.
8. Only then continue into worker generation, GPU realization, and shader rendering.

No phase requires camera position or point-residency policy to enter the host content request. The
pipeline begins with scene interest and ends with runtime-owned source plus texture data, which is
the correct seam for the later renderer work.
