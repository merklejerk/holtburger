# Holtburger 3D Open World Streaming Materialization Remodel Plan

Date: 2026-07-06
Status: draft.

## Context And Boundaries

### Goal

Replace the current `apps/holtburger-3d` static/dynamic materialization pipeline with a compose-driven, owner-indexed open-world streaming system that avoids main-thread stutter and culminates in a hard cutover with legacy orchestration removed.

### Background

The stutter investigation in `docs/plans/holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md` showed that radius-1 open-world scene loading can create browser main-thread blackouts above one second. The problem is not simply missing workers. The current pipeline converges resolver output, pre-bake texture placement, static commit install, dynamic visual preparation, renderer upload, scene-query publication, and diagnostics through broad runtime and texture-manager choke points.

The desired model is not a small tuning pass. It changes ownership, scheduling, texture residency, commit ordering, eviction, and source-tree organization.

### In Scope

- `apps/holtburger-3d` app-local architecture only.
- New compose-driven materialization pipeline built beside the current runtime path.
- New domain/system-oriented source tree policy for the replacement pipeline.
- Owner-indexed materialization currentness and eviction.
- Bucket-scoped texture placement and retain/release semantics.
- Worker-owned page build and expensive source/pixel preparation where feasible.
- Typed scene commits and a concrete texture commit stream.
- Renderer/install readiness changes needed to tolerate loose scene/texture commit ordering.
- Harness-first validation against the open-world streaming benchmark.
- Hard cutover from the old pipeline and deletion of vestigial code.

### Out Of Scope

- Moving this app-local architecture into shared Rust crates.
- Rewriting ACE, ACViewer, host routes, or DAT decoding as part of this plan.
- Running or depending on the TUI client for diagnostics.
- Solving all future runtime entity mutation features such as public visual update-in-place.
- Adding compatibility shims for old runtime APIs after cutover, unless needed for a brief harness-only transition.
- Reorganizing the whole existing `src/lib` tree before the replacement path proves itself.

## Ground Truth

### Primary Reference Sources

- `docs/plans/holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md`
- `apps/holtburger-3d/src/lib/browser/create-browser-runtime.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/lib/static/coordinator/static-coordinator.ts`
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
- `apps/holtburger-3d/src/lib/runtime/static-commit-installer.ts`
- `apps/holtburger-3d/src/lib/renderer/types.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`
- `apps/holtburger-3d/src/lib/static/demand-planner.ts`
- `apps/holtburger-3d/scripts/browser-pipeline-harness.mjs`
- `apps/holtburger-3d/src/pages/BrowserPipelineHarness.svelte`

### Current Code Findings To Preserve

- `createBrowserRuntime(...)` is already a useful composition seam for renderer, host, assets, workers, static coordinator, dynamic workers, and texture packer.
- Static demand planning already maps landblock scene interest into static layer owners and landblock-coalesced source requests.
- Resolver workers, bake workers, texture packing workers, and existing domain bakers contain useful transforms that should be reused through adapters where possible.
- The browser harness already gives a measurable contract for open-world streaming.

### Current Code Findings To Replace

- `ClientRuntimeImpl` currently owns too much orchestration: scene interest, texture placement, static install, dynamic visual prep, renderer mutation, scene query, diagnostics, and settling.
- `TextureManager.#runTextureMutation(...)` serializes pre-bake placement, static texture commits, and dynamic texture commits through one global promise lane.
- `StaticCoordinator` uses closure-carried source-ready continuations instead of an autonomous artifact runner.
- `installStaticCommit(...)` asserts same-commit resolved texture placements, which blocks loose scene/texture commit ordering.
- The existing source tree groups code by concepts such as `textures`, `visual`, `static`, `dynamic`, and `runtime`, but the actual workflows cut across all of them.

## North Stars

- **Open-world streaming should feel continuous.** Radius-1 loading must not create browser blackouts, and the design should scale toward larger radii by budgeting main-loop work instead of batching bigger bursts.
- **The future 3D client is the real target.** Browser mode is the proving ground, but shared app-local abstractions should be judged against a traditional replacement client with richer rendering, motion, visibility, animation, and interaction needs.
- **Ownership should be boring and explicit.** Currentness, eviction, and cleanup should start from owner membership and owner-indexed resources, not broad revision folklore or reverse-materialization DTOs.
- **Texture residency is a streaming system concern.** Bucket policy, retain/release semantics, page reservations, and binding readiness belong with the open-world materialization model, not in a generic texture junk drawer.
- **Main-loop authority should be narrow.** WebGL mutation, renderer install, scene-query publication, and debug projections stay on the main loop, but bulk source preparation, packing, page rebuilds, and bake transforms should move off-thread unless proven otherwise.
- **Loose commit ordering should be normal.** Scene commits and texture commits should be independently applicable, with unresolved bindings producing non-renderable resources and loud upstream diagnostics instead of renderer hot-path surprises.
- **Reuse transforms, not old architecture.** Existing resolvers, bakers, workers, and renderer APIs are useful through adapters; legacy scheduling, lease/pin vocabulary, same-commit assumptions, and global mutation lanes are replacement targets.
- **Migrate direct contracts, shim legacy.** Replacement-owned systems should expose the contracts they actually want. Durable consumers should migrate directly to those contracts. Compatibility projections for legacy DTOs, timing assumptions, diagnostics snapshots, tests, or UI expectations are shims outside replacement internals and must be deletion-targeted.
- **The source tree should explain the system.** New code should be organized by owning workflow/domain so a maintainer can follow open-world materialization without spelunking through concept buckets.
- **Diagnostics should be honest to the new model.** Replacement diagnostics should describe owners, artifacts, bucket lanes, claims, page builds, commits, readiness, stale rejection, and frame-budget behavior. The replacement diagnostics contract may break legacy consumers. Legacy-compatible diagnostic shims belong on the legacy, harness, or UI migration side and must be temporary.
- **Dual operation is temporary by design.** The parallel pipeline exists to derisk the cutover, not to become a second permanent runtime.
- **The finish line includes deletion.** The plan is not done until vestigial materialization code, misleading tests, shims, dead adapters, and obsolete docs are removed or explicitly archived as historical evidence.

## Architectural Direction

### Replacement System Shape

Build a new app-local system under a domain/system-oriented tree. The first target shape is:

```text
apps/holtburger-3d/src/lib/systems/
  open-world-streaming/
    composition/
    scheduling/
    owners/
    demand/
    artifacts/
    static-sources/
    texture-residency/
      claims/
      placement/
      page-build/
      commits/
    static-layers/
      terrain/
      outdoor-objects/
      env-cells/
    runtime-entities/
    scene-commits/
    diagnostics/
    testing/
```

This tree is a policy boundary, not just a folder name. New materialization concepts should live with the owning system. Shared helper promotion must be deliberate and evidence-based.

### Source Tree Policy

- Organize new code by owning system or workflow, not by broad concept nouns.
- Treat `open-world-streaming` as the owner of streaming-specific texture residency, scheduling, artifact, and eviction models.
- Keep generic primitives outside a system only when they are proven reusable by multiple systems.
- Use explicit adapter modules when the new system consumes legacy code.
- Do not import random internals across system folders. Export narrow module surfaces.
- Keep tests near the behavior they prove.
- Do not perform a broad legacy source-tree reshuffle before the new pipeline proves itself.
- During hard cutover, delete obsolete legacy modules instead of leaving compatibility fossils.
- Distinguish adapters from shims. Adapters isolate durable boundaries such as host assets, workers, renderer mutation, diagnostics, or harness composition. Shims preserve temporary compatibility with legacy shapes and must be deleted when the legacy system they bridge is removed.
- New replacement contracts should be direct and native to the replacement model. If an existing consumer cannot migrate immediately, add a legacy-side shim instead of weakening the replacement contract.
- Treat legacy-shaped DTOs, event ordering, diagnostics, UI projections, benchmark summaries, and architecture-preserving tests as compatibility pressure. Keep that pressure outside replacement internals.
- Do not recreate legacy diagnostic snapshots inside the replacement system. If benchmark, UI comparison, or temporary panels need legacy-shaped diagnostics, put that shim at the harness, UI migration, or legacy runtime boundary and track it for deletion.
- Prefer changing diagnostics consumers to the replacement contract over bending the replacement contract toward old snapshots.

### Core Model

- Materialization currentness is owner-indexed: `owners.has(ownerId)`.
- Static layer owners are derived from scene interest and landblock LoD demand.
- Runtime-authored dynamic owners use runtime entity ids.
- Static-authored dynamic visuals are parent-owned by their originating static layer owner for the first cut.
- Texture retain is idempotent replacement for a given `(ownerId, bucketKey)`.
- Texture release is owner-wide and cheap.
- Texture entries are explicitly multi-owner.
- Page deletion and repack are deferred policy decisions, not eager release side effects.
- Scene commits and texture commits may arrive in either order.
- Renderer and install paths must treat pending texture bindings as non-renderable, not fatal.
- Heavy work defaults to worker ownership unless there is a clear main-loop reason.
- Main-loop work must be frame-budgeted or explicitly yield to the browser task/frame loop.

## Proposed Components

### Materialization Owner Registry

Responsibilities:

- Track desired owner ids.
- Answer artifact currentness checks.
- Add owners for new static demand or runtime entity creation.
- Remove owners before teardown and texture release.
- Provide small diagnostics for current owner counts by kind.

Non-goals:

- It should not become a broad runtime state store.
- It should not encode global sequence ordering.
- It should not use owner generations in the first cut.

### Artifact Runner

Responsibilities:

- Lazily run while runnable or in-flight work exists.
- Advance ready artifacts by one edge or reducer per pass.
- Group placement work by bucket where possible.
- Yield to the browser task/frame loop between CPU-heavy passes.
- Reject stale worker outputs by owner currentness and reservation tokens.
- Publish typed scene commits and texture commits.

Expected artifact graph:

```text
ResolvedVisualSource
        |
        v
TexturePlacementPlan
      /       \
     v         v
BakeInput   AtlasPageBuildInput
     |         |
     v         v
SceneCommit   TextureCommit
```

### Texture Claim Service

Responsibilities:

- Expose `retainTextureBindings(ownerId, bucketKey, bindings)`.
- Expose `releaseTextureOwner(ownerId)`.
- Replace legacy lease-count and dependency-pin vocabulary with explicit owner claim sets where possible.
- Track `ownerId -> entry ids` and `entryId -> owner ids`.
- Mark entries/pages reclaimable when no current owner claims them.

Concessions:

- If renderer resources can legitimately outlive owner claims after commit ordering changes, add a narrowly scoped installed-resource guard. Do not preserve generic pins by default.

### Bucket Placement Service

Responsibilities:

- Own bucket-scoped placement ordering.
- Use a virtual page map over committed page state.
- Account for resident, planned, building, repack-reserved, and reclaimable pages.
- Reserve page/build tokens before worker page builds.
- Reuse compatible committed or planned entries.
- Emit bake-facing page/group facts without requiring renderer texture residency.

Non-goals:

- It should not mutate WebGL resources.
- It should not require global ordering across independent buckets.

### Page Build Worker Boundary

Responsibilities:

- Move source preparation, guttered blits, page rebuilds, and bulk pixel materialization off the main loop where feasible.
- Return reservation tokens with worker results.
- Distinguish `page-update`, `noop`, stale rejection, and failure.
- Retire accepted reservations, including accepted noops.

### Texture Commit Applier

Responsibilities:

- Apply concrete `TextureCommit` artifacts on the main loop.
- Update renderer texture pages and binding readiness.
- Remove renderer pages only when texture policy emits explicit page removals.
- Keep omitted bindings unchanged.

First-cut shape:

```ts
interface TextureCommit {
  readonly kind: "texture-commit";
  readonly bucketKey: string;
  readonly pageUpdates: readonly TexturePageUpdate[];
  readonly pageRemovals: readonly TexturePageRemoval[];
  readonly bindingUpdates: readonly TextureBindingResolution[];
  readonly bindingRemovals: readonly string[];
}
```

The exact DTO fields should be refined during implementation. The contract above is directional, not final.

### Typed Scene Commit Queue

Responsibilities:

- Publish domain-specific scene commits instead of one broad visual DTO.
- Keep a small shared envelope with commit kind, owner id, currentness metadata, and diagnostics.
- Dispatch to renderer, scene query, dynamic state, portal records, and diagnostics in domain-specific apply order.

Candidate commit kinds:

- `terrain-layer-commit`
- `outdoor-buildings-layer-commit`
- `outdoor-explicit-objects-layer-commit`
- `outdoor-generated-scenery-layer-commit`
- `env-cell-system-layer-commit`
- `static-authored-dynamic-resource-commit`
- `runtime-authored-dynamic-resource-commit`
- `dynamic-instance-commit`
- `texture-commit`

### Renderer Readiness Boundary

Responsibilities:

- Separate visual/resource presence from texture binding readiness.
- Skip unresolved draw work without hot-path logging.
- Surface missing-not-in-flight or failed bindings through commit/apply diagnostics.
- Keep WebGL mutation main-loop owned.

Migration constraint:

- Current renderer APIs are synchronous layer setters and texture update appliers. The first implementation can adapt commits into existing APIs, but the final design should not depend on same-commit texture residency.

## Phased Implementation

### Phase 1: Source Tree And Composition Skeleton

Deliverables:

- Create the new `open-world-streaming` system tree.
- Add a composition module that wires the replacement pipeline behind an explicit runtime-pipeline option.
- Add adapters for host assets, existing resolver workers, existing bake workers, existing texture packing worker, and renderer apply APIs.
- Add replacement-native browser diagnostics and atlas-inspection contracts.
- Add a small architecture README for the new system tree policy.
- Add `--runtime-pipeline <legacy|open-world-streaming>` to the browser harness and pass it to the harness page.
- Add a typed `createBrowserRuntime(...)` option that selects the legacy or replacement composition path.

Acceptance criteria:

- Legacy browser runtime remains unchanged by default.
- Harness can instantiate either legacy or replacement composition without changing normal browser UI.
- New code imports legacy only through adapter modules.
- The replacement composition satisfies the existing `ClientRuntime` boundary only at the outer adapter.
- Replacement-owned contracts are direct contracts, not legacy DTO projections with new names.
- Replacement internals do not depend on `StaticCoordinator` orchestration, `StaticSourceReadyWork`, or `StaticCoordinatorCommitDelta`.
- Replacement diagnostics do not clone `StaticCoordinator`, `staticCommitInstall`, or `TextureManager` diagnostic shapes.
- Any legacy-shaped output is produced outside replacement internals and is marked as a deletion-targeted shim.
- Compile-level tests prove the new system tree can be imported without depending on legacy runtime internals.

Task checklist:

- [x] Create `apps/holtburger-3d/src/lib/systems/open-world-streaming`.
- [x] Add public module surfaces for realized composition, adapter, diagnostics, scene commit, texture commit/readiness, and testing support contracts.
- [x] Add legacy asset, worker, and renderer adapter placeholders with typed contracts.
- [x] Add replacement-native diagnostics and atlas-inspection contracts.
- [x] Add direct replacement contracts for composition, commits, readiness, diagnostics, and atlas inspection before adding compatibility projections.
- [x] Add only the minimal harness comparison summary needed for benchmark parity, using replacement-native metrics as the source of truth.
- [x] Add any temporary legacy-shaped diagnostic projection outside replacement internals, only if a current consumer blocks migration.
- [x] Add `BrowserRuntimePipelineMode = "legacy" | "open-world-streaming"`.
- [x] Add `createBrowserRuntime(canvas, { runtimePipeline })`.
- [x] Add harness CLI parsing for `--runtime-pipeline`.
- [x] Pass the selected pipeline through the `/harness/browser-pipeline` query string.
- [x] Keep `BrowserDisplay.svelte` on the default legacy path.
- [x] Add focused compile tests for composition wiring.

Decisions and course corrections:

- Use `src/lib/systems/open-world-streaming`.
- Use `--runtime-pipeline <legacy|open-world-streaming>` for harness selection.
- Keep existing worker entrypoints in place and consume them through adapters.
- Reuse static resolver and baker transforms directly through adapters; do not wrap `StaticCoordinator` as the replacement orchestrator.
- Keep replacement diagnostics native to replacement concepts; put temporary compatibility summaries outside the replacement internals.
- Phase 1 completed on 2026-07-06.
- Added `--scenario instantiate-only` so the harness can smoke-test replacement composition without pretending the replacement can settle static scene readiness before terrain exists.
- Added a `ClientRuntime`-shaped outer adapter for browser/harness compatibility. This is a deletion-targeted shim pressure point for Phase 14, not a replacement-internal contract.
- Boundary audit after Phase 1 found no `StaticCoordinator`, `StaticSourceReadyWork`, `StaticCoordinatorCommitDelta`, or `TextureManager` imports in the new tree. The only `staticCommitInstall` reference is the legacy-shaped field required by the outer `ClientRuntime` shim.
- Did not keep empty per-domain barrel files for future folders. `knip` correctly flagged those as unused files, so future phases should create domain modules when they add real behavior. The architecture README keeps the target tree policy in view.
- The replacement runtime currently returns legacy-shaped `RuntimeDiagnosticsReport` only at the outer `ClientRuntime` boundary. Native diagnostics remain in `open-world-streaming/diagnostics/contracts.ts`.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, focused `npm run test:ts -- src/lib/systems/open-world-streaming/composition/runtime-pipeline.test.ts src/lib/browser/create-browser-runtime.test.ts`, and `npm run harness:browser -- --scenario instantiate-only --runtime-pipeline open-world-streaming --timeout-ms 30000`.

### Phase 2: Resteering Checkpoint 1 - Composition Boundary Review

Deliverables:

- Review the new system tree, public module surfaces, and adapter imports before deeper behavior is implemented.
- Confirm the harness pipeline switch is ergonomic enough for repeated benchmark work.
- Identify any skeleton modules that are already too broad, too generic, or too coupled to legacy runtime internals.

Acceptance criteria:

- The replacement tree compiles through its intended public surfaces.
- Every legacy import in the new tree is routed through an adapter or explicitly moved out of the tree.
- Any shim introduced for skeleton work is named and tracked for deletion.
- The skeleton proves replacement internals can compile without importing `StaticCoordinator` orchestration contracts.
- Replacement diagnostics expose replacement-native concepts, not legacy static coordinator or texture manager snapshots.
- The next implementation span through the owner model checkpoint has been dry-run against the current source tree.
- Phase 3 and Phase 4 are updated if the boundary review exposes a cleaner sequencing.

Task checklist:

- [x] Review import graph for `src/lib/systems/open-world-streaming`.
- [x] Review adapter module names and contracts.
- [x] Confirm new contracts are replacement-native and any compatibility layer is outside replacement internals.
- [x] Confirm diagnostics and atlas-inspection contracts do not import `TextureManager` internals or clone legacy snapshot shapes.
- [x] Confirm harness comparison summary is minimal and does not become a replacement diagnostic contract.
- [x] Validate `--runtime-pipeline` harness flow manually or with a focused smoke test.
- [x] Record shims and deletion targets in this plan.
- [x] Dry-run Phase 3 and Phase 4 against the current source tree.
- [x] Identify dependency/order changes, boundary leaks, shims, deletion targets, and test risks for the next implementation span.
- [x] Update future phases if the skeleton created boundary debt.

Decisions and course corrections:

- Phase 2 completed on 2026-07-06.
- Import audit found the new tree imports legacy-facing app contracts only at explicit adapter, outer `ClientRuntime` shim, and test fixture boundaries. No new tree file imports `StaticCoordinator`, `StaticSourceReadyWork`, `StaticCoordinatorCommitDelta`, or `TextureManager`.
- The remaining `staticCommitInstall` property is required only because the outer `ClientRuntime` shim must return the legacy `RuntimeDiagnosticsSnapshot` shape. This is tracked for Phase 14 cutover deletion.
- Adapter names are acceptable for Phase 1, but `testing/empty-runtime-snapshots.ts` is really a legacy `ClientRuntime` shim fixture. Rename or delete it when Phase 14 removes the legacy-shaped runtime boundary.
- Harness comparison remains minimal: `runtimePipeline` plus the `instantiate-only` scenario. It must not grow into a second diagnostics contract.
- Dry-running Phase 3 showed terrain bake grouping currently depends on `placement.pageId`, object-material grouping depends on `placement.textureRefId`, and both throw on missing placements. Phase 3 must introduce separate bake-facing page compatibility facts and renderer-facing binding readiness before relaxing renderer/install assertions.
- Dry-running Phase 4 showed `static/layer-owners.ts` and `static/demand-planner.ts` contain reusable owner-key transforms, but static coordinator revisions/currentness must not be promoted into the replacement owner registry.
- Test risk: existing `static-coordinator`, `texture-manager`, and `static-commit-installer` tests encode retired orchestration assumptions. Phase 3 and Phase 4 should add replacement-local tests instead of mutating those suites unless the behavior is a reusable transform.

### Phase 3: Readiness Contract Unlock

Deliverables:

- Audit all non-test consumers of `TexturePlacementSnapshot`, `ObjectVisualTexturePlacementSnapshot`, `placement.rect`, `placement.pageId`, and `placement.textureRefId`.
- Classify each consumer as bake grouping, renderer sampling, residency/lifetime, diagnostics, or commit bookkeeping.
- Introduce bake-facing page/group compatibility facts that do not imply renderer texture residency.
- Introduce renderer-facing texture binding readiness facts that carry resident placement/rect details only when WebGL texture residency exists.
- Change static install and renderer prep paths so pending/in-flight texture bindings are non-renderable rather than fatal.
- Harden object-material renderer validation so missing pending bindings do not throw from render hot paths.

Acceptance criteria:

- Static visual payloads can be accepted before matching renderer texture pages are resident.
- Object-material resources with pending required bindings are skipped or marked non-renderable with diagnostics rather than throwing.
- Missing-not-in-flight bindings still fail loudly through diagnostics or commit/apply reporting.
- Existing legacy pipeline behavior remains equivalent when texture placement is same-commit.

Task checklist:

- [x] Complete placement snapshot consumer audit.
- [x] Define bake-facing texture placement facts.
- [x] Define renderer-facing texture binding readiness facts.
- [x] Keep `TexturePlacementSnapshot` and `ObjectVisualTexturePlacementSnapshot` behind legacy transform/adapters; do not make them replacement contracts with new names.
- [x] Split page compatibility/grouping identity from renderer texture residency identity.
- [x] Adapt terrain bake grouping.
- [x] Adapt object-material draw-unit grouping.
- [x] Distinguish pending placement from missing-not-in-flight placement before relaxing errors.
- [x] Harden object-material renderer preparation for pending required bindings.
- [x] Relax `installStaticCommit(...)` same-commit assertions behind readiness-aware validation.
- [x] Add tests for pending, resident, missing, and failed binding states.

Decisions and course corrections:

- Phase 2 dry-run: terrain grouping currently reads `placement.pageId` for color/detail/mask page partitioning. Replacement bake-facing facts should preserve compatibility grouping without implying an uploaded renderer page.
- Phase 2 dry-run: object-material grouping currently reads `placement.textureRefId` and throws when a placement is absent. Replacement readiness must separate `pending` from `failed/missing`, otherwise Phase 3 will just move the same exception to a new DTO.
- Phase 3 completed on 2026-07-06.
- Added replacement bake-facing page compatibility facts under `open-world-streaming/texture-residency/placement` and a legacy placement-snapshot adapter. This keeps `TexturePlacementSnapshot` outside the replacement contract while preserving terrain/object page grouping facts for later phases.
- Added optional texture readiness to `installStaticCommit(...)`. When omitted, legacy same-commit behavior remains strict. When supplied, pending bindings are accepted, failed bindings throw loudly, and static payloads can install before texture residency.
- Changed object-material draw payload preparation to return non-renderable for pending required bindings instead of throwing from the render path. Failed or missing-not-in-flight bindings still throw.
- Added optional object-material placement readiness to partition-key creation so pending placements can group explicitly as `pending`, while failed placement readiness still throws.
- Concession: Phase 3 unlocks contracts and hot-path readiness behavior but does not yet route terrain or object domains through the replacement artifact runner. The full replacement terrain path remains Phase 8.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and focused `npm run test:ts -- src/lib/visual/object-material-draw-unit-partition.test.ts src/lib/systems/open-world-streaming/adapters/legacy-texture-placement-adapter.test.ts src/lib/runtime/static-commit-installer.test.ts src/lib/renderer/webgl2/webgl2-object-material-payloads.test.ts`.

### Phase 4: Owner Registry And Eviction Core

Deliverables:

- Implement `MaterializationOwnerRegistry`.
- Implement owner ids for static layer owners, runtime entities, and static-authored dynamic parent ownership.
- Implement owner-currentness checks for runner artifacts.
- Implement owner-indexed static layer teardown adapter.
- Implement owner-indexed runtime entity teardown adapter.

Acceptance criteria:

- Evicting an owner prevents late artifacts for that owner from installing.
- Re-demanding an owner produces fresh work.
- Teardown is imperative and owner-indexed, not modeled as reverse materialization artifacts.

Task checklist:

- [x] Define materialization owner id types.
- [x] Add static owner derivation adapter from existing demand planning.
- [x] Add runtime entity owner entrypoints.
- [x] Add owner deletion and artifact pruning hooks.
- [x] Keep owner currentness local to `MaterializationOwnerRegistry`; do not use static coordinator revisions as the primary stale-work rule.
- [x] Define renderer/scene-query teardown ports before calling existing renderer setters directly.
- [x] Add tests for stale work rejection after eviction.

Decisions and course corrections:

- Phase 2 dry-run: reuse `createLayerOwnerKeyId(...)` and demand-planner owner-key derivation as transforms through adapters, but do not wrap static coordinator owner state.
- Phase 2 dry-run: existing teardown is spread through `ClientRuntimeImpl` renderer setters, scene-query records, dynamic state, and texture manager owner references. Phase 4 should define narrow teardown ports first so owner eviction does not inherit the runtime god-object shape.
- Phase 4 completed on 2026-07-06.
- Added `MaterializationOwnerRegistry` with owner-local currentness tokens. Eviction invalidates late artifact tokens, and re-demanding an owner creates a fresh token without using static coordinator revisions.
- Added explicit owner id constructors for static layers, runtime entities, and static-authored dynamic children. Static-authored dynamic owners are parented to the originating static layer owner for the first cut.
- Added `createStaticLayerOwnersFromDemand(...)` as a legacy transform adapter around `planStaticDemand(...)`. This reuses demand planning without importing or wrapping static coordinator state.
- Added teardown ports for renderer static layers, scene-query static layers, and runtime entities before wiring owner eviction into runtime mutation.
- Deleted the owner barrel after `knip` flagged unused ceremonial exports. Later phases should import concrete owner modules until a public surface is actually consumed.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and focused `npm run test:ts -- src/lib/systems/open-world-streaming/owners/owner-registry.test.ts`.

### Phase 5: Resteering Checkpoint 2 - Owner Model Review

Deliverables:

- Review owner ids, currentness checks, eviction semantics, and teardown adapters before texture ownership is built on top of them.
- Validate that static layer owners, runtime entity owners, and static-authored dynamic parent ownership still match the north stars.
- Identify whether any owner domain needs a targeted replacement token before the first texture claim implementation.

Acceptance criteria:

- Eviction behavior is proven by focused tests before texture retain/release depends on it.
- No owner model path depends on broad global revisions as its primary currentness rule.
- Static-authored dynamic parent ownership is still acceptable or explicitly revised.
- The next implementation span through the terrain vertical slice checkpoint has been dry-run against the current source tree.
- Texture phases are updated if owner replacement semantics change.

Task checklist:

- [x] Review static owner id derivation.
- [x] Review runtime entity owner lifecycle.
- [x] Review stale artifact rejection tests.
- [x] Review teardown adapter boundaries and shim usage.
- [x] Dry-run Phase 6, Phase 7, and Phase 8 against the current source tree.
- [x] Identify dependency/order changes, boundary leaks, shims, deletion targets, and test risks for the next implementation span.
- [x] Update texture claim requirements from owner-model findings.

Decisions and course corrections:

- Phase 5 completed on 2026-07-06.
- Owner model review accepted the Phase 4 shape: owner ids are explicit, static-authored dynamic ownership remains parented to static layer owners for the first cut, and stale-work rejection is token-based instead of revision-based.
- Deleted unused owner barrel exports in Phase 4. Keep importing concrete owner modules until multiple consumers prove a public owner surface is useful.
- Dry-running Phase 6 showed `TextureManager` has useful concepts for multi-owner entries and deferred reclamation, but its lease/pin/global mutation lane vocabulary must not be copied. Phase 6 should model owner claims as replacement-native `(ownerId, bucketKey) -> binding set` state.
- Dry-running Phase 6 also showed existing texture placement bucket keys can be reused as compatibility inputs, but replacement buckets should be typed locally and fed through adapters so old `TexturePlacementBucketKey` does not become the owner-claim contract.
- Dry-running Phase 7 showed `texture-packing.worker.ts` can remain a layout/pixel-materialization adapter, but reservation tokens, accepted noop handling, and texture commit emission belong to replacement page-build state.
- Dry-running Phase 8 showed terrain can use existing source resolver and `TerrainGeometryStaticBaker` through worker adapters, but the vertical slice needs an artifact runner before harness settlement can be honest.
- Test risk: existing `texture-manager.test.ts` is architecture-preserving for the old global mutation lane. Phase 6 should add replacement-local texture claim tests rather than migrating that suite wholesale.

### Phase 6: Texture Claim And Bucket Placement Core

Deliverables:

- Implement explicit texture owner claim registry.
- Implement bucket-scoped retain/release contracts.
- Implement virtual page map state and page build reservation tokens.
- Implement deferred reclaim policy for ownerless entries/pages.
- Implement placement reducer that groups pending binding requirements by bucket.

Acceptance criteria:

- `retainTextureBindings(ownerId, bucketKey, bindings)` replaces the owner's full claim set for that bucket.
- `releaseTextureOwner(ownerId)` releases all claims for an owner without eager repack/page deletion.
- Independent buckets can progress without a global texture mutation lane.
- Shared texture entries can have multiple owners.

Task checklist:

- [ ] Define texture binding requirement shape.
- [ ] Define texture entry and page record shapes.
- [ ] Define replacement-native bucket keys instead of exposing legacy `TexturePlacementBucketKey` as the claim contract.
- [ ] Implement owner claim registry.
- [ ] Implement bucket virtual page registry.
- [ ] Implement retain replacement semantics.
- [ ] Implement owner-wide release semantics.
- [ ] Keep lease/pin compatibility out of the replacement claim model; use owner claims and explicit installed-resource guards only if proven necessary.
- [ ] Add tests for shared entries, replacement, release, and reclaim eligibility.

Decisions and course corrections:

- Phase 5 dry-run: reuse old texture placement identities as adapter inputs only. Replacement claim state should be `(MaterializationOwnerId, bucketKey, binding requirements)` and should not expose lease/pin semantics.

### Phase 7: Page Build Worker And Texture Commits

Deliverables:

- Add page build worker protocol.
- Decide whether the existing texture packing worker remains a layout-only adapter or is extended; do not assume it can own page builds unchanged.
- Move page pixel materialization and rebuild work behind the worker boundary where feasible.
- Implement token validation for worker results.
- Implement `TextureCommit` emission.
- Implement texture commit applier adapter to existing renderer texture APIs.

Acceptance criteria:

- Stale page build results are ignored without mutating renderer state.
- Accepted `page-update` and accepted `noop` results retire or advance reservations.
- The protocol boundary distinguishes layout packing from page pixel materialization/build results.
- Texture commits can apply before or after scene commits.
- Browser long-task diagnostics show no giant main-thread page materialization bursts for page builds covered by the worker.

Task checklist:

- [ ] Define page build input/output protocol.
- [ ] Classify reusable `texture-packing.worker.ts` responsibilities versus new page-build responsibilities.
- [ ] Keep page build reservation tokens in replacement page-build state, not in the worker adapter.
- [ ] Implement worker client and handler.
- [ ] Add token validation.
- [ ] Add texture commit DTO and applier.
- [ ] Add stale/noop/failure tests.
- [ ] Add diagnostics for page build queue and commit timings.

Decisions and course corrections:

- Phase 5 dry-run: `texture-packing.worker.ts` can produce packed pages and pixels, but replacement-owned reservation/noop/stale-result policy must wrap it.

### Phase 8: Static Terrain Vertical Slice

Deliverables:

- Implement static scene-interest input for terrain owners.
- Adapt existing terrain source resolution and terrain baker into the artifact runner.
- Emit `TerrainLayerCommit` and texture commits independently.
- Wire harness to request replacement terrain-only pipeline.

Acceptance criteria:

- Terrain-only radius-1 harness settles through the replacement pipeline.
- Terrain scene commits can install before texture commits without crashing.
- Texture commits can install before terrain scene commits without crashing.
- Frame gaps stay below the legacy terrain-only baseline.

Task checklist:

- [ ] Seed terrain owner demand from scene interest.
- [ ] Resolve landblock scene source for terrain.
- [ ] Retain terrain texture bindings.
- [ ] Produce terrain bake inputs from bake-facing placement facts.
- [ ] Introduce a minimal artifact runner before terrain harness settlement, so terrain does not re-create `StaticCoordinator` continuations.
- [ ] Emit terrain layer commits.
- [ ] Apply terrain commits to renderer and scene query.
- [ ] Run terrain-only harness.

Decisions and course corrections:

- Phase 5 dry-run: terrain vertical slice should adapt existing resolver/baker transforms, but must not wrap `StaticCoordinator` or depend on same-commit texture residency.

### Phase 9: Resteering Checkpoint 3 - Terrain Vertical Slice Review

Deliverables:

- Compare replacement terrain slice against legacy terrain-only harness results.
- Review source-tree boundaries and imports.
- Review replacement-native diagnostics for usefulness before more domains are added.
- Decide whether the placement/page contracts need simplification before more domains are added.

Acceptance criteria:

- Performance and correctness deltas are documented.
- Any boundary leaks are either corrected or explicitly accepted.
- Diagnostics explain replacement terrain readiness, texture claims, page builds, and scene commits without relying on legacy snapshot names.
- The next implementation span through the full-domain behavior checkpoint has been dry-run against the current source tree.
- Next phases are revised if terrain exposed a bad abstraction.

Task checklist:

- [ ] Capture harness metrics.
- [ ] Review import graph for new system.
- [ ] Review diagnostics clarity.
- [ ] Identify any diagnostic shim that belongs outside the replacement pipeline or should be deleted.
- [ ] Dry-run Phase 10, Phase 11, and Phase 12 against the current source tree.
- [ ] Identify dependency/order changes, boundary leaks, shims, deletion targets, and test risks for the next implementation span.
- [ ] Update plan decisions and future tasks.

Decisions and course corrections:

- Pending.

### Phase 10: Outdoor Static Object Domains

Deliverables:

- Add outdoor buildings.
- Add outdoor explicit objects.
- Add outdoor generated scenery.
- Move static-authored dynamic texture placement toward originating layer shared static-authored buckets when content-stable.
- Keep per-owner buckets only where generated or placement-specific texture content requires isolation.

Acceptance criteria:

- Terrain plus generated scenery radius-1 harness avoids the legacy severe stutter profile.
- Outdoor object texture placement uses bucket-scoped scheduling and owner claims.
- Static-authored dynamic resources are parent-owned by static layer owner for first cut.

Task checklist:

- [ ] Adapt building source/bake/commit path.
- [ ] Adapt explicit object source/bake/commit path.
- [ ] Adapt generated scenery source/bake/commit path.
- [ ] Adapt static-authored dynamic child resource commits.
- [ ] Run terrain plus generated scenery benchmark.
- [ ] Compare texture atlas page lifecycle diagnostics with legacy.

Decisions and course corrections:

- Pending.

### Phase 11: Env-Cell System Domain

Deliverables:

- Add env-cell source/bake/commit path.
- Apply portal/interior/visibility records through typed env-cell system commits.
- Preserve direct env-cell portal traversal behavior.
- Ensure env-cell dense landblocks do not create large main-thread install bursts.

Acceptance criteria:

- Terrain plus env-cells radius-1 harness settles through replacement pipeline.
- All-domain radius-1 harness settles through replacement pipeline.
- Portal/interior picking and debug overlays remain correct.

Task checklist:

- [ ] Adapt env-cell source resolution.
- [ ] Adapt structured interior texture retain and bake.
- [ ] Emit env-cell system commits.
- [ ] Apply portal records and resource membership.
- [ ] Run env-cell-focused harnesses.
- [ ] Compare dense landblock metrics, including `da55`.

Decisions and course corrections:

- Pending.

### Phase 12: Runtime-Authored Dynamic Entities

Deliverables:

- Add runtime entity create/destroy entrypoints to the replacement path.
- Adapt dynamic visual recipe resolution and baking into artifact flow.
- Publish runtime-authored dynamic resource commits and dynamic instance commits.
- Keep render residence separate from runtime entity lifetime.

Acceptance criteria:

- Runtime spawned entities materialize through the replacement texture and visual path.
- Destroying an entity removes runtime state, renderer resources/instances, query records, diagnostics, and texture claims by owner.
- Render-residence changes suppress or restore publication without destroying materialized resources.

Task checklist:

- [ ] Add runtime entity owner entrypoint.
- [ ] Adapt dynamic recipe resolution.
- [ ] Retain runtime-authored dynamic texture bindings.
- [ ] Emit runtime dynamic resource commits.
- [ ] Emit dynamic instance projections from committed runtime state.
- [ ] Add create/destroy/residence tests.

Decisions and course corrections:

- Pending.

### Phase 13: Resteering Checkpoint 4 - Full-Domain Behavior Review

Deliverables:

- Compare all-domain replacement pipeline against legacy baseline:
  - `dc58`, radius 1, all domains.
  - `da55`, radius 1, all domains.
  - terrain plus generated scenery.
  - terrain plus env-cells.
- Review memory growth from deferred reclaim.
- Review source-tree policy violations.
- Review whether replacement-native diagnostics are enough for debugging streaming failures without legacy compatibility crutches.

Acceptance criteria:

- Replacement pipeline materially reduces max frame gap and long task profile.
- Texture memory and page lifecycle behavior are understood.
- Any remaining legacy dependency is explicitly categorized as adapter, reusable transform, shim, or deletion target.
- Any legacy-compatible shim is outside replacement internals and has a deletion target.
- The next implementation span through the cutover deletion audit has been dry-run against the current source tree.

Task checklist:

- [ ] Run benchmark matrix.
- [ ] Capture and compare long task, frame gap, resolver, placement, bake, commit, and renderer metrics.
- [ ] Review diagnostics output.
- [ ] Audit compatibility shims and move/delete anything that pressures replacement internals toward legacy shapes.
- [ ] Dry-run Phase 14 against the current source tree.
- [ ] Identify dependency/order changes, boundary leaks, shims, deletion targets, and test risks for browser runtime cutover.
- [ ] Update cleanup targets.

Decisions and course corrections:

- Pending.

### Phase 14: Browser Runtime Cutover

Deliverables:

- Switch `createBrowserRuntime(...)` to the replacement composition.
- Keep the harness switch only if needed for one short verification window.
- Remove obsolete UI assumptions about legacy static coordinator diagnostics or adapt diagnostics to replacement snapshots.

Acceptance criteria:

- Browser display and browser harness use the replacement runtime path by default.
- Legacy runtime path is not used by normal app routes.
- `npm run check`, `npm run lint:ts`, and focused tests pass.

Task checklist:

- [ ] Switch runtime composition.
- [ ] Update diagnostics panels and overview snapshots.
- [ ] Update browser harness expectations.
- [ ] Run app checks.
- [ ] Run benchmark matrix.

Decisions and course corrections:

- Pending.

### Phase 15: Resteering Checkpoint 5 - Cutover Deletion Audit

Deliverables:

- Audit the post-cutover codebase before legacy cleanup begins.
- Classify every remaining legacy dependency as boundary adapter, reusable transform, shim, dead code, or out-of-scope survivor.
- Decide whether cleanup can proceed in one hard pass or needs a short preparatory subphase.

Acceptance criteria:

- Every shim has a deletion task.
- Every remaining adapter has a durable boundary reason.
- No normal browser or harness path depends on the old runtime pipeline.
- The hard cutover cleanup phase has been dry-run against the current source tree.
- Cleanup scope is specific enough to run without guessing which code is still live.

Task checklist:

- [ ] Run import/dead-code inspection for old runtime, texture manager, and static coordinator paths.
- [ ] Classify remaining adapters and shims.
- [ ] Identify tests that preserve retired architecture.
- [ ] Dry-run Phase 16 cleanup against the current source tree.
- [ ] Identify dependency/order changes, boundary leaks, shims, deletion targets, and test risks for hard cleanup.
- [ ] Update Phase 16 cleanup checklist with concrete file/module targets.
- [ ] Confirm benchmark matrix still passes on the replacement path.

Decisions and course corrections:

- Pending.

### Phase 16: Hard Cutover Cleanup

Deliverables:

- Delete legacy materialization orchestration.
- Delete obsolete global texture mutation lane usage.
- Delete obsolete same-commit static install contracts.
- Delete obsolete lease/pin vocabulary where replaced by owner claims.
- Delete all shims that only bridge replacement artifacts to retired legacy orchestration.
- Delete all legacy-compatible shims once UI, harness, diagnostics, tests, and browser runtime consumers use replacement-native contracts.
- Keep only boundary adapters whose dependency points still exist after cutover, such as host assets, worker factories, renderer mutation, diagnostics export, or harness composition.
- Delete unused tests that preserve dead architecture.
- Delete or rewrite legacy tests that assert retired runtime/static/texture orchestration instead of reusable transforms.
- Update docs to mark the worksheet as historical evidence and this plan as executed or superseded.

Acceptance criteria:

- No production path imports legacy materialization pipeline modules.
- No test requires the old architecture to exist.
- No remaining adapter preserves old ownership, scheduling, same-commit, global texture mutation, or lease/pin semantics.
- Every remaining adapter has a durable boundary reason documented by its module name, README, or tests.
- No shim remains in production code after hard cutover.
- Replacement contracts use replacement concepts and do not expose legacy static coordinator, static commit install, texture manager snapshots, or legacy timing/order assumptions.
- Remaining tests prove replacement behavior or reusable pure transforms, not retired orchestration contracts.
- Dead code tooling does not report newly orphaned modules.
- Source tree contains the replacement system as the authoritative pipeline.

Task checklist:

- [ ] Remove old runtime orchestration modules; keep only durable boundary adapters where the boundary still exists.
- [ ] Remove old texture manager paths no longer used.
- [ ] Remove old static coordinator continuation path if fully replaced.
- [ ] Delete shims that translate replacement artifacts back into retired legacy shapes.
- [ ] Audit remaining adapters and classify each as host, worker, renderer, diagnostics, harness, or delete.
- [ ] Classify `client-runtime.test.ts`, `static-coordinator.test.ts`, `texture-manager.test.ts`, and renderer tests as keep, rewrite, split, or delete.
- [ ] Remove obsolete diagnostics and tests.
- [ ] Run `npm run check`.
- [ ] Run `npm run lint`.
- [ ] Run benchmark matrix one final time.

Decisions and course corrections:

- Pending.

## Risks And Mitigations

### Risk: The Parallel Pipeline Becomes A Permanent Second System

Mitigation:

- Make harness-first dual operation explicit and temporary.
- Track deletion targets from the first phase.
- Require a hard cutover cleanup phase before the plan is considered done.

### Risk: Source Tree Policy Becomes Cosmetic

Mitigation:

- Enforce adapter-only legacy imports from the new system.
- Review imports at each resteering checkpoint.
- Refuse new broad concept dumping grounds in the replacement tree.

### Risk: Loose Scene/Texture Ordering Causes Invisible Missing Geometry

Mitigation:

- Model readiness explicitly: pending, resident, missing, failed.
- Make missing-not-in-flight bindings produce upstream diagnostics.
- Add tests where scene commits arrive before texture commits and texture commits arrive before scene commits.

### Risk: Deferred Texture Reclaim Grows Memory Too Much

Mitigation:

- Keep deferred reclaim as first-cut release policy.
- Add diagnostics for cached/reclaimable ownerless pages.
- Add explicit pressure cleanup only after memory behavior is measured.

### Risk: Reusing Legacy Helpers Smuggles Old Concepts Into The New System

Mitigation:

- Reuse pure transforms and worker-backed domain logic through adapters.
- Do not reuse legacy ownership, scheduling, or residency vocabulary.
- Prefer temporary duplication over preserving harmful abstractions.

### Risk: Renderer APIs Force Synchronous Main-Thread Bursts

Mitigation:

- Add frame-budgeted commit application where needed.
- Split texture commits and typed scene commits.
- Measure renderer apply timings separately from source/placement/bake timings.

### Risk: Static-Authored Dynamic Parent Ownership Is Too Coarse

Mitigation:

- Keep parent ownership for first cut.
- Add child owners or replacement tokens only if retained-layer child replacement proves necessary.

## Definition Of Done

- The replacement pipeline is the default browser runtime path.
- The browser harness benchmark for `dc58`, radius 1, all domains settles with materially reduced long-task and max-frame-gap metrics.
- Dense landblock benchmark coverage includes `da55`, radius 1, all domains.
- Scene commits and texture commits are independently ordered and readiness-aware.
- Texture ownership uses explicit owner claims for the replacement path.
- Owner eviction prevents stale artifact installation and releases texture claims owner-wide.
- Generated scenery no longer creates severe main-thread texture mutation blackouts.
- Runtime-authored dynamic create/destroy works through the replacement path.
- Static-authored dynamic visuals are scoped to parent static layer owners for first cut.
- New pipeline code follows system/domain source-tree policy.
- Legacy orchestration and vestigial code targeted by the plan are deleted.
- `npm run check`, `npm run lint`, and focused test suites pass from `apps/holtburger-3d`.

## Open Questions

- Which bake consumers truly need physical atlas `rect`, if any?
- What is the smallest renderer readiness model that avoids hot-path logging and still reports missing bindings loudly?
- Should `releaseTextureOwner(ownerId)` return assertion counts, or should diagnostics query release effects separately?
- What initial page lifecycle policy should classify ownerless resident pages: cached, reclaimable, or orphaned?
- Which current texture placement worker pieces can be reused, and which need a new page-build worker protocol?
- How much frame-budgeting belongs in the artifact runner versus commit appliers?
- Which current consumers need a temporary legacy-side projection before they can migrate to replacement-native contracts?
