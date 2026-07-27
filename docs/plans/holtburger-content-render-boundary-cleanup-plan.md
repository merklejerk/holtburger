# Holtburger Landblock Content Boundary Cleanup Plan

Status: Complete. Evidence-dry-run and resteered around the agreed target API on 2026-07-26;
all implementation, cleanup, documentation, and verification phases landed on 2026-07-27.

## Implementation Progress

### 2026-07-27: Post-completion boundary simplification

- Removed exact-only transport version fields from every maintained Tauri/browser binary envelope.
  The producer and consumer ship together; format-specific magic, declared lengths, and strict
  manifest validation provide the required closed-contract checks without pretending to support
  migrations.
- Made `ContentAssetService` construction infallible and region-independent. The repository-selected
  `ActiveRegionData` is loaded and pinned lazily by active-region, landblock, and generated-scenery
  operations; unrelated DAT asset requests do not require RegionDesc.
- Moved presentation-local bounds derivation from Tauri into the browser so bounds and static
  geometry preparation consume the same cumulative part transforms.

### 2026-07-27: Phase 1 complete

- Added the complete shallow `LandblockAsset` family and a focused assembler that reads only the
  normalized CellLandblock, its conditionally required LandblockInfo, and the already-pinned active
  region.
- Initially made `ContentAssetService` construction acquire one shared `Arc<ActiveRegionData>`.
  The post-completion cleanup preserved that shared snapshot while making its acquisition lazy and
  operation-scoped.
- Added the normalized landblock foundation cache. Cache hits return the same
  `Arc<LandblockAsset>`, and absent CellLandblocks remain an explicit `None` result.
- Changed decoded CellLandblock, LandblockInfo, EnvCell, Environment, Scene, SetupModel, GfxObj,
  Palette, and RegionDesc cache entries to shared immutable `Arc` values. The content source reader
  and core asset results preserve that ownership instead of cloning decoded graphs on cache hits.
- Added asset-independent coverage for terrain transposition/height resolution, unsupported DID
  preservation, restrictions, building portal/env-cell normalization, absent CellLandblocks,
  unflagged LBI omission, promised missing LBI failure, foundation `Arc` reuse, and active-region
  snapshot reuse.
- Verification: `cargo test -p holtburger-content -p holtburger-core` passed 226 tests.

Decision: the old exact filtered-outdoor cache remains only because the active Tauri path still
consumes its prepared artifact. It will be deleted during the Phase 4 cutover rather than forcing a
temporary projection from the new foundation back into the old DTO.

Concession: the old prepared-content module still defines names that overlap the new canonical
landblock family internally. New root exports point at the canonical types; the obsolete internal
types disappear with the prepared API in Phase 7.

Debt carried forward:

- Add an explicit pointer-identity assertion for each heavy decoded-record family as its active
  consumer migrates; Phase 1 already changes and compiles the ownership path, while the current
  synthetic decode tests directly cover archive read reuse.
- The active Tauri browser contract still receives terrain through `TerrainGridSource`; Phase 4
  moves it to `LandblockTerrain` and deletes the duplicate frontend height resolution.

### 2026-07-27: Phase 2 complete

- Added explicit generated-scenery resolution over `&LandblockAsset`, plus an ID-based core request
  that internally acquires the cached foundation.
- Kept the generated artifact shallow: stable source provenance, DID/family, placement, and scale.
  It carries no prepared geometry, bounds, source ledgers, or candidate counters.
- Corrected the known retail drift. Boundary acceptance now happens before template scale, direct
  GfxObjs use the physics-BSP root sphere or origin fallback, and SetupModels select their sorting
  sphere, cylinder spheres, or origin according to referenced-part physics exactly as established
  by retail evidence.
- Removed the physics-polygon vertex walk and the silent “bounds unavailable, accept anyway”
  behavior. Missing/unsupported sources and missing SetupModel parts skip only that candidate;
  present records that fail decoding remain contextual errors.
- Rebased the still-active legacy prepared-outdoor generated branch on the new canonical resolver.
  This avoids maintaining two population algorithms before the Tauri cutover.
- Added asset-independent branch tests for direct-Gfx physics/origin behavior, SetupModel
  physics-part/cylinder/sphere selection, and optional region-table failure isolation.
- Live archive smoke check: `DA55FFFF` resolved 160 outdoor statics (115 explicit, 42 buildings,
  3 generated) with zero source errors through the updated resolver.
- Verification: `cargo test -p holtburger-content -p holtburger-core` passed 231 tests.

Concession: a before/after live population comparison is not retained as a permanent test because
the old polygon-derived predicate was intentionally wrong and the active legacy wrapper now calls
the corrected resolver. Retail control-flow evidence plus focused predicate tests are the semantic
oracle; the live HBA pass verifies dependency closure and decoding.

### 2026-07-27: Phases 3 and 4 complete

- Moved active GfxObj geometry expansion into Tauri. The app now owns drawing-BSP filtering,
  visual-side expansion, winding, normal inversion, UV selection, fan triangulation, malformed
  polygon omission, bounds, and per-triangle material facts.
- Replaced string sampler signatures at the app boundary with the typed
  `SamplerWrapMode::{Clamp, Repeat}` fact.
- Made Tauri derive direct and SetupModel local bounds from the same geometry and hierarchy it
  serializes. Setup bounds apply part scale, default placement, parent placement, parent scale,
  and rotation through the complete ancestor chain.
- Cut landblock source batches over to one cached shallow foundation. Terrain, buildings, and
  explicit objects project directly from that foundation; generated scenery is resolved only when
  requested and internally reacquires the same cached `Arc<LandblockAsset>`.
- Removed prepared-content diagnostics and prepared static members from the active host path.
  Missing CellLandblock is the only serialized terrain-unavailable result; promised source,
  decoding, and assembly failures now reject the host request.
- Added a `resolvedHeights` `f32` section to the terrain record. The browser
  consumes those heights directly and no longer resolves indices through ActiveRegionData.
- Live archive smoke check produced a complete four-layer `DA55FFFF` source batch of 739,002 bytes.
  The temporary smoke binary was removed immediately after the run.
- Verification: 22 Rust app tests, 238 TypeScript tests, and `npm run check` passed.

Concession: moving SetupModel bounds to the actual serialized hierarchy corrects a weakness in the
old content-prepared bound, which unioned raw part bounds without the full parent transform chain.
This can change culling bounds while leaving geometry and resident transforms unchanged. The new
bound is conservative over transformed AABB corners.

Debt carried forward:

- `ContentAssetRequest::LandblockOutdoor` and its prepared cache now have no active app consumer;
  debug harnesses still reference them. Phase 7 deletes or narrows those harnesses rather than
  preserving the obsolete runtime API.
- The old shared geometry builder remains temporarily for prepared env-cell code and diagnostic
  harnesses. The active Tauri path has no import or call to it.

### 2026-07-27: Phase 5 complete and Phase 6 canonical path landed

- Audited the completed foundation and generated artifacts: neither retains prepared geometry,
  render bounds, apertures, or a completed derived-product cache. Generated, Tauri, and the new
  interior ID request reacquire the same cached `Arc<LandblockAsset>`.
- Inventoried the old env-cell output. Canonical authored fields are placement, surfaces, visible
  cells, flags, restrictions, portals, indoor static references, and the owning
  `(Environment DID, CellStruct selector)`. Prepared cell BSP clones, triangles, bounds, portal
  points/planes, static meshes/counts, building aperture meshes, and the landblock BVH are
  presentation or discarded diagnostic products.
- Added `LandblockInteriorSystemAsset` and its assembler. It resolves the complete foundation
  EnvCell fanout, retains one shared decoded `Arc<Environment>` per DID, validates each selected
  CellStruct, and keeps CellStruct ownership inside its Environment.
- Added one directed topology record per authored EnvCell portal. Raw selectors always survive;
  reciprocal in-range internal links receive a validated cross-link, while out-of-range and
  nonreciprocal selectors remain explicit unvalidated domain state.
- Joined LBI building portal claims to outside EnvCell portals without opening building GfxObjs.
  Claimed endpoints must exist, be outside, and have one unique claimant; unclaimed outside
  portals remain valid.
- Added `ContentAssetRequest::LandblockInteriorSystem` plus direct and ID-based service methods.
  The ID path reuses the foundation cache and does not add a completed interior-product cache.
- Added asset-independent coverage for reciprocal and unvalidated portal links, unclaimed outside
  portals, building claim enrichment, missing internal target cells, invalid building claims,
  Environment decode deduplication, shared `Arc` ownership, and foundation cache reuse.
- Verification: focused content interior tests and `cargo check -p holtburger-core` pass.

Decision: a `validated_target` means a structurally reciprocal cross-link, not merely an in-range
portal-vector lookup. The authored target cell and portal selectors remain available independently,
so this validation adds trustworthy navigation without discarding retail irregularities.

Resteer: no active non-harness consumer requires the old env-cell facts or prepared products.
Phase 6 can therefore finish as a clean deletion during the Phase 7 boundary scrub rather than
projecting the canonical interior graph back into the old render-shaped APIs.

Debt carried forward:

- Delete the old env-cell assemblers, prepared geometry/aperture/BVH types, and their tests rather
  than retaining two interior systems.
- Delete the render-oriented env-cell and BVH harnesses. Rewrite the building-portal harness only
  if it still answers an active evidence question after the canonical topology is available.
- Run full content/core tests after the old request variants and modules are removed; the current
  verification intentionally covers only the newly landed path.

### 2026-07-27: Phases 6 and 7 complete

- Completed the canonical interior service surface and deleted the competing single-EnvCell and
  prepared env-cell system requests.
- Deleted the 4,408-line mixed `landblock_scene_assets` module, including filtered outdoor
  requests/caches, prepared meshes, render bounds, aperture geometry, BVHs, durable source
  diagnostics, and their architecture-preserving tests.
- Reduced the former static-outdoor module to canonical generated-scenery resolution and renamed
  it `generated_scenery.rs`. Deleted the legacy wrapper scene, source-family filters, candidate
  diagnostics, and frontend-style stable-ID/source-reference types.
- Deleted the unused legacy sampler-signature module and narrowed `ContentSourceReader` to the
  Scene, SetupModel, and GfxObj closure still required by generated-scenery resolution.
- Removed eight render-oriented or completed-evidence debug harnesses. Migrated the retained
  terrain-loading harness to the canonical `LandblockAsset` request and kept its material-code
  inspection local to the tool.
- Rewrote the content architecture document around the shallow/deep canonical boundary and
  regenerated the app architecture audit from current code. The audit records the app-local
  geometry/HBLB ownership, load-bearing runtime bones, and remaining structural hubs.
- Live archive interior smoke check: `DA55FFFF` resolved 236 EnvCells, 17 deduplicated
  Environments, 490 directed portals, and 38 building-claimed outside endpoints. The temporary
  smoke binary was deleted immediately.
- Final searches find no active non-legacy consumer or definition of the removed outdoor,
  prepared, BVH, shared-render-geometry, or durable-diagnostics contracts.
- Verification passed:
  - `cargo test --workspace --all-targets`;
  - `cargo clippy --workspace --all-targets --all-features -- -D warnings`;
  - `cargo fmt --all -- --check`;
  - 238 TypeScript tests;
  - Svelte/TypeScript checks with zero errors and warnings;
  - ESLint, Knip, app Rust clippy, and Prettier format checks; and
  - `git diff --check`.

Concession: the full app Prettier gate exposed ten pre-existing formatting drifts outside the
semantic change set. They were normalized mechanically so the required repository-wide app gate
passes; no behavior changed in those files.

Debt intentionally not pulled into this plan:

- `apps/holtburger-3d/src-tauri/src/lib.rs`, `webgl2-renderer.ts`,
  `static-object-geometry-worker.ts`, and `game-runtime.ts` remain large structural hubs. The
  refreshed architecture audit records their honest seams; splitting them without an active
  feature need would be unrelated churn.
- Browser env-cell materialization remains future work. The new canonical interior asset is the
  source boundary for that work, but this plan deliberately does not serialize or render it.

## Context and Boundaries

### Goal

Replace the filtered, renderer-prepared outdoor and env-cell content APIs with one complete shallow
landblock foundation plus explicit generated-scenery and interior-system resolutions, while moving
all frontend presentation preparation into `apps/holtburger-3d`.

### Current State

The current content boundary combines three different responsibilities:

1. Decoding and joining DAT records.
2. Deriving canonical landblock facts.
3. Preparing frontend-oriented rendering data.

`LandblockOutdoorAssetRequest` accepts terrain and outdoor-family filters. Its assembler may load
`CellLandblock`, `LandblockInfo`, `RegionDesc`, Scene records, GfxObjs, and SetupModels before
returning:

- canonical terrain and outdoor placement facts;
- renderer-space placements and scales;
- `PreparedStaticMesh` expansion and bounds;
- prepared building-transition aperture geometry; and
- durable content-source diagnostic ledgers that most successful consumers immediately discard.

The active Tauri host then:

- repartitions the mixed static-member vector into buildings, explicit objects, and generated
  scenery;
- discards instance bounds, transition apertures, building facts, and generated provenance;
- reloads SetupModels and GfxObjs to build the actual presentation closure;
- calls shared content triangulation to produce render geometry; and
- serializes app-local terrain and outdoor-static layer records.

The browser subsequently transforms and repartitions the same geometry, constructs baked or
instanced draw units, and computes committed bounds.

Env cells are separate today, which is directionally correct for their loading cost, but the
current `EnvCellAsset` and `EnvCellSystemAsset` are speculative render products. Their assembly
fans out from `LandblockInfo` through every EnvCell and Environment with embedded CellStructs, then
adds prepared shell geometry, portal apertures, indoor static meshes, render bounds, and a
landblock BVH. The active 3D client does not materialize env cells yet.

### Source-Domain Shape

The two natural shallow landblock records are:

- `CellLandblock` (`0xXXYYFFFF`): authored terrain samples, height-table indices, and the
  `has_objects` flag.
- `LandblockInfo` (`0xXXYYFFFE`): explicit-object placements, buildings and building portal
  metadata, env-cell count, and restrictions.

Together they provide the complete cheap foundation needed by terrain, buildings, explicit
objects, generated scenery, and interior resolution. They do not require opening referenced
GfxObjs, SetupModels, EnvCells, or Environments and their embedded CellStructs.

`CellLandblock.has_objects` is the authoritative LBI-presence contract. When it is zero, the
foundation has empty LBI-derived sections and does not request `0xXXYYFFFE`. When it is nonzero,
the matching LandblockInfo is required; absence or decode failure is a landblock-resolution error.

Generated scenery and interiors are deeper dependency expansions:

```text
LandblockAsset
  ├── resolve generated scenery
  │     ├── RegionDesc terrain/scene tables
  │     ├── Scene and SceneObjectTemplate records
  │     └── referenced object construction and boundary facts for retail acceptance
  │
  ├── enrich terrain/building/object references in holtburger-3d
  │     └── GfxObj, SetupModel, appearance, material, and texture dependencies
  │
  └── resolve interior system
        ├── all landblock EnvCells
        ├── deduplicated Environments containing their embedded CellStructs
        └── directed env-cell/building portal records
```

The active region is an ambient dependency of this resolution graph. The “region scene tables”
used by generated scenery are not separate assets: they are `RegionDesc.terrain_info` and
`RegionDesc.scene_info`. Terrain height resolution additionally uses
`RegionDesc.land_defs.land_height_table`. The content service decodes one active `RegionDesc` at
construction, retains it as `Arc<ActiveRegionData>`, and uses that same snapshot for landblock
resolution and the active-region response. Tauri does not pass raw `RegionDesc` values back into
content APIs.

### Target APIs

Names remain subject to normal implementation refinement, but the ownership and dependency shape
are locked:

```rust
pub struct LandblockAsset {
    pub landblock_id: u32,
    pub terrain: LandblockTerrain,
    pub explicit_objects: Vec<LandblockObject>,
    pub buildings: Vec<LandblockBuilding>,
    pub env_cell_refs: Vec<LandblockEnvCellRef>,
    pub restrictions: Vec<LandblockRestriction>,
}

pub struct GeneratedSceneryAsset {
    pub landblock_id: u32,
    pub objects: Vec<GeneratedSceneryObject>,
}

pub struct LandblockInteriorSystemAsset {
    pub landblock_id: u32,
    pub cells: Vec<LandblockEnvCell>,
    pub environments: BTreeMap<u32, Arc<Environment>>,
    pub topology: LandblockPortalTopology,
}
```

The complete shallow `LandblockAsset` has no selection filter. Generated scenery and the interior
system are separate explicit resolutions over that foundation because their dependency fanout,
loading radius, failure surface, and lifecycle differ materially.

The existing core content service is the composition root for the active content scope:

```rust
pub struct ContentAssetService {
    content: Arc<ContentRepository>,
    decode_cache: Arc<ContentDecodeCache>,
    active_region: Arc<Mutex<Option<Arc<ActiveRegionData>>>>,
    // immutable derived-product caches
}

impl ContentAssetService {
    pub fn new(
        content: Arc<ContentRepository>,
        decode_cache: Arc<ContentDecodeCache>,
    ) -> Self;
    pub fn active_region(&self) -> Result<Arc<ActiveRegionData>>;
    pub fn load_landblock(
        &self,
        landblock_id: u32,
    ) -> Result<Option<Arc<LandblockAsset>>>;
    pub fn resolve_generated_scenery(
        &self,
        landblock: &LandblockAsset,
    ) -> Result<GeneratedSceneryAsset>;
    pub fn resolve_interior_system(
        &self,
        landblock: &LandblockAsset,
    ) -> Result<LandblockInteriorSystemAsset>;
}
```

Construction does not read RegionDesc. Region-scoped operations lazily load and pin the
repository-selected descriptor, while region-independent GfxObj, SetupModel, texture, palette, and
other DAT requests remain available without it. Individual operations validate only the optional
region sections they consume: missing scene or terrain-type tables fail generated-scenery
resolution without disabling unrelated content requests. Small internal derivation functions may
accept `&RegionDesc` explicitly for direct tests; the public app boundary does not thread it
through every request.

`None` represents an absent CellLandblock only. A CellLandblock with `has_objects == 0` is a
complete foundation with empty LBI-derived collections. A promised but missing/corrupt
LandblockInfo, or any CellLandblock decode, assembly, or invariant failure, remains an error.
Generated and interior ID-based convenience requests must acquire the same cached
`Arc<LandblockAsset>` internally rather than rebuilding the foundation or forcing Tauri to
understand DAT dependency closure.

Successful assets contain domain state only. They do not carry source-attempt ledgers, rejected
candidate counts, or durable diagnostics. Required missing/corrupt inputs return contextual
errors; a dedicated error enum is added only if callers demonstrate a need to branch on more than
top-level source absence. Valid authored uncertainty is modeled in the domain—for example, an
outside portal endpoint or a preserved unknown DID family—rather than encoded as a diagnostic
record. Temporary reverse-engineering evidence belongs in logs, focused test instrumentation, or
debug harnesses.

### Locked Decisions

1. `ContentAssetService` lazily pins one repository-selected `Arc<ActiveRegionData>` when a
   region-scoped operation first needs it, then uses it for the active-region response and every
   landblock derivation. Tauri does not select or pass a region into individual landblock calls,
   and region-independent requests do not require RegionDesc.
2. `LandblockAsset` always contains the complete shallow facts derived from `CellLandblock`,
   `LandblockInfo`, and the pinned active region. It has no
   terrain/building/object/generated/env-cell selection flags.
3. Shallow explicit-object, building, and indoor-static records retain source DIDs, authored
   placements, stable identities, and source provenance. They do not embed GfxObjs, SetupModels,
   render geometry, materials, or bounds.
4. Terrain index-to-height resolution is canonical DAT-derived content work. `LandblockAsset`
   retains both authored height indices and resolved heights; the frontend must stop resolving the
   same heights again.
5. Generated scenery is a separate canonical resolution that accepts or internally shares the
   shallow foundation. Its result remains shallow even when the derivation transiently reads
   GfxObj or SetupModel physics facts.
6. The interior system is a separate canonical resolution that accepts or internally shares the
   shallow foundation. It resolves the full EnvCell/Environment fanout and directed portal
   topology but performs no render preparation.
7. Building-to-interior topology is a three-way source join:
   - `LandblockInfo` building portal metadata provides connectivity and env-cell references;
   - building GfxObj drawing-BSP `PortalPoly` records provide building-shell aperture geometry; and
   - EnvCell portal records plus CellStruct polygons/BSPs provide the interior endpoint and
     aperture source.
8. Canonical topology does not require building aperture meshes. It preserves each authored
   EnvCell portal as a directed record with its raw target cell/portal selector and an optional
   validated target-portal reference. It does not require reciprocal links or collapse paired
   records. Outside is an explicit endpoint; a matching LBI building portal enriches that endpoint
   when present. Tauri loads the building GfxObj and derives aperture geometry when presentation
   needs it.
9. `apps/holtburger-3d/src-tauri` owns render-coordinate conversion, polygon triangulation,
   render-side expansion, setup source closure, material projection, and future aperture meshes.
   The browser derives runtime presentation bounds from the same cumulative part transforms used
   by static geometry preparation.
10. The browser owns final draw-range construction, baked/instanced partitioning, transparency
    policy, portal traversal policy, runtime visibility, committed bounds, and spatial structures.
11. Interest radii remain frontend policy. A wide terrain or building radius may load the cheap
    `LandblockAsset` without triggering generated-scenery resolution, env-cell fanout, or
    GfxObj/SetupModel presentation enrichment for unrequested layers.
12. Decoded-record and derived-foundation caches prevent archive I/O, parsing, and foundational
    derivation from repeating across generated, interior, and Tauri presentation consumers.
    Immutable decoded records are shared through `Arc`; cache hits do not clone Environment
    CellStruct graphs or other heavy records.
13. Successful artifacts contain domain data only. Missing/corrupt required inputs are errors;
    valid absence, outside endpoints, and authored portal cross-links without a valid reciprocal
    portal use explicit domain state.
14. Debug harnesses may consume canonical or raw facts, but they do not preserve durable
    diagnostics or shared renderer types. No compatibility surface remains for the excluded legacy
    3D application.

### In Scope

- Add the complete shallow `LandblockAsset` and its assembler.
- Resolve canonical terrain heights once while retaining authored indices and terrain samples.
- Preserve all authored explicit-object and building references without filtering unsupported DID
  families out of the foundation.
- Derive stable building portal facts, env-cell references, and restrictions.
- Cache the immutable foundation by landblock identity and share it through `Arc`.
- Make decoded-record cache hits share immutable values rather than clone decoded Environment,
  Scene, SetupModel, and GfxObj graphs.
- Lazily pin one decoded active-region snapshot in `ContentAssetService` and share it across
  region-scoped operations and the active-region response.
- Extract generated scenery into a derivation over `LandblockAsset`.
- Prove and correct generated-object acceptance against retail, including the discovered
  pre-scale `obj_within_block` ordering mismatch.
- Replace the current hand-built generated-object boundary approximation if it does not reproduce
  retail `CPhysicsObj::obj_within_block`.
- Replace prepared env-cell assets with a canonical `LandblockInteriorSystemAsset` over the shallow
  foundation.
- Deduplicate Environment data in the interior result and retain CellStructs only through their
  owning Environment.
- Build canonical directed env-cell and building-transition topology without generating aperture
  meshes or requiring reciprocity.
- Move active GfxObj render geometry preparation and its tests into Tauri.
- Make Tauri consume shallow DIDs and build its own closed presentation source records.
- Remove `LandblockOutdoorAssetRequest`, `LandblockOutdoorAsset`, outdoor prepared members,
  prepared building apertures, prepared env-cell render products, and the env-cell BVH.
- Rework Tauri landblock-batch assembly to request the foundation once and resolve only the
  expensive products required by the frontend request.
- Delete durable source-diagnostic records and replace diagnostic-derived availability decisions
  with explicit load outcomes and errors.
- Update public exports, cache contracts, architecture docs, and tests.

### Out of Scope

- Implementing env-cell rendering, portal traversal, interior visibility, indoor static
  presentation, collision, or runtime materialization in the browser.
- Loading building GfxObjs merely to complete canonical portal topology.
- Embedding outdoor or indoor GfxObjs, SetupModels, materials, textures, or render geometry in
  content landblock results.
- Making generated scenery or the interior system eager members of every shallow landblock load.
- Coupling content APIs to frontend layer enums, source-batch records, interest radii, binary
  transport, or WebGL policy.
- Changing terrain, building, explicit-object, or generated-scene interest radii as part of this
  boundary refactor. The new API must support wide building interest without expensive incidental
  fanout; the actual radius value remains an app policy change.
- Redesigning material recipes, setup appearance resolution, texture decoding, regional terrain
  composition, atlas management, or renderer draw policy.
- Permanent tests that require an untracked HBA or DAT installation.
- Adding a generic observer, event-sink, or diagnostics framework to replace the removed records.

## Ground Truth and Existing Precedent

### Authoritative Record and Runtime Sources

- `crates/holtburger-dat/src/landblock.rs`
  - `CellLandblock`
  - `LandblockInfo`
  - `Stab`
  - `BuildInfo`
  - `PortalInternal`
- `crates/holtburger-dat/src/file_type/`
  - `EnvCell`
  - `Environment`
  - `CellStruct`
  - `GfxObj`
  - `SetupModel`
  - `RegionDesc`
  - `Scene`
  - `SceneObjectTemplate`
- `ACE/Source/ACE.DatLoader/FileTypes/`
  - authoritative decoded record shapes.
- `ACViewer/ACViewer/Physics/Common/Landblock.cs`
  - generated-scenery selection, terrain placement, building rejection, slope checks,
    `obj_within_block`, and scale ordering.
- `ACViewer/ACViewer/Physics/PhysicsObj.cs`
  - readable `obj_within_block` implementation using sorting spheres and cylinder spheres.
- `ACViewer/ACViewer/Render/R_GfxObj.cs`
  - GfxObj presentation behavior.
- `ACViewer/ACViewer/Render/R_PartArray.cs`
  - setup-part hierarchy, placement, and scale behavior.
- `acclient-eor-source/acclient.c`
  - retail generated-scenery path around lines 338183-338255;
  - retail `CPhysicsObj::obj_within_block` around lines 306629-306745.
- `acclient-eor-source/acclient.h`
  - retail structure declarations needed to interpret the decompile.

Retail is authoritative for generated population. ACViewer is supporting readable evidence, not a
replacement when the two differ.

### Evidence Resolved During Plan Dry-Run

The following questions were resolved before implementation:

- **LandblockInfo presence:** ACE identifies `CellLandblock.HasObjects` as the presence bit for the
  matching LBI. Retail copies that contract into `CLandBlock::lbi_exists`; `InitLoad` succeeds
  without an LBI only when the bit is clear. A one-shot scan of `dats/assets.hba` found 65,025
  CellLandblocks and 5,346 LBIs with zero flag/presence mismatches.
- **CellStruct identity and ownership:** Environment is the addressable `0x0D` DAT asset;
  CellStructs are embedded entries. Retail `CEnvironment::get_cellstruct` indexes the Environment's
  array using the EnvCell selector. The local HBA contained 772 Environments; every embedded
  CellStruct ID equaled its source ordinal, and every EnvCell selector resolved. Only 49 local
  selectors occurred globally and 38 were reused across Environments. The stable reference is
  therefore `(environment_did, local_selector)`, but storage remains owned by the deduplicated
  Environment rather than a second global CellStruct map.
- **Generated direct-GfxObj construction:** Retail `CPhysicsObj::InitPartArrayObject` dispatches a
  GfxObj DID through `CPartArray::CreateMesh`. `CSetup::makeSimpleSetup` creates a one-part setup
  whose sorting sphere is the GfxObj physics-BSP root sphere when available, otherwise its
  drawing-BSP root sphere. If the GfxObj has a physics BSP, `obj_within_block` checks that unscaled
  sorting sphere; otherwise the simple setup has no cylinder/sphere arrays and retail checks the
  unscaled object origin.
- **Generated SetupModel construction:** Setup DIDs use `CPartArray::CreateSetup`; construction
  requires the SetupModel and its parts. `obj_within_block` uses the SetupModel sorting sphere when
  any part has a physics BSP, otherwise every cylinder sphere when present, otherwise the sorting
  sphere when the SetupModel sphere array is nonempty, otherwise the object origin. Template scale
  is still applied only after acceptance.
- **Generated source failure:** If `makeObject` cannot construct a referenced GfxObj/SetupModel,
  retail skips that candidate and continues the Scene template loop. A constructible object with no
  physics boundary data is not skipped; it uses the origin fallback. Present records that
  Holtburger cannot decode remain hard errors so corruption is not silently disguised as retail
  absence.
- **Portal topology:** Retail treats `other_portal_id` as the target EnvCell portal-vector index.
  The local HBA contained 1,850,702 internal and 16,997 outside EnvCell portal records. Every
  internal target cell existed, but 697 target portal selectors were out of range and 1,081
  additional links were nonreciprocal. All 16,937 LBI building portals resolved to valid outside
  EnvCell portals; 60 outside portals had no building claim and no outside portal was multiply
  claimed. Canonical topology must therefore preserve directed authored records and optional
  resolved cross-links rather than enforce or synthesize reciprocity.
- **Completed-product caching:** Browser scene-interest reconciliation dispatches only newly
  demanded layers, while the core runtime already coalesces concurrent identical work and the
  decode cache retains individual dependencies. Cache the cross-layer LandblockAsset foundation,
  but do not initially cache completed generated or interior products. More importantly, replace
  clone-on-hit decoded records with shared immutable values so Environment/CellStruct graphs are
  not copied. Add completed-product caches only from measured re-entry cost and retention data.

The HBA scans were temporary read-only harnesses and were removed after recording these aggregate
results. They are evidence for the shipped retail data set, while the retail and ACE code paths
define the semantic contract.

### Current Content Implementations to Replace or Split

- `crates/holtburger-content/src/landblock_scene_assets.rs`
  - `LandblockOutdoorAssetRequest`
  - `LandblockOutdoorAssetAssembler`
  - terrain projection and regional height resolution
  - `PreparedStaticInstance` and `PreparedStaticMesh`
  - `PreparedInteriorCell`
  - prepared portal apertures
  - env-cell fanout and `EnvCellSystemAssetAssembler`
  - render bounds and BVH construction
- `crates/holtburger-content/src/static_outdoor_scene.rs`
  - shallow explicit-object and building derivation
  - generated-scenery selection
  - current `object_bounds_within_landblock` approximation
- `crates/holtburger-content/src/decode_cache.rs`
  - decoded CellLandblock, LandblockInfo, EnvCell, Environment, RegionDesc, Scene, GfxObj, and
    SetupModel reuse;
  - current clone-on-hit behavior to replace with shared immutable values.
- `crates/holtburger-core/src/content_assets.rs`
  - current exact-request outdoor cache
  - async single-flight runtime
  - asset request/result vocabulary.

### Active Tauri and Browser Consumers

- `apps/holtburger-3d/src-tauri/src/landblock_source_batch.rs`
  - frontend layer-set mapping and current outdoor-asset projection.
- `apps/holtburger-3d/src-tauri/src/outdoor_static_source.rs`
  - closed presentation, geometry, material, and texture dependency record.
- `apps/holtburger-3d/src-tauri/src/lib.rs`
  - batch command and terrain/outdoor-static serializers.
- `apps/holtburger-3d/src/lib/assets/decode-landblock-source-batch.ts`
  - independent nested record decoding.
- `apps/holtburger-3d/src/lib/assets/decode-outdoor-static-record.ts`
  - resolved presentation and resident hydration.
- `apps/holtburger-3d/src/lib/game/terrain/active-region-terrain-resolver.ts`
  - current duplicate height-index resolution to remove.
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts`
  - final geometry transform, batching, instancing, draw ranges, and committed bounds.

### Debug Harness Consumers to Reassess

- `crates/holtburger-debug-harness/src/bin/inspect_landblock_env_cell_bvh.rs`
- `crates/holtburger-debug-harness/src/bin/inspect_landblock_building_portals.rs`
- `crates/holtburger-debug-harness/src/bin/inspect_gfx_obj_render_geometry.rs`
- `crates/holtburger-debug-harness/src/bin/inspect_static_source_asset.rs`
- `crates/holtburger-debug-harness/src/bin/inspect_building_layer_evidence.rs`
- `crates/holtburger-debug-harness/src/bin/inspect_landblock_outdoor_statics.rs`
- `crates/holtburger-debug-harness/src/bin/inspect_terrain_loading.rs`

These binaries migrate to canonical facts, own temporary instrumentation or narrow presentation
derivations locally, or are deleted. They are not architectural consumers and do not justify
diagnostic fields in successful runtime artifacts.

## North Stars

1. **One complete shallow foundation.** Every `LandblockAsset` contains the canonical cheap facts
   from CellLandblock, LandblockInfo, and the active region; there is no per-layer filter.
2. **Expensive fanout is explicit.** Generated scenery and interiors are separate resolutions over
   the shared foundation.
3. **Dependencies are honest and testable.** The content service lazily owns the active-region
   snapshot only for operations that need it; generated and interior derivations accept
   `&LandblockAsset`, and convenience APIs may resolve the cached foundation by ID.
4. **Decode once, derive once, prepare once.** Raw records are shared immutably from the decode
   cache, foundations use a landblock cache, Tauri prepares closed presentation source records,
   and the browser owns runtime presentation transforms and bounds.
5. **Content outputs knowledge, not rendering.** It may join and understand DAT records deeply, but
   its public results contain canonical facts and shallow DIDs rather than renderer products.
6. **Generated population is canonical.** Content reproduces retail's DID-specific construction
   and unscaled boundary predicate; Tauri later resolves the same DID for presentation.
7. **Topology is not aperture geometry or guaranteed reciprocity.** Content preserves directed
   authored portal records, raw cross-link selectors, and optional validated cross-links; Tauri
   resolves polygons into meshes.
8. **Interiors follow DAT ownership.** Cells reference shared Environments by DID and local
   CellStruct selector. Embedded CellStructs are neither cloned per cell nor hoisted into a second
   storage map.
9. **Wide buildings stay cheap.** Loading shallow building metadata at a wide radius does not
   trigger generated resolution, env-cell fanout, or unrelated presentation closure.
10. **Frontend batches remain app-local.** Tauri decides which content products to request and how
    to serialize them into independent layer records.
11. **Failures remain visible without polluting success values.** Missing promised or corrupt
    records return errors. Retail-nonconstructible generated candidates are omitted, origin-only
    boundary behavior remains valid, and imperfect authored portal cross-links remain explicit
    domain state rather than being silently repaired.
12. **Deletion completes the cutover.** No old filtered request, compatibility DTO, prepared
    content geometry, or speculative BVH remains.

## Phased Implementation

### Phase 1: Introduce the Complete Shallow Landblock Foundation

#### Deliverables

- Add the canonical `LandblockAsset` family of types.
- Make `ContentAssetService` acquire and retain one `Arc<ActiveRegionData>` for its lifetime.
- Add a focused assembler that loads CellLandblock and LandblockInfo while consuming the service's
  pinned active-region facts.
- Add an immutable landblock foundation cache shared through `Arc`.
- Preserve the existing runtime path temporarily while the new foundation is proven.

#### Task Checklist

- [x] Define honest IDs and shallow reference types for explicit objects, buildings, building
      portals, env-cell references, and restrictions.
- [x] Preserve every source DID, including unsupported families; classification may annotate but
      must not discard the record.
- [x] Canonicalize terrain ordering and resolve heights through the active RegionDesc once.
- [x] Retain height indices, resolved heights, and terrain samples in the foundation.
- [x] Derive env-cell IDs from `LandblockInfo.num_cells` without loading EnvCell records.
- [x] Normalize building portal stab references into full env-cell IDs.
- [x] Treat `CellLandblock.has_objects == 0` as authoritative absence of LandblockInfo and emit
      empty LBI-derived collections without reading `0xXXYYFFFE`.
- [x] Require the matching LandblockInfo when `has_objects != 0`; missing or corrupt promised
      records fail foundation resolution.
- [x] Keep service construction independent of RegionDesc; lazily fail only region-scoped
      operations when the repository-selected descriptor is missing or corrupt, and retain a
      successful decode as `Arc<ActiveRegionData>`.
- [x] Serve the active-region command from the same pinned snapshot used by landblock resolution.
- [x] Do not require optional `terrain_info` or `scene_info` merely to construct the service or
      resolve shallow landblock facts.
- [x] Key the completed foundation cache only by normalized landblock identity.
- [x] Return shared immutable foundations as `Arc<LandblockAsset>` rather than cloning vectors.
- [x] Change decoded-record cache storage and accessors to share immutable records through `Arc`
      rather than cloning decoded values on every hit; migrate consumers without compatibility
      wrappers.
- [x] Define `Result<Option<Arc<LandblockAsset>>>` semantics: `None` is source absence, while
      decode, assembly, and invariant failures remain errors.
- [x] Replace the current exact filtered-outdoor cache with the foundation cache after direct
      artifact parity is proven.
- [x] Omit region identity and source-attempt ledgers from the foundation unless an actual domain
      consumer is demonstrated.
- [x] Add synthetic tests for empty landblocks, terrain transpose, height resolution, restrictions,
      unsupported DIDs, env-cell ID derivation, building portal references, absent CellLandblocks,
      unflagged LBI absence, promised LBI absence, malformed required records, and Arc reuse.

#### Acceptance Criteria

- Loading a foundation opens no referenced GfxObj, SetupModel, EnvCell, Environment, CellStruct, or
  Scene record.
- The result always contains complete terrain, explicit-object, building, env-cell-reference, and
  restriction facts for the landblock.
- Repeated foundation requests share one completed derivation and immutable value.
- Active-region serialization and landblock resolution observe the same immutable descriptor.
- Missing optional scene tables do not block the shallow foundation.
- An unflagged missing LBI succeeds without an archive read; a flagged missing/corrupt LBI fails.
- The foundation contains no `Prepared*` renderer products.
- The foundation contains no durable diagnostics.
- Repeated decoded Environment, Scene, SetupModel, and GfxObj loads share immutable allocations.

#### Decisions and Course Corrections

- Resolved before implementation: `CellLandblock.has_objects` defines the LBI contract. No
  additional availability field is needed inside a successful foundation.
- Landed, then simplified: service construction is infallible and test-only construction can seed
  an `ActiveRegionData` snapshot directly. Production region-scoped operations load and pin the
  repository-selected RegionDesc on demand without a fallback.
- Resteered sequencing: direct parity means the active Tauri cutover, not projection back into the
  obsolete prepared DTO. The exact filtered cache therefore remains until Phase 4 and is not used
  by any new API.

### Phase 2: Extract and Prove Generated-Scenery Resolution

#### Deliverables

- Extract generated scenery into an explicit `ContentAssetService` derivation over
  `&LandblockAsset`.
- Add an ID-based core convenience request that internally acquires the cached foundation.
- Establish retail-correct candidate acceptance before switching the active generated layer.

#### Task Checklist

- [x] Make terrain samples, resolved heights, building occupancy, explicit-object spacing, and
      landblock identity explicit inputs from `LandblockAsset`.
- [x] Read `RegionDesc.terrain_info` and `RegionDesc.scene_info` from the service's pinned active
      region; keep Scene and SceneObjectTemplate loading internal to the content resolver.
- [x] Return a contextual generated-resolution error when required optional region tables are
      absent; do not make their absence a service-construction or shallow-foundation failure.
- [x] Keep the generated result shallow: DID, stable ID, placement, scale, terrain/scene/template
      provenance, and no durable diagnostic ledger.
- [x] Preserve retail-derived deterministic frequency, displacement, road, terrain, slope,
      rotation/alignment, spacing, and building rejection behavior.
- [x] Trace retail `CPhysicsObj::makeObject`, `set_initial_frame`, `obj_within_block`,
      `add_obj_to_cell`, and `SetScaleStatic` in order.
- [x] Correct the discovered drift: current Holtburger passes generated template scale into its
      boundary test, while retail calls `obj_within_block` before `SetScaleStatic`.
- [x] Replace the direct-GfxObj physics-polygon-vertex walk with retail's synthetic-simple-setup
      predicate:
  - constructibility requires the GfxObj and its one physics part;
  - when a physics BSP exists, use its root sphere as the unscaled sorting sphere;
  - without a physics BSP, use the unscaled object origin even if a drawing sphere exists.
- [x] Implement the proven SetupModel predicate:
  - constructibility requires the SetupModel and referenced parts;
  - any part physics BSP selects the SetupModel's unscaled sorting sphere;
  - otherwise use every cylinder sphere when present;
  - otherwise use the SetupModel sorting sphere when its sphere array is nonempty;
  - otherwise use the unscaled object origin.
- [x] Do not reuse render bounds or triangulated geometry for generated acceptance.
- [x] Treat a missing/unsupported source or missing referenced part as a nonconstructible candidate
      and continue Scene enumeration, matching retail `makeObject == null`.
- [x] Treat a present source that fails Holtburger decoding as a generated-resolution error rather
      than disguising corruption as normal source absence.
- [x] Do not require a physics envelope: a constructible source with no applicable sphere/cylinder
      data uses retail's origin-only containment test.
- [x] Add synthetic predicate tests for accepted and boundary-rejected direct/setup candidates,
      then run a live archive smoke check for dependency closure and decoding.
- [x] Document the authoritative retail evidence next to unintuitive acceptance logic.

#### Acceptance Criteria

- Generated resolution consumes the exact cached foundation supplied by the caller or convenience
  request.
- It does not rederive terrain, buildings, explicit objects, or restrictions.
- Candidate population and rejection behavior match retail evidence, including pre-scale
  `obj_within_block` ordering.
- Generated output embeds no GfxObj, SetupModel, render geometry, material, or renderer bounds.
- Generated output contains no attempted/rejected-candidate counters or source diagnostics.
- Permanent tests remain asset-independent.

#### Decisions and Course Corrections

- Resolved before implementation: direct GfxObj and SetupModel construction and boundary predicates
  are recorded in the task checklist and Evidence section. No generic polygon-derived
  physics-envelope fallback remains.
- Do not add a completed generated-product cache initially. The foundation and decoded dependencies
  are cached, concurrent exact work is single-flight, and browser interest dispatches only newly
  demanded layers. Reconsider only with measured re-entry cost.
- Landed: the old prepared-outdoor branch delegates generated population to the canonical resolver
  until Phase 4 removes that wrapper. Legacy diagnostic counters are no longer populated except for
  accepted count; no active consumer uses those counts, and Phase 7 deletes them.

### Phase 3: Establish App-Local Presentation Preparation

#### Deliverables

- Move GfxObj render geometry preparation and renderer-facing geometry types into Tauri.
- Serialize geometry bounds and setup source facts from Tauri, then derive presentation-local
  bounds in the browser from the same cumulative hierarchy used by static geometry preparation.
- Move focused synthetic geometry tests to the new owner.

#### Task Checklist

- [x] Inventory and preserve drawing-BSP polygon filtering, visual-side expansion, winding, normal
      inversion, UV selection, fan triangulation, malformed-polygon handling, and bounds.
- [x] Preserve per-triangle surface, sampler, side, culling, and stippling facts.
- [x] Replace string material-variant signatures with a narrow app-local typed sampler fact.
- [x] Compute direct and setup-backed presentation bounds from the closed source graph through the
      browser's shared hierarchy transform helper.
- [x] Cover setup parent placement, default placement, part scale, resident scale, rotations, and
      promoted dynamic residents.
- [x] Run a temporary live archive source-batch smoke check covering geometry, bounds, and
      serialized record construction after the move.
- [x] Remove Tauri imports of shared content render-geometry helpers after parity is proven.

#### Acceptance Criteria

- Tauri produces equivalent geometry, per-triangle facts, and presentation source definitions;
  the browser produces conservative local bounds from the exact runtime transforms.
- No active Tauri runtime path calls content renderer preparation.
- Content no longer needs public GfxObj render-geometry types for the active client.

#### Decisions and Course Corrections

- Any discovered presentation-semantic ambiguity must be resolved from ACE, ACViewer, or retail
  before changing behavior during the ownership move.

### Phase 4: Cut Tauri Landblock Batches Over to the New Content Products

#### Deliverables

- Replace `LandblockOutdoorAssetRequest` consumption with the cached shallow foundation.
- Resolve generated scenery only when the frontend requests the generated layer.
- Keep frontend layer projection and binary serialization entirely app-local.
- Remove duplicate frontend height resolution.

#### Task Checklist

- [x] Acquire one `Arc<LandblockAsset>` for every Tauri landblock source-batch response.
- [x] Serialize terrain from the foundation's indices, resolved heights, and terrain samples.
- [x] Project buildings and explicit objects directly from shallow foundation vectors.
- [x] Resolve generated scenery from the same foundation only when requested.
- [x] Ensure terrain/building requests do not trigger generated or interior resolution.
- [x] Ensure object metadata included in the foundation remains unenriched unless the objects layer
      is requested.
- [x] Load GfxObj, SetupModel, setup appearance, material, and RenderSurface dependencies only in
      `OutdoorStaticSourceClosure`.
- [x] Preserve promoted-dynamic classification and local bounds.
- [x] Update the terrain binary contract to carry resolved heights.
- [x] Remove browser `active-region-terrain-resolver` height-table lookup while preserving any
      authored height indices needed by terrain material logic.
- [x] Preserve independent frontend record ownership, revision, failure, and eviction semantics.
- [x] Replace terrain availability inference through content-source diagnostics with the explicit
      landblock load outcome. Missing source data is an availability result; decode or assembly
      failure rejects the host request.
- [x] Verify that wide building interest can share the foundation without generating explicit or
      generated presentation bundles unless requested.

#### Acceptance Criteria

- One shallow foundation acquisition serves all requested terrain/building/object records in a
  batch.
- Generated scenery reuses that exact foundation and is absent from non-generated requests.
- Tauri is the sole presentation-closure and layer-bundle generator.
- Terrain heights are resolved once in content and consumed directly by the frontend.
- Active rendered terrain, buildings, explicit objects, and generated scenery remain visually and
  structurally equivalent except for the intentional retail generated-acceptance correction.

#### Decisions and Course Corrections

- Landed: the terrain record adds the `resolvedHeights` `f32` section. Height indices remain
  because terrain material composition still consumes the authored samples. Exact-only transport
  version fields were subsequently removed from all maintained app envelopes.

### Phase 5: Resteer Before the Interior Cutover

#### Deliverables

- Audit the landed foundation/generated/Tauri boundaries before reshaping env-cell content.
- Dry-run the interior fanout and topology design against actual non-legacy consumers.

#### Task Checklist

- [x] Confirm no completed foundation stores prepared geometry, render bounds, or aperture meshes.
- [x] Confirm generated and Tauri consumers share the cached foundation rather than cloning or
      rebuilding it.
- [x] Inventory every canonical field currently present in `EnvCellFact`, `EnvironmentFact`,
      `PreparedInteriorCell`, and building-transition facts.
- [x] Separate canonical topology facts from renderer aperture and visibility products.
- [x] Confirm the implementation preserves Environment-owned CellStruct storage and references it
      by `(environment_did, local_selector)` without cloning or a second structures map.
- [x] Preserve authored directed portal records and validate target-cell/target-portal resolution
      independently; do not require reciprocity.
- [x] Reassess debug harnesses based on current reverse-engineering value.
- [x] Update Phase 6 if the active record graph reveals a smaller or more precise canonical shape.

#### Acceptance Criteria

- The remaining interior implementation can land without reintroducing frontend policy into
  content.
- Every retained env-cell field has a canonical source or derived-topology justification.

#### Decisions and Course Corrections

- Resolved before implementation: Environment owns its embedded CellStructs. The stable reference
  is `(environment_did, local_selector)`; the interior artifact stores one shared Environment per
  DID and no separate CellStruct map.
- Resolved before implementation: topology preserves directed records. Raw target selectors always
  survive; a resolved target-portal reference is optional because retail data contains out-of-range
  and nonreciprocal cross-links.

### Phase 6: Replace Prepared Env-Cell Assets with a Canonical Interior System

#### Deliverables

- Add `ContentAssetService::resolve_interior_system(&LandblockAsset)`.
- Load and deduplicate the complete EnvCell/Environment fanout, including Environment-owned
  CellStructs.
- Build canonical directed env-cell and building-transition topology.
- Delete prepared env-cell geometry, bounds, apertures, static meshes, and BVH support.

#### Task Checklist

- [x] Use `LandblockAsset.env_cell_refs` as the authoritative fanout seed.
- [x] Load every referenced EnvCell with missing and corrupt records distinguished.
- [x] Resolve each Environment DID once and retain it through the shared decoded-record `Arc`.
- [x] Store cells separately from the deduplicated Environment map; keep CellStructs embedded in
      their Environment and reference them by local selector.
- [x] Preserve authored cell placement, surfaces, visible-cell references, flags, restrictions,
      portals, and indoor static DIDs/placements.
- [x] Preserve every EnvCell portal as one stable directed topology record.
- [x] Represent outside explicitly and optionally associate it with the unique matching LBI
      building portal; do not require every outside portal to have a building claim.
- [x] Resolve internal target cells strictly: a missing target cell is an interior-system error.
- [x] Resolve `other_portal_id` opportunistically into a target portal reference while preserving
      the raw selector when it is out of range or nonreciprocal.
- [x] Do not collapse reciprocal portal records into one undirected edge or synthesize missing
      back-links.
- [x] Preserve source references needed for later aperture enrichment:
  - building source DID and portal index;
  - env-cell ID, Environment DID, local CellStruct selector, polygon ID, and portal index.
- [x] Require LBI building portal targets to resolve to existing outside EnvCell portals; preserve
      unclaimed outside EnvCell portals as exterior transitions.
- [x] Do not load building GfxObjs merely to build topology.
- [x] Do not triangulate CellStruct polygons or derive aperture points/planes.
- [x] Do not expand indoor static DIDs into GfxObj/SetupModel presentation records.
- [x] Delete `PreparedInteriorCell`, `PreparedPortalAperture`, env-cell prepared static meshes,
      landblock render bounds, `PreparedBvh`, and all related builders/tests/exports.
- [x] Delete `inspect_landblock_env_cell_bvh`.
- [x] Rewrite `inspect_landblock_building_portals` over canonical topology if it still answers an
      active reverse-engineering question; otherwise delete it.

#### Acceptance Criteria

- Interior resolution reuses the caller's cached foundation and does not reload or rederive
  LandblockInfo facts.
- Shared Environment data and its embedded CellStructs are not cloned per env cell.
- The result contains complete canonical topology and source geometry references but no
  renderer-prepared geometry or spatial structure.
- The result contains no durable source-resolution diagnostics.
- The active 3D client remains behaviorally unchanged because env-cell materialization is not yet
  active.
- The result is a suitable source boundary for the next env-cell implementation plan.

#### Decisions and Course Corrections

- Resolved before implementation: the target is a directed authored portal graph with optional
  validated cross-links, not a normalized reciprocal graph.
- Do not add a completed interior-product cache initially. The result may be large, the frontend
  has no active consumer yet, and decoded EnvCells/Environments already have bounded caches. Add
  one only after materialization exists and measurements show topology rebuild cost justifies
  retaining another complete graph.

### Phase 7: Delete the Old APIs and Close the Boundary

#### Deliverables

- Remove obsolete filtered outdoor, prepared static, and prepared env-cell APIs.
- Remove dead helpers, exports, caches, tests, dependencies, and misleading architecture language.
- Verify the final content/Tauri/browser ownership boundary.

#### Task Checklist

- [x] Delete `LandblockOutdoorAssetRequest`, `LandblockOutdoorAsset`,
      `LandblockOutdoorStaticMember`, and the exact-request outdoor cache.
- [x] Delete outdoor `PreparedStaticInstance`, `PreparedStaticMesh`, instance-bounds, and prepared
      building-transition aperture paths after all remaining env consumers are gone.
- [x] Delete shared `build_gfx_obj_render_geometry` and renderer-facing polygon preparation types.
- [x] Remove `legacy_sampler_material_variant_signature` from content if no canonical consumer
      remains.
- [x] Remove speculative `ContentAssetRequest::EnvCell`/`ContentAsset::EnvCell` in favor of the
      interior-system resolution.
- [x] Delete `PreparedContentSourceDiagnostics`, `StaticOutdoorSceneDiagnostics`, layer-source
      attempt/status ledgers, and diagnostic-only exports once active consumers use explicit load
      outcomes and errors.
- [x] Delete candidate-count and rejection-count fields from generated runtime outputs; keep any
      temporary investigation counters local to logs, tests, or harnesses.
- [x] Update `crates/holtburger-content/ARCHITECTURE.md`.
- [x] Update app-local architecture docs and historical plan references only where they claim a
      current ownership model.
- [x] Delete or rewrite render-oriented debug harnesses rather than preserving shared renderer
      APIs for them.
- [x] Use `rg` to prove that old types and ownership language have no non-historical consumers.
- [x] Run formatters, focused tests, full workspace tests, TypeScript tests/checks, dead-code lint,
      and clippy with warnings denied.
- [x] Run temporary one-shot HBA comparisons for the foundation, generated population, terrain,
      buildings, explicit objects, and generated presentation; remove temporary instrumentation.
- [x] Inspect the final diff for compatibility aliases, duplicated derivation helpers, implicit
      fallbacks, and cache entries that clone heavy products.

#### Acceptance Criteria

- `holtburger-content` exposes one complete shallow landblock foundation and two explicit deep
  canonical resolutions.
- No selection filter remains on the shallow foundation.
- No content result exposes render triangles, presentation bounds, aperture meshes, or BVHs.
- No successful content result exposes a durable diagnostic or source-attempt ledger.
- Tauri is the only landblock layer-bundle and presentation-closure owner.
- Browser runtime policy remains browser-owned.
- Architecture documentation matches code.
- All required verification passes, with environment-only limitations documented precisely.

#### Decisions and Course Corrections

- Record any intentionally retained `Prepared*` name and its demonstrated non-render meaning;
  otherwise rename or delete it.

## Risks and Mitigations

### The complete shallow foundation becomes accidentally expensive

It is easy for a convenience field to trigger referenced source resolution and quietly make wide
terrain/building loads expensive.

Mitigation:

- assert through instrumented synthetic sources that foundation assembly reads only CellLandblock,
  LandblockInfo, and the already-pinned active region;
- keep GfxObj, SetupModel, Scene, EnvCell, and Environment reads in explicit resolvers;
- review every new foundation field for dependency fanout; and
- use test-local repository counters to assert read counts rather than exposing them in artifacts or
  relying on timing.

### Ambient region ownership becomes overly strict

Requiring the active RegionDesc too early could accidentally make unrelated content unavailable
when the descriptor or optional generated-scenery tables are absent.

Mitigation:

- construct the service without reading RegionDesc and fail only the region-scoped operation that
  requires a missing or corrupt descriptor;
- validate `terrain_info` and `scene_info` when generated scenery actually consumes them;
- allow shallow terrain, building, and explicit-object resolution to operate with the region
  sections they require; and
- serve Tauri's active-region response from the exact same `Arc<ActiveRegionData>`.

### Foundation caching duplicates large values

Returning owned clones would erase the benefit of sharing derivation across Tauri, generated
scenery, and interiors.

Mitigation:

- cache and return immutable `Arc<LandblockAsset>`;
- avoid embedding the foundation again inside generated/interior outputs;
- share decoded records through `Arc` rather than cloning cache hits;
- deduplicate interior Environments while retaining their embedded CellStruct ownership;
- do not initially cache completed generated/interior products; and
- review cache capacity against value size rather than copying the previous exact-request policy
  blindly.

### Generated population drifts from retail

The current implementation already appears to differ in scale ordering and may approximate
`obj_within_block` with different source geometry.

Mitigation:

- make retail decompile order and predicate semantics an explicit Phase 2 gate;
- treat ACViewer as readable corroboration;
- implement the proven direct-GfxObj simple-setup and SetupModel predicates rather than a generic
  geometry envelope;
- add synthetic boundary cases for sorting spheres, cylinder spheres, rotations, and scale; and
- compare temporary live populations before accepting the cutover.

### Portal topology loses aperture-source correspondence

Removing prepared apertures could discard the indices Tauri later needs to recover building and
CellStruct polygons.

Mitigation:

- retain source DID, portal index, polygon ID, Environment DID, local CellStruct selector, raw
  target selectors, endpoint identity, and authored flags in topology records;
- test valid reciprocal links, out-of-range target portal selectors, nonreciprocal links, unclaimed
  outside portals, and building-enriched outside portals;
- resolve missing internal target cells and invalid building claims as errors while retaining
  authored EnvCell cross-link imperfections; and
- do not collapse distinct directed portal records merely because they refer to one another or
  their derived point sets coincide.

### Tauri geometry behavior drifts during ownership movement

Shared content triangulation contains accumulated decisions about BSP filtering, visual sides,
winding, normals, UVs, sampler variants, and malformed polygons.

Mitigation:

- move focused tests with the implementation;
- compare temporary live geometry and serialized bytes;
- separate ownership movement from semantic cleanup; and
- require authoritative evidence for any changed branch.

### The API becomes a stateful lazy mega-object

Trying to hide generated/interior fanout behind mutable lazy fields would complicate ownership,
failure, cache, and concurrency semantics.

Mitigation:

- keep `LandblockAsset`, `GeneratedSceneryAsset`, and `LandblockInteriorSystemAsset` immutable;
- expose explicit resolver calls over the foundation;
- let the core async service own single-flight convenience requests; and
- avoid futures, callbacks, repository handles, or interior mutability inside asset values.

### Removing diagnostics hides useful failures

The current ledgers mingle legitimate availability, authored uncertainty, counters, and actual
failures. Deleting them without classifying those states could turn visible problems into implicit
fallbacks.

Mitigation:

- give absent top-level landblocks an explicit load outcome;
- return contextual errors for required missing, corrupt, or internally inconsistent inputs;
- model legitimate outside/unknown states and unresolved authored portal cross-links in domain
  values;
- keep reverse-engineering counters and traces local to the harness or test that requested them;
  and
- do not add a generic diagnostics observer until a concrete runtime consumer requires one.

## Definition of Done

- [x] `LandblockAsset` is a complete, filter-free, shallow foundation derived once from
      CellLandblock, LandblockInfo, and active-region facts.
- [x] The foundation contains canonical terrain, explicit objects, buildings, env-cell references,
      and restrictions without redundant region provenance or diagnostic ledgers.
- [x] `ContentAssetService` lazily pins one `Arc<ActiveRegionData>` and uses it for both landblock
      resolution and active-region serialization without blocking region-independent requests.
- [x] Missing optional region scene tables fail generated resolution only; they do not disable the
      shallow foundation.
- [x] A missing source landblock is distinct from decode, assembly, and invariant failures.
- [x] `CellLandblock.has_objects == 0` yields empty LBI-derived sections without an LBI read;
      `has_objects != 0` makes the matching LBI required.
- [x] Foundation assembly loads no referenced GfxObj, SetupModel, Scene, EnvCell, or Environment
      record.
- [x] Decoded-record cache hits share immutable allocations and do not clone Environment/
      CellStruct graphs.
- [x] Generated scenery is an explicit derivation over the shared foundation.
- [x] Generated candidate acceptance matches retail `obj_within_block`, including the pre-scale
      ordering discovered during planning.
- [x] Direct GfxObj and SetupModel candidates use the proven retail construction and boundary
      predicates; the current physics-vertex approximation is deleted.
- [x] Missing/unsupported generated sources skip only their candidate, present corrupt sources fail
      resolution, and constructible sources without boundary data use origin-only containment.
- [x] Interior resolution is an explicit derivation over the shared foundation.
- [x] Interior output stores one shared Environment per DID, retains CellStructs only under their
      Environment, and references them by local selector.
- [x] Interior topology preserves directed authored portal records, raw target selectors, explicit
      outside endpoints, and optional validated cross-links without requiring reciprocity.
- [x] No completed generated/interior product cache exists without measurements justifying its
      retention and rebuild savings.
- [x] Tauri owns GfxObj triangulation, setup source closure, material projection, future aperture
      enrichment, and frontend layer-bundle serialization; the browser owns runtime presentation
      transforms and bounds.
- [x] Terrain height indices are resolved once in content and consumed directly by the frontend.
- [x] Wide terrain/building foundation loads do not trigger generated or interior fanout.
- [x] No filtered `LandblockOutdoorAssetRequest`, prepared outdoor member, prepared env-cell
      artifact, or compatibility alias remains.
- [x] No successful landblock, generated-scenery, or interior-system artifact contains durable
      diagnostics, source-attempt ledgers, or debug counters.
- [x] No debug harness preserves shared renderer architecture.
- [x] `cargo fmt --all -- --check` passes.
- [x] `cargo test -p holtburger-content -p holtburger-core -p holtburger-3d -p
holtburger-debug-harness` passes.
- [x] `cargo clippy --workspace --all-targets --all-features -- -D warnings` passes.
- [x] `npm run test:ts`, `npm run check`, `npm run lint`, and `npm run format:check` pass in
      `apps/holtburger-3d`.
- [x] Temporary live HBA comparisons prove active terrain and outdoor-static parity, with the
      generated retail correction documented separately from structural refactoring.
- [x] No TUI or interactive client is run during verification.
- [x] Content, core, Tauri, and browser architecture documentation matches the final boundary.

## Open Questions

None. The former CellStruct identity, generated construction/boundary, missing-source, portal
cross-link, LandblockInfo presence, and completed-product cache questions were resolved from
retail/ACE code paths and focused local HBA audits. New questions discovered during implementation
must be added here with their required evidence source rather than answered by fallback behavior.
