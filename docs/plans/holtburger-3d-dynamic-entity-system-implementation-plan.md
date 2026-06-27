# Holtburger 3D Dynamic Entity System Implementation Plan

## Context

The dynamic entity requirements gate is satisfied for the first static-authored default-animation
slice. The requirements source remains
[docs/plans/holtburger-3d-dynamic-entity-system-requirements-plan.md](holtburger-3d-dynamic-entity-system-requirements-plan.md).

This implementation plan turns that resolved first slice into a phased build path. The first-cut
targets are outdoor static-authored setup `0x020003e5` with default animation `0x0300061b` and
outdoor static-authored setup `0x020005ac` with animation `0x03000751` plus a frame-0 `SetOmega`
hook.

The implementation should prove dynamic seed ingestion, animation asset lookup, runtime-owned
dynamic state, live part-frame playback, the first transform hook, dynamic query/index records,
renderer submission, and diagnostics without designing the entire live player/creature/equipment
system up front.

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
- This target proves the first cut must evaluate live animation part frames. It does not require
  hook execution, physics scripts, motion-table selection, particles, sounds, or material
  transitions.

Second target evidence:

- Static-authored outdoor setup `0x020005ac` is the second first-cut validation target.
- It has default animation `0x03000751`.
- The setup has two parts, no default script, no default motion table, no default sound table, and no
  default script table.
- Animation `0x03000751` has two parts, seven frames, no object position frames, and one frame-0
  `SetOmega` hook.
- Harness evidence decodes the `SetOmega` payload as vector `(0.0, 0.0, -0.038397)`.
- User retail-client visual check identifies the target as a bird that flaps its wings while
  circling a spot continuously.
- This target is the first transform-side hook validation target. The first cut should render it with
  typed `SetOmega` support rather than treating unsupported omega as an acceptable final compromise.

Initial code blockers and current implications:

- `StaticAuthoredDynamicSeedRecord` originally represented env-cell static object seeds only. Phase 2
  added outdoor static-authored dynamic seed facts; Phase 3B now course-corrects the plan so
  classified env-cell authored dynamic seeds are registered in the same dynamic runtime family
  instead of remaining a separate static-only special case.
- Setup payloads expose `defaultAnimation`, but animation assets were not first-class frontend asset
  payloads at plan creation time. Phase 1 added the `animation/0300....` route, Tauri JSON
  serialization, frontend zod validation, and asset preparation.
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

- DTO and seed plumbing come before renderer work because the first-cut targets cannot enter the
  frontend runtime honestly without outdoor seed variants and animation asset payloads.
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
- `holtburger-dat` originally kept hook `22` / `SetOmega` as raw 12-byte payload. Phase 1 preserved
  raw payload bytes and hook names for all known hooks; Phase 5B promoted `SetOmega` to a typed
  payload while still carrying exact raw payload bytes. Hook-aware bounds and renderer composition
  can now consume typed omega state instead of parsing raw bytes downstream.
- Static-authored dynamic seed records cannot be treated as one env-cell-shaped record. Phase 2 split
  committed-key creation and env-cell grouping by seed kind for outdoor support. Phase 3B must now
  complete the symmetric runtime registration path for classified env-cell dynamic seeds while
  preserving env-cell static scene query behavior until a tested render/query cutover exists.
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
- Dynamic entities should share prepared texture atlas/cache entries with static consumers when
  prepared texture identity and sampler/material requirements match. The shared primitive is the
  atlas/cache entry; ownership and lifetime must remain dynamic-resource-owned instead of borrowing
  static draw-unit or static visual-resource placement.
- Query migration affects browser picking and diagnostics, not only `StaticSceneQuery`. Existing
  browser code builds `StaticScenePickRequest` and displays static selection diagnostics. Phase 7B
  must include compatibility naming and UI diagnostics cleanup in its migration debt.
- `apps/holtburger-3d/src/lib/runtime/static-scene-query.ts` is too broad to be the place where
  merged static/dynamic query behavior is born. Before Phase 7B, decompose it through
  [docs/plans/holtburger-3d-static-scene-query-refactor-plan.md](holtburger-3d-static-scene-query-refactor-plan.md)
  so merged query composition can depend on a static query facade instead of a static-only god
  module.

## Goal

Render and inspect both first-cut static-authored dynamic outdoor targets through a real dynamic
entity runtime instead of baking them into static draw units: the hook-free windmill target and the
`SetOmega` bird target.

## Scope

In scope:

- Outdoor static-authored dynamic seed records for setup-backed sources with `defaultAnimation`.
- First-class animation asset lookup through host/content/Tauri/frontend asset contracts.
- A browser frontend dynamic runtime for static-authored seeds.
- Setup default animation playback using integer part-frame sampling.
- A hook-generic dispatcher shape with unsupported-hook diagnostics.
- Typed `SetOmega` decoding and the first supported transform-hook handler.
- Dynamic current-frame bounds, effective outdoor residence, and spatial query records.
- A merged scene-query API surface that can return static and dynamic hit variants.
- Renderer dynamic resource and instance commits for outdoor dynamic parts.
- Diagnostics for seed classification, resource readiness, animation frame state, bounds/index
  membership, renderer submission counts, and unsupported hooks.
- End-to-end validation against `0x020003e5` and `0x020005ac`.

Out of scope for this first implementation plan:

- Live host-spawned players, creatures, equipment, projectiles, or combat entities.
- Browser/client-authored spawn ownership, TTL, or explicit destruction APIs.
- Full motion-table animation selection.
- Physics script playback.
- Broad hook execution beyond the dispatcher shell and supported `SetOmega` handler.
- Particle, sound, light, material transition, replacement-object, `NoDraw`, `Scale`,
  `DefaultScript`, and `DefaultScriptPart` support.
- Dynamic atlas page allocation policy changes, VAO compaction, WebGL2 instanced draws, or dynamic
  workers. Dynamic entities may still consume existing shared prepared texture atlas/cache entries
  through independent dynamic ownership.
- Treating dynamic scenery as default browser-selectable. The first targets are inspectable/debug
  query records but not default selection targets.

## Ground Truth

Primary sources:

- [docs/plans/holtburger-3d-dynamic-entity-system-requirements-plan.md](holtburger-3d-dynamic-entity-system-requirements-plan.md)
- [docs/plans/holtburger-3d-shared-render-instance-static-instancing-plan.md](holtburger-3d-shared-render-instance-static-instancing-plan.md)
- [docs/plans/holtburger-3d-static-scene-query-refactor-plan.md](holtburger-3d-static-scene-query-refactor-plan.md)
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
evidence proves a narrower or shared location. The merged static/dynamic query surface is runtime
scene-query infrastructure and should live under `apps/holtburger-3d/src/lib/runtime/scene-query/`,
not in the dynamic module tree:

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
  dynamic-diagnostics.ts

apps/holtburger-3d/src/lib/runtime/scene-query/
  merged-scene-query-contracts.ts
  merged-scene-query.ts
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
  hook names and hook ids so diagnostics remain useful before full hook support. `SetOmega` is typed
  by Phase 5B, not Phase 1.

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
  `SetOmega` as a named hook with raw 12-byte payload bytes. The implementation plan now adds a
  dedicated first-cut phase for typed decoding and transform behavior before bounds/indexing relies
  on hook state.
- 2026-06-26: Phase 5B completed that follow-up: `SetOmega` now has typed decode/DTO/runtime state
  while retaining exact raw payload bytes for diagnostics and parity checks.
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

Status: completed.

Purpose:

- Represent outdoor default-animation setup sources as dynamic seeds before they reach static bake
  flattening.

Deliverables:

- Expand `StaticAuthoredDynamicSeedRecord` from env-cell-only to a union that includes outdoor static
  object dynamic seeds.
- Define outdoor seed facts: domain, landblock id, static object identity, source key, setup id,
  default animation id, source residence, landblock-local base transform, source scale, and
  classification reason; the bake step wraps those facts with the static work owner.
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

- [x] Add outdoor seed record type and descriptive helpers.
- [x] Update static contracts, coordinator commits, materializer forwarding, and tests.
- [x] Add classification in the outdoor static object resolver or source-closure path before bake.
- [x] Filter or split outdoor seed records before env-cell-only static scene query ingestion.
- [x] Add regression coverage for the windmill-style setup default animation case.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: Outdoor dynamic seed ownership is assigned in the static object bake step, not the
  resolver. The resolver emits ownerless seed facts on `OutdoorStaticObjectsScopePayload` because it
  does not know `workId`; the baker wraps those facts into `StaticAuthoredDynamicSeedRecord` values
  with the real `StaticWorkPeerRecordOwner`.
- 2026-06-26: Classification is intentionally narrow: setup-model sources with non-null
  `defaultAnimation` become `setup-default-animation` outdoor dynamic seed facts. Those objects are
  removed from `objects` and `materialSlots` before static object partitioning, so they cannot also
  flatten into static draw units.
- 2026-06-26: `StaticObjectSourceAssetFacts` now carries `defaultAnimation` for setup-model sources.
  Direct gfx sources carry `null` and remain static.
- 2026-06-26: Static scene query handling now switches on the authored seed record kind. Outdoor
  dynamic seed records get distinct committed-record keys and are ignored by env-cell-only grouping
  and env-cell system layer assembly.
- 2026-06-26: Bake diagnostics now include `authoredDynamicSeedCount` and
  `authoredDynamicSeedClassificationReasons.setupDefaultAnimation`, making the static-to-dynamic
  diversion visible in batch diagnostics.
- 2026-06-26: Regression coverage uses a synthetic `0x020003e5` setup-model fixture with
  `defaultAnimation: 0x0300061b` to prove the windmill-style contract without depending on local DAT
  assets in checked-in tests. The fixture verifies the source becomes an outdoor dynamic seed and no
  longer appears in bakeable static object payloads.
- 2026-06-26: Verification results: focused
  `npm run test:ts -- outdoor-static-objects-resolver static-object-compatibility-partitioner`,
  `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run test:ts`,
  `npm run check:rust`, and `npm run lint:rust` pass.

### Phase 3: Dynamic Entity Store And Static Scope Reconciliation

Status: completed.

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

- [x] Define dynamic runtime contracts and record types.
- [x] Implement dynamic store helpers with narrow mutation APIs.
- [x] Wire controller creation into `ClientRuntimeImpl`.
- [x] Forward materialized dynamic seed records to the controller.
- [x] Add unit tests for ingest, idempotence, replacement, and eviction.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: Added app-local dynamic runtime modules under
  `apps/holtburger-3d/src/lib/dynamic/`. The first slice has contracts, a narrow
  `DynamicEntityStore`, and `DynamicEntityController`; it does not add renderer state, resource
  hydration, animation playback, or spatial indexing yet.
- 2026-06-26: Dynamic entity ids are keyed from static source scope plus authored object/setup
  identity, not static work revision or renderer resource identity. Re-ingesting a later committed
  work item for the same source replaces the record while keeping the semantic id stable.
- 2026-06-26: `ClientRuntimeImpl` now forwards materialized outdoor dynamic seed records to the
  dynamic controller and exposes a `dynamic` snapshot. Runtime scene-interest reconciliation passes
  retained static scopes to the controller so source-scope eviction removes dynamic records even
  though authored seeds are not concrete `StaticResourceKey` values.
- 2026-06-26: Phase 3 intentionally ignores existing env-cell static object seed records. Those
  records remain part of the env-cell static rendering/query path until a later phase explicitly
  registers classified env-cell dynamic seeds in the dynamic runtime.
- 2026-06-26: New records are explicitly non-renderable with `resources-pending` diagnostics. This
  closes the Phase 3 "missing resources keep source record alive" requirement without pretending
  setup/animation leases or renderer submissions exist before Phases 4 and 8.
- 2026-06-26: Scope eviction currently removes semantic records only. Resource leases, spatial index
  entries, and renderer submissions have no concrete Phase 3 state to release yet; Phase 4, Phase 6,
  and Phase 8 must hook their cleanup into the same controller removal path when they add those
  derived states.
- 2026-06-26: Verification results: focused
  `npm run test:ts -- dynamic-entity-controller client-runtime`, `npm run check`,
  `npm run lint:ts`, `npm run lint:dead`, and `npm run test:ts` pass.
- 2026-06-26: Course correction before Phase 4: dynamic registration should not stay outdoor-only.
  Static-authored dynamic seed registration is a shared concept across outdoor landblock and
  env-cell authored statics; source residence and render/query membership are the
  residence-specific pieces. Keep the completed Phase 2/3 outdoor work as the first slice, then add
  Phase 3B to register classified env-cell authored dynamic seeds in the same dynamic runtime before
  resource readiness grows around an outdoor-only assumption.
- 2026-06-26: Tightened Phase 3B terminology: "promotion" means classified dynamic runtime
  registration, not env-cell dynamic rendering cutover. Env-cell static rendering remains unchanged
  until a later phase introduces an explicit, tested rule for diverting classified env-cell objects
  away from static output and into dynamic renderer membership.
- 2026-06-26: Phase 3B dry run found that existing `env-cell-static-object-seed` records are
  already the env-cell static scene/query membership records and should not be repurposed as dynamic
  records. Add a separate classified `env-cell-static-object-dynamic-seed` variant instead; the
  env-cell baker should emit it from `payload.sourceAssets` only when the source is a setup model
  with a non-null default animation.

### Phase 3B: Env-Cell Static-Authored Dynamic Registration Parity

Status: completed.

Purpose:

- Register env-cell authored static object seeds that meet the dynamic classification predicate in
  the dynamic runtime so dynamic entity registration is source-residence-aware rather than
  outdoor-only.
- Do not perform env-cell rendering cutover in this phase. Phase 3B establishes stable identity,
  source residence, retention, and diagnostics for classified env-cell dynamic records while the
  existing env-cell static rendering/query path remains authoritative for visible output.

Deliverables:

- Extend dynamic source/effective residence types to include env-cell residence with landblock id and
  env-cell id.
- Extend `StaticAuthoredDynamicSeedRecord` with a new classified
  `env-cell-static-object-dynamic-seed` variant. Keep the existing `env-cell-static-object-seed`
  variant unchanged for env-cell static scene/query and layer assembly.
- In `LandblockEnvCellsBaker`, classify env-cell dynamic seeds from
  `LandblockEnvCellsStaticScopePayload.sourceAssets` plus each env-cell static seed source. The first
  accepted predicate must match the outdoor path's authored dynamic evidence: setup-model source with
  a non-null `defaultAnimation`.
- Shape env-cell dynamic seed facts like the outdoor dynamic seed facts where possible: landblock id,
  env-cell id, object identity, source identity, source asset id, setup model id, default animation
  id, local placement, normalized source scale, and
  `classificationReason: "setup-default-animation"`.
- Normalize missing/null env-cell source scale to `{ x: 1, y: 1, z: 1 }` before dynamic facts reach
  the controller.
- Update `DynamicEntityController` to ingest `outdoor-static-object-dynamic-seed` and
  `env-cell-static-object-dynamic-seed` records as static-authored dynamic records while continuing
  to ignore unclassified `env-cell-static-object-seed` records.
- Keep env-cell records non-renderable with explicit "residence render path pending" or
  "resources-pending" diagnostics until resource readiness and env-cell render membership are
  implemented.
- Preserve existing env-cell static rendering/query behavior during this parity phase. Do not remove
  classified env-cell dynamic objects from static output until a later phase adds and tests a
  rendering cutover rule.
- Reconcile env-cell dynamic records against retained `landblock-env-cells` source scopes.
- Update runtime diagnostics/snapshots so outdoor and env-cell static-authored dynamic records are
  visible under the same dynamic snapshot family.

Acceptance criteria:

- Env-cell static authored seeds create stable dynamic records only when they satisfy the dynamic
  classification predicate.
- Env-cell seeds that do not satisfy the predicate continue to emit only
  `env-cell-static-object-seed` records and are not mirrored into the dynamic store.
- Classified env-cell seeds emit an additional `env-cell-static-object-dynamic-seed` record without
  removing or mutating the existing static `env-cell-static-object-seed` record.
- Classified env-cell dynamic records are keyed by source scope, env-cell id, object identity, and
  setup/source identity.
- Re-ingesting the same classified env-cell dynamic seed is idempotent.
- Removing the retained `landblock-env-cells` scope removes its env-cell dynamic records.
- Env-cell dynamic records do not enter outdoor-only placement, outdoor dynamic spatial index, or
  outdoor renderer submission paths.
- Existing env-cell static scene query and env-cell system layer tests continue to pass.

Task checklist:

- [x] Add env-cell residence variants to dynamic contracts and snapshots.
- [x] Add the `env-cell-static-object-dynamic-seed` variant and env-cell dynamic seed facts in
      static contracts.
- [x] Add env-cell dynamic classification in `LandblockEnvCellsBaker` using `payload.sourceAssets`
      rather than controller-side lookups.
- [x] Preserve existing `env-cell-static-object-seed` emission for env-cell static scene/query and
      system layer assembly.
- [x] Add classified env-cell dynamic seed ingestion and id construction in
      `DynamicEntityController`.
- [x] Add coverage proving unclassified env-cell static seeds are not mirrored into dynamic state.
- [x] Add baker coverage proving setup-model/default-animation env-cell seeds emit the classified
      dynamic variant and gfx/no-default-animation seeds do not.
- [x] Add non-renderable diagnostics for env-cell records whose resource/render path is pending.
- [x] Add retention tests for `landblock-env-cells` source scopes.
- [x] Add runtime integration coverage proving classified env-cell seeds appear in dynamic
      diagnostics without changing env-cell static rendering behavior.
- [x] Update future phases to refer to source residence instead of outdoor-only seeds where
      applicable.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: Dry run rejected controller-side env-cell classification because the controller would
  need source-asset lookup context or an ambient table. Classification belongs in the env-cell baker,
  where `payload.sourceAssets` is already resident for the static object compatibility bake.
- 2026-06-26: Dry run rejected repurposing `env-cell-static-object-seed` as the dynamic record.
  Static scene query and env-cell system layer assembly already consume that variant as static
  membership data. Phase 3B should add a separate classified dynamic variant and leave the static
  variant untouched until the explicit env-cell render cutover phase.
- 2026-06-26: Implementation keeps `env-cell-static-object-seed` emission unchanged and appends
  `env-cell-static-object-dynamic-seed` only for setup-model/default-animation seeds. Static scene
  query can key the new variant, but env-cell grouping and system layer assembly continue to filter
  only the static membership variant.
- 2026-06-26: Classified env-cell dynamic runtime records use env-cell residence, retain against the
  existing `landblock-env-cells` static source scope key, and stay non-renderable with both
  `resources-pending` and `residence-render-path-pending` diagnostics.
- 2026-06-26: Focused verification passed:
  `npm run test:ts -- dynamic-entity-controller landblock-env-cells-baker client-runtime`.
- 2026-06-26: Full verification passed from `apps/holtburger-3d`: `npm run check`,
  `npm run lint:ts`, `npm run lint:dead`, `npm run test:ts`, `npm run check:rust`, and
  `npm run lint:rust`. Repository-level `git diff --check` also passed. The app-local Rust wrappers
  must be run from `apps/holtburger-3d`; running `npm run check:rust` or `npm run lint:rust` from the
  repository root fails because this checkout has no root `package.json`.

Debt and follow-up:

- Env-cell dynamic records are registered, diagnosable, retained, and evicted, but they are not
  resource-ready or rendered. Phase 4A must hydrate setup and animation resources for both outdoor
  and env-cell dynamic records through the same resource manager; Phase 4B must add visual,
  material, texture, and setup-appearance readiness without changing env-cell static rendering.
- Classified env-cell dynamic records deliberately do not cut over rendering yet. Static env-cell
  output still includes those objects through `env-cell-static-object-seed`; a later render cutover
  phase must explicitly remove classified env-cell dynamic objects from static output before
  submitting them through dynamic renderer membership.
- `residence-render-path-pending` is intentional temporary debt, not a terminal state. Remove or
  narrow that diagnostic once env-cell dynamic placement/render membership is implemented and tested.

### Phase 4A: Dynamic Setup And Animation Resource Readiness

Status: completed 2026-06-26.

Purpose:

- Hydrate the first required dynamic resources, setup model and default animation, through the
  existing asset service while keeping dynamic readiness separate from static bake output.

Deliverables:

- Add `DynamicEntityResourceManager` for dynamic semantic resource readiness and leases.
- Define typed dynamic resource keys for setup model and animation. Reserve explicit key variants for
  later setup appearance, gfx/material/texture, and future table families such as motion table, sound
  table, physics script, and physics script table.
- Use `AssetService.requestPreparedAsset()` and `AssetService.acquirePreparedAssetLease()` instead
  of creating another raw host request cache. The asset service already dedupes pending/committed
  host assets; the dynamic manager owns dynamic resource readiness, per-entity leases, and
  release-on-entity-removal semantics.
- Request setup model and animation payloads from static seed facts for both outdoor and env-cell
  source residences.
- Add an async state-change path from dynamic resource completion back to `ClientRuntimeImpl` so
  resource readiness emits a fresh runtime snapshot instead of waiting for an unrelated runtime
  event.
- Record missing setup or animation dependencies as explicit diagnostics.
- Mark the setup/animation portion of resource readiness ready only when both required assets are
  committed and leased.
- Do not introduce a startup-hydrated global animation/motion/script/effect lookup table. Authored
  setup and hook data already carries direct DAT ids; per-resource tables are loaded by those ids
  only when referenced by active entities or implemented hook/playback behavior.

Acceptance criteria:

- Outdoor and env-cell static-authored dynamic records use the same setup/animation readiness path.
- Missing setup or animation resources keep the entity non-renderable with explicit diagnostics.
- Two dynamic entities that request the same setup or animation converge on one asset-service
  committed entry while holding separate dynamic resource leases.
- Resource leases are released when dynamic entities are removed by static scope retention.
- Setup/animation readiness completion emits a runtime snapshot update.
- The first-slice manager has no ambient startup table load and no global LUT required for
  animation/motion/script/effect lookup.

Task checklist:

- [x] Define dynamic setup/animation resource state and issue types.
- [x] Define typed dynamic resource keys, including reserved future key variants.
- [x] Implement manager coordination around asset-service request dedupe, committed reuse, leases,
      and release-on-entity-removal.
- [x] Add controller/runtime wiring so async readiness completion emits snapshots.
- [x] Prove resource readiness works for outdoor and env-cell source residences without duplicating
      manager logic.
- [x] Prove duplicate entity references to the same setup or animation share asset-service committed
      entries while retaining separate dynamic leases.
- [x] Prove missing setup and missing animation diagnostics.
- [x] Prove no startup-hydrated global lookup table is required.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: Dry run split the original Phase 4. Setup/animation readiness is a smaller, reviewable
  resource-manager slice; visual/material/texture readiness is deferred to Phase 4B.
- 2026-06-26: `AssetService` already provides host request dedupe and committed asset leases. The
  dynamic resource manager should coordinate dynamic semantic readiness and per-entity ownership, not
  duplicate the asset-service cache.
- 2026-06-26: Async readiness must publish runtime snapshots. Without a callback/event path from
  dynamic resource completion to `ClientRuntimeImpl`, entities could become ready silently until some
  unrelated runtime event emits.
- 2026-06-26: Implemented `DynamicEntityResourceManager` as the dynamic semantic owner over
  `AssetService` prepared asset requests and leases. The manager requests setup model and default
  animation assets by direct DAT ids from the static-authored seed; it does not build or require any
  startup-hydrated animation, motion, script, or effect lookup table.
- 2026-06-26: Setup/animation readiness is represented as a partial resource state,
  `setup-animation-ready`, rather than renderability. Until Phase 4B resolves visual/material/texture
  resources, ready records remain non-renderable with `visual-resources-pending`.
- 2026-06-26: Runtime resource completion now flows manager -> controller -> `ClientRuntimeImpl`
  snapshot emission. Retention removal routes through the controller so dynamic leases are released
  before records disappear.

Verification:

- 2026-06-26: `npm run test:ts -- dynamic-entity-resource-manager.test.ts
  dynamic-entity-controller.test.ts client-runtime.test.ts`
- 2026-06-26: `npm run check`
- 2026-06-26: `npm run lint:ts`
- 2026-06-26: `npm run test:ts`
- 2026-06-26: `npm run lint:dead`
- 2026-06-26: `npm run check:rust`
- 2026-06-26: `npm run lint:rust`

Debt and follow-up:

- `visual-resources-pending` is intentional Phase 4A handoff state. Phase 4B must replace it with
  concrete visual/material/texture readiness or explicit missing-resource diagnostics.
- The manager currently acquires no lease for a successfully loaded peer asset if the paired
  setup/animation request fails. This is correct for all-or-nothing setup/animation readiness, but
  Phase 4B should revisit partial lease policy once visual/material dependencies become multi-asset.
- `DynamicEntityResourceManager` owns setup/animation leases only. Visual/material/texture leases and
  atlas-compatible texture identity preservation remain Phase 4B work.

### Phase 4B: Dynamic Visual, Material, And Texture Readiness

Status: completed 2026-06-26.

Purpose:

- Hydrate setup appearance, gfx, material, palette, render-surface, and texture-use readiness for
  dynamic records while preserving atlas-compatible texture identity without borrowing static bake
  ownership.

Deliverables:

- Extend `DynamicEntityResourceManager` with setup appearance, gfx, material, palette,
  render-surface, and prepared texture-use resource keys.
- Reuse `resolveStaticObjectSourceClosure()` or extract shared source-closure helpers where the
  setup/gfx/material facts are isomorphic.
- Preserve prepared texture identities, sampler policy, wrap requirements, and material role layout
  needed by Phase 8 to route compatible static and dynamic consumers through shared atlas/cache
  entries.
- Do not create baked static draw units, static batch ids, static object visual-resource ids, or
  static texture-use owners during dynamic readiness.
- Treat missing setup appearance as non-fatal for first-cut targets when setup-provided parts, gfx,
  material/texture resources, and animation are available.
- Record missing visual/material/texture dependencies and unsupported material plans as explicit
  diagnostics.
- Replace the Phase 4A `visual-resources-pending` handoff state with either full visual readiness or
  concrete missing/unsupported visual resource diagnostics.

Acceptance criteria:

- `0x020003e5` reaches full dynamic resource readiness when setup, parts/materials/textures, and
  animation are available.
- Env-cell static-authored dynamic records can reach the same resource-ready/non-renderable state
  without entering outdoor-only placement or renderer paths.
- Missing setup appearance is diagnosed but does not block readiness when setup-provided parts are
  sufficient.
- Resource readiness does not create or depend on baked static draw units.
- Dynamic visual readiness carries enough texture-use identity and sampler/material requirements for
  Phase 8 to share atlas/cache entries with compatible static consumers.
- Dynamic visual readiness does not reference static draw-unit ids, static batch ids, static
  visual-resource owner keys, or `StaticTextureUseOwner`.
- Visual/material/texture leases are released on entity removal.
- Records no longer use `visual-resources-pending` once Phase 4B readiness has completed or failed.

Task checklist:

- [x] Define dynamic visual/material/texture resource state and issue types.
- [x] Define typed dynamic resource keys for setup appearance, gfx, material, palette,
      render-surface, and prepared texture-use dependencies.
- [x] Reuse or extract part-agnostic source closure and material planning helpers.
- [x] Preserve atlas-compatible prepared texture identities and sampler/material requirements without
      static ownership.
- [x] Prove dynamic readiness does not reference static draw-unit, static batch, or static
      visual-resource owner keys.
- [x] Add tests for success, missing setup appearance, missing visual/material/texture dependency,
      unsupported material plan, dedupe, and lease release.
- [x] Remove or narrow `visual-resources-pending` after concrete visual/material/texture outcomes are
      available.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: Dry run found that current texture manager ownership is still static-shaped through
  `StaticTextureUseOwner`. Phase 4B should preserve atlas-compatible texture specs and identities,
  but actual dynamic atlas ownership belongs in Phase 8 unless texture owner types are generalized
  earlier.
- 2026-06-26: `resolveStaticObjectSourceClosure()` already loads setup/gfx/material/texture facts and
  missing refs, but it does not expose every successfully loaded asset key. Phase 4B must either
  derive leases from returned facts or extend the closure result with loaded asset keys before
  claiming complete lease release for visual/material/texture resources.
- 2026-06-26: Implemented visual readiness by reusing `resolveStaticObjectSourceClosure()` and
  `planStaticObjectMaterials()` as fact/classification helpers. Dynamic readiness derives its own
  material slot requirements from source parts so promoted dynamic objects do not depend on static
  resolver material slots, which intentionally exclude dynamic-promoted objects.
- 2026-06-26: Dynamic visual readiness stores source/material/palette/texture facts plus neutral
  texture requirements containing `MaterialTextureDataUseIdentity` and sampling policy. It does not
  create baked draw units, static batch ids, static visual-resource owner ids, or
  `StaticTextureUseOwner` records.
- 2026-06-26: Missing setup appearance remains nonfatal. Other missing visual dependencies and
  unsupported material planner fallback reasons fail visual readiness with explicit diagnostics.
- 2026-06-26: `visual-resources-pending` is now only an in-flight state between setup/animation
  readiness and visual readiness completion. Once visual readiness completes or fails, records carry
  either `ready` resources or concrete missing/unsupported diagnostics.

Verification:

- 2026-06-26: `npm run test:ts -- dynamic-entity-resource-manager.test.ts
  dynamic-entity-controller.test.ts client-runtime.test.ts`
- 2026-06-26: `npm run check`
- 2026-06-26: `npm run lint:ts`
- 2026-06-26: `npm run test:ts`
- 2026-06-26: `npm run lint:dead`
- 2026-06-26: `npm run check:rust`
- 2026-06-26: `npm run lint:rust`
- 2026-06-26: `git diff --check`

Debt and follow-up:

- Dynamic records are resource-ready but still renderer-non-renderable. Phase 5 can consume setup,
  animation, and source part facts for playback; later renderer phases must turn these facts into
  dynamic visual resources and instances.
- Texture requirements preserve atlas-compatible data-use identity and sampling policy, but they do
  not allocate atlas space or install texture placements. Phase 8 still owns dynamic texture binding
  ownership and shared atlas/cache integration.
- Unsupported material planner fallback reasons currently fail dynamic visual readiness. If later
  phases intentionally support deferred translucent/detail paths, this policy should become more
  granular instead of a blanket visual-readiness failure.

### Phase 5: Animation Playback And Hook Dispatcher Shell

Status: completed 2026-06-26.

Purpose:

- Play setup default animation locally for static-authored dynamic entities and establish the
  hook-generic dispatch shape needed for `SetOmega`.

Deliverables:

- Add `DynamicAnimationPlayer`.
- Carry the validated animation payload into dynamic resource state when setup/animation readiness
  completes, so playback consumes an owned resource result instead of re-querying ambient host state.
- Start setup default animation from frame 0 at 30 frames per second for static-authored first-slice
  records.
- Sample integer animation frames using `floor(frame_number)`.
- Sample `objectPositionFrames` along with `partFrames` and store the current object/root pose
  separately from source/base placement.
- Treat source/base placement, current object/root pose, and current part poses as separate
  transforms: base placement anchors the entity in its source residence, object/root pose is the
  animation root transform beneath that base, and part poses are local to the animated object/root
  frame.
- Apply active animation part frame origin and orientation as current part pose, not as a delta on
  setup default placement.
- Add `DynamicHookDispatcher` with no-op and unsupported-hook diagnostic paths.
- Preserve hook invocation context even when no handler exists.
- Dispatch hooks once per entered sampled frame and loop cycle, not once per render/runtime tick.
- Handle zero-frame and malformed object-position-frame cases with explicit diagnostics rather than
  modulo-by-zero or silent fallback.

Acceptance criteria:

- The windmill target advances frames and produces current object/root pose plus current part poses
  for all five parts.
- Active animation frames replace setup/default placement frames during playback.
- Object-position frames are applied as root/object animation state beneath base placement. If
  `objectPositionFrames` is empty, playback uses an identity object/root pose; if present but
  malformed for the sampled frame range, playback records a diagnostic.
- Hook-free animation produces no unsupported-hook diagnostics.
- A fixture animation with an unsupported hook records entity, asset id, frame, hook id/name, and
  skipped effect.
- Repeated runtime ticks inside the same sampled frame do not dispatch duplicate hook diagnostics.

Task checklist:

- [x] Add animation playback state to dynamic records.
- [x] Carry validated animation payloads from resource readiness into playback-owned state.
- [x] Implement integer frame advancement and looping.
- [x] Implement object/root pose sampling from `objectPositionFrames`.
- [x] Implement current part-pose output.
- [x] Add hook invocation DTO/runtime type.
- [x] Add zero-frame and malformed object-position-frame diagnostics and tests.
- [x] Add unsupported-hook diagnostics, one-shot frame-entry dispatch, and tests.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: Dry run found that Phase 4A/4B records know animation readiness but do not yet carry
  the animation payload needed for playback. Phase 5 should make the animation payload an explicit
  dynamic resource result consumed by `DynamicAnimationPlayer`.
- 2026-06-26: Object-position frames are in scope for Phase 5. They are not renderer debt. Playback
  must sample them alongside part frames and preserve the transform layering between source/base
  placement, object/root animation pose, and per-part local poses.
- 2026-06-26: Hook dispatch must be tied to sampled-frame entry and loop cycle, not raw runtime tick
  frequency, to avoid duplicate hook diagnostics at render rates above 30 fps.
- 2026-06-26: Implemented `DynamicAnimationPlayer` as a frontend runtime sampler over
  resource-manager-owned animation payloads. The player starts playback from frame 0 at first
  runtime tick, advances at 30 fps with `floor(frame_number)`, loops by sampled frame index, and
  stores current object/root pose plus per-part local poses separately from source/base placement.
- 2026-06-26: Setup animation readiness now validates the host-prepared payload with
  `animationPayloadDtoSchema` and stores the validated payload in `resources.setupAnimation` before
  playback can run. Wrong-kind or malformed animation payloads fail resource readiness loudly instead
  of letting playback sample an unknown shape.
- 2026-06-26: Hook dispatch is intentionally a shell. `payloadKind: "none"` is treated as no-op;
  effect-bearing hooks record unsupported-hook diagnostics with entity id, animation asset id,
  sampled frame, loop iteration, hook id/name, payload kind, and skipped effect. Diagnostics are
  one-shot per sampled frame and loop cycle.
- 2026-06-26: Runtime frame updates now advance dynamic animation playback and emit snapshots when
  playback state changes. Dynamic promoted records remain renderer-non-renderable until later
  renderer phases consume this pose state.
- 2026-06-26: Course-corrected the Phase 5 snapshot surface to use lightweight
  `DynamicEntitySummaryDto` records. Internal dynamic records still own validated animation payloads
  for playback, but runtime snapshots now expose animation/resource summaries and sampled pose state
  without serializing the full `AnimationPayloadDto`.

Verification:

- 2026-06-26: `npm run test:ts -- --run src/lib/dynamic/dynamic-animation-player.test.ts
  src/lib/dynamic/dynamic-entity-resource-manager.test.ts
  src/lib/dynamic/dynamic-entity-controller.test.ts src/lib/runtime/client-runtime.test.ts`
- 2026-06-26: `npm run check`
- 2026-06-26: `npm run lint:ts`

Debt and follow-up:

- Unsupported hook diagnostics can grow by loop cycle for animations with unsupported effect hooks.
  This is useful while hook support is absent, but later hook implementation should replace the
  repeated diagnostic stream with real handlers or a bounded reporting policy.
- Playback state is produced but not rendered. Phase 6/7/8 still need to turn sampled base,
  object/root, and part-local poses into dynamic bounds, spatial membership, and draw instances.

### Phase 5B: SetOmega Decode And Transform Hook Handler

Status: completed.

Purpose:

- Promote `SetOmega` from unsupported diagnostic to the first supported transform hook so the first
  cut covers both `0x020003e5` and `0x020005ac`.

Deliverables:

- Add typed `SetOmega` payload decoding at the animation asset boundary while preserving the original
  raw bytes for diagnostics and future parity checks.
- Extend the frontend animation hook DTO/schema with a typed `SetOmega` payload containing the omega
  vector and the original raw bytes. Do not reconstruct raw bytes from decoded floats.
- Add dynamic transform-effect state for current object/root omega without redefining source
  residence or static-scope lifetime.
- Add a `DynamicHookDispatcher` handler for `SetOmega` that writes omega state instead of producing
  an unsupported-hook diagnostic.
- Integrate omega over runtime delta time as object/root transform state under the base placement and
  before part-local animation poses are consumed by bounds/rendering.
- Keep repeated frame-0 `SetOmega` dispatch idempotent across animation loops when the hook payload
  repeats the same vector: refresh active omega/provenance, but do not reset accumulated omega
  rotation phase.
- Preserve unsupported diagnostics for every other effect-bearing hook.

Acceptance criteria:

- Animation `0x03000751` exposes a typed `SetOmega` payload with vector `(0.0, 0.0, -0.038397)` and
  still preserves the exact original raw payload bytes.
- The `0x020005ac` dynamic record no longer reports unsupported-hook diagnostics for its frame-0
  `SetOmega` hook.
- Playback stores active omega transform state with entity id, animation asset id, frame/loop source,
  and vector provenance.
- Runtime ticks integrate omega independently of integer part-frame sampling while preserving the
  existing part-frame playback behavior.
- Re-entering the same looping frame-0 `SetOmega` hook does not snap or restart the accumulated
  omega transform phase when the vector is unchanged.
- Hook-free target `0x020003e5` remains unchanged and does not allocate fake omega state.
- Tests cover typed decode, dispatcher handling, idempotent repeated loop dispatch, and unsupported
  fallback for non-`SetOmega` hooks.

Task checklist:

- [x] Add typed `SetOmega` hook payload decoding and DTO/schema tests.
- [x] Add dynamic omega transform state types.
- [x] Implement `SetOmega` hook handler in the dispatcher.
- [x] Integrate omega object/root transform over runtime delta time.
- [x] Preserve accumulated omega rotation phase across repeated same-vector loop dispatches.
- [x] Add playback/controller tests for `0x03000751`-style frame-0 `SetOmega`.
- [x] Update diagnostics so supported `SetOmega` is reported as active transform state, not skipped.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: First-cut scope now includes both evidence-backed targets. `SetOmega` is no longer a
  post-validation maybe; it is the first supported hook handler and must land before bounds/indexing
  can claim to represent the bird target honestly.
- 2026-06-26: Broad hook execution remains out of scope. This phase adds a hook-generic typed
  handler path using `SetOmega` as the first concrete handler, not a one-off bird-specific shortcut.
- 2026-06-26: Dry run found two implementation constraints for `SetOmega`: typed payloads must carry
  decoded vector plus exact raw bytes, and repeated loop dispatch must not reset accumulated omega
  phase when the vector is unchanged.
- 2026-06-26: Phase 5B added typed DAT decode, Tauri JSON serialization, frontend schema validation,
  and runtime active-omega state. The original 12 payload bytes remain the serialized source for
  round-trip/parity purposes; runtime behavior consumes the decoded vector.
- 2026-06-26: The playback runtime keeps authored `objectRootPose` separate from
  `transformEffects.activeOmega.objectRootRotation`. Phase 6 must compose base placement, authored
  object/root pose, omega object/root rotation, and part-local poses for bounds/query. This avoids
  overwriting authored animation pose data before the renderer and index paths have a real
  composition contract.
- 2026-06-26: ACE reference check confirmed the relevant model shape:
  `Sequence.apply_physics` rotates the animation frame by `Omega * quantum`. The frontend runtime now
  integrates omega per wall-clock delta and refreshes repeated frame-0 `SetOmega` provenance without
  resetting accumulated rotation.
- 2026-06-26: The existing frontend fixture raw bytes
  `[00 00 00 00 00 00 00 00 72 20 1d bd]` decode to `z = -0.0383600667`. The requirements evidence
  records this target as approximately `-0.038397`; exact runtime behavior should treat the DAT raw
  bytes as authoritative and use the decoded float carried by the typed payload.

Debt and follow-up:

- Phase 6 must consume `transformEffects.activeOmega.objectRootRotation` when computing current
  dynamic bounds and spatial index records. Phase 5B deliberately stores the effect state but does
  not yet apply it to geometry, picking, or renderer submissions.
- Renderer validation should confirm the visual rotation direction for non-identity base/object-root
  orientations once Phase 8 submits the bird target. The first-cut target proves continuous
  negative-Z omega accumulation, but final visual parity still belongs with renderer composition.

### Phase 6: Dynamic Placement, Bounds, And Outdoor Spatial Index

Status: completed.

Purpose:

- Convert current animation/resource/hook transform state into landblock-local bounds and query/index
  membership.

Deliverables:

- Add `DynamicPlacementTracker`.
- Extract reusable AC placement/matrix helpers from the static bake namespace into a neutral frontend
  math module before dynamic placement consumes them.
- Compute current-frame part transforms and conservative bounds from current renderable source-part
  bounds carried by dynamic visual source facts, including active object/root omega transform state.
- Compose dynamic transforms in this order for bounds: source/base placement, authored object/root
  pose, omega-integrated object/root transform, then part-local animation pose.
- Resolve effective outdoor presentation residence from current pose/bounds while preserving source
  residence.
- Add `OutdoorDynamicSpatialIndex` behind a small local interface.
- Use existing outdoor landblock-grid traversal as the outer query candidate phase.
- Add a proven mutable 2D AABB/R-tree dependency through `npm` during implementation and keep the
  package hidden behind `OutdoorDynamicSpatialIndex`.
- Extract or share the existing outdoor bounds-to-render-cell helper so dynamic and static indexing
  use the same landblock-boundary conventions.
- Introduce `DynamicEntityController.tick(timeSeconds)` as the imperative runtime orchestration entry
  point for animation playback followed by placement/bounds/index synchronization.
- Keep env-cell dynamic membership flat for now.
- Preserve source residence even when omega-driven current bounds cross outdoor landblock
  boundaries.

Acceptance criteria:

- Existing static AC placement/matrix consumers import from the neutral math module or a compatibility
  wrapper that is marked as temporary cleanup debt.
- Current-frame dynamic bounds update as animation frames change.
- Current-frame dynamic bounds update as `SetOmega` object/root transform state changes.
- Dynamic index membership is keyed by effective outdoor landblock membership.
- Cross-boundary bounds can be indexed into every overlapped outdoor landblock.
- Removing an entity removes all index items.
- The index wrapper is backed by the chosen mutable AABB/R-tree package and tested independently of
  browser runtime.
- `DynamicEntityController.tick(timeSeconds)` updates animation playback, placement, bounds, and
  index membership in one coherent imperative pass.
- The bird target's bounds/index membership are derived from animation plus active omega state, not
  from static setup bounds alone.

Task checklist:

- [x] Add package dependency with package-manager tooling.
- [x] Extract neutral AC placement/matrix helpers and update existing imports.
- [x] Define dynamic bounds and precision metadata types.
- [x] Implement placement and bounds derivation from source/base placement, authored object/root
      pose, omega-integrated object/root transform, part-local poses, and visual source-part bounds.
- [x] Implement outdoor dynamic index wrapper and tests.
- [x] Extract or share outdoor bounds-to-render-cell membership helpers.
- [x] Wire animation playback plus placement/index sync into `DynamicEntityController.tick()`.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-26: Requirements already require a per-landblock mutable AABB/R-tree-style outdoor dynamic
  index for the first slice. Do not replace it with a flat map as a temporary simplification; hide the
  chosen dependency behind `OutdoorDynamicSpatialIndex` so future broadphase changes stay local.
- 2026-06-26: The existing AC placement/matrix helpers live under the static bake namespace, but
  Phase 6 is the first dynamic consumer. Extract a neutral frontend math module now instead of making
  dynamic placement depend on static bake ownership.
- 2026-06-26: `DynamicPlacementTracker` is an imperative synchronization service, not an optional
  post-processing helper. The controller should expose `tick(timeSeconds)` so animation playback,
  transform integration, current-frame bounds, effective residence, and index membership are updated
  coherently.
- 2026-06-26: Dynamic visual readiness currently carries source part bounds, not full source geometry
  attachments. Phase 6 should compute conservative current-frame bounds from transformed source-part
  bounds and record precision metadata; vertex/triangle-precise dynamic bounds can wait until a
  target proves that precision is needed.
- 2026-06-26: Phase 6 uses `rbush` with `@types/rbush` as the hidden mutable 2D AABB/R-tree
  dependency behind `OutdoorDynamicSpatialIndex`.
- 2026-06-26: The neutral AC placement helpers now live in `src/lib/math/ac-placement-transform.ts`.
  Static bake/runtime callers import from that neutral module directly; no compatibility wrapper was
  needed.
- 2026-06-26: `DynamicPlacementTracker` computes conservative source-landblock-local current-frame
  bounds from transformed visual source-part bounds, syncs outdoor index membership, and keeps
  env-cell dynamic records flat/unindexed for this phase.
- 2026-06-26: `DynamicEntityController.tick(timeSeconds)` now coordinates animation playback followed
  by placement/bounds/index synchronization.

Debt and follow-up:

- Phase 7A must move env-cell portal aperture pickables into the static query surface so Phase 7B can
  compose one complete static query source.
- Phase 7B should consume `OutdoorDynamicSpatialIndex` through its local wrapper; callers should not
  learn the package API.
- Phase 7B still needs the merged scene-query source that turns indexed dynamic AABBs into debug and
  selection-filtered query hits.
- Phase 6.5 decomposed the static scene-query module before Phase 7A/7B. Phase 7B should compose
  through the extracted static query facade rather than reintroducing dynamic query behavior into
  static-only modules.
- Dynamic bounds are current-frame AABBs from source part bounds, not vertex/triangle precise bounds.
  Keep the precision metadata visible and upgrade only when a target proves this is insufficient.
- `npm install` reported 4 audit findings after adding the dependency. They were not auto-fixed during
  this phase because `npm audit fix` would mutate unrelated package versions.

### Phase 6.5: Static Scene Query Decomposition Detour

Status: completed 2026-06-27.

Purpose:

- Refactor the existing static scene-query implementation into focused modules before merged
  static/dynamic query work begins.

Deliverables:

- Execute
  [docs/plans/holtburger-3d-static-scene-query-refactor-plan.md](holtburger-3d-static-scene-query-refactor-plan.md).
- Preserve existing static query, picking, diagnostics, env-cell residency, and portal debug behavior.
- Leave `StaticSceneQuery` as a facade that Phase 7A can complete and Phase 7B can compose cleanly.
- Keep dynamic query behavior out of this detour.

Acceptance criteria:

- The static scene-query refactor plan reaches its definition of done.
- Full static query/browser/runtime verification passes or unrelated pre-existing failures are
  documented.
- Phase 7A/7B have a clear static query boundary and no need to import static-only internals.

Task checklist:

- [x] Complete the static scene-query refactor plan.
- [x] Update this dynamic implementation plan with final module names and any Phase 7A/7B adjustments.
- [x] Confirm no dynamic query behavior was introduced during the refactor.

Decisions and course corrections:

- 2026-06-26: Added as a deliberate detour after reviewing the next Phase 7 surface. Targeted
  extraction would risk strengthening `static-scene-query.ts` as a god module; this detour gives the
  static query boundary a full responsibility-based decomposition before dynamic query composition.
- 2026-06-27: Completed
  [docs/plans/holtburger-3d-static-scene-query-refactor-plan.md](holtburger-3d-static-scene-query-refactor-plan.md).
  `StaticSceneQuery` remains the runtime-facing facade, while static query internals now live under
  `apps/holtburger-3d/src/lib/runtime/scene-query/`.
- 2026-06-27: Final static query module names available for Phase 7 composition are
  `contracts.ts`, `static-selection-keys.ts`, `static-query-state.ts`, `geometry.ts`,
  `landblock-grid-spatial-index.ts`, `env-cell-committed-records.ts`,
  `env-cell-portal-projections.ts`, `env-cell-residency.ts`, `static-picking.ts`, and
  `static-selection-debug.ts`.
- 2026-06-27: The detour did not introduce dynamic query behavior. It preserved the existing
  `StaticSceneQuery` public API while moving static picking, residency, grid traversal, committed
  env-cell records, portal projection caching, debug/detail lookup, runtime root types, selection
  keys, and geometry into focused static modules.
- 2026-06-27: Verification for the detour passed from `apps/holtburger-3d`: focused
  `npm run test:ts -- --run src/lib/runtime/static-scene-query.test.ts src/lib/runtime/client-runtime.test.ts src/lib/browser/static-picking.test.ts`,
  full `npm run test:ts`, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and repository
  `git diff --check`.

Debt and follow-up:

- Extracted static query module tests are still mostly covered through
  `static-scene-query.test.ts`. This is acceptable Phase 7A/7B input because behavior coverage is
  intact, but module-level test colocation remains tracked in the static refactor plan.

### Phase 7A: Complete Static Query Surface

Status: completed 2026-06-27.

Purpose:

- Move all static pickable families behind the static query API so merged query composition does not
  inherit runtime-only side channels.

Deliverables:

- Move env-cell portal aperture pick targets into the static scene query surface instead of adding
  them as a runtime-only pass after `StaticSceneQuery.pickRay`.
- Add explicit static query filters for debug-only static pickable families, including portal
  apertures.
- Preserve render-anchor translation for portal aperture vertices inside the static query boundary.
  `StaticSceneQuery` already tracks the outdoor anchor; Phase 7A must not leave that transform as
  hidden runtime-only state.
- Keep runtime/browser policy responsible for choosing filters from UI/debug-overlay state; the
  query API owns static pickable discovery and ordering.
- Preserve existing static hit ordering, tie-break behavior, and selected static diagnostics.

Acceptance criteria:

- `StaticSceneQuery.pickRay` is the complete static picking surface used by `ClientRuntimeImpl` for
  regular static hits and env-cell portal aperture debug hits.
- Runtime no longer has a separate `#pickEnvCellPortalRay`-style static hit pass after
  `StaticSceneQuery.pickRay`.
- Portal aperture pickability is controlled by static query filters derived from existing portal
  debug-overlay state.
- Existing static picking and selected static diagnostics tests continue to pass.

Task checklist:

- [x] Extend static scene query contracts with explicit portal/debug pick filters.
- [x] Move env-cell portal aperture pick target construction and ray intersection into the static
      query module boundary.
- [x] Thread render-anchor translation through the static portal aperture query path without adding a
      second runtime-side picking path.
- [x] Update `ClientRuntimeImpl.pickStaticRay` to pass filters instead of running a second static
      pick pass.
- [x] Keep portal aperture detail/debug lookup reachable through existing static selection
      diagnostics.
- [x] Add or update tests proving portal aperture hits are returned only when their filter is enabled
      and still merge by nearest distance with other static hits.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-27: Split the former merged scene-query phase into 7A and 7B after dry-running the current
  runtime picking path. Env-cell portal aperture picking was a runtime-only side pass, which made the
  planned static query source incomplete. 7A closes that static ownership issue before dynamic hits
  are merged.
- 2026-06-27: Phase 7B should compose static hits through the completed static query boundary.
  `StaticSceneQuery` is now small enough to adapt directly for runtime-facing behavior, and
  `pickStaticSceneRay` is available for lower-level composition with explicit
  `EnvCellCommittedRecordStore` and `LandblockGridSpatialIndex` dependencies if the merged query
  implementation needs that shape.
- 2026-06-27: Static DTOs, filters, hit variants, and selection-key helpers are now imported from
  `runtime/scene-query/contracts.ts` and `runtime/scene-query/static-selection-keys.ts`. Phase 7A/7B
  should not add compatibility imports from `runtime/static-scene-query.ts` for those contracts.
- 2026-06-27: Static debug/detail behavior is now isolated in
  `runtime/scene-query/static-selection-debug.ts`. Dynamic inspection should add a parallel dynamic
  detail provider or merged detail layer rather than extending static selection labels.
- 2026-06-27: Implemented the portal aperture query cutover. `StaticScenePickFilters` now has
  `includeEnvCellPortals`, `StaticSceneQuery.pickRay` owns regular static and env-cell portal
  aperture hits, and `ClientRuntimeImpl.pickStaticRay` only derives the portal filter from the
  existing debug overlay state.
- 2026-06-27: Added `runtime/scene-query/env-cell-portal-picking.ts` so portal target construction,
  render-anchor translation, and portal aperture triangulation live under the static query boundary.
  Runtime debug overlay rendering reuses the same triangulation helper rather than carrying a second
  geometry copy.
- 2026-06-27: `StaticSceneQuery.querySelectionDebugBounds` and
  `StaticSceneQuery.queryEnvCellPortalDetails` now serve env-cell portal selections, so selected
  static diagnostics no longer call runtime-private portal query helpers.

Debt and follow-up:

- No Phase 7A-specific compatibility wrapper remains. Phase 7B still needs the planned migration from
  `pickStaticRay` to the merged static/dynamic scene-query surface.

### Phase 7B: Merged Static/Dynamic Scene Query Surface

Status: pending.

Purpose:

- Replace static-only caller semantics with a scene query that can merge static and dynamic hits
  without making query membership equal default selection.

Deliverables:

- Add merged scene-query request/hit types with static and dynamic variants under
  `apps/holtburger-3d/src/lib/runtime/scene-query/`. The merged surface is runtime composition, not
  a dynamic-only module.
- Keep merged query contracts separate from static-only contracts unless the static contract module
  is deliberately renamed and re-scoped. Prefer a merged contracts module that wraps static hit
  variants and dynamic hit variants.
- Query static hits through the complete Phase 7A static query API.
- Add a narrow dynamic query method owned by the dynamic runtime/controller boundary that queries
  indexed outdoor dynamic bounds and returns lightweight records keyed by dynamic entity id. The
  spatial index should return keys/bounds/precision, not deep dynamic entity records.
- Add dynamic hit records with semantic dynamic entity id, bounds, distance, hit point, precision,
  source residence, and filter/selectability metadata. Richer dynamic diagnostics are looked up
  separately by entity id only when requested.
- Preserve coordinate-space metadata through dynamic broadphase and narrow-phase picking. Indexed
  bounds are landblock-local records; merged query hit math must translate them to render space using
  the current outdoor render anchor before comparing against static hits.
- Add explicit caller filter modes for default browser selection, debug inspection, and diagnostics.
- Migrate runtime/browser call sites from `pickStaticRay` toward the merged query surface.
- Keep a temporary static compatibility wrapper only if needed for small-step migration, and mark it
  as cleanup debt.
- Update browser selection diagnostics so dynamic inspection does not depend on static selection-key
  labels.

Acceptance criteria:

- The merged query implementation lives in `runtime/scene-query/` and consumes static hits through
  the Phase 7A static query API.
- Dynamic broadphase queries use `OutdoorDynamicSpatialIndex` through a narrow dynamic query method;
  merged query code does not scan `DynamicRuntimeSnapshot.records` for picking and does not reach
  through private controller/tracker fields.
- Dynamic AABB candidates are translated into the same render-space frame as static hits and narrowed
  with ray/bounds intersection before they become hits.
- Existing static picking tests pass through the merged query path.
- Dynamic AABB hits are ordered with static hits by nearest distance.
- Default browser selection filters exclude the two static-authored dynamic scenery targets.
- Debug/inspection filters can return those same dynamic targets.
- Browser picking calls the merged scene-query surface even when the default selection filter excludes
  first-cut dynamic scenery; otherwise the merged query is not considered wired into the runtime.
- Env-cell dynamic records remain absent from merged query hits until an explicit env-cell dynamic
  query/index path exists.
- Any remaining `pickStaticRay` wrapper is documented as temporary cleanup debt with no new callers
  added.

Task checklist:

- [ ] Define merged query contracts in a new runtime scene-query module rather than extending
      static-only contracts in place.
- [ ] Add static query source composition through the Phase 7A `StaticSceneQuery` API.
- [ ] Use `runtime/scene-query/static-picking.ts` only when lower-level static hit composition is
      cleaner than calling the facade; do not import old static query internals.
- [ ] Route static detail/debug lookup through `runtime/scene-query/static-selection-debug.ts` or
      facade methods rather than reimplementing static selection-key handling.
- [ ] Add a narrow dynamic bounds query method that returns indexed outdoor dynamic bounds records
      keyed by entity id.
- [ ] Add dynamic query source logic that uses indexed bounds as broadphase candidates and ray/AABB
      math as the narrow phase.
- [ ] Add tests proving dynamic hits are stable across render-anchor changes and cross-landblock
      indexed bounds.
- [ ] Update browser picking and diagnostics call sites to use the merged surface.
- [ ] Add tests proving hit ordering, no dynamic snapshot scans for picking, default-selection
      exclusion for first-cut dynamic scenery, debug/inspection inclusion for the same dynamic
      targets, and env-cell dynamic exclusion until a real query path exists.
- [ ] Run phase verification commands.

Decisions and course corrections:

- 2026-06-27: The merged query home should be `runtime/scene-query/`, not
  `dynamic/dynamic-scene-query.ts`, because it composes static and dynamic results for runtime and
  browser callers. Dynamic-specific lookup should remain behind a narrow query method that consumes
  `OutdoorDynamicSpatialIndex` and returns lightweight keyed bounds records.
- 2026-06-27: Phase 7B must prove selection policy separately from query membership. The two
  first-cut dynamic scenery targets should be queryable for debug/inspection but excluded by the
  default browser selection filter.
- 2026-06-27: Dynamic hit results should not carry deep dynamic records. The spatial index returns
  keys and bounds; richer dynamic diagnostics remain a separate lookup by entity id so query results
  stay lightweight and selection does not accidentally become diagnostics transport.
- 2026-06-27: Phase 7A completed the static query surface cleanup. Phase 7B should call
  `StaticSceneQuery.pickRay` with merged-query-derived filters instead of reimplementing or
  special-casing env-cell portal aperture hits.

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
- Route dynamic texture use through the shared prepared texture atlas/cache path when a dynamic
  material resolves to an atlas-compatible prepared texture and matching sampler/material
  requirements.
- Use live object/root and per-part transforms from dynamic runtime, including active `SetOmega`
  transform state.
- Keep dynamic resource identity separate from semantic dynamic entity identity.
- Add renderer diagnostics for dynamic visual resources, dynamic instances, dynamic draw calls, and
  skipped dynamic submissions.
- Add neutral or dynamic texture-binding owner records for dynamic visual resources instead of
  pretending they are static object visual resources.
- Do not let dynamic resources borrow static draw-unit or static visual-resource owner keys, static
  batch ids, or static layer replacement lifetime.

Acceptance criteria:

- The renderer can draw the windmill target from dynamic resource/instance commits.
- The renderer can draw the bird target with animated wing poses and active `SetOmega` object/root
  transform state.
- Dynamic submissions do not go through static layer payloads or `StaticObjectRenderInstance`.
- Dynamic renderer state is not stored in `#staticObjectRenderInstances` and is not cleared through
  static layer replacement ownership.
- Compatible static and dynamic consumers of the same prepared texture converge on one atlas/cache
  entry while retaining distinct static/dynamic owners or leases.
- Dynamic texture placement survives unrelated static layer replacement when the dynamic resource is
  still leased.
- Any dynamic material that cannot use the shared atlas/cache path is skipped or separately handled
  with an explicit diagnostic; no silent per-entity texture upload fallback.
- Removing a dynamic record removes renderer submissions/resources that are no longer leased.
- Existing static rendering diagnostics remain stable.
- Neither first-cut target is submitted as baked static outdoor detail geometry.

Task checklist:

- [ ] Define dynamic renderer commit DTOs.
- [ ] Extract/generalize visual resource upload helpers.
- [ ] Add dynamic or neutral texture-use owner keys and lease/release handling for dynamic visual
      resources.
- [ ] Share atlas/cache entries by prepared texture identity plus sampler/material requirements
      across compatible static and dynamic consumers.
- [ ] Implement WebGL2 dynamic resource storage and draw path.
- [ ] Commit dynamic snapshots from `DynamicEntityController`.
- [ ] Add renderer and runtime tests for add/update/remove and `SetOmega` transform consumption.
- [ ] Run phase verification commands.

Decisions and course corrections:

- Pending.

### Phase 9: Diagnostics And First-Cut Target Validation

Status: pending.

Purpose:

- Make the first cut reviewable and prove that both `0x020003e5` and `0x020005ac` are dynamic,
  animated, indexed, and rendered for the right reasons.

Deliverables:

- Add dynamic diagnostics to runtime snapshots/reports.
- Surface classification reason, source residence, effective residence, setup id, animation id,
  current frame/time, part count, bounds, index membership, resource readiness, renderer submission
  counts, and issues.
- Add debug overlay support for dynamic bounds where useful.
- Validate `0x020003e5` and `0x020005ac` manually in the browser app.
- Record evidence and any visual concessions in this plan.

Acceptance criteria:

- Diagnostics can explain why the windmill is dynamic and currently renderable.
- The windmill animates from per-part origin/orientation frames.
- Diagnostics can explain why the bird is dynamic, has active `SetOmega`, and is currently
  renderable.
- The bird animates from per-part wing frames and active object/root omega state.
- It is debug/inspection-queryable but not default browser-selectable.
- Missing dynamic dependencies or unsupported hooks are visible in diagnostics and console output;
  the bird target's `SetOmega` hook is not reported as unsupported.
- No runtime asset dependent tests are retained in the repo.

Task checklist:

- [ ] Add diagnostics projection and browser report fields.
- [ ] Add dynamic bounds debug overlay if needed for validation.
- [ ] Validate both first-cut targets in browser mode with real DAT/static scene data.
- [ ] Update this plan with validation evidence, decisions, and concessions.
- [ ] Run full verification commands.

Decisions and course corrections:

- Pending.

### Phase 10: Resteer For Broader Hook And Dynamic-System Gate

Status: pending.

Purpose:

- Reassess the architecture after both first-cut targets are validated before expanding beyond
  `SetOmega`.

Questions to answer:

- Did DTO, runtime, renderer, and query contracts stay clean enough after supporting one real
  transform hook?
- Are dynamic bounds updates cheap and accurate enough for current-frame animated geometry?
- Did merged query migration leave any static-only wrapper debt?
- Did renderer visual-resource generalization create duplicated static/dynamic material logic?
- Which next hook/effect family has enough evidence to justify implementation: script chaining,
  texture velocity, particles, sound, material transitions, replacement visuals, or a live entity
  target?

Acceptance criteria:

- The plan records whether to proceed to the next hook/effect family, split cleanup first, or revise
  the dynamic runtime shape.
- Any blocking debt is converted into explicit tasks before broad hook behavior is added.

Task checklist:

- [ ] Review implementation diff and diagnostics.
- [ ] Compare both first-cut targets against requirements evidence.
- [ ] Review whether `SetOmega` transform state, bounds, query, and rendering created reusable hook
      handler structure.
- [ ] Update future phases before proceeding.

Decisions and course corrections:

- Pending.

### Phase 11: Cleanup And Cutover Hardening

Status: pending.

Purpose:

- Remove transitional naming, wrappers, and duplication introduced during the first cut.

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
- [ ] Update this plan with final first-cut status.

Decisions and course corrections:

- Pending.

## Risks And Mitigations

- Risk: dynamic seeds accidentally remain in baked static output.
  Mitigation: add tests that assert default-animation seeds are diverted and not baked for the
  first-cut targets.

- Risk: animation route work leaks host route strings into runtime identity.
  Mitigation: keep route strings at host/preparation boundaries and create typed animation identity
  records in dynamic runtime state.

- Risk: renderer visual-resource reuse becomes a static-layer dependency.
  Mitigation: extract/generalize helpers before adding dynamic commits; do not call
  `setOutdoorDetailsLayer` for dynamic resources. Share prepared texture atlas/cache entries by
  resource identity and sampler/material requirements, not by static owner identity.

- Risk: dynamic textures bypass the existing atlas/cache path and create duplicate uploads.
  Mitigation: Phase 4B must preserve atlas-compatible prepared texture identity and sampler/material
  requirements; Phase 8 must prove compatible static and dynamic consumers converge on one shared
  atlas/cache entry with distinct owners.

- Risk: merged query becomes a debug-only path.
  Mitigation: migrate browser picking through the merged scene-query surface and express default
  selection as filters.

- Risk: merged query integration reinforces the current static scene-query god module.
  Mitigation: complete the static scene-query decomposition detour and Phase 7A static query surface
  cleanup before Phase 7B composes merged query behavior through the resulting static facade.

- Risk: current-frame AABB bounds are too conservative or visibly wrong.
  Mitigation: expose precision metadata and part bounds diagnostics; defer per-part sphere/polygon
  precision until a target proves it is needed.

- Risk: new broadphase dependency adds type or package churn.
  Mitigation: hide it behind `OutdoorDynamicSpatialIndex` and add it through `npm` tooling during
  implementation.

- Risk: extracting AC placement/matrix helpers from the static bake namespace creates broad import
  churn or ambiguous ownership.
  Mitigation: move only the already shared math primitives into a neutral frontend math module, keep
  behavior unchanged with focused tests, and mark any compatibility export as temporary cleanup debt.

- Risk: resource readiness duplicates static material logic.
  Mitigation: extract part-agnostic helpers only where facts are isomorphic; avoid dynamic-only
  material interpretation.

- Risk: dynamic resources become either per-entity duplicate loads or a fake process-global
  animation/motion/script/effect LUT.
  Mitigation: keep the resource manager keyed by typed DAT resource ids, dedupe and lease shared
  prepared entries, and load per-resource table assets only when referenced by active entities or
  implemented behavior.

- Risk: static-authored dynamic registration remains split by source residence and accumulates
  outdoor-only branches.
  Mitigation: Phase 3B registers classified env-cell authored dynamic seeds in the same dynamic
  runtime family before Phase 4A/4B resource readiness, while keeping placement/query/render behavior
  staged by source residence.

- Risk: env-cell parity becomes nominal rather than functional by mirroring every env-cell static
  object into dynamic state without evidence that it should behave dynamically.
  Mitigation: classify in the env-cell baker from `payload.sourceAssets`, emit a separate
  `env-cell-static-object-dynamic-seed` only for setup-model/default-animation seeds, prove
  unclassified env-cell statics are not registered, and keep rendering cutover explicitly out of
  Phase 3B.

- Risk: env-cell dynamic registration corrupts static env-cell scene/query membership by changing
  the meaning of `env-cell-static-object-seed`.
  Mitigation: keep `env-cell-static-object-seed` as the static membership record and add a separate
  classified dynamic variant. Existing env-cell static scene query and system layer tests must pass
  unchanged unless a later phase intentionally changes static cutover behavior.

- Risk: env-cell dynamic records poison outdoor-only placement, indexing, or renderer paths.
  Mitigation: model source/effective residence explicitly and keep env-cell dynamic records
  non-renderable or render-pending until env-cell placement/render membership is implemented and
  tested.

- Risk: typed `SetOmega` state exists but is not consumed by bounds or rendering.
  Mitigation: Phase 5B added typed decode and active transform state; Phase 6 must compose it into
  hook-aware bounds before Phase 8 renders the bird target.

## Definition Of Done

- `0x020003e5` is rendered through the dynamic runtime, not baked static geometry.
- `0x020005ac` is rendered through the dynamic runtime with typed `SetOmega` transform behavior, not
  baked static geometry and not a final unsupported-hook compromise.
- Static-authored dynamic registration supports both outdoor landblock and env-cell source
  residence; outdoor rendering is first-cut complete, while classified env-cell records are at
  least registered through the `env-cell-static-object-dynamic-seed` variant, diagnosable, retained,
  and evicted through the shared dynamic runtime without changing env-cell static rendering until the
  explicit env-cell render cutover phase.
- The windmill target plays default animation `0x0300061b` with live per-part origin/orientation
  frames.
- The bird target plays default animation `0x03000751` with live per-part wing frames and active
  object/root omega state from its frame-0 `SetOmega` hook.
- Dynamic resource readiness uses setup, available setup appearance/gfx/material/texture facts, and
  animation assets through the asset service; missing setup appearance is allowed only when the
  setup-provided part resources are sufficient and diagnostics say so.
- Dynamic renderer submissions use explicit dynamic resource and instance commits.
- Dynamic renderer texture use shares compatible prepared texture atlas/cache entries with static
  consumers while using dynamic or neutral owner keys and dynamic leases.
- Dynamic current-frame bounds are indexed and queryable through the merged scene-query surface.
- Browser default selection excludes both static-authored dynamic scenery targets, while
  debug/inspection queries can report them.
- Diagnostics explain dynamic classification, readiness, playback, bounds, index membership, and
  renderer submission state.
- Unsupported hooks are preserved and diagnosed; supported `SetOmega` is reported as active transform
  state, not skipped behavior.
- Full verification commands pass, or unrelated pre-existing failures are documented.
- This plan is updated with completed decisions, concessions, and remaining full-system open gates.

## Open Questions

- Should the first-cut target validation get a dedicated browser diagnostics panel row, or is the
  existing diagnostics report enough once dynamic fields are added?
