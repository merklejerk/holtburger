# Holtburger 3D Explicit Objects Layer Plan

Status: Complete. All seven phases landed and passed their closeout verification on 2026-07-25.

## Context and Boundaries

### Goal

Load cumulative scene LoD Level 2 explicit outdoor objects through a shared outdoor-static-object
pipeline, retain an independent `objects` culling group for every landblock, and render every
resident classified as static while preserving default-animated residents at the existing deferred
dynamic seam.

### Current State

The shared content pipeline already:

- decodes `LandblockInfo.objects` as authored outdoor static placements;
- accepts direct `GfxObj` and setup-backed sources;
- prepares stable identities, placements, scales, bounds, presentation definitions, materials, and
  texture dependencies;
- partitions cumulative scene LoD output into Level 1 buildings and Level 2 explicit objects; and
- builds a layer-local outdoor BVH for explicit objects.

The 3D application already has:

- scene-interest and Explorer radius policy for `LandblockLayerKind.Objects`;
- a common `ResolvedObjectLayerSource` contract for buildings, explicit objects, and generated
  scenery;
- classification of setup-backed residents with default animations into `dynamicResidents`;
- closed static geometry preparation, logical texture-fact collection, resident atlas claims,
  transactional atlas publication, and failure-atomic static scene replacement;
- material support for direct color, indexed color, palettes, alpha test, transparency, additive
  blending, DXT formats, and source sampler policy; and
- a scene index whose culling groups are already partitioned by scope, landblock, and producer
  group.

The active pipeline is still building-specific at its outer edges:

- the host exposes separate Level 0 terrain and Level 1 building commands/routes, with no Level 2
  explicit-object source;
- the binary envelope, decoder, source port, worker, artifact assembly, texture collection, and
  diagnostics use building-specific names;
- `StandardCommitPipeline` rejects `LandblockLayerKind.Objects`; and
- `GameRuntime` routes only buildings through `StaticLayerRealizer`, whose publication adapter
  currently hard-codes `LandblockLayerKind.Buildings`.

The current source-acquisition fan-out is also structurally wrong for cumulative LoD:

- `StandardCommitPipeline.prepareLandblockLayers` dispatches every requested layer in parallel;
- terrain, building, and future explicit-object source routes request Level 0, 1, and 2
  respectively; and
- `ContentAssetRuntime` single-flights only an identical request, so cold concurrent Level 0, 1,
  and 2 requests for one landblock can each assemble their own cumulative prefix.

The completed prepared-LoD cache extends a lower cached asset correctly, but it does not make cold
different-level requests one in-flight operation. A Level 2 source addition must remove this fan-out
rather than make it worse.

### Locked Decisions

1. Every static layer retains its own culling group.
   - Terrain remains `terrain`.
   - Outdoor buildings use `buildings`.
   - Explicit outdoor objects use `objects`.
   - Generated outdoor scenery will use `generated` when its layer is activated.
   - Env-cell shells remain in their existing `env-cell-shell` group.
   - No shared `static`, `outdoor-static`, or owner-derived fallback group will be introduced.
2. The layer kind crosses the realization and publication boundary as a typed field. Runtime code
   must not parse opaque owner IDs to rediscover it.
3. Default-animated explicit residents remain deferred.
   - Their complete resolved records continue through `CommitBundle.dynamicEntities`.
   - They are recorded by the existing static-authored dynamic deferral seam only after the
     corresponding static layer publishes successfully.
   - This plan does not allocate dynamic geometry, materials, atlas claims, scene nodes, animation
     state, or renderer submissions for them.
4. Buildings and explicit objects use one outdoor-static-object source, bake, texture, realization,
   and diagnostics vocabulary. The implementation will cleanly cut over existing building callers
   rather than add a parallel explicit-object pipeline or compatibility aliases.
5. Independent layer ownership is preserved. Buildings and explicit objects may share decoded
   definitions and atlas entries, but each layer receives its own source commit, geometry
   allocation, scene node, culling group, revision, and eviction lifecycle.
6. Source acquisition batches the complete requested layer set for one landblock and one
   scene-interest dispatch.
   - The host computes the maximum required cumulative LoD once, then projects the requested
     terrain/building/object source records from that one asset.
   - The batch is a host-data boundary only. The frontend immediately fans it back into independent
     typed commits and does not share runtime ownership, culling groups, revisions, or eviction.
   - This is not debounce, hysteresis, timer coalescing, or a delay waiting for hypothetical work.
   - Overlapping later requests for the same landblock use a per-landblock in-flight acquisition
     coordinator: an equal-or-higher in-flight request is shared; a higher request arriving after a
     lower one waits for the lower result and extends it rather than assembling a competing prefix.
     This coordinates cumulative content assembly, not separate host-command responses: later
     independent dispatches may still receive their own projected batch, but never compete to
     assemble overlapping cumulative prefixes.
   - Shared `holtburger-core` coordination speaks only in authoritative landblock and cumulative
     LoD terms. The app-local host adapter owns frontend layer-set mapping, batch transport, and
     record projection.

### In Scope

- `LandblockSceneLodLayer::OutdoorExplicitObjects` from cumulative Level 2 scene content.
- Direct `GfxObj` and setup-backed explicit-object sources.
- One typed per-landblock source-batch request that may project terrain, buildings, and explicit
  objects independently.
- Per-landblock in-flight source acquisition coordination for overlapping cumulative LoD requests.
- Clean replacement of building-branded source, decoder, bake, artifact, texture-input, and runtime
  names where the behavior is now proven shared.
- One landblock-local baked geometry allocation for each static object layer.
- Layer-specific geometry/resource identities.
- Exact `buildings` and `objects` scene culling groups.
- Existing static material ordering and texture-atlas behavior, including transparent, additive,
  indexed, palette, and DXT3 paths that explicit objects exercise beyond current building data.
- Currentness, failure, replacement, lifecycle reload, and eviction behavior for explicit-object
  owners.
- Generic outdoor-static-layer diagnostics that identify their originating layer.
- Browser harness control and reporting for an explicit-object radius.
- Temporary live-data investigation through the debug harness or browser harness.

### Out of Scope

- Rendering, animation playback, or runtime installation of promoted dynamic residents.
- Runtime/server-authored objects, creature/item interaction, picking, selection, collision, or
  physics.
- Level 3 generated scenery activation. The shared shape must leave it straightforward, but this
  plan will not request or publish that layer.
- Level 4 env-cell systems, portal traversal, or interior static objects.
- Per-object scene nodes, per-object culling, instancing, clustering, or consumption of the
  prepared outdoor BVH.
- Changes to shared content semantics unless evidence reveals a concrete decoding or preparation
  defect.
- Permanent tests that depend on untracked runtime archives.
- A generic asset router, generic render graph, or abstraction spanning terrain, outdoor objects,
  env cells, and dynamics.
- Timer-based request debounce, hysteresis changes, or speculative prefetch policy.
- The previously deferred broad `src-tauri/src/lib.rs` cohesion refactor. Narrow command and route
  changes required by the Level 2 source capability remain in scope.

## Ground Truth and Existing Precedent

### Authoritative and Shared Sources

- `crates/holtburger-dat/src/landblock.rs`
  - `LandblockInfo.objects`
  - `Stab`
- `crates/holtburger-content/src/static_outdoor_scene.rs`
  - `StaticOutdoorInstance`
  - `StaticOutdoorInstanceIdentity::ExplicitObject`
  - `StaticRenderableSourceRef`
  - `derive_explicit_objects`
- `crates/holtburger-content/src/landblock_scene_assets.rs`
  - `LandblockSceneLodLevel::Level2`
  - `LandblockSceneLodLayer::OutdoorExplicitObjects`
  - `LandblockSceneLodOutdoorStaticLayer`
  - `LandblockOutdoorStaticMember`
  - `PreparedStaticInstanceKind::Scenery`
  - setup-part preparation, bounds, and layer-local BVH construction
- `crates/holtburger-core/src/content_assets.rs`
  - cumulative scene-LoD loading and projection
- `ACViewer/ACE/Source/ACE.DatLoader/FileTypes/LandblockInfo.cs`
  - client-cell explicit-object records and their `0x01`/`0x02` source forms
- `ACViewer/ACViewer/Render/R_Landblock.cs`
  - distinct static-object, building, and generated-scenery construction paths
- `ACE/Source/ACE.DatLoader/FileTypes/GfxObj.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/SetupModel.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/Surface.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/SurfaceTexture.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/Texture.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/Palette.cs`
- `acclient-eor-source/`
  - authoritative fallback for material, clip-map, transparency, additive, and setup-default
    animation behavior when ACE and ACViewer do not establish presentation semantics

No new content or renderer rule may be inferred from an asset sample alone when the corresponding
ACE, ACViewer, or retail behavior can be inspected.

### Current Application Precedent

- `crates/holtburger-core/src/content_assets.rs`
  - completed landblock scene-LoD cache and its current exact-request in-flight boundary
- `apps/holtburger-3d/src/lib/game/runtime/scene-interest.ts`
  - typed layer identities and explicit-object radius
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
  - landblock- and producer-specific aggregate culling groups
- `apps/holtburger-3d/src/lib/game/resolution/landblock-layer.ts`
  - shared outdoor object source contract
- `apps/holtburger-3d/src/lib/game/resolution/object-resident-classifier.ts`
  - static/default-animated partition
- `apps/holtburger-3d/src/lib/game/runtime/static-layer-realizer.ts`
  - revision-scoped atlas, geometry, currentness, and publication sequencing
- `apps/holtburger-3d/src/lib/game/systems/static-object-system.ts`
  - typed non-terrain culling-group publication and resource ownership
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts`
  - current static layer geometry transform and material-range bake
- `apps/holtburger-3d/src/lib/game/textures/atlas/resident-texture-atlas.ts`
  - cross-owner logical texture reuse and transactional publication
- `apps/holtburger-3d/src-tauri/src/landblock_source_batch.rs`
  - typed cumulative-LoD layer projection and versioned outer source-batch envelope
- `apps/holtburger-3d/src-tauri/src/outdoor_static_source.rs`
  - current closed object-definition, geometry, material, and texture-dependency source bundle
- `apps/holtburger-3d/src/lib/assets/decode-landblock-source-batch.ts`
  - outer batch validation and typed terrain/outdoor-static record projection
- `apps/holtburger-3d/src/lib/assets/decode-outdoor-static-record.ts`
  - current binary validation, typed-array hydration, placement conversion, and resident
    classification

### Existing Live Evidence

The completed building investigation recorded:

- 1,074 static setup-backed explicit-object sources across the archive;
- 22 setup sources with default animations;
- `0x02000065` in landblock `0x0C78FFFF` as a static setup-backed sample;
- `0x02000331` in landblock `0x95D6FFFF` as a promoted-dynamic sample with default animation
  `0x030005CF`;
- 69 used transparent explicit-object source slots;
- 40 used additive explicit-object source slots; and
- authored explicit objects using DXT3, which the Level 1 building population does not exercise.

These observations establish acceptance samples and required existing material paths. Execution
must refresh focused evidence if source or census behavior has changed; the plan must not turn
these archive-dependent observations into permanent runtime-asset tests.

### Evidence Preflight: 2026-07-25

The current `dats/assets.hba` archive revalidated the plan's source-classification and material
claims without content assembler errors or omissions:

- `0x0C78FFFF` has 37 explicit residents. Setup `0x02000065` has one setup part and no default
  animation, so it remains a static setup-backed acceptance sample.
- `0x95D6FFFF` has 71 explicit residents. Setup `0x02000331` has default animation `0x030005CF`;
  its animated part transforms vary across the clip, confirming it must remain deferred rather than
  silently baked as static geometry.
- The archive census reports 1,074 static setup-backed explicit sources and 22 default-animated
  sources. Its used explicit material slots include 303 alpha-test, 69 transparent, and 40 additive
  slots; no static explicit source was unsupported.
- Concrete static material witnesses are:
  - transparent: landblock `0xB997FFFF`, direct GfxObj `0x010006A9`;
  - additive: landblock `0x376AFFFF`, direct GfxObj `0x010010F2`; and
  - DXT3: landblock `0x33DAFFFF`, setup model `0x0200187C`, whose sole part uses GfxObj
    `0x0100426D` and selected render surface `0x06006992` (256x512 DXT3).
- Seven fresh-cache content-assembly samples show Level 2 is materially more expensive than Level
  1, but a shared-cache Level 1 then Level 2 sequence is not equivalent to two cold assemblies:

  | Landblock    | Cold Level 1 median | Cold Level 2 median | Shared-cache L1 then L2 median |
  | ------------ | ------------------: | ------------------: | -----------------------------: |
  | `0x0C78FFFF` |            2.486 ms |           25.439 ms |                      24.779 ms |
  | `0x95D6FFFF` |           13.639 ms |           38.955 ms |                      44.934 ms |

  These timings cover `LandblockSceneLodAssetAssembler` only: no host serialization, IPC/HTTP,
  frontend decoding, texture preparation, worker bake, atlas build, or GPU publication. A Level 2
  serialized source response does not exist before Phase 2, so response-byte and end-to-end host
  timing remain execution measurements rather than invented baseline numbers.

## North Stars

1. **One proven outdoor-static pipeline.** Buildings and explicit objects differ by typed layer
   identity and content, not by duplicated orchestration.
2. **Independent spatial domains.** Each static layer has its own culling group and lifecycle even
   when it shares textures or object definitions with another layer.
3. **Lossless source carriage.** Static and deferred-dynamic residents retain complete presentation,
   appearance, placement, scale, material, and source identities.
4. **Logical residency before physical placement.** Layer code declares texture facts; the resident
   atlas remains the sole page-placement and publication authority.
5. **Closed expensive work.** Geometry workers receive complete jobs and never callback for assets,
   atlas placement, device state, or currentness.
6. **Typed currentness.** Layer, owner, and revision are explicit inputs. Opaque IDs are identities,
   not data-transfer encodings.
7. **No fake dynamic completion.** Deferred residents remain visibly and diagnostically deferred;
   this slice does not create hollow dynamic resources or count them as rendered.
8. **Clean cutover.** Building-only names and dead branches are removed as their replacements land.
   Generated-scenery hooks are not added until Level 3 execution proves their need.
9. **One cumulative assembly per landblock dispatch.** Source batching shares only host preparation;
   runtime layer isolation begins at typed commit projection, immediately after decoding.

## Phased Implementation

### Phase 1: Establish Per-Landblock Cumulative Acquisition

#### Deliverables

- Introduce a focused host-internal vocabulary for the source layers covered by this plan:
  Terrain, Buildings, and Objects. Exclude Generated and env cells.
- Define one acquisition request carrying the complete requested layer set for one landblock and a
  projected result that contains only those requested layers.
- Put only the reusable `(landblock, cumulative LoD)` in-flight coordination in
  `holtburger-core`; keep frontend layer enums, source-batch DTOs, and record projection in the
  app-local host adapter.
- Lock the schema requirements for a narrow versioned batch envelope containing named,
  independently decodable terrain and outdoor-static-layer records. Phase 2 implements that wire
  envelope; it is not a scene commit or renderer payload.
- Define the cumulative source-LoD mapping:
  - terrain -> Level 0 / `Terrain`;
  - buildings -> Level 1 / `OutdoorBuildings`;
  - objects -> Level 2 / `OutdoorExplicitObjects`.
- Define projection: load the highest required LoD once, then emit only the layers requested by the
  source batch.
- Define the culling-group mapping as identity: a static object source's layer kind is its culling
  group.
- Define the per-landblock in-flight rule: equal-or-higher requests share work; a higher request
  that arrives behind a lower one extends its completed result rather than launching a competing
  cumulative assembly.
- Implement and unit-test the host-internal batch acquisition/projection primitive behind the
  existing transport boundary. Route the existing terrain/building host commands through that
  primitive without changing their wire shapes. Phase 1 must not add a second production frontend
  capability or partially migrate frontend callers.
- Capture focused non-interactive evidence for the two documented setup-backed samples before
  changing the source adapter.

#### Acceptance Criteria

- Host-internal types exclude Generated and env cells from this source-batch path and distinguish
  terrain from outdoor static layer records.
- Projection returns exactly the requested layer set from the one cumulative asset.
- Host-internal tests prove a cold `{ terrain, buildings, objects }` batch triggers one Level 2
  assembly, not independent Level 0, 1, and 2 assemblies.
- Host-internal tests prove a concurrent lower-then-higher request sequence never has two
  cumulative assembly prefixes in flight for the same landblock.
- Existing Level 0 terrain and Level 1 building host routes preserve their responses while sharing
  the new per-landblock acquisition coordinator.
- Evidence confirms the static sample remains static and the default-animated sample remains
  dynamic under the existing classifier.
- Focused Rust tests and clippy pass with warnings denied.

#### Task Checklist

- [x] Add the typed host-internal source-layer vocabulary, batch request, and projected result in
      the app-local host adapter.
- [x] Add or refine the cumulative landblock-LoD coordinator in `holtburger-core` without importing
      frontend layer or transport vocabulary.
- [x] Add table-driven layer-to-LoD/content-variant selection.
- [x] Record the outer-envelope and record-schema invariants that Phase 2 must encode and validate.
- [x] Route existing terrain/building host acquisition through the coordinator without changing
      their transport contracts.
- [x] Add focused core/host concurrency coverage for cold `{L0, L1, L2}` and lower-then-higher
      request sequences.
- [x] Run or extend a non-interactive debug-harness probe for the acceptance samples.
- [x] Record current source and material evidence in this plan.

#### Decisions and Course Corrections

- Evidence preflight confirmed that the static and deferred-dynamic samples remain correctly
  classified on the current archive.
- Added durable, non-interactive material-witness output to the existing evidence census and
  content-assembly timing output to the outdoor-statics inspector. Both keep archive work outside
  permanent application tests.
- Inspection of the actual cache boundary superseded the initial timing inference: the existing
  cache reuses completed higher-LoD assets but cannot coalesce different cold in-flight LoD
  requests. Batching is therefore mandatory source-acquisition correctness work, not a later
  performance optimization.
- `ContentAssetRuntime` now coordinates only cumulative scene-LoD work by normalized landblock and
  LoD; every other asset class retains exact-request single-flight behavior. A higher request waits
  for an active lower request, then extends the prepared cache instead of racing a second prefix.
  The first cut intentionally does not cancel or promote that lower request in place.
- The app-local `landblock_source_batch` projection maps Terrain/Buildings/Objects to Levels 0/1/2
  and exposes only requested records. Existing terrain/building commands retain their original
  envelopes while routing through it; Phase 2 remains responsible for the atomic wire cutover.
- Focused core and host tests, Rust formatting, and clippy with warnings denied passed.

### Phase 2: Build the Closed Batched Source Transport

#### Deliverables

- Split the current `building_source.rs` responsibility into an honestly named
  `landblock_source_batch` outer serializer and an `outdoor_static_source` record serializer. The
  outer batch owns terrain/static record framing; the inner serializer owns only shared outdoor
  static definitions, geometry, materials, and texture dependencies.
- Introduce the matching TypeScript `Buildings | Objects` outdoor-static-layer alias and typed batch
  request/response records. Do not pre-admit Generated to runtime branches.
- Replace `BuildingSourceClosure`, binary manifest/section names, and serialization helpers with
  static-object-layer equivalents.
- Give the outer batch and its nested record formats explicit magic/version identities. Validate
  transport name, version, requested landblock, requested layer set, and returned records before
  constructing commits.
- Route the new batch command through the cumulative acquisition coordinator established in
  Phase 1.
- Replace the terrain and building-only Tauri commands/requests with one typed landblock source
  batch command.
- Replace `/terrain-source` and `/building-source` in the headless host with one typed landblock
  source-batch route.
- Replace:
  - `LandblockTerrainSource` and `LandblockBuildingSource` acquisition calls;
  - `TauriLandblockTerrainSource` and `TauriLandblockBuildingSource` acquisition calls;
  - separate terrain/building HTTP calls; and
  - `decodeBuildingSource`
    with one typed batch capability plus narrow terrain/static-record decoders.
- Cut `StandardCommitPipeline` over in the same phase: group requested `LandblockIdLayer`s by
  landblock, acquire one batch per landblock, and fan the validated records back into the existing
  independent terrain and building commits. `Promise.all` remains across landblocks, never across
  cumulative layers of one landblock.
- Keep the closed batch free of decoded texture pixels, renderer/device state, commit policy, and
  cross-layer ownership.
- Permit independent layer records to repeat immutable definition bytes in the first cut. The batch
  removes cumulative assembly duplication; cross-layer payload deduplication is a separate measured
  concern and must not introduce shared transferable buffers by accident.

#### Acceptance Criteria

- Existing terrain and Level 1 building source behavior passes through the batch transport.
- Both host and frontend reject a requested/returned landblock or layer-set mismatch.
- A terrain + buildings scene-interest dispatch performs one Level 1 batch acquisition for each
  cold landblock and preserves independent terrain/building receipts, commits, and eviction.
- A batch containing terrain, buildings, and objects produces three independent typed source
  projections from one host LoD asset.
- A synthetic Level 2 explicit-object record decodes into
  `ResolvedObjectLayerSource.kind === LandblockLayerKind.Objects`.
- Direct GfxObj and setup-model definitions hydrate through the same decoder for both layers.
- Static and default-animated residents are classified exactly once after decoding.
- No terrain/building-only source acquisition command, route, frontend capability, or compatibility
  alias remains.
- Rust checks and clippy pass with warnings denied.
- TypeScript tests, type checking, lint, and targeted formatting pass for the transport cutover.

#### Task Checklist

- [x] Move and rename the Rust source-closure module and its tests.
- [x] Connect the batch command to the established coordinator and implement one
      highest-LoD assembly/projection path.
- [x] Implement the new outer/record magic and manifests while preserving typed-array section
      alignment and transferability.
- [x] Add manifest validation for transport identity, version, landblock, requested layer set, and
      returned layer records.
- [x] Add the batch request to Tauri and HTTP host boundaries.
- [x] Move and rename the TypeScript source capability, Tauri adapter, and decoders.
- [x] Update `ExplorerApp`, the terrain harness app, and HTTP source construction.
- [x] Replace per-layer acquisition in `StandardCommitPipeline` with group-by-landblock batch
      acquisition and typed terrain/building commit fan-out.
- [x] Rewrite terrain/building decoder fixtures against the batch envelope.
- [x] Add explicit-object decoder fixtures covering a setup-backed static and promoted resident.
- [x] Prove concurrent batch requests share/extend per-landblock work without changing their
      projected layer sets.
- [x] Verify source fan-out preserves independent commit records; currentness, failure,
      replacement, and eviction remain runtime concerns covered in Phase 4.
- [x] Remove old `HBBL`, `terrain-source`, `building-source`, and per-layer load-call vestiges.
- [x] Re-audit the landed batch boundary and dry-run Phases 3-6 against its actual decoded record
      shapes.

#### Decisions and Course Corrections

- The outer `HBLB` envelope is the only host command/HTTP response. It carries a requested-layer
  manifest and independently decodable nested records: retained `HBTR` terrain records and new
  `HBSO` outdoor-static records. Both outer and nested manifests validate version, landblock, and
  typed layer identity before commit construction.
- `StandardCommitPipeline` now groups work by landblock, requests one batch, and fans validated
  terrain/building records back into independent commits. It intentionally continues to reject
  Objects until Phase 5; the transport and decoder already support an explicit object record and
  its static/dynamic classification.
- The batch does not deduplicate immutable definitions across nested records. It eliminates
  cumulative content assembly fan-out first; shared transferable buffer ownership remains out of
  scope until measured evidence justifies it.
- Renamed and removed all old building/terrain transport commands, routes, adapters, decoders,
  binary magic, and per-layer load calls. `outdoor-terrain-source-available` remains because it is
  a semantic scene-availability event, not a transport contract.
- Focused Rust/TypeScript tests, TypeScript checks, lint (including clippy with warnings denied),
  formatting, and the full 3D Rust package tests passed. The sandbox cannot keep a local host alive
  for a browser request; live host/browser acceptance remains Phase 6 work rather than a simulated
  claim here.
- Resteer result: Phase 3 can consume the decoded `ResolvedObjectLayerSource` record unchanged.
  The transport cutover did not introduce shared layer ownership, geometry assumptions, or a new
  renderer contract.

### Phase 3: Generalize Static Geometry and Texture Inputs

#### Deliverables

- Rename building geometry job/result/worker symbols and files to static-object-layer terminology.
- Rename building artifact and texture dependency collection to static-object-layer terminology.
- Carry the typed layer through geometry jobs and emitted resource identities.
- Reject a geometry job whose explicit layer does not match the resolved source's layer kind;
  this makes the field an integrity boundary rather than provenance decoration.
- Preserve one closed geometry job and one baked allocation per landblock layer.
- Reuse `planObjectMaterial`, logical `AssetTextureFact` collection, atlas purposes, sampler facts,
  transparent sort units, and additive grouping without layer-specific branches.
- Replace `BuildingLayerSourceCommit` with a typed static-object-layer source commit used by
  buildings and objects.

#### Acceptance Criteria

- Identical building input produces equivalent geometry, material ranges, texture facts, and
  ordering after the rename.
- Building and explicit-object jobs cannot produce colliding geometry identities within one
  revision namespace.
- Explicit static setup parts apply default part transforms and source scale exactly once.
- Only textures referenced by emitted triangles become atlas requirements.
- Transparent ranges preserve resident/part sort identity; additive ranges remain in the distinct
  additive phase.
- No building-named worker, artifact assembler, or texture-input helper remains.

#### Task Checklist

- [x] Move and rename the geometry worker, client, entry point, tests, and worker contracts.
- [x] Include the source layer in geometry/resource keys and reject source/job layer mismatches.
- [x] Move and rename artifact assembly and texture-fact collection.
- [x] Generalize commit union branches for Buildings and Objects without a broad untyped payload.
- [x] Update runtime dependency injection and focused fakes.
- [x] Prove normalized single-part and setup-style multipart transforms, transparent/additive
      ordering, and indexed/palette binding and texture-fact collection with asset-free fixtures.
      Source-form decoding/classification remains covered at the record decoder boundary; DXT3
      pixel decode and atlas acceptance remain Phase 6 responsibilities.
- [x] Exercise the worker client with genuine transferable `ArrayBuffer` inputs, or record the
      exact test-environment limitation and retain that proof for Phase 6 browser acceptance.
- [x] Run focused TypeScript tests, type checking, lint, and targeted formatting.

#### Decisions and Course Corrections

- Coherence pass: the worker's layer is an integrity input, not decorative provenance. It must
  match `ResolvedObjectLayerSource.kind` before any geometry is baked or keyed. Runtime passage of
  the layer into realization and publication remains deliberately Phase 4 work; the current
  Buildings-only adapter supplies the known Buildings value until that cutover.
- Coherence pass: the normalized geometry worker cannot truthfully prove original direct-GfxObj
  versus setup-source decoding, nor can it prove DXT3 pixel decode. Phase 3 therefore tests the
  normalized geometry/material contract and transfer boundary; decoder classification and live
  texture acceptance retain their assigned Phase 2 and Phase 6 coverage.
- `ResolvedOutdoorStaticLayerSource` now admits Buildings and Objects only. It makes the shared
  source-commit, texture, artifact, and geometry contracts honest without pre-admitting Generated
  scenery; its production pipeline branch remains Phase 5 work.
- Geometry jobs validate `source.kind === layer` before baking and include that layer in their
  resource key. The worker therefore cannot publish an Objects allocation under a Buildings
  identity, even if a caller constructs an otherwise type-compatible payload incorrectly.
- Focused fixtures prove single-part and setup-style parent transforms, source scale, transparent
  and additive ordering, indexed/palette texture facts, and absent static output. The worker-client
  test uses `structuredClone(..., { transfer })` and proves the source `ArrayBuffer` detaches.
- The remaining `RuntimeBuildingGeometryPreparer` is intentionally still Buildings-only: it is the
  Phase 4 runtime seam that will carry typed layers through realization and publication. No
  building-named shared worker, artifact assembler, texture-input helper, or source commit remains.
- Full TypeScript tests (44 files / 200 tests), type checking, ESLint, Knip, clippy with warnings
  denied, Rust formatting, and diff checks passed.

### Phase 4: Make Static Realization Layer-Aware

#### Deliverables

- Add the typed outdoor static layer to `StaticLayerRealizationInput`.
- Pass that layer to `StaticLayerPublisher.replace`.
- Have the runtime publication adapter pass the exact layer to
  `StaticObjectSystem.replaceObjects`.
- Make the runtime accept and route both Buildings and Objects through `StaticLayerRealizer`;
  exercise Objects with synthetic commits until Phase 5 activates its production source branch.
- Route eviction for both layers through the same exact-revision geometry and atlas withdrawal
  path.
- Preserve layer-independent atlas sharing: identical logical texture facts from buildings and
  objects share physical residency while retaining independent claims.

#### Acceptance Criteria

- A building publication creates scene entries in only the `buildings` culling group.
- An explicit-object publication creates scene entries in only the `objects` culling group.
- Publishing or evicting one group does not replace, remove, dirty, or transfer ownership of the
  other group's scene nodes.
- Replacing an explicit-object revision leaves the previous visible revision installed until the
  new geometry and atlas requirements are ready.
- Stale completions publish neither geometry nor atlas claims.
- Current atlas failures are logged and withdrawn without a durable failure record.
- The publisher never parses `OwnerId` to determine the culling group.

#### Task Checklist

- [x] Extend realizer and publisher contracts with the typed layer.
- [x] Update realizer tests to assert layer carriage on replace.
- [x] Add scene/static-system coverage for same-landblock building and object groups.
- [x] Generalize `GameRuntime.#realizeBuildingLayer` into one outdoor-static-layer method.
- [x] Generalize currentness and eviction branches for Buildings and Objects.
- [x] Verify independent layer replacement and eviction under interleaved revisions.
- [x] Verify shared texture claims survive eviction of only one layer owner.
- [x] Run focused runtime/scene tests, type checking, lint, and targeted formatting.

#### Decisions and Course Corrections

- `OutdoorStaticLayerKind` is the narrow Buildings/Objects identity at the realization boundary.
  `StaticLayerRealizationInput`, geometry preparation, atlas-failure reporting, publisher
  replacement, and runtime currentness all carry it explicitly.
- The runtime no longer extracts a culling-group layer from `OwnerId`. It retains owner parsing only
  to recover the landblock portion required by the existing scene-interest coordinator; the typed
  layer is passed directly to that coordinator and `StaticObjectSystem.replaceObjects`.
- `GameRuntime.#realizeOutdoorStaticLayer` validates source and commit layer agreement, realizes
  both outdoor-static layers, and defers promoted residents only after publication. Building-only
  diagnostics intentionally remain in place until Phase 5 gives Objects a public diagnostic API.
- Eviction now routes both Buildings and Objects through the same exact-revision geometry and atlas
  withdrawal path. Static-object tests prove a stale Buildings eviction cannot remove a newer
  Buildings revision or the independent Objects owner; the atlas test proves withdrawing Buildings
  retains a shared resident claimed by Objects.
- A synthetic Objects source runs through the production runtime realizer in the focused runtime
  test. It reaches the existing deferred-dynamic seam with `layer === Objects` without activating
  the Phase 5 source-pipeline branch.
- Full TypeScript tests (44 files / 203 tests), type checking, ESLint, Knip, clippy with warnings
  denied, Rust formatting, and diff checks passed.

### Phase 5: Activate Level 2 Explicit Objects

#### Deliverables

- Extend the established source-batch request and pipeline fan-out with
  `LandblockLayerKind.Objects`. A batch requests and returns the Objects record only when Objects is
  in the requested layer set; it must not install or own an unrequested layer.
- Emit static source and complete deferred-dynamic residents through the common commit.
- Collect explicit-object texture facts and dispatch static realization through the common path.
  Once the source batch has fanned out, independent layer preparation may proceed concurrently.
- After successful static publication, pass promoted residents to the existing
  `#deferStaticAuthoredDynamic` seam with `layer === Objects`.
- Replace building-only runtime diagnostics with outdoor-static-layer diagnostics carrying their
  layer kind.
- Keep any Explorer projection presentation-only; shared runtime diagnostics remain layer-neutral.

#### Acceptance Criteria

- Enabling `explicitObjectRadius: 0` with buildings enabled loads and renders static explicit
  objects in the anchor landblock.
- One terrain + buildings + objects scene-interest dispatch for a cold landblock performs one host
  source acquisition at Level 2, while producing three independently current/evictable commits.
- Explicit-object readiness participates in the same scene-interest receipt/currentness lifecycle
  as buildings.
- The documented static setup sample materializes.
- The documented default-animated sample is carried intact to the deferred seam, logged as
  deferred, and creates no dynamic geometry, atlas claim, scene node, animation component, or draw
  submission.
- Static diagnostics count rendered and deferred residents separately and identify
  `LandblockLayerKind.Objects`.
- A layer containing only deferred residents completes without publishing an empty static scene
  artifact.
- Clearing or shrinking explicit-object interest removes object geometry and claims without
  disturbing buildings or terrain.

#### Task Checklist

- [x] Add the Objects batch-record branch to `StandardCommitPipeline`.
- [x] Generalize runtime diagnostics storage and query APIs by static layer kind.
- [x] Update Explorer diagnostics consumers without introducing source DTOs into UI state.
- [x] Verify deferred residents are processed only after successful current static publication.
- [x] Add focused pipeline and runtime tests for Objects commits, deferral, stale completion, and
      eviction.
- [x] Add a cold same-landblock terrain + buildings + objects test proving one Level 2 source
      acquisition and independent layer publication.
- [x] Run focused pipeline/runtime tests, type checking, lint, Rust checks, and targeted formatting.

#### Decisions and Course Corrections

- `StandardCommitPipeline` now accepts Objects only as a requested `LandblockSourceLayer`, validates
  that its returned record is exactly Objects for the requested landblock, and fans it into a
  layer-owned source commit. Terrain, Buildings, and Objects still share one batch request per
  landblock; no runtime ownership is shared after that projection.
- Runtime diagnostics are now `StaticObjectRuntimeDiagnostics`, with a typed layer on every
  installed source snapshot. Explorer and harness consumers receive the read-only aggregate only;
  no resolved source or renderer state escaped into app UI state.
- A synthetic Objects runtime commit reaches the static realizer and existing deferred-dynamic seam.
  Object stale completion, exact eviction, atlas claim retention, and culling-group independence
  are covered at their owning runtime/system boundaries. Dynamic rendering remains deliberately
  deferred.
- The combined pipeline fixture proves one same-landblock Terrain/Buildings/Objects batch request
  fans out into independent typed commits. It is transport/commit proof, not a claim about browser
  load timing; Phase 6 owns live Level 2 acceptance and measurement.
- Full TypeScript tests (44 files / 204 tests), type checking, ESLint, Knip, clippy with warnings
  denied, Rust formatting, and diff checks passed.

### Phase 6: Browser Harness and Material Acceptance

#### Deliverables

- Add `--explicit-object-radius <n>` to the terrain browser harness.
- Enforce the same hierarchy as Explorer: explicit-object radius is disabled or no greater than
  building radius, which is no greater than terrain radius.
- Report building and explicit-object layer diagnostics separately.
- Add lifecycle coverage that clears and reloads both layers.
- Run focused live samples for:
  - the static setup-backed landblock;
  - the promoted-dynamic landblock;
  - transparent/additive explicit content; and
  - DXT3 explicit content.
- Capture atlas page, binding, geometry-byte, triangle, range, scene-node, and culling-group
  diagnostics.
- Report per-landblock batch count, selected maximum LoD, source response bytes, and host source
  assembly duration through harness-only or existing read-only diagnostics so the cumulative-LoD
  invariant is observable without creating durable runtime failure records or adding diagnostic
  fields to the production batch envelope.

#### Acceptance Criteria

- The browser harness reaches ready state without console errors for terrain + buildings + explicit
  objects.
- Static explicit geometry is visibly submitted and counted.
- Transparent and additive explicit ranges reach their existing correct draw phases.
- DXT3 and indexed/palette explicit textures prepare and resolve through the resident atlas.
- Lifecycle reload returns to equivalent resident layer, geometry, and atlas diagnostics.
- Moving the camera anchor evicts stale explicit-object owners without removing current buildings.
- A combined same-landblock dispatch reports one source batch at the maximum requested LoD, not
  concurrent Level 0, Level 1, and Level 2 acquisitions.
- No permanent test depends on local DAT/HBA assets.

#### Task Checklist

- [x] Extend harness CLI parsing, help, app props, LoD construction, and JSON output.
- [x] Add a read-only culling-group diagnostic if current aggregate diagnostics cannot prove layer
      separation; do not expose mutable scene internals.
- [x] Run radius-zero acceptance first, then radius-one lifecycle coverage.
- [x] Compare before/after frame gaps and long tasks to catch a Level 2 main-thread regression.
- [x] Verify batch count, selected LoD, source bytes, and host assembly duration at radius zero
      and radius one; distinguish host batching from frontend realization cost.
- [x] Record live evidence and any explained omissions in this plan.
- [x] Remove temporary screenshots, logs, probes, and asset-dependent tests.

#### Decisions and Course Corrections

- The terrain harness accepts `--explicit-object-radius`, validates it against the building
  radius, forwards it into scene interest, and includes it in its JSON report and lifecycle reload.
- Harness output now separates `staticObjectLayers.buildings` and `staticObjectLayers.objects`.
  Each published layer reports its concrete culling group and scene-node count beside its existing
  geometry/range diagnostics. These are read-only runtime snapshots; scene internals remain
  private.
- The dev content host emits selected cumulative LoD and assembly duration as CORS-exposed response
  headers. Only `HttpLandblockContentSource`, which is the browser-harness adapter, retains each
  response's layer set and byte count as a `sourceBatches` snapshot. The production binary envelope
  and Tauri adapter remain unchanged.
- Harness state includes longest requestAnimationFrame gap and Long Task facts for the current
  browser session, so radius-zero and radius-one evidence can compare the actual main-thread cost.
- The first Level 2 browser run exposed a real coordinator defect: one scene-interest dispatch was
  immediately split into singleton layer preparations, defeating same-landblock batching. The
  coordinator now groups newly requested layers by landblock, performs one pipeline request, and
  fans returned artifacts back into their independent layer dispatches.
- That run then exposed a source-boundary defect in setup hierarchies. DAT root parts use
  `0xFFFFFFFF` in `parent_index`; serializing that value as a JSON parent made the geometry baker
  report a false cycle. The host now projects the sentinel as `null`. A temporary archive-backed
  probe re-emitted `0x0C78FFFF` Level 2, decoded it, and baked the explicit-object source
  successfully; the probe was removed.
- A temporary archive-backed sweep re-emitted, decoded, and baked all documented source witnesses:
  static setup (`0x0C78FFFF`), promoted dynamic (`0x95D6FFFF`, including
  `setup-model/02000331`), transparent (`0xB997FFFF`), additive (`0x376AFFFF`), and DXT3
  (`0x33DAFFFF`). The temporary emitter and asset-dependent test were removed. This proves the
  host/source/bake shape only; browser acceptance below covers WebGL texture preparation, draw
  submission, timing, and lifecycle.
- Browser acceptance passed against the local host with no application console errors. Each
  radius-zero request produced one `{ terrain, buildings, objects }` source batch at cumulative
  LoD 2: static setup `0x0C78FFFF` materialized 37 object residents into 43 ranges (six
  transparent); the deferred-dynamic witness `0x95D6FFFF` materialized 68 static residents while
  carrying three residents through the existing deferred seam; transparent witness `0xB997FFFF`
  visibly submitted one transparent range; additive witness `0x376AFFFF` visibly submitted two
  additive ranges (and six transparent ranges); and DXT3 witness `0x33DAFFFF` resolved its
  direct-color, indexed, and palette atlas inputs and visibly submitted 12 object ranges. The
  DXT3 source identity remains the archive-preflight witness; atlas page diagnostics intentionally
  report texture purpose rather than a second copy of source compression metadata.
- The static setup run transferred 196,612 source bytes and reported 185.8 ms host assembly; the
  additive witness transferred 515,228 bytes and reported 351.0 ms. These are host-source
  measurements, distinct from frontend geometry/atlas realization. The corresponding browser
  sessions reported at most 128.9 ms and 108.9 ms frame gaps respectively, with one or two Long
  Tasks; the radius-one lifecycle session reported 99.2 ms and one Long Task. This is an
  acceptance smoke check, not a performance benchmark: process start, shader compilation, and
  dev-mode browser noise dominate these single runs.
- Radius-one lifecycle reloaded the full 3x3 scene interest twice. Every landblock request was one
  three-layer cumulative-LoD batch per cycle; the anchor reinstalled its 37 static object residents
  and 43 ranges, while empty neighbors published valid empty layer records. The previous atlas
  pages were released before the equivalent replacement set was installed.
- A camera-only move cannot prove ownership eviction because it does not change scene interest.
  The harness now has explicit yaw/pitch controls for visible material witnesses and
  `--relocate-landblock` for an actual interest replacement. Relocating `0x0C78FFFF` to empty
  `0x0C79FFFF` released the old object node, all three atlas pages, and all 38 resident bindings;
  only the new landblock's empty Buildings and Objects records remained. This is the relevant
  eviction proof.

### Phase 7: Resteer, Clean Up, and Close

#### Deliverables

- Audit the completed blast radius for building-only vestiges, duplicated source DTOs, hollow
  generalizations, unconsumed provenance, and diagnostics-driven design.
- Confirm that generated scenery can adopt the shared static-object pipeline later without
  pre-implementing Level 3 behavior.
- Update this plan with executed decisions, evidence, concessions, and remaining work.
- Update `apps/holtburger-3d/ARCHITECTURE_AUDIT.md` if the durable architecture snapshot changed.

#### Acceptance Criteria

- Searches find no obsolete building-only source, worker, artifact, decoder, or texture-input
  vocabulary where behavior is shared.
- No compatibility shim remains for the replaced source contract.
- Every static layer currently installed by the app has a distinct, typed culling group.
- Dynamic explicit residents remain deliberately deferred and are not counted as rendered.
- `npm run test:ts`, `npm run check`, `npm run check:rust`, and `npm run lint` pass.
- Targeted formatting passes for every touched file; any repository-wide baseline formatting debt
  is reported separately rather than rewritten incidentally.
- The browser lifecycle harness passes for terrain + buildings + explicit objects.

#### Task Checklist

- [x] Run targeted vestige searches for `building-source`, `BuildingGeometry`,
      `BuildingLayerSourceCommit`, and related names.
- [x] Review public types and comments for honest layer-neutral vocabulary.
- [x] Review culling diagnostics and tests for actual group separation rather than string snapshots
      alone.
- [x] Run the full verification matrix.
- [x] Refresh the architecture audit where appropriate.
- [x] Mark this plan complete only after live Level 2 lifecycle acceptance.

#### Decisions and Course Corrections

- The final terminology search found no obsolete building-only production source, worker, artifact,
  decoder, or texture-input vocabulary. One shared-artifact comment was corrected to
  `outdoor-static`; the remaining `SyntheticBlendedBuildingPipeline` is intentionally a
  building-only renderer fixture and retains an honestly building-specific resource key.
- The fresh architecture audit now records the outdoor-static source-to-publication spine,
  per-landblock batch boundary, exact layer ownership, temporary failure notification policy, and
  remaining measured risks. It keeps the requested `src-tauri/src/lib.rs` cohesion work deferred.
- Closeout verification passed: 45 TypeScript test files / 206 tests, 17 Rust tests, TypeScript
  and Svelte checking, ESLint, Knip, clippy with warnings denied, Rust formatting, and targeted
  Prettier checks. Repository-wide Prettier debt remains intentionally outside this change.

## Dry-Run Findings Incorporated into the Phases

- `SceneGraph` already stores culling groups beneath scope and landblock maps, so distinct
  `buildings` and `objects` groups require no spatial-index redesign.
- `StaticObjectSystem.replaceObjects` already accepts a typed non-terrain `LandblockLayerKind`; the
  current hard-coded Buildings value exists only in the runtime publication adapter.
- The realizer currently receives an opaque owner and geometry but not a layer. Adding a typed layer
  to the realization/publisher contract is cleaner than decoding it from
  `landblock-layer:<id>/<layer>`.
- `ResolvedObjectLayerSource`, the resident classifier, material planner, geometry transforms,
  texture fact collection, atlas, renderer passes, and static object system are structurally
  reusable.
- The host source closure and frontend decoder already support both direct GfxObjs and setup
  models. Their building branding is now misleading and should be removed before adding a second
  caller.
- The current geometry key suffix contains `building-layer`; it must become layer-aware during the
  worker generalization even though revision-scoped namespaces presently prevent collisions.
- The current runtime sends only Buildings through the realizer and sends other static commit
  shapes directly to `StaticObjectSystem`. Objects must use the realizer because their texture
  requirements need the same atlas-before-publication sequencing.
- Building diagnostics are consumed by the Explorer and browser harness. Generalizing their runtime
  source is necessary for Level 2 acceptance, but Explorer layout remains app-local and may still
  present per-layer sections.
- The browser harness currently accepts only `--building-radius`; Level 2 cannot receive meaningful
  end-to-end or lifecycle acceptance until explicit-object radius is independently controllable.
- Dynamic activation is not a small flag flip: the WebGL2 renderer currently resolves dynamic
  renderables without submitting them. Keeping promoted residents deferred prevents this plan from
  smuggling in an unfinished dynamic renderer.
- Current `Promise.all` source fan-out requests Levels 0, 1, and 2 independently for the same
  cold landblock. `ContentAssetRuntime` single-flights only identical requests, so this repeats
  cumulative assembly. Phase 1/2 batching removes that defect at the existing scene-interest
  transaction boundary; it is not a timer-based optimization.

## Risks and Mitigations

### Transport Generalization Regresses Buildings

**Risk:** Renaming and versioning the only working static-object source path could break Level 1
while Level 2 is being added.

**Mitigation:** Make Phase 2 a clean transport cutover with building equivalence tests before the
pipeline accepts Objects. Do not retain two production envelopes.

### Layer Identity Becomes Ceremonial Provenance

**Risk:** The layer is threaded through types but publication still derives behavior from owner
strings or hard-coded branches.

**Mitigation:** Make layer identity consumed directly by source validation, geometry keys,
diagnostics, culling-group publication, and pipeline dispatch. Tests must assert those effects.

### Culling Groups Accidentally Collapse

**Risk:** A generalized helper chooses a shared static group, coupling replacement/visibility
behavior across layers.

**Mitigation:** Use the exact typed layer kind as the culling group and test same-landblock
Buildings + Objects publication and independent eviction.

### Cumulative LoD Duplicates Work

**Risk:** The current concurrent Level 0/1/2 source fan-out repeats cumulative assembly for a cold
landblock. A future lower-then-higher request could race before the completed-asset cache is
populated.

**Mitigation:** Make a per-landblock source batch mandatory in Phase 1/2: acquire the maximum
requested LoD once and project only requested typed records into independent commits. Add an
in-flight coordinator so equal-or-higher overlapping requests share work, while a higher request
after a lower one waits and extends. This is immediate dispatch batching, not debounce, hysteresis,
or speculative prefetch.

### Source Batching Leaks Into Runtime Ownership

**Risk:** A convenient batch DTO becomes a shared runtime artifact, re-coupling layer readiness,
eviction, or culling after source acquisition.

**Mitigation:** Keep the batch envelope at the host-data boundary. Validate and fan out typed layer
records before commit construction; every commit, realization, culling group, diagnostic, and
eviction decision remains layer-local. Shared core code sees only landblock and cumulative LoD
coordination, never app layer-set or transport DTOs.

### Explicit Objects Expand Material Coverage

**Risk:** Transparency, additive blending, DXT3, or setup-part transforms expose defects that
building samples could not.

**Mitigation:** Use the documented explicit-object evidence samples, keep material rules grounded in
retail/ACViewer behavior, and fix shared material or texture primitives rather than adding
Objects-only branches.

### Deferred Dynamics Are Mistaken for Success

**Risk:** A Level 2 layer reports all source residents as materialized even though default-animated
residents are intentionally absent.

**Mitigation:** Keep resolved-static, materialized-static, promoted-dynamic, and
runtime-deferred counts separate. Never include deferred residents in geometry or draw metrics.

### One Baked Node Is Too Coarse

**Risk:** Explicit-object density makes one landblock-layer bound expensive for visibility and
transparent sorting.

**Mitigation:** Preserve one allocation and one culling-group entry for the first cut, measure
radius-one frame behavior, and defer clustering/instancing until observed cost justifies a new
ownership shape.

### Async Transfer Detaches Shared Buffers

**Risk:** Building and explicit layers resolved concurrently may share `ArrayBuffer` instances;
transferring one job could detach data required by another job.

**Mitigation:** Verify whether decoded layer closures own independent typed arrays and add a focused
concurrent-worker test. If sharing is introduced later, transfer ownership must be explicit or
worker inputs must use dedicated buffers.

## Definition of Done

- [ ] Level 2 explicit objects load from both Tauri and headless HTTP hosts.
- [ ] Buildings still load through the generalized source capability.
- [ ] A cold same-landblock terrain + buildings + objects dispatch performs one maximum-Level-2
      source acquisition and fans out independent commits.
- [ ] Overlapping lower/higher source batches coalesce or extend without competing cumulative
      assemblies.
- [ ] Static direct-GfxObj and setup-backed explicit residents render.
- [ ] Building and object layers use distinct `buildings` and `objects` culling groups.
- [ ] Layer replacement and eviction are independent.
- [ ] Shared logical textures retain correct cross-owner atlas residency.
- [ ] Transparent, additive, indexed/palette, and DXT3 explicit materials render through shared
      paths.
- [ ] Default-animated explicit residents remain complete but deferred.
- [ ] Deferred residents create no dynamic runtime or renderer resources.
- [ ] Runtime and Explorer diagnostics distinguish Buildings from Objects and do not count deferred
      residents as rendered.
- [ ] Radius-zero and radius-one lifecycle browser harness runs reach ready state without browser
      errors.
- [ ] Stale, failed, replacement, and eviction paths release provisional claims and resources.
- [ ] Building-only implementation vestiges in generalized code are removed.
- [ ] Full TypeScript/Rust tests, checks, clippy, lint, and targeted formatting pass.
- [ ] No permanent asset-dependent tests or temporary diagnostics remain.
- [ ] This plan and the architecture audit reflect the final implemented shape.

## Open Questions

No product or architectural question currently blocks execution. The following are evidence-driven
checkpoints rather than preconditions:

- Whether one baked explicit-object allocation per landblock remains acceptable at radius one.
- Whether any explicit-object material behavior reveals a shared renderer defect requiring a
  ground-truth correction.

These checkpoints must be answered through measurement during execution; they do not authorize
cross-layer payload deduplication, clustering, instancing, or dynamic rendering in this plan.
