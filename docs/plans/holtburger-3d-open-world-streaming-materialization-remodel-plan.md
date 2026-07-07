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
- **A broken shim is better than a dishonest core.** If legacy consumers cannot immediately understand replacement-native data, let the legacy edge carry the awkward projection or temporary breakage. Do not distort replacement contracts, diagnostics, source layout, or tests to keep old shapes looking alive.
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
- When replacing a contract, migrate surviving consumers directly to the replacement shape before adding any compatibility projection. Only add the projection after naming the blocked legacy consumer and deletion trigger.
- Do not recreate legacy diagnostic snapshots inside the replacement system. If benchmark, UI comparison, or temporary panels need legacy-shaped diagnostics, put that shim at the harness, UI migration, or legacy runtime boundary and track it for deletion.
- Prefer changing diagnostics consumers to the replacement contract over bending the replacement contract toward old snapshots.

### Migration Policy

- Default to **migrate direct contracts, shim legacy** for every replacement boundary. When a consumer is touched, first try to move it to the replacement-native contract. Add a shim only after identifying the blocked legacy consumer and why immediate migration would create more churn than value.
- Migrate durable consumers to direct replacement contracts as early as practical.
- Add shims only on the legacy side, harness side, or UI migration edge when a consumer cannot move yet.
- Treat shims as temporary compatibility debt, not as neutral adapters.
- Do not let shims define replacement naming, field layout, timing assumptions, diagnostics categories, tests, or source-tree placement.
- Treat legacy-shaped diagnostics, benchmark summaries, UI panels, and tests as consumers to migrate, break, or shim at the edge. They are not evidence that the replacement core should preserve old categories.
- Apply this policy to every contract surface: runtime composition, diagnostics, benchmark summaries, texture residency, source resolution, worker DTOs, renderer apply ports, scene query publication, UI panels, harness scenarios, and tests.
- Prefer breaking and updating a legacy-shaped consumer over preserving a dishonest compatibility projection in the replacement pipeline.
- Prefer a visibly incomplete or temporarily broken legacy shim over a compatibility layer that teaches the replacement system old concepts.
- If a phase introduces a shim, record the owning consumer, reason, deletion trigger, and target cleanup phase in that phase's decisions.
- If a consumer is meant to survive cutover, it must be migrated to the direct replacement contract before Phase 16 begins.
- Adapters may survive cutover only when they isolate a durable external boundary such as host assets, workers, renderer mutation, diagnostics export, or harness composition.
- Diagnostics follow the same rule as every other contract: replacement diagnostics are direct; legacy diagnostic snapshots are shims.
- Each steering checkpoint must dry-run the remaining phases up to the next steering checkpoint and explicitly classify touched consumers as direct migration, legacy-edge shim, deletion, or durable adapter. If the answer is not clear, pause the phase before adding compatibility code.

Universal contract migration rule:

- Start from the direct replacement contract the new system actually wants.
- Migrate surviving consumers to that contract before translating anything.
- If a consumer cannot move yet, add the translation at that consumer's edge and name it as a shim.
- Do not put legacy-shaped DTOs, lifecycle timing, diagnostic categories, report fields, or test expectations inside replacement internals.
- Let edge shims be partial, awkward, or temporarily broken when the alternative is making replacement contracts dishonest.
- Apply the rule to diagnostics with the same strictness as runtime, renderer, texture, scene-query, harness, and UI contracts. Diagnostics are not an exception where legacy shape compatibility may re-enter replacement internals.
- When the direct replacement contract breaks a legacy consumer, prefer fixing, deleting, or edge-shimming that consumer over adding a compatibility field to the replacement core.
- During implementation, a phase is not complete until every touched consumer has been classified as direct migration, deletion, legacy-edge shim, or durable adapter.
- During cleanup, every shim is guilty until deleted. Adapters may survive only when their boundary remains real after the old pipeline is gone.

Boundary decision order:

1. **Migrate direct.** If the consumer is expected to survive cutover, update it to the replacement-native contract.
2. **Delete.** If the consumer only preserves legacy architecture, remove it instead of translating it.
3. **Shim at the edge.** If immediate migration is too disruptive, add a named shim at the legacy, harness, UI migration, or runtime-adapter edge.
4. **Keep as durable adapter.** Only keep adapter code when it isolates an external boundary the replacement system will still need after cutover.

Before adding a shim, record:

- Blocked consumer.
- Why direct migration is not the right next move.
- Which replacement contract remains canonical.
- Dishonest-field or legacy-concept risk.
- Deletion trigger and target cleanup phase.

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
- Any durable consumer added or touched in this phase is pointed at direct replacement contracts unless blocked by an explicitly tracked shim.
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
- [x] Record deletion triggers for any temporary legacy-shaped projection.
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
- Every compatibility projection is either removed immediately or assigned a deletion trigger and future phase.
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
- [x] Check whether any touched consumer can migrate directly instead of adding a shim.
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

- [x] Define texture binding requirement shape.
- [x] Define texture entry and page record shapes.
- [x] Define replacement-native bucket keys instead of exposing legacy `TexturePlacementBucketKey` as the claim contract.
- [x] Implement owner claim registry.
- [x] Implement bucket virtual page registry.
- [x] Implement retain replacement semantics.
- [x] Implement owner-wide release semantics.
- [x] Keep lease/pin compatibility out of the replacement claim model; use owner claims and explicit installed-resource guards only if proven necessary.
- [x] Add tests for shared entries, replacement, release, and reclaim eligibility.

Decisions and course corrections:

- Phase 5 dry-run: reuse old texture placement identities as adapter inputs only. Replacement claim state should be `(MaterializationOwnerId, bucketKey, binding requirements)` and should not expose lease/pin semantics.
- Phase 6 completed on 2026-07-06.
- Added `open-world-streaming/texture-residency/claims` with replacement-native bucket keys and an `OpenWorldTextureClaimRegistry`.
- The registry treats `retainTextureBindings(ownerId, bucketKey, bindings)` as full replacement for that owner and bucket. Entries are shared by canonical texture/page/source facts, and owner release only marks entries/pages reclaimable.
- Added virtual page records and reservation tokens in the claim/page state. A stale page-build token is rejected without mutating page state; an accepted token advances the page to resident.
- Reclaimable pages remember their last active state. If an entry is claimed again before physical deletion, the virtual page stops reporting as reclaimable instead of lying about deletion.
- Spicy bit: Phase 6 intentionally did not expose compatibility adapters from legacy `TexturePlacementBucketKey` into the claim registry. That adapter belongs at the future domain source boundary, not in the replacement claim contract.
- Concession: Phase 6 does not yet assign entries to pages through real packing or emit texture commits. Phase 7 owns worker/page-build protocol and commit emission.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and focused `npm run test:ts -- src/lib/systems/open-world-streaming/texture-residency/claims/texture-claim-registry.test.ts`.

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

- [x] Define page build input/output protocol.
- [x] Classify reusable `texture-packing.worker.ts` responsibilities versus new page-build responsibilities.
- [x] Keep page build reservation tokens in replacement page-build state, not in the worker adapter.
- [x] Consume claim-registry page reservation tokens instead of minting worker-owned lifecycle tokens.
- [x] Implement worker client and handler.
- [x] Add token validation.
- [x] Add texture commit DTO and applier.
- [x] Add stale/noop/failure tests.
- [x] Add diagnostics for page build queue and commit timings.

Decisions and course corrections:

- Phase 5 dry-run: `texture-packing.worker.ts` can produce packed pages and pixels, but replacement-owned reservation/noop/stale-result policy must wrap it.
- Phase 6 steering: page-build protocol should accept explicit page ids and reservation tokens from replacement state, and should return enough data to update or noop those reservations without becoming the source of lifecycle truth.
- Phase 7 completed on 2026-07-06.
- Added a replacement-native page-build protocol under `texture-residency/page-build`. The worker protocol carries page ids and reservation tokens minted by the claim registry and intentionally does not expose legacy `placementRevision`.
- Added `WorkerPoolOpenWorldTexturePageBuilder` and `installOpenWorldTexturePageBuildWorkerHandler` around the standard worker pool/handler infrastructure. The existing `texture-packing.worker.ts` remains a reusable adapter candidate, not the replacement lifecycle contract.
- Extended the claim registry with accepted noop settlement so page-build results can retire reservations without pretending a texture upload occurred.
- Added token-validating page-build settlement. Stale results produce no commits; accepted page updates emit texture commits; accepted noops clear reservations without renderer mutation.
- Added a texture commit applier adapter that maps replacement commits to current renderer `TexturePlacementUpdate` calls.
- Spicy bit: current renderer texture upload DTO still requires an upload `bindingId` even though page upload is not conceptually owned by one binding. The replacement commit marks this as `uploadBindingId` and confines the wart to the renderer adapter boundary.
- Concession: Phase 7 defines diagnostics-relevant worker queue timing via the standard worker pool descriptions and tests the protocol/settlement path, but it does not yet surface those metrics in browser UI diagnostics. Phase 9 should review whether replacement-native diagnostics are enough before adding UI projections.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and focused `npm run test:ts -- src/lib/systems/open-world-streaming/texture-residency/claims/texture-claim-registry.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/page-build.test.ts src/lib/systems/open-world-streaming/texture-residency/commits/texture-commit-applier.test.ts`.

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
- Any legacy-shaped runtime or diagnostic output used by the harness is projected outside terrain, artifact-runner, texture-residency, and scene-commit internals.
- Frame gaps stay below the legacy terrain-only baseline.

Task checklist:

- [x] Seed terrain owner demand from scene interest.
- [x] Resolve landblock scene source for terrain.
- [x] Retain terrain texture bindings.
- [x] Produce terrain bake inputs from bake-facing placement facts.
- [x] Introduce a minimal artifact runner before terrain harness settlement, so terrain does not re-create `StaticCoordinator` continuations.
- [x] Adapt page-build settlement and texture commit applier through terrain artifact flow without importing renderer update DTOs into terrain domain code.
- [x] Emit terrain layer commits.
- [x] Apply terrain commits to renderer and scene query.
- [x] Keep terrain diagnostics replacement-native; add any needed legacy harness projection only at the outer runtime adapter.
- [x] Run terrain-only harness.

Decisions and course corrections:

- Phase 5 dry-run: terrain vertical slice should adapt existing resolver/baker transforms, but must not wrap `StaticCoordinator` or depend on same-commit texture residency.
- Phase 7 steering: terrain should consume page-build and texture-commit services through artifact-runner ports. Terrain source/bake code should not know about renderer `TexturePlacementUpdate` or the temporary `uploadBindingId` adapter wart.
- Phase 8 completed on 2026-07-06.
- Added `OpenWorldTerrainArtifactRunner` under `static-layers/terrain`. It resolves terrain through the existing landblock scene source fanout and bakes through the existing static baker, but does not import `StaticCoordinator`, `StaticSourceReadyWork`, or static coordinator commit deltas.
- Course correction: direct `StaticResolver.resolve(...)` cannot request `landblock-scene-lod-outdoor-layer` because that key is resolver-local and has no host route. The terrain runner now calls `StaticLandblockSceneLodSourceResolver.resolveSource(...)` and selects the terrain recipe from the fanout.
- The open-world controller now maps scene interest to terrain owner demand, owns owner currentness, applies texture commits before terrain scene commits for this vertical slice, and publishes terrain into the renderer plus `StaticSceneQuery`.
- The outer `ClientRuntime` adapter projects replacement terrain progress into legacy-shaped harness counters. This is a shim at the runtime boundary, not a replacement-internal diagnostics contract, and remains targeted for Phase 14/16 cutover cleanup.
- Spicy bit: terrain currently emits purpose-scoped synthetic resident texture pages for the vertical slice. This avoids debug-flat terrain and exercises loose texture/scene commit application, but real page builds and pixel materialization still need Phase 9 review before more static domains lean on the pattern.
- The synthetic terrain texture commit groups pages by terrain purpose rather than binding id. A browser harness run exposed that one page per binding exceeded the renderer's terrain page-role capacity; grouping by purpose matches the terrain material role model and keeps the temporary commit honest enough for Phase 8.
- Verification: `npm run check`, focused `npm run test:ts -- src/lib/systems/open-world-streaming/composition/runtime-pipeline.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/texture-residency/commits/texture-commit-applier.test.ts`, `npm run lint:ts`, `npm run lint:dead`, and `npm run format:check`.
- Harness verification: `npm run harness:browser -- --runtime-pipeline open-world-streaming --domains terrain --layer-distance 0 --timeout-ms 60000` settled with renderer `error: null`, 1 terrain commit, 3 terrain draw units, max renderer delta about 41.6 ms, and no frame gaps over 50 ms or 100 ms.
- Harness verification: `npm run harness:browser -- --runtime-pipeline open-world-streaming --domains terrain --layer-distance 1 --timeout-ms 60000` settled with renderer `error: null`, 9 terrain commits, 20 terrain draw units, max renderer delta about 42.7 ms, one 62 ms long task, and no frame gaps over 50 ms or 100 ms.

### Phase 9: Resteering Checkpoint 3 - Terrain Vertical Slice Review

Deliverables:

- Compare replacement terrain slice against legacy terrain-only harness results.
- Review source-tree boundaries and imports.
- Review replacement-native diagnostics for usefulness before more domains are added.
- Decide whether the placement/page contracts need simplification before more domains are added.
- Identify any consumer still reading legacy-shaped terrain/runtime diagnostics and decide whether to migrate it now or track a short-lived shim.

Acceptance criteria:

- Performance and correctness deltas are documented.
- Any boundary leaks are either corrected or explicitly accepted.
- Diagnostics explain replacement terrain readiness, texture claims, page builds, and scene commits without relying on legacy snapshot names.
- Durable diagnostics consumers use direct replacement contracts, not legacy snapshot projections.
- The next implementation span through the full-domain behavior checkpoint has been dry-run against the current source tree.
- Next phases are revised if terrain exposed a bad abstraction.

Task checklist:

- [x] Capture harness metrics.
- [x] Review import graph for new system.
- [x] Review diagnostics clarity.
- [x] Identify any diagnostic shim that belongs outside the replacement pipeline or should be deleted.
- [x] Migrate any touched surviving diagnostics consumer to replacement-native diagnostics instead of extending a shim.
- [x] Dry-run Phase 10, Phase 11, and Phase 12 against the current source tree.
- [x] Identify dependency/order changes, boundary leaks, shims, deletion targets, and test risks for the next implementation span.
- [x] Update plan decisions and future tasks.

Decisions and course corrections:

- Phase 9 completed on 2026-07-06.
- Terrain harness comparison: radius-1 replacement terrain settled with 9 terrain commits, 20 terrain draw units, renderer `error: null`, max renderer delta about 42.8 ms, one 58 ms long task, and no frame gaps over 50 ms or 100 ms. This materially avoids the legacy severe blackout profile from the investigation worksheet.
- Import audit found no `StaticCoordinator`, `StaticSourceReadyWork`, `StaticCoordinatorCommitDelta`, or `TextureManager` orchestration imports in replacement internals. Current legacy pressure points are the outer `ClientRuntime` shim, the renderer texture update adapter, the bake-facing legacy placement snapshot required by existing bakers, and tests.
- Diagnostics review found hard-coded replacement texture residency counts in the controller. Added `OpenWorldTextureClaimRegistry.createSnapshot()` and wired controller diagnostics to replacement-native bucket, claim, and in-flight page-build counts instead of cloning old texture-manager snapshots or lying with zeros.
- The browser harness still reads legacy-shaped runtime report fields such as `committedStaticCommitInstallCount`, `pendingStaticCommitInstallCount`, and `staticOverview`. This remains an outer runtime/harness shim and must not become a replacement diagnostics contract.
- Terrain's synthetic purpose-scoped texture pages are acceptable only for the Phase 8 vertical slice. Phase 10 must not extend synthetic resident texture pages to object domains unless a later steering step explicitly chooses that as a short-lived shim with a deletion trigger.
- Dry-running Phase 10 showed outdoor buildings, explicit objects, and generated scenery can reuse `StaticLandblockSceneLodSourceResolver.resolveSource(...)`, `createStaticObjectTexturePlacementIntents(...)`, and the static bake worker transforms, but they need object-visual commit application and real page-build/materialization integration before they can satisfy the direct-contract policy.
- Dry-running Phase 10 also showed the next outdoor domain should introduce a small shared static-layer artifact spine only where terrain/object behavior is actually common. Do not build a broad replacement `StaticCoordinator` clone.
- Dry-running Phase 11 showed env-cell work is not just another outdoor object layer. It needs env-cell system commits, `StaticSceneQuery.setEnvCellSystemLayer(...)`, renderer `setEnvCellSystemLayer(...)`, portal/interior/visibility records, and env-cell resource membership ports before dense landblocks can be trusted.
- Dry-running Phase 12 showed runtime-authored dynamics should reuse existing dynamic visual recipe and bake workers through adapters, but lifecycle/currentness must move to materialization owners and direct resource/instance commits rather than `ClientRuntimeImpl` prep revisions.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, focused `npm run test:ts -- src/lib/systems/open-world-streaming/texture-residency/claims/texture-claim-registry.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`, and `npm run harness:browser -- --runtime-pipeline open-world-streaming --domains terrain --layer-distance 1 --timeout-ms 60000`.

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
- Static-authored dynamic placement records emitted by outdoor object layers are parent-owned by static layer owner for first cut; resource and instance materialization is handled by Phase 12.
- Outdoor static object domains do not expose legacy static coordinator commit shapes, texture placement snapshots, or global texture mutation diagnostics as replacement contracts.
- Object domains use real replacement texture claim/page-build/commit flow or an explicitly tracked temporary shim; they do not inherit the Phase 8 synthetic terrain texture-page shortcut.
- Any legacy-shaped outdoor diagnostics or runtime summaries are produced only by the outer runtime/harness shim, and may be incomplete if the alternative would pollute the replacement contract.

Task checklist:

- [x] Extract shared static-layer artifact-runner primitives only where terrain and object domains have proven common behavior.
- [x] Adapt building source/bake/commit path.
- [x] Adapt explicit object source/bake/commit path.
- [x] Adapt generated scenery source/bake/commit path.
- [x] Add object-visual commit application to renderer and scene query without routing through legacy static commit installer.
- [x] Route object texture placement through replacement claim, page-build, and texture commit services.
- [x] Emit parent-owned static-authored dynamic placement records and move child resource materialization to Phase 12.
- [x] Migrate direct outdoor-domain consumers to replacement scene, texture, and diagnostics contracts; add legacy-side shims only for consumers that cannot move in this phase.
- [x] Name every outdoor-domain compatibility shim with its blocked consumer, dishonest-field risk, deletion trigger, and target cleanup phase.
- [x] Run terrain plus generated scenery benchmark.
- [x] Compare texture atlas page lifecycle diagnostics with legacy.

Decisions and course corrections:

- Phase 10 completed on 2026-07-06.
- Added `OpenWorldOutdoorObjectArtifactRunner` under `static-layers/outdoor-objects`. It reuses `StaticLandblockSceneLodSourceResolver`, `StaticObjectBakeResourceProvider`, `createStaticObjectTexturePlacementIntents(...)`, and `StaticBaker` as transforms/adapters, but does not wrap `StaticCoordinator` or route through `installStaticCommit(...)`.
- Source LoD is now derived from outdoor object layer kind: buildings use LoD 1, explicit objects use LoD 2, and generated scenery uses LoD 3. The first harness run exposed the bug by failing generated scenery requests against scene LoD 0.
- Added a replacement object visual texture placement plan that retains owner claims, packs current-task object texture entries, emits replacement texture commits, and provides the legacy bake-facing `ObjectVisualTexturePlacementSnapshot` only at the baker adapter edge.
- Spicy bit: bucket snapshots include entries retained by other owners. The object placement plan now builds commits only for entries touched by the current task because the claim registry intentionally does not store legacy source DTOs needed to rebuild unrelated entries. Broader cross-owner repack policy is deferred to Phase 13 review.
- Reused `StaticObjectBakeResourceProvider` so object bake jobs receive prepared gfx geometry sidecars. This is a durable transform adapter, not a coordinator shim.
- Static-authored dynamic placement records are emitted with parent static-layer ownership, but dynamic recipe baking, dynamic resource commits, and dynamic instance publication are moved to Phase 12. Pulling them into Phase 10 would start the runtime-entity system early and risk preserving `ClientRuntimeImpl` dynamic prep revisions.
- Outdoor-domain compatibility shim: the outer `browser-runtime-adapter` still projects replacement outdoor progress into legacy-shaped runtime counters for the harness. Blocked consumer: browser harness/runtime report. Dishonest-field risk: legacy fields such as `installedStaticDrawUnits` and `staticOverview` do not fully describe generated scenery visual resources. Deletion trigger: Phase 14 diagnostics migration, with final deletion in Phase 16.
- Concession: object texture packing and page pixel materialization currently run synchronously in the object placement plan rather than through the Phase 7 page-build worker. The replacement contract is direct, but Phase 13 must decide whether to move object page builds off the main loop before cutover.
- Performance debt: terrain plus generated scenery radius-1 settled and rendered generated scenery, but still showed `maxDeltaMs` around 490 ms and 17 long tasks with a max around 445 ms. This is better than the original severe blackout profile but still violates the continuous-streaming north star; Phase 13 should review frame-budgeting and worker coverage before browser cutover.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, focused `npm run test:ts -- src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/composition/runtime-pipeline.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts`, `npm run harness:browser -- --runtime-pipeline open-world-streaming --domains terrain,generated-scenery --layer-distance 1 --timeout-ms 60000`, and `npm run harness:browser -- --runtime-pipeline open-world-streaming --domains terrain,buildings,explicit-objects,generated-scenery --layer-distance 0 --timeout-ms 60000`.

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
- Env-cell diagnostics and portal records are replacement-native; any legacy overlay projection is outside the env-cell domain path.
- Any legacy env-cell overlay or diagnostics projection is allowed to be partial or temporarily broken rather than forcing env-cell commits to mimic legacy static coordinator snapshots.

Task checklist:

- [x] Adapt env-cell source resolution through the existing static source resolver, using env-cell source LoD 4 without importing coordinator state.
- [x] Adapt structured interior and env-cell static-object texture retain and bake.
- [x] Define env-cell renderer, scene-query, and resource-membership apply ports before wiring commits.
- [x] Emit env-cell system commits from replacement-native bake results, including structured interior draw units, env-cell static-object draw units, portal projections, resource membership, and static-authored dynamic placement records.
- [x] Apply portal records and resource membership.
- [x] Migrate direct env-cell overlay/query consumers to replacement commits and query records where feasible before adding any legacy diagnostic/report projection.
- [x] Name every env-cell compatibility shim with its blocked consumer, dishonest-field risk, deletion trigger, and target cleanup phase.
- [x] Run env-cell-focused harnesses.
- [ ] Compare dense landblock metrics, including `da55`.

Decisions and course corrections:

- Phase 11 implementation is steered toward a dedicated `static-layers/env-cells` domain runner rather than reusing the legacy env-cell publication helper. The helper is shaped around legacy static coordinator commit deltas and install results; using it would smuggle old commit vocabulary into the replacement domain.
- Env-cell source resolution should request the env-cell system layer directly from `StaticLandblockSceneLodSourceResolver` at source LoD 4. That keeps the useful resolver transform while avoiding `StaticCoordinator` ownership and scheduling.
- Env-cell texture placement must combine structured interior intents with static object intents. Dense env-cell bakes can include both interior geometry and static-object geometry, so a structured-interior-only plan produces dishonest readiness and missing object-visual placement ids.
- Env-cell payload assembly should be direct and replacement-native: payloads own portal projections, structured interior draw units, env-cell static-object draw units, source resource membership, and parent-owned static-authored dynamic placement records. Legacy static install summaries can be projected later only at the runtime/harness edge.
- Env-cell compatibility shim: the outer `ClientRuntime`/browser-runtime adapter may project replacement env-cell progress into legacy-shaped runtime counters for the harness. Blocked consumer: browser harness/runtime report and any un-migrated debug overlay still reading legacy reports. Dishonest-field risk: legacy installed/source draw-unit counters cannot fully explain portal/resource membership or independently committed texture readiness. Deletion trigger: Phase 14 diagnostics/UI migration, with final deletion in Phase 16.
- While integrating env-cells with outdoor object domains, the replacement object-visual placement plan was changed to assign bake-local numeric item ids itself. Concatenating structured-interior and static-object placement intents exposed reused upstream item ids, which caused `placementsByItemId` collisions and incorrect purpose lookups such as structured interiors reading `object-palette` placements as `object-base-color` placements.
- Direct env-cell query consumers were migrated through replacement controller ports for env-cell bounds, resource membership, and static ray picking. The outer runtime adapter remains a temporary `ClientRuntime` edge, but it now forwards to direct replacement query state instead of returning null.
- Verification passed for the env-cell-focused slice: `npm run check`, focused `npm run test:ts -- src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/systems/open-world-streaming/composition/runtime-pipeline.test.ts`, and `npm run harness:browser -- --runtime-pipeline open-world-streaming --domains terrain,env-cells --layer-distance 1 --timeout-ms 60000`.
- Blocking course correction: all-domain radius-1 did not settle. At 60s it reported 27 of 45 static commits applied, 18 pending, 9 long tasks, and max frame delta around 624 ms. At 120s it still reported 39 of 45 applied, 6 pending, 528 long tasks, and max frame delta around 642 ms. This violates the Phase 11 all-domain acceptance criterion and the continuous-streaming north star.
- Likely cause from the dry run and harness trace: all-domain static work is still processed as a long sequential task chain, while object/env-cell placement, packing, baking, and renderer uploads can keep producing main-thread long tasks. Phase 12 must not start until this is resteered, because runtime dynamics would add more materialization pressure on top of an already failing static path.

### Phase 11A: Full-Domain Static Settlement Resteer

Deliverables:

- Diagnose why all-domain radius-1 stalls with pending static commits after 120 seconds.
- Split the current sequential static-layer run into budgeted, resumable work or otherwise prove a narrower bottleneck.
- Move any remaining object/env-cell texture packing or materialization work off the main loop when it is responsible for repeated long tasks.
- Add replacement-native progress diagnostics that identify the active owner/domain/task when all-domain settlement is slow.
- Migrate any touched durable diagnostics or harness consumer to the direct replacement diagnostics contract where practical.
- Preserve direct replacement contracts; if a legacy-shaped progress report is still needed, implement it as a legacy-edge shim and allow it to be incomplete rather than distorting replacement diagnostics.

Acceptance criteria:

- All-domain radius-1 harness settles through the replacement pipeline within the standard 60s timeout.
- The same run has no repeated long-task plateau caused by replacement static materialization.
- Terrain plus env-cells remains green after the scheduler/materialization changes.
- Any new settlement diagnostics are replacement-native; any legacy report projection is named as a temporary shim with consumer, dishonest-field risk, deletion trigger, and cleanup phase.
- The plan records any remaining frame-budget debt with a deletion or follow-up target before Phase 12 starts.

Task checklist:

- [x] Capture per-domain task duration and active-task diagnostics in replacement-native form.
- [x] Update any touched durable harness/diagnostics consumer to read the replacement diagnostics contract directly before adding compatibility projection.
- [x] If a legacy progress/report shim remains necessary, keep it at the runtime, harness, or UI migration edge and record its deletion trigger.
- [x] Reclassify settlement diagnostics under the migration invariant: replacement diagnostics are direct contracts; legacy runtime report fields are an outer-edge shim and may be incomplete.
- [x] Identify whether the remaining bottleneck is scheduling order, source resolution, texture placement, page packing, bake work, renderer upload, or harness settle criteria.
- [x] Replace the single sequential static-interest loop with a budgeted/resumable runner if scheduling is the bottleneck.
- [x] Move remaining prepared-asset service work out of the browser main-thread service handler, or otherwise frame-budget that boundary, if worker source resolution still produces repeated long tasks.
- [ ] Reconcile the Phase 7 page-build protocol with object atlas layout, because the current protocol assumes page ids are known before layout while object visual packing discovers page count during packing.
- [x] Re-run terrain plus env-cells radius 1.
- [x] Re-run all-domain radius 1 with the 60s timeout.
- [ ] Update Phase 12 assumptions after the static path settles.

Decisions and course corrections:

- Added replacement-native static task diagnostics with active task arrays, per-domain task timing, apply timing, and substage timings for object/env-cell materialization. Legacy runtime reports still receive only an outer edge projection; replacement diagnostics now carry the actionable timing truth.
- Diagnostics resteer: do not fit replacement diagnostics against legacy runtime snapshot outputs. The legacy runtime report is allowed to be partial, awkward, or temporarily broken; the replacement `open-world-streaming` diagnostics contract is the truth source for Phase 11A and later steering.
- Bounded static materialization concurrency fixed the first settlement blocker but not the stutter blocker. A 6-wide all-domain radius-1 run settled 45 of 45 commits in about 60.7s, but still recorded 223 long tasks, a max long task around 515 ms, and a late repeated 80 ms long-task plateau.
- Routing object visual atlas packing through the injected worker-backed `TexturePacker` did not materially improve the long-task profile. It also exposed a direct-model gap: the Phase 7 page-build protocol reserves one page before dispatch, while object visual packing discovers page count and layout during packing. Do not force object domains into that protocol shape without redesigning the page-build contract.
- Replacement source resolution now reuses `planStaticDemand(...).sourceRequests` through a run-local coalescing resolver cache instead of making each static domain resolve the same landblock independently. This preserves the direct demand contract and reuses the existing source fanout transform without importing `StaticCoordinator` scheduling.
- Coalesced source resolution materially improved settlement: the all-domain radius-1 harness settled 45 of 45 commits in about 24.2s. Native timing dropped total static task duration from about 279.8s to about 121.3s in the compared diagnostic runs.
- The same coalesced-source harness still failed the stutter acceptance: it recorded 204 long tasks, max long task around 822 ms, max frame delta around 900 ms, and a late repeated 80-96 ms long-task plateau. Phase 11A remains incomplete.
- Lowering static materialization concurrency to 1 kept all-domain settlement inside the 60s gate at about 28.4s and improved long-task count from 204 to 150, with max long task around 609 ms and max frame delta around 651 ms. Keep this as a partial frame-budget improvement, not as Phase 11A completion.
- Failed experiment: adding browser-task yields inside object texture identity/source-prep loops made the all-domain run worse, settling around 41.4s with 231 long tasks. The plateau is not solved by sprinkling task yields into those loops; do not repeat that patch without stronger attribution.
- Added a direct raw host asset response boundary so static resolver workers can prepare host asset DTOs inside workers instead of always using the browser main-thread `PreparedAssetService` handler. This is a replacement-side worker/host adapter, not a legacy diagnostic shim.
- Raw worker-side asset preparation kept all-domain settlement inside the 60s gate at about 30.5s and improved the worst observed long task from the coalesced/concurrency-1 run, but still recorded about 160 long tasks and a max frame delta around 568 ms. Phase 11A remains incomplete.
- Failed experiment: transferring static bake input geometry buffers into bake workers did not improve the stutter profile. A run settled in about 31.7s but recorded 172 long tasks, max long task around 620 ms, and max frame delta around 663 ms. Some source geometry arrays are partial views, and even after safely skipping those transfers the result was worse; the experiment was reverted to avoid vestigial optimization code.
- Domain isolation changed the attribution. Terrain-only radius-1 is effectively clean, settling in about 1.6s with one 57 ms long task. Terrain plus generated scenery settles in about 14.0s with 16 long tasks and intermittent spikes up to about 306 ms. Terrain plus env-cells settles in about 21.8s but records 77 long tasks, max long task around 884 ms, max frame delta around 930 ms, and a repeated 50-60 ms plateau.
- Renderer diagnostics for the terrain plus env-cells run report about 1,991 static draw units, 1,243 static object baked direct draw calls, and small measured renderer handler time. This suggests the stutter is no longer only replacement materialization scheduling; steady-state renderer/browser/GPU work or WebGL command submission for dense env-cell static objects is now part of the Phase 11 blocker.
- Current course correction: Phase 12 must not start until the plan distinguishes materialization long tasks from steady-state renderer/browser long tasks and either reduces the env-cell static-object draw surface or explicitly moves that work behind a frame-budgeted renderer strategy. This is not a diagnostics-shape problem; do not launder legacy diagnostic fields to make the run look green.

### Phase 11B: Renderer And Browser Long-Task Attribution Resteer

Deliverables:

- Separate materialization long tasks from steady-state render/browser/GPU long tasks for terrain, generated scenery, env-cells, and all-domain radius-1 runs.
- Add replacement-native or harness-local timing evidence that can identify whether repeated long tasks occur before static readiness, during commit application, or after the scene is fully settled.
- Inspect env-cell static-object renderer paths and identify why dense env-cells produce thousands of direct draw calls in the replacement path.
- Choose a concrete frame-budget strategy before Phase 12: reduce env-cell draw-call surface, batch/instance env-cell static objects, cull or defer dense env-cell layers, or explicitly add renderer scheduling work as a new phase.
- Dry-run Phase 12 through Phase 13 after the renderer attribution and decide whether dynamic entity materialization can safely start.

Acceptance criteria:

- The plan records whether the remaining Phase 11A red metrics are materialization, commit application, renderer draw submission, browser rendering, GC, or unknown.
- Terrain plus env-cells either passes the frame-budget gate or has a concrete renderer remediation phase inserted before runtime dynamics.
- All-domain radius-1 still settles inside 60s after any attribution instrumentation.
- Any new diagnostics remain replacement-native or harness-local; no legacy runtime snapshot field becomes the source of truth.
- Phase 12 assumptions are updated with the renderer/frame-budget finding.

Task checklist:

- [x] Add or extract timing evidence that buckets long tasks as pre-ready, apply-time, or post-ready.
- [x] Inspect env-cell renderer/static-object draw-call paths and identify durable adapter versus replacement-owned work.
- [x] Compare terrain-only, terrain plus generated scenery, terrain plus env-cells, and all-domain runs using the same attribution.
- [x] Decide whether to implement immediate env-cell draw-call reduction or insert a dedicated renderer remediation phase before Phase 12.
- [x] Dry-run Phase 12 through Phase 13 against the renderer finding.
- [x] Update Phase 12 assumptions.

Decisions and course corrections:

- Added harness-local long-task attribution buckets for `beforeStaticRequest`, `beforeStaticReady`, `crossingStaticReady`, and `afterStaticReady`, plus the latest static readiness timing. This is harness evidence, not a replacement diagnostics contract or legacy runtime snapshot shape.
- Attribution matrix:
  - Terrain-only radius-1 settled in about 1.5s and had one 59 ms long task before the static request started. Treat this as page/bootstrap noise, not replacement materialization.
  - Terrain plus generated scenery settled in about 13.8s with 17 long tasks. Thirteen occurred before static readiness, three after readiness, and one before request. The max long task was about 276 ms.
  - Terrain plus env-cells settled in about 13.4s with 6 long tasks. Five occurred before static readiness and one before request; none occurred after readiness. The max long task was about 562 ms.
  - All-domain radius-1 settled in about 30.9s with 168 long tasks. 165 occurred before static readiness, two after readiness, and one before request. The repeated late 70-90 ms plateau is still pre-ready because readiness arrives near the end of the run.
- Renderer inspection found env-cell static objects currently install as baked direct static-object draw units, producing about 1,243 static-object baked direct draw calls in the terrain plus env-cells run and about 1,851 in the all-domain run. That is real renderer debt, but Phase 11B attribution does not support treating steady-state renderer submission as the primary Phase 11 blocker.
- Stage timing in the all-domain run points instead at pre-ready materialization pressure: texture placement totals about 8.3s across object/env-cell domains, bake waits about 10.0s, create-bake-resources about 2.3s, and create-texture-intents about 2.4s. Apply time totals only about 207 ms, with max apply under 35 ms.
- Course correction: do not insert a renderer remediation phase before Phase 12 solely for env-cell draw-call count. Insert a materialization-pressure remediation phase first. Renderer draw-call reduction remains debt for Phase 13 benchmark review unless future attribution shows post-ready renderer long tasks dominate.
- Dry-run Phase 12/13: runtime-authored dynamics would add dynamic visual resolution, texture placement, bake-resource assembly, worker responses, and renderer commits on top of the exact pre-ready pressure surface that is still red. Phase 12 remains blocked until the object/env-cell static materialization pressure is reduced or made frame-budget honest.
- Phase 12 assumption update: dynamic entities may reuse the same object-visual transforms, but they cannot inherit the current object/env-cell texture-placement and bake-result message profile as-is. Runtime dynamics need either a lower-pressure placement/resource path or a scheduler that can prove main-thread long tasks stay bounded.

### Phase 11C: Object Materialization Pressure Remediation

Deliverables:

- Attribute or reduce pre-ready object/env-cell materialization long tasks now shown by Phase 11B.
- Add terrain substage diagnostics or otherwise explain terrain's long-duration tasks, since terrain currently reports task duration without stage breakdown.
- Reduce main-thread pressure in object/env-cell texture placement, create-texture-intents, create-bake-resources, bake-result handling, or worker message boundaries.
- Reconcile the Phase 7 page-build protocol/object atlas layout gap before relying on object texture placement for runtime dynamics.
- Keep compatibility projections at the runtime/harness edge; do not fit replacement diagnostics to old static coordinator or texture-manager reports.

Acceptance criteria:

- All-domain radius-1 still settles inside 60s.
- All-domain radius-1 no longer has the repeated pre-ready long-task plateau caused by object/env-cell materialization.
- Terrain plus generated scenery and terrain plus env-cells remain green under the attribution harness.
- Stage diagnostics explain the dominant pre-ready work well enough to guide Phase 12.
- Phase 12 assumptions are updated after the materialization pressure remediation.

Task checklist:

- [x] Add terrain stage diagnostics or a documented reason terrain remains stage-less.
- [x] Inspect object/env-cell texture placement and create-bake-resource loops for main-thread CPU bursts.
- [x] Inspect worker response DTO sizes and structured-clone pressure for object/env-cell bake results.
- [x] Reconcile or redesign the object atlas page-build protocol gap from Phase 7.
- [x] Implement the smallest remediation that actually reduces pre-ready long tasks.
- [x] Run terrain-only, terrain plus generated scenery, terrain plus env-cells, and all-domain attribution harnesses.
- [x] Update Phase 12 assumptions.

Decisions and course corrections:

- Added terrain stage timings to replacement-native static task diagnostics. Terrain commits now report `resolve-source`, `create-texture-intents`, `texture-placement`, `create-bake-resources`, `bake`, and `assemble-commit` instead of appearing as opaque terrain task duration.
- Terrain-only radius-1 with stage diagnostics remained clean: it settled in about 1.5s and recorded only one pre-request long task. Terrain stage timing showed the center landblock spends most time in source resolution, not terrain bake, texture placement, or apply.
- All-domain radius-1 with terrain stages still settled inside 60s at about 31.1s, but remained red: 162 long tasks, 158 before static readiness, max long task about 537 ms, and the repeated pre-ready 70-90 ms plateau persisted.
- Updated all-domain stage totals show terrain source resolution accounts for about 7.2s, while object/env-cell domains still dominate the actionable pre-ready pressure: texture placement about 8.4s, bake waits about 10.1s, create-bake-resources about 2.4s, and create-texture-intents about 2.4s.
- Static bake result transfer and texture packing result transfer were already present at the worker-handler boundary. The missing-looking result transfer was not the gap.
- Failed experiment: wiring texture packing source pixels as `transferInput` detached prepared asset cache buffers. Subsequent material texture preparations saw zero-length texture arrays, producing errors such as `Prepared texture 06003789 expected 1048576 rgba8 bytes, got 0`. This proves texture packing input pixels are currently borrowed from shared prepared-asset cache state, not owned job buffers. Do not transfer packing inputs unless the placement path first copies or re-owns source pixels, or the prepared-asset cache contract changes.
- Follow-up experiment: copying prepared texture bytes into owned packing job sources and then transferring those source pixels avoided cache corruption, but did not reduce the red gate. Terrain plus generated scenery stayed roughly flat or slightly worse, and all-domain radius-1 still recorded about 162 long tasks with the same pre-ready plateau. The copy-plus-transfer path was removed rather than kept as vestigial optimization code.
- Added object texture placement substages under replacement-native diagnostics: `texture-source-preparation`, `texture-packing`, and `texture-page-settlement`. These are diagnostic children of the existing `texture-placement` stage, so they are used for attribution rather than exclusive accounting.
- Final all-domain radius-1 attribution with substage diagnostics still settled inside 60s at about 30.3s, but stayed red: 167 long tasks, 163 before static readiness, max long task about 570 ms, and max frame delta about 614 ms.
- The final substage split shows object texture placement is not dominated by page settlement. Across all object/env-cell domains, `texture-source-preparation` totals about 3.9s, `texture-packing` about 4.3s, and `texture-page-settlement` about 4 ms. The worst object domain remains generated scenery, with about 1.6s in source preparation and about 2.5s in packing.
- Current course correction: reducing structured-clone pressure for texture packing input requires an ownership redesign that avoids duplicating large source buffers on the main thread. Candidate directions are worker-local prepared texture access, a prepared-asset cache contract that can loan transferable buffers without corrupting later consumers, or moving source preparation into the same worker that packs. Phase 11C should pick one deliberately; do not smuggle it in as a hidden worker-pool optimization.
- Reconciled the Phase 7 page-build/object atlas protocol gap with a replacement-native object visual atlas build boundary. Object atlas layout is a multi-page pack job whose pages are discovered by the packer; main-thread page settlement now consumes packed pages and creates replacement virtual pages after layout instead of pretending object pages are known before dispatch. This is a direct replacement contract, not a legacy page-build shim.
- Removed the worker-backed object visual atlas builder experiment after measurement. It prepared texture sources inside the atlas worker through the existing prepared-asset service and lowered reported `texture-packing`, but increased reported `texture-source-preparation`; all-domain radius-1 regressed to about 34.3s with 181 long tasks, 177 before static readiness, max long task about 634 ms, and max frame delta about 675 ms. Keeping it would be vestigial optimization code.
- Kept the direct object visual atlas boundary because it fixes the object/page-build model without requiring the failed worker hop. The direct-boundary run settled all-domain radius-1 in about 31.0s with 155 long tasks, 152 before static readiness, max long task about 529 ms, and max frame delta about 572 ms. That is a modest improvement from the previous substage run, but the repeated pre-ready plateau remains.
- Direct-boundary stage totals: `resolve-source` about 7.2s, `texture-placement` about 8.2s, `bake` about 10.3s, `texture-source-preparation` about 3.9s, `texture-packing` about 4.3s, and `texture-page-settlement` about 3 ms. Apply remains small at about 203 ms total with max apply about 35 ms, and renderer upload summaries remain small. The remaining stutter is not explained by page settlement, texture commit apply, or measured renderer upload.
- Course correction: Phase 11C reconciled the object atlas contract and found no placement-only micro-remediation that clears the gate. The next work must distinguish worker wait time from browser/render work while partially loaded dense static layers are already visible. Phase 12 remains blocked; insert a renderer/draw-surface frame-budget remediation before runtime dynamics.
- Phase 11D completed the smallest effective remediation: dense static renderer publication is deferred until the static request has fully materialized. This removes the repeated pre-ready plateau while preserving direct object atlas contracts and native diagnostics. Phase 12 can proceed, but runtime dynamics must not assume progressive dense static renderer publication is already solved.

### Phase 11D: Pre-Ready Draw Surface And Frame-Budget Resteer

Deliverables:

- Determine whether the repeated pre-ready long-task plateau is caused by partially loaded scene draw surface, browser/GPU presentation, worker result cadence, or remaining materialization CPU.
- Compare all-domain runs with static commit application disabled, delayed, or reduced for dense object/env-cell surfaces to isolate renderer/browser work from worker materialization waits.
- If renderer/browser draw surface is implicated, implement the smallest honest remediation: defer dense non-terrain static draw publication, batch/instance env-cell/static-object draw units, reduce direct draw-call surface, or add a frame-budgeted publication strategy.
- Keep replacement diagnostics direct. Any harness convenience summary must read the native `open-world-streaming` diagnostics report instead of inventing legacy-shaped timing fields.
- Dry-run Phase 12 through Phase 13 after this attribution and decide whether dynamic entities can start.

Acceptance criteria:

- All-domain radius-1 settles inside 60s.
- The repeated pre-ready 70-90 ms long-task plateau is removed or attributed to a named browser/GPU limitation with a concrete remediation phase before Phase 12.
- Terrain plus generated scenery and terrain plus env-cells remain green under the attribution harness.
- Native diagnostics identify whether remaining long tasks are materialization, worker result delivery, commit publication, renderer/browser draw surface, or unknown.
- Phase 12 assumptions are updated before dynamic materialization starts.

Task checklist:

- [x] Add a harness/runtime experiment toggle that can delay or suppress dense static commit publication without changing materialization work.
- [x] Run all-domain radius-1 with normal publication and with delayed/suppressed dense object/env-cell publication.
- [x] Compare native static task timings, long-task attribution, renderer frame telemetry, and renderer draw/upload summaries.
- [x] Choose and implement the smallest draw-surface or publication-cadence remediation that reduces the pre-ready plateau.
- [x] Re-run terrain-only, terrain plus generated scenery, terrain plus env-cells, and all-domain attribution harnesses.
- [x] Update Phase 12 assumptions.

Decisions and course corrections:

- Added a replacement-owned static publication mode with three values: `normal`, `suppress-dense-renderer`, and `defer-dense-renderer-until-ready`. `suppress-dense-renderer` is harness attribution only. `defer-dense-renderer-until-ready` is now the replacement default.
- The attribution toggle leaves materialization, texture commits, scene-query publication, progress accounting, and native diagnostics intact. It only changes dense renderer layer publication for outdoor object and env-cell layers, so the comparison isolates draw-surface pressure without creating a dishonest legacy diagnostic shim.
- All-domain normal publication reproduced the red profile: about 30.9s to readiness, 162 long tasks, 159 before static readiness, max long task about 592 ms, total long-task time about 12.1s, and renderer frame handler time about 3.4s.
- All-domain `suppress-dense-renderer` settled in about 22.3s with 15 long tasks, 14 before static readiness, total long-task time about 2.5s, and renderer frame handler time about 362 ms. This proves dense renderer draw surface, not texture/page settlement or commit apply, caused the repeated pre-ready plateau.
- Implemented `defer-dense-renderer-until-ready`: dense static renderer layers are queued while static materialization is active and flushed when all requested static tasks have settled. Terrain still publishes normally. Texture commits and scene-query state still apply as commits arrive.
- All-domain deferred publication settled in about 22.4s with 19 long tasks, 16 before static readiness, total long-task time about 3.0s, and renderer frame handler time about 439 ms. The repeated 70-90 ms pre-ready plateau was removed. Two short post-ready long tasks remained around the dense renderer flush.
- Focused defer-mode matrix:
  - Terrain-only settled in about 1.5s with one pre-request long task and no pre-ready long tasks.
  - Terrain plus generated scenery settled in about 19.8s with 13 long tasks and no repeated pre-ready draw-surface plateau.
  - Terrain plus env-cells settled in about 19.8s with 7 long tasks and no repeated pre-ready draw-surface plateau.
- Concession: this is a deliberate visibility tradeoff. Dense non-terrain static visuals now appear after static materialization rather than progressively during the request. It is cleaner than stuttering while partially loaded dense layers render, but Phase 13 should revisit progressive publication with batching/instancing or a real renderer frame budget.
- Phase 12 assumption update: runtime-authored dynamics may start after this phase, but dynamic renderer publication must avoid recreating the old problem. Dynamic visuals should publish through an explicit frame-budgeted or low-density path, not by adding unbounded dense draw surface while materialization is still active.

### Phase 12: Runtime-Authored Dynamic Entities

Deliverables:

- Add runtime entity create/destroy entrypoints to the replacement path.
- Adapt dynamic visual recipe resolution and baking into artifact flow.
- Materialize static-authored dynamic placement records and recipes emitted by static layers.
- Publish runtime-authored dynamic resource commits and dynamic instance commits.
- Keep render residence separate from runtime entity lifetime.
- Apply the universal contract migration rule to runtime entity creation, destruction, render residence, diagnostics, and static-authored dynamic children before adding any legacy projection.

Acceptance criteria:

- Runtime spawned entities materialize through the replacement texture and visual path.
- Static-authored dynamic children emitted by outdoor object and env-cell static layers materialize through parent-owned dynamic records without preserving legacy prep revisions.
- Destroying an entity removes runtime state, renderer resources/instances, query records, diagnostics, and texture claims by owner.
- Render-residence changes suppress or restore publication without destroying materialized resources.
- Runtime entity consumers that survive cutover use replacement entity/resource/instance contracts directly.
- Legacy runtime entity projections are edge shims only and must not preserve `ClientRuntimeImpl` prep revisions, diagnostic categories, or lifecycle timing as replacement concepts.
- Any runtime entity consumer that cannot migrate directly must be listed as a legacy-edge shim with a deletion trigger; the replacement runtime-entity model stays canonical even if that shim is incomplete.

Task checklist:

- [x] Add runtime entity owner entrypoint.
- [x] Add static-authored dynamic child owner/parent membership entrypoint.
- [x] Adapt dynamic recipe resolution.
- [x] Reuse dynamic visual resolver and bake workers through adapters, not `ClientRuntimeImpl` prep revision state.
- [x] Retain runtime-authored dynamic texture bindings.
- [x] Retain static-authored dynamic texture bindings from parent-owned placement records and recipes.
- [x] Emit runtime dynamic resource commits.
- [x] Emit static-authored dynamic resource commits.
- [x] Emit dynamic instance projections from committed runtime state.
- [x] Emit dynamic instance projections from committed static-authored dynamic state.
- [x] Migrate durable runtime-entity diagnostics and UI consumers to direct replacement contracts.
- [x] Name every runtime-entity compatibility shim with its blocked consumer, dishonest-field risk, deletion trigger, and target cleanup phase.
- [x] Verify no runtime-entity shim preserves legacy prep revisions, lifecycle timing, or diagnostic categories as replacement concepts.
- [x] Add create/destroy/residence tests.

Decisions and course corrections:

- Added `open-world-streaming/runtime-entities` as the replacement-owned dynamic lifecycle and publication system. It reuses existing dynamic recipe resolution, bake sidecar creation, visual texture planning, and dynamic bake workers as transform adapters, but owner currentness, texture claims, renderer publication, and render residence now live in the replacement system.
- Runtime-authored entities now retain `runtime-entity:*` materialization owners, run dynamic visual prep through replacement texture placement, publish direct dynamic renderer resource commits, and publish dynamic instance commits. Destroy releases runtime state, renderer resources/instances, replacement texture claims, and owner membership.
- Static-authored dynamic placement records emitted by outdoor object and env-cell static layers now carry the replacement static parent owner id and are materialized as `static-authored-dynamic:*` child owners. Re-materializing a parent owner replaces its child set before adding new children so stale static-authored children do not linger.
- Render residence is explicitly separate from entity lifetime: no-residence suppresses instance publication while keeping the visual resource resident, and restoring residence republishes instances without re-preparing the resource.
- Native replacement diagnostics now expose runtime entity counts under `open-world-streaming.runtimeEntities`. The outer `ClientRuntime` diagnostics snapshot still returns an empty legacy-shaped dynamic snapshot. Compatibility shim: `browser-runtime-adapter` legacy dynamic snapshot. Blocked consumer: old `ClientRuntime` diagnostics snapshot shape. Dishonest-field risk: backfilling old dynamic prep categories would preserve `ClientRuntimeImpl` lifecycle timing as replacement truth. Deletion trigger: Phase 14 diagnostics/UI migration, with final deletion in Phase 16.
- Spicy bit: dynamic prep currently logs failed prep/bake as replacement runtime warnings and marks the entity non-renderable. That is intentionally louder than the previous silent conversion, but Phase 13 should decide whether these warnings need structured replacement diagnostics before browser cutover.

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
- Review whether every surviving consumer has a migration path to direct replacement contracts before browser cutover.
- Reapply the universal contract migration rule to every touched browser, harness, UI, diagnostics, renderer, texture, runtime entity, scene-query, and test consumer.
- Dry-run Phase 14 through the next steering phase and specifically decide whether to migrate direct, break temporarily, or delete each legacy-shaped consumer before adding more shims.
- Convert any diagnostics/harness consumer discovered during the dry run to direct replacement contracts unless it is explicitly named as a short-lived legacy-edge shim.

Acceptance criteria:

- Replacement pipeline materially reduces max frame gap and long task profile, or any blocking counterexample is routed into an immediate pre-cutover remediation phase.
- Texture memory and page lifecycle behavior are understood, or diagnostic gaps are routed into an immediate pre-cutover remediation phase.
- Any remaining legacy dependency is explicitly categorized as adapter, reusable transform, shim, or deletion target.
- Any legacy-compatible shim is outside replacement internals and has a deletion target.
- No shim is allowed to become the canonical contract for a surviving browser, harness, UI, or diagnostics consumer.
- Diagnostics are judged against replacement truth first. Legacy diagnostic projections may be incomplete during migration, but replacement diagnostics may not clone or launder legacy categories to keep dashboards green.
- Each touched consumer is classified using the universal contract migration rule before compatibility code is added.
- The next implementation span through the cutover deletion audit has been dry-run against the current source tree.

Task checklist:

- [x] Run benchmark matrix.
- [x] Capture and compare long task, frame gap, resolver, placement, bake, commit, and renderer metrics.
- [x] Review diagnostics output.
- [x] Review whether diagnostics are steering the replacement model or merely preserving old report shapes; delete or edge-isolate the latter.
- [x] Dry-run the remaining phases up to Phase 16 and classify every touched consumer as direct migration, legacy-edge shim, deletion, or durable adapter before adding compatibility code.
- [x] Audit compatibility shims and move/delete anything that pressures replacement internals toward legacy shapes.
- [x] For each remaining shim, choose direct consumer migration or explicit Phase 16 deletion.
- [x] For every surviving browser, harness, UI, diagnostics, and test consumer, choose one path: migrate to direct replacement contract, leave as named legacy-edge shim, or delete.
- [x] Delete or quarantine diagnostics/report projections that only exist to keep legacy output shapes looking complete.
- [x] Dry-run Phase 14 against the current source tree.
- [x] Identify dependency/order changes, boundary leaks, shims, deletion targets, and test risks for browser runtime cutover.
- [x] Update cleanup targets.

Decisions and course corrections:

- Phase 13 benchmark matrix:
  - Replacement `dc58`, radius 1, all domains: ready in 16.2 s, 15 long tasks, 286 ms max long task, 2.1 s total long-task time, max renderer frame delta 302 ms, max renderer handler 32.7 ms, max runtime tick handler 3.4 ms. Native open-world diagnostics reported 207 current owners, 45 ready artifacts, 15 texture buckets, 469 texture claims, 162 active static-authored runtime entities, 97 non-renderable runtime entities, 45 applied scene commits, and no failed static tasks.
  - Legacy `dc58`, radius 1, all domains: ready in 17.8 s, 161 long tasks, 741 ms max long task, 13.1 s total long-task time, max renderer frame delta 742 ms. The replacement path materially improves this stress case.
  - Replacement `da55`, radius 1, all domains: ready in 22.7 s, 19 long tasks, 536 ms max long task, 3.0 s total long-task time, max renderer frame delta 551 ms, max renderer handler 38.5 ms, max runtime tick handler 4.8 ms. Native open-world diagnostics reported 89 current owners, 45 ready artifacts, 17 texture buckets, 772 texture claims, 44 active static-authored runtime entities, 4 non-renderable runtime entities, 45 applied scene commits, and no failed static tasks.
  - Legacy `da55`, radius 1, all domains: ready in 15.8 s, 33 long tasks, 498 ms max long task, 4.7 s total long-task time, max renderer frame delta 514 ms. The replacement path reduces total long-task time but is not cleanly better on readiness or max gap for this landblock, so `da55` blocks cutover confidence.
  - Replacement `da55`, terrain plus generated scenery: ready in 12.3 s, 15 long tasks, 287 ms max long task, 1.8 s total long-task time, 44 active static-authored runtime entities, and 4 non-renderable runtime entities. This focused run reproduces most remaining replacement long-task pressure without env-cells.
  - Replacement `da55`, terrain plus env-cells: ready in 11.9 s, 6 long tasks, 596 ms max long task, 1.3 s total long-task time, and no runtime entities. Env-cells still have static materialization spikes, but generated scenery is the more immediate cutover blocker because it also activates dynamic publication and animation pressure.
- Resteer: insert Phase 13A before browser runtime cutover. Phase 14 must not start until generated-scenery dynamic publication, animation catch-up, and native diagnostics are cleaned up enough that `da55` no longer depends on legacy-shaped reports or noisy console warnings to explain behavior.
- The repeated `[holtburger-3d][dynamic-animation-hook-catchup-truncated]` warnings are not a legacy-diagnostics issue. They expose a real replacement behavior problem: static-authored dynamic entities can start animation publication late enough to dispatch or drop many crossed hook frames. Phase 13A should fix the animation/materialization start policy and aggregate this into replacement-native diagnostics instead of normal per-entity console spam.
- Replacement texture diagnostics are directionally honest but not complete enough to claim memory behavior is understood. They expose bucket count, claim count, and in-flight page builds, but not retained page count, approximate bytes, reclaimed page count, or pressure by owner/domain. Phase 13A must add replacement-native texture residency memory diagnostics instead of projecting legacy `textureAtlas` snapshots into the replacement contract.
- Harness readiness and summary output are still compatibility-pressure consumers. `BrowserPipelineHarness.svelte` still uses the outer legacy-shaped `RuntimeDiagnosticsReport.runtime` fields such as `pendingStaticCommitInstallCount`, `installedStaticDrawUnits`, and `sourceStaticDrawUnits`; `scripts/browser-pipeline-harness.mjs` still summarizes legacy domains such as `static-coordinator`, `static-commit-install`, and `texture-atlas`. These must migrate directly to `domains[].kind === "open-world-streaming"` for replacement runs, with any legacy report projection left as a harness-edge shim.
- Consumer classification from the Phase 14 dry run:
  - Direct migration: browser harness readiness, browser harness summary, debug/diagnostic UI that survives cutover, replacement benchmark assertions, static readiness reporting, texture residency reporting, runtime entity reporting, scene commit reporting, and replacement pipeline tests.
  - Legacy-edge shim: the current outer `ClientRuntime`-shaped runtime report in `browser-runtime-adapter`, only while legacy browser display and harness comparison still exist. It may remain incomplete or awkward and must not become the canonical replacement diagnostics shape.
  - Durable adapters: host asset access, static resolver workers, bake resource providers, renderer resource/instance commit boundaries, dynamic visual recipe transforms, and renderer query publication boundaries.
  - Deletion targets: legacy static coordinator diagnostics, legacy static commit installer diagnostics, legacy texture atlas snapshot projections, legacy dynamic prep diagnostics, tests that assert legacy report completeness, and any bridge whose only consumer is the retired legacy runtime path.
- The universal rule is now the default for the rest of the plan: migrate direct contracts first, shim legacy only at an edge, and prefer an incomplete legacy projection over dishonest replacement diagnostics. Diagnostics are not exempt.

### Phase 13A: Dynamic Publication and Native Diagnostics Resteer

Deliverables:

- Rework static-authored generated-scenery dynamic materialization so newly materialized entities do not trigger unbounded animation hook catch-up during initial publication.
- Decide and implement a replacement-native animation start policy for static-authored dynamic entities: publish at a truthful current pose without replaying stale hook history, or explicitly budget hook replay if gameplay semantics require it.
- Add replacement-native runtime entity diagnostics for prep, bake, non-renderable outcomes, animation catch-up truncation, dynamic resource commits, dynamic instance commits, and static-authored child ownership.
- Add replacement-native texture residency memory diagnostics: retained page count, approximate bytes or byte-estimate inputs, reclaimed page count, claim count by owner/domain where practical, and in-flight page builds.
- Migrate open-world browser harness readiness and summary reporting to direct `open-world-streaming` diagnostics for replacement runs.
- Leave legacy-shaped runtime, static coordinator, static commit install, texture atlas, and dynamic prep reports as legacy-edge shims only; do not backfill them inside replacement internals.
- Re-run the replacement `da55` generated-scenery and env-cell focused harness cases and the `da55` all-domain case after the remediation.

Acceptance criteria:

- Static-authored generated-scenery materialization no longer produces repeated normal-path `dynamic-animation-hook-catchup-truncated` console warnings.
- Replacement-native diagnostics explain dynamic prep/bake outcomes, animation catch-up decisions, runtime entity counts, texture memory pressure, texture page lifecycle, and scene commit state without relying on legacy report fields.
- Browser harness readiness for `--runtime-pipeline open-world-streaming` reads direct open-world diagnostics rather than legacy runtime counter projections.
- Browser harness summary surfaces open-world diagnostics directly for replacement runs.
- `da55` generated-scenery and all-domain runs improve or produce a clear next bottleneck with native attribution.
- Any remaining legacy-shaped diagnostic projection is named as a harness, UI migration, or legacy runtime shim with a Phase 16 deletion target.
- `npm run check`, `npm run lint:ts`, and focused tests pass.

Task checklist:

- [x] Inspect dynamic animation catch-up call sites and static-authored dynamic publication timing.
- [x] Implement the chosen static-authored animation start policy.
- [x] Replace normal-path per-entity catch-up warning spam with replacement-native aggregate diagnostics.
- [x] Add runtime entity diagnostic counters/timings for prep, bake, commits, non-renderable outcomes, and animation catch-up decisions.
- [x] Add texture residency memory and page lifecycle diagnostics to the replacement diagnostics contract.
- [x] Migrate replacement harness readiness to native open-world diagnostics.
- [x] Migrate replacement harness summary output to native open-world diagnostics.
- [x] Keep any legacy runtime report projection at the harness or runtime edge and record its deletion trigger.
- [x] Run focused dynamic/runtime-entity tests.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [x] Run app checks.
- [x] Update cleanup targets.

Decisions and course corrections:

- Static-authored dynamic animation hook catch-up is now reported through replacement-native runtime entity diagnostics instead of normal-path `console.warn` spam. The shared animation player still caps replay to the latest authored hook frames; it now emits structured truncation facts to callers. The replacement runtime entity system aggregates catch-up count, dropped hook frames, and recent samples.
- Async replacement dynamic prep now publishes renderer instance commits at the latest known frame time instead of always using `0`. That removes a fake timestamp from the replacement publication contract.
- Runtime entity diagnostics now report prep starts, recipe resolutions, bake successes/failures, skipped visuals, recent prep failures, dynamic resource commits, dynamic instance commits, max resources/instances per commit, and animation catch-up truncation. This is direct replacement truth, not a clone of legacy dynamic prep diagnostics.
- Texture residency diagnostics now report entry count, virtual page count by lifecycle state, in-flight page builds, and byte-estimate status. Exact approximate bytes remain intentionally `null` with reason `page-size-not-yet-canonical`; this is more honest than projecting legacy texture atlas byte totals onto replacement virtual pages before renderer page sizing is canonical.
- Browser harness readiness now uses direct `open-world-streaming` diagnostics for replacement runs: static task requested/completed/failed, artifact in-flight count, and scene commit pending count. Legacy runtime counters remain only as the outer `ClientRuntime` report shim for legacy/historical comparison.
- Browser harness summaries and trace samples now expose `openWorldStreaming` directly for replacement runs while keeping `staticCoordinator`, `staticCommitInstall`, and `textureAtlas` summaries as legacy-edge fields.
- Phase 13A replacement harness results:
  - `da55` terrain plus generated scenery: ready in 12.6 s, 16 long tasks, 304 ms max long task, 1.9 s total long-task time, max renderer frame delta 319 ms, max renderer handler 8.4 ms, max runtime handler 1.4 ms. Native diagnostics reported 44 active static-authored runtime entities, 4 non-renderable entities, 40 successful bakes, 0 prep failures, 33 catch-up truncations, 40 dropped hook frames, 69 resident virtual texture pages, 305 claims, and no page builds in flight.
  - `da55` terrain plus env-cells: ready in 11.5 s, 6 long tasks, 577 ms max long task, 1.2 s total long-task time, max renderer frame delta 590 ms, max renderer handler 14.7 ms, max runtime handler 0.1 ms. Native diagnostics reported no runtime entities, 20 resident virtual texture pages, 365 claims, and no page builds in flight.
  - `da55` all domains: ready in 22.8 s, 20 long tasks, 561 ms max long task, 3.1 s total long-task time, max renderer frame delta 577 ms, max renderer handler 43.3 ms, max runtime handler 3.1 ms. Native diagnostics reported 45 applied scene commits, 121 resident virtual texture pages, 772 claims, 44 active static-authored runtime entities, 40 successful bakes, 13 catch-up truncations, 13 dropped hook frames, and no prep failures.
- Resteer: Phase 13A made the pipeline honest and removed the console-warning trap, but it did not make `da55` all-domain cutover-safe. The next bottleneck is now clear: static materialization and texture placement still create pre-ready long tasks, and dynamic instance/resource publication is unbudgeted enough to create hundreds of commits during generated-scenery activation. Insert Phase 13B before browser cutover.
- Verification: `npm run check`, `npm run lint:ts`, focused `npm run test:ts -- src/lib/dynamic/dynamic-animation-player.test.ts src/lib/systems/open-world-streaming/runtime-entities/runtime-entity-system.test.ts src/lib/systems/open-world-streaming/texture-residency/claims/texture-claim-registry.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`, and the three Phase 13A replacement harness cases above. `npm run format:check` still fails on pre-existing untouched files: `src/lib/host/runtime-host.ts`, `src/lib/systems/open-world-streaming/composition/client-runtime-adapter.ts`, `src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`, and `src/lib/systems/open-world-streaming/runtime-entities/renderer-commits.ts`.

### Phase 13B: Static Materialization Frame Budget Resteer

Deliverables:

- Reduce replacement `da55` all-domain pre-ready long tasks before browser cutover.
- Add or apply frame-budgeted publication for expensive replacement work that still runs on the main thread, prioritizing object texture placement/page settlement, static commit application, and dynamic resource/instance publication churn.
- Keep replacement-native diagnostics as the steering source; do not use legacy static coordinator, static commit install, texture atlas, or dynamic prep snapshots as targets.
- Use the Phase 13A native diagnostics to identify whether the next remediation belongs in static task scheduling, texture residency/page build batching, dynamic commit coalescing, renderer publication, or a deliberately deferred visual publication policy.
- Apply the universal contract migration rule to any touched diagnostics, harness, readiness, renderer, or test consumer before adding compatibility output.
- Re-run `da55` generated-scenery, env-cell, and all-domain replacement harness cases after remediation.

Acceptance criteria:

- `da55` all-domain replacement run materially improves max long-task duration and max frame delta from the Phase 13A run, or produces a narrower native-diagnostics bottleneck that justifies a smaller follow-up before cutover.
- Generated-scenery dynamic activation remains console-warning clean and continues to expose catch-up behavior through native diagnostics.
- Texture residency diagnostics continue to expose page lifecycle, claim, and byte-estimate status directly.
- Browser harness readiness and summary continue to use direct `open-world-streaming` diagnostics for replacement runs.
- No new legacy-shaped diagnostics, timing fields, DTO projections, or architecture-preserving tests are added inside replacement internals.
- Any consumer touched during remediation is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the Phase 13B harness matrix pass.

Task checklist:

- [x] Analyze Phase 13A native stage timings and renderer/runtime frame diagnostics.
- [x] Decide whether the first remediation target is texture placement/page settlement, static commit application, dynamic commit coalescing, or renderer publication.
- [x] Implement the smallest direct replacement remediation that reduces main-thread burst pressure.
- [x] Add or update native diagnostics needed to prove the remediation.
- [x] Classify every touched consumer as direct migration, deletion, legacy-edge shim, or durable adapter.
- [x] Run focused tests for the touched replacement systems.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [x] Run app checks.
- [x] Update cleanup targets.

Decisions and course corrections:

- Phase 13B added a direct replacement frame-budget hook for static materialization runners and reports yielded passes through replacement-native diagnostics. This is not a legacy diagnostic shim; the controller owns the budget and the terrain, outdoor-object, and env-cell artifact runners consume the direct contract.
- The first remediation target was the chain of expensive main-thread static materialization stages rather than dynamic publication. Phase 13A showed env-cell focused runs had no runtime entities but still produced 577 ms max long tasks, so dynamic commit coalescing was not the first honest bottleneck.
- Consumer classification: the new frame-budget contract is direct replacement infrastructure; artifact runner tests were migrated directly to provide the contract; no legacy-edge shim was added. The existing `browser-runtime-adapter` legacy-shaped runtime report remains the previously named Phase 14/16 deletion-targeted shim.
- Phase 13B harness results:
  - `da55` terrain plus generated scenery: ready in 12.9 s, 17 long tasks, 279 ms max long task, 1.8 s total long-task time, max renderer frame delta 293 ms, max renderer handler 8.4 ms, max runtime handler 3.0 ms. Native diagnostics reported 90 frame-budget yields, 18 applied scene commits, 69 resident virtual texture pages, 305 claims, 44 active static-authored runtime entities, 40 successful bakes, 22 catch-up truncations, 22 dropped hook frames, and no prep failures.
  - `da55` terrain plus env-cells: ready in 12.7 s, 5 long tasks, 557 ms max long task, 1.2 s total long-task time, max renderer frame delta 570 ms, max renderer handler 13.5 ms, max runtime handler 0.1 ms. Native diagnostics reported 90 frame-budget yields, 18 applied scene commits, 20 resident virtual texture pages, 365 claims, no runtime entities, and no failed static tasks.
  - `da55` all domains: ready in 23.2 s, 17 long tasks, 576 ms max long task, 2.8 s total long-task time, max renderer frame delta 588 ms, max renderer handler 40.6 ms, max runtime handler 1.4 ms. Native diagnostics reported 225 frame-budget yields, 45 applied scene commits, 121 resident virtual texture pages, 772 claims, 44 active static-authored runtime entities, 40 successful bakes, 32 catch-up truncations, 32 dropped hook frames, and no prep failures.
- Resteer: coarse runner-level yielding reduces total burst pressure in generated-scenery and all-domain runs, but it does not improve all-domain max frame gap. The all-domain max long task regressed slightly from Phase 13A's 561 ms to 576 ms, and max frame delta regressed from 577 ms to 588 ms. Phase 13B therefore satisfies the "narrower native bottleneck" acceptance path, not the cutover-ready performance path.
- Narrowed bottleneck: outer-loop yields cannot split the hot single stages. Phase 13B attribution still shows outdoor terrain `resolve-source` wall time up to 3.5 s, env-cell `bake` up to 1.6 s, generated-scenery `bake` up to 1.1 s, env-cell `create-texture-intents` up to 576 ms, and generated-scenery `texture-placement` up to 355 ms. Phase 13C must target source/result delivery and intra-stage work slicing instead of adding more coarse yields around completed stages.
- Verification: `npm run check`, `npm run lint:ts`, focused `npm run test:ts -- src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts`, and the three Phase 13B replacement harness cases above. `npm run format:check` still fails on pre-existing untouched files: `src/lib/host/runtime-host.ts`, `src/lib/systems/open-world-streaming/composition/client-runtime-adapter.ts`, and `src/lib/systems/open-world-streaming/runtime-entities/renderer-commits.ts`.

### Phase 13C: Intra-Stage Materialization Slicing Resteer

Deliverables:

- Start only after Phase 13B is complete.
- Reduce `da55` all-domain max long-task duration and max renderer frame delta by splitting the hot single-stage work that Phase 13B exposed.
- Investigate and remediate terrain source result delivery for large landblocks, especially the `da55` terrain `resolve-source` path.
- Split or move expensive env-cell and generated-scenery bake, texture-intent, and texture-placement work that still runs as one browser task.
- Add replacement-native diagnostics that distinguish worker wait time, worker result transfer/deserialization, main-thread result assimilation, and intra-stage CPU slices where practical.
- Keep the universal contract migration rule active: migrate direct contracts first, shim legacy only at an edge, and prefer an incomplete legacy projection over dishonest replacement diagnostics.
- Re-run `da55` generated-scenery, env-cell, and all-domain replacement harness cases after remediation.

Acceptance criteria:

- `da55` all-domain replacement run materially improves max long-task duration and max frame delta from Phase 13B, or identifies a non-static renderer/browser bottleneck with direct replacement-native evidence.
- Terrain `resolve-source`, env-cell `bake`, generated-scenery `bake`, env-cell `create-texture-intents`, and generated-scenery `texture-placement` are either split, moved off the main thread, or explicitly ruled out with measured evidence.
- New diagnostics describe replacement concepts and do not clone legacy static coordinator, texture atlas, static commit install, or dynamic prep report shapes.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the Phase 13C harness matrix pass.

Task checklist:

- [x] Inspect terrain source resolver result delivery and identify whether wall time is worker wait, transfer/deserialization, or main-thread assimilation.
- [x] Inspect env-cell and generated-scenery bake/intent/placement loops for chunking or worker-boundary opportunities.
- [x] Implement the smallest direct replacement remediation that splits a measured hot single-stage browser task.
- [x] Add replacement-native diagnostics for the new split or transfer boundary.
- [x] Classify every touched consumer as direct migration, deletion, legacy-edge shim, or durable adapter.
- [x] Run focused tests for the touched replacement systems.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [x] Run app checks.
- [x] Update cleanup targets.

Decisions and course corrections:

- Phase 13C split replacement source resolution at the runner request boundary. `OpenWorldStaticSourceResolutionCache` still deduplicates identical requests, but it no longer upgrades a runner's layer-specific request to a broader all-layer landblock source request. This keeps terrain, object, and env-cell source results independently delivered to the browser instead of creating one larger worker result per landblock.
- This is a direct replacement composition change, not a legacy shim. The shared legacy demand planner still produces grouped source request opportunities for older paths, while the replacement composition chooses the smaller result boundary it wants.
- Consumer classification: `OpenWorldStaticSourceResolutionCache` is direct replacement infrastructure; the controller test was migrated to assert direct replacement request splitting; no legacy-edge shim was added. Existing `browser-runtime-adapter` compatibility remains the previously named deletion-targeted shim.
- Phase 13C harness results:
  - `da55` terrain plus generated scenery: ready in 14.0 s, 15 long tasks, 264 ms max long task, 1.7 s total long-task time, max renderer frame delta 278 ms, max renderer handler 6.9 ms, max runtime handler 2.3 ms. Native diagnostics reported 90 frame-budget yields, 18 applied scene commits, 69 resident virtual texture pages, 305 claims, 44 active static-authored runtime entities, 40 successful bakes, 2 catch-up truncations, 2 dropped hook frames, and no prep failures.
  - `da55` terrain plus env-cells: ready in 14.8 s, 4 long tasks, 528 ms max long task, 1.1 s total long-task time, max renderer frame delta 546 ms, max renderer handler 14.8 ms, max runtime handler 0.1 ms. Native diagnostics reported 90 frame-budget yields, 18 applied scene commits, 20 resident virtual texture pages, 365 claims, no runtime entities, and no failed static tasks.
  - `da55` all domains: ready in 28.6 s, 16 long tasks, 527 ms max long task, 2.7 s total long-task time, max renderer frame delta 543 ms, max renderer handler 38.4 ms, max runtime handler 5.1 ms. Native diagnostics reported 225 frame-budget yields, 45 applied scene commits, 121 resident virtual texture pages, 772 claims, 44 active static-authored runtime entities, 40 successful bakes, 16 catch-up truncations, 16 dropped hook frames, and no prep failures.
- Resteer: Phase 13C materially improves the all-domain max long task and max frame delta from Phase 13B's 576 ms / 588 ms to 527 ms / 543 ms, but readiness regresses from 23.2 s to 28.6 s because splitting source results duplicates source resolver work that was previously coalesced. This is smoother, but not a clean cutover endpoint.
- Narrowed bottleneck: terrain `resolve-source` is now split from all-layer landblock delivery, dropping the all-domain terrain center source stage from about 3.5 s in Phase 13B to about 0.8 s in Phase 13C. Remaining hot wall-time stages are env-cell `resolve-source` up to about 4.2 s, env-cell `bake` up to about 1.6 s, generated-scenery `bake` up to about 1.0 s, generated-scenery `resolve-source` up to about 0.8 s, and env-cell `create-texture-intents` up to about 527 ms.
- Rejected experiment: budgeted yielding inside static object and structured-interior texture intent planners was tested and discarded before commit. It raised generated-scenery readiness to about 19.1 s and worsened generated max frame delta to about 295 ms because the stage timing absorbed hundreds of timer yields without reducing the relevant browser long-task profile. The next remediation should not be naive per-material `setTimeout(0)` yielding inside planners.
- Resteer: insert Phase 13D before browser runtime cutover. It should recover the readiness regression by reusing landblock scene source loading while keeping domain-specific result delivery, and it should target env-cell source projection and intent planning with a real boundary change rather than timer-yield sprinkling.
- Verification: `npm run check`, `npm run lint:ts`, focused `npm run test:ts -- src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts`, and the three Phase 13C replacement harness cases above. `npm run format:check` still fails on pre-existing untouched files: `src/lib/host/runtime-host.ts`, `src/lib/systems/open-world-streaming/composition/client-runtime-adapter.ts`, and `src/lib/systems/open-world-streaming/runtime-entities/renderer-commits.ts`.

### Phase 13D: Source Reuse With Domain-Specific Result Delivery Resteer

Deliverables:

- Start only after Phase 13C is complete.
- Recover the Phase 13C readiness regression without returning to all-layer source result delivery.
- Reuse landblock scene LoD source loading across replacement domain requests while projecting and delivering terrain, object, and env-cell results independently.
- Investigate env-cell source projection and texture-intent planning as the next browser-facing bottlenecks.
- Keep bake work on worker boundaries and avoid main-thread planner timer-yield loops unless measured evidence shows they reduce browser long tasks without unacceptable readiness cost.
- Keep the universal contract migration rule active: migrate direct contracts first, shim legacy only at an edge, and prefer an incomplete legacy projection over dishonest replacement diagnostics.
- Re-run `da55` generated-scenery, env-cell, and all-domain replacement harness cases after remediation.

Acceptance criteria:

- `da55` all-domain replacement run preserves or improves Phase 13C max long-task duration and max frame delta while materially reducing the readiness regression.
- Replacement source delivery remains domain-specific; no runner receives all-layer source payloads merely for compatibility or cache convenience.
- Env-cell source projection and env-cell texture-intent planning are either split, moved off the main thread, or explicitly routed into a smaller follow-up with measured replacement-native evidence.
- No naive per-material timer-yield loop is added to planner internals without measured improvement in browser long-task metrics.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the Phase 13D harness matrix pass.

Task checklist:

- [ ] Inspect `LandblockSceneLodSourceResolver` and worker request flow for reusable scene payload loading with domain-specific projection.
- [ ] Add replacement-owned source projection/cache behavior that avoids duplicate scene asset resolution while preserving layer-specific worker results.
- [ ] Investigate env-cell texture-intent planner CPU shape without adding naive timer-yield loops.
- [ ] Add or update replacement-native diagnostics needed to prove source reuse versus result delivery.
- [ ] Classify every touched consumer as direct migration, deletion, legacy-edge shim, or durable adapter.
- [ ] Run focused tests for touched replacement/source systems.
- [ ] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [ ] Run app checks.
- [ ] Update cleanup targets.

Decisions and course corrections:

- Pending.

### Phase 14: Browser Runtime Cutover

Deliverables:

- Start only after Phase 13D is complete.
- Switch `createBrowserRuntime(...)` to the replacement composition.
- Keep the harness switch only if needed for one short verification window.
- Remove obsolete UI assumptions about legacy static coordinator diagnostics and migrate surviving panels to replacement-native diagnostics.
- Prefer temporary broken or partial legacy diagnostic reports over backfilling old fields from replacement data after cutover.
- Migrate surviving browser, harness, UI, and diagnostics consumers directly to replacement contracts before adding any cutover shim.
- Treat any cutover breakage in legacy-shaped diagnostics or panels as a consumer migration problem, not a reason to backfill old fields into the replacement runtime.

Acceptance criteria:

- Browser display and browser harness use the replacement runtime path by default.
- Legacy runtime path is not used by normal app routes.
- Surviving UI and diagnostics panels read direct replacement contracts instead of legacy-shaped runtime snapshots.
- Any remaining harness comparison shim is isolated, named as temporary, and scheduled for Phase 16 deletion.
- Browser cutover does not require legacy-shaped diagnostics to remain complete. Any temporary report gaps are tracked at the legacy edge instead of backfilled inside replacement internals.
- Cutover does not preserve a compatibility projection merely because an old diagnostic panel, benchmark summary, or test expects it.
- Every touched browser, harness, UI, diagnostics, and test consumer is either migrated to a direct replacement contract, deleted, or left behind a named deletion-targeted edge shim.
- `npm run check`, `npm run lint:ts`, and focused tests pass.

Task checklist:

- [ ] Switch runtime composition.
- [ ] Migrate diagnostics panels and overview snapshots to replacement-native contracts.
- [ ] Delete or isolate any legacy-shaped UI/harness projection that is not needed after the cutover window.
- [ ] Break or delete legacy-shaped diagnostics consumers that do not justify a named shim.
- [ ] Replace architecture-preserving diagnostic tests with tests over replacement-native contracts, or delete them if they only validate legacy projection completeness.
- [ ] Verify every surviving cutover consumer either reads the direct replacement contract or has a named, deletion-targeted edge shim.
- [ ] Record any intentionally broken or incomplete legacy-edge shim, including owner, dishonest-field risk, and Phase 16 deletion trigger.
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
- Dry-run Phase 16 from the current post-cutover tree and steer the cleanup checklist toward deletion of shims before adapter polish.

Acceptance criteria:

- Every shim has a deletion task.
- Every remaining adapter has a durable boundary reason.
- No normal browser or harness path depends on the old runtime pipeline.
- Every surviving consumer is either on a direct replacement contract or explicitly out of Phase 16 scope.
- The hard cutover cleanup phase has been dry-run against the current source tree.
- Cleanup scope is specific enough to run without guessing which code is still live.
- The audit has identified any remaining legacy diagnostic, harness, or UI projection that was intentionally allowed to be incomplete during migration.
- No shim survives the audit without a concrete Phase 16 deletion task.

Task checklist:

- [ ] Run import/dead-code inspection for old runtime, texture manager, and static coordinator paths.
- [ ] Classify remaining adapters and shims.
- [ ] Verify no surviving consumer depends on shim-only field names, timing assumptions, or legacy diagnostic categories.
- [ ] Verify every incomplete legacy-edge diagnostic or runtime projection is either deleted in Phase 16 or documented as an out-of-scope survivor.
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
- Delete compatibility tests, fixtures, and report projections that exist only to make old consumers look complete.
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
- Replacement diagnostics remain direct and honest; deleted legacy dashboards, broken transitional projections, or rewritten tests are acceptable outcomes.
- Remaining tests prove replacement behavior or reusable pure transforms, not retired orchestration contracts.
- Dead code tooling does not report newly orphaned modules.
- Source tree contains the replacement system as the authoritative pipeline.

Task checklist:

- [ ] Remove old runtime orchestration modules; keep only durable boundary adapters where the boundary still exists.
- [ ] Remove old texture manager paths no longer used.
- [ ] Remove old static coordinator continuation path if fully replaced.
- [ ] Delete shims that translate replacement artifacts back into retired legacy shapes.
- [ ] Audit remaining adapters and classify each as host, worker, renderer, diagnostics, harness, or delete.
- [ ] Delete legacy diagnostic projections rather than keeping them alive by inventing compatibility fields from replacement data.
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

### Risk: Compatibility Shims Become The Real Contract

Mitigation:

- Migrate durable consumers to direct replacement contracts instead of extending shims.
- Keep shims outside replacement internals and name them as compatibility projections.
- Require each shim to record its consumer, deletion trigger, and cleanup phase.
- Delete or rewrite tests that lock in shim-only field names, legacy timing assumptions, or legacy diagnostic categories.
- Accept temporary legacy-edge breakage or incomplete reports when the alternative would make replacement diagnostics dishonest.
- Apply the same rule to diagnostics and benchmark tooling: migrate direct contracts first, shim legacy only at the edge, and never use legacy report parity as the replacement design target.

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
