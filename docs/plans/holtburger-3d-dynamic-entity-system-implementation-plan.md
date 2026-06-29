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
- Dynamic query membership therefore must not imply retail gameplay targetability. Browser mode may
  still select dynamic scenery for inspection; caller policy decides browser inspection, gameplay
  targeting, and retail-parity filtering separately.

Phase-order rationale:

- DTO and seed plumbing come before renderer work because the first-cut targets cannot enter the
  frontend runtime honestly without outdoor seed variants and animation asset payloads.
- Runtime/resource/playback work comes before renderer commits because renderer submissions should
  consume current semantic dynamic state, not create it.
- Query/index work comes before validation because the first visible target must be inspectable and
  must prove that browser inspection, diagnostics, and gameplay targeting remain caller policies over
  query results.
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
  and are installed through static layer replacement. Phases 8A and 8B must extract or generalize
  helper functions before adding dynamic draw submission; they should not make dynamic renderer
  state another entry in `#staticObjectRenderInstances`.
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
- Setup default animation playback using continuous pose sampling over authored 30 FPS frames.
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
- Treating browser dynamic selection as proof of retail gameplay targetability. The first targets may
  be selectable in browser mode for inspection even though retail visual checks showed they are not
  gameplay-selectable.

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
  records remain part of the env-cell static rendering/query path until Phase 3B explicitly
  registers classified env-cell dynamic seeds in the dynamic runtime.
- 2026-06-26: New records are explicitly non-renderable with `resources-pending` diagnostics. This
  closes the Phase 3 "missing resources keep source record alive" requirement without pretending
  setup/animation leases or renderer submissions exist before Phases 4 and 8.
- 2026-06-26: Scope eviction currently removes semantic records only. Resource leases, spatial index
  entries, and renderer submissions have no concrete Phase 3 state to release yet; Phase 4, Phase 6,
  Phase 8B, and Phase 8C must hook their cleanup into the same controller removal path when they add
  those derived states.
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
  until Phase 8F introduces an explicit, tested rule for diverting classified env-cell objects away
  from static output and into dynamic renderer membership.
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
  "resources-pending" diagnostics until resource readiness and Phase 8F env-cell render membership
  are implemented.
- Preserve existing env-cell static rendering/query behavior during this parity phase. Do not remove
  classified env-cell dynamic objects from static output until Phase 8F adds and tests the rendering
  cutover rule.
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
  variant untouched until the Phase 8F env-cell render cutover.
- 2026-06-26: Implementation keeps `env-cell-static-object-seed` emission unchanged and appends
  `env-cell-static-object-dynamic-seed` only for setup-model/default-animation seeds. Static scene
  query can key the new variant, but env-cell grouping and system layer assembly continue to filter
  only the static membership variant.
- 2026-06-26: Classified env-cell dynamic runtime records use env-cell residence, retain against the
  existing `landblock-env-cells` static source scope key, and initially stayed non-renderable with
  both resource and temporary render-path diagnostics. Phase 8F removed that temporary render-path
  diagnostic entirely.
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
  output still includes those objects through `env-cell-static-object-seed`; Phase 8F must
  explicitly remove classified env-cell dynamic objects from static output before submitting them
  through dynamic renderer membership.
- Closed by Phase 8F: the temporary render-path-pending diagnostic was removed after env-cell
  dynamic placement/render membership became real.

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
  needed by Phase 8A to route compatible static and dynamic consumers through shared atlas/cache
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
  Phase 8A to share atlas/cache entries with compatible static consumers.
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
  but actual dynamic atlas ownership belongs in Phase 8A unless texture owner types are generalized
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
  not allocate atlas space or install texture placements. Phase 8A still owns dynamic texture
  binding ownership and shared atlas/cache integration.
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
  orientations once Phase 8C submits the bird target. The first-cut target proves continuous
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

Status: completed 2026-06-27.

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
- Browser picking can return the two static-authored dynamic scenery targets for inspection.
- Debug/inspection filters can also return those same dynamic targets.
- Browser picking calls the merged scene-query surface; otherwise the merged query is not considered
  wired into the runtime.
- Env-cell dynamic records remain absent from merged query hits until Phase 8F adds an explicit
  env-cell dynamic query/index path behind the same merged dynamic query family.
- Any remaining `pickStaticRay` wrapper is documented as temporary cleanup debt with no new callers
  added.

Task checklist:

- [x] Define merged query contracts in a new runtime scene-query module rather than extending
      static-only contracts in place.
- [x] Add static query source composition through the Phase 7A `StaticSceneQuery` API.
- [x] Use `runtime/scene-query/static-picking.ts` only when lower-level static hit composition is
      cleaner than calling the facade; do not import old static query internals.
- [x] Route static detail/debug lookup through `runtime/scene-query/static-selection-debug.ts` or
      facade methods rather than reimplementing static selection-key handling.
- [x] Add a narrow dynamic bounds query method that returns indexed outdoor dynamic bounds records
      keyed by entity id.
- [x] Add dynamic query source logic that uses indexed bounds as broadphase candidates and ray/AABB
      math as the narrow phase.
- [x] Add tests proving dynamic hits are stable across render-anchor changes and cross-landblock
      indexed bounds.
- [x] Update browser picking and diagnostics call sites to use the merged surface.
- [x] Add tests proving hit ordering, no dynamic snapshot scans for picking, browser-selection
      inclusion for dynamic scenery inspection, debug/inspection inclusion for the same dynamic
      targets, and env-cell dynamic exclusion until Phase 8F adds a real query path.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-27: The merged query home should be `runtime/scene-query/`, not
  `dynamic/dynamic-scene-query.ts`, because it composes static and dynamic results for runtime and
  browser callers. Dynamic-specific lookup should remain behind a narrow query method that consumes
  `OutdoorDynamicSpatialIndex` and returns lightweight keyed bounds records.
- 2026-06-27: Phase 7B must prove selection policy separately from query membership. The original
  dry-run expectation excluded the two first-cut dynamic scenery targets from default browser
  selection; later implementation allows browser click selection for inspection while keeping retail
  gameplay targeting as a separate caller policy.
- 2026-06-27: Dynamic hit results should not carry deep dynamic records. The spatial index returns
  keys and bounds; richer dynamic diagnostics remain a separate lookup by entity id so query results
  stay lightweight and selection does not accidentally become diagnostics transport.
- 2026-06-27: Phase 7A completed the static query surface cleanup. Phase 7B should call
  `StaticSceneQuery.pickRay` with merged-query-derived filters instead of reimplementing or
  special-casing env-cell portal aperture hits.
- 2026-06-27: Implemented merged query contracts and source composition in
  `runtime/scene-query/merged-scene-query-contracts.ts` and
  `runtime/scene-query/merged-scene-query.ts`. Static hits are wrapped as static scene hits, and
  dynamic hits carry lightweight `entityId`, bounds, distance, precision, source residence, and
  selectability metadata.
- 2026-06-27: Added narrow dynamic query methods on `DynamicEntityController` and
  `DynamicPlacementTracker`, plus `OutdoorDynamicSpatialIndex.landblockIds()`. Merged query consumes
  keyed indexed bounds through those methods rather than scanning `DynamicRuntimeSnapshot.records` or
  reaching into private controller/tracker fields.
- 2026-06-27: Browser terrain grounding and click selection now call `pickSceneRay` in
  `default-selection` mode. The compatibility `pickStaticRay` wrapper remains only for existing
  runtime callers/tests and delegates through the merged query surface.
- 2026-06-27: Browser `default-selection`, `debug-inspection`, and `diagnostics` scene query modes
  can return first-cut static-authored dynamic scenery for inspection. Env-cell dynamic records remain
  excluded until Phase 8F adds the env-cell dynamic query/index path.

Debt and follow-up:

- Remove the temporary `ClientRuntime.pickStaticRay` compatibility wrapper during Phase 11 once
  remaining tests and any internal callers are migrated to `pickSceneRay`.
- Browser selected-diagnostics UI originally presented static-only selections. Dynamic browser
  selection now exists for inspection; richer per-entity diagnostics should be looked up by
  `entityId` without depending on static selection-key labels.
- Dynamic broadphase now uses indexed landblock ids plus conservative per-landblock RBush searches
  before ray/AABB narrowing. This avoids snapshot scans and keeps spatial-index ownership intact, but
  a later performance pass can tighten the RBush search bounds to the ray segment inside each
  landblock if needed.

### Phase 8A: Dynamic Renderer Contracts And Neutral Texture Ownership

Status: completed on 2026-06-27.

Purpose:

- Define the renderer/runtime contract for dynamic visual resources and instances, and generalize
  texture ownership so dynamic resources can use the prepared texture atlas/cache path without
  pretending to be static draw units or static object visual resources.

Deliverables:

- Add renderer-facing dynamic resource and instance commit types.
- Add neutral or dynamic texture-binding owner records for dynamic visual resources.
- Rename or wrap static-only texture binding helpers where they represent generic prepared texture
  placement and binding behavior.
- Refactor `TextureManager.applyStaticCommitDelta` or extract its shared placement/lease path so
  dynamic texture uses can participate without constructing fake static commit deltas.
- Generalize renderer texture binding storage from static-only owner keys to visual texture owner
  keys while keeping existing static owner semantics intact.
- Route dynamic texture use through the shared prepared texture atlas/cache path when a dynamic
  material resolves to an atlas-compatible prepared texture and matching sampler/material
  requirements.
- Keep dynamic resource identity separate from semantic dynamic entity identity.
- Do not let dynamic resources borrow static draw-unit or static visual-resource owner keys, static
  batch ids, or static layer replacement lifetime.

Acceptance criteria:

- Dynamic renderer commit DTOs exist and are typed separately from static layer payloads and
  `StaticObjectRenderInstance`.
- Dynamic texture binding owners can be keyed, compared, leased, released, and diagnosed without
  using `draw-unit` or `static-object-visual-resource` owner kinds.
- Compatible static and dynamic consumers of the same prepared texture converge on one atlas/cache
  entry while retaining distinct static/dynamic owners or leases.
- Any dynamic material that cannot use the shared atlas/cache path is explicitly represented as
  skipped/unsupported in the dynamic commit diagnostics contract; no silent per-entity texture upload
  fallback is introduced.
- Existing static rendering diagnostics remain stable.

Task checklist:

- [x] Define dynamic renderer commit DTOs.
- [x] Add dynamic or neutral texture-use owner keys.
- [x] Generalize prepared texture placement/binding helper names and types where needed.
- [x] Extract shared texture placement/lease accounting from `TextureManager.applyStaticCommitDelta`.
- [x] Generalize WebGL2 texture binding owner maps away from static-only owner keys.
- [x] Share atlas/cache entries by prepared texture identity plus sampler/material requirements
      across compatible static and dynamic consumers.
- [x] Add renderer/runtime tests proving owner key separation and atlas/cache convergence.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-27: Split the previous monolithic renderer phase into contract/ownership, resource
  residency, and per-frame submission phases. The texture owner model is the riskiest seam because
  the current renderer vocabulary is intentionally static-authored; dynamic resources must get their
  own owner identity before WebGL2 storage or draw submission is added.
- 2026-06-27 dry run: `TextureManager.applyStaticCommitDelta` currently owns prepared texture lease
  accounting, texture-ref owner cleanup, and static texture binding emission together. Phase 8A
  should extract a shared texture-use placement path rather than add a parallel dynamic packer or
  force dynamic resources through fake static commit deltas.
- 2026-06-27 dry run: WebGL2 texture bindings are currently stored by `StaticTextureBindingOwner`
  and dirty static payloads by static owner. Phase 8A must introduce a neutral owner/key surface
  before dynamic resource residency is added; otherwise Phase 8B would have to choose between
  static owner spoofing and duplicate texture upload behavior.
- 2026-06-27: Added neutral `TextureBindingOwner`/`TextureBinding` contracts with a
  `dynamic-visual-resource` owner variant and shared owner-key helper. `StaticTextureBinding`
  remains as a compatibility alias while static payload helpers are still static-named.
- 2026-06-27: Added renderer-facing dynamic resource and instance commit DTOs. These are contract
  types only in Phase 8A; WebGL2 residency and draw submission are intentionally left to Phases 8B
  and 8C.
- 2026-06-27: Extracted texture manager static commit handling through a shared visual texture-use
  delta path and added `applyDynamicTextureUseDelta()`. Dynamic callers can now lease compatible
  prepared texture atlas/cache entries through a `dynamic-visual-resource` owner without creating
  fake static commit deltas.
- 2026-06-27: WebGL2 now keys texture bindings through the shared owner-key helper. Dynamic owner
  dirtying was initially a no-op during Phase 8A, then Phase 8E closed that handoff by dirtying
  resident dynamic prepared payload state.
- 2026-06-27: Verification results: `npm run test:ts -- texture-manager.test.ts` and
  `npm run check` pass from `apps/holtburger-3d`.

Debt and follow-up:

- Static payload helpers and tests still use `StaticTextureBinding` naming even though the type is
  now a compatibility alias for the neutral texture binding contract. Cleanup should rename helper
  surfaces only where dynamic resources actually consume them.
- 2026-06-27: The earlier dynamic prepared-payload dirtying handoff is closed by Phase 8E.
  `dynamic-visual-resource` texture owners now dirty resident dynamic prepared payload state.

### Phase 8B: Dynamic Renderer Resource Residency

Status: completed on 2026-06-27.

Purpose:

- Install, retain, and remove dynamic visual resources in WebGL2-owned dynamic renderer state,
  independent of static layer replacement.

Deliverables:

- Generalize reusable visual resource upload/cache helpers currently tied to outdoor-detail static
  layer replacement.
- Add WebGL2 dynamic visual resource storage keyed by dynamic renderer resource identity.
- Add dynamic resource installation and removal commits.
- Hook dynamic renderer resource cleanup into dynamic record/resource removal.
- Add renderer diagnostics for dynamic visual resources and skipped dynamic resource installs.
- Add dynamic resource counts to renderer diagnostics snapshots without inflating existing static
  counters.
- Keep dynamic resource residency separate from static draw-unit, static object visual-resource, and
  static layer replacement ownership.

Acceptance criteria:

- Dynamic renderer resources are not stored in `#staticObjectRenderInstances` or static visual
  resource maps.
- Dynamic renderer resources are not cleared through unrelated static layer replacement ownership.
- Dynamic texture placement survives unrelated static layer replacement when the dynamic resource is
  still leased.
- Removing a dynamic record removes renderer resources that are no longer leased.
- Static rendering diagnostics and static resource removal behavior remain stable.
- Neither first-cut target is submitted as baked static outdoor detail geometry.

Task checklist:

- [x] Extract/generalize visual resource upload helpers.
- [x] Implement WebGL2 dynamic resource storage.
- [x] Implement dynamic resource install/remove commits.
- [x] Connect dynamic resource cleanup to `DynamicEntityController`/resource-manager removal.
- [x] Add renderer tests for add/update/remove and static layer replacement isolation.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-27 dry run: `Webgl2Renderer` currently disposes and snapshots static resources through
  static-specific maps and counts. Phase 8B should add dynamic resource maps and diagnostics before
  drawing, so later draw-path work cannot accidentally hide dynamic residency inside
  `#staticObjectVisualResources`, `#staticObjectRenderInstances`, or static layer ownership.
- 2026-06-27: Added `Renderer.commitDynamicResources()` and WebGL2 dynamic visual-resource
  residency keyed by `DynamicRendererResourceId`. Dynamic residency, texture-use count, and recent
  commit diagnostics are exposed through `RendererSnapshot` without changing static counters.
- 2026-06-27: Runtime now queues dynamic renderer resource sync from dynamic resource changes,
  static seed ingestion, and static scope retention. Ready `DynamicEntitySummaryDto` records are
  converted into dynamic visual-resource commits; removed records release dynamic texture owners and
  renderer resources.
- 2026-06-27: Runtime records source-scope to committed `staticBatchId` mappings from static
  materialization so dynamic texture commits can target the same atlas scope when the static source
  batch is known. If no static batch mapping exists, dynamic texture commits use a stable
  `dynamic:${sourceScopeKey}` batch id rather than borrowing fake static ownership.
- 2026-06-27: Added a dynamic renderer resource sync warning event instead of reporting dynamic sync
  failures as static materialization failures.
- 2026-06-27: Verification results: `npm run test:ts -- client-runtime.test.ts
webgl2-renderer.test.ts texture-manager.test.ts` and `npm run check` pass from
  `apps/holtburger-3d`.

Debt and follow-up:

- 2026-06-27: The earlier GPU geometry upload handoff is closed by Phase 8E.
- Dynamic visual resource identity remains one renderer resource per ready dynamic entity. Phase 8E
  uploads one GPU geometry resource per source part underneath that semantic resource identity; if a
  later render-quality pass needs material-pass splitting, split GPU storage without changing
  semantic dynamic entity/resource identity.

### Phase 8C: Dynamic Renderer Instance Submission And Animated Poses

Status: completed on 2026-06-27.

Purpose:

- Submit per-frame dynamic instances using live dynamic runtime transforms without sending full
  dynamic records into the renderer.

Deliverables:

- Add per-frame dynamic instance submission from `DynamicEntityController` summaries.
- Use live object/root and per-part transforms from dynamic runtime, including active `SetOmega`
  transform state.
- Add renderer diagnostics for dynamic instances, dynamic draw calls, and skipped dynamic
  submissions.
- Keep dynamic instance identity separate from semantic dynamic entity identity and dynamic resource
  identity.

Acceptance criteria:

- The renderer receives lightweight dynamic instance commits derived from dynamic summary DTOs.
- Dynamic instance commits include composed object/root placement and per-part transforms.
- Dynamic instance commits consume active `SetOmega` transform state through the dynamic animation
  summary path rather than parsing hook payloads in the renderer.
- Dynamic submissions do not go through static layer payloads or `StaticObjectRenderInstance`.
- Dynamic renderer state is not stored in `#staticObjectRenderInstances` and is not cleared through
  static layer replacement ownership.
- Removing a dynamic record removes renderer submissions that are no longer valid.
- Existing static rendering diagnostics remain stable.
- Neither first-cut target is submitted as baked static outdoor detail geometry.

Task checklist:

- [x] Commit lightweight dynamic render summaries from `DynamicEntityController`, derived from
      `DynamicEntitySummaryDto` rather than full `DynamicEntityRecord` objects.
- [x] Implement WebGL2 dynamic instance storage/submission.
- [x] Add renderer and runtime tests for add/update/remove and dynamic instance submission.
- [x] Run phase verification commands.

Decisions and course corrections:

- 2026-06-27 dry run: `DynamicRuntimeSnapshot.records` already contains lightweight animation
  playback summaries, object-root pose, part poses, and active omega summaries. Phase 8C should
  derive render submissions from those summary DTOs or an even narrower render-summary DTO; the
  renderer should not receive full dynamic records or resource-manager internals.
- 2026-06-27: Added `Renderer.commitDynamicInstances()` and WebGL2 dynamic instance storage.
  Runtime commits per-frame dynamic instances from lightweight dynamic summaries after animation
  ticking. Instance object matrices compose the base source placement/scale with current object-root
  pose, and part matrices use current per-part poses.
- 2026-06-27: Added `baseTransform` to `DynamicEntitySummaryDto` so renderer submissions can consume
  source placement/scale without receiving full dynamic records.
- 2026-06-27: WebGL2 initially recorded dynamic instances and skipped submissions without issuing
  draw calls during Phase 8C. Phase 8E closed that handoff by uploading dynamic geometry and drawing
  matching resource/instance submissions.
- 2026-06-27: Verification results so far: `npm run test:ts -- client-runtime.test.ts
webgl2-renderer.test.ts texture-manager.test.ts dynamic-entity-store.test.ts
dynamic-placement-tracker.test.ts` and `npm run check` pass from `apps/holtburger-3d`.
- 2026-06-27: Closed Phase 8C as the instance-submission milestone and split the remaining visual
  work into Phase 8D and Phase 8E. The prior phase title overloaded "animated poses" and "draw the
  targets"; the cleaner boundary is now instance summaries first, dynamic visual geometry extraction
  second, and WebGL2 dynamic draw execution third.

Debt and follow-up:

- 2026-06-27: The earlier dynamic draw-call handoff is closed by Phase 8E. WebGL2 now uploads
  dynamic geometry and issues draw calls for installed dynamic resources with matching instances.
- 2026-06-27: The earlier `SetOmega` renderer-submission assertion is closed by Phase 8D runtime
  coverage. Runtime dynamic instance composition now includes active omega object-root rotation.
- The first-cut windmill and bird visual acceptance criteria remain open for Phase 9 manual browser
  validation, even though Phase 8E now implements dynamic draw calls.

### Phase 8D: Dynamic Visual Geometry DTOs And Resource Extraction

Status: completed on 2026-06-27.

Purpose:

- Turn ready dynamic visual resources into renderer-owned part geometry/material DTOs without
  borrowing static layer payloads or hiding static-bake assumptions inside the dynamic resource
  manager.

Deliverables:

- Extend dynamic visual readiness records with per-part render geometry, material entries, material
  slot indices, texture-use ids, render state, and bounds.
- Build those dynamic render parts from setup/gfx/material facts already requested by the dynamic
  resource manager.
- Preserve texture-use identity between dynamic material requirements, texture-manager placement,
  and renderer material entries.
- Fail loudly for malformed dynamic geometry or missing material facts that should be present after
  readiness. Do not add magenta/default material fallbacks for internal extraction failures.
- Keep source residence and lifetime ownership unchanged; this phase is resource extraction, not
  env-cell render cutover.

Acceptance criteria:

- A ready dynamic visual resource can report one or more renderer visual parts with positions,
  texcoords, indices, material slot ids, material entries, texture-use ids, render state, and local
  bounds.
- Dynamic texture-use ids are stable across material requirements, dynamic texture placement, and
  renderer material entries.
- The resource manager does not issue duplicate uncached asset requests for gfx payloads if a
  prepared asset was already obtained during readiness.
- Unsupported or malformed dynamic part extraction appears in dynamic diagnostics or rejects the
  resource request; it is not silently represented as renderable fallback geometry.
- Existing static resource readiness, static bake, and texture-manager tests remain stable.

Task checklist:

- [x] Add renderer visual-part fields to dynamic resource DTO contracts.
- [x] Extract dynamic render parts from setup/gfx/material facts in
      `dynamic-entity-resource-manager.ts`.
- [x] Reuse or return prepared gfx/material assets from the readiness request path instead of
      re-requesting them blindly.
- [x] Align dynamic texture-use ids across material requirements and renderer material entries.
- [x] Add resource-manager/runtime tests for dynamic render-part extraction and `SetOmega` summary
      consumption in instance DTOs.
- [x] Run focused verification commands.

Decisions and course corrections:

- 2026-06-27 dry run: The codebase already has partial 8D-shaped work: dynamic visual readiness
  exposes `renderParts`, texture requirements carry `textureUseId`, and
  `dynamic-entity-resource-manager.ts` has a first pass at `createDynamicRenderParts()`. Treat the
  next implementation as a hardening/completion phase, not a blank-slate design phase.
- 2026-06-27 dry run: The partial extraction currently re-requests gfx prepared assets after the
  visual host asset request path has already requested them. Phase 8D should return or cache the
  prepared gfx payloads from the readiness request path instead of relying on asset-service caching
  as an implicit correctness requirement.
- 2026-06-27 dry run: Dynamic part extraction must remove fallback material entries and zero-filled
  vertex/uv fallbacks. Missing material slots, malformed triangle vertex ranges, missing UVs, or
  unexpected payload kinds should fail the dynamic resource request with diagnostics rather than
  producing renderable-looking garbage.
- 2026-06-27 dry run: Runtime conversion still builds `DynamicRendererVisualPart` from
  `visual.sourceAssets` instead of `visual.renderParts`, and dynamic texture-use ids are recomputed
  in runtime. Phase 8D should make the resource-manager-produced texture-use ids the source of truth
  so material entries, texture placement, and renderer DTOs cannot drift.
- 2026-06-27: Added full dynamic renderer visual-part DTO fields for bounds, geometry buffers,
  material slots, material entries, render state, material family/pass, texture-use ids, and counts.
  Runtime now converts from `visual.renderParts` rather than reconstructing parts from
  `visual.sourceAssets`.
- 2026-06-27: Dynamic visual resource readiness now returns prepared gfx payloads from the visual
  host asset request path and passes those payloads into render-part extraction. The extractor no
  longer issues a second gfx request and no longer depends on asset-service caching as a hidden
  correctness requirement.
- 2026-06-27: Removed fallback material entries and zero-filled vertex/UV fallbacks from dynamic
  render-part extraction. Missing prepared gfx payloads, unexpected payload kinds, missing material
  entries, unmapped triangle surfaces, and out-of-range vertex/UV references now fail the visual
  resource request with dynamic diagnostics.
- 2026-06-27: Dynamic material table entries are built through the shared static material adapter,
  while dynamic resource extraction preserves the material plan's renderable family and pass for
  renderer DTOs. This avoids a second material-table implementation and avoids flattening indexed,
  alpha-test, transparent, or additive semantics before Phase 8E.
- 2026-06-27: Dynamic triangle material resolution now accepts both `geometrySurfaceId` and
  `materialSurfaceId` from source-closure material slot facts. Setup-appearance material slots can
  carry slot-index geometry ids while render triangles carry surface ids; the extractor remains
  strict but recognizes both ids carried by the fact model.
- 2026-06-27: Runtime dynamic instance composition now includes active `SetOmega`
  `objectRootRotation` in the submitted object matrix. Bounds already consumed this state, but the
  renderer instance summary path had only consumed sampled `objectRootPose`.
- 2026-06-27: Verification results: `npm run test:ts -- dynamic-entity-resource-manager.test.ts
client-runtime.test.ts webgl2-renderer.test.ts texture-manager.test.ts dynamic-entity-store.test.ts
dynamic-placement-tracker.test.ts` and `npm run check` pass from `apps/holtburger-3d`.

Debt and follow-up:

- Dynamic render-part extraction currently creates one renderer part per source part and keeps
  per-part material entries. Phase 8E did not need to split resident GPU resources by material pass
  for the first draw path. If later transparent/additive sorting requires a split, keep semantic
  dynamic resource identity separate from that GPU storage split.
- Closed by Phase 8F: env-cell dynamic records no longer stay renderer-gated after resource
  readiness. They now use dynamic renderer resource, instance, bounds, and merged query membership.

### Phase 8E: WebGL2 Dynamic Geometry Upload And Draw Path

Status: completed on 2026-06-27.

Purpose:

- Upload dynamic visual parts into WebGL2-owned dynamic geometry resources and issue draw calls for
  dynamic instances using live object/root and part transforms.

Deliverables:

- Add WebGL2 dynamic geometry-resource storage keyed by dynamic renderer resource id and part id.
- Reuse the static material shader, texture binding lookup, and prepared payload machinery through a
  neutral resource/texture owner path rather than copying static draw code wholesale.
- Compose instance object/root transforms with per-part transforms at draw time.
- Update dynamic draw diagnostics for submitted resources, skipped resources, skipped instances, and
  issued draw calls.
- Dispose dynamic GPU resources on dynamic resource removal and renderer teardown.

Acceptance criteria:

- The renderer issues dynamic draw calls for installed dynamic visual resources with matching dynamic
  instances.
- Dynamic draw submission does not use `setOutdoorDetailsLayer`, static layer payloads,
  `StaticObjectRenderInstance`, or `#staticObjectRenderInstances`.
- Dynamic texture bindings use `dynamic-visual-resource` owners and share compatible atlas/cache
  entries with static consumers.
- Missing dynamic resources, missing texture bindings, unsupported material states, or missing GPU
  resources are counted as skipped dynamic submissions with actionable diagnostics.
- The windmill target can render through the dynamic draw path; the bird target can render through
  the same path with active object/root omega state from Phase 8C instance summaries.
- Existing static WebGL2 tests remain stable.

Task checklist:

- [x] Add WebGL2 dynamic geometry upload/disposal.
- [x] Add dynamic prepared-payload lookup keyed by dynamic texture owner.
- [x] Add dynamic draw traversal for resident dynamic instances and visual parts.
- [x] Add renderer tests for draw call emission, resource removal, texture binding reuse, and skipped
      dynamic submissions.
- [x] Add runtime/browser smoke hooks or diagnostics needed by Phase 9 validation.
- [x] Run focused verification commands.

Decisions and course corrections:

- 2026-06-27 dry run: WebGL2 already has dynamic resource and instance maps plus dynamic texture
  owner cleanup, but `commitDynamicResources()` stores DTOs only and `commitDynamicInstances()`
  deliberately resets `dynamicDrawCalls` to zero. Phase 8E is the first phase that should allocate
  dynamic GPU geometry resources.
- 2026-06-27 dry run: The static material shader and prepared-payload machinery are reusable, but the
  current helper names and owner assumptions are static-heavy. Phase 8E should add a narrow neutral
  prepared-payload lookup for dynamic visual-resource owners instead of making dynamic resources look
  like static object visual resources.
- 2026-06-27 dry run: The first draw path can be per-part/per-instance draw calls. Do not introduce
  batching, instancing, or VAO compaction while the correctness gate is still proving that windmill
  and bird visuals render from dynamic resource/instance commits.
- 2026-06-27: Added WebGL2-owned dynamic geometry resources keyed by dynamic renderer resource id,
  with one uploaded GPU resource per dynamic visual part. Dynamic GPU resources are disposed on
  dynamic resource removal and renderer teardown, and they are not stored in
  `#staticObjectVisualResources`, `#staticObjectRenderInstances`, static layer payloads, or static
  layer ownership maps.
- 2026-06-27: Dynamic geometry now reuses the static material shader and prepared payload path
  through a dynamic texture owner lookup. `dynamic-visual-resource` texture owners dirty resident
  dynamic prepared payload state, and global static-object payload invalidation now includes dynamic
  geometry because the shader payload cache is shared.
- 2026-06-27: Dynamic draw traversal composes landblock render-anchor translation, submitted
  object/root matrix, and submitted part matrix per resource part. `DynamicRendererInstance` now
  carries explicit render residence so outdoor landblock-local dynamic transforms are translated by
  landblock anchor while env-cell dynamics remain in interior render-local space.
- 2026-06-27: Dynamic renderer commits remain gated by renderability reasons. Env-cell dynamic
  records used to be registered and diagnosed but gated by a temporary render-path-pending
  diagnostic; Phase 8F removed that label from code and replaced the gate with real env-cell dynamic
  render membership.
- 2026-06-27: Added WebGL2 tests proving dynamic resource residency emits a real `drawElements`
  call, tracks `dynamicDrawCalls`, skips missing-resource submissions, survives unrelated static
  layer replacement, and stops drawing after dynamic resource removal. Texture binding reuse remains
  covered by the dynamic owner/atlas tests from Phase 8A plus the Phase 8E dynamic prepared-payload
  owner path.
- 2026-06-27: Verification results: `npm run test:ts -- webgl2-renderer.test.ts
client-runtime.test.ts dynamic-entity-resource-manager.test.ts texture-manager.test.ts
dynamic-entity-store.test.ts dynamic-placement-tracker.test.ts` and `npm run check` pass from
  `apps/holtburger-3d`.
- 2026-06-27: Final Phase 8 verification results: `npm run lint:ts`, `npm run lint:dead`,
  `npm run test:ts` (61 files / 491 tests), `npm run check`, `npm run check:rust`,
  `npm run lint:rust`, and repository-level `git diff --check` pass.

Debt and follow-up:

- This first draw path may issue straightforward per-part draw calls. WebGL2 instancing, VAO
  compaction, and batching policy remain out of scope unless first-cut validation proves correctness
  depends on them.
- Dynamic transparent/additive parts are submitted through the first direct dynamic traversal without
  a dedicated dynamic transparent sort list. Phase 9 visual validation should flag any visible
  ordering issue; otherwise a later render-quality pass can share the static transparent ordering
  machinery.

### Phase 8F: Env-Cell Dynamic Cutover Through Shared Dynamic Paths

Status: completed on 2026-06-27.

Purpose:

- Remove the temporary env-cell dynamic special case before diagnostics validation. Classified
  env-cell static-authored dynamics should use the same dynamic resource, playback, renderer
  resource, renderer instance, diagnostics, and query-family paths as outdoor dynamics, with
  residence-specific handling isolated to placement, visibility, and render-pass membership.

Deliverables:

- Remove classified env-cell dynamic statics from env-cell static output once they are represented
  by `env-cell-static-object-dynamic-seed`, mirroring the outdoor diversion from static bake output.
  This filtering must happen before env-cell static-object compatibility partitioning/bake creates
  draw units, not as a post-bake draw-unit cleanup.
- Remove the temporary render-path-pending env-cell diagnostic and replace the default env-cell
  dynamic renderability gate with real env-cell dynamic placement/render membership.
- Replace outdoor-only dynamic bounds/index summaries with a residence-aware shape. Outdoor records
  can keep outdoor landblock index metadata; env-cell records need env-cell membership metadata
  rather than fake outdoor `indexedLandblockIds`.
- Generalize dynamic renderer instance creation so source/effective residence can produce the
  correct render-space transform for both outdoor landblock and env-cell dynamic records.
- Extend dynamic renderer instance DTOs with explicit render residence/render-domain metadata.
  Outdoor dynamic instances may use landblock-anchor translation; env-cell dynamic instances must
  describe interior/env-cell render membership without borrowing outdoor landblock-anchor semantics.
- Route env-cell dynamic renderer resource and instance commits through the same dynamic commit
  APIs as outdoor records. Do not add an env-cell-only renderer API or a second dynamic resource
  manager.
- Update WebGL2 dynamic draw filtering so dynamic instances are drawn in the correct scene domain.
  The renderer must not keep skipping all dynamic submissions for `domain === "interior"`, and it
  must not draw env-cell dynamics in exterior-only passes.
- Add env-cell-aware dynamic query membership that composes with the merged scene-query surface and
  portal/interior visibility context. The spatial/query layer may use residence-specific indexes,
  but callers should still consume one dynamic hit/query family.
- Use the existing env-cell pick/query context, including `acceptedEnvCellIds` where present, as the
  visibility filter for env-cell dynamic debug hits. Do not create a second portal-visibility policy
  beside the merged scene-query context.
- Preserve explicit caller policy: browser mode may select dynamic scenery for inspection, while
  retail/gameplay targeting semantics must remain a separate filter.
- Keep source residence, effective residence, and render-pass membership explicit. Do not fake
  env-cell dynamics as outdoor landblock dynamics just to reuse code.
- Add diagnostics that can prove an env-cell dynamic was classified, removed from static output,
  resource-ready, dynamically submitted, and queryable through the shared dynamic surface.

Acceptance criteria:

- A classified env-cell setup/default-animation static seed no longer appears in env-cell static
  draw output and does not double-render. Tests prove the object is filtered before compatibility
  partition/bake output, not merely hidden from a published layer.
- The same classified env-cell seed reaches dynamic setup/animation/visual readiness through the
  existing `DynamicEntityResourceManager`.
- Env-cell dynamic records can produce dynamic renderer resources and instances without a temporary
  render-path-pending diagnostic.
- Env-cell dynamic renderer submissions use the same `commitDynamicResources()` and
  `commitDynamicInstances()` APIs as outdoor submissions.
- Dynamic renderer instance DTOs carry enough residence/render-domain metadata for WebGL2 to choose
  exterior versus interior drawing without inspecting semantic dynamic records.
- Env-cell dynamic placement/render-space conversion is correct for interior/portal render context
  and does not use outdoor landblock-anchor assumptions where they do not apply.
- Env-cell dynamic query/debug hits are available through the merged scene-query family with
  residence-aware filtering, use `acceptedEnvCellIds` for env-cell visibility when available, and
  browser click selection can return dynamic scenery for inspection.
- Tests prove classified env-cell dynamic statics are not emitted as static env-cell draw units once
  cut over.
- Existing outdoor dynamic windmill/bird behavior and static env-cell rendering for unclassified
  objects remain stable.

Task checklist:

- [x] Move env-cell dynamic classification from "mirror static seed" to "divert classified static
      output into dynamic seed plus dynamic render membership" before static compatibility
      partitioning/bake.
- [x] Remove the temporary render-path-pending diagnostic instead of preserving it as a future
      unsupported-residence escape hatch.
- [x] Generalize dynamic bounds/index summaries across outdoor and env-cell residence without
      preserving outdoor-only `indexedLandblockIds` as the universal shape.
- [x] Generalize dynamic placement/render transform helpers across outdoor and env-cell residence,
      proving env-cell transforms match the static env-cell object coordinate space.
- [x] Generalize dynamic renderer instance creation across outdoor and env-cell residence without
      adding env-cell-only renderer APIs.
- [x] Add dynamic renderer instance render-residence/domain metadata and WebGL2 dynamic draw
      filtering for exterior versus interior domains.
- [x] Add env-cell dynamic query/index membership behind the merged scene-query surface.
- [x] Use merged scene-query env-cell context and `acceptedEnvCellIds` for env-cell dynamic debug
      filtering.
- [x] Add tests for no double-render, dynamic renderer commit eligibility, query membership, browser
      selection of dynamic scenery for inspection, and unclassified env-cell static stability.
- [x] Update diagnostics/report fields so env-cell dynamic cutover can be inspected.
- [x] Run full verification commands.

Decisions and course corrections:

- 2026-06-27: Added as an immediate phase after reviewing the env-cell deferral. Keeping env-cell
  dynamics registered but renderer-gated creates more complexity than doing the cutover now because
  every later phase has to remember that env-cell dynamics are "dynamic except not really rendered".
- 2026-06-27: The shared path target is explicit: resource readiness, animation playback, texture
  ownership, renderer resource commits, renderer instance commits, diagnostics, and merged query
  result shapes should be common. Residence-specific code is allowed only at the boundary where
  placement, visibility, render pass, or query context genuinely differs.
- 2026-06-27: Do not paper over the problem by submitting env-cell records through outdoor dynamic
  assumptions. Env-cell dynamics need correct interior/portal render membership, not a fake outdoor
  residence.
- 2026-06-27 dry run: The current env-cell baker emits both static and dynamic seed records for
  classified env-cell objects, and the static object compatibility baker still turns every sourced
  env-cell static seed into bakeable objects. Phase 8F must filter classified dynamic seeds before
  compatibility partitioning, or the implementation will still pay bake cost and risk shared
  partition leftovers.
- 2026-06-27 dry run: Current dynamic placement and current-bounds contracts are outdoor-shaped:
  env-cell records are cleared before bounds/indexing, and current bounds expose outdoor landblock
  metadata. Phase 8F should introduce a residence-aware bounds/index summary rather than retaining
  outdoor fields as ambient requirements.
- 2026-06-27 dry run: Runtime dynamic instance creation and WebGL2 draw traversal are outdoor-shaped:
  instances carry `landblockId`, WebGL applies outdoor landblock-anchor translation, and dynamic draw
  currently returns zero for `domain === "interior"`. Phase 8F needs explicit render residence/domain
  metadata on instance DTOs and renderer-side domain filtering.
- 2026-06-27 dry run: Merged dynamic query is outdoor-only today. Phase 8F should widen the same
  query family with env-cell dynamic source methods and use the existing env-cell pick context,
  especially `acceptedEnvCellIds`, for visibility filtering.
- 2026-06-27: Classified env-cell setup/default-animation statics are no longer emitted as mirrored
  static env-cell object seeds. The env-cell baker emits the dynamic seed only, and the static object
  compatibility baker filters setup-model/default-animation env-cell sources before compatibility
  partitioning so the object is not baked as static draw output.
- 2026-06-27: Dynamic bounds state is now residence-aware. Outdoor dynamics keep outdoor landblock
  index membership, while env-cell dynamics use env-cell membership keyed by landblock id plus
  accepted env-cell ids. The old universal `indexedLandblockIds` shape is gone.
- 2026-06-27: Dynamic renderer instances now carry explicit `renderResidence`. WebGL2 uses outdoor
  landblock-anchor translation only for outdoor instances and draws env-cell dynamic instances in
  interior domain passes without adding an env-cell-only renderer API.
- 2026-06-27: Env-cell dynamic query records are exposed through the merged scene-query family.
  Browser selection and debug/query modes can return env-cell dynamic hits for inspection, and
  `acceptedEnvCellIds` filters visibility.
- 2026-06-27: Renderability status is now honest: records with no renderability reasons report
  `status: "renderable"` and no longer count as non-renderable. This prevents Phase 9 diagnostics
  from carrying a contradiction after the env-cell cutover.
- 2026-06-27: The runtime test fixture had been returning a stub prepared-texture payload for the
  resolving host path. The fixture now returns policy-valid prepared texture payloads derived from
  the requested prepared-texture key, preserving the texture manager's strict policy validation.
- 2026-06-27: Verification results from `apps/holtburger-3d`: focused
  `npm run test:ts -- landblock-env-cells-baker.test.ts dynamic-placement-tracker.test.ts
dynamic-entity-controller.test.ts dynamic-entity-resource-manager.test.ts client-runtime.test.ts
webgl2-renderer.test.ts merged-scene-query.test.ts`, plus `npm run check`, `npm run lint:ts`,
  `npm run lint:dead`, `npm run test:ts` (61 files / 493 tests), `npm run check:rust`, and
  `npm run lint:rust` pass.

Debt and follow-up:

- Env-cell dynamic query currently uses a residence-specific env-cell record map behind the same
  dynamic query/access surface instead of the outdoor RBush. That is intentional; callers consume
  merged dynamic hits and do not choose the backing index.
- The temporary render-path-pending diagnostic was removed from code. Add a new concrete diagnostic
  later only if a real unsupported residence case appears.
- Env-cell dynamic render transforms intentionally use env-cell landblock render-local coordinates.
  WebGL applies the identity matrix for the residence transform, meaning no extra residence
  translation is applied after the dynamic object matrix. If later visual validation finds a
  static/dynamic mismatch, compare against static env-cell object bake matrices before adding any
  correction factor.

### Phase 8G: Continuous Dynamic Pose Sampling

Status: completed on 2026-06-27.

Purpose:

- Smooth dynamic object/root and part animation poses between authored 30 FPS frames while keeping
  animation hooks on the discrete authored-frame event cadence.

Deliverables:

- Extend `DynamicAnimationPlayer` sampling to retain fractional frame state: current frame, next
  frame, loop iteration, and interpolation alpha.
- Interpolate object root placements and per-part local placements for the current runtime tick.
  Use linear interpolation for origins and normalized quaternion slerp for orientations.
- Keep hook dispatch keyed to authored frame crossings. Dispatch crossed authored-frame hooks in
  order, with bounded catch-up after large runtime gaps.
- Use a bounded missed-hook policy for large jumps: replay only the most recent small window of
  crossed authored frames, initially eight frames. If older crossed hooks are intentionally dropped,
  emit only a non-durable console/developer warning rather than adding a persistent runtime issue.
- Advance the hook-dispatch cursor across crossed authored frames even when those frames have no
  hooks, so later ticks do not reconsider already-crossed hookless frames.
- `SetOmega` remains continuous transform state, while hook execution still happens on the 30 FPS
  frame lattice.
- Keep `DynamicPlacementTracker`, renderer instance submission, and WebGL draw paths consuming
  already evaluated poses. Do not move tweening into renderer code.
- Add focused tests for midpoint origin interpolation, midpoint orientation interpolation, loop
  interpolation, and discrete hook dispatch stability.

Acceptance criteria:

- A dynamic animation sampled between two authored frames inside the authored range reports
  interpolated object/root and per-part poses instead of snapping to the floored frame pose.
- The loop seam does not interpolate from the final authored pose back to frame 0. Same-index parts
  are not guaranteed to form valid interpolation pairs across that boundary, so the player holds the
  final authored pose until the sampled frame wraps.
- Hooks do not fire every render tick. Hook dispatch follows crossed authored frames, catches up
  normal hitches in order, and does not skip intermediate hooks unless the bounded missed-hook window
  is exceeded.
- When the bounded missed-hook window is exceeded, only the most recent eight crossed authored
  frames are dispatched. The truncation is not stored in dynamic runtime records or snapshot DTOs.
- Hookless crossed frames still advance the last-dispatched frame cursor, preventing repeated
  reconsideration of the same authored frame range.
- `SetOmega` frame-0 loop behavior still does not reset accumulated rotation.
- Renderer/resource/placement APIs do not gain interpolation-specific state; they continue to
  consume evaluated poses and matrices.
- Full TypeScript verification passes.

Task checklist:

- [x] Add or reuse small placement interpolation helpers in the dynamic animation player boundary.
- [x] Update frame sampling to expose `nextFrameIndex` and `frameAlpha`.
- [x] Interpolate object position frames when present and well-formed, excluding the loop seam.
- [x] Interpolate matching per-part local placements across adjacent part frames, excluding the loop
      seam.
- [x] Replace sampled-frame-only hook dispatch with ordered crossed-frame dispatch.
- [x] Add bounded missed-hook catch-up with an initial eight-frame replay window and non-durable
      console/developer warning for truncation.
- [x] Advance the hook-dispatch cursor across hookless crossed frames.
- [x] Preserve existing unsupported-hook diagnostics for dispatched hook frames.
- [x] Add focused interpolation, crossed-frame hook dispatch, bounded truncation behavior, and
      hookless cursor advancement, and SetOmega loop stability tests. Do not add tests whose only
      assertion is debug-oriented logging.
- [x] Run full verification commands.

Decisions and course corrections:

- 2026-06-27: Added before Phase 9A because the animation player already recomputes poses every
  runtime tick. Smoothing pose evaluation here avoids renderer changes and keeps diagnostics/manual
  validation from baking in avoidable 30 FPS pose snapping.
- 2026-06-27: Hooks remain authored-frame events. Continuous sampling applies only to pose
  evaluation and existing `SetOmega` transform integration.
- 2026-06-27: Crossed-frame hook dispatch is now in scope because sampled-frame-only dispatch can
  already skip authored hooks during hitches, hidden-tab resumes, devtools pauses, or asset stalls.
  The first implementation should cap catch-up to the most recent eight authored frames instead of
  replaying unbounded sounds/scripts/particles after long gaps.
- 2026-06-27: Hook catch-up truncation should not become a durable dynamic issue or runtime snapshot
  field. If surfaced at all, it should use non-durable console/developer diagnostics because this is
  an operational warning, not state the browser or validation workflow should persist and inspect.
- 2026-06-27 dry run follow-up: Crossed-frame dispatch must advance its cursor through hookless
  frames too. Leaving cursor advancement conditional on hooks or issues preserves the current
  sampled-frame shortcut and can make later ticks reconsider old frame ranges.
- 2026-06-27: Implemented interpolation inside `DynamicAnimationPlayer` only. Placement tracking,
  renderer instance submission, and WebGL draw code continue to consume already evaluated poses.
- 2026-06-27: Crossed-frame hook dispatch now processes authored frames in order and integrates
  active `SetOmega` up to each hook's authored frame time before applying that hook, then integrates
  to the current runtime tick. This avoids applying a missed transform hook only after old omega has
  already been integrated across the whole hitch.
- 2026-06-27: Large hook catch-up is capped to the latest eight crossed authored frames. Truncation
  emits only a non-durable console/developer warning; no runtime issue, snapshot field, or durable
  diagnostics record was added.
- 2026-06-27 follow-up: Pose interpolation now holds the final authored frame across the loop seam
  instead of interpolating `last -> frame 0`. Windmill animation `0x0300061b` proves same-index part
  frames can be spatially discontinuous across the seam even though the visual cycle is continuous.
- 2026-06-27: Verification from `apps/holtburger-3d`: focused
  `npm run test:ts -- dynamic-animation-player.test.ts`, focused
  `npm run test:ts -- client-runtime.test.ts dynamic-placement-tracker.test.ts`, plus
  `npm run check`, `npm run lint:ts`, `npm run test:ts` (61 files / 499 tests),
  `npm run lint:dead`, and root `git diff --check` pass.

Debt and follow-up:

- The initial eight-frame catch-up window is a pragmatic first-cut policy. Revisit it once broader
  hook families land and real long-gap behavior can be compared against retail expectations.

### Phase 9A: Dynamic Diagnostics And Inspection Readiness

Status: completed on 2026-06-28.

Purpose:

- Make the dynamic runtime/render path reviewable before manual DAT validation without adding
  another broad itemized diagnostics surface. This phase should keep global diagnostics compact and
  use picker/selected-entity inspection for entity-level detail.

Deliverables:

- Reuse the existing runtime dynamic snapshot and renderer snapshot/report counters. Add a compact
  dynamic summary to `createDiagnosticsReport()` because the on-demand runtime report currently has
  no dynamic domain at all.
- Keep the dynamic report summary to compact operational counts derived from the existing dynamic
  runtime state: active, renderable, non-renderable, indexed/queryable, resource-pending, and
  resource-failed counts. Do not put `dynamic.records`, sampled entity lists, part poses, visual
  resource arrays, warning/error histories, unsupported-hook counts, or hook-specific global counters
  such as `SetOmega` counts in the global report.
- Surface entity-level detail through picker/selected-dynamic-entity inspection, not the global
  runtime report: classification reason, source residence, effective residence, setup id, animation
  id, current frame/time, part count, active transform effects, bounds, index membership, resource
  readiness, deterministic renderer resource/instance ids, and issues.
- Update plan/tests to match current browser behavior: dynamic hits are selectable in normal browser
  click picking. Treat this as browser inspection policy, not retail gameplay targeting parity.
- Add debug overlay support for dynamic bounds only if existing runtime/selection diagnostics are not
  enough to validate spatial/query membership. Do not add a decorative overlay just because this
  phase mentions bounds.
- Add targeted smoke coverage for the compact dynamic summary, selected dynamic entity inspection,
  and renderer diagnostics fields needed by Phase 9C.
- Record any remaining validation debt in this plan before moving to browser/manual checks.

Acceptance criteria:

- The on-demand runtime diagnostics report has a compact dynamic summary domain and does not include
  `DynamicRuntimeSnapshot.records`, per-part poses, typed array-backed visual resources, or sampled
  entity lists.
- Selected-entity diagnostics can explain why the windmill is dynamic and currently renderable.
- Selected-entity diagnostics can explain why the bird is dynamic, has an active transform effect
  from `SetOmega`, and is currently renderable.
- Diagnostics expose whether dynamic renderer resources, instances, and skipped submissions are
  nonzero/zero for the expected reasons. Draw-call counts remain renderer-local telemetry and are
  not part of the Phase 9 report-facing validation surface because commit timing can reset them
  before the next completed render pass.
- Dynamic entities are queryable and selectable through normal browser picking for inspection.
  Documentation must call out that this is browser tooling policy and does not prove retail gameplay
  targetability.
- Missing dynamic dependencies are visible through current operational resource/renderability state.
  Unsupported hooks remain console warnings, not durable diagnostics; the bird target's `SetOmega`
  hook is not warned as unsupported.
- Env-cell dynamic records use the Phase 8F cutover path and are diagnosable through the same dynamic
  report family as outdoor dynamic records.
- No runtime asset dependent tests are retained in the repo.

Task checklist:

- [x] Audit existing runtime dynamic snapshot, renderer snapshot, and browser selection diagnostics
      before adding any new report fields.
- [x] Add a compact dynamic diagnostics report domain derived from active dynamic records without
      embedding itemized records or visual/pose payloads.
- [x] Add selected dynamic entity inspection because browser selection currently supports dynamic
      picks but the Inspect button only opens static selection diagnostics.
- [x] Keep selected dynamic inspection on the runtime boundary, backed by entity id lookup, rather
      than teaching browser UI to spelunk `RuntimeSnapshot.dynamic.records`.
- [x] Confirm no new dynamic bounds debug overlay is needed because selected dynamic debug bounds
      already use current runtime bounds.
- [x] Add targeted tests for compact dynamic diagnostics, dynamic browser selection behavior,
      selected entity inspection, and renderer counters needed by manual validation.
- [x] Run full verification commands.

Decisions and course corrections:

- 2026-06-27 dry run: `RuntimeSnapshot.dynamic` already carries the lightweight dynamic entity
  summary DTO with source/effective residence, resources, playback, active omega, bounds, and
  diagnostics. Phase 9A should not introduce a heavier runtime snapshot shape; add a compact
  diagnostics-report domain or browser projection over the existing summary instead.
- 2026-06-27 dry run: Renderer counters for dynamic visual resources, texture uses, instances, draw
  calls, and skipped dynamic submissions are already in `RendererDiagnosticsSummary`. Phase 9A should
  wire those into validation/report expectations, not add a parallel renderer diagnostics path.
- 2026-06-27 dry run, superseded by implementation reality: earlier text expected dynamic hits to be
  excluded from `default-selection`, but the current merged query and browser picker select dynamic
  hits in normal browser click picking. Phase 9A should document and test that browser inspection
  policy instead of pretending it is retail gameplay targetability.
- 2026-06-27 dry run: A dynamic bounds overlay is optional. Existing snapshot/report data may be
  enough for Phase 9C; only add overlay primitives if manual validation cannot tell whether bad
  picking/rendering is caused by bounds/index membership versus renderer output.
- 2026-06-27: Phase 8F now precedes this diagnostics phase. Phase 9A should report env-cell and
  outdoor dynamic records through one dynamic diagnostics family instead of preserving the old
  env-cell renderer-gated special case.
- 2026-06-28: Tightened Phase 9A away from itemized report expansion. Global diagnostics should stay
  count-oriented and hook-generic; per-entity facts belong behind picker/selected-entity inspection.
  Do not add sampled entity lists, global `SetOmega` counts, or duplicated dynamic report objects
  when existing runtime and renderer snapshots already expose the needed state.
- 2026-06-28 dry run: `ClientRuntime.createDiagnosticsReport()` currently includes asset-service,
  renderer, static-coordinator, texture-atlas, and terrain-texture domains, but no dynamic domain.
  Add one compact dynamic summary domain; do not copy `RuntimeSnapshot.dynamic.records` into the
  report because records already include itemized playback state and can carry per-part pose data.
- 2026-06-28 dry run: `RuntimeSnapshot.dynamic` already exposes enough per-record information for
  implementation internals, but BrowserDisplay only enables the selected diagnostics modal for
  static selections. Phase 9A should add a selected dynamic diagnostics report path rather than a
  broad report dump.
- 2026-06-28 dry run, superseded by steering: Unsupported hook visibility exists as `console.warn`
  during dynamic animation resource validation. Do not add durable unsupported-hook report counts or
  selected-entity warning summaries; diagnostics should project current operational state, while
  warning/error histories stay in the console.
- 2026-06-28 dry run: Renderer per-entity residency is not directly queryable today; dynamic renderer
  resource and instance ids are deterministic from the entity id. Selected dynamic diagnostics should
  report those deterministic ids plus global renderer counters first. Add renderer-private
  per-entity lookup only if Phase 9C proves the counters and deterministic ids are insufficient.
- 2026-06-28 dry run: The selected dynamic debug overlay already works through
  `RuntimeSceneDebugSelection` and `queryDynamicCurrentBounds`, so a dynamic bounds overlay is not
  needed for 9A unless manual validation finds a bounds/query mismatch.
- 2026-06-28: Implemented `createDynamicDiagnosticsReport()` as a compact runtime report domain with
  active, renderable, non-renderable, indexed, resource-pending, resource-failed, and static-authored
  seed counts. The report deliberately does not include dynamic records, per-part poses, visual
  resource arrays, warning histories, unsupported-hook counts, or hook-family-specific counters.
- 2026-06-28: Added `ClientRuntime.createDynamicSelectionDiagnosticsReport(entityId)` and a narrow
  `DynamicEntityController.queryDynamicEntitySummary()` lookup so BrowserDisplay can inspect dynamic
  selections without reading `RuntimeSnapshot.dynamic.records` directly.
- 2026-06-28: BrowserDisplay now uses one selected-item Inspect action for static and dynamic picks.
  Dynamic selection reports include current operational entity state, debug bounds, deterministic
  dynamic renderer resource/instance ids, and global dynamic renderer counters.
- 2026-06-28: Renderer-private per-entity residency lookup was not added. Dynamic renderer
  resource/instance ids are deterministic from the entity id, and global renderer counters are enough
  for Phase 9C unless manual validation proves otherwise.
- 2026-06-28: No new dynamic bounds overlay was added. The existing selected dynamic debug overlay
  already uses current dynamic bounds through `RuntimeSceneDebugSelection`.
- 2026-06-28: Focused test coverage proves the compact dynamic report does not expose itemized
  records, that indexed count becomes nonzero after playback/placement tick, and that selected
  dynamic diagnostics avoid `partPoses` and `renderParts` payload dumps.
- 2026-06-28 follow-up: Removed `dynamicDrawCalls` from report-facing diagnostics after browser
  validation showed it can read as zero when dynamic instances are committed after the previous
  completed render pass. Renderer-local draw-call telemetry and Phase 8 renderer tests remain, but
  Phase 9 validation should use resource/instance/skipped-submission counters plus visible rendering.

Verification:

- 2026-06-28: `npm run test:ts -- client-runtime.test.ts`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run lint:ts`
- 2026-06-28: `npm run lint:dead`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run check:rust`
- 2026-06-28: `npm run lint:rust`
- 2026-06-28: `git diff --check`

Debt and follow-up:

- Dynamic transparent/additive render ordering remains a validation concern. Phase 9C should record
  whether the first-cut targets expose visible ordering problems; a later render-quality pass can
  share or generalize the static transparent sort machinery if needed.
- Selected dynamic diagnostics report deterministic renderer ids and global renderer dynamic
  counters, not renderer-owned per-entity residency. Add renderer-private lookup only if Phase 9C
  cannot validate a real failure without it.
- Report-facing diagnostics intentionally omit dynamic draw-call counts until renderer telemetry can
  distinguish last completed frame draw calls from post-commit reset state.

### Phase 9B: Distance-Based Dynamic Animation Update Cadence

Status: completed on 2026-06-28.

Purpose:

- Reduce dynamic animation, bounds, and index update cost for distant animated dynamic entities while
  preserving accurate near-field motion.

Deliverables:

- Add app/runtime-local update cadence policy for animated dynamic entities:
  - Within `64m` of the active camera: update every frame.
  - Within `128m` of the active camera: update at `10Hz`.
  - Beyond `128m`: update at `1Hz`.
- Base distance checks on render-space distance from the active camera to the entity's current bounds
  center when current bounds exist. Fall back to the entity base placement translated into render
  space when no current bounds exist yet.
- Apply the policy to all animated dynamic entities, not only static-authored dynamic scenery. The
  current implementation may only have static-authored dynamic records, but the policy and APIs must
  not encode that limitation.
- Keep the policy in browser/app runtime orchestration. Do not put camera-distance presentation
  cadence into shared entity truth, content data, protocol state, or renderer-owned animation.
- Avoid renderer-side hidden animation. Renderer submissions should still consume the latest dynamic
  runtime pose/bounds state.
- Do not add a debug/full-fidelity toggle or selected-entity cadence override in this phase.
  Selection/inspection reads the last evaluated dynamic state at the entity's distance-based cadence.
- Keep source residence, effective residence, bounds/index membership, and renderer submissions
  consistent with the latest evaluated pose even when cadence throttles updates.

Acceptance criteria:

- Entities within `64m` update animation playback, current bounds, index membership, and renderer
  instance submissions every frame.
- Entities between `64m` and `128m` update no faster than `10Hz`.
- Entities beyond `128m` update no faster than `1Hz`.
- Selecting or inspecting a dynamic entity does not alter update cadence. Selected diagnostics may
  show last evaluated state, including distance-throttled stale state.
- The policy applies through dynamic runtime/controller entry points that can support future live
  animated entities, not through static-authored seed special cases.
- Query/picking behavior remains coherent: stale far bounds are an explicit presentation tradeoff,
  and selected diagnostics/debug bounds report the same last evaluated state used by renderer/query.
- Renderer resources and instances are not recreated just because cadence changes; only pose/bounds
  updates are throttled.
- If there is no current camera frame state, dynamic updates continue every frame rather than
  stalling startup/resource readiness.

Task checklist:

- [x] Add a pure dynamic animation update cadence policy helper and tests for the `64m`, `128m`,
      `10Hz`, and `1Hz` thresholds.
- [x] Add render-space distance helpers for outdoor and env-cell dynamic records, using current
      bounds center first and translated base placement as fallback.
- [x] Feed active camera position/render-anchor context into dynamic update scheduling from
      `ClientRuntimeImpl.tickFrame()`.
- [x] Extend `DynamicEntityController.tick()` with scheduling input so animation playback,
      placement/bounds/index updates, and dynamic renderer instance commits only run for due records.
- [x] Prove selected dynamic inspection does not alter cadence and reports last evaluated state.
- [x] Prove the policy does not depend on static-authored provenance.
- [x] Prove skipped far updates preserve existing render/query state rather than clearing resources,
      bounds, or index membership.
- [x] Prove startup/no-camera-frame behavior still updates every dynamic entity.
- [x] Run full verification commands.

Decisions and course corrections:

- 2026-06-28: Added as an immediate phase before first-cut browser validation after the first
  dynamic diagnostics pass showed dozens of active animated dynamics in one scene. Performance policy
  should land before manual validation so validation observes the intended update behavior.
- 2026-06-28: This is presentation/update scheduling, not world truth. The dynamic runtime remains
  capable of exact animation and bounds updates; browser/app runtime decides how often to evaluate
  each animated entity based on camera distance.
- 2026-06-28: No debug/full-fidelity toggle and no selected-entity cadence override. Selection is a
  read/inspection concern, not scheduler control.
- 2026-06-28 dry run: `DynamicEntityController.tick()` currently updates every record as one batch.
  The cadence policy should be passed into the controller as scheduling input and applied before
  `DynamicAnimationPlayer.update()` and `DynamicPlacementTracker.update()`. Filtering only renderer
  instance commits would leave animation and spatial indexes updating every frame, which misses the
  goal.
- 2026-06-28 dry run: Camera positions are render-space, while outdoor dynamic bounds are
  source-landblock-local. Scheduling distance must translate outdoor records through the current
  render anchor before comparison. Env-cell dynamic bounds are already landblock render-local for the
  interior context.
- 2026-06-28 dry run: Throttling animation evaluation also throttles `SetOmega` integration and
  current-frame bounds. That is acceptable for far presentation. Selected diagnostics and debug
  bounds intentionally report the last evaluated state rather than forcing a refresh.
- 2026-06-28 dry run: Add a pure scheduler helper first. The runtime fixtures are heavy, and cadence
  threshold math should be tested without needing static resolver/baker setup.
- 2026-06-28: Added `dynamic-animation-update-cadence.ts` as a pure app/runtime policy helper. It
  maps `<=64m` to every-frame evaluation, `>64m && <=128m` to `10Hz`, and `>128m` to `1Hz`.
- 2026-06-28: Distance resolution uses current dynamic bounds center first. Outdoor bounds and
  outdoor base-placement fallbacks are translated from source-landblock-local space through the
  current render anchor before comparing to the render-space camera. Env-cell records use their
  landblock render-local positions directly.
- 2026-06-28: `DynamicEntityController.tick()` now accepts optional animation cadence context and
  owns a small `lastAnimationUpdateAtSecondsByEntityId` scheduler map. This is runtime scheduling
  state, not diagnostics state; it is cleared when records are retained out or the controller is
  disposed.
- 2026-06-28: `ClientRuntimeImpl.tickFrame()` passes the active camera position and render anchor
  into the dynamic controller when a frame state exists. With no camera frame state, cadence context
  is `null` and dynamic entities continue evaluating every frame so startup/resource readiness does
  not stall.
- 2026-06-28: Renderer instance commits are now tied to dynamic evaluation changes. Skipped cadence
  frames leave existing renderer instances resident with their last evaluated transforms instead of
  clearing/recreating instances. Dynamic resource residency sync remains separate.
- 2026-06-28: No selected-entity override or debug/full-fidelity path was added. Selected dynamic
  inspection and debug bounds continue to read the same last evaluated state used by renderer/query.
- 2026-06-28: `lint:dead` initially caught exported threshold constants that were only used
  internally. The tests now assert against the exported policy constants directly so the public
  threshold names remain reviewable without dead exports.

Verification:

- 2026-06-28: `npm run test:ts -- dynamic-animation-update-cadence.test.ts
dynamic-entity-controller.test.ts client-runtime.test.ts`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run lint:ts`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run lint:dead`
- 2026-06-28: `git diff --check`

Debt and follow-up:

- The first scheduler should use current bounds center when available and base placement as fallback.
  If this proves too conservative for large animated entities, add a later focused pass that uses
  better bounds-distance estimates without changing the cadence policy.
- Future live players/creatures may need stricter near-field or gameplay-owned policies. Do not
  reuse the ambient dynamic scenery cadence blindly for authoritative gameplay entities without a
  separate review.
- Phase 9B did not add renderer telemetry for skipped cadence evaluations. If browser validation
  needs to distinguish "stale by cadence" from "not ticking because broken", add a compact runtime
  projection from scheduler state rather than durable diagnostic bookkeeping in the pipeline.

### Phase 9C: First-Cut Target Browser Validation

Status: completed on 2026-06-28.

Purpose:

- Prove with real browser/DAT scene data that `0x020003e5` and `0x020005ac` are dynamic, animated,
  indexed, rendered, and diagnosable for the right reasons.

Deliverables:

- Validate outdoor static-authored setup `0x020003e5` with animation `0x0300061b` in browser mode.
- Validate outdoor static-authored setup `0x020005ac` with animation `0x03000751` and typed frame-0
  `SetOmega` in browser mode.
- Confirm dynamic query/debug inspection can find first-cut dynamic records while default browser
  picking can select them for inspection.
- Compare dynamic runtime diagnostics, renderer resource/instance/skipped-submission counters, and
  visible motion against the
  requirements-plan evidence.
- Record evidence, concessions, failures, and any render-quality debt in this plan.

Acceptance criteria:

- The windmill target renders through dynamic renderer resources/instances, not static baked draw
  units, and visibly animates from per-part origin/orientation frames.
- The bird target renders through the same dynamic renderer path, visibly animates wing frames, and
  shows continuous object/root motion from active `SetOmega`.
- Runtime diagnostics identify the expected setup ids, animation ids, current animation frame/time,
  source/effective residence, renderability, renderer resource/instance/skipped-submission counts,
  and dynamic query membership.
- The bird target's `SetOmega` hook is supported and does not appear in unsupported-hook diagnostics.
- First-cut dynamic targets can be selected by browser picking for inspection. Retail/gameplay
  targeting semantics remain a separate caller policy.
- Any dynamic transparent/additive ordering issue is captured as concrete evidence rather than vague
  render debt.
- No temporary DAT-dependent tests or one-off validation scripts are retained unless the plan records
  why they are durable.

Task checklist:

- [x] Run the browser app against real DAT/static scene data at coordinates containing both targets.
- [x] Inspect runtime/browser diagnostics for the windmill target.
- [x] Inspect runtime/browser diagnostics for the bird target and active `SetOmega`.
- [x] Verify browser selection finds dynamic targets for inspection while any future
      retail/gameplay targeting filter remains explicit and separate.
- [x] Record validation evidence and visual concessions in this plan.
- [x] Run full verification commands after any validation fixes. Not applicable for the manual
      validation close; Phase 9B verification was already clean and no validation fixes were made.

Decisions and course corrections:

- 2026-06-27 dry run: This phase should run after Phase 9A lands the compact dynamic report summary
  and selected dynamic entity inspection. Manual validation without those small inspection surfaces
  would require too much raw snapshot spelunking and would be too easy to misread.
- 2026-06-27 dry run, superseded: The validation target was previously outdoor-only while env-cell
  dynamic render membership was gated by a temporary render-path-pending diagnostic.
- 2026-06-27: Phase 8F now owns env-cell dynamic cutover before manual target validation. Phase 9C
  still validates the two known first-cut outdoor targets, while env-cell dynamic correctness should
  already be proven by Phase 8F tests and surfaced in Phase 9A diagnostics.
- 2026-06-27 dry run: If either first-cut target is invisible, check diagnostics in this order:
  classification seed emitted, dynamic resource readiness, renderability reasons, renderer resource
  commit, renderer instance commit, skipped submissions, then query/debug hit. Treat draw-call counts
  as renderer-local telemetry until their completed-frame semantics are tightened.
- 2026-06-28: Manual browser validation passed for the first-cut targets. The windmill and bird
  dynamic paths look visually correct in real browser/DAT scene data, including dynamic rendering,
  visible animation, browser selection/inspection, and the bird's active `SetOmega` motion.
- 2026-06-28: Phase 9B cadence behavior did not require a selected-entity override,
  debug/full-fidelity mode, or cadence telemetry to validate the targets. Selected diagnostics remain
  accepted as last-evaluated state, not a fresh-state request.
- 2026-06-28: No validation fixes were needed from this phase. The next phase should resteer before
  expanding hook support or broadening the dynamic entity target set.

Debt and follow-up:

- Phase 9C is not the env-cell cutover gate anymore. If env-cell dynamic behavior is still
  renderer-gated by this point, Phase 8F failed and should be completed before browser validation is
  treated as meaningful.
- Keep `dynamicDrawCalls` out of report-facing validation until renderer telemetry can distinguish
  completed-frame draw counts from post-commit reset state.
- If later scenes expose distance-cadence stepping, delayed first appearance, or stale far-selection
  bounds as visible UX problems, handle that as a focused render/update quality pass rather than
  adding diagnostics-driven refresh paths.

### Phase 10: Resteer For Broader Hook And Dynamic-System Gate

Status: completed on 2026-06-28.

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

- [x] Review implementation diff and diagnostics.
- [x] Compare both first-cut targets against requirements evidence.
- [x] Review whether `SetOmega` transform state, bounds, query, and rendering created reusable hook
      handler structure.
- [x] Update future phases before proceeding.

Decisions and course corrections:

- 2026-06-28: Local architecture review found the first-cut dynamic runtime held its main ownership
  boundaries. Dynamic entity state owns playback, transform effects, current bounds, and resource
  readiness; renderer state owns visual-resource residency and submitted instances; browser
  selection/inspection remains a projection over runtime state.
- 2026-06-28: `SetOmega` created a useful transform-hook path. The system is not intentionally
  `SetOmega`-shaped; `SetOmega` is simply the only supported non-no-op hook so far. The hook cursor,
  crossed-frame dispatch, active transform state, bounds consumption, and renderer matrix
  composition are reusable for object/root transform effects. Non-transform effects such as
  particles, sounds, scripts, material transitions, texture velocity, and replacement visuals still
  need evidence and a separate lifecycle/subsystem design before implementation.
- 2026-06-28: Unsupported hooks are currently console-owned during dynamic animation resource
  validation and do not create durable runtime diagnostics. Keep that boundary; do not add
  unsupported-hook counts or warning histories to support the next hook family.
- 2026-06-28: The merged query path works for first-cut dynamic selection. Phase 11B removed
  caller-intent `ScenePickMode` names and now uses explicit dynamic pick policy for default
  selectability.
- 2026-06-28: `DynamicRuntimeSnapshot.records` and `DynamicEntitySummaryDto` are doing double duty
  as renderer/runtime submission state and selected-inspection input. This is acceptable for the
  first cut because selected diagnostics project compactly from the DTO, but cleanup should split
  operational render/runtime DTOs from inspection views before diagnostics become a primary DTO
  consumer.
- 2026-06-28: Dynamic material extraction reuses the static material planner, material-table adapter,
  texture sampling policy, and WebGL static-material shader path. That is the correct behavior
  reuse, but static-only names now describe shared static/dynamic machinery poorly. Prefer cleanup
  renaming/generalization over introducing duplicate dynamic material logic.
- 2026-06-28: Bounds and cadence behavior are accepted for first-cut browser validation. The known
  tradeoff remains stale far animated bounds and renderer transforms by distance cadence; this is a
  presentation-quality follow-up only if later browser scenes make it visible.
- 2026-06-28: Resteer recommendation: run Phase 11 cleanup before adding another broad hook/effect
  family unless a concrete live-entity target preempts it. No fundamentally bad architecture smell
  was found in the first-cut path, but temporary naming/DTO/query seams should be trimmed before they
  harden into future expansion points. Do not start a texture-velocity, particles, sound, material
  transition, replacement-visual, or script-chaining phase without a concrete target/evidence pass.
- 2026-06-28: Most unimplemented hook/effect families are likely to appear on server-spawned/live
  entities or script-driven behavior rather than the first static-authored scenery targets. Before
  choosing another hook family, run an evidence pass over landblocks/assets for better candidates.
  The marker-like objects tracked in
  [docs/plans/holtburger-3d-frontend-v2-implementation-plan.md](holtburger-3d-frontend-v2-implementation-plan.md)
  may be useful candidates to revisit, but they remain an evidence problem first, not a hidden
  dynamic classification shortcut.
- 2026-06-28: Scenery distance cadence buckets are accepted as the universal dynamic update policy
  for now. Future live player/creature work can reuse the policy initially unless gameplay evidence
  proves it needs stricter ownership.

Remaining decisions for user/agent discussion:

- Whether Phase 11 cleanup is the immediate next work item, or whether a concrete live-entity target
  preempts cleanup.
- Which evidence pass should identify the next hook/effect candidate: DAT landblock scanning,
  marker-family validation, server-spawned entity capture, or a narrower ACE/ACViewer/reference
  audit.

### Phase 10B: Static/Dynamic Pipeline Shape Convergence Audit

Status: completed on 2026-06-28.

Purpose:

- Identify where static and dynamic visual/material/renderer paths should share neutral codepaths or
  DTO shapes before cleanup becomes cosmetic renaming.

Scope:

- In scope: compare static visual resources, dynamic render parts, renderer visual resources,
  material planning, texture-use commits, geometry flattening, and WebGL upload/draw resource shapes.
- Out of scope: collapsing static layer/materialization ownership into dynamic entity ownership, or
  making dynamic resources depend on static batch lifetime.

Initial findings:

- `StaticObjectVisualResource`, `DynamicEntityRenderPart`, and `DynamicRendererVisualPart` carry
  nearly isomorphic geometry/material payloads: positions, texcoords, indices, material slot
  indices, material entries, material family/pass, render state, texture-use ids, bounds, and
  triangle/vertex counts.
- `createStaticObjectVisualGeometryResource()` and `createDynamicVisualGeometryResource()` in the
  WebGL2 renderer are near copy-paste upload paths with different owner/id fields and error text.
- Dynamic render-part slicing in `dynamic-entity-resource-manager.ts` and static visual-resource
  geometry baking in `static-object-compatibility-baker.ts` both flatten source gfx positions/UVs
  into indexed renderer geometry with material-slot attributes. Static has additional partition,
  cutover, source-mapping, and transparent-policy concerns that should not leak into dynamic
  extraction.
- Dynamic already reuses the static material planner, material-table adapter, texture sampling
  policy, and WebGL static-material shader path. The convergence problem is mostly neutral shape and
  helper ownership, not a need for duplicate dynamic material logic.

Acceptance criteria:

- The plan records a concrete `share now / rename now / keep separate / defer` map before Phase 11
  edits code.
- Shared candidates preserve ownership boundaries: static draw units/resources remain
  layer/materialization-owned; dynamic visual resources remain entity/resource-owned.
- Any proposed shared helper has a neutral name and a caller-supplied owner/id policy rather than
  static-specific lifetime assumptions.

Task checklist:

- [x] Audit static and dynamic geometry/material DTO fields and identify a neutral visual-geometry
      payload shape, if one is justified.
- [x] Audit WebGL2 static/dynamic visual geometry upload paths and decide whether to extract a shared
      upload helper before broader renaming.
- [x] Audit static and dynamic source-triangle flattening helpers and decide what can be shared
      without importing static partition/cutover policy into dynamic resources.
- [x] Audit texture-use commit creation and atlas owner flow for neutral helper opportunities.
- [x] Update Phase 11 cleanup targets based on the convergence map.

Decisions and course corrections:

- 2026-06-28 dry run: Share now: introduce a neutral visual geometry payload shape for the common
  buffer/material fields shared by `StaticObjectVisualResource`, `DynamicEntityRenderPart`, and
  `DynamicRendererVisualPart`: bounds, positions, texcoords, material slot indices, indices,
  index type, material entries, material family/pass, render state, texture-use ids, triangle count,
  and vertex count. Keep owner/id/source metadata outside that shared payload.
- 2026-06-28 dry run: Share now: extract a WebGL2 helper that uploads a neutral visual geometry
  payload into GPU buffers/VAO and returns the common GPU resource fields. Static visual resources
  and dynamic visual parts can then wrap those fields with their distinct owner ids, domain/part
  metadata, prepared payload state, and disposal hooks. This is the clearest code-dedupe win.
- 2026-06-28 dry run: Share now, narrowly: add or reuse neutral byte/count helpers for visual
  geometry buffer payloads. Static and dynamic currently compute uploaded/typed-array bytes through
  parallel field sums.
- 2026-06-28 dry run: Rename now: WebGL `StaticMaterialGeometryResource`,
  `createStaticObjectPreparedDrawPayloadState`, `uploadStaticObjectRolePageBindings`, and related
  static-object shader helper names now describe shared static/dynamic object-material drawing.
  Rename/generalize in cleanup only after the neutral upload helper exists, so renaming follows a
  real shared abstraction.
- 2026-06-28 dry run: Keep separate: static draw units, static visual resources, dynamic visual
  resources, and dynamic renderer instances need distinct ownership and lifetime types. Static
  resources are layer/materialization-owned; dynamic resources are entity/resource-owned. Do not
  merge commit APIs or let dynamic resources borrow static batch ownership.
- 2026-06-28 dry run: Keep separate: static partition/cutover/source-mapping/transparent retention
  policy must stay in the static bake path. Dynamic render-part extraction should not import static
  partition semantics just to share a geometry builder.
- 2026-06-28 dry run: Defer: a low-level source-triangle flattening helper may be worthwhile, but it
  is less obvious than the renderer upload helper. Static sorts and resolves triangles through
  partition/source-index records; dynamic slices by material compatibility over one source part.
  Revisit after the neutral visual geometry payload exists and the duplication is easier to see.
- 2026-06-28 dry run: Defer: texture-use commit helpers can probably share a small owner/batch
  adapter later, but static `StaticBakeTextureUse` creation and dynamic `DynamicTextureUseCommit`
  creation currently differ in batch timing and owner delta semantics. Keep the texture ownership
  split until the visual geometry convergence is complete.
- 2026-06-28 dry run: Phase 11 should start with the neutral visual geometry payload and WebGL2
  upload-helper extraction, then proceed to naming cleanup. That makes cleanup structural rather than
  cosmetic.

### Phase 11A: Static/Dynamic Visual Geometry Convergence

Status: completed.

Purpose:

- Convert the static/dynamic visual geometry overlap found in Phase 10B into a small shared
  renderer/material substrate before broader cleanup renames the surrounding code.

Deliverables:

- Introduce a neutral visual geometry payload shape for shared buffer/material fields:
  bounds, positions, texcoords, material slot indices, indices, index type, material entries,
  material family/pass, render state, texture-use ids, triangle count, and vertex count.
- Adapt `StaticObjectVisualResource`, `DynamicEntityRenderPart`, and `DynamicRendererVisualPart` to
  use or project through that neutral payload while keeping their owner/id/source metadata separate.
- Extract a WebGL2 visual geometry upload helper that accepts the neutral payload and returns common
  GPU resource fields plus disposal behavior.
- Keep static and dynamic commit/lifetime APIs separate: static layer/materialization ownership stays
  static-owned; dynamic visual-resource ownership stays entity/resource-owned.
- Add or reuse neutral byte/count helpers for visual geometry buffers.
- Apply only the naming cleanup directly unlocked by the shared payload/upload helper. Leave broader
  query/DTO/diagnostics cleanup for Phase 11B.

Acceptance criteria:

- Static visual resources and dynamic visual parts share one neutral geometry/material payload shape
  or a clearly documented projection to one.
- WebGL2 static visual-resource upload and dynamic visual-part upload no longer duplicate buffer/VAO
  creation logic.
- Static/dynamic ownership boundaries remain explicit in types and renderer commits.
- Static object visual-resource tests, dynamic renderer/resource tests, and full TypeScript checks
  pass.

Task checklist:

- [x] Add the neutral visual geometry payload type in an app-local renderer/static/dynamic-neutral
      home.
- [x] Convert or project static visual resources and dynamic render parts through the neutral payload.
- [x] Extract the shared WebGL2 visual geometry upload helper.
- [x] Replace static/dynamic visual upload call sites with wrappers around the shared helper.
- [x] Add or update focused tests for static visual uploads, dynamic visual uploads, and byte/count
      accounting.
- [x] Run focused and full verification commands.

Decisions and course corrections:

- 2026-06-28 implementation: Added
  `apps/holtburger-3d/src/lib/visual/visual-geometry.ts` as the neutral payload home. The public
  surface is intentionally only `VisualGeometryPayload` plus byte accounting; helper aliases remain
  module-private so static/dynamic ownership shapes do not grow a second exported contract family.
- 2026-06-28 implementation: `StaticObjectVisualResource`, `DynamicEntityRenderPart`, and
  `DynamicRendererVisualPart` now extend the neutral payload while retaining their owner/id/source
  metadata separately. This preserves static layer/materialization ownership and dynamic
  entity/resource ownership.
- 2026-06-28 implementation: `createStaticObjectVisualGeometryResource()` and
  `createDynamicVisualGeometryResource()` now wrap a shared `createUploadedVisualGeometryResource()`
  helper for VAO/buffer creation, attribute binding, index type conversion, disposal, and uploaded
  byte accounting.
- 2026-06-28 implementation: Avoided a type-level static/visual import cycle by keeping the neutral
  visual geometry structural aliases local to the visual module rather than importing static
  contract helper types back into the neutral home.
- 2026-06-28 implementation: Full TypeScript tests exposed brittle Phase 9B test timing that had
  hard-coded cadence assumptions. The test was changed to derive skipped/allowed ticks from the
  runtime cadence constants so manual tuning does not require test magic-number edits.

Debt and follow-up:

- Low-level source-triangle flattening remains deferred until the neutral payload exists and the
  remaining duplication is easier to isolate.
- Texture-use commit helper convergence remains deferred because static and dynamic differ in batch
  timing and owner delta semantics.
- Static-object shader/payload helper names remain broader cleanup work for Phase 11B; Phase 11A
  only extracted the shared upload primitive and did not rename the surrounding material pipeline.

### Phase 11B: Cleanup And Cutover Hardening

Status: completed.

Purpose:

- Remove remaining transitional naming, wrappers, hollow tests, and diagnostics/reporting debt after
  structural static/dynamic visual convergence is complete.

Cleanup targets:

- Temporary `pickStaticRay` compatibility wrappers after merged query migration. Completed in
  Phase 11B.
- Remaining static-only visual-resource/material helper names that serve dynamic rendering too after
  Phase 11A. Carried forward to Phase 11C.
- `prepareV2StaticAssetPayload` if Phase 1 leaves that name in place after adding animation assets.
  Completed in Phase 11B by renaming the route parser to `prepareV2AssetPayload`.
- Redundant dynamic/static material interpretation helpers.
- Diagnostics fields that were useful during bring-up but are hollow or misleading.
- `ScenePickMode` caller-intent names such as `debug-inspection` or `diagnostics` if they start
  driving query behavior. Prefer explicit query inclusion/filter policy over routing behavior by
  diagnostic/debug caller names. Completed in Phase 11B by replacing modes with explicit dynamic
  pick policy.
- `DynamicRuntimeSnapshot.records`/`DynamicEntitySummaryDto` shape if it keeps accumulating fields
  for selected inspection. Split renderer/runtime operational state from selected inspection
  projections before diagnostics become the primary DTO consumer.
- Historical plan language that still suggests durable unsupported-hook counts, warning/error
  histories, or diagnostics-owned bookkeeping. Keep diagnostics as projections over operational
  state; console warnings remain console-owned.
- Any tests that only assert removed behavior or debug-only logging.

Acceptance criteria:

- No dead transitional wrappers remain unless this plan records a concrete reason and owner.
- Shared helpers have honest names and ownership.
- Diagnostics and inspection APIs remain projections over runtime/renderer state rather than owning
  bookkeeping that the animation, query, or renderer pipelines must preserve.
- Lint/dead-code checks pass or existing unrelated findings are documented.
- The implementation plan is updated with completed decisions and remaining full-system gates.

Task checklist:

- [x] Remove temporary wrappers and stale names.
- [x] Replace caller-intent scene-query modes with explicit inclusion/filter policy if still
      warranted after Phase 11A.
- [x] Audit dynamic runtime/renderer/inspection DTO split pressure.
- [x] Scrub stale plan/docs wording that suggests durable diagnostics-owned warning/error state.
- [x] Delete hollow or legacy-path tests.
- [x] Re-run full verification commands.
- [x] Update this plan with final first-cut status.

Decisions and course corrections:

- 2026-06-28 implementation: Removed the public `ClientRuntime.pickStaticRay` compatibility wrapper
  and its legacy-path test. Browser/runtime picking now uses `pickSceneRay`; merged query internals
  still call a narrowly named `pickStaticSceneRay` source adapter for static-hit composition.
- 2026-06-28 implementation: Replaced `ScenePickMode` caller-intent strings with explicit dynamic
  pick policy: callers opt dynamic hits into normal browser selectability with
  `dynamic: { defaultSelectable: true }`. Diagnostics/inspection behavior no longer routes through
  `debug-inspection` or `diagnostics` mode names.
- 2026-06-28 implementation: Renamed `prepareV2StaticAssetPayload` to `prepareV2AssetPayload`
  because the route parser now covers animation and other non-static asset payloads.
- 2026-06-28 implementation: Did not split `DynamicRuntimeSnapshot.records` or
  `DynamicEntitySummaryDto`. The current selected-entity diagnostics remain a compact projection and
  are not adding new required fields in this phase, so forcing a DTO split now would be churn.
- 2026-06-28 implementation: Did not rename the WebGL static-object prepared payload/shader helper
  family. Those helpers now serve dynamic drawing too, but the rename crosses shader payload tests,
  renderer resource interfaces, and texture binding invalidation. Keep that as tracked renderer
  naming debt rather than burying a wide mechanical rename in cleanup.

Debt and follow-up:

- WebGL object-material prepared payload, role-page, and render-state names still say
  `StaticObject*` even though dynamic visual parts use the same shader/material path. Rename in
  Phase 11C.
- Dynamic runtime summary DTOs can stay as-is for the first cut. Split operational render/runtime
  DTOs from selected inspection views only if inspection starts driving additional fields.

### Phase 11C: WebGL Object Material Naming And Role-Page Cutover

Status: completed on 2026-06-28.

Purpose:

- Rename the shared WebGL object-material shader, prepared-payload, role-page, and render-state
  substrate so it no longer presents dynamic rendering as a static-object special case.

Scope:

In scope:

- Shared WebGL object-material payload preparation used by static object draw units, static visual
  resources, structured interiors, and dynamic visual resources.
- Shared role-page slot allocation for non-terrain object-style material textures, including dynamic
  `TextureBindingOwner` values.
- Shared object-material render-state helpers, blend-factor helpers, transparent draw sort helpers,
  and prepared-payload dirtying helpers where they already accept dynamic visual resources.
- Tests whose names and assertions encode the old static-only role-page and payload terminology.

Out of scope:

- Static-authored source facts, static bake/materialization ownership, static layer payloads,
  `StaticObjectRenderInstance`, `StaticObjectVisualResource`, static scene-query records, and static
  diagnostics that genuinely describe static-layer work.
- Terrain role-page naming. Terrain remains a separate shader/role-page family.
- Dynamic entity resource ownership, renderer dynamic commit APIs, or new material behavior.
- Texture velocity, material transitions, lighting, particle, sound, or replacement-object hook
  behavior. This phase is naming and boundary hardening only.

Survey findings:

- [apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-static-object-payloads.ts](../../apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-static-object-payloads.ts)
  is now a shared object-material payload builder, not a static-object-only helper. It prepares
  material uniforms and role-page bindings consumed by static object draw units, static visual
  resources, structured interiors, and dynamic visual resources.
- The exported payload symbols are misleading and should be renamed together:
  `StaticObjectMaterialPayloadResource`, `StaticObjectPreparedDrawPayload`,
  `StaticObjectPreparedRolePageBindings`, `StaticObjectPreparedMaterialUniforms`,
  `StaticObjectPreparedDrawPayloadState`, `createStaticObjectPreparedDrawPayloadState`,
  `markStaticObjectPreparedDrawPayloadDirty`, `prepareStaticObjectDrawPayloadState`,
  `createStaticObjectPreparedDrawPayload`, and `prepareStaticObjectDrawPayload`.
- The private helpers in the same file are also shared and should follow the same rename:
  `createStaticObjectRolePageScratch`, `createStaticObjectMaterialUniformScratch`,
  `resetStaticObjectRolePageBindings`, `resetStaticObjectRolePage`,
  `resetStaticObjectMaterialUniforms`, `fillStaticObjectRolePageBindings`,
  `collectStaticObjectPageBinding`, `fillStaticObjectMaterialUniforms`,
  `resolveStaticObjectMaterialEntryMode`, and `writeStaticObjectTextureEntry`.
- The `MAX_STATIC_OBJECT_*_PAGES_PER_DRAW` and `MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW`
  constants in [apps/holtburger-3d/src/lib/renderer/types.ts](../../apps/holtburger-3d/src/lib/renderer/types.ts)
  are object-material shader limits, not static-layer limits. Rename them to an object-material
  vocabulary unless implementation finds a public compatibility cost that is not worth paying.
- `TextureRolePageKind` currently uses `"static-base-color"`, `"static-detail"`, `"static-index"`,
  and `"static-palette"` for role pages also assigned to dynamic visual-resource owners. Rename
  these values to object-material role names such as `"object-base-color"`, `"object-detail"`,
  `"object-index"`, and `"object-palette"` in one decisive cutover.
- `StaticObjectTextureRolePageKind`, `StaticObjectRolePageOverflowDiagnostics`, the
  `staticObjectRolePageOverflows` texture-manager field, `StaticObjectOwnerRolePageSlots`,
  `StaticObjectRolePageSlotInput`, `createStaticObjectTextureRolePageKind`, and
  `getMaxStaticObjectRolePageSlots` should become object-material role-page names. The warning kind
  `"static-object-role-page-overflow"` should be renamed to an object-material warning kind unless a
  caller relies on the old report string.
- [apps/holtburger-3d/src/lib/runtime/static-materializer.ts](../../apps/holtburger-3d/src/lib/runtime/static-materializer.ts)
  has local role-page typing and mapping for the same `"static-..."` values. Update it with the
  renderer role-page rename rather than leaving a compatibility translation layer.
- [apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts](../../apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts)
  still uses shared dynamic/static material names such as `StaticObjectGeometryProgram`,
  `StaticMaterialGeometryResource`, `createStaticTextureBindingOwnerForResource`,
  `uploadStaticObjectRolePageBindings`, `uploadStaticObjectMaterialTableUniforms`,
  `#getStaticObjectPreparedPayload`, `#markAllStaticObjectPreparedPayloadsDirty`,
  `resolveStaticObjectBlendFactor`, `applyStaticObjectRenderState`, and
  `restoreStaticObjectRenderState`. These are shared object-material paths and should be renamed.
- Transparent draw sorting still uses static-object naming and data structures. This is partly
  accurate for static layer draw lists, but helper names such as
  `StaticObjectTransparentDrawSortEntry`, `compareStaticObjectTransparentDrawEntries`,
  `isTransparentStaticObjectResource`, and render-state/blend helpers should be audited while
  renaming the material path. Rename only the portions that accept `DynamicVisualGeometryResource`
  or `StructuredInteriorGeometryResource`; keep static draw-list ownership names where the list is
  still static-layer-specific.
- Renderer diagnostics such as `staticObjectResources`, `recentStaticObjectUploads`, and
  `outdoorDetailStaticObjectBakedDirectDrawCallsByPass` remain static diagnostics and should not be
  renamed in this phase. They describe static-layer work, not the shared shader substrate.
- Tests to update include
  [apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-static-object-payloads.test.ts](../../apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-static-object-payloads.test.ts),
  [apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.test.ts](../../apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.test.ts),
  [apps/holtburger-3d/src/lib/textures/texture-manager.test.ts](../../apps/holtburger-3d/src/lib/textures/texture-manager.test.ts),
  and [apps/holtburger-3d/src/lib/runtime/static-materializer.test.ts](../../apps/holtburger-3d/src/lib/runtime/static-materializer.test.ts).

Suggested naming direction:

- File rename: `webgl2-static-object-payloads.ts` to `webgl2-object-material-payloads.ts`.
- Test rename: `webgl2-static-object-payloads.test.ts` to
  `webgl2-object-material-payloads.test.ts`.
- Public payload/resource vocabulary: `ObjectMaterialPayloadResource`,
  `ObjectMaterialPreparedDrawPayload`, `ObjectMaterialRolePageBindings`,
  `ObjectMaterialPreparedUniforms`, `ObjectMaterialPreparedDrawPayloadState`,
  `createObjectMaterialPreparedDrawPayloadState`, `markObjectMaterialPreparedDrawPayloadDirty`,
  `prepareObjectMaterialDrawPayloadState`, `createObjectMaterialPreparedDrawPayload`, and
  `prepareObjectMaterialDrawPayload`.
- Renderer vocabulary: `ObjectMaterialGeometryProgram`, `ObjectMaterialGeometryResource`,
  `createTextureBindingOwnerForObjectMaterialResource`, `uploadObjectMaterialRolePageBindings`,
  `uploadObjectMaterialUniforms`, `#getObjectMaterialPreparedPayload`,
  `#markObjectMaterialPreparedPayloadDirty`, `#markAllObjectMaterialPreparedPayloadsDirty`,
  `resolveObjectMaterialBlendFactor`, `applyObjectMaterialRenderState`, and
  `restoreObjectMaterialRenderState`.
- Role-page vocabulary: `ObjectMaterialTextureRolePageKind`, `ObjectMaterialRolePageSlotInput`,
  `ObjectMaterialOwnerRolePageSlots`, `ObjectMaterialRolePageOverflowDiagnostics`,
  `objectMaterialRolePageOverflows`, and role-page values `"object-base-color"`,
  `"object-detail"`, `"object-index"`, and `"object-palette"`.

Acceptance criteria:

- Dynamic visual resources no longer flow through types, functions, or diagnostics whose names imply
  they are static object resources, except where the name describes true static-layer ownership.
- `webgl2-static-object-payloads.ts` and its test are renamed to object-material names, and imports
  are updated without compatibility re-exports.
- Shared object-material shader limits, payloads, role-page bindings, dirtying helpers, uniform
  upload helpers, render-state helpers, and blend helpers use neutral object-material names.
- Dynamic, static visual-resource, static draw-unit, and structured-interior draw paths all continue
  to use the same object-material payload path after the rename.
- Role-page kind values used by non-terrain object-material textures no longer contain
  `"static-"`, and texture-manager/runtime tests are updated in the same cutover.
- Static-layer ownership names and diagnostics remain intact where they are semantically correct.
- No new behavior, hook support, renderer feature, or compatibility shim is introduced.

Task checklist:

- [x] Rename the WebGL object-material payload file, test file, exports, imports, and helper names.
- [x] Rename object-material shader limit constants and update payload construction tests.
- [x] Rename `TextureRolePageKind` object-material values and related texture-manager role-page
      allocator types, fields, warning diagnostics, and tests.
- [x] Rename shared renderer program/resource/payload/render-state helpers while preserving true
      static-layer resource and diagnostic names.
- [x] Audit transparent draw helper names and rename only helpers that are now shared with dynamic
      or structured-interior material resources.
- [x] Run focused verification:
      `npm run test:ts -- webgl2-object-material-payloads.test.ts webgl2-renderer.test.ts texture-manager.test.ts static-materializer.test.ts`.
- [x] Run full verification commands from `apps/holtburger-3d`: `npm run check`,
      `npm run lint:ts`, `npm run lint:dead`, and `npm run test:ts`.

Decisions and course corrections:

- 2026-06-28 implementation: Renamed
  `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-static-object-payloads.ts` and its test to
  `webgl2-object-material-payloads.ts` / `webgl2-object-material-payloads.test.ts`. No compatibility
  re-export was left behind.
- 2026-06-28 implementation: Renamed the shared prepared draw payload, material uniform, role-page
  binding, dirtying, and preparation helpers from `StaticObject*` vocabulary to
  `ObjectMaterial*` vocabulary. The object-material payload module now imports neutral
  `TextureBinding` rather than the old `StaticTextureBinding` compatibility alias.
- 2026-06-28 implementation: Renamed non-terrain object-material role-page values from
  `"static-base-color"`, `"static-detail"`, `"static-index"`, and `"static-palette"` to
  `"object-base-color"`, `"object-detail"`, `"object-index"`, and `"object-palette"` in renderer
  contracts, texture-manager allocation, runtime static materializer mapping, tests, and warning
  diagnostics.
- 2026-06-28 implementation: Renamed shared WebGL renderer helpers and resource unions such as
  `StaticObjectGeometryProgram`, `StaticMaterialGeometryResource`,
  `uploadStaticObjectRolePageBindings`, `uploadStaticObjectMaterialTableUniforms`,
  `resolveStaticObjectBlendFactor`, `applyStaticObjectRenderState`, and
  `restoreStaticObjectRenderState` to object-material names.
- 2026-06-28 implementation: Renamed object-material shader constants, texture-unit constants,
  uniforms, and GLSL sampling helpers from `Static*`/`uStatic*` vocabulary to `Object*`/`uObject*`
  vocabulary. Static instance transform constants stayed static because they are still specific to
  static-object instanced drawing.
- 2026-06-28 implementation: Kept true static ownership and telemetry names in place, including
  `StaticObjectVisualResource`, `StaticObjectRenderInstance`, static layer payloads,
  `staticObjectResources`, `recentStaticObjectUploads`, and static material pass draw-call counters.
  Those names still describe static-layer work rather than the shared shader/material substrate.
- 2026-06-28 implementation: Transparent draw sorting remains partially static-named where the
  actual draw-list ownership is still static-layer-specific. Shared resource tests now import
  `resolveObjectMaterialBlendFactor`; no fake generic transparent sorting subsystem was introduced.
- 2026-06-28 implementation: `npm install` was required before verification because declared
  `rbush` dependencies were missing from local `node_modules`; the first sandboxed install failed on
  DNS and the approved network install succeeded. npm reported four audit findings. `npm audit fix`
  was not run because it would mutate unrelated package versions outside this cleanup phase.

Verification:

- 2026-06-28: `npm run test:ts -- webgl2-object-material-payloads.test.ts webgl2-renderer.test.ts texture-manager.test.ts static-materializer.test.ts`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run lint:ts`
- 2026-06-28: `npm run lint:dead`
- 2026-06-28: `npm run test:ts` (63 files / 507 tests)
- 2026-06-28: `npm run check:rust`
- 2026-06-28: `npm run lint:rust`
- 2026-06-28: `git diff --check`

Debt and follow-up:

- Static material source/planner names remain static where they describe static-authored source
  facts and static bake policy. Phase 12A should audit whether non-static dynamic sources need a
  neutral setup visual source projection instead of renaming those facts preemptively.
- Static transparent draw-list ownership remains static. If dynamic transparent sorting later needs
  the same list machinery, add a real shared transparent ordering phase rather than renaming static
  lists speculatively.

Risks and mitigations:

- Risk: a mechanical rename blurs static-layer ownership.
  Mitigation: keep static source facts, static layer payloads, static render instances, static
  visual resources, and static diagnostics named static. Rename only the shared shader/material
  substrate and object-material role-page allocator.
- Risk: role-page kind value renames cause broad fixture churn.
  Mitigation: make the value cutover once, update tests in the same phase, and do not add
  compatibility aliases unless a real external contract is discovered.
- Risk: transparent draw sorting grows a fake shared abstraction.
  Mitigation: rename only the helpers/resources that are already shared. Keep static draw-list
  ownership names if dynamic transparent sorting is not yet using that list.

### Phase 12A: Non-Static Dynamic Source Boundary Evidence

Status: completed.

Purpose:

- Define the first non-static-authored dynamic entity source boundary before static-authored scenery
  facts become accidental dynamic runtime architecture.

Context:

- The first dynamic vertical slice intentionally used static-authored dynamic scenery. That means
  current dynamic readiness can lean on static seed facts, static source identities, and static source
  closure helpers without immediately being wrong.
- Future dynamic entities are not guaranteed to be static sourced. Host-spawned players, creatures,
  items, projectiles, equipment, browser-authored debug spawns, and future client-mode local entities
  need a dynamic source path that does not fabricate `StaticAuthoredDynamicSeedRecord`,
  `StaticObjectInstanceIdentity`, static source scopes, or `StaticObjectSourceAssetFacts` as their
  root model.
- The renderer-facing side is already closer to the right shape after Phase 11A and Phase 11C:
  neutral visual geometry and object-material payloads should accept static and non-static dynamic
  sources through explicit adapters.

Scope:

In scope:

- Audit current dynamic record creation, resource readiness, placement, renderer commit, query,
  diagnostics, and removal paths for static-source assumptions.
- Identify the minimal non-static source contract needed for a first explicit dynamic spawn:
  runtime-assigned dynamic entity id, optional server-authored instance id metadata, provenance,
  source residence, setup id, optional animation id/timeline start, base transform, scale, and
  explicit destruction.
- Compare the proposed source contract against existing host/live entity data in
  `holtburger-core` and world/entity DTOs so the debug/browser spike does not contradict the future
  live entity pipeline.
- Compare the proposed source contract against ACE server-authored create-object evidence and the
  Holtburger client/runtime entity event shapes before naming the browser producer contract.
- Identify which static resource helpers should be extracted or wrapped behind a neutral setup
  visual source projection before a non-static dynamic spawn consumes setup/gfx/material facts.
- Define browser-mode spawn UX as the first real consumer. The UX should accept inputs that resemble
  server-authored spawn inputs and then route through the same source contract expected for future
  live host spawns.
- Define a weenie spawn seed resolver boundary for browser-mode UX. The resolver should abstract
  over its backing source, such as an in-memory LUT, generated catalog, ACE SQL export, or future
  Tauri-backed database lookup, and should return resolved weenie/template facts without knowing
  which facts the current spawn pipeline supports.
- Keep spawn/resolver warnings console-owned. Missing, malformed, rejected, or unsupported facts may
  prevent an operation or be skipped, but they should not create durable runtime warning/error/failure
  records.

Out of scope:

- Implementing live player, creature, equipment, projectile, inventory, combat, or authoritative
  spawn/despawn semantics.
- Full `ModelData` palette/sub-palette/texture/model-change composition.
- Motion-table selection, physics scripts, particles, sounds, lights, replacement visuals, or
  material transition hooks.
- Treating a browser/debug spawn as a retail gameplay entity. It is an architecture probe and
  diagnostics harness unless a later phase connects it to host authority.

Survey targets:

- [apps/holtburger-3d/src/lib/dynamic/dynamic-entity-controller.ts](../../apps/holtburger-3d/src/lib/dynamic/dynamic-entity-controller.ts)
  for static-authored seed ingestion, id construction, retention, removal, and tick scheduling.
- [apps/holtburger-3d/src/lib/dynamic/dynamic-entity-resource-manager.ts](../../apps/holtburger-3d/src/lib/dynamic/dynamic-entity-resource-manager.ts)
  for assumptions around `StaticObjectSourceAssetFacts`, `StaticObjectInstanceIdentity`,
  `resolveStaticObjectSourceClosure()`, and material-slot extraction.
- [apps/holtburger-3d/src/lib/dynamic/contracts.ts](../../apps/holtburger-3d/src/lib/dynamic/contracts.ts)
  for provenance, source residence, renderability, visual readiness, and summary DTO coupling.
- [apps/holtburger-3d/src/lib/runtime/client-runtime.ts](../../apps/holtburger-3d/src/lib/runtime/client-runtime.ts)
  for runtime-owned orchestration, frame ticking, dynamic renderer sync, query, diagnostics, and
  browser/runtime command boundaries.
- [apps/holtburger-3d/src/lib/runtime/scene-query/merged-scene-query.ts](../../apps/holtburger-3d/src/lib/runtime/scene-query/merged-scene-query.ts)
  for whether dynamic query membership already depends only on dynamic ids/bounds/residence.
- `crates/holtburger-core/src/client/runtime.rs`, `crates/holtburger-core/src/client/types.rs`, and
  `crates/holtburger-core/src/client/messages.rs` for existing host/live entity event and body-view
  shapes.
- `crates/holtburger-common/src/properties/world_object.rs` and
  `crates/holtburger-common/src/position.rs` for setup/model/position fields likely to feed future
  live dynamic visual sources.
- [ACE/Source/ACE.Server.Tests/SyntheticProtocolTests.cs](../../ACE/Source/ACE.Server.Tests/SyntheticProtocolTests.cs)
  for server create-object fixture evidence covering setup, motion table, sound table, physics
  script, default scale, location, and object-description override fields.
- [ACE/Database/Base/WorldBase.sql](../../ACE/Database/Base/WorldBase.sql) for the ACE world schema
  behind `weenie`, `weenie_properties_*`, `landblock_instance`, and
  `landblock_instance_link` records.
- [ACE/Source/ACE.Database/Adapter/WeenieConverter.cs](../../ACE/Source/ACE.Database/Adapter/WeenieConverter.cs)
  for ACE's conversion from normalized weenie SQL rows into property maps, position facts,
  object-description override lists, generator facts, create lists, emotes, and other entity facts.
- [ACE/Source/ACE.Server/Factories/WorldObjectFactory.cs](../../ACE/Source/ACE.Server/Factories/WorldObjectFactory.cs)
  for server construction of runtime world objects from a WCID-backed weenie template plus instance
  position.
- ACE server create/update object serialization paths for the authoritative field set behind live
  server-authored dynamic objects. Locate the production paths during the Phase 12A evidence pass
  rather than copying only the synthetic fixture shape.
- Holtburger protocol/common object-description, model-data, position, and object id types for the
  narrowest typed browser spawn request that can stay compatible with future server-authored input.

Acceptance criteria:

- The plan records a concrete non-static dynamic source contract and identifies which fields are
  required for the first explicit-spawn slice versus deferred live/entity composition.
- The plan records every static-source assumption that would force a non-static source to fabricate
  static identities or static scope ownership.
- The selected first implementation target is browser-mode spawn UX backed by a server-shaped
  source contract unless the evidence pass proves that contract is wrong. Any deviation must be
  recorded here with the ACE/client evidence that forced it.
- The plan defines a `WeenieSpawnSeedResolver`-style boundary whose contract is source/resolution
  oriented, not Phase-12B-support oriented. Spawn validation owns accepted, skipped, and rejected
  decisions while warnings/errors remain console-owned.
- The next implementation phase can be executed without guessing whether to reuse, extract, or
  replace static source closure helpers.

Task checklist:

- [x] Audit dynamic controller/store/resource/placement/query/runtime code for static-source
      assumptions and record concrete blockers.
- [x] Audit `holtburger-core` live entity/runtime message shapes for setup id, model data, position,
      motion, and lifecycle facts relevant to future source projection.
- [x] Audit ACE create-object production paths and existing synthetic protocol fixtures for
      server-authored object fields: object id, object description/model overrides, location,
      setup id, motion table, sound table, physics script/intensity, default scale, and lifecycle
      replacement/removal semantics.
- [x] Audit ACE weenie SQL/schema and converter paths for a WCID-backed browser spawn seed:
      core weenie metadata, DID/float/string properties, position facts, palette changes, texture
      changes, anim-part changes, generator facts, create lists, emotes, and landblock instance
      placement.
- [x] Define the first non-static dynamic source contract, internal id ownership, and
      removal/lifetime semantics.
- [x] Define the browser-mode spawn request shape as the first producer of the source contract:
      setup id, optional server-authored instance id metadata, residence/position,
      transform/orientation, scale, optional animation/motion selection, and explicit
      remove/replacement behavior.
- [x] Define the weenie spawn seed resolver contract and the first backend strategy. The contract
      must allow in-memory fixtures, generated catalogs, SQL-backed lookup, and future live/host
      resolvers without changing the browser spawn form.
- [x] Decide which server-shaped fields are supported in the initial runtime-spawn phases and which
      are explicitly accepted, skipped, or rejected. Unsupported fields must log to the console when
      encountered and must not create durable warning/error/failure records.
- [x] Update the post-12A implementation phases with revised details discovered by this evidence
      pass.

Decisions and course corrections:

- 2026-06-28 steering: The first implementation consumer should be browser-mode spawn UX, not a
  private unit-test-only fixture. The browser producer should gather inputs that resemble server
  spawn inputs, then feed a neutral dynamic source contract. This gives us a real app-local workflow
  while keeping the boundary shaped by live/server evidence instead of static-authored scenery.
- 2026-06-28 steering: The source contract should be host/server-shaped even when browser-authored.
  Static-authored dynamic records may continue to exist, but browser spawns must not fake
  `StaticAuthoredDynamicSeedRecord`, `StaticObjectInstanceIdentity`, static source scopes, or static
  scene retention ownership.
- 2026-06-28 steering: ACE and Holtburger client crates are mandatory evidence for this phase. The
  current evidence points at setup id, object description/model override data, position/location,
  motion table, sound table, physics script/intensity, and default scale as fields to consciously
  include, reject, or defer. Phase 12A should prove the production paths before the runtime source,
  visual adapter, and browser request DTO phases freeze their contracts.
- 2026-06-28 steering: Browser spawn UX should be one full spawn form that can optionally be seeded
  by WCID. Applying a weenie seed may populate setup, scale, visual overrides, motion/audio/physics
  facts, display metadata, or richer template facts, but the user should still be able to edit the
  resulting form before spawning.
- 2026-06-28 steering: The resolver must not know what the dynamic spawn pipeline currently
  supports. It should return resolved source facts or no result. Missing or malformed source rows
  should be logged to the console at the resolver boundary, while the browser form, spawn adapter, or
  runtime boundary decides which facts are accepted, skipped, or rejected for current pipeline
  limitations.
- 2026-06-28 steering: A server-authored object or instance id is source metadata, not our internal
  dynamic entity id. Runtime spawns should use an internally consistent runtime entity id assigned by
  the controller/runtime. Server ids may be retained for inspection, correlation, or future host
  adapter mapping, but they must not drive store identity, resource ids, renderer ids, or removal
  ownership.
- 2026-06-28 steering: Do not add durable error/failure/warning records for spawn support gaps,
  resolver misses, malformed source rows, or skipped unsupported facts. Log operational issues to the
  console when they are encountered and move on. Diagnostics should remain compact projections over
  current operational state, not a diary.
- 2026-06-28 implementation: The dynamic runtime shell is reusable, but creation/source ownership is
  still static-authored. `DynamicEntityRecord` stores `sourceSeed: StaticAuthoredDynamicSeedFacts`;
  provenance is limited to static-authored env-cell/outdoor variants; controller creation only
  ingests `StaticAuthoredDynamicSeedRecord`; store retention is keyed by static source scope; and
  summaries report `staticSeedCount` as total dynamic count.
- 2026-06-28 implementation: Dynamic resource readiness is also static-shaped. The manager tracks
  `StaticAuthoredDynamicSeedFacts`, resolves static object source closure from
  `seed.sourceAssetId`, builds material slots from `StaticObjectInstanceIdentity`, and uses static
  material planning helpers. Phase 12C needs a neutral setup visual source projection consumed by
  resource readiness, not a broad rename of static source facts.
- 2026-06-28 implementation: Placement, animation ticking, current-frame bounds, query membership,
  renderer resource commits, and renderer instance commits are much closer to source-neutral after
  an entity record exists. The main non-static renderer debt is texture policy: dynamic texture
  commits still use static-shaped domain/batch vocabulary, static-authored dynamics derive domain
  and batch fallback from static provenance owner/scope, and runtime spawns need dynamic domain,
  correctness-first runtime batching with a future recipe-batching path, and shared visual-resource
  ownership.
- 2026-06-28 implementation: ACE server evidence says server-authored objects are richer than the
  first renderable slice. `SerializeCreateObject` covers model data, physics flags/state, position,
  setup, motion table, sound table, physics script/default script, physics script intensity, default
  scale, parent/wielder/container context, sequences, and public weenie description fields. The
  browser request should preserve this shape, but the initial runtime-spawn implementation should
  execute only the setup-backed visual and animation subset.
- 2026-06-28 implementation: ACE spawn tooling confirms WCID seeding is the right UX model.
  `/create` creates a world object from a weenie template, places it relative to the player, and may
  apply palette/shade/lifespan overrides. Persistent landblock instances store WCID plus
  `obj_Cell_Id`, origin, quaternion, and link-child metadata.
- 2026-06-28 implementation: This ACE checkout contains world schema, converters, and SQL writers,
  but not a full world data dump. Phase 12D should ship with the resolver interface and an in-memory
  or small generated fixture backend. A SQL/catalog-backed resolver needs an explicit catalog import
  phase or a user-provided ACE world DB/export path.

Target shape illustrations:

Resolver and form boundary:

```text
manual fields ------------------------------+
                                            |
WCID seed -> WeenieSpawnSeedResolver -> resolved facts
                                            |
                                            v
                                 editable browser spawn form
                                            |
                                            v
                              ServerShapedDynamicSpawnRequest
```

The resolver is source-facing. It may read from an in-memory fixture, a generated catalog, an ACE SQL
export, or a future Tauri/database adapter. It does not filter facts based on the current renderer,
resource manager, or dynamic spawn support.

```text
WeenieSpawnSeedResolver
  input:
    weenieClassId
    optional source selector / catalog selector

  output:
    resolved identity facts
      weenieClassId
      className
      weenieType
      displayName?

    resolved visual facts
      setupId?
      defaultScale?
      paletteId?
      subPaletteChanges[]
      textureChanges[]
      animPartChanges[]

    resolved motion/audio/physics facts
      motionTableId?
      soundTableId?
      physicsScriptId?
      physicsScriptIntensity?

    resolved richer template facts
      positions[]
      generators[]
      createList[]
      emotes[]
      inventory/equipment facts when proven

  behavior:
    missing source, missing WCID, malformed rows, or duplicate/conflicting rows log to the console
    and return no resolved facts rather than durable diagnostic records
```

The editable browser form owns user intent. Applying a seed copies resolved facts into form fields,
but the form remains editable. The same form can also be filled manually with no seed.

```text
BrowserDynamicSpawnFormState
  seed:
    requestedWeenieClassId?
    resolvedSeedSummary?

  editable spawn fields:
    serverInstanceIdMetadata?
    sourceResidence
    baseTransform
    setupId
    scale
    animationMode
    objectDescriptionOverrides
    motion/audio/physics fields when exposed
```

Spawn validation is consumer-facing. It decides what the current runtime-spawn pipeline can turn into
an actual dynamic spawn request and what must be skipped or rejected. Skipped/rejected facts log to
the console and do not become durable warning/error/failure records.

```text
BrowserDynamicSpawnFormState
        |
        v
validateBrowserDynamicSpawnRequest()
        |
        +--> accepted facts -> ServerShapedDynamicSpawnRequest
        |
        +--> rejected operation, logged to console
        |      invalid cell/residence
        |      missing setup id
        |      malformed object-description override
        |
        +--> skipped facts, logged to console
               physics script present but not executed
               generator children present but not spawned
               create-list/inventory present but not composed
               emote/audio behavior present but not played
```

Runtime ownership after validation:

```text
ServerShapedDynamicSpawnRequest
        |
        v
DynamicEntityController.createRuntimeSpawn()
        |
        +--> DynamicEntityRecord
        |      provenance: browser-authored/server-shaped
        |      no static seed identity
        |      no static scope ownership
        |
        +--> DynamicEntityResourceManager
        |      setup visual source projection
        |      object-material resources
        |
        +--> Dynamic placement/query/scheduler/renderer families
```

Phase 12A target contracts:

```text
DynamicEntitySourceFacts
  staticAuthored
    existing StaticAuthoredDynamicSeedFacts

  runtimeServerShaped
    sourceKind: browser-authored-server-shaped
    runtimeEntityId: internally assigned dynamic entity id
    serverInstanceIdMetadata?
    sourceResidence
    baseTransform
    visual
    animation
    serverObjectFacts
    lifecycle
```

```text
ServerShapedDynamicSpawnRequest
  requestId
  serverInstanceIdMetadata?
    server-authored object/instance id, retained only for correlation and inspection

  seed
    none
    weenieClassId
    resolverSourceId?
    resolvedSeedRevision?

  sourceResidence
    outdoor landblock + cell/local placement
    env-cell landblock/envCell + local placement

  visual
    setupId
    scale
    modelData
      paletteId?
      subPalettes[]
      textureChanges[]
      modelChanges[]

  animation
    setupDefault
    explicit animationId

  serverObjectFacts
    wcid?
    className?
    weenieType?
    displayName?
    motionTableId?
    soundTableId?
    physicsScriptId?
    physicsScriptIntensity?
    parentId?
    parentLocation?
    children[]
```

```text
BrowserDynamicSpawnValidationResult
  acceptedRequest: ServerShapedDynamicSpawnRequest | null

  behavior:
    missing setup id, invalid source residence/cell, invalid server instance id metadata, or malformed
    model data override reject the operation and log to the console
    unsupported model data, motion table behavior, sound table behavior, physics/default script
    execution, parent/child attachment rendering, and generator/create-list/emote/equipment
    composition are skipped with console logs when they are encountered
```

Initial runtime-spawn support decision:

- Supported: internally generated runtime dynamic entity id, optional server instance id metadata,
  outdoor/env-cell source residence, base transform/orientation, setup id, scalar or vector scale
  normalized to the existing dynamic source scale shape, setup default animation or explicit
  animation id, WCID/display metadata as inspector/correlation fields, and explicit create/remove
  lifecycle.
- Supported only as resolved/validated facts, not executed behavior: motion table id, sound table id,
  physics/default script id and intensity, generator/create-list/emote facts, parent/child linkage,
  equipment/inventory facts, and rich gameplay/public-weenie fields.
- Rejected: spawn requests without setup id after manual entry/seed application, invalid residence
  cells, invalid server instance id metadata, and malformed model-data override records.

Runtime visual projection shape:

```text
ServerShapedDynamicSpawnRequest
        |
        v
createRuntimeDynamicSourceFacts()
        |
        +--> projectDynamicSetupVisualSource()
        |      DynamicSetupVisualSource / DynamicVisualPlan
        |      setupId
        |      modelData overrides
        |      source identity not tied to static object instance
        |      dynamic texture domain policy
        |      optional visual recipe batch signature
        |      shared visual-resource ownership node
        |
        +--> dynamic record source facts
               runtimeEntityId
               serverInstanceIdMetadata?
               sourceResidence
               baseTransform
               sourceScale
               animation selection
               browser/server-shaped provenance
```

Cleaner operational shape:

```text
DynamicEntityRecord
        |
        +--> identity
        |      dynamic entity id
        |      source kind: static-authored | runtime-spawn
        |      optional host/server correlation metadata
        |
        +--> operational policies
        |      retentionPolicy: static scope | explicit runtime lifetime
        |      texturePolicy: static-derived | runtime-dynamic
        |      batchPolicy: static-derived | per-runtime-entity
        |      ownershipPolicy: dynamic visual-resource owner/refcount
        |
        +--> visual source projection
               setup id
               animation selection/default evidence
               source asset ids
               material/object planning facts
               supported model-data subset
               effective residence
```

Planning correction: provenance and source labels are not the dynamic control plane. Source-specific
facts should be projected once into explicit lifecycle/resource policies, and resource/renderer hot
paths should consume those policies. Raw provenance, full static owner facts, browser/server-shaped
labels, and server-authored instance ids are diagnostic or correlation context unless a named policy
explicitly consumes them.

Debt and spicy bits found by Phase 12A:

- Dynamic snapshots call every active dynamic record a static seed via `staticSeedCount`. Phase 12B
  should split this into `staticAuthoredCount` and `runtimeSpawnCount`.
- Texture atlas policy for dynamic visual resources needs a split policy. Static-authored dynamics
  may keep static-derived domain and batch identity because their visual source is static scenery
  evidence, but their renderer texture owners and leases must remain dynamic-resource-owned. Runtime
  spawns need an explicit dynamic texture domain and dynamic visual-resource ownership policy instead
  of mapping into static domains by convenience. Visual-recipe batching is valuable for later host
  streams and repeated spawned objects, but Phase 12C.1 may use per-runtime-entity batches as a
  correctness-first policy.
- The current static and runtime shapes still risk using provenance as a control plane. Phase 12B.5
  should clean up static/render naming and extract explicit visual/resource policies before runtime
  spawns become renderable. Phase 12C.1 should then reuse that policy vocabulary for dynamic
  presentation policy projection instead of checking raw `provenance.kind`, preformatted
  source-scope labels, or full static owner metadata.
- The static material planner and static object source closure are still the only implemented way to
  resolve setup/gfx/material facts. The neutral setup visual source projection should wrap/extract
  this path narrowly rather than pretending all static source facts are generic.
- Current dynamic tests mostly create static-authored seed records. Phase 12B should start runtime
  spawn tests instead of stretching those factories further.

Verification:

- 2026-06-28: Phase 12A was an evidence/plan-contract phase. No app code was changed and no runtime
  test suite was required. `git diff --check` was run after the plan update.

### Phase 12B: Runtime Spawn Source Model And Lifecycle

Status: completed.

Purpose:

- Add the non-static dynamic source model and explicit create/remove lifecycle before any browser UX
  tries to drive it.

Deliverables:

- Add a non-static dynamic source/provenance variant for server-shaped runtime dynamic spawns. The
  first planned producer is browser-mode UX, but the source fields should be compatible with a
  future host-spawned adapter.
- Refactor `DynamicEntityRecord.sourceSeed` into a source union. Static-authored records should keep
  their static seed facts under a static-authored source variant; runtime-spawn records should carry
  runtime source facts without a static seed.
- Runtime-spawn records must use internally assigned dynamic entity ids for store identity, resource
  ids, renderer ids, and removal ownership. Any server-authored object/instance id is retained only
  as source metadata for correlation and inspection.
- Add an explicit create/update/remove API at the runtime/controller boundary. Removal must be
  explicit and must release resource leases, spatial/query membership, renderer resources, renderer
  instances, and scheduler state.
- Split static-source retention from runtime-spawn lifetime. Static scene-interest reconciliation may
  evict static-authored dynamic records, but it must not remove runtime-spawn records.
- Split dynamic diagnostics/snapshots that currently treat every dynamic entity as a static seed,
  including replacing or supplementing `staticSeedCount` with static-authored and runtime-spawn
  counts.
- Support runtime-spawn source facts with internal runtime entity id, optional server instance id
  metadata, source residence, base transform/orientation, scale, setup id, animation selection,
  model-data facts, server-object facts, and explicit lifecycle policy.
- Keep visual resource readiness behind a temporary unsupported/pending state if the neutral setup
  visual source projection has not landed yet. This phase should prove ownership and lifecycle, not
  renderability.
- Do not call the current static-shaped `DynamicEntityResourceManager.trackSetupAnimationResources()`
  for runtime spawns in Phase 12B. Resource tracking for runtime setup visual sources belongs to
  Phase 12C.2B.
- Add tests proving runtime spawns do not fabricate static seed records, static source scopes, static
  object identities, or static draw units.

Acceptance criteria:

- A runtime-spawn dynamic record can be created, summarized, queried by internal runtime entity id,
  and explicitly removed without using `StaticAuthoredDynamicSeedRecord`.
- Runtime-spawn records remain active across static scene-interest retention/reconciliation changes
  until explicitly removed.
- Explicit removal tears down store state, scheduler state, placement membership, resource leases,
  renderer resources, and renderer instances that exist for the spawn.
- No explicit-spawn path fabricates static seed records, static source scopes, static object
  identities, or static draw units.
- Runtime-spawn diagnostics and snapshots distinguish runtime browser spawns from static-authored
  dynamic scenery.
- Static-authored dynamic scenery behavior remains stable.
- The implementation records any remaining coupling from runtime-spawn records back to static source
  assumptions.

Task checklist:

- [x] Replace `DynamicEntityRecord.sourceSeed` with a source union covering static-authored and
      runtime-spawned records.
- [x] Add server-shaped non-static dynamic source contract and controller create/update/remove APIs.
- [x] Add an internal runtime entity id allocator/factory. Server-authored ids stay metadata-only.
- [x] Add explicit-spawn id/lifetime tests covering internal id assignment, server instance id
      metadata not being used as identity, create, update or rejection policy, and removal.
- [x] Refactor static source retention so `retainStaticScopes()` or its replacement only removes
      static-authored dynamic records.
- [x] Add regression coverage proving runtime spawns survive static retention changes until explicit
      removal.
- [x] Keep runtime-spawn visual/setup resource state pending or unsupported without invoking the
      current static-shaped resource manager path.
- [x] Split dynamic summary counts and diagnostics between static-authored and runtime-spawned
      dynamic records.
- [x] Add regression coverage proving runtime spawns do not enter static bake/query/scope retention
      paths.
- [x] Add focused TypeScript verification for dynamic contracts/controller/store/runtime snapshot
      tests.
- [x] Run full app verification commands from `apps/holtburger-3d`.

Risks and mitigations:

- Risk: the explicit-spawn path becomes a toy that future host-spawned entities cannot reuse.
  Mitigation: keep the source facts host/server-shaped even though browser UX is the first planned
  producer.
- Risk: this phase accidentally implements visual loading through fake static seed facts to get a
  rendered result.
  Mitigation: stop at lifecycle/source ownership if the neutral setup visual source projection is
  not ready. Resource tracking moves to Phase 12C.2B, material identity/readiness moves to Phase
  12C.2C/12C.2D, and rendering moves to Phase 12C.3.
- Risk: static retention removes runtime spawns during ordinary scene-interest changes.
  Mitigation: make static retention provenance-aware and add a regression test where a runtime spawn
  survives `retainStaticScopes([])` or the equivalent static-retention call.
- Risk: the source union causes broad test churn in placement/cadence/animation helpers that
  hand-build `DynamicEntityRecord` fixtures.
  Mitigation: add or update focused dynamic test factories as part of the source-union cutover rather
  than expanding ad hoc fixture objects in every test.

Decisions and course corrections:

- 2026-06-28 implementation: Replaced `DynamicEntityRecord.sourceSeed` with `source` union variants
  for `static-authored` and `runtime-spawn`. Static-authored records still carry their original seed
  facts under the static source variant; runtime records carry setup id, animation selection,
  server-instance metadata, model-data placeholder, source kind, and internal runtime entity id
  without any static seed.
- 2026-06-28 implementation: Added `DynamicEntityController.createRuntimeSpawn()`,
  `updateRuntimeSpawn()`, and `removeRuntimeSpawn()`. Runtime ids are controller-assigned ordinals
  such as `runtime-spawn:1`. Server-authored object/instance ids are preserved only as metadata and
  do not participate in store identity, renderer ids, resource ids, or removal ownership.
- 2026-06-28 implementation: Made static retention provenance-aware by changing store retention to
  remove only static-authored dynamic records. Runtime spawns now survive static
  scene-interest/retention changes until explicitly removed.
- 2026-06-28 implementation: Runtime spawns intentionally remain pending/non-renderable in Phase
  12B. They do not call `DynamicEntityResourceManager.trackSetupAnimationResources()`, because that
  path is still static-seed-shaped. Dynamic presentation policy projection, neutral setup visual
  readiness, first rendering, and rendering breadth remain Phase 12C.1 through 12C.4 work.
- 2026-06-28 implementation: Dynamic snapshots now expose `staticAuthoredCount` and
  `runtimeSpawnCount` while retaining `staticSeedCount` as a compatibility alias for static-authored
  count. Runtime diagnostics now read the explicit static-authored count.
- 2026-06-28 spicy bit: `client-runtime.ts` has a type-safe runtime-spawn atlas fallback branch even
  though runtime spawns are not renderable yet. This keeps the source union honest at compile time,
  but the real dynamic texture-domain, correctness-first runtime batching, and shared ownership
  policy is still Phase 12C.1 through 12C.2E debt.

Verification:

- 2026-06-28: `npm run test:ts -- dynamic`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run lint`
- 2026-06-28: `npm run build` passed with Vite's existing chunk-size warning.

### Phase 12B.5: Static Visual Policy Rename And Projection Cleanup

Status: completed.

Purpose:

- Clean up the existing static/render provenance pattern before runtime spawns become renderable, so
  Phase 12C can plug into neutral visual/resource policy names instead of adding dynamic-only
  adapters around static-shaped APIs.

Target shape:

```text
Static authored facts
  landblock/env-cell evidence
  static object identity
  source asset id
  authored scope
        |
        v
Static visual source projection
  setup/gfx/material source inputs
  material planning identity
  effective residence
        |
        v
Visual/resource policies
  retention scope
  texture domain
  batch key
  prepared-asset lease owner
  texture-use owner
        |
        v
Static and dynamic renderer/resource consumers
```

Deliverables:

- Audit static/resource/render names that currently say `static` because static scenery was the
  first consumer, not because the concept is truly static-only. Rename those concepts to neutral
  `Visual*`, `Presentation*`, or resource-policy names where the broader meaning is proven by
  existing dynamic usage or Phase 12C needs.
- Keep genuinely static-authored evidence explicitly static. Source facts such as landblock/env-cell
  ownership, authored static object identity, source asset ids, and static retention scopes should
  remain clearly named as static-authored facts.
- Extract or rename the operational concepts currently inferred from static provenance:
  retention scope, texture domain, batch key, material planning identity, prepared-asset lease owner,
  and texture-use owner.
- Move static renderer/resource consumers toward explicit policy/projection inputs. Consumers should
  not read full static provenance when they only need a texture domain, batch key, material planning
  identity, or retention scope.
- Prefer decisive cutovers over compatibility shims. If a type or field has a misleading static name
  and all call sites can move cleanly, rename it and delete the old spelling.
- Keep behavior stable. This phase is a semantic cleanup and projection extraction phase, not a
  rendering behavior change or runtime-spawn renderability phase.
- Record any names that remain static-shaped because the cutover would be too large or because the
  concept is still genuinely static-only.

Acceptance criteria:

- Static rendering, texture preparation, atlas use commits, material planning, and retention still
  behave the same after the rename/projection cleanup.
- Operational consumers use explicit policy/projection fields for retention scope, texture domain,
  batch key, material planning identity, prepared-asset lease owner, and texture-use owner where this
  phase touches them.
- Real static-authored evidence remains distinguishable from neutral renderer/resource policy.
- Static-authored dynamic entities can still reuse static-derived texture domain and batch policy,
  while their renderer texture owners and lease lifetime remain dynamic visual-resource-owned.
- Phase 12C can consume the same neutral policy/projection names for runtime-spawn visual readiness
  without creating a parallel dynamic-only adapter layer.

Task checklist:

- [x] Audit static-shaped names in static object source closure, material planning, texture manager,
      renderer atlas/batch commits, dynamic resource readiness, and runtime snapshot plumbing.
- [x] Classify each target as genuinely static-authored evidence, neutral visual source input, or
      operational visual/resource policy.
- [x] Rename neutral concepts away from misleading static-only names, using decisive cutovers where
      call sites can move cleanly.
- [x] Extract explicit policy/projection fields for shared texture domain and texture batch key, and
      classify retention scope, material planning identity, prepared-asset lease owner, and
      texture-use owner as either genuinely static-authored or still owned by Phase 12C projection
      work.
- [x] Refactor static and static-authored-dynamic consumers touched by the rename to consume the
      explicit policy/projection fields.
- [x] Delete obsolete aliases, compatibility types, or helper names introduced only to bridge the
      rename.
- [x] Update focused tests for renamed concepts and remove tests that only assert legacy naming or
      diagnostic wording.
- [x] Run focused TypeScript verification for static resource/material/texture/runtime paths.
- [x] Run full app verification commands from `apps/holtburger-3d`.

Risks and mitigations:

- Risk: broad rename churn hides behavior changes.
  Mitigation: keep commits/patches structured around semantic groups, preserve existing behavior,
  and rely on focused static resource/material/texture tests plus full app verification.
- Risk: genuinely static source facts get over-neutralized and lose useful authored meaning.
  Mitigation: keep source evidence names static when they describe actual static landblock/env-cell
  data. Only neutralize concepts that renderer/resource consumers can share.
- Risk: the cleanup becomes a renderer-wide rewrite.
  Mitigation: target the provenance-to-policy boundary first: retention, texture domain, batch key,
  material planning identity, and ownership. Leave unrelated static bake/render behavior alone.
- Risk: Phase 12C still adds a dynamic-only adapter after the rename.
  Mitigation: make Phase 12C consume the names and policy shapes introduced here, and record any
  mismatch as either missing projection vocabulary or real source-specific behavior.

Decisions and course corrections:

- 2026-06-28 implementation: Kept static source evidence names static. `StaticDomain` still names
  static resolver/work domains, `StaticObjectInstanceIdentity` still names authored static object
  evidence, and static bake/coordinator DTOs still expose `staticBatchId` because those records are
  static bake outputs.
- 2026-06-28 implementation: Added `VisualTextureDomain` as the neutral texture placement policy
  type and migrated texture packing plus dynamic texture commits to texture-domain/texture-batch
  vocabulary. Dynamic visual resources now submit `textureDomain` and `textureBatchId` instead of
  `atlasDomain` and `atlasBatchId`.
- 2026-06-28 implementation: Renamed the texture manager's internal static-batch registry concepts
  to visual texture batch/key concepts. Static commits are converted at the texture manager boundary:
  static bake records enter with `domain`/`staticBatchId`, then become `domain`/`textureBatchId` for
  shared atlas placement.
- 2026-06-28 implementation: Renamed runtime dynamic texture policy helpers from atlas-specific
  names to texture-domain/texture-batch names, including the static-source-scope lookup used by
  static-authored dynamic visuals.
- 2026-06-28 concession: Material planning identity remains static-authored for now. The current
  material planner still consumes `StaticObjectInstanceIdentity`, and runtime-spawn neutral material
  planning identity remains Phase 12C work. Forcing that rename before runtime visual projection
  would have been ceremonial.
- 2026-06-28 spicy bit: `VisualTextureDomain` is currently an alias of `StaticDomain` because static
  scenery still defines the concrete texture placement domains. The important cleanup is that dynamic
  texture commits and texture packing no longer expose static-only names at their policy boundary;
  a truly runtime-only texture domain is still Phase 12C debt.

Verification:

- 2026-06-28: `npm run test:ts -- texture-manager`
- 2026-06-28: `npm run test:ts -- client-runtime`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run lint`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run build` passed with Vite's existing chunk-size warning.

### Phase 12C.1: Dynamic Presentation Policy Projection

Status: completed.

Purpose:

- Move dynamic presentation policy derivation above resource tracking and renderer sync, so
  static-authored and runtime-spawned records project source facts once and consumers stop treating
  provenance as the control plane.

Target shape:

```text
DynamicEntityRecord.source
  static-authored source facts | runtime-spawn source facts
        |
        v
projectDynamicPresentation()
        |
        +--> DynamicPresentationPolicy
        |      retentionPolicy
        |      textureDomain
        |      textureBatchId
        |      ownershipPolicy
        |      materialPlanningIdentity | pending reason
        |
        +--> DynamicVisualSource
        |      setup id
        |      animation selection/default evidence
        |      source asset ids
        |      effective residence
        |      supported model-data subset
        |
        +--> DynamicDiagnosticContext
               source kind
               static source metadata?
               server/host correlation metadata?
```

Deliverables:

- Add a `DynamicPresentationPolicy`/`DynamicVisualPlan` projection boundary near dynamic contracts
  or dynamic resource planning. Source-specific projectors may build it, but resource and renderer
  consumers should receive projected policy/visual facts instead of raw source/provenance facts.
- Store the projected policy/visual/diagnostic context on `DynamicEntityRecord` and expose the
  projected policy through `DynamicEntitySummaryDto`. Runtime renderer helpers currently receive
  summary DTOs, so the summary must make the projected policy the convenient path; otherwise
  renderer sync will keep deriving texture policy from `record.provenance`.
- Define explicit policy fields: `retentionPolicy`, `textureDomain`, `textureBatchId`,
  `ownershipPolicy`, and `materialPlanningIdentity` or an explicit pending/rejection reason.
- Reuse the Phase 12B.5 neutral texture vocabulary. Runtime-spawn texture policy should use
  `VisualTextureDomain` and `textureBatchId`; if a runtime-only texture domain is required, extend
  the visual texture policy type rather than mapping runtime spawns through static resolver/work
  domain names.
- Project static-authored records to static-scope retention, static-derived texture domain/batch,
  and dynamic visual-resource ownership. Static-authored source facts remain explicitly static
  source evidence.
- Project runtime-spawn records to explicit runtime lifetime, dynamic visual-resource ownership, and
  deterministic per-runtime-entity `textureBatchId` as correctness-first debt. If the current domain
  type cannot represent runtime placement honestly, add the narrow runtime domain/transition type
  here instead of returning fake static resolver domains.
- Keep server-authored object/instance ids and full static owner details in diagnostic/correlation
  context only. Store, renderer, lease, texture, and removal identity must come from local dynamic
  ids and projected policies.
- Introduce a neutral material planning identity shape or an explicit unsupported/pending state.
  Runtime spawns must not fabricate `StaticObjectInstanceIdentity` to satisfy the current material
  planner.
- Refactor static retention and runtime dynamic texture commit helpers to consume projected policies
  where this phase touches them. Do not require runtime spawns to become resource-ready in this
  phase.
- Keep runtime-spawn records renderer/presentation-owned. The browser runtime may assign stable
  local dynamic ids and preserve optional server-authored object/instance ids as metadata for
  picking, inspection, and host feedback, but the renderer must not treat those server ids as store,
  renderer, lease, or removal identity.
- Treat `updateRuntimeSpawn()` as a presentation update API. It may update in place or replace visual
  records if that produces cleaner renderer behavior; semantic server update/delete distinctions
  belong to the host/runtime projection layer, not this frontend renderer boundary.

Acceptance criteria:

- Static-authored and runtime-spawn records can both be projected into `DynamicPresentationPolicy`
  plus visual/diagnostic context without fabricating static seed records, static source scopes,
  static object identities, or static draw units for runtime spawns.
- `DynamicEntityRecord` and `DynamicEntitySummaryDto` expose projected presentation policy, and
  runtime renderer texture helpers consume that policy instead of deriving texture domain/batch from
  `record.provenance`.
- Dynamic retention, dynamic texture policy creation, and renderer sync helpers touched by this
  phase consume projected policies instead of branching directly on raw provenance labels or full
  static owner metadata.
- Runtime-spawn texture policy is deterministic, does not use server-authored id, and uses
  `VisualTextureDomain`/`textureBatchId` or a documented runtime domain/transition type.
- Static-authored dynamic texture policy may continue to use static-derived domain and batch identity
  where that static source evidence is real, while texture owners and lease lifetime remain dynamic
  visual-resource-owned.
- Diagnostic and pick summaries may expose source kind and optional server/static correlation
  metadata, but those fields are not used as renderer/resource identity.
- Runtime spawns may remain pending/non-renderable if neutral material planning identity or setup
  resource readiness is not implemented yet.
- Existing static-authored dynamic scenery behavior remains stable.

Task checklist:

- [x] Define `DynamicPresentationPolicy`, `DynamicVisualSource`, and
      `DynamicDiagnosticContext`-style types with documented fields for retention, texture domain,
      texture batch id, ownership, material planning identity/pending reason, source assets, setup
      id, animation selection/default evidence, effective residence, supported model-data subset,
      and optional correlation context.
- [x] Add projected presentation policy/visual/diagnostic context to `DynamicEntityRecord` and
      `DynamicEntitySummaryDto`.
- [x] Add source-specific projection functions for static-authored and runtime-spawn records.
- [x] Move dynamic retention and dynamic texture policy derivation to consume projected policy fields
      instead of raw `provenance.kind`, full static owner facts, or server-authored ids.
- [x] Preserve static-authored dynamic domain/batch reuse where it is backed by real static source
      evidence, while keeping texture owners and leases dynamic-resource-owned.
- [x] Add or plan the minimal `VisualTextureDomain` extension so runtime-spawn texture policy is not
      represented as static resolver/work domain policy by default.
- [x] Add runtime-spawn per-entity texture batch coverage proving server ids are not used for
      texture identity, and record visual-recipe batching as follow-up debt if it is not implemented.
- [x] Add coverage proving diagnostic/correlation metadata is not used as store, renderer, lease,
      removal, or texture identity.
- [x] Run focused TypeScript verification for dynamic contracts/controller/store/runtime policy
      projection tests.
- [x] Run full app verification commands from `apps/holtburger-3d`.

Risks and mitigations:

- Risk: static-source facts get renamed or generalized prematurely.
  Mitigation: keep static-authored facts static; project into a neutral visual source only at the
  boundary where setup/gfx/material facts become dynamic resource-readiness inputs.
- Risk: the projection boundary lands too low and becomes a pile of per-call adapters.
  Mitigation: make `DynamicEntityResourceManager` consume the neutral visual source/projection shape.
  Source-specific adapter functions are allowed before that boundary, but resource tracking should
  not continue to store static source evidence or policy-specific legacy facts.
- Risk: runtime spawns introduce a second dynamic renderer/query pipeline.
  Mitigation: after source projection, reuse the existing dynamic resource manager, placement
  tracker, renderer dynamic commits, cadence policy, merged query family, and selected diagnostics.
- Risk: provenance survives as a shadow control plane and keeps forcing runtime spawns through
  static-shaped facts.
  Mitigation: derive named operational policies once at the source projection boundary, then make
  resource readiness, retention, texture commits, and renderer sync consume those policies. Include
  the projected policy in `DynamicEntitySummaryDto` because renderer sync currently operates on
  summaries.
- Risk: removing provenance from hot paths loses useful diagnostics.
  Mitigation: keep diagnostic/correlation context separate from operational policies. Inspectors and
  pick summaries may show source kind, static source metadata, or server ids, but renderer/resource
  identity and lifecycle must come from local dynamic ids and policies.
- Risk: the dynamic texture domain cutover balloons into a renderer-wide rename of static atlas
  terms.
  Mitigation: keep the cutover narrow. Introduce a dynamic-capable domain type at texture commit and
  placement boundaries, leave truly static layer domains named static, and convert static bake
  `staticBatchId` values at the texture-manager boundary into the shared `textureBatchId` shape.
- Risk: the dynamic texture-domain cutover breaks static-authored dynamic atlas sharing by treating
  every dynamic source like a runtime spawn.
  Mitigation: keep policy source-aware. Static-authored dynamics may retain static-derived
  domain/batch identity when provenance is real; runtime spawns use dynamic domain/recipe policy;
  both paths keep dynamic visual-resource ownership.
- Risk: per-entity runtime batch ids avoid sharing and cause texture churn for common spawned
  entities.
  Mitigation: allow per-entity runtime batches only as Phase 12C correctness-first debt; keep the
  projection capable of carrying a visual recipe batch signature and schedule recipe batching once
  repeated runtime spawns or host streams make sharing materially useful.
- Risk: shared dynamic visual resources outlive all instances or get evicted while still referenced.
  Mitigation: make dynamic entity-to-visual-resource references explicit and release atlas/prepared
  leases from the visual-resource node only when the last reference is removed.
- Risk: renderer APIs drift toward ACE server create/update/delete semantics.
  Mitigation: keep this phase scoped to presentation records. Server object authority, sequence,
  containment, equipment, inventory, replacement, prediction, and cancellation semantics remain host
  runtime concerns that project visual facts into the browser renderer.

Decisions and course corrections:

- 2026-06-28 implementation: Added projected presentation context to dynamic records and summaries.
  The shape is stored under `presentation` and carries `policy`, `visualSource`, and `diagnostics`.
  `provenance` remains on summaries for diagnostics/backward inspection, but it is no longer the
  source of dynamic retention or renderer texture policy.
- 2026-06-28 implementation: Static-authored projection keeps real static evidence static while
  deriving static-scope retention, static-derived `textureDomain`/`textureBatchId`, dynamic
  visual-resource ownership, setup visual source asset ids, and static-authored material planning
  identity. `ClientRuntime` now passes the static source-scope texture batch map into seed ingestion
  so this policy is decided at projection time.
- 2026-06-28 implementation: Runtime-spawn projection uses explicit runtime lifetime, dynamic
  visual-resource ownership, deterministic per-runtime-entity `textureBatchId`, local dynamic visual
  resource id, and diagnostic server-instance metadata. Server-authored ids are not used for store,
  renderer, lease, removal, or texture identity.
- 2026-06-28 implementation: Dynamic store retention now consumes
  `presentation.policy.retentionPolicy`, and runtime dynamic texture commit creation consumes
  `record.presentation.policy.textureDomain` and `textureBatchId` instead of deriving them from
  `record.provenance`.
- 2026-06-28 concession: Runtime outdoor spawns still project to the current `outdoor-detail`
  `VisualTextureDomain`. Phase 12C.1 moved the policy decision out of provenance, but runtime
  spawns need their own runtime visual texture domain before they render. That cutover belongs to
  Phase 12C.2A, before Phase 12C.3 renderer integration and before Phase 12D browser UX.
- 2026-06-28 spicy bit: Runtime material planning identity is explicitly pending with
  `runtime-material-planning-identity-unsupported`. That is intentional. Phase 12C.1 did not fake
  `StaticObjectInstanceIdentity`; Phase 12C.2B/12C.2C/12C.2D own the real material identity and
  runtime readiness work.

Verification:

- 2026-06-28: `npm run test:ts -- dynamic-entity-controller`
- 2026-06-28: `npm run test:ts -- dynamic`
- 2026-06-28: `npm run test:ts -- client-runtime`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run lint`
- 2026-06-28: `npm run build` passed with Vite's existing chunk-size warning.

### Phase 12C.2A: Runtime Visual Texture Domain Cutover

Status: completed 2026-06-28.

Purpose:

- Give runtime-authored dynamic visuals their own texture placement domain before they can become
  resource-ready or renderable. This phase is only the visual-domain cutover; it must not solve
  material planning, renderer integration, browser UX, or server gameplay semantics.

Deliverables:

- Extend `VisualTextureDomain` with a runtime visual/object-material domain without adding that
  value to `StaticDomain`. Static resolver/work domains remain static-only.
- Update runtime-spawn presentation policy to use the runtime visual texture domain for all
  runtime-authored object-material visuals. Residence still describes where the entity renders; it
  does not select a static texture domain.
- Wire the runtime visual texture domain through texture packing, role-page routing, diagnostics,
  dynamic texture commits, and texture-manager tests.
- Preserve static-authored dynamic texture policy: static-authored dynamics still use the static
  domains/batches projected from their static source scope.

Acceptance criteria:

- `VisualTextureDomain` can represent a runtime object-material domain while `StaticDomain` remains
  unchanged.
- Runtime-spawn presentation policy no longer maps runtime spawns through `outdoor-detail`,
  `landblock-env-cells`, or any other static resolver/work domain.
- Texture packing and binding treat the runtime visual texture domain as an object-material domain,
  not terrain and not static resolver work.
- Static-authored dynamic texture policy remains unchanged and continues to use static-derived
  domains and static-source batch ids.

Task checklist:

- [x] Change `VisualTextureDomain` so runtime visual domains do not pollute `StaticDomain`.
- [x] Add the runtime object-material visual texture domain.
- [x] Change runtime-spawn presentation policy to use the runtime visual texture domain.
- [x] Include the runtime visual texture domain in object-material packing/role-page behavior and
      diagnostics.
- [x] Add texture-manager and dynamic-controller coverage for runtime texture-domain projection and
      static-authored domain stability.
- [x] Run focused TypeScript verification for texture-manager and dynamic-controller tests.

Risks and mitigations:

- Risk: the runtime domain leaks into static resolver or static bake contracts.
  Mitigation: make the new value part of `VisualTextureDomain` only, and keep static demand/work
  APIs typed as `StaticDomain`.
- Risk: runtime domain is only renamed policy while packing still assumes the old static domain set.
  Mitigation: add texture-manager coverage around placement, binding, diagnostics, and independent
  role-page packing for the runtime visual domain.

Dry-run findings:

- 2026-06-28 dry run: `VisualTextureDomain` is currently a direct alias of `StaticDomain`, so adding
  a runtime value to `StaticDomain` would blur static resolver/work policy with runtime visual
  policy.
- 2026-06-28 dry run: texture role-page routing already sends every non-terrain domain through
  object-material role pages, but independent role-page packing hard-codes static domains and must
  include the runtime visual domain.
- 2026-06-28 steering: static-authored dynamics should keep static domain/batching/ownership
  policy. Only runtime-authored dynamic visuals get the runtime visual texture domain.

Decisions and course corrections:

- 2026-06-28 implementation: Added the runtime visual texture domain as
  `runtime-object-material` under `VisualTextureDomain` only. `StaticDomain` remains unchanged, so
  static resolver/work contracts cannot accidentally request runtime visual work.
- 2026-06-28 implementation: Runtime-spawn presentation policy now always uses
  `runtime-object-material` for texture placement. Outdoor/env-cell residence still describes where
  the entity exists; it no longer selects `outdoor-detail` or `landblock-env-cells` as a fake
  texture provenance.
- 2026-06-28 implementation: Texture manager now treats `runtime-object-material` as an
  object-material domain for independent role-page packing and binding. The texture diagnostics
  report now exposes per-batch domain facts so runtime-domain placement can be inspected rather than
  hidden behind aggregate summary counts.
- 2026-06-28 spicy bit: This phase only fixes texture-domain policy. Runtime spawns are still
  pending/non-renderable until Phase 12C.2B tracks projected visual resources, Phase 12C.2C lifts
  material planning to neutral visual identities, and Phase 12C.2D uses that path for runtime
  readiness.

Verification:

- 2026-06-28: `npm run test:ts -- dynamic-entity-controller`
- 2026-06-28: `npm run test:ts -- texture-manager`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run lint`
- 2026-06-28: `npm run build` passed with Vite's existing chunk-size warning.

### Phase 12C.2B: Projected Dynamic Resource Tracking

Status: completed 2026-06-28.

Purpose:

- Make `DynamicEntityResourceManager` consume projected presentation facts instead of static seed
  facts, and let runtime spawns enter resource tracking without fabricating static source scopes,
  static object identities, or static draw units.

Deliverables:

- Add a projected resource tracking input based on `DynamicVisualSource` and
  `DynamicEntityPresentation`. Phase 12C.2B.1 later replaced indexed
  `DynamicEntityRecord["presentation"]` helper shapes with named dynamic contract types.
- Refactor static-authored dynamic tracking to enter resource readiness through the same projected
  input after static seed projection has run. Static-authored dynamics may still use the existing
  static-material identity path internally until Phase 12C.2C lifts material identities.
- Add a runtime-spawn tracking path from create/update/remove that can request setup/animation
  resources without a static seed. Runtime visual resource readiness should stop before material
  planning while `materialPlanningIdentity` is still `pending`.
- Preserve an explicit pending/non-renderable stop when runtime material planning identity is still
  `pending`; log the blocker to the console and do not create durable warning/failure records or a
  broad pending-material subsystem for that unsupported runtime path.
- Keep `setup-default` animation from silently becoming animation id `0`. Runtime spawns must use an
  explicit animation in this phase unless proven setup-default evidence is added before
  implementation. If the evidence is not present, `setup-default` is logged/rejected for resource
  tracking rather than converted to animation id `0`.

Acceptance criteria:

- Static-authored and runtime-authored dynamic records enter resource tracking through the projected
  presentation source/policy shape.
- Runtime spawns can request setup/animation resources without static seed records or source-scope
  facts.
- Runtime spawns with explicit animation can request setup/animation resources through projected
  visual source facts.
- Runtime spawns with `setup-default` animation do not request animation id `0`; they remain
  pending/non-renderable with a console log unless setup-default evidence has been proven.
- Runtime `setup-default` initial resource state does not expose `animationKey: { kind:
"animation", id: 0 }` as if animation `0` were a valid asset. The state must either represent
  unresolved setup-default animation explicitly or avoid presenting an animation key until a real
  animation id is known.
- Runtime spawns with pending material identity remain non-renderable with a console log rather than
  flowing into `StaticObjectInstanceIdentity` or `static-material-slot` material planning.
- Runtime `setup-default` animation is explicitly rejected/logged for renderable readiness unless
  this phase proves the default animation from prepared source facts.
- Existing static-authored dynamic resource readiness remains stable.

Task checklist:

- [x] Add a resource-manager entry point that accepts projected dynamic visual source/policy.
- [x] Refactor static-authored dynamic resource tracking to use the projected entry point.
- [x] Wire runtime create/update/remove into projected resource tracking and release.
- [x] Keep static-authored visual readiness on the existing material path until Phase 12C.2C lifts
      material identities.
- [x] Add explicit pending/logging behavior for runtime material planning identities that are still
      unsupported, without adding durable warning/failure records or a pending-material diary.
- [x] Add explicit-animation coverage and setup-default rejection coverage. Only replace rejection
      with setup-default evidence coverage if implementation proves a real prepared-source default.
- [x] Remove the runtime `setup-default` initial-state animation id `0` leak by representing
      unresolved setup-default animation honestly.
- [x] Add focused runtime-spawn tracking tests proving no static seed/source-scope/object identity is
      required.
- [x] Run focused TypeScript verification for dynamic resource-manager/controller tests.

Risks and mitigations:

- Risk: the neutral visual source boundary lands too low and becomes a pile of per-call adapters.
  Mitigation: make `DynamicEntityResourceManager` consume the projected visual source/policy shape
  directly.
- Risk: this phase accidentally implements renderer visibility.
  Mitigation: keep output limited to resource state changes; renderer/query/selection remains
  Phase 12C.3.
- Risk: runtime pending becomes a durable diagnostic diary.
  Mitigation: log unsupported runtime facts when encountered, update current resource/renderability
  state, and avoid persistent warning/error records for unsupported runtime facts.
- Risk: this phase builds a temporary material-readiness subsystem that Phase 12C.2C/12C.2D
  immediately deletes.
  Mitigation: stop runtime visual readiness at the pending material identity boundary; only
  static-authored visuals continue through the existing material path until the neutral material lift
  and runtime readiness phase.
- Risk: exported presentation helper types are added only to satisfy tests.
  Mitigation: keep named dynamic contract types only when shared production code needs them, and let
  `knip` catch ceremonial exports.

Dry-run findings:

- 2026-06-28 dry run: runtime spawns currently receive an initial pending resource state but do not
  call `DynamicEntityResourceManager.trackSetupAnimationResources()`, so they cannot become ready
  until a projected runtime tracking path exists.
- 2026-06-28 dry run: `TrackedDynamicEntityResources` stores `StaticAuthoredDynamicSeedFacts`, and
  setup/visual resource requests read directly from that seed. This is the main resource tracking
  shape to replace.
- 2026-06-28 dry run: `DynamicEntitySummaryDto` is part of the projected policy cleanup because
  renderer/runtime consumers use summaries. The projected policy must stay available on summaries so
  consumers do not fall back to provenance.
- 2026-06-28 steering: Phase 12C.2B should not try to solve neutral material identity. Runtime
  visual readiness stops at `materialPlanningIdentity: pending` with a console log; Phase 12C.2C
  owns neutral material identity and Phase 12C.2D owns runtime use of that lifted path.
- 2026-06-28 steering: Runtime `setup-default` must not silently request animation id `0`. Unless
  setup-default evidence is proven during implementation, runtime resource tracking is
  explicit-animation-only.
- 2026-06-28 dry run: runtime `setup-default` also leaks animation id `0` through initial
  `resources.setupAnimation.animationKey`, even before resource tracking starts. Phase 12C.2B should
  fix the state shape or initialization path so unresolved setup-default animation is not presented
  as a real animation asset.

Decisions and course corrections:

- 2026-06-28 implementation: Replaced the static-seed resource-manager entry point with
  `trackProjectedVisualResources(entityId, presentation)`. The tracked state now stores projected
  presentation facts instead of `StaticAuthoredDynamicSeedFacts`.
- 2026-06-28 implementation: Static-authored dynamics now enter resource tracking through projected
  presentation policy/source facts, while still using the existing static material-planning identity
  internally. The full neutral material identity lift remains Phase 12C.2C.
- 2026-06-28 implementation: Runtime spawns with explicit animation now request setup-model and
  animation assets, acquire/release leases, and stop before visual material planning while
  `materialPlanningIdentity` is pending. The stop is console-owned and does not create durable
  warning/failure records.
- 2026-06-28 implementation: Runtime `setup-default` no longer exposes `animationKey` id `0` in
  initial resource state and does not request animation `0`. It remains pending with
  `setup-default-animation-unresolved` until setup-default evidence is proven later.
- 2026-06-28 debt: `DynamicEntityRecord.animation.defaultAnimationId` still uses numeric `0` for
  runtime `setup-default` records because the broader animation state shape requires a concrete
  number. Resource tracking no longer presents or requests animation `0`; clean up the remaining
  summary/animation-state placeholder when setup-default evidence is lifted into a neutral
  animation-selection model.
- 2026-06-28 spicy bit: Runtime explicit-animation spawns can now reach
  `setup-animation-ready`, but still cannot become renderable. Phase 12C.2C must lift material
  planning to neutral visual identities and Phase 12C.2D must apply that path to runtime visuals
  before they can prepare material/gfx/texture resources.

Verification:

- 2026-06-28: `npm run test:ts -- dynamic-entity-resource-manager`
- 2026-06-28: `npm run test:ts -- dynamic-entity-controller`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run lint`
- 2026-06-28: `npm run build` passed with Vite's existing chunk-size warning.

### Phase 12C.2B.1: Name Dynamic Record Component Types

Status: completed on 2026-06-28.

Purpose:

- Remove the growing `DynamicEntityRecord["..."]` indexed-access pattern from dynamic package
  boundaries before the neutral material lift in Phase 12C.2C.
- Make projected dynamic concepts visible as named contract types so helpers consume the domain
  shape they actually need instead of coupling to `DynamicEntityRecord` storage layout.

Completed:

- Exported named dynamic component types for cross-module concepts, including presentation, visual
  source, residence, source facts, animation state/playback, bounds state/index membership,
  setup-animation resource state, renderability, summary source, and summary playback/setup
  resource shapes.
- Replaced dynamic package uses of `DynamicEntityRecord["..."]`,
  `DynamicEntitySummaryDto["..."]`, `DynamicEntityResourceState["..."]`, and
  `DynamicPresentationPolicy["..."]` with named contract types where the referenced shape is a
  dynamic domain concept.
- Kept private leaf types private when no module imports them. `knip` is the guardrail here:
  exported names should be real package API, not ceremony.
- Left external DTO element extraction alone where it names host/static payload internals rather
  than dynamic record concepts, such as `AnimationPayloadDto["partFrames"][number]` and static
  source part array element types.

Debt and spicy bits:

- `DynamicEntityTransformState` still derives placement/scale types from static-authored seed fact
  types because `StaticPlacementTransform` is not exported from static contracts. That is less bad
  than record indexing, but it still hints that dynamic placement inputs need a more neutral
  contract if runtime/server spawns stop being shaped like static seeds.
- `DynamicEntityRecord.animation.defaultAnimationId` still carries the broader `setup-default`
  placeholder debt called out in Phase 12C.2B.

Verification:

- 2026-06-28: `npm run check`
- 2026-06-28: `npm run test:ts -- dynamic-entity-resource-manager dynamic-entity-controller dynamic-entity-store dynamic-placement-tracker dynamic-animation-player`
- 2026-06-28: `npm run lint`

### Phase 12C.2C: Neutral Dynamic Visual Material Identities

Status: completed on 2026-06-28.

Purpose:

- Introduce neutral dynamic visual material identities and move static-authored dynamics onto them
  first. Static-authored dynamics are the equivalence oracle for the identity lift; runtime spawn
  readiness is intentionally deferred to Phase 12C.2D so this phase does not mix identity semantics
  with new runtime-source behavior.

Deliverables:

- Introduce neutral visual object, part, and material-slot identities that describe what
  object-material planning actually needs.
- Refactor `createDynamicMaterialSlotRequirements()` and adjacent material-slot requirement code so
  static-authored dynamic visuals project source assets into neutral material slot facts without
  fabricating or depending on `StaticObjectInstanceIdentity` / `static-material-slot` identities.
- Reuse the existing setup appearance, gfx, material, palette, render-surface, texture requirement,
  prepared-texture, atlas, and renderer-material behavior after neutral projection.
- Keep current dynamic material coverage intact for static-authored dynamics, including palette,
  render-surface, texture requirement, texture atlas, and skipped-material behavior.
- Add explicit equivalence coverage proving static-authored dynamic material plans/render parts are
  unchanged after the identity lift.
- Leave runtime-authored visuals at the current `materialPlanningIdentity: pending` stop until Phase
  12C.2D consumes the neutral identity path.

Acceptance criteria:

- Static-authored dynamic material plans and render parts remain equivalent after the identity lift,
  including palette, render-surface, texture requirement, texture atlas, and skipped-material
  behavior.
- Static-authored dynamic visual readiness no longer calls material planning through fabricated
  `StaticObjectInstanceIdentity` or `static-material-slot` identities.
- The neutral identities describe material source, visual object/part/slot identity, palette
  overrides, render-surface ids, and texture-use ownership directly enough that Phase 12C.2D can add
  runtime setup-backed visuals without another identity refactor.
- Existing static-authored dynamic resource readiness remains stable.

Task checklist:

- [x] Add neutral visual object, part, and material-slot identity types.
- [x] Refactor static-authored dynamic material slot requirement generation to use neutral
      identities.
- [x] Adapt object-material planning/resource preparation so neutral dynamic material facts can reuse
      the existing material classification and texture requirement behavior.
- [x] Add static-authored dynamic equivalence coverage for material plans/render parts before and
      after the identity lift.
- [x] Run focused TypeScript verification for dynamic resource tests.
- [x] Run full app verification commands from `apps/holtburger-3d`.

Risks and mitigations:

- Risk: material planning identity becomes fake static identity with nicer names.
  Mitigation: require neutral fields to describe material source, object/part/slot identity, palette
  overrides, render-surface ids, and texture-use identity directly; static values must not be
  stuffed back into `StaticObjectInstanceIdentity`.
- Risk: the lift regresses material coverage by accidentally creating a runtime-only subset.
  Mitigation: runtime readiness is not part of this phase; static-authored material equivalence is
  the hard acceptance criterion.
- Risk: existing static-authored readiness regresses during the identity cutover.
  Mitigation: add regression coverage that static-authored dynamics project into neutral material
  identities and still produce equivalent readiness/render-part output.

Dry-run findings:

- 2026-06-28 dry run: `planStaticObjectMaterials()` is mostly material-source classification and
  detail-role composition. The static-specific pressure comes from slot identity/facts and downstream
  texture-use identity, not from the whole material classification algorithm.
- 2026-06-28 dry run: `createDynamicMaterialSlotRequirements()` requires
  `StaticObjectInstanceIdentity` and produces `static-material-slot` identities. This is the
  critical material identity target before runtime spawns can become resource-ready without lying.
- 2026-06-28 dry run: texture ownership already has `dynamic-visual-resource` lease keys, but
  prepared-asset leases are still tracked per entity. Per-entity runtime batches are acceptable for
  first readiness; shared visual-resource/atlas reuse remains follow-up debt unless this phase stays
  small enough to include it.
- 2026-06-28 dry run: merged dynamic query/selection already works by dynamic entity id and bounds.
  Phase 12C.3 should mainly depend on 12C.2D making runtime setup-backed spawns resource-ready,
  animated, and indexed through the lifted material path; it should not require a new query
  architecture.
- 2026-06-28 steering: do not introduce a reduced "first cut" runtime material path. We already have
  broad material behavior for setup-backed dynamics. Phase 12C.2C should neutralize identity with
  static-authored equivalence as the oracle; Phase 12C.2D should add runtime readiness through that
  same path rather than gate features we effectively get from the existing path.

Decisions and course corrections:

- 2026-06-28 implementation: Added neutral dynamic visual object, part, and material-slot identity
  types. Static-authored dynamic material planning identity now points at a
  `dynamic-visual-object` instead of carrying `StaticObjectInstanceIdentity`.
- 2026-06-28 implementation: Replaced dynamic material slot projection with dynamic visual
  material-slot identities. Static-authored visual readiness no longer creates
  `static-material-slot` identities or passes `StaticObjectInstanceIdentity` into dynamic material
  slot requirement generation.
- 2026-06-28 implementation: Narrowed `planStaticObjectMaterials()` input to
  `StaticMaterialPlanningSlotFacts`, the minimal facts the classifier actually consumes:
  material identity, palette override, and palette views. Static object scope slots remain
  structurally compatible, and dynamic slots can now enter without static object identity.
- 2026-06-28 implementation: Added regression coverage that resource-ready static-authored dynamic
  visuals expose `dynamic-visual-material-slot` identities while preserving render parts and texture
  requirements.
- 2026-06-28 spicy bit: `createDynamicMaterialPlanningDomain()` still returns the existing static
  object-material planning domains. That is acceptable for static-authored equivalence, but Phase
  12C.2D must decide how supported runtime setup-backed visuals map domain/batch policy without
  reintroducing fake static provenance.
- 2026-06-28 debt: dynamic placement tests still use `StaticObjectInstanceIdentity` fixtures for
  static-authored source records. That is outside the material planning path, but it remains part of
  the broader static-shaped fixture surface. Phase 12C.2E owns deciding whether to replace these
  with source-neutral dynamic fixture builders before first rendering.

Verification:

- 2026-06-28: `npm run test:ts -- dynamic-entity-resource-manager dynamic-entity-controller`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run check`
- 2026-06-28: `npm run lint`
- 2026-06-28: `npm run build` passed with Vite's existing chunk-size warning.

### Phase 12C.2D: Runtime Spawn Material Readiness

Status: completed on 2026-06-28.

Purpose:

- Use the neutral visual material identities from Phase 12C.2C to let explicit-animation,
  setup-backed runtime spawns proceed through the same setup/gfx/material/palette/render-surface,
  texture, atlas, and renderer-material resource path as static-authored dynamics.

Deliverables:

- Replace the current runtime `materialPlanningIdentity: pending` stop with a neutral runtime visual
  material identity when the runtime spawn supplies setup-backed visual source facts.
- Scope supported runtime readiness to setup-model-sourced visuals: `modelData: null`, explicit
  animation, residence, setup model id, and source closure derived from `DynamicVisualSource`
  `sourceAssetIds` / `setupModelId`. Broader server composition facts are not inputs to this phase.
- Reuse the existing material classification, texture requirement, prepared-texture, atlas, and
  renderer-material behavior through the neutral facts introduced in Phase 12C.2C. Do not add a
  reduced runtime-only material subset.
- Keep runtime `textureBatchId` per entity, such as `dynamic:<entity-id>`, unless implementation
  proves a cleaner shared ownership node without broadening the phase. Shared atlas/cache reuse
  remains Phase 12C.2E/12C.4 debt.
- Keep explicit animation as the renderable runtime path unless setup-default animation evidence is
  proven from prepared source facts during this phase.
- Keep unsupported server composition facts outside the setup-backed visual path separate:
  equipment/clothing layering, object-description overlays, and unsupported `ModelData` variants
  should log/skip or reject according to validation until their semantics are proven.
- Keep one resource-ready runtime-spawn fixture ready for Phase 12C.3 rendering, but do not treat
  that fixture as the boundary of material support.

Acceptance criteria:

- Runtime-authored setup-backed spawns can become resource-ready through the same setup/gfx/material
  closure, material planning, texture requirement, prepared-texture, and renderer-material behavior
  already used by static-authored dynamics.
- Runtime readiness is proven from setup-model source closure facts, not from equipment/clothing,
  object-description overlays, or unsupported `ModelData` variants.
- Resource-ready runtime spawns use both the runtime visual texture domain from 12C.2A and the
  neutral material planning identity from 12C.2C.
- Runtime-spawn visual readiness does not call material planning through fabricated
  `StaticObjectInstanceIdentity` or `static-material-slot` identities.
- Unsupported server composition facts outside the lifted setup-backed material path are logged and
  skipped or rejected according to validation; they do not create durable warning/error records.
- Existing static-authored dynamic resource readiness remains stable.

Task checklist:

- [x] Project runtime setup-backed visual source facts into the neutral material identities from
      Phase 12C.2C.
- [x] Remove the runtime `materialPlanningIdentity: pending` stop for supported setup-backed visual
      sources.
- [x] Keep runtime readiness setup-model sourced by deriving the visual source closure from
      `DynamicVisualSource.sourceAssetIds` / `setupModelId`.
- [x] Add runtime-authored setup-backed readiness coverage across the existing supported material
      feature set represented by current dynamic material tests.
- [x] Add bounded runtime `ModelData` handling only where it is already part of setup-backed visual
      source facts; log/skip or reject unsupported server composition facts.
- [x] Add focused runtime-spawn resource-readiness tests using the lifted material path.
- [x] Run focused TypeScript verification for dynamic resource tests.
- [x] Run full app verification commands from `apps/holtburger-3d`.

Risks and mitigations:

- Risk: runtime readiness becomes a second dynamic material pipeline.
  Mitigation: runtime visuals must enter through the neutral identities from Phase 12C.2C and reuse
  the same material planning/preparation functions as static-authored dynamics.
- Risk: runtime material readiness expands into server composition semantics.
  Mitigation: support only setup-model-sourced visuals with `modelData: null` and explicit animation
  in this phase; unsupported server composition facts stay logged/skipped/rejected according to
  validation and remain Phase 12C.4 work.
- Risk: runtime texture batching turns into a shared ownership rewrite.
  Mitigation: keep per-entity runtime texture batches acceptable for 12C.2D and push shared
  atlas/cache reuse decisions to Phase 12C.2E/12C.4 unless a narrow ownership node falls out
  naturally.
- Risk: setup-default animation sneaks back in as animation id `0`.
  Mitigation: keep explicit animation as the only renderable runtime path unless setup-default
  evidence is proven from source facts; unresolved setup-default remains pending and logs only.
- Risk: first rendering gets delayed by server object composition work that is not part of the
  existing setup-backed material path.
  Mitigation: lift the existing setup-backed material path wholesale; broader server composition
  semantics outside that path remain Phase 12C.4 work.

Decisions and course corrections:

- 2026-06-28 implementation: Runtime setup-backed spawns now project `materialPlanningIdentity` to
  `setup-backed-visual` with a `dynamic-visual-object`, matching the neutral identity path used by
  static-authored dynamics after Phase 12C.2C.
- 2026-06-28 implementation: Runtime visual readiness now derives source closure from
  `DynamicVisualSource.sourceAssetIds` / `setupModelId` and reuses the existing setup appearance,
  gfx, material, palette, render-surface, prepared-texture, texture requirement, and dynamic render
  part preparation path. No runtime-only reduced material path was added.
- 2026-06-28 implementation: Explicit-animation runtime spawns can now become resource-ready and
  renderable at the resource/renderability layer while preserving `runtime-object-material` texture
  domain and per-entity `dynamic:<entity-id>` texture batch ids.
- 2026-06-28 implementation: Runtime `setup-default` still does not request animation `0`; it
  remains pending with `setup-default-animation-unresolved`.
- 2026-06-28 implementation: Added runtime readiness coverage for outdoor and env-cell residence,
  plus explicit removal coverage proving runtime visual-resource leases release after readiness.
- 2026-06-28 spicy bit: Runtime outdoor material planning currently maps to the existing
  `outdoor-detail` material planning domain while texture placement remains
  `runtime-object-material`, and runtime env-cell material planning maps to `landblock-env-cells`.
  That is too static-shaped for runtime-authored resources even though the code path is otherwise
  neutral. Phase 12C.2D.1 must give runtime-authored dynamics separate resource/material planning
  buckets before first rendering.
- 2026-06-28 debt: Runtime texture batches remain per entity. That is correctness-first for 12C.2D;
  Phase 12C.2E/12C.4 still own shared atlas/cache reuse decisions.

Verification:

- 2026-06-28: `npm run check`
- 2026-06-28: `npm run test:ts -- dynamic-entity-resource-manager dynamic-entity-controller`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run lint`
- 2026-06-28: `npm run build` passed with Vite's existing chunk-size warning.

### Phase 12C.2D.1: Runtime-Authored Dynamic Resource Domains

Status: completed on 2026-06-28.

Purpose:

- Give runtime-authored dynamic resources their own material planning, atlas/texture, ownership, and
  diagnostic buckets while preserving the shared/isomorphic setup-backed resource preparation code
  path introduced by Phases 12C.2C/12C.2D.

Deliverables:

- Introduce an explicit runtime-authored dynamic resource/material planning domain instead of mapping
  runtime outdoor visuals to `outdoor-detail` and runtime env-cell visuals to
  `landblock-env-cells`.
- Use these runtime-authored buckets for setup-backed runtime visuals unless later ACE/client
  evidence proves a more specific runtime subdivision:
  - Resource family: `runtime-authored-dynamic-object-material`.
  - Material planning domain: `runtime-authored-dynamic-object-material`.
  - Texture/atlas domain: `runtime-object-material`.
  - Texture batch id: `runtime-dynamic:<dynamic-entity-id>`; `dynamic:<dynamic-entity-id>` may be
    accepted as a temporary rename bridge only if it is immediately recorded as cleanup debt.
  - Ownership node: `dynamic-visual-resource:<dynamic-entity-id>`.
  - Material detail-role policy: `runtime-authored-none` for setup-backed visuals.
  - Diagnostics bucket: `runtime-authored-dynamic`.
- Split material planning policy from static residence and static texture placement vocabulary.
  Residence should continue to describe where the entity renders and which landblock source closure
  is relevant; it must not select static material planning ownership for runtime-authored visuals.
- Keep static-authored dynamics on their real static domains/batches/ownership, and keep
  runtime-authored dynamics on runtime domains/batches/ownership.
- Reuse the same material classification, texture requirement, prepared-texture, atlas placement,
  renderer-material, and render-part creation functions over neutral inputs. Do not fork a runtime
  material mini-pipeline.
- Decide whether runtime-authored material detail-role composition is explicitly `none` for
  setup-backed visuals or represented by a runtime-specific detail-role policy. Do not borrow
  `outdoor-detail`, `outdoor-buildings`, or `landblock-env-cells` as a runtime material planning
  bucket.
- Add diagnostics/tests proving runtime-authored outdoor and env-cell spawns use runtime-authored
  resource/material buckets while static-authored outdoor/env-cell dynamics keep their existing
  static buckets.

Acceptance criteria:

- Runtime-authored dynamic visual readiness no longer passes `outdoor-detail`,
  `outdoor-buildings`, or `landblock-env-cells` as its material planning domain.
- Runtime-authored outdoor and env-cell spawns share the same runtime-authored dynamic material
  planning bucket unless future evidence proves a runtime-specific subdivision.
- Runtime-authored texture/atlas commits remain in the runtime object-material texture domain and do
  not reuse static source-scope batch identity.
- Runtime-authored detail-role policy is explicit and does not borrow static building/environment
  detail overlays.
- Runtime-authored diagnostics identify the runtime-authored dynamic bucket separately from
  static-authored dynamic diagnostics; server GUID remains metadata only.
- Static-authored dynamic material readiness remains equivalent to the Phase 12C.2C/12C.2D baseline.
- The code path remains shared/isomorphic: static-authored and runtime-authored setup-backed visuals
  call the same planner/prep/render-part functions with different policy/domain inputs.

Task checklist:

- [x] Add a runtime-authored dynamic material planning domain/policy shape.
- [x] Add or rename runtime bucket constants/contract fields to expose
      `runtime-authored-dynamic-object-material`, `runtime-object-material`,
      `runtime-dynamic:<dynamic-entity-id>`, `runtime-authored-none`, and
      `runtime-authored-dynamic` where relevant.
- [x] Refactor `createDynamicMaterialPlanningDomain()` or replace it with a policy helper that cannot
      return static domains for runtime-authored visuals.
- [x] Keep runtime authored texture/atlas batch identity separate from static source-scope batch
      identity.
- [x] Add runtime outdoor/env-cell assertions proving material planning/resource diagnostics use the
      runtime-authored domain/bucket.
- [x] Add static-authored regression assertions proving existing static domains still flow for real
      static-authored dynamics.
- [x] Run focused dynamic resource/controller tests.
- [x] Run full app verification commands from `apps/holtburger-3d`.

Risks and mitigations:

- Risk: separating domains causes a duplicated runtime material pipeline.
  Mitigation: separate policy/domain values only; keep the material planner, texture requirement,
  prepared asset, and render-part code paths shared over neutral input facts.
- Risk: runtime domain becomes a fake static domain with a nicer string.
  Mitigation: runtime-authored domain names must describe runtime ownership/planning, not static
  residence/provenance. Outdoor/env-cell residence remains placement/source-context only.
- Risk: runtime material detail roles regress material output.
  Mitigation: use explicit no-detail-role policy for setup-backed runtime visuals unless source
  evidence provides a real runtime detail role. Treat borrowed static detail roles as a bug.
- Risk: bucket names proliferate without semantics.
  Mitigation: each bucket name maps to one concern only: resource family, material planning,
  texture/atlas placement, texture batch identity, ownership node, detail-role policy, or
  diagnostics. Do not reuse one bucket string as a generic "runtime" label everywhere.

Decisions and course corrections:

- 2026-06-28 implementation: Added runtime-authored dynamic bucket policy fields to projected
  dynamic presentation: resource family, material planning domain, material detail-role policy, and
  diagnostics bucket.
- 2026-06-28 implementation: Runtime setup-backed visuals now use
  `runtime-authored-dynamic-object-material` for resource family and material planning domain,
  `runtime-authored-none` for material detail-role policy, `runtime-authored-dynamic` for
  diagnostics, `runtime-object-material` for texture/atlas domain, and
  `runtime-dynamic:<dynamic-entity-id>` for texture batch id.
- 2026-06-28 implementation: `planStaticObjectMaterials()` now accepts
  `runtime-authored-dynamic-object-material` as a material planning domain, and detail-role
  composition treats that domain as explicit no-static-detail-role policy.
- 2026-06-28 implementation: Static-authored dynamics keep static resource family,
  material-planning domains, static-domain detail-role policy, static texture domains, and static
  source-scope texture batch ids.
- 2026-06-28 implementation: Runtime outdoor and env-cell resource-readiness coverage now proves
  both residences use the runtime-authored material/resource buckets while keeping residence as
  source-closure/placement context only.
- 2026-06-28 implementation cleanup: The texture manager no longer uses a generic
  `staticBatchId` compatibility sniff when adapting visual texture commits. Static bake texture
  uses and dynamic texture uses now enter through separate explicit adapters before becoming the
  normalized `domain` plus `textureBatchId` texture-manager shape.

Verification:

- 2026-06-28: `npm run check`
- 2026-06-28: `npm run test:ts -- dynamic-entity-resource-manager dynamic-entity-controller texture-manager`
- 2026-06-28: `npm run test:ts`
- 2026-06-28: `npm run lint`
- 2026-06-28: `npm run build` passed with Vite's existing chunk-size warning.
- 2026-06-28 cleanup: `npm run check`
- 2026-06-28 cleanup:
  `npm run test:ts -- texture-manager dynamic-entity-resource-manager dynamic-entity-controller`
- 2026-06-28 cleanup: `npm run lint`

### Phase 12C.2E: Dynamic Visual Ownership, Atlas Churn, And Fixture Neutrality Checkpoint

Status: completed on 2026-06-28.

Purpose:

- Decide whether runtime visual-resource ownership, prepared-asset leases, atlas placement, and
  static-shaped dynamic test fixtures need dedicated cleanup before first rendering, or whether
  specific leftovers remain acceptable debt for 12C.

Deliverables:

- Add or extend dynamic visual-resource ownership/refcount coverage proving create/remove churn does
  not leak prepared-asset leases or texture owners for runtime resource-ready entities.
- Confirm removing one dynamic entity releases only its dynamic visual-resource ownership.
- If runtime visual resources or atlas entries are still per-entity, document duplicate atlas/cache
  placement as follow-up debt rather than building a broad sharing graph prematurely.
- Audit dynamic placement/cadence fixture builders that still require `StaticObjectInstanceIdentity`
  for source records. Replace them with source-neutral dynamic fixture builders if they would hide
  runtime placement/index bugs during 12C.3.
- Execute this phase before 12C.3 if 12C.2D/12C.2D.1 exposes leaks, unstable ownership, atlas
  churn, runtime/static domain confusion, or static-shaped fixture assumptions that would make first
  rendering misleading.

Acceptance criteria:

- Create/remove churn for resource-ready runtime spawns does not leak prepared-asset leases,
  texture owners, renderer resources, or placement/index records.
- Placement/index tests either use source-neutral dynamic fixtures where runtime placement behavior
  is under test, or explicitly document why a static-authored fixture remains the right oracle.
- Any remaining per-entity runtime atlas/cache duplication is explicitly documented and does not
  block first rendering.

Task checklist:

- [x] Audit runtime resource-ready create/remove ownership behavior after Phase 12C.2D/12C.2D.1.
- [x] Add focused ownership/refcount tests only if existing coverage does not prove the behavior.
- [x] Audit dynamic placement/cadence fixtures that still construct `StaticObjectInstanceIdentity`
      records.
- [x] Replace static-shaped dynamic placement fixtures with source-neutral builders where they would
      mask runtime placement/index behavior.
- [x] Document duplicate atlas/cache placement as debt if it remains per-entity by design.
- [x] Decide whether 12C.3 can proceed or whether ownership cleanup is required first.

Decisions and course corrections:

- 2026-06-28 implementation: Added runtime-spawn placement removal coverage proving explicit
  runtime removal clears outdoor and env-cell dynamic index membership through
  `DynamicEntityController`.
- 2026-06-28 implementation: Added runtime-authored texture-owner release coverage proving
  `runtime-object-material` pages in `runtime-dynamic:<dynamic-entity-id>` batches are released when
  the dynamic visual-resource owner is removed.
- 2026-06-28 implementation: Converted generic dynamic placement, animation cadence, and animation
  player fixtures from static-authored source/provenance records to runtime-spawn-shaped records.
  Static-authored seed fixtures remain static where the test is actually about static seed
  projection or retention.
- 2026-06-28 concession: Runtime-authored visual resources still use per-entity runtime texture
  batches. Shared runtime atlas/cache ownership remains Phase 12C.4 debt, not a blocker for first
  rendering.
- 2026-06-28 spicy bit: Renderer-resource create/remove cleanup for browser-created runtime spawns
  is still only indirectly covered because the browser/runtime first-render spawn path does not exist
  until Phase 12C.3. Phase 12C.3 must include an end-to-end create-render-remove assertion that
  drains renderer dynamic resources, dynamic instances, texture owners, placement/index membership,
  and prepared-asset leases.
- 2026-06-28 decision: Phase 12C.3 can proceed. No ownership graph or shared runtime atlas bucket is
  required before first rendering.

Verification:

- 2026-06-28 dry run:
  `npm run test:ts -- dynamic-entity-resource-manager dynamic-placement-tracker dynamic-animation-update-cadence texture-manager client-runtime`
- 2026-06-28 implementation:
  `npm run test:ts -- dynamic-placement-tracker dynamic-animation-update-cadence dynamic-animation-player texture-manager`
- 2026-06-28 implementation: `npm run check`
- 2026-06-28 implementation:
  `npm run test:ts -- dynamic-entity-resource-manager dynamic-placement-tracker dynamic-animation-update-cadence dynamic-animation-player texture-manager client-runtime`
- 2026-06-28 implementation: `npm run lint`
- 2026-06-28 implementation: `npm run test:ts`
- 2026-06-28 implementation: `npm run build` passed with Vite's existing chunk-size warning.

### Phase 12C.3: First Runtime Spawn Rendering

Status: completed on 2026-06-29; env-cell residence correction completed on 2026-06-29.

Purpose:

- Render one setup-backed runtime-spawn fixture through the existing dynamic renderer path using
  projected policies from 12C.1, the runtime texture domain from 12C.2A, projected resource tracking
  from 12C.2B, neutral material identities from 12C.2C, lifted runtime material readiness from
  12C.2D, and separate runtime-authored resource domains from 12C.2D.1. This is the visible
  runtime-spawn
  milestone; Phase 12D should not be allowed to start while this is still theoretical.

Deliverables:

- Wire a resource-ready runtime-spawn fixture through playback, placement/index, renderer resource
  sync, renderer instance sync, merged query, browser inspection, and selected diagnostics.
- Add a programmatic runtime-spawn smoke path or test harness path that creates the fixture, renders
  it in-scene, and removes it without refreshing static scenery.
- Use the same dynamic renderer resource and instance commit APIs as static-authored dynamic records.
- Ensure picking/query results expose enough correlation metadata for the browser host to map a
  selected presentation entity back to an optional server-authored object/instance id without making
  that id renderer identity.
- Preserve static-authored dynamic behavior and query semantics.

Acceptance criteria:

- A programmatically created runtime-spawn fixture is visible in the 3D scene through existing
  dynamic renderer resource and instance commit APIs using the runtime visual texture domain
  introduced in 12C.2A.
- The fixture animates through the existing playback path when an explicit animation is provided or
  setup-default evidence was proven by 12C.2B/12C.2D/12C.2D.1.
- The fixture can be removed, and removal releases renderer instance/resource state, dynamic
  visual-resource texture ownership, placement/index membership, and prepared-asset leases.
- Bounds, effective residence, cadence scheduling, merged dynamic query hits, browser inspection,
  and selected dynamic diagnostics work for runtime spawns without static source keys.
- Picking/query results preserve local presentation id and optional server/host correlation metadata
  separately.
- Existing static-authored dynamic scenery behavior remains stable.

Task checklist:

- [x] Add the programmatic first-render runtime-spawn fixture path.
- [x] Wire the fixture through playback, placement, renderer resource/instance commits, merged
      query, and selected diagnostics.
- [x] Add focused runtime-spawn first-render, removal, renderer/query/selection tests.
- [x] Add regression coverage proving static-authored dynamic renderer/query behavior remains
      stable.
- [x] Run focused TypeScript verification for dynamic runtime/query/renderer tests.
- [x] Run full app verification commands from `apps/holtburger-3d`.

Risks and mitigations:

- Risk: runtime spawns introduce a second dynamic renderer/query pipeline.
  Mitigation: after source projection and readiness, reuse the existing dynamic resource manager,
  placement tracker, renderer dynamic commits, cadence policy, merged query family, and selected
  diagnostics.
- Risk: renderer APIs drift toward ACE server create/update/delete semantics.
  Mitigation: keep this phase scoped to presentation records. Server object authority, sequence,
  containment, equipment, inventory, replacement, prediction, and cancellation semantics remain host
  runtime concerns that project visual facts into the browser renderer.
- Risk: first rendering becomes blocked by broad runtime object composition.
  Mitigation: 12C.2D lifts the existing setup-backed runtime material path wholesale, and 12C.2D.1
  separates runtime-authored resource domains from static domains; broader server composition
  semantics outside that path move to Phase 12C.4.

Decisions and course corrections:

- 2026-06-29 implementation: Used ACE-backed WCID 1 (`W_HUMAN_CLASS` / `HUMAN`) as the first
  runtime-spawn fixture, projected to `SetupConst.HumanMale` (`0x02000001`). The app-local fixture
  lives in `apps/holtburger-3d/src/lib/runtime/runtime-spawn-fixtures.ts`.
- 2026-06-29 implementation: Added explicit `animationSelection: none` for runtime spawns that
  should render from setup/default part placements without pretending setup-default animation
  evidence exists. `setup-default` remains an unresolved-authored-animation state until a later
  phase proves setup-default animation selection from source/server facts.
- 2026-06-29 implementation: Removed the old renderer/query assumption that dynamic records must
  have `animation.playback.status === "playing"` before they can be submitted or indexed. Ready
  visuals now submit and index from setup default part placements when no animation is selected.
- 2026-06-29 implementation: Added app-local runtime methods for programmatic create/remove of
  runtime spawns. These stay inside `apps/holtburger-3d`; no browser UX or shared-crate server
  authority model was introduced.

Verification:

- 2026-06-29: `npm run test:ts -- client-runtime`
- 2026-06-29: `npm run test:ts -- client-runtime dynamic-entity-resource-manager dynamic-entity-controller dynamic-placement-tracker`
- 2026-06-29: `npm run check`
- 2026-06-29: `npm run test:ts`
- 2026-06-29: `npm run lint:ts`
- 2026-06-29: `npm run lint:dead`
- 2026-06-29: `npm run build`
- 2026-06-29: `npm run lint`

### Phase 12C.4: Runtime Spawn Server Composition Breadth And Debt

Status: pending, deferred until after Phase 12D browser-spawn discovery.

Steering:

- 2026-06-29 resteer: Do not execute this as the immediate next phase after 12C.3. Phase 12C.3
  proved a renderable setup-backed runtime spawn, and Phase 12D is now the better next step because
  browser spawn UX will expose which composition facts matter first. Treat this phase as a
  post-12D breadth/debt pass driven by concrete spawn-form findings, not as an open-ended server
  object composition grab bag.

Purpose:

- Broaden runtime-spawn rendering after the first fixture renders by adding server composition
  semantics that are not part of the existing setup-backed material path. This phase pays down
  equipment/clothing/object-description/model-data/resource ownership gaps without moving the
  first-render goalpost or reducing material support.

Deliverables:

- Expand supported runtime server composition facts beyond setup-backed object materials based on
  ACE spawn evidence and browser spawn needs.
- Evaluate shared dynamic visual-resource ownership and atlas/cache reuse once per-entity runtime
  batches have proven the first-render path.
- Add broader create/update/remove churn coverage around multiple runtime spawns, shared setup
  models, repeated materials, and unsupported facts.
- Keep unsupported facts console-owned unless they represent hard validation failures for accepted
  runtime-spawn requests.

Acceptance criteria:

- At least two distinct runtime spawn shapes can render or fail explicitly based on documented
  support limits for server composition facts beyond the lifted setup-backed material path.
- Multiple runtime spawns can coexist and be removed independently without leaking renderer,
  placement, texture, or prepared-asset state.
- Any duplicated per-entity atlas/cache placement is either resolved through shared ownership or
  documented as deliberate remaining debt.
- Existing first-render fixture behavior and static-authored dynamic behavior remain stable.

Task checklist:

- [ ] Expand runtime server composition/model-data support based on the first browser-spawn targets.
- [ ] Add multi-spawn create/update/remove churn coverage.
- [ ] Decide whether to implement shared dynamic visual-resource/atlas ownership now or record it as
      cleanup debt with measured impact.
- [ ] Run focused TypeScript verification for runtime-spawn breadth tests.
- [ ] Run full app verification commands from `apps/holtburger-3d`.

Risks and mitigations:

- Risk: broadening reintroduces fake static provenance to support additional cases quickly.
  Mitigation: all new runtime shapes must enter through projected presentation/resource facts and
  neutral material identities.
- Risk: broadening blocks browser UX.
  Mitigation: Phase 12D may start once 12C.3's first fixture render is stable; 12C.4 work should be
  ordered by what the browser spawn form actually needs next.

### Phase 12D: Browser Spawn Form And Fixture Resolver

Status: completed on 2026-06-29.

Steering:

- 2026-06-29 resteer: Execute this before 12C.4. The renderable WCID-backed runtime-spawn path is
  stable enough for a manual browser probe, and the spawn form/resolver should provide receipts for
  any additional runtime server composition breadth. This phase should stay app-local and should not
  opportunistically absorb 12C.4's equipment/clothing/cache-ownership debt unless the form cannot
  create/remove a basic setup-backed spawn without it.
- 2026-06-29 UX steering: Implement the spawn UX as a dedicated browser-mode `Spawns` tab, not as
  additional controls inside the already crowded debug panel. Keep the tab dense and operational:
  active runtime spawn list, WCID seed row, editable spawn form, validation/status, and explicit
  remove/select actions.
- 2026-06-29 correction: Do not gate env-cell runtime spawns out of the browser form. The runtime
  already supports env-cell dynamic residence and indexing; making env-cell residence unsupported in
  the UX adds more complexity than a residence selector and validation for the existing
  `{ kind: "env-cell", landblockId, envCellId }` shape.

Purpose:

- Give browser mode a real manual presentation-spawn workflow using the runtime source model, with
  optional WCID seed application through a resolver that does not know spawn support limits. This
  phase consumes the renderable runtime-spawn path from 12C.3; it should not introduce renderer,
  texture-domain, or material-planning architecture.

Deliverables:

- Add a dedicated browser-mode `Spawns` tab for creating and removing dynamic entities. It should
  contain one full editable spawn form with two entry paths: manual setup-backed entry and WCID seed
  application. WCID seeding must populate the same editable form instead of bypassing validation
  through a separate "spawn by WCID" shortcut.
- Inputs should resemble server spawn inputs rather than static seed facts: setup id, optional
  server-authored instance id metadata, residence/position, orientation, scale, optional
  animation/motion choice, object-description override facts, and explicit remove/replacement action.
- Add a `WeenieSpawnSeedResolver`-style component boundary consumed by the browser spawn form. The
  first implementation should be in-memory or small-catalog-backed, and must not depend on a full
  ACE world DB dump being present in the repo.
- Seed the first resolver backend with a deliberately fake-but-ACE-backed in-memory catalog. Start
  with WCID `1` / `W_HUMAN_CLASS` / `HUMAN` projected to setup `0x02000001`, and optionally one
  second checked-in setup-backed catalog row only if it proves a distinct browser-spawn behavior.
- Add spawn validation that turns form state into an accepted request or no request. Unsupported
  facts are skipped with console logs; invalid required facts reject the operation with console logs.
  The resolver returns resolved facts or no result only.
- Keep browser spawn UX minimal and app-local. The goal is proving the pipeline and giving us a real
  manual visual probe, not building a gameplay spawn editor or host-owned server operation console.

Acceptance criteria:

- Browser-mode spawn UX can add at least one setup-backed dynamic entity to the current scene and
  remove it again without refreshing the static scene, using the already-renderable 12C.3 runtime
  path.
- Browser-mode spawn UX is discoverable as its own `Spawns` tab and does not add more controls to
  the existing crowded debug panel.
- Browser-mode spawn UX can seed the same full spawn form from at least one WCID-backed resolver
  result, allow edits after seeding, and submit through the same dynamic spawn request path as manual
  input.
- WCID seed application does not create a runtime entity directly. It only resolves source facts and
  copies supported facts into the editable spawn form; the normal validation/submit path remains the
  only way to create the runtime spawn.
- The resolver contract is tested separately from spawn validation. Resolver tests assert resolved
  facts and null/no-result behavior; spawn validation tests assert accepted requests and rejected
  operations. Do not add tests whose only purpose is debug-oriented console logging.
- The browser/runtime boundary validates supported server-shaped fields, rejects invalid required
  fields, and skips unsupported fields Phase 12D does not implement without creating durable
  warning/error/failure records.
- Browser-mode pick/inspection output for manually spawned entities preserves local presentation id
  and optional server-authored metadata separately, so future host interactions can round-trip the
  server correlation id without making it renderer identity.
- Existing static-authored dynamic scenery behavior remains stable.

Task checklist:

- [x] Add a dedicated app-local browser-mode `Spawns` tab and runtime command plumbing for
      creating/removing one or more setup-backed dynamic entities.
- [x] Add an active runtime spawn list in the `Spawns` tab with remove and select/inspect affordances
      where existing runtime selection plumbing makes that practical.
- [x] Add the weenie spawn seed resolver interface and first backend, keeping resolver output
      independent from spawn support decisions.
- [x] Add the initial fake in-memory WCID resolver backend seeded with WCID `1` / setup
      `0x02000001`.
- [x] Wire WCID seed application into the same editable spawn form used for manual spawns, with no
      direct spawn shortcut.
- [x] Add validation tests for resolved/requested server-shaped fields that Phase 12D accepts,
      rejects, or skips. Do not test debug-oriented console logging.
- [x] Add browser/runtime tests for manual and WCID-seeded setup-backed spawns. Do not run the TUI
      client.
- [x] Add env-cell residence selection to the same browser spawn form and cover it in validation and
      runtime tests.
- [x] Run focused TypeScript verification for browser/runtime spawn tests.
- [x] Run full app verification commands from `apps/holtburger-3d`.

Implementation notes:

- 2026-06-29 execution: Started Phase 12D with app-local browser UX and validation boundaries. The
  resolver/validation work should stay under `apps/holtburger-3d/src/lib/browser/` because this is
  browser-mode spawn tooling, not shared runtime world semantics.
- 2026-06-29 implementation: Added `runtime-spawn-form` validation and
  `weenie-spawn-seed-resolver` under the browser module. The resolver returns source facts/null only;
  the form validator owns support decisions and emits `RuntimeDynamicSpawnRequest` only after required
  setup, outdoor residence, transform, scale, server metadata, and animation fields validate.
- 2026-06-29 implementation: Added a dedicated `Spawns` tab to `BrowserDisplay` with active
  browser-created runtime spawn rows, select/inspect/remove actions, WCID seed application into the
  same editable form, and one create path through form validation. The tab keeps its own
  browser-created spawn list instead of pretending the runtime overview is an authoritative entity
  browser.
- 2026-06-29 test coverage: Added resolver/validation tests plus a client-runtime regression proving
  manual and WCID-seeded browser form requests can coexist, render, preserve optional server metadata
  in diagnostics, and remove independently.
- 2026-06-29 spicy bit: Phase 12D initially gated env-cell spawns out of the browser form even though
  the runtime already supports env-cell dynamic residence. That gate was removed; object-description
  override facts, replacement/removal semantics beyond explicit runtime despawn, ACE-backed catalog
  lookup, and broad animation/motion-table selection remain future work rather than being silently
  accepted by the form.
- 2026-06-29 correction implementation: Added `Outdoor` / `Env cell` residence selection to the same
  spawn form. Env-cell mode validates `envCellId` and emits the existing runtime residence shape
  `{ kind: "env-cell", landblockId, envCellId }`; outdoor mode does not require or submit an env-cell
  id. Focused validation/runtime tests now cover env-cell browser spawn requests rendering and
  retaining env-cell residence in runtime snapshots.
- 2026-06-29 UX correction: Browser-created spawns are now placed one meter in front of the live
  browser camera at create time. The create path updates the editable form with the actual
  camera-derived residence/origin/yaw before validation; if no outdoor or env-cell camera residence
  is known, creation rejects instead of silently using stale default coordinates.
- 2026-06-29 bug fix: Camera-relative placement originally wrote render-local `[x, y, z]` directly
  into AC placement origin fields. Runtime placement maps AC origin to render space as
  `[origin.x, origin.z, -origin.y]`, so the browser helper now writes `[render.x, -render.z,
render.y]` and has regression coverage that converts the form fields back to the expected
  camera-forward render point.
- 2026-06-29 UX correction: Removed visible translation and yaw inputs from the spawn form. Spawn
  origin/yaw are camera-owned at create time; scale remains editable because it does not override
  camera-relative placement.
- 2026-06-29 visual finding: WCID `1` / setup `0x02000001` can render with black head/arm parts
  because the Phase 12D fixture only supplies a setup id. ACE calculates creature/player appearance
  through ObjDesc/model-data facts (`AddBaseModelData`, palette/subpalette changes, texture changes,
  and anim-part changes) and sends those facts in creation/model-update data. The current runtime
  spawn source hardcodes `modelData: null`, so the browser path requests only the base
  `setup-appearance/02000001` instead of a WCID/player appearance variant. Do not fix this with a
  renderer color fallback; Phase 12E must thread source appearance facts through the resolver/runtime
  path.
- 2026-06-29 verification: `npm run check`, `npm run test:ts`, `npm run lint`,
  `npm run check:rust`, Prettier check on touched files, and `npm run build` passed from
  `apps/holtburger-3d`. `npm run build` still reports the main bundle larger than 500 kB; Phase 12D
  did not address bundle code splitting.

Risks and mitigations:

- Risk: the weenie resolver learns Phase 12D support limits and becomes a browser-spawn-specific
  filter instead of a reusable source resolver.
  Mitigation: keep the resolver contract source/resolution-oriented. It returns resolved facts or no
  result only; the browser form, spawn adapter, or runtime validation owns accepted, skipped, and
  rejected decisions while warnings/errors stay console-owned.
- Risk: explicit destruction leaks leases or renderer state.
  Mitigation: make removal acceptance tests cover resource leases, spatial membership, renderer
  resources, renderer instances, and scheduler state together.

### Phase 12E: ACE Weenie Catalog Resolver Backing

Status: pending.

Steering:

- 2026-06-29 resteer: Use an optional Tauri-side ACE world SQL resolver as the first real backing.
  The browser must not connect to SQL directly or learn ACE table names. Tauri reads
  `ACE_WORLD_SQL_URL` from the environment, exposes a lookup capability/status to the frontend, and
  resolves WCID requests through a typed command. If the URL is absent or invalid, WCID lookup is
  disabled and the `Spawns` tab keeps manual setup entry available.
- 2026-06-29 resolver steering: Reuse the existing app-local `WeenieSpawnSeedResolver` boundary from
  Phase 12D. Phase 12E should widen the resolved seed facts and add a Tauri-backed implementation; it
  must not add a parallel WCID lookup path in `BrowserDisplay` or make the spawn form understand SQL
  capability, property ids, or ACE table names.
- 2026-06-29 investigation: A local ACE world DB at `ace_world` had `43,913` weenie rows. The direct
  visual projection is tractable, but explicit palette/texture/anim-part weenie override rows are
  sparse (`12` WCIDs with palette rows, `11` with texture rows, `11` with anim-part rows). WCID `1`
  proves setup/motion/sound/combat/physics/icon lookup but is not a good first appearance-override
  fixture because its human appearance is character-generation/base-model derived. WCID `42810`
  (`ace42810-xiaohongthebarkeeper`) is a better first override fixture because it has setup, motion,
  sound, palette, texture-map, and anim-part rows.

SQL projection map:

- `weenie`
  - `class_Id` -> `weenieClassId`
  - `class_Name` -> source class/catalog name
  - `type` -> ACE `WeenieType`
- `weenie_properties_string`
  - `type = 1` / `PropertyString.Name` -> display label when present
  - `type = 5` / `PropertyString.LongDesc` -> optional descriptive label/diagnostic text
- `weenie_properties_d_i_d`
  - `type = 1` / `PropertyDataId.Setup` -> setup model id
  - `type = 2` / `PropertyDataId.MotionTable` -> motion table id
  - `type = 3` / `PropertyDataId.SoundTable` -> sound table id
  - `type = 4` / `PropertyDataId.CombatTable` -> combat table id
  - `type = 6` / `PropertyDataId.PaletteBase` -> base palette id
  - `type = 7` / `PropertyDataId.ClothingBase` -> clothing table id, retained as source fact only
  - `type = 8` / `PropertyDataId.Icon` -> icon id
  - `type = 9` / `PropertyDataId.EyesTexture` -> eyes texture override
  - `type = 10` / `PropertyDataId.NoseTexture` -> nose texture override
  - `type = 11` / `PropertyDataId.MouthTexture` -> mouth texture override
  - `type = 12` / `PropertyDataId.DefaultEyesTexture` -> default eyes texture
  - `type = 13` / `PropertyDataId.DefaultNoseTexture` -> default nose texture
  - `type = 14` / `PropertyDataId.DefaultMouthTexture` -> default mouth texture
  - `type = 15` / `PropertyDataId.HairPalette` -> hair palette id
  - `type = 16` / `PropertyDataId.EyesPalette` -> eyes palette id
  - `type = 17` / `PropertyDataId.SkinPalette` -> skin palette id
  - `type = 18` / `PropertyDataId.HeadObject` -> head part id
  - `type = 22` / `PropertyDataId.PhysicsEffectTable` -> physics effect table id
- `weenie_properties_float`
  - `type = 12` / `PropertyFloat.Shade` -> shade
  - `type = 39` / `PropertyFloat.DefaultScale` -> default scale
- `weenie_properties_int`
  - `type = 1` / `PropertyInt.ItemType` -> item type
  - `type = 2` / `PropertyInt.CreatureType` -> creature type
  - `type = 3` / `PropertyInt.PaletteTemplate` -> palette template, retained as source fact only
  - `type = 113` / `PropertyInt.Gender` -> gender
  - `type = 131` / `PropertyInt.MaterialType` -> material type, retained for later loot/material
    composition
- `weenie_properties_palette`
  - `sub_Palette_Id`, `offset`, `length` -> ObjDesc subpalette rows
- `weenie_properties_texture_map`
  - `index`, `old_Id`, `new_Id` -> ObjDesc texture-map changes
- `weenie_properties_anim_part`
  - `index`, `animation_Id` -> ObjDesc anim-part changes

Projection boundaries:

- The first SQL resolver projects visual seed facts only. It does not attempt full ACE object
  construction.
- `ClothingBase`, `PaletteTemplate`, `MaterialType`, and face/hair/skin DIDs should be preserved as
  source facts even when Phase 12E cannot yet compose them into ObjDesc rows.
- Clothing-table composition, char-gen/player appearance construction, equipped inventory,
  treasure/loot mutation, generator/create-list expansion, and landblock-instance spawning are
  explicitly later breadth.

Purpose:

- Let browser-mode spawn UX seed believable entities from the same WCID-backed data family ACE uses
  without coupling the browser form to SQL parsing or a specific database transport. The existing
  `WeenieSpawnSeedResolver` remains the frontend boundary; this phase replaces the fake in-memory
  facts with optional live ACE SQL-backed facts while preserving manual setup entry.

Deliverables:

- Add a Tauri-side ACE world SQL resolver configured by `ACE_WORLD_SQL_URL`, using a URL shape like
  `mysql://user:password@host:port/ace_world`. The command should normalize DB rows into
  `WeenieSpawnSeedResolver` facts and should never propagate SQL credentials, SQL strings, or ACE
  table names to Svelte/browser code.
- Extend `WeenieSpawnSeed` beyond the Phase 12D setup-only shape. The widened seed should retain
  `weenieClassId`, `label`, and `setupModelId`, and add optional visual facts such as motion table,
  sound table, combat table, physics effect table, icon, default scale, shade, raw source appearance
  DIDs, and direct ObjDesc rows.
- Add a Tauri-backed `WeenieSpawnSeedResolver` implementation or adapter. `BrowserDisplay` and the
  spawn form should continue to call `resolver.resolve(weenieClassId)` or an equivalent typed
  resolver facade instead of branching on SQL/catalog implementation details.
- Add frontend lookup capability plumbing. The `Spawns` tab should show WCID lookup as unavailable
  when the Tauri resolver is not configured, while preserving manual setup-backed spawn entry.
- Preserve the resolver boundary: the backing implementation may understand ACE SQL/schema, but the
  browser form only sees resolved weenie facts or no result.
- Support at least the first visual-first SQL fields: WCID/class/name/type, DID setup, motion, sound,
  combat, physics effect, icon, palette base, clothing base, face/hair/skin/head DIDs where present,
  default scale, shade, and direct palette/texture-map/anim-part rows. Position rows,
  generator/create-list/emote summaries, landblock-instance placement facts, and full generated
  catalog export remain follow-up breadth unless required to prove the first lookup path.
- Add an appearance-aware resolver output for ObjDesc/model-data facts: base palette id,
  subpalettes, texture changes, and anim-part changes. This is required for player/creature-shaped
  WCID seeds when those facts are directly available; setup-only fixtures are allowed only as
  explicitly diagnosed fallback rows.
- Thread resolved appearance facts into browser-created runtime spawn requests and runtime visual
  source facts, then resolve a per-spawn setup appearance through the existing host-side
  runtime-appearance resolver or an equivalent typed asset key.
- Keep a generated all-weenie visual catalog as a later optimization/offline mode. The first phase
  should prove live SQL lookup through Tauri without requiring a full dump or browser-side catalog
  ingestion.

Acceptance criteria:

- With `ACE_WORLD_SQL_URL` configured, the browser spawn form can seed from a real ACE world WCID
  lookup without changing form or spawn validation code.
- Without `ACE_WORLD_SQL_URL`, WCID lookup is visibly unavailable/disabled and manual setup-backed
  spawn entry still works.
- The existing Phase 12D resolver boundary is still the only browser-facing WCID resolution surface.
  No Svelte component imports SQL row shapes, SQL property-id maps, or Tauri command DTOs directly
  except through a small resolver adapter.
- WCID `42810` resolves setup `0x0200004E`, motion `0x09000001`, sound `0x20000002`, plus direct
  palette/texture-map/anim-part rows, and can drive the appearance-aware runtime-spawn path.
- WCID `1` resolves setup `0x02000001`, motion `0x09000001`, sound `0x20000001`, combat
  `0x30000000`, physics `0x34000004`, and icon `0x06001036`, but diagnostics must clearly show when
  no direct appearance override rows are present.
- Missing or malformed SQL rows log at the resolver boundary and return no result without becoming
  spawn validation errors or durable diagnostics.
- SQL-backed resolution remains optional; the app still works with the Phase 12D fixture/manual
  path when no ACE world SQL URL is configured.

Task checklist:

- [x] Decide whether the first backing is a generated catalog file, SQLite/catalog cache, Tauri-side
      SQL lookup, or tooling-generated JSON. Decision: Tauri-side SQL lookup behind
      `ACE_WORLD_SQL_URL`, with generated catalog/offline export deferred.
- [ ] Add Tauri configuration/capability plumbing for optional `ACE_WORLD_SQL_URL`.
- [ ] Add a Tauri command that resolves one WCID from ACE world SQL into normalized visual spawn
      facts.
- [ ] Widen `WeenieSpawnSeed` and resolver tests to cover optional SQL-backed visual facts while
      preserving the Phase 12D in-memory fixture behavior.
- [ ] Add a Tauri-backed resolver adapter consumed through the same browser resolver boundary.
- [ ] Wire browser WCID lookup through the existing resolver/form boundary, disabled when the Tauri
      capability says lookup is unavailable.
- [ ] Extend resolver, spawn validation, runtime source facts, and dynamic visual resource loading so
      ObjDesc/model-data appearance facts can select a per-spawn setup appearance instead of the base
      setup-only appearance.
- [ ] Add resolver behavior for missing source, missing WCID, malformed rows, and conflicting
      property rows: log to the console and return no result without durable diagnostics.
- [ ] Add tests with a small ACE-derived fixture or SQL-row adapter fixture covering WCID `42810` and
      setup-only WCID `1`.

### Phase 12F: Host Presentation Projection Resteer

Status: pending.

Purpose:

- Validate that browser-authored server-shaped presentation spawns stayed aligned with the visual
  facts available from actual Holtburger/ACE live entity events, without making the browser renderer
  own authoritative gameplay lifecycle semantics.

Deliverables:

- Compare the Phase 12B runtime source model against `ObjectDescriptionData`, `EntitySpawned`,
  `EntityReplaced`, `EntityMoved`, `EntityMotionUpdated`, and runtime body-view events after browser
  spawn UX exists.
- Decide which live-host facts should project directly into the runtime spawn presentation model,
  which need a thin host presentation adapter, and which require another source variant.
- Keep authoritative host/server ids as correlation metadata. Presentation ids, renderer ids,
  resource leases, atlas ownership, and removal ownership remain internally consistent frontend
  identities.
- Record visual projection gaps for players/creatures/items/equipment: model-data composition,
  equipment attachment, motion-table selection, appearance overrides, and correlation metadata.
- Record semantic gaps as host-runtime-owned, not renderer-owned: server object sequencing,
  create/update/delete meaning, replacement versus mutation, inventory/container ownership,
  equipment gameplay state, local prediction, and cancellation.

Acceptance criteria:

- The next live/server-authored dynamic entity phase can be planned around a host presentation
  projection contract instead of guessing whether browser spawn UX drifted from real host data.
- The plan records which visual fields and correlation metadata are shared with browser runtime
  spawns, which need host-specific projection, and which gameplay semantics must stay out of the
  renderer.
- It remains acceptable for the browser renderer to recreate a presentation entity instead of
  mutating it in place when the host projection changes, provided picks preserve correlation metadata
  and renderer/resource cleanup remains leak-free.

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
  requirements; Phase 8A must prove compatible static and dynamic consumers converge on one shared
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
  runtime family before Phase 4A/4B resource readiness, and Phase 8F removes the renderer/query
  special case by routing env-cell dynamics through the same dynamic resource, instance, diagnostics,
  and merged query families.

- Risk: env-cell parity becomes nominal rather than functional by mirroring every env-cell static
  object into dynamic state without evidence that it should behave dynamically.
  Mitigation: classify in the env-cell baker from `payload.sourceAssets`, emit a separate
  `env-cell-static-object-dynamic-seed` only for setup-model/default-animation seeds, prove
  unclassified env-cell statics are not registered, keep rendering cutover explicitly out of Phase
  3B, and complete the functional render/query cutover in Phase 8F.

- Risk: env-cell dynamic registration corrupts static env-cell scene/query membership by changing
  the meaning of `env-cell-static-object-seed`.
  Mitigation: keep `env-cell-static-object-seed` as the static membership record and add a separate
  classified dynamic variant. Phase 8F may intentionally change static cutover behavior for
  classified dynamic seeds only, and tests must prove unclassified env-cell static membership remains
  stable.

- Risk: env-cell dynamic records poison outdoor-only placement, indexing, or renderer paths, or
  env-cell dynamics grow a second parallel renderer/query system.
  Mitigation: model source/effective residence explicitly, implement Phase 8F with shared dynamic
  resource/instance/diagnostics/query families, and isolate residence-specific code to placement,
  visibility, render-pass membership, and index implementation details.

- Risk: typed `SetOmega` state exists but is not consumed by bounds or rendering.
  Mitigation: Phase 5B added typed decode and active transform state; Phase 6 must compose it into
  hook-aware bounds before Phase 8E renders the bird target.

## Definition Of Done

- `0x020003e5` is rendered through the dynamic runtime, not baked static geometry.
- `0x020005ac` is rendered through the dynamic runtime with typed `SetOmega` transform behavior, not
  baked static geometry and not a final unsupported-hook compromise.
- Static-authored dynamic registration supports both outdoor landblock and env-cell source
  residence. Classified outdoor and env-cell dynamic records are diverted from static output,
  hydrated, animated, submitted, diagnosed, and queried through shared dynamic runtime families, with
  residence-specific behavior isolated to placement, visibility, render-pass membership, and index
  details.
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
- Browser selection can return both static-authored dynamic scenery targets for inspection. Retail
  gameplay targetability remains a separate caller policy.
- Diagnostics explain dynamic classification, readiness, playback, bounds, index membership, and
  renderer submission state.
- Unsupported hooks are preserved and diagnosed; supported `SetOmega` is reported as active transform
  state, not skipped behavior.
- Full verification commands pass, or unrelated pre-existing failures are documented.
- This plan is updated with completed decisions, concessions, and remaining full-system open gates.

## Open Questions

- Should the first-cut target validation get a dedicated browser diagnostics panel row, or is the
  existing diagnostics report enough once dynamic fields are added?
