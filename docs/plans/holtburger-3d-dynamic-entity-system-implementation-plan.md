# Holtburger 3D Dynamic Entity System Implementation Plan

## Context

The dynamic entity requirements gate is satisfied for the first static-authored default-animation
slice. The requirements source remains
[docs/plans/holtburger-3d-dynamic-entity-system-requirements-plan.md](holtburger-3d-dynamic-entity-system-requirements-plan.md).

This implementation plan turns that resolved first slice into a phased build path. The first target
is outdoor static-authored setup `0x020003e5` with default animation `0x0300061b`. The immediate
follow-up target is `0x020005ac` with animation `0x03000751` and a frame-0 `SetOmega` hook.

The implementation should prove dynamic seed ingestion, animation asset lookup, runtime-owned
dynamic state, live part-frame playback, dynamic query/index records, renderer submission, and
diagnostics without designing the entire live player/creature/equipment system up front.

## Resolved Evidence Carried Forward

This section carries the minimum evidence from the requirements dry run so this implementation plan
can stand alone during execution.

First target evidence:

- Static-authored outdoor setup `0x020003e5` is the first target.
- It has default animation `0x0300061b`.
- The setup has five parts, no default script, no default motion table, no default sound table, and
  no default script table.
- Animation `0x0300061b` has five parts, 60 frames, no object position frames, and no hooks.
- Harness evidence shows the animation moves both per-part origins and orientations. Four blade
  parts move about `7.47` units from frame-0 origin over the sampled cycle, while the hub part has
  fixed origin and changing orientation.
- User retail-client visual check identifies the target as windmill blades that rotate continuously
  as soon as the scene loads.
- This target proves the first slice must evaluate live animation part frames. It does not require
  hook execution, physics scripts, motion-table selection, object position frames, particles, sounds,
  or material transitions.

Second target evidence:

- Static-authored outdoor setup `0x020005ac` is the immediate follow-up target.
- It has default animation `0x03000751`.
- The setup has two parts, no default script, no default motion table, no default sound table, and no
  default script table.
- Animation `0x03000751` has two parts, seven frames, no object position frames, and one frame-0
  `SetOmega` hook.
- Harness evidence decodes the `SetOmega` payload as vector `(0.0, 0.0, -0.038397)`.
- User retail-client visual check identifies the target as a bird that flaps its wings while
  circling a spot continuously.
- This target is the first transform-side hook validation target. Rendering it without omega support
  is acceptable only as a diagnosed visual compromise.

Current code blockers:

- `StaticAuthoredDynamicSeedRecord` currently represents env-cell static object seeds only. The
  outdoor windmill target cannot be modeled honestly until the union includes outdoor static-authored
  dynamic seed facts.
- Setup payloads expose `defaultAnimation`, but animation assets are not first-class frontend asset
  payloads. There is no `animation/0300....` route through `ContentAssetRequest`, Tauri asset id
  parsing, Tauri JSON serialization, frontend zod validation, or asset preparation.
- The runtime/browser picking path is static-shaped through `pickStaticRay`,
  `StaticScenePickRequest`, `StaticScenePickHit`, and `StaticSceneSelectionKey`.
- Reusable static object visual resources exist, but today they are installed through outdoor-detail
  static layer replacement. Dynamic rendering must generalize the reusable resource helpers without
  making static layer lifetime own dynamic entity lifetime.

Selection and query evidence:

- User retail-client visual checks confirm both `0x020003e5` and `0x020005ac` are not selectable in
  retail.
- Dynamic query membership therefore must not imply default browser selection. The dynamic query
  path must support inspection/debug hits while caller filters decide selection, targeting, or
  gameplay behavior.

Phase-order rationale:

- DTO and seed plumbing come before renderer work because the first target cannot enter the frontend
  runtime honestly without an outdoor seed variant and animation asset payload.
- Runtime/resource/playback work comes before renderer commits because renderer submissions should
  consume current semantic dynamic state, not create it.
- Query/index work comes before validation because the first visible target must be inspectable and
  must prove that default selection is caller policy over query results.
- Renderer work comes after shared-resource boundaries are clear so dynamic entities do not become
  static outdoor-detail instances with animated-looking transforms.

## Dry Run Findings

Recorded on 2026-06-26 after simulating the phases against the current codebase.

The phase order is viable, but several implementation details need to be pinned before execution:

- Phase 1 touches more than the obvious route parser. Animation assets must be added to
  `ContentAssetRequest`, `ContentAsset`, `ContentAssetService::load`, Tauri asset-id parsing,
  Tauri JSON response dispatch, frontend host schemas, `HostAssetKeyKind`, `HEX32_ROUTE_KINDS`,
  `isKnownHostAssetKeyKind`, and `V2_PAYLOAD_PARSERS`. Binary lookup should either explicitly reject
  animation routes or remain unaffected with tests proving JSON lookup is used.
- `prepareV2StaticAssetPayload` is now a misleading name for a route parser that will include
  animation payloads. Do not rename it during Phase 1 unless the diff is small; if it remains, record
  it as cleanup debt and rename it during the cleanup phase.
- `holtburger-dat` currently keeps hook `22` / `SetOmega` as raw 12-byte payload. Phase 1 should
  preserve raw payload bytes and hook names for all known hooks. Typed `SetOmega` decoding can land in
  Phase 1 if small, but it is a hard precondition before the Phase 10 follow-up proceeds to actual
  omega behavior.
- Outdoor seed records cannot simply be added to `StaticAuthoredDynamicSeedRecord` and then pushed
  through the existing `StaticSceneQuery.applyStaticPeerRecords` path. That code assumes authored
  dynamic seeds are env-cell seeds with `envCellId`, including committed-key creation and
  `groupEnvCellSeedsByLandblockAndEnvCell`. Either filter outdoor dynamic seeds before static scene
  query ingestion or split env-cell static seeds from outdoor dynamic seeds at the materialized
  commit boundary.
- The static object source closure already has setup payloads, setup appearance, part/gfx/material
  facts, and default placement facts. Classification should happen before compatibility
  partitioning/bake output so dynamic seeds are never flattened into baked draw units. Classifying in
  the baker after partitioning would be too late and would still spend the duplicated geometry work.
- Missing setup appearance is not automatically fatal today. `tryLoadSetupAppearance` records a
  missing ref and continues with setup parts. Dynamic resource readiness should preserve that behavior
  for the first target unless a selected target proves appearance materialization is required.
- Texture binding ownership is currently `draw-unit` or `static-object-visual-resource`. Dynamic
  renderer resources need a neutral visual-resource binding owner or a dynamic owner variant; reusing
  a static owner name for dynamic resources would leak static lifetime semantics.
- The current WebGL2 reusable visual resource maps and diagnostics are named static-object-specific
  and are installed through static layer replacement. Phase 8 must extract or generalize helper
  functions before adding dynamic commits; it should not make dynamic renderer state another entry in
  `#staticObjectRenderInstances`.
- Query migration affects browser picking and diagnostics, not only `StaticSceneQuery`. Existing
  browser code builds `StaticScenePickRequest` and displays static selection diagnostics. Phase 7
  must include compatibility naming and UI diagnostics cleanup in its migration debt.

## Goal

Render and inspect the first static-authored dynamic outdoor target through a real dynamic entity
runtime instead of baking it into static draw units.

## Scope

In scope:

- Outdoor static-authored dynamic seed records for setup-backed sources with `defaultAnimation`.
- First-class animation asset lookup through host/content/Tauri/frontend asset contracts.
- A browser frontend dynamic runtime for static-authored seeds.
- Setup default animation playback using integer part-frame sampling.
- A hook-generic dispatcher shape with unsupported-hook diagnostics.
- Dynamic current-frame bounds, effective outdoor residence, and spatial query records.
- A merged scene-query API surface that can return static and dynamic hit variants.
- Renderer dynamic resource and instance commits for outdoor dynamic parts.
- Diagnostics for seed classification, resource readiness, animation frame state, bounds/index
  membership, renderer submission counts, and unsupported hooks.
- End-to-end validation against `0x020003e5`.

Out of scope for this first implementation plan:

- Live host-spawned players, creatures, equipment, projectiles, or combat entities.
- Browser/client-authored spawn ownership, TTL, or explicit destruction APIs.
- Full motion-table animation selection.
- Physics script playback.
- Broad hook execution beyond the dispatcher shell and planned `SetOmega` follow-up.
- Particle, sound, light, material transition, replacement-object, `NoDraw`, `Scale`,
  `DefaultScript`, and `DefaultScriptPart` support.
- Dynamic atlasing, VAO compaction, WebGL2 instanced draws, or dynamic workers.
- Treating dynamic scenery as default browser-selectable. The first targets are inspectable/debug
  query records but not default selection targets.

## Ground Truth

Primary sources:

- [docs/plans/holtburger-3d-dynamic-entity-system-requirements-plan.md](holtburger-3d-dynamic-entity-system-requirements-plan.md)
- [docs/plans/holtburger-3d-shared-render-instance-static-instancing-plan.md](holtburger-3d-shared-render-instance-static-instancing-plan.md)
- `crates/holtburger-dat/src/file_type/animation.rs`
- `crates/holtburger-dat/src/file_type/setup_model.rs`
- `crates/holtburger-core/src/content_assets.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/ids.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/service.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/json.rs`
- `apps/holtburger-3d/src/lib/host/contracts.ts`
- `apps/holtburger-3d/src/lib/assets/contracts.ts`
- `apps/holtburger-3d/src/lib/assets/preparation/route-payloads.ts`
- `apps/holtburger-3d/src/lib/static/contracts.ts`
- `apps/holtburger-3d/src/lib/static/objects/static-object-source-closure.ts`
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-compatibility-baker.ts`
- `apps/holtburger-3d/src/lib/runtime/static-scene-query.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/lib/renderer/types.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`

Reference sources:

- `ACViewer/` for setup, animation, material, and render interpretation.
- `ACE/` for authoritative world/session semantics where dynamic runtime behavior touches live entity
  concepts.
- `acclient-eor-source/` only as secondary evidence for retail transform, animation, hook, and
  selection behavior. Do not modify it.

Verification commands:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`
- `cd apps/holtburger-3d && npm run check:rust`
- `cd apps/holtburger-3d && npm run lint:rust`
- Focused Rust tests for touched crates when content asset routing changes.

## Non-Negotiable Rules

- Do not route dynamic entities through static baked draw units, `StaticObjectRenderInstance`,
  `setOutdoorDetailsLayer`, or static layer-owned lifetimes.
- Do not embed evaluated per-frame animation transforms in setup payloads or stream them across the
  bridge.
- Host route strings stay transport/provenance only. Runtime records use typed identities or opaque
  keys derived from typed identities.
- Dynamic source residence and effective presentation residence remain separate. Effective residence
  drives render, index, and query membership; it does not mutate source truth.
- Dynamic records store landblock-local transforms and bounds. Scene/render-local transforms are
  derived at submission/query time.
- Unsupported render-affecting hooks must be reported through diagnostics and console warnings with
  enough context to identify entity, timeline, frame/time, hook id/name, and skipped effect.
- Missing required dynamic resources make the entity currently non-renderable. Do not silently fall
  back to baked static rendering.
- The merged scene-query surface owns hit merging. Browser selection, debug inspection, and gameplay
  targeting are caller filters over that surface.
- Add any dynamic broadphase package through package-manager tooling during implementation. Do not
  assume a version in this plan.

## Proposed Module Shape

Initial TypeScript homes should stay in `apps/holtburger-3d/src/lib/dynamic/` unless implementation
evidence proves a narrower or shared location:

```text
apps/holtburger-3d/src/lib/dynamic/
  contracts.ts
  dynamic-entity-controller.ts
  dynamic-entity-store.ts
  dynamic-entity-resource-manager.ts
  dynamic-animation-player.ts
  dynamic-hook-dispatcher.ts
  dynamic-placement-tracker.ts
  outdoor-dynamic-spatial-index.ts
  dynamic-scene-query.ts
  dynamic-diagnostics.ts
```

Renderer-facing dynamic contracts belong with renderer contracts, not the dynamic store:

```text
apps/holtburger-3d/src/lib/renderer/types.ts
apps/holtburger-3d/src/lib/renderer/webgl2/
```

The exact file split can change during implementation, but ownership must not: the dynamic runtime
owns semantic state, the renderer owns GPU realization, and the static pipeline only discovers
static-authored dynamic seed facts.

## Implementation Phases

### Phase 1: Animation Asset Route And DTO Contract

Status: completed.

Purpose:

- Make animation data a first-class prepared asset so dynamic playback consumes decoded authored
  animation data instead of setup payload stuffing or per-frame bridge output.

Deliverables:

- Add `Animation(u32)` to `ContentAssetRequest` and `Animation` to `ContentAsset`.
- Load `holtburger_dat::file_type::Animation` from `EOR_PORTAL_NAMESPACE`.
- Add `animation/0300....` parsing in `apps/holtburger-3d/src-tauri/src/adapter/ids.rs`.
- Add Tauri JSON serialization for `AnimationAssetPayload`.
- Add `animation` to `HostAssetKeyKind`, asset key parsing/formatting, and route preparation.
- Add zod schemas and exported TypeScript DTO types for animation payloads.
- Preserve object position frames, per-part frame origins/orientations, frame counts, part counts,
  flags, and decoded hook summaries where available.
- Preserve raw hook payload bytes for known hooks whose payloads are not typed yet. Include stable
  hook names and hook ids so diagnostics remain useful before full hook support.
- Either add typed `SetOmega` payload decoding now or record it as a Phase 10 blocker before omega
  behavior is implemented.

Acceptance criteria:

- `animation/0300061b` and `animation/03000751` can be requested through the existing asset service
  path.
- Contract tests prove valid animation payloads parse and malformed payloads fail loudly.
- Rust tests cover content asset request routing for a valid animation id and a missing animation id.
- No setup payload contains copied animation frame data.
- Unknown or unsupported hook payloads are preserved as raw bytes with hook id/name/direction rather
  than dropped.

Task checklist:

- [x] Extend Rust content asset request/result enums.
- [x] Add animation asset id parse/format helpers.
- [x] Serialize animation frames and hooks with typed DTO names.
- [x] Add frontend host schema and route payload preparation.
- [x] Update host asset key parsing, hex32 route kind handling, and known-kind guards.
- [x] Update JSON response dispatch and binary-route rejection/ignore tests.
- [x] Add unit tests on Rust and TypeScript boundaries.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: Phase 1 keeps animation assets on the direct JSON lookup path. Binary lookup remains
  explicitly unsupported for animation until payload size or streaming evidence proves binary
  sections are needed.
- 2026-06-26: Typed `SetOmega` decoding was not added in Phase 1. Animation payloads preserve
  `SetOmega` as a named hook with raw 12-byte payload bytes, and Phase 10 must add typed decoding
  before omega behavior is implemented.
- 2026-06-26: `prepareV2StaticAssetPayload` now parses animation payloads, so the name is broader
  than static assets. This remains cleanup debt for Phase 11 rather than being renamed during the
  route diff.
- 2026-06-26: Verification results: `cargo test -p holtburger-core content_asset_service_`,
  `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml animation`,
  `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run check:rust`,
  `npm run lint:rust`, and `npm run test:ts` pass.
- 2026-06-26: Two stale static-demand tests expected a cross-shaped radius-1 outdoor footprint with
  5 landblocks. Existing `buildOutdoorCoverageLandblocks` behavior and demand-planner tests define
  radius 1 as the full padded 3x3 neighborhood, so the tests were updated to expect 9 terrain
  requests and 9 retained active work scopes after anchor movement.

### Phase 2: Outdoor Static-Authored Dynamic Seed Contract

Status: pending.

Purpose:

- Represent outdoor default-animation setup sources as dynamic seeds before they reach static bake
  flattening.

Deliverables:

- Expand `StaticAuthoredDynamicSeedRecord` from env-cell-only to a union that includes outdoor static
  object dynamic seeds.
- Define outdoor seed facts: owner/scope, domain, landblock id, static object identity, source key,
  setup id, default animation id, source residence, landblock-local base transform, source scale, and
  classification reason.
- Update static source resolution/classification to identify setup-backed sources with
  `defaultAnimation`.
- Divert supported dynamic seeds out of the baked static object draw-unit path.
- Keep unsupported or missing-resource dynamic seeds visible in diagnostics rather than hiding them.
- Split or filter seed flow so outdoor dynamic seed records do not enter env-cell-only static scene
  query helpers that assume `envCellId`.

Acceptance criteria:

- The `0x020003e5` outdoor static source appears as an outdoor dynamic seed record.
- The same source is not emitted as baked outdoor-detail static geometry once classified dynamic.
- Existing env-cell dynamic seed tests continue to pass after the union expansion.
- Static bake diagnostics show dynamic seed classification counts or reasons.
- Outdoor dynamic seed records do not break `StaticSceneQuery` committed-record keys, env-cell seed
  grouping, or env-cell system layer assembly.

Task checklist:

- [ ] Add outdoor seed record type and descriptive helpers.
- [ ] Update static contracts, coordinator commits, materializer forwarding, and tests.
- [ ] Add classification in the outdoor static object resolver or source-closure path before bake.
- [ ] Filter or split outdoor seed records before env-cell-only static scene query ingestion.
- [ ] Add regression coverage for the windmill-style setup default animation case.
- [ ] Run phase verification commands.

Decisions and course corrections:

- Pending.

### Phase 3: Dynamic Entity Store And Static Scope Reconciliation

Status: pending.

Purpose:

- Introduce the runtime-owned semantic entity records that normalize static-authored dynamic seeds
  without creating renderer-owned truth.

Deliverables:

- Add `DynamicEntityId` and typed `DynamicEntityRecord` state for provenance, source residence,
  effective residence, base transform, resources, animation state, transform state, bounds/index
  state, renderability, and diagnostics.
- Add `DynamicEntityStore` backed by `Map<DynamicEntityId, DynamicEntityRecord>`.
- Add `DynamicEntityController.ingestStaticSeed()` and static-scope reconciliation.
- Remove dynamic records, spatial index entries, leases, and renderer submissions on static scope
  eviction.
- Expose a diagnostics snapshot for static seed count, active entity count, non-renderable entities,
  and current issues.

Acceptance criteria:

- Static seeds create stable dynamic records keyed by source/scope identity.
- Re-ingesting the same static revision is idempotent.
- Scope eviction removes the dynamic record and all derived state.
- Missing resources keep the source record alive but non-renderable.

Task checklist:

- [ ] Define dynamic runtime contracts and record types.
- [ ] Implement dynamic store helpers with narrow mutation APIs.
- [ ] Wire controller creation into `ClientRuntimeImpl`.
- [ ] Forward materialized dynamic seed records to the controller.
- [ ] Add unit tests for ingest, idempotence, replacement, and eviction.
- [ ] Run phase verification commands.

Decisions and course corrections:

- Pending.

### Phase 4: Dynamic Resource Readiness

Status: pending.

Purpose:

- Hydrate setup, appearance/gfx/material/texture, and animation dependencies through the existing
  asset service while keeping dynamic resource readiness separate from static bake output.

Deliverables:

- Add `DynamicEntityResourceManager`.
- Give `DynamicEntityResourceManager` typed resource keys for dynamic-authored dependencies. The
  first implemented key set is setup model, setup appearance, animation, and visual/material/texture
  resources; reserve explicit key variants for future per-resource table families such as motion
  table, sound table, physics script, and physics script table.
- Implement the manager as a shared keyed cache with in-flight request dedupe, committed resource
  reuse, reference-counted leases, and release-on-entity-removal semantics. Multiple entities that
  reference the same setup, animation, motion table, sound table, or script table must converge on
  one prepared resource entry instead of performing per-entity duplicate hydration.
- Do not introduce a startup-hydrated global animation/motion/script/effect lookup table. Authored
  setup and hook data already carries direct DAT ids; per-resource tables are loaded by those ids
  only when referenced by active entities or implemented hook/playback behavior.
- Request setup model and animation payloads from static seed facts.
- Reuse existing setup/gfx/material/texture preparation helpers where their facts are isomorphic.
- Track leases for committed prepared resources.
- Record missing required dependencies and unsupported dependency references.
- Mark records renderable only when all first-target required resources are ready.
- Treat missing setup appearance as non-fatal for the first target when base setup parts, part/gfx,
  material/texture resources, and animation are available.

Acceptance criteria:

- `0x020003e5` reaches renderable resource readiness when setup, parts/materials/textures, and
  animation are available.
- Missing animation or setup resources make the entity non-renderable with explicit diagnostics.
- Missing setup appearance is diagnosed but does not block rendering when setup-provided parts are
  sufficient.
- Resource readiness does not create or depend on baked static draw units.
- Two dynamic entities that request the same prepared animation or setup resource share one committed
  manager entry and hold separate leases.
- The first-slice manager has no ambient startup table load and no global LUT required for
  animation/motion/script/effect lookup.
- Resource leases are released on entity removal.

Task checklist:

- [ ] Define dynamic resource state and issue types.
- [ ] Define typed dynamic resource keys, including reserved future table key variants.
- [ ] Implement shared resource request, in-flight dedupe, committed reuse, lease acquisition, and
      release handling.
- [ ] Prove duplicate entity references to the same setup or animation share one committed resource
      entry.
- [ ] Prove no startup-hydrated global lookup table is required for first-slice dynamic resources.
- [ ] Reuse or extract part-agnostic material/visual resource preparation helpers.
- [ ] Add tests for success, missing animation, missing setup, dedupe, and lease release.
- [ ] Run phase verification commands.

Decisions and course corrections:

- Pending.

### Phase 5: Animation Playback And Hook Dispatcher Shell

Status: pending.

Purpose:

- Play setup default animation locally for static-authored dynamic entities and establish the
  hook-generic dispatch shape needed for `SetOmega`.

Deliverables:

- Add `DynamicAnimationPlayer`.
- Start setup default animation from frame 0 at 30 frames per second for static-authored first-slice
  records.
- Sample integer part frames using `floor(frame_number)`.
- Apply active animation part frame origin and orientation as current part pose, not as a delta on
  setup default placement.
- Add `DynamicHookDispatcher` with no-op and unsupported-hook diagnostic paths.
- Preserve hook invocation context even when no handler exists.

Acceptance criteria:

- The windmill target advances frames and produces current part poses for all five parts.
- Active animation frames replace setup/default placement frames during playback.
- Hook-free animation produces no unsupported-hook diagnostics.
- A fixture animation with an unsupported hook records entity, asset id, frame, hook id/name, and
  skipped effect.

Task checklist:

- [ ] Add animation playback state to dynamic records.
- [ ] Implement integer frame advancement and looping.
- [ ] Implement current part-pose output.
- [ ] Add hook invocation DTO/runtime type.
- [ ] Add unsupported-hook diagnostics and tests.
- [ ] Run phase verification commands.

Decisions and course corrections:

- Pending.

### Phase 6: Dynamic Placement, Bounds, And Outdoor Spatial Index

Status: pending.

Purpose:

- Convert current animation/resource state into landblock-local bounds and query/index membership.

Deliverables:

- Add `DynamicPlacementTracker`.
- Compute current-frame part transforms and conservative bounds from current renderable geometry.
- Resolve effective outdoor presentation residence from current pose/bounds while preserving source
  residence.
- Add `OutdoorDynamicSpatialIndex` behind a small local interface.
- Use existing outdoor landblock-grid traversal as the outer query candidate phase.
- Add the chosen mutable 2D AABB dependency through `npm` during implementation.
- Keep env-cell dynamic membership flat for now.

Acceptance criteria:

- Current-frame dynamic bounds update as animation frames change.
- Dynamic index membership is keyed by effective outdoor landblock membership.
- Cross-boundary bounds can be indexed into every overlapped outdoor landblock.
- Removing an entity removes all index items.
- The index wrapper is tested independently of browser runtime.

Task checklist:

- [ ] Add package dependency with package-manager tooling.
- [ ] Define dynamic bounds and precision metadata types.
- [ ] Implement placement and bounds derivation.
- [ ] Implement outdoor dynamic index wrapper and tests.
- [ ] Wire placement/index sync into controller tick order.
- [ ] Run phase verification commands.

Decisions and course corrections:

- Pending.

### Phase 7: Merged Scene Query Surface

Status: pending.

Purpose:

- Replace static-only caller semantics with a scene query that can merge static and dynamic hits
  without making query membership equal default selection.

Deliverables:

- Add scene-query request/hit types with static and dynamic variants.
- Preserve existing static hit behavior as one variant.
- Add dynamic hit records with semantic dynamic entity id, source/setup metadata, optional part
  metadata, bounds, distance, hit point, precision, and filter metadata.
- Add caller filters for default browser selection, debug inspection, and diagnostics.
- Migrate runtime/browser call sites from `pickStaticRay` toward the merged query surface.
- Keep a temporary static compatibility wrapper only if needed for small-step migration, and mark it
  as cleanup debt.
- Update browser selection diagnostics so dynamic inspection does not depend on static selection-key
  labels.

Acceptance criteria:

- Existing static picking tests pass through the merged query path.
- Dynamic AABB hits are ordered with static hits by nearest distance.
- Default browser selection filters exclude the two static-authored dynamic scenery targets.
- Debug/inspection filters can return those same dynamic targets.
- Any remaining `pickStaticRay` wrapper is documented as temporary cleanup debt with no new callers
  added.

Task checklist:

- [ ] Define merged query contracts.
- [ ] Add static adapter from current `StaticSceneQuery`.
- [ ] Add dynamic query adapter from `OutdoorDynamicSpatialIndex`.
- [ ] Update browser picking and diagnostics call sites.
- [ ] Add tests for hit ordering and filter policy.
- [ ] Run phase verification commands.

Decisions and course corrections:

- Pending.

### Phase 8: Dynamic Renderer Resource And Instance Commits

Status: pending.

Purpose:

- Render dynamic entity parts through declarative dynamic commits while sharing visual-resource and
  material primitives with static generated instancing.

Deliverables:

- Add renderer-facing dynamic resource and instance commit types.
- Generalize reusable visual resource upload/cache helpers currently tied to outdoor-detail static
  layer replacement.
- Add WebGL2 dynamic resource installation/removal and per-frame dynamic instance submission.
- Use live per-part transforms from dynamic runtime.
- Keep dynamic resource identity separate from semantic dynamic entity identity.
- Add renderer diagnostics for dynamic visual resources, dynamic instances, dynamic draw calls, and
  skipped dynamic submissions.
- Add neutral or dynamic texture-binding owner records for dynamic visual resources instead of
  pretending they are static object visual resources.

Acceptance criteria:

- The renderer can draw the windmill target from dynamic resource/instance commits.
- Dynamic submissions do not go through static layer payloads or `StaticObjectRenderInstance`.
- Dynamic renderer state is not stored in `#staticObjectRenderInstances` and is not cleared through
  static layer replacement ownership.
- Removing a dynamic record removes renderer submissions/resources that are no longer leased.
- Existing static rendering diagnostics remain stable.

Task checklist:

- [ ] Define dynamic renderer commit DTOs.
- [ ] Extract/generalize visual resource upload helpers.
- [ ] Implement WebGL2 dynamic resource storage and draw path.
- [ ] Commit dynamic snapshots from `DynamicEntityController`.
- [ ] Add renderer and runtime tests for add/update/remove.
- [ ] Run phase verification commands.

Decisions and course corrections:

- Pending.

### Phase 9: Diagnostics And First-Target Validation

Status: pending.

Purpose:

- Make the first slice reviewable and prove that `0x020003e5` is dynamic, animated, indexed, and
  rendered for the right reasons.

Deliverables:

- Add dynamic diagnostics to runtime snapshots/reports.
- Surface classification reason, source residence, effective residence, setup id, animation id,
  current frame/time, part count, bounds, index membership, resource readiness, renderer submission
  counts, and issues.
- Add debug overlay support for dynamic bounds where useful.
- Validate `0x020003e5` manually in the browser app.
- Record evidence and any visual concessions in this plan.

Acceptance criteria:

- Diagnostics can explain why the windmill is dynamic and currently renderable.
- The windmill animates from per-part origin/orientation frames.
- It is debug/inspection-queryable but not default browser-selectable.
- Missing dynamic dependencies or unsupported hooks are visible in diagnostics and console output.
- No runtime asset dependent tests are retained in the repo.

Task checklist:

- [ ] Add diagnostics projection and browser report fields.
- [ ] Add dynamic bounds debug overlay if needed for validation.
- [ ] Validate target in browser mode with real DAT/static scene data.
- [ ] Update this plan with validation evidence, decisions, and concessions.
- [ ] Run full verification commands.

Decisions and course corrections:

- Pending.

### Phase 10: Resteer For SetOmega Follow-Up

Status: pending.

Purpose:

- Reassess the architecture after the hook-free target before implementing the first transform hook.

Questions to answer:

- Did DTO, runtime, renderer, and query contracts stay clean enough for `SetOmega`?
- Are dynamic bounds updates cheap and accurate enough for current-frame animated geometry?
- Did merged query migration leave any static-only wrapper debt?
- Did renderer visual-resource generalization create duplicated static/dynamic material logic?
- Is `0x020005ac` still the right next target?

Acceptance criteria:

- The plan records whether to proceed directly to `SetOmega`, split cleanup first, or revise the
  dynamic runtime shape.
- Any blocking debt is converted into explicit tasks before new hook behavior is added.

Task checklist:

- [ ] Review implementation diff and diagnostics.
- [ ] Compare first-target behavior against requirements evidence.
- [ ] Add typed `SetOmega` payload decoding before implementing omega transform behavior.
- [ ] Update future phases before proceeding.

Decisions and course corrections:

- Pending.

### Phase 11: Cleanup And Cutover Hardening

Status: pending.

Purpose:

- Remove transitional naming, wrappers, and duplication introduced during the first slice.

Cleanup targets:

- Temporary `pickStaticRay` compatibility wrappers after merged query migration.
- Static-only visual-resource helper names that now serve dynamic rendering too.
- `prepareV2StaticAssetPayload` if Phase 1 leaves that name in place after adding animation assets.
- Redundant dynamic/static material interpretation helpers.
- Diagnostics fields that were useful during bring-up but are hollow or misleading.
- Any tests that only assert removed behavior or debug-only logging.

Acceptance criteria:

- No dead transitional wrappers remain unless this plan records a concrete reason and owner.
- Shared helpers have honest names and ownership.
- Lint/dead-code checks pass or existing unrelated findings are documented.
- The implementation plan is updated with completed decisions and remaining full-system gates.

Task checklist:

- [ ] Remove temporary wrappers and stale names.
- [ ] Delete hollow or legacy-path tests.
- [ ] Re-run full verification commands.
- [ ] Update this plan with final first-slice status.

Decisions and course corrections:

- Pending.

## Risks And Mitigations

- Risk: dynamic seeds accidentally remain in baked static output.
  Mitigation: add tests that assert default-animation seeds are diverted and not baked for the first
  target.

- Risk: animation route work leaks host route strings into runtime identity.
  Mitigation: keep route strings at host/preparation boundaries and create typed animation identity
  records in dynamic runtime state.

- Risk: renderer visual-resource reuse becomes a static-layer dependency.
  Mitigation: extract/generalize helpers before adding dynamic commits; do not call
  `setOutdoorDetailsLayer` for dynamic resources.

- Risk: merged query becomes a debug-only path.
  Mitigation: migrate browser picking through the merged scene-query surface and express default
  selection as filters.

- Risk: current-frame AABB bounds are too conservative or visibly wrong.
  Mitigation: expose precision metadata and part bounds diagnostics; defer per-part sphere/polygon
  precision until a target proves it is needed.

- Risk: new broadphase dependency adds type or package churn.
  Mitigation: hide it behind `OutdoorDynamicSpatialIndex` and add it through `npm` tooling during
  implementation.

- Risk: resource readiness duplicates static material logic.
  Mitigation: extract part-agnostic helpers only where facts are isomorphic; avoid dynamic-only
  material interpretation.

- Risk: dynamic resources become either per-entity duplicate loads or a fake process-global
  animation/motion/script/effect LUT.
  Mitigation: keep the resource manager keyed by typed DAT resource ids, dedupe and lease shared
  prepared entries, and load per-resource table assets only when referenced by active entities or
  implemented behavior.

- Risk: outdoor dynamic seed records poison env-cell-only static scene query helpers.
  Mitigation: split or filter seed flows at materialized commit ingestion until static scene query
  supports outdoor dynamic seeds intentionally.

- Risk: `SetOmega` remains raw bytes when the follow-up target starts.
  Mitigation: keep raw hook payload diagnostics in Phase 1 and require typed `SetOmega` decoding
  before Phase 10 proceeds to transform behavior.

## Definition Of Done

- `0x020003e5` is rendered through the dynamic runtime, not baked static geometry.
- The target plays default animation `0x0300061b` with live per-part origin/orientation frames.
- Dynamic resource readiness uses setup, available setup appearance/gfx/material/texture facts, and
  animation assets through the asset service; missing setup appearance is allowed only when the
  setup-provided part resources are sufficient and diagnostics say so.
- Dynamic renderer submissions use explicit dynamic resource and instance commits.
- Dynamic current-frame bounds are indexed and queryable through the merged scene-query surface.
- Browser default selection excludes the first static-authored dynamic scenery target, while
  debug/inspection queries can report it.
- Diagnostics explain dynamic classification, readiness, playback, bounds, index membership, and
  renderer submission state.
- Unsupported hooks are preserved and diagnosed.
- Full verification commands pass, or unrelated pre-existing failures are documented.
- This plan is updated with completed decisions, concessions, and remaining full-system open gates.

## Open Questions

- Which mutable 2D AABB package should back `OutdoorDynamicSpatialIndex`? Choose during
  implementation with package-manager tooling.
- Should the first target validation get a dedicated browser diagnostics panel row, or is the
  existing diagnostics report enough once dynamic fields are added?
- After the first target lands, should `SetOmega` be implemented immediately or should query/renderer
  cleanup happen first? Phase 10 owns that call.
