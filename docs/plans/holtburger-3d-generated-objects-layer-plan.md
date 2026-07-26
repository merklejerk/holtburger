# Holtburger 3D Generated Objects Layer Plan

Status: Final. Evidence preflight, implementation dry run, dynamic-instance-stream steering, archive
census, renderer scheduling audit, and disposable WebGL2 probe completed on 2026-07-26; execution
has not started.

## Context and Boundaries

### Goal

Load cumulative scene LoD Level 3 generated outdoor scenery through the shared landblock source and
outdoor-static realization pipeline, retain an independent `generated` culling and lifecycle
domain, and render eligible generated residents with geometry instancing while preserving correct
camera-dependent transparency and default-animated resident deferral.

### Current State

The shared content pipeline already:

- derives generated scenery deterministically from the active region scene tables, landblock
  terrain cells, authored occupancy, roads, slope rules, and source bounds;
- accepts direct `GfxObj` and setup-backed render sources;
- retains stable generated identities, source DIDs, scene IDs, terrain indices, template indices,
  placements, rotations, uniform scales, bounds, presentations, materials, and texture
  dependencies;
- emits `LandblockSceneLodLayer::OutdoorGeneratedScenery` at cumulative
  `LandblockSceneLodLevel::Level3`;
- partitions generated residents into their own `LandblockSceneLodOutdoorStaticLayer`; and
- builds a generated-layer outdoor BVH independently from buildings and explicit objects.

The 3D application already has:

- `LandblockLayerKind.Generated`, `generatedObjectRadius`, Explorer controls, and scene-interest
  selection for generated scenery;
- a lossless `ResolvedObjectLayerSource` whose kind already admits buildings, explicit objects,
  and generated scenery;
- shared outdoor-static source decoding, resident classification, texture-fact collection, atlas
  claims, failure-atomic realization, resource ownership, and scene publication;
- independent static-object ownership and exact culling groups keyed by typed layer kind;
- `StaticObjectLayerArtifact` support for geometry, instance streams, and baked or instanced draw
  units;
- `InstanceStreamManager` and backend allocation/release support for leased, immutable
  transform/color streams; and
- the cumulative landblock source-batch contract introduced for explicit objects, including
  per-landblock in-flight LoD coordination.

The remaining gaps are architectural rather than content-decoding gaps:

- the host source-batch enum and projection stop at Level 2 explicit objects;
- the batch and outdoor-static record schemas admit only terrain, buildings, and explicit objects;
- `ResolvedOutdoorStaticLayerSource`, `OutdoorStaticLayerKind`, `StandardCommitPipeline`, and
  `GameRuntime` deliberately exclude generated scenery from the activated shared path;
- `CommitBundle` still models generated scenery as a pre-realized `StaticObjectLayerCommit` instead
  of the source commit used by buildings and explicit objects;
- `StaticObjectGeometryJob` and the current worker are baked-geometry-only and admit only buildings
  and explicit objects;
- `StaticObjectBakeDiagnostics` cannot honestly describe an instanced or hybrid artifact;
- the WebGL resource manager uploads instance buffers but exposes no complete draw binding;
- the current `InstanceStreamManager` is generically named but specifically owns immutable,
  installation-keyed, lease-retained static streams and has no update contract;
- no renderer-owned frame instance arena exists for camera-sorted transparency or future dynamic
  populations;
- `RenderWorld` resolves instanced draw units, but `WebGL2Renderer` currently skips every draw unit
  whose kind is not `baked`; and
- renderer diagnostics still use building-specific names even though the draw path is already
  shared by multiple static layers.

### Locked Decisions

1. Generated scenery is a first-class static layer.
   - Its source layer, commit, owner, revision, diagnostics, scene node, culling group, reload, and
     eviction lifecycle remain independent from buildings and explicit objects.
   - Its exact culling group is `LandblockLayerKind.Generated`.
   - No combined `outdoor-static` owner or culling group will be introduced.
2. Source acquisition remains one cumulative assembly per landblock dispatch.
   - Requesting any combination of terrain, buildings, explicit objects, and generated scenery
     computes the maximum required LoD once.
   - A generated request raises that maximum to Level 3.
   - The host projects requested layer records independently from the one cumulative asset.
   - The frontend immediately converts those records into independently current, committed, and
     evictable layers.
   - No debounce, timer, or speculative waiting policy is added.
3. The commit contract remains renderer-strategy-neutral.
   - Generated scenery uses `StaticObjectLayerSourceCommit`, matching buildings and explicit
     objects.
   - The runtime-owned geometry preparer emits reusable geometry, persistent instance cohorts,
     frame-streamed transparent templates, or an explicit baked fallback from the typed layer and
     resolved presentation facts.
   - No `GeneratedInstancedCommit`, instancing flag in the host record, or geometry strategy in the
     source transport will be introduced.
4. Generated static geometry uses instancing by default.
   - Cohorts are formed by identical geometry partition, complete resolved material binding,
     polygon-side policy, sampler policy, render ordering, and non-instance appearance state.
   - Placement, accumulated setup-part transform, uniform generated scale, and supported color
     modulation are per-instance inputs.
   - Cohorts may contain one instance; this plan introduces no arbitrary instance-count threshold.
   - Source DID alone is not a sufficient cohort key.
5. Stream mutability follows instance state and submission order, not material naming alone.
   - Static opaque, alpha-tested, and additive cohorts use persistent immutable instance streams.
   - Static transparent cohorts retain immutable CPU-side instance templates but are copied into a
     renderer-owned frame stream in camera-sorted order for each view.
   - Moving, expiring, or otherwise changing future populations use dynamic streams regardless of
     whether their materials are opaque, additive, or transparent.
   - Unsupported transform or appearance cases fall back explicitly to baking or dynamic
     deferral; they are never silently omitted.
6. Transparent ordering is global before compatible runs are formed.
   - The renderer collects individual transparent instance candidates from every visible static
     layer alongside existing baked transparent ranges.
   - It computes the same camera-relative distance and stable-ID ordering used by the current
     transparent path.
   - It coalesces only adjacent sorted candidates with identical geometry and draw state into one
     instanced run.
   - The renderer never groups non-adjacent equal cohorts across an intervening transparent draw.
   - A fragmented order may approach one draw per instance; geometry reuse and correct blending
     remain more important than an invented batching guarantee.
7. Persistent and frame streams have separate lifecycle owners.
   - Rename the current `InstanceStreamManager` to `StaticInstanceStreamManager`; it retains
     immutable semantic keys, installation/revision leases, publish-once behavior, and owner-driven
     release.
   - Add a renderer-owned `FrameInstanceStreamArena`; it owns reusable capacity, view/frame reset,
     ranged writes, and draw-run offsets without semantic world leases.
   - Both use one low-level backend instance-buffer allocation, update, binding, and release
     contract.
   - Particle/effect systems may later reuse the frame-buffer primitive with their own attribute
     layouts; this plan does not add particle-specific fields to the object instance layout.
8. Instance eligibility and transparent scheduling are shared static-rendering behavior.
   - Buildings, explicit objects, and generated scenery use the same cohort classification,
     transform validation, and transparent submission vocabulary.
   - Generated scenery is the first layer configured to prefer instancing because current evidence
     establishes substantial reuse.
   - No generated-only transparency sorter or generated-only instance artifact is introduced.
9. Default-animated setup residents remain deferred.
   - They retain complete resolved source records in `CommitBundle.dynamicEntities`.
   - This plan does not implement animation playback or dynamic object rendering.
   - Static realization success remains the gate for recording the associated deferred residents.
10. Initial geometry reuse is installation-scoped.

- One generated landblock revision uploads each eligible cohort geometry once and references it
  from an instance stream.
- Cross-landblock or cross-revision geometry leasing is deferred until measured device-memory
  and lifecycle evidence justifies the added ownership complexity.
- The existing reusable-geometry key vocabulary must not be used without a proven collision-free
  semantic identity and corresponding shared lease lifecycle.

11. One scene node per generated landblock layer remains the initial spatial publication.

- The node may contain persistent instanced draws, frame-streamed transparent templates, and
  explicit baked fallbacks.
- Node bounds cover every materialized generated resident.
- Finer clusters or consumption of the prepared outdoor BVH are separate visibility
  optimizations and are not coupled to instancing.

12. Instanced rendering preserves existing object material behavior.

- Fogged opaque and alpha-tested generated draws use the same distance-fog semantics as baked
  buildings and explicit objects.
- Transparent and additive pass behavior remains explicit.
- Atlas page bindings, indexed palettes, clip maps, detail textures, sampler policy, culling,
  stippling, luminosity, and source opacity retain the existing material planner as their single
  authority.

13. Diagnostics describe facts, not implementation nostalgia.
    - Bake-only type and field names are replaced with strategy-neutral geometry-preparation
      diagnostics.
    - Baked bytes/ranges, persistent instance resources, immutable transparent templates, frame
      upload bytes, sorted run counts, and submitted instance counts remain separately measurable.
    - Existing building-specific renderer metric names are cleanly replaced.
    - No durable failure record is introduced. Current failures are reported through the existing
      runtime error/logging path and normal interest changes may retry them.
14. Transport changes are a clean cutover.
    - The binary batch and outdoor-static record versions are incremented when generated becomes an
      admitted wire value.
    - Host, HTTP harness, Tauri adapter, decoder, fixtures, and tests move together.
    - No dual-version decoder or compatibility alias is retained.

### In Scope

- `LandblockSceneLodLayer::OutdoorGeneratedScenery` from cumulative Level 3 content.
- Direct `GfxObj` and setup-backed generated sources.
- Generated scenery projection through the existing batched host boundary.
- A clean source-commit cutover for `LandblockLayerKind.Generated`.
- Generic WebGL2 instance-buffer binding and `drawElementsInstanced` submission.
- Instanced object shader variants with per-instance transform and color inputs.
- A shared low-level instance-buffer contract supporting immutable publication and ranged dynamic
  updates.
- A renamed `StaticInstanceStreamManager` for persistent layer-owned cohorts.
- A renderer-owned `FrameInstanceStreamArena` for per-view transparent ordering and future dynamic
  instance producers.
- Shared static geometry preparation that emits persistent cohorts, immutable transparent instance
  templates, and explicit baked fallbacks.
- One per-view transparent ordering-policy pass across baked ranges and streamed instances,
  followed by adjacent compatible-run coalescing.
- Shared material-partition and setup-hierarchy preparation used by both baked and instanced paths.
- Honest geometry, instance, draw, and layer diagnostics.
- Exact independent `generated` ownership and culling.
- Existing generated Explorer radius activation.
- Browser-harness controls, lifecycle checks, screenshots, and frame/resource diagnostics.
- Temporary live-archive evidence collection through noninteractive debug and browser harnesses.

### Out of Scope

- Dynamic-object rendering, animation playback, physics, collision, interaction, picking, or
  selection.
- Server-authored runtime objects.
- Level 4 environment-cell activation or portal rendering changes.
- Cross-landblock/cross-revision reusable geometry caches.
- GPU-driven culling, indirect drawing, multi-draw extensions, instance-level occlusion, or
  consumption of the generated outdoor BVH.
- Order-independent transparency, GPU transparent sorting, or persistent transparent streams whose
  contents are reordered in place.
- Particle/effect simulation, billboard policy, lifetime management, or particle-specific instance
  layouts; only the reusable frame-buffer primitive is in scope.
- A configurable instancing threshold or speculative adaptive strategy.
- Reworking the authoritative generated-scenery derivation unless evidence reveals a concrete
  parity defect.
- Permanent tests that require the untracked `dats/assets.hba` archive.
- A broad `src-tauri/src/lib.rs` refactor unrelated to the generated source projection.

## Ground Truth and Existing Precedent

### Authoritative Generated-Scenery Sources

- `ACViewer/ACE/Source/ACE.Server/Physics/Common/Landblock.cs`
  - `get_land_scenes`
  - scene selection, frequency rejection, displacement, rotation, scale, and object construction
- `ACViewer/ACE/Source/ACE.DatLoader/FileTypes/Scene.cs`
  - `Scene.Objects`
- `ACViewer/ACE/Source/ACE.DatLoader/Entity/ObjectDesc.cs`
  - scene-object frequency, displacement, alignment, rotation, scale, and source DID fields
- `ACViewer/ACViewer/Render/R_Landblock.cs`
  - the distinct generated `Scenery` population
- `crates/holtburger-content/src/static_outdoor_scene.rs`
  - `derive_generated_scenery`
  - `select_generated_scene_id`
  - generated frequency, displacement, road, occupancy, slope, overlap, scale, alignment, and
    bounds rules
- `crates/holtburger-content/src/landblock_scene_assets.rs`
  - `LandblockSceneLodLevel::Level3`
  - `LandblockSceneLodLayer::OutdoorGeneratedScenery`
  - `LandblockSceneLodOutdoorStaticLayer`
  - `LandblockGeneratedSceneryFacts`
  - `PreparedStaticInstanceKind::GeneratedScenery`
- `crates/holtburger-core/src/content_assets.rs`
  - cumulative LoD loading and per-landblock in-flight coordination
- `acclient-eor-source/`
  - authoritative fallback when ACE and ACViewer do not establish generated placement or
    presentation behavior

No generated placement, transform, appearance, or material rule may be inferred from a convenient
asset sample when the corresponding reference implementation can be inspected.

### Current Application Precedent

- `apps/holtburger-3d/src-tauri/src/landblock_source_batch.rs`
  - requested-layer set, maximum-LoD selection, and record projection
- `apps/holtburger-3d/src-tauri/src/outdoor_static_source.rs`
  - shared object-definition closure and outdoor-static binary record
- `apps/holtburger-3d/src/lib/assets/decode-landblock-source-batch.ts`
  - exact requested/returned layer-set validation
- `apps/holtburger-3d/src/lib/assets/decode-outdoor-static-record.ts`
  - closed source decoding and static/dynamic classification
- `apps/holtburger-3d/src/lib/game/commit/pipeline.ts`
  - grouped per-landblock acquisition and independent source commits
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts`
  - closed baked-geometry preparation, material partitioning, setup-part transforms, bounds, and
    transparent range isolation
- `apps/holtburger-3d/src/lib/game/commit/static-object-artifact.ts`
  - artifact validation and one-node layer assembly
- `apps/holtburger-3d/src/lib/game/runtime/static-layer-realizer.ts`
  - currentness checks, atlas sequencing, failure atomicity, and publication
- `apps/holtburger-3d/src/lib/game/systems/static-object-system.ts`
  - geometry/instance-stream ownership and scene replacement
- `apps/holtburger-3d/src/lib/game/systems/instance-stream-manager.ts`
  - immutable semantic keys, lease-retained static stream publication, and owner-driven release
- `apps/holtburger-3d/src/lib/game/systems/static-resources.ts`
  - installation-scoped resource keys and `StaticInstanceData`
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
  - resolved baked/instanced draw-unit resources
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
  - instance-buffer upload and destruction
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts`
  - current object material and fog shader contracts
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - object pass ordering, transparent sorting, material binding, and baked submission
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
  - outdoor-static realization, diagnostics, deferral, and owner lifecycle
- `apps/holtburger-3d/src/lib/game/runtime/scene-interest.ts`
  - exact layer identities and generated interest selection
- `apps/holtburger-3d/scripts/terrain-browser-harness.mjs`
  - noninteractive source host, headless WebGL browser acceptance, lifecycle, metrics, and
    screenshots

### Evidence Preflight: 2026-07-26

The current `dats/assets.hba` archive was inspected with:

```text
cargo run -q -p holtburger-debug-harness \
  --bin inspect_landblock_outdoor_statics -- \
  0C78FFFF 95D6FFFF B997FFFF 376AFFFF 33DAFFFF
```

Representative Level 3 populations were:

| Landblock    | Explicit | Buildings | Generated |
| ------------ | -------: | --------: | --------: |
| `0x0C78FFFF` |       37 |         0 |        12 |
| `0x95D6FFFF` |       71 |         8 |       218 |
| `0xB997FFFF` |       15 |         0 |       227 |
| `0x376AFFFF` |       76 |        10 |         0 |
| `0x33DAFFFF` |       42 |         0 |       123 |

A source-frequency pass over `0x95D6FFFF`, `0xB997FFFF`, and `0x33DAFFFF` found:

- 568 generated residents;
- 29 source DIDs;
- only two source DIDs used once;
- a largest source cohort of 98 residents; and
- a second source cohort of 92 residents.

This establishes substantial repeated source usage without pretending source DID is the final draw
cohort. Setup parts, selected presentation, complete material binding, polygon-side expansion, and
ordering may split each source population into several correct instance cohorts.

The same probe reported no content assembly errors or omissions for the selected landblocks.
`0x376AFFFF` is a useful valid-empty generated-layer acceptance case.

The code audit also established:

- instance streams already carry a 4x4 source-to-landblock transform and RGBA color;
- `StaticObjectSystem` reserves, publishes, and releases instance streams transactionally;
- `RenderWorld` resolves instance stream resources for instanced draw units;
- `WebGL2ResourceManager` uploads 20 floats per instance but does not expose a binding/count getter;
- `WebGL2Renderer.#collectScene` explicitly skips non-baked draw units; and
- current transparent sorting requires one stable baked range center per resident/material binding,
  while `InstancedStaticDrawUnit.transparentSort` is intentionally `null`.
- the current `InstanceStreamManager` is a static manager in behavior: it accepts only
  `StaticInstanceStreamKey`, publishes each leased source once, exposes no update operation, and
  releases resources when their semantic owners disappear; and
- WebGL2 has no base-instance draw in this path, so frame-streamed transparent runs must select
  their instance range through attribute offsets into a shared frame buffer.

The initial source-frequency probe did not establish final render cohorts, material ordering, or
default-animation counts. The finalization census below closes those planning questions; Phase 1
still verifies the worker's fully resolved output against the recorded estimates.

### Finalization Evidence: 2026-07-26

#### Generated Source and Material Census

A temporary extension of the existing building-layer evidence harness pointed the same content
assembler, source closure, setup-model decoder, GfxObj render-geometry builder, and material
classifier at the Level 3 generated layer. The temporary code was removed after recording these
facts.

The active region's complete generated scene catalogue contains:

- 131 scene files;
- 167 non-weenie render sources across their templates;
- 9 direct GfxObj sources and 158 setup-model sources;
- 235 distinct GfxObjs after expanding setup parts;
- 7 setup sources with default animations, all of which remain deferred;
- used source material slots comprising 168 opaque, 146 alpha-test, and 6 transparent slots;
- no generated additive material slot in the current archive;
- DXT1, DXT5, and Index16 source formats; and
- no source-closure errors.

The absence of a live generated additive witness does not change the shared renderer contract.
Additive persistent instancing remains covered by a synthetic fixture because the existing object
renderer already treats additive ordering independently from camera-sorted transparency.

An actual direct-Gfx generated witness was found after scanning 6,050 outdoor landblocks:

- landblock `0x17B8FFFF`;
- source GfxObj `0x01000A6F`;
- scene `0x120002A4`;
- an opaque indexed material using a 64x128 Index16 render surface; and
- 24 expanded render triangles.

This joins the dense setup-backed and valid-empty witnesses already selected below.

#### Candidate Cohorts and Byte Model

The finalization census grouped current base-appearance render contributions by GfxObj geometry and
used material slot. Placement, uniform resident scale, accumulated setup-part transform, and color
remain per-instance values. The byte model uses the current worker's deindexed
position/normal/UV/U32-index output (108 bytes per triangle), the existing 20-float persistent
instance record (80 bytes), and a fixed transparent template payload of transform, color, and sort
center (92 bytes, excluding variable JavaScript object/string overhead).

| Landblock    | Static / deferred residents | Persistent / transparent cohorts | Persistent instances / transparent templates | Naive baked bytes | Unique geometry + persistent stream + fixed templates |
| ------------ | --------------------------: | -------------------------------: | -------------------------------------------: | ----------------: | ----------------------------------------------------: |
| `0x95D6FFFF` |                     210 / 8 |                            6 / 1 |                                    598 / 240 |         8,716,896 |                                               175,112 |
| `0xB997FFFF` |                    204 / 23 |                           54 / 1 |                                    805 / 120 |         4,805,460 |                                               520,724 |
| `0x33DAFFFF` |                     123 / 0 |                            9 / 0 |                                      539 / 0 |         2,854,872 |                                                93,232 |
| `0x0C78FFFF` |                      11 / 1 |                           17 / 0 |                                       31 / 0 |           448,200 |                                               262,328 |
| `0x376AFFFF` |                       0 / 0 |                            0 / 0 |                                        0 / 0 |                 0 |                                                     0 |

These are planning estimates, not promised runtime memory totals: final resolved appearance and
polygon-side expansion remain the implementation authority, while JavaScript object overhead and
the shared frame arena are reported separately. The estimates nevertheless prove that cohort
splitting does not erase the expected benefit in the dense witnesses and that the low-reuse sample
still does not require a special instance-count threshold.

`0x95D6FFFF` and `0xB997FFFF` both contain real transparent generated contributions and
default-animated deferrals. `0x33DAFFFF` supplies a dense persistent-only witness,
`0x17B8FFFF` supplies the direct-Gfx witness, and `0x376AFFFF` remains the valid-empty witness.

#### Renderer Scheduling Audit

`WebGL2Renderer.drawFrame` currently processes each `FrameInput.views` entry by preparing and drawing
that view before preparing the next. Transparent baked ranges are collected per view and passed
through the retail-derived `sortTransparentStaticRanges` policy:

- ranges inside the 16-unit sort radius are ordered far-to-near with stable-ID ties;
- far ranges retain deterministic source order; and
- a near/far boundary crossing retains source order.

Frame-streamed candidates must enter this same sequence rather than replacing it with an
unconditional global distance sort. The sequential view loop permits one renderer-owned arena to
orphan, upload, and draw at each view boundary before its storage is replaced for the next view.
Portal crossings currently resolve aperture contributions but do not create an additional hidden
view lifecycle.

#### Disposable WebGL2 Buffer Probe

A temporary headless-Chrome WebGL2 page exercised the chosen frame-arena update shape:

1. one instance buffer object with capacity for four 20-float records;
2. `bufferData(capacityBytes, STREAM_DRAW)` once at each view boundary to orphan the backing store;
3. one `bufferSubData` upload containing the view's complete ordered instance sequence;
4. matrix/color attribute offsets selecting individual contiguous runs; and
5. `drawArraysInstanced` standing in for the planned indexed object draw.

Across 131 view-style orphan/upload/draw cycles:

- exactly one buffer object was used;
- red-then-blue alpha blending produced `[64, 0, 128]`;
- blue-then-red produced `[128, 0, 64]`, proving submitted instance order affected blending;
- an offset selecting only the second blue record produced `[0, 0, 128]`; and
- `gl.getError()` remained `NO_ERROR`.

This resolves the initial arena strategy: capacity grows geometrically only when required; each
sequential view orphans the current-capacity backing store, uploads its ordered instances once, and
addresses compatible runs through attribute offsets. Implementation diagnostics still measure
capacity growth and upload behavior, but Phase 1 no longer contains an architectural choice among
orphaning, rotation, and frame segmentation.

### Steering Decision: Dynamic Transparent Submission

The initial 2026-07-26 draft retained transparent generated contributions as baked per-resident
ranges because the current immutable instance-stream contract cannot change camera-dependent order.
Tech-lead review rejected baking as the default solution and established a reusable dynamic stream
primitive as part of this plan.

The steered design:

- keeps non-transparent static cohorts in leased, immutable static instance streams;
- retains transparent transforms and sort facts as immutable CPU-side scene data;
- combines transparent instances with existing baked transparent ranges and applies the current
  ordering policy once for every view;
- uploads only the ordered transparent instance sequence into a renderer-owned frame arena;
- forms instanced draws only from adjacent compatible candidates in that sorted sequence;
- renames the current manager to `StaticInstanceStreamManager` instead of weakening its lifecycle
  contract; and
- shares low-level instance-buffer mechanics with the frame arena so future particles/effects can
  reuse the primitive without importing static world ownership.

This supersedes the baked-transparent fallback from the initial draft. Baking remains an explicit
fallback only for presentation or transform cases that cannot satisfy the instance contract.

## North Stars

1. **One source pipeline, independent runtime layers.** Level 3 extends cumulative acquisition and
   record projection without merging generated ownership with lower-detail layers.
2. **Source commits carry facts, not draw policy.** Host and commit contracts remain unaware of
   baking, instancing, GPU buffers, atlas pages, and renderer capabilities.
3. **Instance only identical draw contracts.** Cohort identity is derived from consumed geometry,
   material, polygon, sampler, ordering, and appearance facts rather than convenient provenance.
4. **Correct ordering precedes batching.** All transparent candidates enter one view-ordering policy
   pass first; only adjacent compatible candidates become one frame-streamed instanced run.
5. **Closed geometry preparation.** Workers receive all hierarchy, geometry, material, placement,
   and texture facts up front and never callback into runtime or device state.
6. **Transform math has one authority.** Accumulated setup-part transforms, resident scale, bounds,
   and material-side partitioning are shared primitives rather than parallel baked/instanced
   implementations.
7. **Lifetimes stay honest.** Persistent static streams participate in revision publication and
   rollback; renderer-owned frame buffers reuse capacity without pretending to be world resources.
8. **Typed spatial ownership.** Generated scenery is always identifiable as `generated` without
   parsing owner IDs, resource keys, source asset IDs, or diagnostic strings.
9. **Diagnostics remain observational.** They expose actual resource and submission facts without
   driving cohort design or creating durable failure state.
10. **No vestiges.** Bake-only, building-only, and generated-special-case contracts are deleted as
    their shared replacements land.

## Phased Implementation

### Phase 1: Refresh Evidence and Build Persistent/Frame Instance Submission

#### Deliverables

- Treat the recorded finalization census as the baseline; refresh it through a temporary or
  debug-harness diagnostic only if the archive or source-resolution behavior changes before
  execution. The evidence covers:
  - resolved static and default-animated resident counts;
  - direct versus setup-backed sources;
  - setup part counts;
  - complete material ordering counts;
  - source DID reuse and final candidate cohort counts; and
  - naive baked geometry bytes versus unique candidate cohort geometry bytes.
- Keep archive-dependent evidence out of permanent unit tests.
- Refactor the renderer resource boundary around one low-level instance-buffer primitive with:
  - explicit attribute layout and stride;
  - capacity and populated instance count;
  - persistent versus frame-dynamic usage intent;
  - initial upload and ranged update operations;
  - a complete read-only draw binding; and
  - deterministic release.
- Rename the existing `InstanceStreamManager` to `StaticInstanceStreamManager` without weakening
  its semantic-key, lease, publish-once, or owner-release contract.
- Add a renderer-owned `FrameInstanceStreamArena` that:
  - grows capacity geometrically only when the ordered view population exceeds it;
  - resets allocation state per rendered view;
  - accepts ordered instance records and returns buffer offsets/counts for contiguous runs;
  - orphans the current-capacity backing store once per sequential view with
    `bufferData(..., STREAM_DRAW)`;
  - uploads the complete ordered view sequence with one `bufferSubData`;
  - selects runs through instance-attribute offsets because WebGL2 exposes no base-instance draw;
    and
  - owns no scene owner IDs, revision leases, or persistent logical resource keys.
- Implement an instanced object-program variant:
  - matrix columns at fixed vertex attribute locations;
  - RGBA instance color at a fixed location;
  - divisors of one for all instance attributes;
  - the same landblock anchor, object material, atlas, detail, and fog semantics as baked objects;
  - no active `uLocalToLandblock` uniform in the instanced variant; and
  - explicit multiplication of per-instance color with the resolved material color.
- Extend renderer frame inputs and submission so persistent `InstancedStaticDrawUnit` values reach
  `drawElementsInstanced`.
- Configure every instance attribute and divisor for every instanced draw; do not rely on stale VAO
  state from a prior cohort.
- Add a synthetic renderer-owned transparent candidate path that:
  - globally stable-sorts individual candidates by the current camera-distance/stable-ID contract;
  - partitions the sorted sequence only into adjacent runs with identical draw state;
  - uploads those runs through the frame arena; and
  - selects each run through explicit attribute offsets before `drawElementsInstanced`.
- Add focused shader/source tests and renderer-world/resource tests that prove:
  - baked and instanced variants retain their distinct transform inputs;
  - persistent instance count is preserved from upload through resolved draw input;
  - opaque, alpha-test, and additive persistent units reach their correct passes;
  - frame-arena capacity is reused across views/frames;
  - sorted transparent candidates from different cohorts split and rejoin only as adjacent runs;
    and
  - attribute offsets select the correct frame-stream run without stale VAO state.
- Add synthetic browser-harness fixtures for:
  - at least two visibly separated persistent instances sharing one geometry and stream; and
  - interleaved transparent instances from two cohorts whose correct order changes with the camera.

#### Acceptance Criteria

- A synthetic instanced artifact renders multiple transforms from one geometry allocation and one
  immutable instance stream.
- Synthetic transparent instances remain globally ordered as the camera moves and are submitted
  through renderer-owned frame-stream runs.
- The browser harness reports no console, shader compilation, WebGL, or runtime errors.
- Distance fog affects opaque/alpha-tested synthetic instances identically to baked objects.
- Additive instances use the existing blended pass and blend policy.
- No instanced draw unit is silently skipped.
- The frame arena reuses bounded capacity and does not allocate one backend resource per transparent
  run or frame.
- No generated source/transport activation is required for this phase.

#### Task Checklist

- [x] Refresh the selected-landblock generated census and record results in this plan.
- [x] Decide the immutable candidate cohort identity from consumed resolved facts.
- [ ] Define the shared low-level buffer layout, capacity, update, binding, and release contract.
- [ ] Rename and preserve the static manager lifecycle.
- [ ] Implement the renderer-owned frame arena and per-view reset.
- [ ] Implement baked and instanced object vertex-program variants without nullable uniforms.
- [ ] Bind matrix/color attributes and divisors deterministically.
- [ ] Submit persistent and frame-streamed draws with validated index, offset, and instance counts.
- [ ] Add persistent and camera-reordered transparent synthetic fixtures and focused tests.
- [ ] Remove any temporary archive-dependent test or instrumentation not suitable for the harness.

#### Decisions and Course Corrections

- None yet.

### Phase 2: Replace the Bake-Only Worker with Shared Instance Cohort Preparation

#### Deliverables

- Extract shared stateless preparation primitives from
  `static-object-geometry-worker.ts` for:
  - accumulated setup-part transforms in parent-before-child order;
  - resident root transform and scale composition;
  - complete material planning and polygon-side expansion;
  - triangle/material partition identity;
  - transformed and untransformed bounds; and
  - deterministic ordering of partitions and residents.
- Keep matrix, point, normal, and bounds operations in existing math/geometry helpers; add shared
  helpers only when they represent reusable primitives.
- Replace `StaticObjectGeometryJob` with a geometry-preparation job that admits the complete
  `OutdoorStaticLayerKind`, including generated scenery.
- Preserve the existing baked path for buildings and explicit objects during their initial rollout
  policy, plus explicit fallback cases for any static layer.
- Add a generated instance-preferred path that:
  - groups eligible source-local geometry partitions by their complete draw contract;
  - emits installation-scoped geometry once per partition;
  - emits a persistent immutable instance stream for opaque, alpha-tested, and additive cohorts,
    containing each member's accumulated
    source-to-landblock transform and color;
  - permits several material draw units to reference one stream when their geometry shares the
    exact same per-instance transform cohort;
  - emits immutable CPU-side transparent instance templates containing transform, color,
    source-local sort center, stable ID, geometry, and complete draw state;
  - retains those transparent templates with the static scene contribution for renderer-owned
    per-view scheduling; and
  - computes one union bound for the generated layer node from persistent, frame-streamed, and
    explicitly baked contributions.
- Treat a transform as instance-eligible only when the shader's normal/position transform contract
  is correct. Generated uniform scale is eligible; unexpected non-finite, singular, or unsupported
  transforms fail loudly or take an explicit baked fallback.
- Do not add a cohort-size threshold.
- Replace `StaticObjectBakeDiagnostics` with strategy-neutral geometry diagnostics that separately
  expose:
  - source resident, part, material-slot, and range counts;
  - materialized and deferred resident counts;
  - explicit baked fallback range counts;
  - baked geometry bytes;
  - persistent cohort, stream, draw-unit, instance, geometry-byte, and stream-byte counts;
  - transparent template cohort, instance, and retained CPU-byte counts;
  - total geometry-worker duration; and
  - the observed output mix without treating renderer frame uploads as static preparation bytes.
- Update artifact assembly to validate texture requirements across baked fallbacks, persistent
  instance draws, and frame-streamed transparent templates.
- Update `StaticObjectSystem`, diagnostics, tests, and fixtures through a clean type-name cutover.
- Preserve empty-layer success: a source with no static residents returns no static artifact while
  still allowing its layer commit and deferred-resident facts to complete normally.

#### Acceptance Criteria

- Existing building and explicit-object visual and lifecycle behavior remains unchanged through the
  shared preparation API.
- A synthetic generated population with repeated opaque source partitions emits one geometry
  allocation per partition and one instance stream per exact cohort, not transformed geometry per
  resident.
- A mixed synthetic generated population emits persistent opaque/alpha-test/additive streams and
  immutable transparent frame templates in one `StaticObjectLayerArtifact`.
- Setup-backed residents apply accumulated parent/part transforms exactly once.
- All draw-unit texture keys are represented in the artifact's logical texture requirements.
- Diagnostics account for every materialized resident and every emitted byte without overloading
  bake terminology.
- Geometry preparation remains closed and free of runtime, atlas, or WebGL callbacks.

#### Task Checklist

- [ ] Extract shared hierarchy, transform, partition, and bounds primitives.
- [ ] Define the complete semantic cohort key.
- [ ] Implement source-local geometry partition emission.
- [ ] Implement immutable transform/color cohort streams.
- [ ] Implement CPU-retained transparent instance templates with stable sort facts.
- [ ] Assemble and validate persistent/frame-streamed/fallback artifacts.
- [ ] Cut over bake-only diagnostics and all consumers.
- [ ] Re-run building and explicit-object focused tests and browser witnesses.

#### Decisions and Course Corrections

- None yet.

### Phase 3: Extend the Batched Host Boundary through Level 3

#### Deliverables

- Add `Generated` to the app-local Rust and TypeScript `LandblockSourceLayer` contracts.
- Map `Generated` to `LandblockSceneLodLevel::Level3`.
- Extend `LandblockSourceBatch` projection with an independently addressable generated layer.
- Serialize `LandblockSceneLodLayer::OutdoorGeneratedScenery` through the shared outdoor-static
  record closure without duplicating definition, geometry, material, or texture serialization.
- Admit `generated` in:
  - source-batch request and manifest schemas;
  - outdoor-static record manifest schemas;
  - Tauri command inputs;
  - HTTP development-host request parsing;
  - frontend batch/source port types; and
  - binary decoding and exact layer-set validation.
- Increment both binary contract versions and update all fixtures and tests in one clean cutover.
- Preserve maximum-LoD batching:
  - `{generated}` assembles Level 3 once and projects generated;
  - `{terrain, generated}` assembles Level 3 once and projects two records;
  - `{terrain, buildings, objects, generated}` assembles Level 3 once and projects four records.
- Preserve the existing per-landblock in-flight coordinator when a higher Level 3 request overlaps
  a lower in-flight request.
- Treat a valid empty generated layer as a present, decodable source record with zero residents,
  not as a missing record.
- Propagate current load/decode failures through the existing error path; do not create durable
  failure artifacts.

#### Acceptance Criteria

- Host tests prove the highest requested LoD is selected once and every requested layer is
  projected exactly once.
- Batch decoders reject missing, duplicate, extra, mismatched-landblock, overlapping, and
  out-of-bounds generated records.
- Generated outdoor-static records preserve resident identity, placement, scale, definition,
  material, geometry, and texture facts.
- A Level 3 batch containing all four outdoor layers does not perform independent Level 0, 1, 2,
  and 3 assemblies.
- `0x376AFFFF` crosses the boundary as a valid empty generated source.
- No generated-specific serializer duplicates the shared outdoor-static closure.

#### Task Checklist

- [ ] Add the Level 3 source-layer enum and maximum-LoD mapping.
- [ ] Project and serialize the generated layer.
- [ ] Bump binary versions and update schemas.
- [ ] Extend Tauri and HTTP source adapters.
- [ ] Extend exact-set and binary-boundary tests.
- [ ] Verify overlapping Level 2/Level 3 in-flight coordination.
- [ ] Measure Level 3 assembly and response bytes for selected evidence landblocks.

#### Decisions and Course Corrections

- None yet.

### Phase 4: Resteer the Activated Shape

Before runtime activation:

- compare measured final cohort counts, geometry bytes, stream bytes, and draw counts against the
  source-DID preflight;
- verify material-ordering evidence still supports persistent opaque/alpha-test/additive streams
  and renderer-owned transparent frame streams;
- dry-run global ordering across frame-streamed generated instances and existing baked transparent
  ranges, including an order that fragments one cohort into multiple runs;
- inspect frame-arena allocation, update, reset, growth, and multi-view reuse for accidental world
  ownership or per-run backend allocation;
- dry-run replacement, staleness, atlas failure, worker failure, publication failure, eviction, and
  reload through a mixed artifact;
- inspect whether the extracted hierarchy/material helpers are genuinely shared primitives rather
  than an abstraction that merely forwards arguments;
- inspect whether any generated-only branch has leaked into transport-neutral commit or atlas
  contracts;
- verify the one-node generated bound remains useful for the selected landblocks; and
- update later phases and this plan's decisions if evidence requires narrower instance eligibility
  or earlier spatial clustering.

#### Acceptance Criteria

- No unresolved ownership, currentness, transparent ordering, transform, or diagnostics ambiguity
  remains before generated interest is enabled.
- The remaining phases can be executed without inventing new host or renderer contracts.
- Any course correction is recorded in this plan before implementation continues.

#### Task Checklist

- [ ] Review Phase 1–3 diffs against the North Stars.
- [ ] Audit private math/geometry helpers and ceremonial provenance.
- [ ] Dry-run failure and lifecycle paths.
- [ ] Refresh risks, acceptance samples, and remaining tasks.

#### Decisions and Course Corrections

- None yet.

### Phase 5: Activate Generated Source Commits and Independent Runtime Residency

#### Deliverables

- Widen or replace `ResolvedOutdoorStaticLayerSource` so the shared activated outdoor-static source
  type includes generated scenery without maintaining a buildings/objects-only alias.
- Export one canonical `isOutdoorStaticLayer` type guard from the layer vocabulary and remove local
  copies in commit and runtime modules.
- Change the generated `CommitBundle` arm from `StaticObjectLayerCommit` to
  `StaticObjectLayerSourceCommit`.
- Admit generated scenery in `StandardCommitPipeline` source batching and typed record projection.
- Route generated source commits through the existing `StaticLayerRealizer`.
- Select generated instance-preferred preparation from the typed layer in the runtime-owned
  geometry preparer.
- Publish generated artifacts through `StaticObjectSystem.replaceObjects` with:
  - a generated-qualified owner and revision;
  - exact `generated` culling group;
  - generated-qualified installation geometry/stream keys;
  - one layer scene node when static content exists; and
  - the existing deferred-dynamic seam after successful static publication.
- Ensure staleness and failure paths withdraw atlas requirements and release unpublished geometry
  and persistent instance streams.
- Ensure replacement releases the superseded generated revision only after the new current revision
  publishes successfully.
- Ensure eviction removes generated diagnostics, scene nodes, geometry, streams, atlas claims, and
  deferred resident facts without disturbing terrain, buildings, or explicit objects.
- Keep the default generated Explorer radius disabled until selected by existing app-local policy.

#### Acceptance Criteria

- Requesting generated interest produces a source commit and current runtime realization.
- Installed generated diagnostics report `layer` and `cullingGroup` as `generated`.
- Generated replacement, stale completion, failure rollback, eviction, and reload are independent
  from buildings and explicit objects in the same landblock.
- No owner/resource identity is parsed to recover the layer kind.
- No generated-specific realization pipeline or atlas path exists.
- Empty generated sources complete without a scene node or false failure.
- Default-animated generated residents appear only in the deferred-dynamic diagnostics.

#### Task Checklist

- [ ] Complete the outdoor-static type and type-guard cutover.
- [ ] Convert generated commits to source commits.
- [ ] Admit generated batches in `StandardCommitPipeline`.
- [ ] Route generated realization and publication.
- [ ] Prove exact culling and owner identity.
- [ ] Add stale/failure/replacement/eviction/reload tests.
- [ ] Prove lower layers remain installed when generated is removed.

#### Decisions and Course Corrections

- None yet.

### Phase 6: Browser Acceptance and Measured Instancing Benefit

#### Deliverables

- Add `--generated-object-radius` to the terrain browser harness.
- Enforce the existing radius policy: generated radius is optional and cannot exceed the building
  radius; it remains independent from the explicit-object radius.
- Expose generated layer diagnostics separately from buildings and explicit objects.
- Replace renderer metrics named `submittedBuilding*` with static-object terminology and add:
  - baked fallback draw/range and triangle counts;
  - persistent instanced draw and submitted-instance counts;
  - transparent candidate, sorted run, frame upload, and submitted-instance counts;
  - frame-arena capacity, growth, and per-view high-water marks;
  - instanced source triangle count;
  - transparent and additive submission counts; and
  - visible static layer/node counts without claiming node count equals resident count.
- Add browser acceptance for:
  - dense generated setup-backed cohorts in `0x95D6FFFF`;
  - a second dense population in `0xB997FFFF`;
  - mixed generated/explicit presentation in `0x33DAFFFF`;
  - direct-Gfx generated source `0x01000A6F` in `0x17B8FFFF`;
  - valid-empty generated content in `0x376AFFFF`;
  - camera movement and distance fog;
  - clear/reload of the same generated neighborhood;
  - relocation to another generated neighborhood; and
  - independent generated-radius disablement while lower layers remain visible.
- Capture screenshots for visual review and report browser/runtime errors as failures.
- Record measured evidence in this plan:
  - source and final cohort counts;
  - resident, static, and deferred counts;
  - naive baked versus instanced geometry bytes;
  - persistent instance-stream and retained transparent-template bytes;
  - per-view transparent frame-upload bytes;
  - persistent draw, transparent run, and submitted-instance counts;
  - texture requirements and atlas pages;
  - source response bytes and realization time; and
  - resource counts before load, after load, after eviction, and after reload.

#### Acceptance Criteria

- Dense generated landblocks visibly render their generated scenery with no browser or runtime
  errors.
- At least one dense witness submits multiple instances from one geometry cohort.
- Measured generated geometry, persistent streams, and retained transparent templates are smaller
  than the diagnostic naive transformed-bake estimate for the same eligible residents.
- Transparent generated instances remain individually camera-sortable and share frame-streamed
  draws whenever adjacent sorted candidates have identical draw state.
- Existing baked transparent ranges and frame-streamed transparent instances preserve one global
  stable order.
- Repeated frames and multiple views reuse arena capacity without one backend allocation per run.
- Fog, indexed textures, palettes, alpha test, additive blending, detail, culling, and sampler
  behavior exercised by generated witnesses match the existing object material paths.
- Generated scene/resource counts return to baseline after eviction and are recreated after reload.
- Buildings and explicit objects remain independently installed and visible when generated interest
  is disabled.

#### Task Checklist

- [ ] Add the generated harness radius and validation.
- [ ] Generalize renderer metric names and add instance facts.
- [ ] Run dense, empty, lifecycle, relocation, fog, and mixed-layer witnesses.
- [ ] Inspect screenshots and structured diagnostics.
- [ ] Record measurements and any material witnesses in this plan.
- [ ] Remove temporary browser/archive diagnostics not suitable for retention.

#### Decisions and Course Corrections

- None yet.

### Phase 7: Cleanup, Architectural Audit, and Closeout

#### Deliverables

- Remove:
  - the generated pre-realized commit arm;
  - buildings/objects-only outdoor-static aliases;
  - private duplicate outdoor-static type guards;
  - bake-only diagnostic names;
  - building-only renderer metric names;
  - dead baked-only renderer branches;
  - the old generically named `InstanceStreamManager`;
  - unused instance/provenance fields;
  - temporary archive tests and logs; and
  - compatibility handling for superseded binary versions.
- Inspect new cohort, transform, bounds, geometry-partition, and byte-accounting helpers for
  extraction into existing shared math/geometry modules where they are genuine primitives.
- Confirm no helper was extracted solely to hide complexity or satisfy tests.
- Run a focused architecture audit across:
  - cumulative content acquisition;
  - app-local host transport;
  - source decoding and classification;
  - commit and currentness boundaries;
  - shared cohort and transparent-template preparation;
  - atlas and device-resource ownership;
  - persistent static stream ownership and renderer-owned frame-stream lifetime;
  - scene publication/culling;
  - renderer pass selection and submission; and
  - diagnostics and browser acceptance.
- Update this plan with final decisions, measurements, concessions, and completion status.

#### Acceptance Criteria

- One outdoor-static source/commit/realization pipeline serves buildings, explicit objects, and
  generated scenery.
- Geometry strategy remains downstream from source commits and upstream from publication.
- Generated scenery owns its exact independent culling and lifecycle domain.
- No instanced draw unit can be silently ignored.
- No bake/building terminology remains where the behavior is shared.
- No durable generated failure record exists.
- Formatting, lint, type checks, unit tests, Rust checks, clippy, browser acceptance, and repository
  diff review pass.

#### Task Checklist

- [ ] Search for and remove superseded generated, bake-only, and building-only branches.
- [ ] Audit shared helpers and delete hollow wrappers.
- [ ] Run the blast-radius architecture audit.
- [ ] Run complete verification.
- [ ] Review the final diff for unrelated or generated-only duplication.
- [ ] Record closeout evidence and mark the plan complete.

#### Decisions and Course Corrections

- None yet.

## Dry-Run Findings Incorporated into the Phases

1. **Instancing is represented but not submitted.**
   - Artifact, stream, manager, and render-world types already exist.
   - The WebGL renderer explicitly drops non-baked units.
   - Therefore generic instance submission precedes generated activation rather than being treated
     as an optional optimization.
2. **The current artifact is close but cannot describe frame-streamed transparency yet.**
   - It already carries multiple geometry resources, persistent instance streams, and draw-unit
     unions.
   - It must gain a renderer-neutral transparent instance-template contribution retained on the
     CPU.
   - A generated-specific artifact type would still duplicate ownership and publication behavior.
3. **The current worker cannot simply add a second loop.**
   - Material planning, polygon-side expansion, setup hierarchy accumulation, transform
     composition, and bounds logic would diverge between baked and instanced paths.
   - Phase 2 first extracts shared preparation primitives and then builds both output strategies
     from them.
4. **Transparent instancing needs a different stream lifetime, not different geometry ownership.**
   - Existing sorting is range/resident based, global, and camera dependent.
   - Generated transparent transforms remain immutable world facts, but their submitted order is
     rebuilt per view.
   - A renderer-owned frame arena preserves reusable geometry and correct order without mutating
     leased static streams.
5. **Global sorting limits transparent batching.**
   - Equal cohorts separated by another transparent contribution cannot be merged without changing
     blend order.
   - The renderer forms instanced runs only from adjacent compatible candidates and accepts that a
     fragmented order may approach one draw per instance.
   - Geometry reuse remains valuable even when draw-call coalescing is limited.
6. **The current instance manager is static despite its name.**
   - It consumes static semantic keys, publishes once behind leases, and releases by owner.
   - Adding frame reset/update behavior would conflate revision ownership with view submission.
   - It becomes `StaticInstanceStreamManager`; a sibling renderer-owned frame arena shares only
     low-level buffer machinery.
7. **Source DID reuse is compelling but not the final cohort count.**
   - The evidence population has 568 residents from 29 source DIDs.
   - Final cohorts must split on complete consumed draw state.
   - Diagnostics will report both source reuse and final cohort shape to expose the real benefit.
8. **Cross-landblock reuse is a separate optimization.**
   - Installation-scoped geometry already eliminates repeated transformed geometry within the
     generated layer.
   - Shared geometry leasing would couple eviction across landblocks and requires a semantic cache
     identity.
   - It remains out of scope until measured resource data warrants it.
9. **The source-batch contract is structurally ready for Level 3.**
   - Maximum-LoD selection and exact requested-record projection already exist.
   - Generated requires an enum, projection, schema, and version extension, not a new host API.
10. **Generated already has the correct spatial identity.**

- Scene interest and static publication use typed layer kinds.
- Runtime activation should widen the shared outdoor-static domain rather than introduce a
  generated publication adapter.

11. **Existing names expose completed-plan vestiges.**

- `StaticObjectBakeDiagnostics` and `submittedBuilding*` are already narrower than their current
  consumers.
- Generated activation makes them actively dishonest, so the plan replaces them rather than
  adding parallel generated metrics.

12. **A scene node is not an instance.**
    - The initial generated layer remains one cullable landblock node containing multiple draw
      cohorts.
    - Renderer metrics must distinguish visible nodes, draw units, cohorts, instances, and
      triangles.

## Risks and Mitigations

### Cohort fragmentation erases expected benefit

**Risk:** Setup parts, materials, polygon sides, or appearance differences split repeated source DIDs
into many small cohorts.

**Mitigation:** Refresh final candidate cohorts before implementation, instance every eligible exact
cohort without a magic threshold, and report source versus final cohort counts and bytes. Preserve
the shared source pipeline even if individual witnesses have less reuse.

### Instance attributes leak through shared VAO state

**Risk:** Binding a cohort stream mutates attribute/divisor state on a geometry VAO and a later draw
uses stale instance inputs.

**Mitigation:** Bind every matrix/color attribute, buffer, stride, offset, enable state, and divisor
for every instanced draw. Keep this operation in one renderer helper and cover alternating-cohort
submission in the synthetic browser fixture.

### Per-instance transforms produce incorrect normals

**Risk:** Non-uniform or singular transforms require inverse-transpose normal handling even though
the current object shader does not yet consume lighting normals.

**Mitigation:** Define instance eligibility against a documented transform contract now. Generated
uniform scale and rotation are eligible. Preserve normals in geometry, reject invalid transforms,
and do not establish a shader contract that blocks correct future normal transformation.

### Transparent generated scenery renders in the wrong order

**Risk:** Transparent instances are sorted only within their original cohort, or equal cohorts are
merged across an intervening draw, changing alpha-blend order.

**Mitigation:** Expand every visible transparent template into an individual candidate, merge it
with existing baked transparent ranges, apply the current near-sort/far-source-order policy once,
and form runs only from adjacent candidates with identical draw state.

### Dynamic frame uploads stall or churn GPU resources

**Risk:** Reallocating or overwriting one instance buffer for every transparent run/frame stalls the
driver, creates garbage, or leaks backend resources.

**Mitigation:** Give the renderer one capacity-reusing frame arena with geometric growth, one
backing-store orphan and one complete upload per sequential view, offset-addressed runs, and
diagnostics for buffer objects, capacity, high-water marks, and upload bytes. Never allocate one
backend resource per run.

### Static and frame stream lifecycles become entangled

**Risk:** Camera-dependent frame data acquires semantic owner leases, or static layer eviction
releases renderer-owned transient capacity.

**Mitigation:** Rename and preserve the current static manager contract, keep the frame arena
renderer-owned, and share only the backend buffer/layout operations. Static publication rollback
does not own or recreate frame-arena capacity.

### Setup-part transforms are applied twice or omitted

**Risk:** Source-local cohort geometry and per-instance transforms change where accumulated part
poses are applied.

**Mitigation:** Use one shared parent-before-child transform helper. Define cohort geometry in
source-local part space and compose resident placement, resident scale, and accumulated part
transform exactly once into each instance.

### Static artifact rollback leaks one persistent resource family

**Risk:** Failure after geometry, persistent streams, or atlas publication leaks resources or
partially replaces the current generated layer.

**Mitigation:** Preserve `StaticLayerRealizer` sequencing and `StaticObjectSystem` transactional
publication. Add failures at every boundary and assert geometry, persistent streams, atlas claims,
nodes, diagnostics, transparent templates, and deferred residents all return to the prior current
revision. The renderer-owned frame arena remains outside revision publication.

### Level 3 requests duplicate cumulative work

**Risk:** Generated activation accidentally restores separate Level 0/1/2/3 host calls or competes
with an overlapping lower-LoD request.

**Mitigation:** Extend the existing layer-set batch and maximum-LoD coordinator. Add exact tests for
all-four-layer cold dispatch and overlapping lower/higher requests.

### Empty generated layers are treated as failures

**Risk:** Landblocks such as `0x376AFFFF` legitimately contain no generated residents.

**Mitigation:** Serialize and decode an explicit empty generated record, return a successful null
static artifact, and distinguish valid emptiness from a missing requested record.

### Diagnostics begin steering runtime design

**Risk:** Cohorts or resource boundaries are distorted to produce convenient counters.

**Mitigation:** Derive metrics from completed artifacts and renderer submissions. Do not retain
provenance fields or extra runtime maps solely for diagnostics.

### One node per generated landblock culls too coarsely

**Risk:** Dense generated scenery remains visible as one node even when only a small portion of the
landblock intersects the camera frustum.

**Mitigation:** Measure visible node, cohort, instance, and triangle counts. Keep prepared BVH
consumption or spatial clusters as a later independent optimization rather than entangling culling
with the initial instance architecture.

### Binary host/client contracts drift

**Risk:** Generated enum values are accepted by one side but rejected or misdecoded by another.

**Mitigation:** Increment both closed binary versions, cut over all adapters together, validate
exact layer sets, and reject old/malformed versions loudly.

## Definition of Done

- [ ] Generated scenery is requested through the existing landblock source-batch API at Level 3.
- [ ] A request for layers 0, 1, 2, and 3 performs one cumulative Level 3 assembly.
- [ ] The host projects generated scenery as its own closed outdoor-static record.
- [ ] `CommitBundle` carries generated scenery as a strategy-neutral source commit.
- [ ] Generated scenery realizes through the shared static-layer realizer.
- [ ] Generated scenery uses an independent owner, revision, scene node, culling group, diagnostics
      record, and eviction lifecycle.
- [ ] Eligible opaque, alpha-tested, and additive generated cohorts use
      `drawElementsInstanced`.
- [ ] Transparent generated instances share one per-view ordering-policy pass with existing baked
      transparent ranges and are submitted through adjacent compatible frame-stream runs.
- [ ] The renderer-owned frame arena reuses capacity without semantic world leases or per-run
      backend allocations.
- [ ] The existing instance manager is cleanly renamed `StaticInstanceStreamManager` and retains
      immutable publish-once lease semantics.
- [ ] Default-animated generated residents remain deferred without static resources.
- [ ] Instance transforms preserve generated placement, rotation, scale, and setup-part hierarchy.
- [ ] Existing object materials, atlases, palettes, fog, detail, sampler, culling, and blend rules
      are reused without generated-specific shader semantics.
- [ ] Geometry and persistent instance streams publish and roll back failure-atomically.
- [ ] Empty generated layers complete successfully.
- [ ] Buildings and explicit objects retain their current visual and lifecycle behavior.
- [ ] Diagnostics distinguish nodes, baked fallbacks, persistent cohorts/streams, transparent
      templates, frame uploads/runs, instances, geometry bytes, draw calls, and triangles.
- [ ] Bake-only and building-only shared-path terminology is removed.
- [ ] No durable failure records, compatibility shims, dead branches, or ceremonial provenance
      threading remain.
- [ ] Archive-dependent evidence is recorded in this plan and absent from permanent unit tests.
- [ ] `cargo fmt --all --check` passes.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` passes.
- [ ] Relevant Rust tests pass.
- [ ] `npm run format:check` passes in `apps/holtburger-3d`.
- [ ] `npm run lint` passes in `apps/holtburger-3d`.
- [ ] `npm run check` and `npm run check:rust` pass in `apps/holtburger-3d`.
- [ ] `npm run test:ts` passes in `apps/holtburger-3d`.
- [ ] Dense, empty, lifecycle, relocation, mixed-layer, and fog browser-harness acceptance passes.
- [ ] Final blast-radius architecture audit and diff review find no unresolved boundary drift.
- [ ] This plan records final evidence, decisions, concessions, and completion status.

## Open Questions

No open question or user decision blocks execution.

The finalization investigation resolved the former evidence questions:

- real generated populations exercise opaque, alpha-test, transparent, indexed, direct-Gfx,
  setup-backed, and default-animated paths;
- the current archive contains no generated additive witness, so the shared additive path requires
  synthetic acceptance;
- candidate cohort and byte estimates remain favorable after setup-part/material splitting;
- all 167 possible generated sources use supported direct-Gfx or setup-model families;
- seven possible setup sources carry default animations and retain the existing deferral path; and
- the sequential renderer view lifecycle supports one capacity-reusing orphan/upload arena.

One post-implementation measurement remains intentionally non-blocking: visible instance and
triangle counts will determine whether consumption of the prepared generated BVH or finer scene
clusters should become the next visibility plan. It does not change the initial independent
generated culling group or one-node-per-landblock publication.
