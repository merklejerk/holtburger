# Holtburger 3D Open World Streaming Materialization Remodel Plan

Date: 2026-07-06
Status: executed; post-cutover triage active.

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

- [Open-world streaming stutter investigation worksheet](./holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md)
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

- **Open-world streaming should feel continuous.** Radius-1 loading must not create browser blackouts, and the design should scale toward larger radii by keeping browser-owned work small instead of batching bigger bursts.
- **The worksheet is the implementation north star.** The [open-world streaming stutter investigation worksheet](./holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md) is historical evidence, but its replacement model requirements remain the target shape for texture policy, worker ownership, commit ordering, and readiness. Every phase after Phase 18 must be checked against the worksheet's root-cause direction before implementation starts. Before changing texture placement, material coverage, page builds, renderer readiness, or diagnostics, reread the relevant worksheet requirement and record any deliberate deviation in this plan. If current code and this remodel plan disagree, pause and reconcile against the worksheet before landing code.
- **Budgeting is a measured fallback, not an architecture.** Worker wall time is not a frame-stutter bug by itself. Add frame budgets only for proven browser-main-loop CPU offenders that cannot be deleted, moved off-thread, or collapsed into a smaller direct contract.
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
- Treat adapters and shims as different tools. An adapter crosses a durable external boundary while preserving the replacement model; a shim preserves an old consumer shape and is debt by definition.
- Treat shims as temporary compatibility debt, not as neutral adapters.
- Do not let shims define replacement naming, field layout, timing assumptions, diagnostics categories, tests, or source-tree placement.
- Treat legacy-shaped diagnostics, benchmark summaries, UI panels, and tests as consumers to migrate, break, or shim at the edge. They are not evidence that the replacement core should preserve old categories.
- Apply this policy to every contract surface: runtime composition, diagnostics, benchmark summaries, texture residency, source resolution, worker DTOs, renderer apply ports, scene query publication, UI panels, harness scenarios, and tests.
- Prefer breaking and updating a legacy-shaped consumer over preserving a dishonest compatibility projection in the replacement pipeline.
- Prefer a visibly incomplete or temporarily broken legacy shim over a compatibility layer that teaches the replacement system old concepts.
- A shim may be lossy, partial, or ugly if that keeps the replacement contract honest. A direct replacement contract may not become lossy, partial, or legacy-shaped just to keep an old report, test, panel, or DTO alive.
- If a phase introduces a shim, record the owning consumer, reason, deletion trigger, and target cleanup phase in that phase's decisions.
- If a consumer is meant to survive cutover, it must be migrated to the direct replacement contract before Phase 16 begins.
- Adapters may survive cutover only when they isolate a durable external boundary such as host assets, workers, renderer mutation, diagnostics export, or harness composition.
- Diagnostics follow the same rule as every other contract: replacement diagnostics are direct; legacy diagnostic snapshots are shims. Diagnostic compatibility is never a reason to move old categories into replacement internals.
- Each steering checkpoint must dry-run the remaining phases up to the next steering checkpoint and explicitly classify touched consumers as direct migration, legacy-edge shim, deletion, or durable adapter. If the answer is not clear, pause the phase before adding compatibility code.
- Do not use legacy report parity as evidence that the replacement contract is correct. A replacement diagnostic is correct when it explains the replacement model's actual ownership, scheduling, transfer, commit, and readiness behavior.
- If a legacy diagnostic report, benchmark summary, panel, or test becomes incomplete after a direct contract migration, leave that incompleteness at the legacy edge until the consumer is migrated or deleted. Do not backfill compatibility fields into replacement internals to make the old output look healthy.

Universal contract migration rule:

- Start from the direct replacement contract the new system actually wants.
- Migrate surviving consumers to that contract before translating anything.
- If a consumer cannot move yet, add the translation at that consumer's edge and name it as a shim.
- Do not put legacy-shaped DTOs, lifecycle timing, diagnostic categories, report fields, or test expectations inside replacement internals.
- Let edge shims be partial, awkward, or temporarily broken when the alternative is making replacement contracts dishonest.
- Apply the rule to diagnostics with the same strictness as runtime, renderer, texture, scene-query, harness, and UI contracts. Diagnostics are not an exception where legacy shape compatibility may re-enter replacement internals.
- When the direct replacement contract breaks a legacy consumer, prefer fixing, deleting, or edge-shimming that consumer over adding a compatibility field to the replacement core.
- When adding diagnostics, first name the behavior the replacement system needs to prove. Then migrate or shim consumers around that behavior. Do not start from a legacy output field and work backward.
- During implementation, a phase is not complete until every touched consumer has been classified as direct migration, deletion, legacy-edge shim, or durable adapter.
- During cleanup, every shim is guilty until deleted. Adapters may survive only when their boundary remains real after the old pipeline is gone.

Boundary decision order:

1. **Migrate direct.** If the consumer is expected to survive cutover, update it to the replacement-native contract.
2. **Delete.** If the consumer only preserves legacy architecture, remove it instead of translating it.
3. **Shim at the edge.** If immediate migration is too disruptive, add a named shim at the legacy, harness, UI migration, or runtime-adapter edge.
4. **Keep as durable adapter.** Only keep adapter code when it isolates an external boundary the replacement system will still need after cutover.

Adapter versus shim test:

- **Adapter:** "This boundary still exists after hard cutover, and the translation does not preserve retired concepts." Examples: host asset access, worker message transport, renderer mutation ports, diagnostics export plumbing, and harness composition.
- **Shim:** "This exists because an old consumer still expects an old shape." Examples: legacy runtime snapshots, old diagnostic categories, benchmark summaries that mirror retired fields, UI panels that assume static coordinator timing, and tests that preserve old orchestration contracts.
- If a module both adapts a durable boundary and preserves an old consumer shape, split the durable adapter from the temporary shim so Phase 16 can delete the shim without damaging the boundary.

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
- Spicy bit: the initial terrain vertical slice emitted purpose-scoped synthetic resident texture pages. This avoided debug-flat terrain and exercised loose texture/scene commit application, but real page builds and pixel materialization still needed Phase 9/18 follow-up before more static domains leaned on the pattern.
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
- Treat source reuse as a direct replacement composition contract: runners ask for the layer result they need, cache/coalescing may reuse broader source work internally, and only edge consumers may receive compatibility projections.
- Let replacement source diagnostics change shape to describe the new model honestly. Do not preserve legacy resolver diagnostics or harness summary fields inside replacement internals.
- Investigate env-cell source projection and texture-intent planning as the next browser-facing bottlenecks.
- Keep bake work on worker boundaries and avoid main-thread planner timer-yield loops unless measured evidence shows they reduce browser long tasks without unacceptable readiness cost.
- Keep the universal contract migration rule active: migrate direct contracts first, shim legacy only at an edge, and prefer an incomplete legacy projection over dishonest replacement diagnostics.
- Re-run `da55` generated-scenery, env-cell, and all-domain replacement harness cases after remediation.

Acceptance criteria:

- `da55` all-domain replacement run preserves or improves Phase 13C max long-task duration and max frame delta while materially reducing the readiness regression.
- Replacement source delivery remains domain-specific; no runner receives all-layer source payloads merely for compatibility or cache convenience.
- Replacement diagnostics report source reuse, runner-specific projection, and actual source submissions in replacement-native terms. Legacy resolver diagnostic parity is not an acceptance target.
- Any legacy-shaped harness or UI summary that cannot migrate directly is named as an edge shim and may be incomplete rather than forcing replacement diagnostics to mimic old output.
- Env-cell source projection and env-cell texture-intent planning are either split, moved off the main thread, or explicitly routed into a smaller follow-up with measured replacement-native evidence.
- No naive per-material timer-yield loop is added to planner internals without measured improvement in browser long-task metrics.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the Phase 13D harness matrix pass.

Task checklist:

- [x] Inspect `LandblockSceneLodSourceResolver` and worker request flow for reusable scene payload loading with domain-specific projection.
- [ ] Add replacement-owned source projection/cache behavior that avoids duplicate scene asset resolution while preserving layer-specific worker results.
- [x] Investigate env-cell texture-intent planner CPU shape without adding naive timer-yield loops.
- [x] Add or update replacement-native diagnostics needed to prove source reuse versus result delivery.
- [x] Migrate touched diagnostics, harness, and tests directly to the replacement source-resolution contract before adding any compatibility projection.
- [x] If a legacy diagnostics or harness shim is unavoidable, record its blocked consumer, dishonest-field risk, deletion trigger, and cleanup phase.
- [x] Classify every touched consumer as direct migration, deletion, legacy-edge shim, or durable adapter.
- [x] Run focused tests for touched replacement/source systems.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [x] Run app checks.
- [x] Update cleanup targets.

Decisions and course corrections:

- Phase 13D will use the universal contract migration rule as a hard gate, not as guidance text. Source reuse may coalesce broad landblock scene work internally, but the replacement runner contract remains domain-specific result delivery.
- Diagnostics course correction: source-resolution diagnostics are allowed to break legacy resolver/harness expectations. The replacement contract should explain actual submitted source work, runner reuse, and projected runner results; any old-shape summary belongs at the harness/UI/runtime-adapter edge and must be deletion-targeted.
- Consumer classification target for the phase: source cache/controller/tests are direct replacement consumers; resolver worker and prepared asset boundaries are durable adapters; browser runtime/harness legacy reports remain edge shims only if they cannot migrate directly in Phase 13D.
- Phase 13D uncovered a real source-reuse tradeoff rather than a clean fix. Cache-level coalescing can recover readiness or preserve frame smoothness, but the tested variants did not satisfy both acceptance gates at once.
- Rejected experiment: all-layer internal coalescing reused one broad source result per landblock and projected runner results afterward. It recovered all-domain readiness to about 23.4 s and reported `sourceResolution` as 45 projected results, 36 reused requests, and 0 direct requests, but regressed all-domain max long task/frame delta to about 587 ms / 600 ms versus Phase 13C's 527 ms / 543 ms. The likely cause is terrain waiting on and receiving work shaped by env-cell/all-layer source preparation again, even though runners receive projected results.
- Rejected experiment: terrain-direct plus non-terrain coalescing preserved all-domain max long task/frame delta at about 518 ms / 531 ms, but readiness only improved from Phase 13C's 28.6 s to about 27.7 s. That is not a material readiness recovery, and it regressed generated/env-cell focused readiness because those two-domain cases had no reusable non-terrain peer.
- Rejected experiment: outdoor-source coalescing with env-cells isolated improved all-domain readiness to about 25.6 s and produced the intended direct diagnostics shape, 9 direct terrain/env source submissions plus 36 projected non-env runner results and 27 reused runner requests. It still missed the frame gate at about 544 ms max long task and 561 ms max frame delta, so it does not satisfy Phase 13D acceptance.
- Current evidence points away from more controller-cache policy tuning. The next remediation should move source reuse/projection to a boundary that can reuse landblock scene source loading while emitting runner/domain-sized worker results, instead of choosing between duplicate resolver jobs and broad browser-facing source assimilation.
- Env-cell source projection remains the dominant unresolved shape issue. Env-cell focused runs stayed direct under the accepted diagnostic policy, but center env-cell source resolution still reached about 5.0 s wall time in the rejected variants. Do not hide that behind legacy diagnostics or timer-yield planner loops.
- Verification while investigating Phase 13D: `npm run check`, `npm run lint:ts`, focused `npm run test:ts -- src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts`, and the three `da55` harness matrices described above. Phase 13D is not complete because the source-reuse implementation did not satisfy its all-domain readiness plus frame acceptance criteria.

### Phase 13E: Worker-Side Source Projection Boundary Resteer

Deliverables:

- Start only after the Phase 13D cache-level variants are either reverted or intentionally narrowed.
- Move source reuse/projection closer to the resolver worker or prepared landblock scene source boundary so repeated domain jobs can share source loading without returning broad all-layer payloads to the browser composition cache.
- Keep replacement runner contracts domain-specific and direct. If a legacy harness/UI summary cannot consume the new source diagnostics, shim only at that edge.
- Preserve or improve Phase 13C all-domain max long task and max frame delta while materially reducing the Phase 13C readiness regression.
- Use replacement-native diagnostics to distinguish actual source submissions, shared source loads, worker-side projections, browser-delivered result size, and runner reuse.
- Decide whether env-cell source projection can be split from env-cell texture-intent planning in this phase or whether it needs its own narrower remediation phase before Phase 14.
- Dry-run Phase 14 through the next steering phase after the worker-side source boundary is proven.

Acceptance criteria:

- `da55` all-domain replacement run improves Phase 13C readiness materially and keeps max long task/frame delta at or below Phase 13C's 527 ms / 543 ms baseline.
- No replacement runner receives all-layer source payloads for cache convenience.
- Browser-delivered source results are domain-sized or otherwise measured small enough to avoid the broad-result assimilation spike seen in Phase 13D.
- Source diagnostics are replacement-native and do not clone legacy resolver diagnostics. Any legacy-shaped projection is named as an edge shim with a deletion trigger.
- Env-cell source and texture-intent bottlenecks are either remediated or explicitly scheduled before Phase 14 with measured evidence.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` generated/env-cell/all-domain harness matrix pass.

Task checklist:

- [x] Revert or narrow unaccepted Phase 13D cache-level source coalescing before building the worker-side boundary.
- [x] Inspect static resolver worker request lifetime and prepared landblock scene asset ownership for a reusable source-load cache that does not reuse broad result payloads.
- [x] Add worker-side or resolver-side source projection diagnostics: source loads, projected layer results, browser result sizes, and projection timings.
- [x] Implement shared source loading with domain-specific worker responses.
- [x] Verify runner-facing results stay domain-specific with focused controller/source tests.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [ ] Dry-run Phase 14 through the next steering checkpoint and update consumer classifications.

Decisions and course corrections:

- Phase 13E implemented a worker/resolver-side projection boundary that streams one domain-sized projected result per runner layer instead of returning broad all-layer source payloads to the browser composition cache. This preserves the direct runner contract while allowing one shared source stream per landblock.
- Added replacement-native source-resolution diagnostics for direct source requests, source stream requests, projected runner results, runner reuse, projected static recipe count, projected dynamic placement/recipe counts, total projection time, and max projection time. This intentionally does not clone legacy `StaticSourceResolutionDiagnostics`.
- Correctness fix: projected source waiters now reject on superseded interest, stream failure, or stream completion without the expected runner result. Multiple waiters for the same projected key are preserved instead of overwritten.
- Consumer classification: controller source cache and source-resolution diagnostics are direct replacement contracts; static resolver worker transport is a durable worker adapter; focused tests were migrated directly to the replacement projection contract; no new legacy-edge shim was added.
- Verification passed before harness: `npm run check`, `npm run lint:ts`, focused `npm run test:ts -- src/lib/static/resolver/worker-client.test.ts src/lib/static/resolver/landblock-scene-lod-source-resolver.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts`.
- Phase 13E harness evidence: `da55` terrain plus generated scenery was ready in about 12.2 s with 14 long tasks, 268 ms max long task, 281 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, 18 projected recipes, 44 projected dynamic placements, and 44 projected dynamic recipes.
- Phase 13E harness evidence: `da55` terrain plus env-cells was ready in about 10.4 s with 4 long tasks, 576 ms max long task, 588 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, 18 projected recipes, and no projected dynamic placements or recipes.
- Phase 13E harness evidence: `da55` all domains was ready in about 20.6 s with 18 long tasks, 579 ms max long task, 591 ms max frame delta, 9 source stream requests, 45 projected runner results, 36 reused runner requests, 45 projected recipes, 44 projected dynamic placements, and 44 projected dynamic recipes.
- Phase 13E is not complete and must not be committed yet. It materially improves Phase 13C all-domain readiness from about 28.6 s to about 20.6 s, but it fails the Phase 13C frame gate of 527 ms max long task and 543 ms max frame delta. The env-cell-focused case also regresses the Phase 13C env-cell max long task/frame from about 528 ms / 546 ms to about 576 ms / 588 ms.
- Course correction: the next remediation should keep the direct worker-side projection contract, but split or budget the env-cell-heavy browser-facing assimilation/apply path before Phase 14. More legacy-shaped diagnostics would be a trap here; the current native source diagnostics already show the source stream count and projected payload mix.

### Phase 13F: Env-Cell Projection And Apply Frame-Gate Resteer

Deliverables:

- Start only after Phase 13E has documented the failed frame gate and left the worker-side projection boundary uncommitted.
- Dry-run Phase 14 through the next steering checkpoint before adding more compatibility code, and classify touched consumers as direct migration, deletion, legacy-edge shim, or durable adapter.
- Identify whether the remaining >570 ms browser stalls come from env-cell projected result assimilation, env-cell texture-intent planning, env-cell scene commit apply, renderer env-cell install, or a combination of those boundaries.
- Split or frame-budget the narrowest replacement-owned env-cell-heavy browser boundary that preserves domain-specific runner results and does not recreate broad source payloads.
- Keep source diagnostics direct and native. If a harness or UI summary cannot consume the richer source-resolution contract, shim only at that edge and record the deletion trigger.
- Decide whether Phase 14 can proceed after this phase or whether another measured pre-cutover remediation is required.

Acceptance criteria:

- `da55` all-domain replacement run keeps the Phase 13E readiness recovery materially better than Phase 13C and brings max long task/frame delta back at or below Phase 13C's 527 ms / 543 ms gate.
- `da55` terrain plus env-cells does not regress the Phase 13C env-cell frame gate after the remediation.
- No replacement runner receives all-layer source payloads for cache convenience.
- Browser-delivered source results remain domain-sized and native source diagnostics continue to report actual source streams, projected runner results, runner reuse, projected payload counts, and projection timing.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` generated/env-cell/all-domain harness matrix pass.

Task checklist:

- [x] Dry-run Phase 14 through the next steering checkpoint and record consumer classifications before implementation.
- [x] Inspect env-cell projected-result assimilation, texture-intent planning, scene commit apply, and renderer install timings with replacement-native evidence.
- [x] Implement the smallest direct replacement remediation for the measured env-cell-heavy browser boundary.
- [x] Preserve the worker-side projection contract and domain-specific runner result delivery.
- [x] Update source/static-task diagnostics only if the new evidence needs direct replacement fields; do not clone legacy coordinator output.
- [x] Run focused tests for touched resolver, controller, env-cell runner, texture, or renderer boundaries.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [ ] Update Phase 14 and Phase 15 if the dry run exposes new cutover or deletion work.

Decisions and course corrections:

- Phase 13F dry-run of Phase 14 found the known cutover consumers: `BrowserDisplay.svelte`, `BrowserPipelineHarness.svelte`, `createBrowserRuntime(...)`, `OpenWorldStreamingClientRuntimeAdapter`, legacy `RuntimeDiagnosticsReport` projections, and legacy runtime/static/texture tests. Durable consumers should migrate directly to replacement diagnostics and overview contracts. The outer `ClientRuntime` adapter remains the only named legacy-edge shim pressure point; source-resolution and env-cell diagnostics stay direct replacement contracts.
- Native evidence from Phase 13E showed env-cell commit apply and renderer install were not the primary >570 ms source. Env-cell apply stayed around 20-25 ms while `create-texture-intents` reported 576-580 ms on heavy env-cell tasks. Final deferred dense renderer publication is also currently invisible to the open-world readiness gate, but it is not the first all-domain max-frame offender.
- Implemented an optional direct planning-budget hook for structured-interior and static-object texture-intent planners, enabled only by replacement open-world runners. Legacy callers keep existing behavior unless they opt in. This is a reusable transform scheduling hook, not a legacy shim.
- Verification passed before harness: `npm run check`, `npm run lint:ts`, and focused `npm run test:ts -- src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`.
- Phase 13F harness evidence: `da55` terrain plus generated scenery was ready in about 11.7 s with 13 long tasks, 266 ms max long task, 280 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, and 99 frame-budget yields.
- Phase 13F harness evidence: `da55` terrain plus env-cells was ready in about 10.5 s with 4 long tasks, 526 ms max long task, 539 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, and 101 frame-budget yields. This no longer regresses the Phase 13C env-cell frame gate.
- Phase 13F harness evidence: `da55` all domains was ready in about 21.9 s with 16 long tasks, 578 ms max long task, 590 ms max frame delta, 9 source stream requests, 45 projected runner results, 36 reused runner requests, and 246 frame-budget yields.
- Phase 13F is not complete and must not be committed yet. It fixes the env-cell-only acceptance gate, but all-domain still fails Phase 13C's 527 ms / 543 ms frame gate.
- Course correction: the optional planner-budget hook yielded after planner checkpoints, but the heaviest all-domain env-cell `create-texture-intents` work still measured about 592 ms because the expensive work occurs inside `planStructuredInteriorCellMaterials(...)` before the new checkpoints. The next remediation must decompose or cache structured-interior material planning itself, not add more edge yields around it.

### Phase 13G: Structured-Interior Material Planning Decomposition

Deliverables:

- Start only after Phase 13F has documented the failed all-domain frame gate and left the planning-budget hook uncommitted.
- Inspect `planStructuredInteriorCellMaterials(...)` and its inputs to identify the smallest domain-native decomposition point for heavy env-cell material planning.
- Split, cache, or move the structured-interior material planning work so replacement env-cell texture-intent planning can yield before any single browser task exceeds the Phase 13C frame gate.
- Keep planner contracts direct and reusable. Do not introduce diagnostics or DTOs shaped like the legacy static coordinator.
- Re-evaluate deferred dense renderer publication readiness after the structured-interior planner spike is fixed; schedule a separate publication-readiness phase only if measured evidence still shows post-ready renderer flush stalls.

Acceptance criteria:

- `da55` all-domain replacement run keeps the Phase 13E readiness recovery materially better than Phase 13C and brings max long task/frame delta back at or below Phase 13C's 527 ms / 543 ms gate.
- `da55` terrain plus env-cells remains at or below Phase 13C's env-cell frame gate.
- No replacement runner receives all-layer source payloads for cache convenience.
- Browser-delivered source results remain domain-sized and native source/static-task diagnostics prove the new planner decomposition.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` generated/env-cell/all-domain harness matrix pass.

Task checklist:

- [x] Inspect structured-interior material planning internals and identify the heavy synchronous loop.
- [x] Implement a direct replacement-friendly decomposition, cache, or worker boundary for structured-interior material planning.
- [x] Preserve reusable transform behavior for legacy callers unless they opt into the new scheduling contract.
- [x] Add focused tests for the decomposed planner behavior and open-world env-cell runner integration.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [ ] Decide whether deferred dense renderer publication readiness needs a follow-up phase before Phase 14.

Decisions and course corrections:

- Phase 13G introduced a reusable `StructuredInteriorMaterialPlanner` context that precomputes payload-wide material lookup/detail-role state and caches object-visual material plans by material id. The existing synchronous `planStructuredInteriorCellMaterials(...)` remains available for legacy/reusable callers, while replacement texture-intent planning uses the budgeted planner path.
- Consumer classification: structured-interior material planning remains a reusable transform; the replacement env-cell placement planner is a direct consumer of the budgeted contract; legacy callers keep the synchronous wrapper; no legacy-edge shim was added.
- Verification passed before harness: `npm run check`, `npm run lint:ts`, and focused `npm run test:ts -- src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`.
- Phase 13G harness evidence: `da55` terrain plus generated scenery was ready in about 12.3 s with 15 long tasks, 294 ms max long task, 306 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, and 99 frame-budget yields.
- Phase 13G harness evidence: `da55` terrain plus env-cells was ready in about 10.8 s with 4 long tasks, 591 ms max long task, 603 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, and 97 frame-budget yields. This regressed the Phase 13F env-cell frame result and fails the Phase 13C env-cell frame gate.
- Phase 13G harness evidence: `da55` all domains was ready in about 21.4 s with 19 long tasks, 538 ms max long task, 550 ms max frame delta, 9 source stream requests, 45 projected runner results, 36 reused runner requests, and 241 frame-budget yields. This is close to, but still above, the Phase 13C all-domain 527 ms / 543 ms frame gate.
- Phase 13G is not complete and must not be committed yet. The cached planner reduced the heavy structured-interior stage in the all-domain trace, but the env-cell-only trace still showed a heavy `create-texture-intents` stage around 602 ms on a single env-cell landblock.
- Course correction: caching material classification by material id is useful but insufficient. The next remediation must split env-cell texture-intent creation below the per-landblock/per-env-cell task boundary, or move the remaining structured-interior intent expansion to a worker-owned/direct replacement boundary. More wrapper-level yields will not fix a single synchronous planner call that still runs for hundreds of milliseconds.

### Phase 13H: Env-Cell Texture Intent Chunk Boundary

Deliverables:

- Start only after Phase 13G has documented the failed env-cell/all-domain frame gates and left the cached material planner uncommitted.
- Split env-cell structured-interior texture-intent creation into smaller replacement-owned chunks, or move that intent expansion to a worker boundary that returns domain-native intent results.
- Keep the reusable material planner cache if it remains beneficial, but do not treat it as the final remediation.
- Preserve direct replacement source diagnostics and domain-sized source result delivery.
- Decide after measured evidence whether deferred dense renderer publication readiness still needs its own follow-up before Phase 14.

Acceptance criteria:

- `da55` all-domain replacement run keeps the Phase 13E readiness recovery materially better than Phase 13C and brings max long task/frame delta back at or below Phase 13C's 527 ms / 543 ms gate.
- `da55` terrain plus env-cells is at or below Phase 13C's env-cell frame gate.
- No replacement runner receives all-layer source payloads for cache convenience.
- Native static-task diagnostics show the remaining env-cell `create-texture-intents` chunks no longer produce a single hundreds-of-ms browser task.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` generated/env-cell/all-domain harness matrix pass.

Task checklist:

- [x] Inspect env-cell texture-intent creation data dependencies enough to choose chunking versus worker ownership.
- [x] Implement the chosen direct replacement chunk/worker boundary.
- [x] Preserve the reusable material planner cache only if it still removes real repeated work.
- [x] Add focused tests for chunk ordering, dedupe behavior, and replacement runner integration.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [ ] Decide whether deferred dense renderer publication readiness needs a follow-up phase before Phase 14.

Decisions and course corrections:

- Phase 13H implemented a role-level material texture identity cache inside structured-interior texture-intent creation and yields before env-cell, surface, and identity-cache-miss boundaries. This keeps the direct replacement scheduling contract and does not add a legacy shim.
- Consumer classification: structured-interior placement planning remains a reusable transform; replacement runners opt into cooperative scheduling; legacy callers may benefit from identity dedupe but do not depend on the replacement frame-budget contract; no legacy-edge shim was added.
- Verification passed before harness: `npm run check`, `npm run lint:ts`, and focused `npm run test:ts -- src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`.
- Phase 13H harness evidence: `da55` terrain plus generated scenery was ready in about 11.9 s with 11 long tasks, 259 ms max long task, 271 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, and 99 frame-budget yields.
- Phase 13H harness evidence: `da55` terrain plus env-cells was ready in about 10.7 s with 4 long tasks, 533 ms max long task, 545 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, and 97 frame-budget yields. This is very close to, but still above, the Phase 13C env-cell long-task gate.
- Phase 13H harness evidence: `da55` all domains was ready in about 21.3 s with 15 long tasks, 548 ms max long task, 560 ms max frame delta, 9 source stream requests, 45 projected runner results, 36 reused runner requests, and 241 frame-budget yields. This still fails the Phase 13C all-domain 527 ms / 543 ms frame gate.
- Phase 13H is not complete and must not be committed yet. Role-level identity caching improved generated-scenery and kept readiness recovered, but it did not eliminate the env-cell/all-domain long browser tasks.
- Diagnostic gap: `create-texture-intents` stage timings are wall-clock durations and include cooperative yields, so they no longer prove whether a single browser task is hundreds of milliseconds. The harness long-task/frame gate remains authoritative, but the next remediation needs direct chunk/worker evidence instead of relying only on stage wall-clock.
- Course correction: more main-thread wrapper yields and small caches are now low-confidence. The next remediation should either move structured-interior texture-intent expansion behind a worker-owned direct replacement boundary or introduce chunk diagnostics fine-grained enough to prove sub-task durations while making the planner actually resumable between chunks.

### Phase 13I: Texture Intent Worker Boundary Or Resumable Chunk Resteer

Deliverables:

- Start only after Phase 13H has documented the failed env-cell/all-domain frame gates and left role-level identity caching uncommitted.
- Choose between a worker-owned structured-interior texture-intent expansion boundary and a genuinely resumable main-thread chunker based on current code dependencies.
- If using a worker boundary, keep worker messages domain-native and direct; do not return legacy coordinator DTOs or static source diagnostics.
- If using resumable chunks, add native diagnostics that distinguish chunk count, max chunk CPU time, yielded chunk count, and final intent aggregation time.
- Preserve domain-sized source result delivery and the source projection diagnostics from Phase 13E.
- Decide after measured evidence whether deferred dense renderer publication readiness still needs its own follow-up before Phase 14.

Acceptance criteria:

- `da55` all-domain replacement run keeps the Phase 13E readiness recovery materially better than Phase 13C and brings max long task/frame delta back at or below Phase 13C's 527 ms / 543 ms gate.
- `da55` terrain plus env-cells is at or below Phase 13C's env-cell frame gate.
- No replacement runner receives all-layer source payloads for cache convenience.
- Native diagnostics prove the new intent boundary with direct chunk or worker evidence, not legacy coordinator snapshots.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` generated/env-cell/all-domain harness matrix pass.

Task checklist:

- [x] Inspect structured-interior intent dependencies to choose worker boundary versus resumable chunks.
- [x] Implement the chosen direct replacement intent boundary.
- [x] Add native chunk/worker diagnostics sufficient to prove no single planner chunk remains hundreds of milliseconds.
- [x] Preserve source projection and domain-sized runner result contracts.
- [x] Add focused tests for the new boundary and replacement runner integration.
- [ ] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [ ] Decide whether deferred dense renderer publication readiness needs a follow-up phase before Phase 14.

Decisions and course corrections:

- Phase 13I chose a genuinely resumable main-thread chunker over a worker boundary for the first attempt. A worker boundary would have to carry prepared asset access and palette fingerprinting through a new direct worker contract, while the current code could first prove chunk CPU with lower blast radius.
- Added replacement-native `texture-intent-chunk` and `texture-intent-aggregation` stage timings with `itemCount`. These are direct static-task diagnostics, not legacy coordinator snapshots.
- Phase 13I preserved source projection and domain-sized runner result contracts; no replacement runner receives all-layer source payloads.
- Consumer classification: structured-interior placement planning remains a reusable transform; replacement env-cell runner consumes the direct chunk diagnostics through existing task timing; no legacy-edge shim was added.
- Verification passed before harness: `npm run check`, `npm run lint:ts`, and focused `npm run test:ts -- src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`.
- Phase 13I harness evidence: `da55` terrain plus env-cells was ready in about 10.6 s with 5 long tasks, 517 ms max long task, 530 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, and 97 frame-budget yields. This satisfies the Phase 13C env-cell frame gate.
- Phase 13I harness evidence: `da55` all domains was ready in about 21.1 s with 17 long tasks, 564 ms max long task, 577 ms max frame delta, 9 source stream requests, 45 projected runner results, 36 reused runner requests, and 241 frame-budget yields. This fails the Phase 13C all-domain 527 ms / 543 ms frame gate. The generated-scenery case was not rerun after this failure because the phase was already rejected.
- Phase 13I is not complete and must not be committed yet. The direct chunk diagnostics show the new `texture-intent-chunk` entries are tiny, so texture-intent CPU is no longer the proven single-task culprit.
- Course correction: all-domain max-frame failure now points toward env-cell bake output transfer/deserialization, heavy env-cell source/result assimilation, or another worker-result delivery boundary. Renderer apply and renderer frame handlers remain small in the failing trace. The next remediation should instrument and split the env-cell bake/source transfer boundary before adding more planner chunks.

### Phase 13J: Env-Cell Worker Result Transfer Boundary

Deliverables:

- Start only after Phase 13I has documented that resumable texture-intent chunks satisfy the env-cell-focused gate but all-domain still fails.
- Add direct replacement diagnostics that distinguish env-cell bake worker wait time, worker result transfer/deserialization, main-thread result assimilation, texture commit apply, and renderer publication work where practical.
- Define those diagnostics from replacement behavior first: worker wait, transfer/deserialization, assimilation, apply, publication, readiness, and frame-budget impact. Do not preserve old static coordinator, texture manager, or harness summary categories in the replacement runner just to keep old output stable.
- Decide whether the remaining all-domain max task comes from static bake worker output, resolver/source projection output, texture page-build output, or deferred dense renderer publication.
- Split or move the measured worker-result delivery boundary without changing replacement runner contracts back to broad all-layer source payloads.
- Preserve native source diagnostics, intent chunk diagnostics, and domain-sized runner result delivery.
- If a legacy harness, panel, or snapshot cannot consume the new transfer-boundary diagnostics, add a named edge shim or let that report be visibly incomplete until Phase 14/16 migration deletes or rewrites it.
- Decide after measured evidence whether deferred dense renderer publication readiness still needs its own follow-up before Phase 14.

Acceptance criteria:

- `da55` all-domain replacement run keeps the Phase 13E readiness recovery materially better than Phase 13C and brings max long task/frame delta back at or below Phase 13C's 527 ms / 543 ms gate.
- `da55` terrain plus env-cells remains at or below Phase 13C's env-cell frame gate.
- No replacement runner receives all-layer source payloads for cache convenience.
- Native diagnostics prove the remaining worker-result/transfer boundary with direct replacement evidence, not legacy coordinator snapshots.
- No legacy-shaped diagnostic field is added to replacement internals as a substitute for migrating or edge-shimming an old consumer.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` generated/env-cell/all-domain harness matrix pass.

Task checklist:

- [x] Inspect static bake worker, resolver worker, and texture page-build worker response paths for transfer/deserialization blind spots.
- [x] Add direct replacement diagnostics for the measured worker-result boundary.
- [x] Classify every diagnostics consumer touched by the new worker-result evidence as direct migration, deletion, legacy-edge shim, or durable adapter before adding compatibility fields.
- [ ] Implement the smallest split or moved boundary that removes the all-domain max task.
- [x] Preserve source projection, intent chunk diagnostics, and domain-sized runner result contracts.
- [x] Add focused tests for the new worker-result boundary and replacement runner integration.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [ ] Decide whether deferred dense renderer publication readiness needs a follow-up phase before Phase 14.

Decisions and course corrections:

- Steering note: Phase 13J should treat diagnostics as a proof tool, not as a compatibility surface. If the direct transfer-boundary contract breaks old summaries, the correct first move is to migrate the surviving consumer or isolate a legacy-edge shim, not to teach the replacement runner old categories.
- Phase 13J added a direct worker-boundary diagnostic event from the static bake worker immediately before result delivery, plus replacement-native `bake-worker-wait` and `bake-result-transfer` task stages consumed by terrain, outdoor-object, and env-cell runners. This is a durable worker-adapter diagnostic, not a legacy coordinator snapshot.
- Consumer classification: static bake worker transport is a durable adapter; open-world static runners are direct replacement diagnostics consumers; runner tests and worker protocol tests were migrated directly; no legacy-edge shim was added.
- Verification passed before harness: `npm run check`, `npm run lint:ts`, and focused `npm run test:ts -- src/lib/static/bake/worker-client.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts`.
- Phase 13J harness evidence: `da55` terrain plus generated scenery was ready in about 11.9 s request duration with 13 long tasks, 276 ms max long task, 290 ms max frame delta, 9 source stream requests, 18 projected runner results, and 9 reused runner requests. Max generated-scenery `bake-worker-wait` was about 989 ms, while max generated-scenery `bake-result-transfer` was about 14 ms.
- Phase 13J harness evidence: `da55` terrain plus env-cells was ready in about 10.2 s request duration with 4 long tasks, 579 ms max long task, 591 ms max frame delta, 9 source stream requests, 18 projected runner results, and 9 reused runner requests. Max env-cell `bake-worker-wait` was about 1.59 s, but that is worker-side time; max env-cell `bake-result-transfer` was about 87 ms for the center landblock result.
- Phase 13J harness evidence: `da55` all domains was ready in about 20.9 s request duration with 16 long tasks, 557 ms max long task, 569 ms max frame delta, 9 source stream requests, 45 projected runner results, and 36 reused runner requests. Max all-domain `bake-result-transfer` was about 80 ms and max renderer frame handler was about 42 ms.
- Phase 13J is not complete and must not be committed yet. The direct worker-boundary diagnostics falsify the working theory that static bake result transfer/deserialization is the main 500 ms browser-task culprit. The remaining all-domain/env-cell gate failure is now more likely source projection result delivery/assimilation, large source-projection progress delivery, readiness sequencing around source-stream completion, or another browser-side task adjacent to source/result publication.
- Course correction: do not keep tuning bake result transfer or legacy-shaped diagnostics. The next remediation should instrument and, if proven, split the resolver/source projection delivery boundary with the same direct-contract policy: worker-side source projection may stay broad internally, but browser-facing projected result delivery and assimilation must be domain-sized, budgeted, and measured.

### Phase 13K: Source Projection Delivery Boundary Resteer

Deliverables:

- Start only after Phase 13J has documented that static bake result transfer is measurable but not the dominant 500 ms browser-task source.
- Add direct replacement diagnostics for resolver/source projection result delivery: worker-side projection completion, projected payload delivery/deserialization, main-thread source result assimilation, and cache waiter release timing.
- Keep source diagnostics replacement-native. Do not backfill legacy resolver or harness fields to make old summaries look complete.
- Split or budget the measured browser-facing source projection delivery/assimilation boundary if it is the remaining long-task source.
- Preserve domain-sized runner result contracts, texture-intent chunk diagnostics, and static bake worker-boundary diagnostics.
- Decide with measured evidence whether deferred dense renderer publication readiness still needs a follow-up before Phase 14.

Acceptance criteria:

- `da55` all-domain replacement run keeps the Phase 13E readiness recovery materially better than Phase 13C and brings max long task/frame delta back at or below Phase 13C's 527 ms / 543 ms gate.
- `da55` terrain plus env-cells remains at or below Phase 13C's env-cell frame gate.
- No replacement runner receives all-layer source payloads for cache convenience.
- Native diagnostics prove source projection delivery/assimilation or rule it out with direct replacement evidence.
- No legacy-shaped diagnostic field is added to replacement internals as a substitute for migrating or edge-shimming an old consumer.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` generated/env-cell/all-domain harness matrix pass.

Task checklist:

- [x] Inspect resolver worker progress/result delivery and source cache waiter release paths for browser-side delivery/assimilation blind spots.
- [x] Add direct source projection delivery diagnostics without cloning legacy resolver snapshots.
- [ ] Implement the smallest measured split or budgeted assimilation boundary that removes the env-cell/all-domain max task.
- [x] Preserve source projection, intent chunk diagnostics, bake worker-boundary diagnostics, and domain-sized runner result contracts.
- [x] Add focused tests for source projection delivery diagnostics and replacement source cache integration.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [ ] Decide whether deferred dense renderer publication readiness needs a follow-up phase before Phase 14.

Decisions and course corrections:

- Phase 13K added direct source projection delivery diagnostics: browser delivery/deserialization timing from worker completion to cache callback, main-thread source result assimilation timing, and projected waiter release counts. These are replacement-native source stream facts and do not clone legacy resolver snapshots.
- Consumer classification: resolver worker projection progress remains a durable worker adapter; source cache diagnostics are direct replacement diagnostics; controller diagnostics tests were migrated directly to the expanded source-resolution contract; no legacy-edge shim was added.
- Verification passed before harness: `npm run check`, `npm run lint:ts`, and focused `npm run test:ts -- src/lib/static/resolver/worker-client.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`.
- Phase 13K harness probe evidence: `da55` all domains was ready in about 21.2 s request duration with 17 long tasks, 588 ms max long task, 599.5 ms max frame delta, 9 source stream requests, 45 projected runner results, and 36 reused runner requests. Source projection delivery was not the culprit: max projected delivery was about 40 ms and max projected assimilation was about 0.1 ms.
- Phase 13K is not complete and must not be committed yet. The direct diagnostics falsify the working theory that source projection delivery, source result assimilation, or cache waiter release is the remaining 500 ms browser-task source.
- Course correction: stop tuning source delivery. The remaining evidence points toward texture residency/page-build continuation work or another browser-side continuation adjacent to texture placement and object visual atlas building. The next remediation should instrument texture placement, page build, and page publication boundaries with direct replacement diagnostics before changing scheduling.

### Phase 13L: Texture Residency Page-Build Continuation Resteer

Deliverables:

- Start only after Phase 13K has documented that source projection delivery/assimilation is measurable but not the dominant 500 ms browser-task source.
- Add direct replacement diagnostics for texture placement, object visual atlas building, texture source preparation, packing worker wait, packing result delivery, page settlement, and binding update publication.
- Distinguish wall-clock waits from main-thread CPU chunks. Existing texture stage wall timings are useful but not enough because they include awaits and do not prove browser task size.
- Split or budget the measured texture residency/page-build continuation boundary if it is the remaining long-task source.
- Preserve source projection delivery diagnostics, texture-intent chunk diagnostics, static bake worker-boundary diagnostics, and domain-sized runner result contracts.
- Decide with measured evidence whether deferred dense renderer publication readiness still needs a follow-up before Phase 14.

Acceptance criteria:

- `da55` all-domain replacement run keeps the Phase 13E readiness recovery materially better than Phase 13C and brings max long task/frame delta back at or below Phase 13C's 527 ms / 543 ms gate.
- `da55` terrain plus env-cells remains at or below Phase 13C's env-cell frame gate.
- No replacement runner receives all-layer source payloads for cache convenience.
- Native diagnostics prove the texture residency/page-build continuation boundary or rule it out with direct replacement evidence.
- No legacy-shaped diagnostic field is added to replacement internals as a substitute for migrating or edge-shimming an old consumer.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` generated/env-cell/all-domain harness matrix pass.

Task checklist:

- [x] Inspect object visual atlas builder, texture placement plan, texture packing worker, and texture commit apply paths for browser-side continuation blind spots.
- [x] Add direct texture residency/page-build diagnostics without cloning legacy `TextureManager` snapshots.
- [x] Implement the smallest measured split or budgeted page-build/settlement boundary that removes the all-domain max task.
- [x] Preserve source projection delivery diagnostics, intent chunk diagnostics, bake worker-boundary diagnostics, and domain-sized runner result contracts.
- [x] Add focused tests for texture residency/page-build diagnostics and replacement runner integration.
- [x] Run replacement `da55` generated-scenery, env-cell, and all-domain harness cases.
- [x] Decide whether deferred dense renderer publication readiness needs a follow-up phase before Phase 14.

Decisions and course corrections:

- Phase 13L added direct texture residency/page-build diagnostics for texture source preparation chunks, cooperative source-preparation yields, texture packing worker result transfer, and per-page settlement. These are replacement-native static task stages and do not clone legacy `TextureManager` snapshots.
- Phase 13L split object visual texture source preparation into small browser-side batches before dispatching texture packing. The first measured split uses 8 texture entries per batch, reports `texture-source-preparation-chunk` per entry, and yields between batches so page-build continuation work can no longer hide inside one opaque `texture-placement` wall time.
- Texture packing workers now emit a direct `result-ready` progress event immediately before result transfer. `WorkerPoolTexturePacker.packWithDiagnostics()` records worker wait and delivery timing so texture packing can be separated from browser delivery/deserialization without introducing legacy-shaped diagnostics.
- Consumer classification: texture packing worker progress is a durable worker adapter; texture residency/page-build stages are direct replacement diagnostics; touched tests were migrated to direct contracts. No legacy-edge shim was added.
- Verification before harness passed: `npm run check`, `npm run lint:ts`, and focused `npm run test:ts -- src/lib/textures/packing/worker-client.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts`.
- Phase 13L harness evidence:
  - `da55` terrain plus generated-scenery was ready in about 11.7 s with 11 long tasks, 270 ms max long task, 283 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, 18 completed static tasks, and no failures.
  - `da55` terrain plus env-cells was ready in about 11.2 s with 4 long tasks, 532 ms max long task, 543.6 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, 18 completed static tasks, and no failures.
  - `da55` all domains was ready in about 22.1 s with 18 long tasks, 521 ms max long task, 532.9 ms max frame delta, 9 source stream requests, 45 projected runner results, 36 reused runner requests, 45 completed static tasks, and no failures.
- Phase 13L is not complete and must not be committed yet. It fixes the all-domain Phase 13C gate while preserving the Phase 13E readiness recovery, but the env-cell-focused case narrowly misses the env-cell gate at 532 ms max long task and 543.6 ms max frame delta.
- Course correction: deferred dense renderer publication is not the next bottleneck; the all-domain renderer handler stayed at about 45 ms and the focused env-cell renderer handler stayed at about 12 ms. The remaining work should target the env-cell browser-side CPU continuation exposed by the new direct texture/source diagnostics, not renderer publication or legacy diagnostic projection.

### Phase 13M: Env-Cell Tail Frame-Budget Resteer

Deliverables:

- Start only after Phase 13L has documented the all-domain recovery and the narrow env-cell-focused gate miss.
- Dry-run Phase 14 from the current tree and steer only the work required before browser runtime cutover.
- Use Phase 13L and 13M direct diagnostics to identify the remaining env-cell browser-side CPU chunk. Prefer removing, moving, or reusing the proven hot continuation over adding broader retries, compatibility projections, renderer publication work, or fine-grained main-thread budgeting.
- Keep the universal contract migration rule active: migrate direct contracts first, shim legacy only at an edge, and prefer an incomplete legacy projection over dishonest replacement diagnostics.
- Preserve source projection delivery diagnostics, texture residency/page-build diagnostics, static bake worker-boundary diagnostics, and domain-sized runner result contracts.

Acceptance criteria:

- `da55` terrain plus env-cells is at or below Phase 13C's env-cell frame gate.
- `da55` all-domain replacement run remains at or below Phase 13C's 527 ms / 543 ms frame gate and preserves the Phase 13E readiness recovery.
- No replacement runner receives all-layer source payloads for cache convenience.
- No legacy-shaped diagnostic field is added to replacement internals as a substitute for migrating or edge-shimming an old consumer.
- No broad budget API is added to the static-object partitioner merely to slice main-thread work that should be removed, moved off-thread, or reused from a worker-owned result.
- Any touched consumer is migrated directly, deleted, explicitly edge-shimmed, or classified as a durable adapter before the phase is complete.
- `npm run check`, `npm run lint:ts`, focused tests, and the `da55` env-cell/all-domain harness cases pass.

Task checklist:

- [x] Dry-run Phase 14 against the current tree and record any pre-cutover blocker exposed by the Phase 13L evidence.
- [x] Inspect Phase 13L stage diagnostics for the env-cell-focused max frame offender.
- [x] Remove the static-object texture-intent dependency on full static-object partitioning so the replacement browser path does not run the proven hot partition continuation on the main thread.
- [x] Preserve the generated-scenery and all-domain gains from Phase 13L.
- [x] Run focused tests and app checks.
- [x] Run replacement `da55` env-cell and all-domain harness cases.

Decisions and course corrections:

- Phase 13M added direct env-cell texture-intent substages for structured-interior intent planning, static-object intent planning, static-object partitioning, and static-object entry processing. These are replacement-native diagnostics; no legacy `TextureManager` or static coordinator field was cloned.
- Phase 13M evidence: the focused env-cell rerun passed the Phase 13C frame gate at about 525 ms max long task and 536.7 ms max frame delta, but all-domain regressed to about 575 ms max long task and 590.3 ms max frame delta.
- The new substages proved the all-domain regression is not worker slowness. Worker waits remain large but harmless by themselves; the browser long task correlates with main-thread `texture-intent-static-object-partition`, measured around 575 ms for `db56` env-cell.
- Rejected course: adding a budgeted async variant to `partitionStaticObjectBatches`. It adds broad partitioner API complexity, still leaves the hot static-object partition model on the browser thread, and only tries to make a worker-shaped problem look scheduler-shaped. The partial budgeted-partitioner change was removed.
- Resteer result: the cleanest Phase 13M fix was subtraction. Static-object texture intent planning does not need draw-unit partition groups; it needs texture binding requirements. The replacement path now collects requirements directly from payload material slots and per-part material slots, preserving binding ids, wrap policy, material/palette variants, and direct diagnostics while avoiding full candidate sort/group/split on the browser thread.
- Consumer classification: static-object texture intent result diagnostics are direct replacement diagnostics; `partitionStaticObjectBatches` remains a bake-time helper and was not given a broad budget API; no legacy-edge shim was added.
- Phase 14 dry-run: no remaining frame-budget blocker is exposed by Phase 13M evidence. Browser cutover can proceed next, but it must still migrate or delete surviving legacy-shaped runtime, harness, UI, and diagnostics consumers rather than backfilling replacement internals.
- Phase 13M accepted harness evidence:
  - `da55` terrain plus env-cells was ready in about 10.0 s with 2 long tasks, 122 ms max long task, 117.7 ms max frame delta, 9 source stream requests, 18 projected runner results, 9 reused runner requests, 18 completed static tasks, and no failures.
  - `da55` all domains was ready in about 19.8 s with 6 long tasks, 182 ms max long task, 156 ms max frame delta, 9 source stream requests, 45 projected runner results, 36 reused runner requests, 45 completed static tasks, and no failures.
- Phase 13M final diagnostics show the formerly hot static-object intent path is no longer the browser-frame offender: all-domain `create-texture-intents` max was about 116 ms, `texture-intent-static-object` max was about 18 ms, and `texture-intent-static-object-requirements` stayed below the top-stage cutoff. The remaining large wall times are worker waits, source resolution, texture placement, packing, and bake waits that do not break the frame gate.
- Verification for acceptance: `npm run check`, `npm run lint:ts`, focused `npm run test:ts -- src/lib/static/bake/worker-client.test.ts src/lib/static/resolver/worker-client.test.ts src/lib/textures/packing/worker-client.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`, and the two `da55` replacement harness gates.
- Verification after removing the rejected budgeted-partitioner path: focused `npm run test:ts -- src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts` and `npm run check` passed.

### Phase 14: Browser Runtime Cutover

Deliverables:

- Start only after Phase 13M is complete.
- Switch `createBrowserRuntime(...)` to the replacement composition.
- Keep the harness switch only if needed for one short verification window.
- Remove obsolete UI assumptions about legacy static coordinator diagnostics and migrate surviving panels to replacement-native diagnostics.
- Prefer temporary broken or partial legacy diagnostic reports over backfilling old fields from replacement data after cutover.
- Migrate surviving browser, harness, UI, and diagnostics consumers directly to replacement contracts before adding any cutover shim.
- Treat any cutover breakage in legacy-shaped diagnostics or panels as a consumer migration problem, not a reason to backfill old fields into the replacement runtime.
- Make diagnostic consumer migration part of the cutover, not polish afterward. Panels, harness summaries, and tests that survive Phase 14 should speak replacement-native diagnostics; legacy-shaped projections are allowed only as named edge shims with Phase 16 deletion triggers.
- Do not add broad frame-budget APIs during cutover for worker-side wall time or already-passing frame metrics; only budget measured browser-main-loop offenders after deletion, off-thread movement, and direct-contract simplification have failed.

Acceptance criteria:

- Browser display and browser harness use the replacement runtime path by default.
- Legacy runtime path is not used by normal app routes.
- Surviving UI and diagnostics panels read direct replacement contracts instead of legacy-shaped runtime snapshots.
- Every remaining translation module is named as either a durable adapter or a deletion-targeted shim; mixed adapter/shim modules are split before cutover is accepted.
- Any remaining harness comparison shim is isolated, named as temporary, and scheduled for Phase 16 deletion.
- Browser cutover does not require legacy-shaped diagnostics to remain complete. Any temporary report gaps are tracked at the legacy edge instead of backfilled inside replacement internals.
- Cutover does not preserve a compatibility projection merely because an old diagnostic panel, benchmark summary, or test expects it.
- Cutover may temporarily leave legacy diagnostic output incomplete or broken when preserving it would distort replacement contracts.
- Every touched browser, harness, UI, diagnostics, and test consumer is either migrated to a direct replacement contract, deleted, or left behind a named deletion-targeted edge shim.
- Worker wait, bake wait, packing wait, or source-resolution wall time alone does not block cutover unless it creates stale output, dishonest readiness, queue starvation, or a measured browser-frame violation.
- `npm run check`, `npm run lint:ts`, and focused tests pass.

Task checklist:

- [x] Switch runtime composition.
- [x] Migrate diagnostics panels and overview snapshots to replacement-native contracts.
- [x] Delete or isolate any legacy-shaped UI/harness projection that is not needed after the cutover window.
- [x] Break or delete legacy-shaped diagnostics consumers that do not justify a named shim.
- [x] Replace architecture-preserving diagnostic tests with tests over replacement-native contracts, or delete them if they only validate legacy projection completeness.
- [x] Split any mixed adapter/shim module so durable boundary adapters can survive Phase 16 without carrying compatibility code.
- [x] Verify every surviving cutover consumer either reads the direct replacement contract or has a named, deletion-targeted edge shim.
- [x] Record any intentionally broken or incomplete legacy-edge shim, including owner, dishonest-field risk, and Phase 16 deletion trigger.
- [x] Update browser harness expectations.
- [x] Run app checks.
- [x] Run benchmark matrix.

Decisions and course corrections:

- Phase 14 switched `DEFAULT_BROWSER_RUNTIME_PIPELINE` and the browser harness default to `open-world-streaming`. `BrowserDisplay` calls `createBrowserRuntime(...)` without an override, so the normal browser route now uses replacement composition by default. The legacy pipeline remains available only as an explicit pipeline option for the short verification window and Phase 15/16 deletion audit.
- The browser harness summary and trace contract now expose replacement-native `openWorldStreaming` diagnostics as the first-class data. Legacy `staticCoordinator`, `staticCommitInstall`, `staticCoordinatorTiming`, and `textureAtlas` projections were moved under `legacyDiagnostics` with a `Phase 16 legacy pipeline deletion` target and are allowed to be `null` on the replacement path.
- The replacement controller no longer reports the outer `ClientRuntime` compatibility projection as its own internal shim. The remaining legacy `ClientRuntime` overview/diagnostics snapshot projection is isolated in `composition/client-runtime-legacy-shim.ts` and reported by the browser runtime adapter as a deletion-targeted shim. This keeps the durable adapter from owning the shim implementation.
- UI diagnostic migration did not require a visual panel rewrite: `BrowserDisplay` opens the raw runtime diagnostics report, and the surviving harness/UI readiness logic already reads the `open-world-streaming` diagnostics domain directly. The old texture-atlas inspector is inert on the replacement path because replacement overview atlas pages are empty; Phase 16 should delete or replace that legacy inspector rather than backfilling replacement atlas pages into the old texture-manager shape.
- Phase 14 honored the worker-budget steering rule. No broad frame-budget API was added for worker/source/packing wall time; the all-domain default harness stayed inside the recovered frame profile.
- Phase 14 verification: `npm run check`, `npm run lint:ts`, and focused `npm run test:ts -- src/lib/systems/open-world-streaming/composition/runtime-pipeline.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts` passed.
- Phase 14 default browser harness evidence:
  - `npm run harness:browser -- --domains terrain --layer-distance 0 --timeout-ms 60000` selected `open-world-streaming` without an explicit runtime flag, completed 1/1 static task, failed 0, rendered 3 terrain draw units, reported one startup long task at about 60 ms, and kept renderer/runtime frame deltas below 50 ms.
  - `npm run harness:browser -- --domains terrain,generated-scenery,buildings,explicit-objects,env-cells --layer-distance 1 --timeout-ms 60000 --output /tmp/holtburger-phase14-default-all-domain.json` selected `open-world-streaming` without an explicit runtime flag, completed 45/45 static tasks, failed 0, reported 6 long tasks, max long task about 176 ms, max renderer frame delta about 151.4 ms, max runtime tick delta about 151.4 ms, and left legacy diagnostics null under the deletion-targeted `legacyDiagnostics` edge.
- Debt for Phase 15/16: delete the explicit legacy runtime switch after any final comparison run, delete `composition/client-runtime-legacy-shim.ts`, delete `testing/empty-runtime-snapshots.ts` if no other shim consumes it, and replace or remove the legacy texture-atlas page inspector instead of teaching replacement texture residency to mimic `TextureManager` inspection snapshots.

### Phase 15: Resteering Checkpoint 5 - Cutover Deletion Audit

Deliverables:

- Audit the post-cutover codebase before legacy cleanup begins.
- Classify every remaining legacy dependency as boundary adapter, reusable transform, shim, dead code, or out-of-scope survivor.
- Decide whether cleanup can proceed in one hard pass or needs a short preparatory subphase.
- Dry-run Phase 16 from the current post-cutover tree and steer the cleanup checklist toward deletion of shims before adapter polish.

Acceptance criteria:

- Every shim has a deletion task.
- Every remaining adapter has a durable boundary reason.
- No compatibility shim is misclassified as an adapter merely because it lives near host, worker, renderer, diagnostics export, or harness code.
- No normal browser or harness path depends on the old runtime pipeline.
- Every surviving consumer is either on a direct replacement contract or explicitly out of Phase 16 scope.
- The hard cutover cleanup phase has been dry-run against the current source tree.
- Cleanup scope is specific enough to run without guessing which code is still live.
- The audit has identified any remaining legacy diagnostic, harness, or UI projection that was intentionally allowed to be incomplete during migration.
- No shim survives the audit without a concrete Phase 16 deletion task.

Task checklist:

- [x] Run import/dead-code inspection for old runtime, texture manager, and static coordinator paths.
- [x] Classify remaining adapters and shims.
- [x] Split or rename any module whose role is ambiguous between durable adapter and compatibility shim.
- [x] Verify no surviving consumer depends on shim-only field names, timing assumptions, or legacy diagnostic categories.
- [x] Verify every incomplete legacy-edge diagnostic or runtime projection is either deleted in Phase 16 or documented as an out-of-scope survivor.
- [x] Identify tests that preserve retired architecture.
- [x] Dry-run Phase 16 cleanup against the current source tree.
- [x] Identify dependency/order changes, boundary leaks, shims, deletion targets, and test risks for hard cleanup.
- [x] Update Phase 16 cleanup checklist with concrete file/module targets.
- [x] Confirm benchmark matrix still passes on the replacement path.

Decisions and course corrections:

- Import audit found the old production materialization path still reachable only through the explicit legacy option in `createBrowserRuntime(...)`: `createClientRuntime(...)`, `ClientRuntimeImpl`, `StaticCoordinator`, `TextureManager`, `installStaticCommit(...)`, and env-cell legacy publication helpers are no longer selected by normal browser or default harness routes.
- The explicit `runtimePipeline` switch is now the main cutover shim. Phase 16 should remove the `"legacy"` mode from `BrowserRuntimePipelineMode`, `parseBrowserRuntimePipelineMode(...)`, `BrowserPipelineHarness.svelte`, and `scripts/browser-pipeline-harness.mjs` before deleting the old runtime modules. Leaving the switch alive would keep the old architecture artificially reachable.
- Remaining shims are concrete and deletion-targeted: `composition/client-runtime-legacy-shim.ts`, `testing/empty-runtime-snapshots.ts`, harness `legacyDiagnostics`, and the old `ClientRuntime` legacy snapshot methods on the replacement adapter. None should survive Phase 16 in production code.
- Durable adapters are still valid at host/worker/renderer boundaries: browser host/assets, static resolver worker, static bake worker, dynamic visual workers, texture packing worker, and renderer mutation adapters. These reuse transforms or external boundaries and do not justify keeping the old runtime coordinator.
- UI audit found the legacy texture atlas inspector path still wired through `BrowserDisplay.svelte`, `TextureAtlasPageInspectorModal.svelte`, `RuntimeTextureAtlasPageOverview`, and `TextureAtlasPageInspectionSnapshot`. It is inert on the replacement path because replacement overview atlas pages are empty, but Phase 16 should delete or replace it rather than projecting replacement texture residency into the old `TextureManager` inspection shape.
- Architecture-preserving tests to delete or rewrite in Phase 16: `src/lib/runtime/client-runtime.test.ts`, `src/lib/static/coordinator/static-coordinator.test.ts`, `src/lib/textures/texture-manager.test.ts`, plus legacy-only portions of `src/lib/runtime/static-commit-installer.test.ts` and `src/lib/runtime/env-cell-system-layer-publication.test.ts`. Keep tests only where they prove reusable pure transforms or replacement contracts.
- `npm run lint:dead` was run as an audit and currently fails on unused exports: `createDynamicRendererVisualResourceId`, `buildObjectVisualAtlas`, `OpenWorldStreamingDiagnosticsReport`, static bake/source projection diagnostic exported types, structured-interior/static-object stage timing exported types, object visual atlas build exported types, and texture packing result-ready exported types. Phase 16 should delete or unexport these if they remain unused after hard cleanup.
- Dry-run order for Phase 16: remove the explicit legacy runtime switch, delete legacy UI/harness projections, delete the old runtime/static/texture orchestration modules and their architecture-preserving tests, then run dead-code cleanup on any now-orphaned contracts. This order avoids keeping code live only because a diagnostic or test still expects it.
- Replacement benchmark matrix was confirmed immediately before this audit in Phase 14: default terrain radius 0 and default all-domain radius 1 selected `open-world-streaming`, completed all requested tasks, and stayed within the recovered frame profile. No Phase 15 production code changed after that benchmark.

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
- Every compatibility module named as a shim in earlier phases is deleted, rewritten as a direct consumer, or explicitly moved out of production scope.
- No shim remains in production code after hard cutover.
- Replacement contracts use replacement concepts and do not expose legacy static coordinator, static commit install, texture manager snapshots, or legacy timing/order assumptions.
- Replacement diagnostics remain direct and honest; deleted legacy dashboards, broken transitional projections, or rewritten tests are acceptable outcomes.
- Remaining tests prove replacement behavior or reusable pure transforms, not retired orchestration contracts.
- Dead code tooling does not report newly orphaned modules.
- Source tree contains the replacement system as the authoritative pipeline.

Task checklist:

- [x] Remove the explicit legacy runtime switch: delete `"legacy"` from `BrowserRuntimePipelineMode`, `parseBrowserRuntimePipelineMode(...)`, `BrowserPipelineHarness.svelte`, and `scripts/browser-pipeline-harness.mjs`.
- [x] Remove old runtime orchestration modules: delete `src/lib/runtime/client-runtime.ts` implementation paths that only serve `ClientRuntimeImpl`, or split durable shared runtime types into a smaller replacement-owned contract before deleting the implementation.
- [x] Remove old texture manager paths no longer used: delete `src/lib/textures/texture-manager.ts`, `TextureAtlasPageInspectionSnapshot`, `RuntimeTextureAtlasPageOverview`, and the legacy atlas inspector UI unless a replacement-native inspector is built from `OpenWorldStreamingAtlasInspectionSnapshot`.
- [x] Remove old static coordinator continuation path: delete `src/lib/static/coordinator/static-coordinator.ts` and any `StaticCoordinator*` contracts that are not reusable static source/bake transforms.
- [x] Delete shims that translate replacement artifacts back into retired legacy shapes: `src/lib/systems/open-world-streaming/composition/client-runtime-legacy-shim.ts`, `src/lib/systems/open-world-streaming/testing/empty-runtime-snapshots.ts`, harness `legacyDiagnostics`, and replacement adapter legacy snapshot projection methods.
- [x] Audit remaining adapters and classify each as host, worker, renderer, diagnostics, harness, or delete.
- [x] Verify surviving adapters do not expose shim-only fields, old diagnostic categories, or legacy timing/order assumptions.
- [x] Delete legacy diagnostic projections rather than keeping them alive by inventing compatibility fields from replacement data.
- [x] Delete or rewrite architecture-preserving tests: `src/lib/runtime/client-runtime.test.ts`, `src/lib/static/coordinator/static-coordinator.test.ts`, `src/lib/textures/texture-manager.test.ts`, and legacy-only portions of `src/lib/runtime/static-commit-installer.test.ts` and `src/lib/runtime/env-cell-system-layer-publication.test.ts`.
- [x] Remove obsolete diagnostics and tests, including any remaining `static-coordinator`, `static-commit-install`, and `texture-atlas` report categories from normal replacement outputs.
- [x] Resolve current `npm run lint:dead` findings: unused `createDynamicRendererVisualResourceId`, `buildObjectVisualAtlas`, `OpenWorldStreamingDiagnosticsReport`, static bake/source projection diagnostic exported types, structured/static-object timing exported types, object visual atlas build exported types, and texture packing result-ready exported types.
- [x] Run `npm run check`.
- [x] Run `npm run lint`.
- [x] Run benchmark matrix one final time.

Decisions and course corrections:

- Deleted the explicit browser/runtime pipeline selector and made `createBrowserRuntime(...)` always compose the open-world streaming runtime. The browser harness now records `runtimePipeline: "open-world-streaming"` as scenario metadata, not as a selectable compatibility mode.
- Split `src/lib/runtime/client-runtime.ts` down to durable runtime contracts and deleted `ClientRuntimeImpl`, the old static coordinator path, the global texture manager, static commit installer, env-cell legacy publication helper, fake workers, compatibility snapshots, legacy runtime pipeline switch tests, and the texture atlas inspector UI.
- Replaced the remaining legacy-shaped runtime diagnostics projection with a narrow runtime summary plus direct `open-world-streaming` and `renderer` domain reports. Static coordinator, static commit install, texture manager, texture atlas inspection, and legacy diagnostics categories are no longer synthesized from replacement data.
- Adapter audit after deletion: host/asset access, static resolver worker, static bake worker, dynamic visual workers, texture packing worker, renderer mutation, diagnostics export, and browser harness composition remain as durable adapters. No production shim remains to translate replacement artifacts back into retired static coordinator, static commit installer, or texture manager shapes.
- Worker-budget steering: Phase 16 did not add any broad budget API for worker/source/packing wall time. Worker waits remain acceptable unless they create stale output, queue starvation, dishonest readiness, or measured browser-main-loop delivery/assimilation spikes.
- Dead-code cleanup removed or narrowed unused public exports after hard cutover, including old scene-commit placeholder helpers, static coordinator contracts, static source-resolution snapshot types, texture packing result-ready DTO exports, object visual atlas builder internals, and stale `TextureManager` comment vocabulary.
- Test migration: one object-visual texture placement test was updated to assert the replacement-native texture source preparation, packing result transfer, and page settlement diagnostic stages rather than the older coarse stage list.
- Concession: the renderer still has an internal `legacy-render-pass` mode name for the current single-surface render path. Phase 16 stopped exposing that name through runtime diagnostics, but a later renderer naming cleanup may still be worthwhile if portal-frame terminology becomes confusing.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run lint:rust`, and full `npm run test:ts` passed.
- Verification: `npm run harness:browser -- --domains terrain --layer-distance 0 --output /tmp/holtburger-phase16-terrain-r0.json` passed with one ready artifact, one applied scene commit, zero pending scene commits, no compatibility shims, runtime diagnostics limited to status/scene interest/filtering, max long task about 59 ms, and max renderer frame delta about 44 ms.
- Verification: `npm run harness:browser -- --layer-distance 1 --output /tmp/holtburger-phase16-all-domain-r1.json` passed with 45 ready artifacts, 45 applied scene commits, zero pending scene commits, 121 resident texture pages, 44 static-authored runtime entities, no compatibility shims, max long task about 183 ms, and request readiness about 19.5 s.

### Phase 17: Final DoD Audit And Historical Handoff

Deliverables:

- Run the original `dc58`, radius 1, all-domain worksheet benchmark against the replacement-only runtime.
- Re-run final app verification after the Phase 16 hard cutover commit.
- Mark the stutter investigation worksheet as historical evidence.
- Mark this plan as executed if the DoD is satisfied, or record any remaining gap explicitly.

Acceptance criteria:

- `dc58`, radius 1, all domains settles without compatibility shims and stays within the recovered frame profile.
- `da55`, radius 1, all domains remains covered by Phase 16 evidence.
- `npm run check`, `npm run lint`, and `npm run test:ts` pass after the hard cutover commit.
- The worksheet status no longer implies that the old pipeline investigation is active.
- The plan records final benchmark evidence and any remaining renderer or diagnostics naming debt.

Task checklist:

- [x] Run `npm run harness:browser -- --timeout-ms 180000 --landblock 0xdc58ffff --layer-distance 1 --output /tmp/holtburger-phase17-dc58-r1.json`.
- [x] Extract and record direct replacement diagnostics from the `dc58` benchmark.
- [x] Re-run final verification commands after the hard cutover commit.
- [x] Update the worksheet status to historical/superseded.
- [x] Update this plan status based on DoD evidence.
- [x] Commit Phase 17.

Decisions and course corrections:

- Final `dc58` worksheet benchmark evidence: `npm run harness:browser -- --timeout-ms 180000 --landblock 0xdc58ffff --layer-distance 1 --output /tmp/holtburger-phase17-dc58-r1.json` passed on the replacement-only runtime with `runtimePipeline: "open-world-streaming"`, zero compatibility shims, 45 ready artifacts, 45 applied scene commits, zero pending scene commits, 119 resident texture pages, 162 static-authored runtime entities, and request readiness about 16.2 s.
- Final `dc58` frame evidence: max long task was about 151 ms across 6 long tasks, max renderer frame delta was about 127.5 ms, and max runtime tick handler time was about 2.8 ms. This satisfies the materially reduced stutter target from the worksheet without adding any broad worker-wall-time budget API.
- `da55`, radius 1, all-domain coverage remains the Phase 16 benchmark: 45 ready artifacts, 45 applied scene commits, zero pending scene commits, 121 resident texture pages, no compatibility shims, max long task about 183 ms, and request readiness about 19.5 s.
- Final verification after Phase 16 hard cutover commit and Phase 17 documentation changes: `npm run check`, `npm run lint`, and full `npm run test:ts` passed from `apps/holtburger-3d`.
- The stutter investigation worksheet is now marked as historical evidence and points at this plan as the implementation record.
- Remaining debt: renderer internals still use the `legacy-render-pass` name for the current single-surface render mode. This is no longer exposed through runtime diagnostics and is not a materialization shim, but a future renderer terminology cleanup may reduce confusion.

### Phase 18: Post-Cutover Issue Triage

Deliverables:

- Maintain a rolling triage queue for issues discovered after the hard cutover.
- Investigate one active issue at a time from evidence before changing code.
- Record each issue's root cause, fix, verification, commit, and any follow-up debt.
- Keep triage decisions attached to this implementation record so context from the remodel remains available.

Acceptance criteria:

- Each active issue has a concrete symptom, reproduction path or evidence source, suspected owning system, and severity.
- Each fix preserves the replacement model and does not restore retired orchestration, compatibility shims, or legacy-shaped diagnostics.
- Each resolved issue records verification commands or harness evidence.
- Deferred issues include the reason for deferral and the evidence that would make them active again.
- Periodic steering notes distinguish root-cause fixes from polish, instrumentation, or policy debt.

Triage rules:

- Start from current code and measured behavior, not plan memory.
- Prefer deleting, simplifying, or direct-contract fixes before adding new abstractions.
- Temporary diagnostics are allowed during investigation, but must either be removed or promoted into replacement-native diagnostics.
- Do not add compatibility projections to make an old shape look healthy.
- One issue per commit unless multiple symptoms share the same proven root cause.
- If an issue points at a larger design gap, pause and add a steering note before widening scope.

Active issue:

- None yet.

Queue:

- Vestigial reference cleanup: remove code-side references to the retired pipeline and update renderer/work-plan terminology so only historical docs mention the deleted architecture.

Resolved:

- Terrain rendered as flat color.
  - Symptom: terrain material sampling was resident but visually constant.
  - Evidence: `OpenWorldTerrainArtifactRunner` emitted synthetic purpose-scoped `1x1` pages with constant RGBA pixels for `terrain-color`, `terrain-detail`, and `terrain-mask`.
  - Root cause: Phase 8's vertical-slice texture shim survived the hard cutover, so terrain used real material intents but discarded the real prepared texture pixels before baking/committing.
  - Fix: removed terrain's synthetic texture-plan path and routed terrain through the same shared material texture placement/page-build path used by object-like visuals. Terrain now emits plural texture commits like the other static artifact runners and differs only by its placement intents and bake-facing string placement ids.
  - Resteer: avoid domain-specific packer/settlement clones. If a future terrain bug requires texture placement changes, make the shared material placement primitive stricter rather than adding terrain-owned page-build logic.
  - Verification: `npm run check`; `npm run lint`; full `npm run test:ts`; focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts`; `npm run harness:browser -- --domains terrain --layer-distance 0 --timeout-ms 60000 --output /tmp/holtburger-terrain-real-texture-r0.json`.

Deferred:

- Texture page reclamation policy: ownerless resident pages still need measured memory-pressure policy before eager reclaim/repack is designed.
- Texture residency byte estimates: page byte accounting remains non-canonical until page dimensions/formats are represented as authoritative residency facts.
- Renderer readiness model: still needs a minimal contract for missing/pending bindings that reports loudly without hot-path noise.
- Renderer terminology cleanup beyond materialization: any remaining renderer-local naming should be handled only when it improves current renderer concepts, not as historical cleanup theater.

Steering notes:

- Phase 18 is an operational triage phase over the replacement system. It must not reopen the old dual-pipeline migration or turn the executed remodel plan into an unbounded feature wishlist.
- User steering: worker wall time alone is not a browser-stutter bug. Do not add broad budgeting for slow workers unless delivery, assimilation, queue starvation, stale output, or frame metrics prove a main-loop problem.
- Closeout: Phase 18 established the post-cutover issue triage workflow, resolved the terrain flat-color regression, and exposed a larger design-drift cluster around texture policy, page-build ownership, loose readiness, and material diagnostics. The next work is no longer open-ended issue triage; it is a focused replacement-model remediation sequence grounded in the worksheet requirements.
- Design-drift audit: `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.ts` currently hardcodes replacement bucket scope to `static-domain`, awaits source preparation, packing, page settlement, and texture commit creation before bake can proceed, and returns bake-facing placement facts together with renderer-facing texture commits. This partially implements the remodel but does not satisfy the worksheet split between placement assignment and page pixel build.
- Design-drift audit: dynamic visual planning still computes legacy-style `placementBucketKey` values in `apps/holtburger-3d/src/lib/dynamic/visual-baker.ts`, while the replacement material placement primitive ignores those keys. That is contract drift, not an acceptable adapter.
- Design-drift audit: object visual recipe publication still throws on unplaced texture bindings in `apps/holtburger-3d/src/lib/static/bake/object-visual-recipe-install-publication.ts`, which violates the worksheet target that pending texture bindings make resources non-renderable rather than fatal.
- Design-drift audit: renderer object-material prep is partly tolerant of pending bindings, but missing required bindings can still throw from `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.ts`. Missing-not-in-flight needs upstream replacement diagnostics, not renderer hot-path exceptions.
- Design-drift audit: `apps/holtburger-3d/src/lib/static/objects/bake/static-object-material-coverage.ts` is diagnostic only and should stay that way. The problem is not the coverage report itself; the problem is any surrounding behavior, test, or panel treating deferred/unsupported coverage as proof the replacement material contract is complete.

### Phase 19: Replacement Texture Policy Contract

Deliverables:

- Define the replacement-native texture policy contract used by material placement. It must represent bucket scope, source stability, owner currentness, visual texture domain, shader/page purpose, sampler policy, and whether page build work is worker-owned.
- Ground the policy in the worksheet requirements for static-authored dynamic sharing, texture binding multi-owner claims, terrain/object isomorphism, and worker-owned page builds.
- Audit current producers against the target contract:
  - static objects: `apps/holtburger-3d/src/lib/static/objects/bake/static-object-placement-planner.ts`;
  - structured interiors/env-cells: `apps/holtburger-3d/src/lib/static/env-cells/bake/structured-interior-placement-planner.ts`;
  - terrain: `apps/holtburger-3d/src/lib/static/terrain/bake/terrain-geometry-baker.ts`;
  - dynamic visuals: `apps/holtburger-3d/src/lib/dynamic/visual-baker.ts`;
  - shared placement: `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.ts`.
- Replace the implicit `static-domain` hardcoding with a single policy resolver that chooses `static-domain`, `static-owner`, or `runtime-owner` from replacement-owned facts.
- Decide whether the policy contract belongs in `texture-residency/placement`, `textures/placement.ts`, or a smaller shared app-local module. Prefer the narrowest placement-owned module unless non-open-world consumers genuinely need it.

Acceptance criteria:

- No replacement material placement code derives bucket scope ad hoc from only `(domain, purpose)`.
- No replacement code ignores a caller-provided lifetime policy field while tests continue to imply that field matters.
- Static-authored dynamic content-stable textures can target shared static-domain buckets while owner-specific/generated/runtime-custom textures can target owner buckets.
- Runtime-authored dynamic textures no longer accidentally enter shared static-domain buckets unless an explicit measured design decision is recorded.
- Tests cover at least one static object, one terrain, one static-authored dynamic, and one runtime-authored dynamic policy decision.

Task checklist:

- [x] Reread worksheet Requirement 5, Requirement 7, Requirement 13, Requirement 14, and the final implementation notes before editing code.
- [x] Add or update replacement texture policy types with comments for every field whose meaning affects sharing, currentness, or worker ownership.
- [x] Add policy resolver tests for `static-domain`, `static-owner`, and `runtime-owner`.
- [x] Replace direct `createOpenWorldTextureBucketKey({ scope: { kind: "static-domain" } })` usage in the material placement primitive with the policy resolver.
- [x] Identify every surviving `placementBucketKey` consumer and classify it as direct migration, deletion, or legacy-edge shim.
- [x] Update this phase with any deliberate deviation from the worksheet.

Decisions and course corrections:

- Added `TexturePlacementPolicy` to `apps/holtburger-3d/src/lib/textures/placement.ts` as the direct replacement contract carried by every `TexturePlacementIntent`. The policy records bucket scope, source stability, currentness authority, and page-build ownership. It intentionally lives beside the existing placement intent because the policy must travel with every producer before the Phase 20 deletion pass removes ignored legacy bucket fields.
- Added `createMaterialTexturePlacementBucketKey(...)` in `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-policy.ts` and routed `buildMaterialTexturePlacementPlan(...)` through it. The material placement primitive no longer hardcodes `static-domain` from only domain and purpose.
- The policy resolver rejects owner-specific source content in shared `static-domain` buckets and rejects owner-scoped buckets for content-stable sources. This is intentionally stricter than the previous code so bucket scope cannot become decorative.
- Dynamic visual planning now emits replacement policy directly: runtime-authored dynamic textures use `runtime-owner` scope with `runtime-customized` source stability, while content-stable static-authored dynamic textures use shared `static-domain` scope. This aligns the active replacement policy with the worksheet even though the old `placementBucketKey` field still exists.
- Surviving `placementBucketKey` fields are Phase 20 deletion targets, not replacement truth. Current consumers are `apps/holtburger-3d/src/lib/textures/placement.ts`, `apps/holtburger-3d/src/lib/visual/object-visual-texture-placement-planner.ts`, dynamic visual planning, low-level placement tests, and legacy runtime contract types. Phase 20 must either migrate each to `TexturePlacementPolicy` or isolate any remaining compatibility at an edge.
- Deliberate temporary deviation: `placementBucketKey` remains on `TexturePlacementIntent` for this phase to keep the codebase compiling while the direct policy is introduced. The replacement material placement primitive ignores the old field by design and uses `TexturePlacementPolicy`; Phase 20 owns deleting or isolating the old field so tests stop implying it is replacement behavior.
- Verification: focused `npm run test:ts -- --run src/lib/textures/placement.test.ts src/lib/visual/object-visual-texture-placement-planner.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-policy.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts` passed.
- Verification: `npm run check` passed.
- Verification: `npm run lint` passed.

### Phase 20: Intent Producer Migration And Dead Policy Deletion

Deliverables:

- Migrate all material texture intent producers to emit the Phase 19 policy directly.
- Delete, rename, or edge-shim legacy `TexturePlacementBucketKey` fields that no longer control replacement placement.
- Ensure dynamic visual planning does not compute policy facts that the replacement placement service ignores.
- Preserve bake-facing binding identity and texture source identity while removing owner/lifetime duplication from lower-level source identities.

Acceptance criteria:

- `createDynamicVisualTexturePlanning(...)` emits replacement-native policy for runtime-authored and static-authored dynamic visuals.
- Static object, structured interior, terrain, and dynamic producers all feed one placement policy vocabulary.
- Tests no longer assert owner-keyed static-authored dynamic bucket behavior unless the fixture is explicitly generated, placement-specific, tint-baked, or runtime-customized.
- No replacement test uses `"fixture-bucket:unused"` to satisfy a required field that production ignores.
- TypeScript makes it hard to construct a replacement placement intent without an explicit policy.

Task checklist:

- [x] Migrate static object placement planning.
- [x] Migrate structured interior/env-cell placement planning.
- [x] Migrate terrain placement intents.
- [x] Migrate dynamic visual texture planning.
- [x] Delete or isolate ignored `placementBucketKey` fields from replacement internals.
- [x] Rewrite tests that preserve old bucket lifetime assumptions.
- [x] Run `npm run check` and focused texture placement tests.

Decisions and course corrections:

- Deleted the retired `TexturePlacementBucketKey` namespace from `apps/holtburger-3d/src/lib/textures/placement.ts`, including static-authored, static-authored-dynamic, runtime-authored-dynamic, and generic bucket key constructors. Replacement bucket identity now comes only from `TexturePlacementPolicy` plus the open-world texture bucket resolver.
- Removed `placementBucketKey` from `TexturePlacementIntent`, `TexturePlacementIntentOptions`, and `ObjectVisualTexturePlacementRequirement` policy shapes. TypeScript now requires replacement placement intents to carry `placementPolicy`, and there is no second bucket field for the replacement material placement primitive to ignore.
- Static object, structured interior/env-cell, and terrain producers now feed the shared static-domain replacement policy through `createStaticTexturePlacementIntent(...)`. Runtime-authored and static-authored dynamic producers feed explicit replacement policy through `createDynamicVisualTexturePlanning(...)`.
- Deleted tests that asserted owner-keyed static-authored dynamic bucket strings. Those tests preserved the behavior the worksheet wanted us to remove. Replacement bucket decisions are now covered by `material-texture-placement-policy.test.ts`.
- Renamed the old runtime atlas overview/UI field from `placementBucketKey` to `atlasBucketKey` in `apps/holtburger-3d/src/lib/runtime/client-runtime.ts` and `apps/holtburger-3d/src/pages/BrowserDisplay.svelte`. This keeps the atlas overview as a UI/debug contract without preserving the retired placement-bucket vocabulary.
- Search audit: `rg "placementBucketKey|TexturePlacementBucketKey|createStaticAuthoredTexturePlacementBucketKey|createStaticAuthoredDynamicTexturePlacementBucketKey|createRuntimeAuthoredDynamicTexturePlacementBucketKey|createTexturePlacementBucketKey|fixture-bucket:unused" apps/holtburger-3d/src apps/holtburger-3d/scripts` now finds only the replacement bucket resolver/test names, not the retired field or constructors.
- Verification: focused `npm run test:ts -- --run src/lib/textures/placement.test.ts src/lib/dynamic/visual-contracts.test.ts src/lib/visual/object-visual-texture-placement-planner.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-policy.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts` passed.
- Verification: `npm run check` passed.
- Verification: `npm run lint` passed.

### Phase 21: Placement Reservation And Page Build Split

Deliverables:

- Split `buildMaterialTexturePlacementPlan(...)` into two products:
  - a bake-facing placement reservation artifact with stable binding ids, item/page/group facts, owner claims, and readiness dependencies;
  - one or more page-build requests that can materialize pixels and publish texture commits independently.
- Keep owner claim retain/release and page reservation authority in the replacement texture residency system.
- Remove the current requirement that object, terrain, env-cell, or dynamic bake waits for page pixels before it receives placement facts.
- Define how reservation tokens/currentness reject stale page-build results.

Acceptance criteria:

- Static object, terrain, env-cell, and dynamic bake inputs can be created from placement reservation facts without awaiting page pixel payloads.
- Texture commits can arrive before or after scene/visual commits without violating owner currentness.
- Reservation output does not include renderer texture objects or page pixel buffers.
- Page-build requests contain enough immutable source/layout facts for a worker to materialize pages without reaching back into mutable placement state.
- Tests prove scene/visual bake can proceed when page-build output is pending.

Task checklist:

- [x] Introduce placement reservation DTOs and page-build request DTOs.
- [x] Split material placement tests into reservation tests and page-build/commit tests.
- [x] Update terrain artifact runner to consume reservation facts and emit page-build work separately.
- [x] Update outdoor object and env-cell artifact runners to consume reservation facts and emit page-build work separately.
- [x] Update runtime entity materialization to consume reservation facts and emit page-build work separately.
- [x] Record any temporary sequencing concession with a deletion trigger.

Decisions and course corrections:

- Split `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.ts` into explicit reservation and page-build products. `reserveMaterialTexturePlacements(...)` now returns bake-facing `bindingPlacements` plus immutable `pageBuildRequests`; `buildReservedMaterialTexturePages(...)` consumes those requests through an injected `OpenWorldTexturePageBuilder` and settles accepted results through replacement residency tokens.
- Changed the object visual atlas builder from `buildAtlas(...)` to `planAtlasPlacement(...)` in `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-atlas-builder.ts`. It now prepares source dimensions/pixels and runs layout planning without returning page pixel payloads. Stage timing changed from `texture-packing` / `texture-packing-result-transfer` to `texture-layout`.
- Tightened `OpenWorldTexturePageBuildInput` in `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/page-build/protocol.ts` so each entry carries `rect`, `gutterPixels`, and `gutterEdgeMode`. This fixes the prior dishonest contract where a page-build worker could not materialize a page without reaching back into hidden placement state.
- Added `DirectOpenWorldTexturePageBuilder` as the temporary Phase 21 materializer in `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/page-build/direct-page-builder.ts`. This preserves a separate page-build boundary before Phase 22 moves page materialization behind workers.
- Updated terrain, outdoor object, env-cell, and runtime dynamic producers to reserve placement before bake and build pages afterward. Static layer commits still return texture commits with the layer commit in this phase; Phase 23 owns loosening texture readiness and commit ordering so texture commits can publish independently of scene/visual commits.
- Removed the open-world streaming composition dependency on `createTexturePacker` and deleted `apps/holtburger-3d/src/lib/textures/packing/texture-packing.worker.ts` after `knip` proved it was unused by the remodeled production path. The lower-level packing utility remains only where it is still directly tested.
- Temporary concession: page-build requests still carry prepared pixel sources because source preparation remains caller-side. Deletion trigger: Phase 22 must move source preparation, layout search, guttered blits, and page pixel materialization behind the page-build worker boundary, or explicitly record a measured browser/WebGL exception.
- Temporary concession: static page-build work is sequenced after bake but still before the layer commit returns. Deletion trigger: Phase 23 must allow texture commits/readiness to publish before or after scene commits without making static scene publication wait for page pixels.
- Verification: focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/page-build.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/runtime-entities/runtime-entity-system.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts` passed.
- Verification: `npm run check` passed.
- Verification: `npm run lint` passed.

### Phase 22: Worker-Owned Page Build Artifact

Deliverables:

- Split worker ownership into two honest products:
  - a worker-owned placement-layout artifact that prepares sources, gathers source dimensions, runs layout search, and returns layout/rect facts without page pixels;
  - a worker-owned page-materialization artifact that prepares sources from source identities, applies guttered blits, builds page pixels, and returns page-build outputs for replacement settlement.
- Move texture source preparation, layout search, guttered blits, page rebuilds, and page pixel materialization off the main thread unless a measured browser or WebGL constraint forces a narrow exception.
- Rework `DirectOpenWorldObjectVisualAtlasBuilder` so it is either a test-only direct implementation or is deleted in favor of an honest worker-owned placement-layout client.
- Keep main-loop authority limited to reservation, validation, commit publication, renderer texture upload, and diagnostics export.
- Make page-build diagnostics replacement-native: source preparation, worker wait, transfer, settlement, stale rejection, and commit publication.

Acceptance criteria:

- Browser-mode placement layout and page pixel materialization do not prepare sources, search layouts, or blit atlas pages on the main thread for normal object/terrain/dynamic material pages.
- Tests can run with direct in-process layout/page builders, but production composition uses worker-owned boundaries.
- Page-build worker inputs carry immutable source identities and layout facts, not prepared pixel buffers borrowed from mutable main-thread caches.
- Slow worker page builds do not block unrelated scene commit application except where explicit owner/currentness dependencies require waiting.
- Diagnostics distinguish worker wall time from browser delivery/assimilation time.

Task checklist:

- [x] Define a worker placement-layout protocol from source identities, page policy, and replacement entry ids.
- [x] Change Phase 21 page-build requests to carry source identities plus immutable layout facts instead of prepared pixel buffers.
- [x] Move source preparation for both layout and page materialization into worker paths, or prove and document a narrow exception.
- [x] Move layout search into the placement-layout artifact boundary.
- [x] Move guttered blits and page pixel materialization into the page-materialization artifact boundary.
- [x] Validate transferable ownership for page pixels and worker-prepared sources.
- [x] Remove `DirectOpenWorldTexturePageBuilder` from production composition; keep it only for tests or delete it if worker fixtures cover the same behavior.
- [x] Add stale page-build result rejection tests.
- [x] Run browser harness cases that previously exposed texture placement long-task pressure.

Decisions and course corrections:

- Phase 22 dry-run found that the earlier wording was too monolithic. Phase 21 made bake depend on placement/layout facts before page pixels exist. If Phase 22 moves layout search into a single page-build worker call, bake either waits for page pixels again or the worker must retain hidden mutable layout/source state between layout and page materialization. Both options violate the design doc north star to migrate direct contracts and keep replacement-owned reservation/currentness honest.
- Resteer: Phase 22 must produce a worker-owned layout artifact first, then worker-owned page materialization. Main-thread reservation remains the authority that creates replacement pages and reservation tokens after layout facts return. Page-build requests must then use source identities and layout rects, not prepared pixel buffers, so workers can materialize pages without reading mutable placement state.
- Phase 22 completed the worker-owned split without preserving the old packing worker shape. Browser composition now creates `WorkerPoolOpenWorldObjectVisualAtlasBuilder` from `object-visual-atlas.worker.ts` and `WorkerPoolOpenWorldTexturePageBuilder` from `page-build.worker.ts`; direct builders remain test and worker-internal implementations, not production composition fallbacks.
- Page-build requests now carry `dataUse` source identities plus immutable rect/gutter facts. Prepared pixel buffers no longer cross from caller-side placement into page-build requests, which keeps the replacement contract honest and avoids borrowing mutable main-thread cache state.
- Source preparation now lives in `texture-residency/material-texture-source.ts` and is used by both the layout worker implementation and the page materialization worker implementation. This duplicates worker-side preparation today because layout needs source dimensions before reservation and page materialization needs source pixels after reservation. That is a deliberate stateless boundary, not a hidden worker cache.
- Replacement diagnostics now include worker-side `texture-page-source-preparation` and `texture-page-materialization` timings in addition to the caller-observed `texture-page-build` wait. The browser-facing timing is still allowed to include queue/wait/delivery; the worker substages are the source of truth for expensive pixel work.
- Current debt carried into Phase 23: static and runtime artifact runners still await `buildReservedMaterialTexturePages(...)` before returning their scene/runtime commits. Worker-owned page pixels are real, but texture commit publication is not yet independently scheduled from scene publication.
- Current debt carried into Phase 24/25: material coverage and readiness diagnostics still reuse broad static material coverage summaries from `static-object-material-coverage.ts`. Those summaries are diagnostic-only and do not yet distinguish every replacement readiness/fidelity state that the worksheet target model needs.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/page-build.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-atlas-worker-client.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/runtime-entities/runtime-entity-system.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`, and `npm run harness:browser` passed.

### Phase 23: Texture Commit Stream Decoupling

Deliverables:

- Split texture page-build settlement from static/runtime scene commit completion in the production controller path.
- Replace the current runner-local `await buildReservedMaterialTexturePages(...)` sequencing in terrain, outdoor-object, env-cell, and runtime-entity paths with a controller-owned texture task stream.
- Keep reservation/currentness authority in the main replacement state: page-build workers receive immutable requests and reservation tokens; the controller settles late worker outputs only if the owner and token are still current.
- Publish texture commits through the existing renderer texture commit adapter independently from scene/runtime commits.
- Add native diagnostics for queued, running, accepted, stale, failed, and committed texture tasks by owner id and bucket key.

Acceptance criteria:

- Static layer runners can return scene commits while related page-build tasks are still running.
- Texture commits can arrive before or after scene/visual commits without violating owner currentness.
- Releasing or replacing an owner before a page-build worker returns causes stale texture output to be rejected without renderer mutation.
- The controller diagnostics can answer which owner/bucket/page is waiting, running, stale, failed, or committed without consulting legacy runtime categories.
- Tests cover terrain, static object, env-cell, and runtime entity texture tasks settling after scene commit publication.

Task checklist:

- [x] Audit current `buildReservedMaterialTexturePages(...)` call sites in `static-layers/terrain`, `static-layers/outdoor-objects`, `static-layers/env-cells`, and `runtime-entities`.
- [x] Add a controller-owned texture task queue/settlement reducer under `texture-residency/page-build` or `texture-residency/commits`, not inside domain runners.
- [x] Change domain runners to return bake-facing placement plus page-build requests as commit dependencies, rather than completed texture commits.
- [x] Add owner/currentness checks for late texture task output.
- [x] Add stale output tests by evicting/replacing an owner while page-build work is in flight.
- [x] Add diagnostics for task state, stale rejection, page-build failure, and accepted commit publication.
- [x] Run focused texture residency and static layer tests before browser harness.

Decisions and course corrections:

- Phase 23 completed the production call-site cut: terrain, outdoor-object, env-cell, and runtime-entity paths no longer call `buildReservedMaterialTexturePages(...)` in production materialization. Static layer commits now carry `texturePageBuildRequests`; the controller schedules those requests through a replacement-owned task stream after owner/currentness validation.
- Added `OpenWorldTexturePageBuildTaskStream` under `texture-residency/page-build`. It owns queued/active/recent task diagnostics, calls the worker-backed page builder, settles accepted outputs through `OpenWorldTextureClaimRegistry`, publishes texture commits through the controller callback, and rejects stale/failed outputs without renderer mutation.
- Added `OpenWorldTextureClaimRegistry.rejectPageBuild(...)` so stale owner output and failed page-build jobs can retire the reservation instead of leaving replacement diagnostics stuck with phantom in-flight pages.
- Runtime entity materialization now schedules texture page-build requests through the same controller-owned stream instead of applying texture commits inside `OpenWorldRuntimeEntitySystem`. Dynamic visual publication remains a Phase 24 readiness concern; this phase only moved page-build settlement and renderer texture upload out of runtime prep.
- Replacement diagnostics now expose `texturePageBuildTasks` with active tasks, recent task timings, queue/accepted/committed/failed/stale counts, owner id, source task id, bucket key, and page id. This is direct replacement evidence, not a legacy texture-manager projection.
- Spicy bit: static scene commits can now be counted as applied while their texture page tasks are still running. That is the intended loose ordering model, but it means readiness/fidelity consumers must stop treating scene commit settlement as proof that all bindings are resident. Phase 25 owns direct texture readiness and failure commits; Phase 26 owns renderer readiness gates; Phase 27 owns making material/readiness diagnostics impossible to misread.
- Concession: focused unit tests prove the task stream's accepted and stale-currentness paths directly, and static runner tests prove the commit dependency shape. The real terrain/object/env-cell/static-authored dynamic page tasks are covered by the browser harness, which now shows `texturePageBuildTasks` committing independently. Building full source-free material fixtures for every domain would require either fake DAT material identities or preserving fixture-only legacy assumptions, so that coverage is intentionally harness-backed for this phase.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/texture-residency/claims/texture-claim-registry.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/texture-page-build-task-stream.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/page-build.test.ts src/lib/systems/open-world-streaming/static-layers/terrain/terrain-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/outdoor-objects/outdoor-object-artifact-runner.test.ts src/lib/systems/open-world-streaming/static-layers/env-cells/env-cell-artifact-runner.test.ts src/lib/systems/open-world-streaming/runtime-entities/runtime-entity-system.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`, and `npm run harness:browser` passed.
- Harness note: terrain flat-color warnings remain visible after this phase. That is not papered over by the texture task stream; Phase 29 remains the owner for terrain role/readiness and shader-input investigation.

### Phase 24: Material/Readiness Resteer And Current Phase Closeout

Deliverables:

- Close the previous broad renderer-readiness phase as a resteer, not as completed implementation.
- Re-ground the remaining plan in the worksheet north star before writing more remediation code.
- Replace the broad Phase 24-29 tail with narrower phases that start from current code seams and target design contracts.
- Classify the known materialization drift as implementation debt, diagnostics debt, renderer-readiness debt, terrain role debt, worker-boundary debt, or cleanup debt.

Acceptance criteria:

- The worksheet is linked from the North Stars and named as the implementation guardrail for the remaining phases.
- The phase records concrete current-code findings instead of bug-expression-only triage.
- The following phases have file/symbol targets, direct-contract requirements, acceptance criteria, and deletion targets.
- The plan does not claim renderer readiness, material diagnostics, terrain fidelity, or cleanup implementation has landed.

Task checklist:

- [x] Recheck the remaining plan tail against the [open-world streaming stutter investigation worksheet](./holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md).
- [x] Audit current code seams for readiness, diagnostics, material coverage, terrain fallback, page-build failures, and direct-builder/test-only boundaries.
- [x] Close the broad renderer-readiness phase as split/replaced.
- [x] Add replacement-native follow-up phases with concrete current files and target contracts.
- [x] Preserve the hard-cutover and vestigial-code wipe as an explicit cleanup destination.

Decisions and course corrections:

- Phase 24 closed as a planning/resteering phase. The earlier renderer-readiness scope was too broad and mixed readiness state, renderer behavior, diagnostics, terrain role fidelity, and cleanup. Implementation is split into Phases 25-33.
- Current code finding: `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-texture-bindings.ts` has pending/resident/failed state internally, but `apps/holtburger-3d/src/lib/renderer/types.ts` and `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/commits/texture-commit-applier.ts` do not yet provide a direct failure/readiness update contract for page-build failures.
- Current code finding: `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/page-build/texture-page-build-task-stream.ts` rejects failed page builds and logs, but failed binding readiness is not yet a first-class texture commit consumed by the renderer.
- Current code finding: `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.ts` already skips pending required object-material bindings, but failed and missing-not-in-flight readiness still need a replacement-owned upstream reporting path instead of renderer hot-path exception behavior.
- Current code finding: `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts` still warns from `#warnTerrainLayeredFallback(...)` when terrain layered payload preparation fails. That is renderer-local symptom logging; it must be replaced with readiness diagnostics from the owning pipeline.
- Current code finding: `apps/holtburger-3d/src/lib/static/objects/bake/static-object-material-coverage.ts` and `StaticMaterialCoverageReport` remain broad static diagnostics. They are useful evidence, but they are not the replacement material/readiness contract.
- Current code finding: `apps/holtburger-3d/src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.ts` still exposes `buildReservedMaterialTexturePages(...)`. Production materialization should use page-build task streaming after Phase 23; any remaining direct use must be test-only, worker-internal, or deleted.

### Phase 25: Direct Texture Readiness And Failure Commits

Deliverables:

- Add a direct replacement texture-readiness update contract that can express pending, resident, failed, and missing-not-in-flight without preserving legacy diagnostic categories.
- Extend `OpenWorldStreamingTextureCommit` in `texture-residency/commits/contracts.ts` only with replacement-owned readiness facts.
- Extend `createTexturePlacementUpdate(...)` and `TexturePlacementUpdate` so renderer texture binding state can be updated for failures and explicit readiness changes, not just resident page placements.
- Make `OpenWorldTexturePageBuildTaskStream` emit failed binding readiness commits when a page build fails.
- Keep failure reporting upstream of renderer draw loops.

Acceptance criteria:

- A failed page build marks every affected binding failed through the texture commit stream.
- Renderer texture binding state can represent failed readiness without requiring a WebGL texture update.
- Missing-not-in-flight is detectable as a pipeline/apply bug from replacement state, not inferred from repeated draw failures.
- No replacement contract reuses old `TextureManager` lease/pin/mutation vocabulary.
- Tests cover successful page update commits, failed page-build commits, stale rejected builds, and renderer binding-state updates.

Task checklist:

- [x] Audit `OpenWorldStreamingTextureCommit`, `TexturePlacementUpdate`, `Webgl2RendererTextureBindingTable`, `OpenWorldTexturePageBuildTaskStream`, and `settleOpenWorldTexturePageBuildResult(...)`.
- [x] Define the minimal readiness update DTO in `texture-residency/commits/contracts.ts`.
- [x] Map readiness updates to renderer texture binding state in `texture-commit-applier.ts`.
- [x] Add `TexturePlacementUpdate` support for failure/readiness-only binding updates.
- [x] Emit failed binding updates from `texture-page-build-task-stream.ts`.
- [x] Add focused tests in `texture-commit-applier.test.ts`, `texture-page-build-task-stream.test.ts`, and `webgl2-texture-bindings.test.ts`.
- [x] Record any deliberate renderer-adapter wart and its deletion trigger.

Decisions and course corrections:

- Phase 25 completed on 2026-07-07.
- `OpenWorldStreamingTextureCommit` now carries typed `TextureBindingId` removals and exported binding-resolution records while keeping readiness variants replacement-native. Added explicit `missing-not-in-flight` readiness so pipeline bugs do not get collapsed into generic page-build failure.
- `TexturePlacementUpdate` now has `bindingReadinessUpdates` for pending, failed, and missing-not-in-flight state changes. Resident readiness still flows through `resolvedTexturePlacements` because renderer upload and resident placement are already split there.
- `Webgl2RendererTextureBindingTable` now accepts readiness-only updates without creating WebGL textures. Unknown bindings still read as implicit pending, but explicit pending updates can carry a reason for upstream diagnostics.
- `OpenWorldTexturePageBuildTaskStream` now emits a failure texture commit for every binding id carried by a failed page-build request before recording failed task diagnostics. This moves failed dependency state through the texture commit stream instead of waiting for renderer draw prep to discover it.
- Deliberate concession: the page-build failure catch still logs an upstream `console.warn` after emitting the failure commit. This is not renderer hot-path logging, but Phase 27 should replace console-only failure visibility with structured replacement diagnostics.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/texture-residency/commits/texture-commit-applier.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/texture-page-build-task-stream.test.ts src/lib/renderer/webgl2/webgl2-texture-bindings.test.ts`, and touched-file `npm exec prettier -- --check src/lib/systems/open-world-streaming/texture-residency/page-build/texture-page-build-task-stream.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/texture-page-build-task-stream.ts`.
- Verification note: full `npm run format:check` remains blocked by unrelated pre-existing formatting warnings outside this phase's touched files.

### Phase 26: Renderer Resource Readiness And Late Binding

Deliverables:

- Make installed object-material and terrain resources explicitly non-renderable while required bindings are pending or failed.
- Ensure resident texture commits promote already-installed resources on the next render/resource-prep pass without rebaking geometry or republishing scene commits.
- Remove renderer hot-path logging for normal pending/failed readiness; renderer draw prep should skip quietly and diagnostics should come from Phase 25/27 contracts.
- Preserve renderer WebGL mutation as a durable adapter boundary without teaching replacement internals renderer-specific DTO shapes.

Acceptance criteria:

- Scene-before-texture and texture-before-scene ordering works for object materials and terrain.
- Pending and failed readiness do not throw from `prepareObjectMaterialDrawPayload(...)`, `prepareTerrainLayeredPayload(...)`, or `Webgl2Renderer` draw hot paths.
- Missing-not-in-flight remains loud through commit/apply diagnostics rather than repeated renderer warnings.
- Late resident texture commits make installed resources renderable without geometry rebake.
- Browser harness output does not contain repeated terrain layered fallback warnings for normal pending readiness.

Task checklist:

- [x] Audit `runtime-entities/renderer-commits.ts`, static layer scene commit application, `webgl2-object-material-payloads.ts`, `webgl2-terrain-payloads.ts`, and `webgl2-renderer.ts`.
- [x] Update object-material validation to treat failed readiness as non-renderable while preserving upstream bug reporting for missing-not-in-flight.
- [x] Update terrain layered payload prep or its call site to distinguish pending/failed readiness from unsupported shader/input defects.
- [x] Remove or gate `#warnTerrainLayeredFallback(...)` behind upstream readiness diagnostics.
- [x] Add renderer tests for object-material scene-before-texture, texture-before-scene, failed binding, and missing-not-in-flight cases.
- [x] Add terrain tests for pending, failed, resident, and late-resident binding states.
- [x] Run terrain-focused and object-material harness scenarios.

Decisions and course corrections:

- Phase 26 completed on 2026-07-07.
- Object material draw payload prep now treats explicit failed binding readiness the same as pending readiness: the installed resource is non-renderable for that frame and draw prep returns `false` instead of throwing. Explicit `missing-not-in-flight` remains outside the deferred-readiness path and still throws as a pipeline bug.
- Added `hasDeferredTerrainLayeredTextureReadiness(...)` as a renderer-local classifier over terrain material plans. It returns true only when every unsatisfied required terrain role is pending or failed; missing binding ids, missing-not-in-flight states, and unsupported page/shader conditions are not classified as normal readiness.
- `Webgl2Renderer` now gates `#warnTerrainLayeredFallback(...)` behind that terrain readiness classifier. Normal pending/failed texture readiness skips quietly; unsupported terrain-role or shader-capacity defects still have a visible warning until Phase 29 replaces terrain-role diagnostics with structured replacement records.
- Added late-binding tests for object material and terrain prep: a resource/plan can return non-renderable while bindings are pending and become renderable after resident placement appears, without changing the resource or rebaking geometry.
- Concession: Phase 26 did not replace the actual terrain fallback renderer path or solve terrain flat-color fidelity. That remains Phase 29. This phase only prevents normal texture readiness from being reported as a renderer fallback defect.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/renderer/webgl2/webgl2-object-material-payloads.test.ts src/lib/renderer/webgl2/webgl2-terrain-payloads.test.ts src/lib/renderer/webgl2/webgl2-texture-bindings.test.ts`, touched-file `npm exec prettier -- --check src/lib/renderer/webgl2/webgl2-object-material-payloads.ts src/lib/renderer/webgl2/webgl2-object-material-payloads.test.ts src/lib/renderer/webgl2/webgl2-terrain-payloads.ts src/lib/renderer/webgl2/webgl2-terrain-payloads.test.ts src/lib/renderer/webgl2/webgl2-renderer.ts`, `npm run harness:browser -- --domains terrain --layer-distance 0 --timeout-ms 60000`, and `npm run harness:browser -- --domains terrain,generated-scenery --layer-distance 0 --timeout-ms 60000`.
- Verification note: the captured terrain harness log at `/tmp/holtburger-phase26-terrain-harness.log` had no matches for `terrain draw unit`, `terrain-debug-flat`, `rendered with terrain-debug-flat`, or `[holtburger-3d]`.

### Phase 27: Replacement Material Coverage And Readiness Diagnostics

Deliverables:

- Define replacement-native material/readiness issue records that describe source support, partition skips, texture dependency readiness, page-build failures, terrain role readiness, unsupported fidelity, and pipeline bugs.
- Keep `StaticMaterialCoverageReport` as imported evidence until deleted or isolated, but do not let it define replacement diagnostics.
- Replace console-only diagnostics in static object partitioning, visual recipe publication, bake boundaries, and page-build failures with structured replacement diagnostics or artifact failures.
- Migrate surviving harness/UI consumers directly to replacement diagnostics; any compatibility projection must be an edge shim with a deletion trigger.

Acceptance criteria:

- Coverage/readiness reports distinguish renderable support, intentionally deferred fidelity, unsupported source/material facts, pending texture readiness, failed dependencies, and missing-not-in-flight pipeline bugs.
- `static-object-material-coverage.ts` does not gate replacement behavior and cannot make unsupported/deferred material cases look successful.
- Static object skipped partitions and recipe publication failures are visible without relying on `console.warn`.
- Harness summaries do not require old static coordinator, static commit install, or texture manager categories.
- Tests prove replacement diagnostic records from replacement behavior, not legacy report parity.

Task checklist:

- [x] Audit consumers of `StaticMaterialCoverageReport` in `static/contracts.ts`, env-cell bakers, static object partitioning, renderer types, diagnostics, and harness projections.
- [x] Audit `static-object-material-coverage.ts`, `object-visual-material-planner.ts`, `static-object-renderability.ts`, `static-bake-boundary-diagnostics.ts`, and controller diagnostics against the worksheet.
- [x] Add replacement issue record types under `systems/open-world-streaming/diagnostics` or domain-local diagnostics modules.
- [x] Replace console warnings in static object skipped partitions and visual recipe publication with structured records.
- [x] Replace page-build failure console-only reporting with structured readiness/failure diagnostics.
- [x] Update browser harness summaries to consume direct replacement diagnostics or an explicitly named edge shim.
- [x] Delete or rewrite tests that treat legacy diagnostic parity as correctness.

Decisions and course corrections:

- Phase 27 completed on 2026-07-07.
- Added `OpenWorldStreamingMaterialReadinessDiagnostics` to the replacement diagnostics snapshot. It records pending texture dependencies from active page-build tasks, failed texture dependencies from recent page-build failures, unsupported/deferred material coverage evidence, skipped static object partitions, and pipeline bugs such as skipped static visual recipe publication.
- `StaticMaterialCoverageReport` remains imported evidence from the static bakers, but replacement diagnostics now translate its unrendered buckets into replacement issue records. It does not gate replacement behavior and is not treated as the replacement diagnostics contract.
- Static object skipped partitions now flow through `StaticObjectBakeDiagnostics.skippedPartitions` instead of `console.warn`. The controller reports them as `skipped-static-object-partition` readiness issues with slice id, family, pass, render coverage, reason, material count, and triangle count.
- Static object visual recipe publication now records `published` or `skipped` diagnostics. Skipped publication is reported as a replacement `pipeline-bug` issue with missing dependency evidence when present.
- Page-build failures no longer rely on a page-build catch-block warning. Failure visibility comes from texture page-build task diagnostics and failed binding readiness commits.
- Browser harness audit: `BrowserPipelineHarness.svelte` and `scripts/browser-pipeline-harness.mjs` consume the replacement `openWorldStreaming` snapshot and `staticTasks` summary. They do not require old static coordinator, static commit installer, or texture-manager categories, so no compatibility shim was added.
- Remaining console warnings found by audit are not Phase 27 static-object/page-build replacements: `visual/object-visual-baker.ts` still warns for unsupported generic visual material baking, and env-cell system bake/resolver code still has console diagnostics. Phase 28 should decide whether the visual material warning is a static-object material-contract issue or renderer-fidelity backlog. Phase 30/32 should classify the env-cell warnings as direct diagnostics, deletion, or acceptable debug-only evidence.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/texture-page-build-task-stream.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts`, and touched-file Prettier.

### Phase 28: Static Object Material Contract Reconciliation

Deliverables:

- Audit what failed to land or was intentionally scoped out from `static-object-material-coverage.ts` compared with the worksheet target design.
- Reconcile static object material planning, renderability, placement policy, bake output, and diagnostics around direct replacement contracts.
- Build a material fidelity backlog from source-data evidence and replacement diagnostics, not from old fallback categories.
- Implement the first small fidelity or material-contract slice only if the audit identifies a low-risk contract correction; otherwise record the backlog and defer rendering feature work explicitly.

Acceptance criteria:

- The audit lists every unsupported/deferred material family with source evidence, current file/symbol owner, target contract, and whether it is architecture debt or renderer-fidelity backlog.
- Detail overlays, additive, inverse alpha, unusual translucent, unsupported surface flags, missing palette/render-surface, and palette/index/detail texture requirements are classified explicitly.
- Static object material placement uses `TexturePlacementPolicy` and replacement bucket policy directly, without ignored `placementBucketKey` fields.
- Any implemented first slice has fixture evidence and updates planner, renderability, bake output, renderer payload, and diagnostics coherently.
- Unsupported material cases remain visible after the phase.

Task checklist:

- [x] Compare `static-object-material-coverage.ts` against `object-visual-material-planner.ts`, `static-object-renderability.ts`, and the worksheet root-cause direction.
- [x] Audit `createStaticObjectTexturePlacementIntents(...)`, `object-visual-texture-placement-planner.ts`, and placement policy tests for legacy bucket-field drift.
- [x] Classify each material/fidelity item as contract bug, renderer capability backlog, source-data limitation, or acceptable future scope.
- [x] Classify the remaining `visual/object-visual-baker.ts` unsupported material warning: either replace it with Phase 27 material-readiness diagnostics or prove it belongs to a non-static-object renderer-fidelity backlog.
- [x] Audit env-cell material coverage from `structured-interior-material-planner.ts` and `env-cell-system-baker.ts` so interior material coverage does not stay hidden behind env-cell-specific warning paths.
- [x] Pick and implement at most one first slice if it is contract-shaped and low risk.
- [x] Update diagnostics from Phase 27 so the backlog remains measurable.
- [x] Run generated scenery, explicit object, and env-cell harness cases that exercise static object materials.

Decisions and course corrections:

- Phase 28 completed on 2026-07-07.
- Audit classification against the worksheet:
  - `missing-render-surface` and `missing-palette` in `object-visual-material-planner.ts` are source-data/resolution limitations or asset-reader gaps. They remain `unsupported-material` diagnostics and should not become renderer fallbacks.
  - `unsupported-surface-flag` is architecture/material-contract debt until every AC surface flag has a named renderer/material meaning. It remains unsupported and measurable through material readiness.
  - `detail-overlay-render-deferred` is renderer-fidelity backlog when the detail role is unsupported for a static family or when an otherwise unrenderable pass blocks detail composition. Supported building/environment detail overlays already flow through `detail-overlay` texture roles.
  - `translucent-render-deferred`, additive, inverse alpha, and unusual translucent blends are renderer capability backlog. The planner names the blend/pass and keeps them deferred instead of forcing them through opaque/static buckets.
  - Indexed palette requirements are contract-supported when both index render surface and palette source resolve. Missing palette/render-surface stays unsupported; index/palette/detail texture requirements remain explicit texture roles and page purposes.
- Low-risk slice implemented: object-visual static placement requirements now require an explicit `TexturePlacementPolicy`. Static object and structured-interior placement planners pass `createStaticDomainTexturePlacementPolicy()` directly instead of relying on an optional static-domain default in `object-visual-texture-placement-planner.ts`. This aligns static object material placement with the replacement bucket policy contract and prevents future callers from silently inheriting legacy-style bucket defaults.
- `createStaticTexturePlacementIntent(...)` still has a generic static-domain default because terrain still uses that helper directly. Phase 29 owns terrain isomorphism and should decide whether to remove that default after terrain placement is reconciled.
- Removed the structured-interior material omission `console.warn` from `env-cell-system-baker.ts`. The same source facts already flow through `createStructuredInteriorMaterialCoverageReport(...)`, static bake material coverage, and Phase 27 `materialReadiness`; keeping a parallel env-cell material warning would preserve a diagnostics side channel.
- The remaining `visual/object-visual-baker.ts` unsupported material warning is generic visual-baker behavior, not the static-object material contract source of truth. Static object replacement paths now expose unsupported/deferred material facts before bake through coverage/readiness diagnostics. Phase 32 should delete or replace the generic warning after confirming dynamic/runtime visual consumers have equivalent direct diagnostics.
- Remaining env-cell warnings in `env-cell-system-baker.ts` and `env-cell-system-resolver.ts` are geometry/publication/BVH diagnostics, not material coverage diagnostics. Phase 30/32 should classify them as direct diagnostics, deletion, or durable debug output.
- Harness note: `npm run harness:browser -- --domains generated-scenery,explicit-objects,env-cells --layer-distance 0 --timeout-ms 60000` timed out with zero open-world owners/static tasks, so it did not exercise the target material paths. Rerunning with terrain included (`--domains terrain,generated-scenery,explicit-objects,env-cells --layer-distance 0 --timeout-ms 60000`) passed with 4 ready artifacts, 4 applied scene commits, 11 committed texture page builds, 0 failed static tasks, 0 failed texture page builds, and 2 structured-interior `deferred-material` readiness issues.
- Verification: `npm run check`, focused `npm run test:ts -- --run src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/visual/object-visual-texture-placement-planner.test.ts src/lib/textures/placement.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-policy.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts`, focused `npm run test:ts -- --run src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/visual/object-visual-texture-placement-planner.test.ts src/lib/textures/placement.test.ts`, and browser harness as noted.

### Phase 29: Terrain Texture Role And Flat-Color Audit

Deliverables:

- Investigate terrain flat-color rendering through the shared texture readiness/material contract rather than terrain-special rendering paths.
- Audit terrain color/detail/mask role placement, page commit application, draw-unit material payloads, shader sampler inputs, and terrain page capacity.
- Compare terrain role buckets with object material color/detail/index/palette purposes and document real role differences versus accidental bespoke handling.
- Remove or collapse any terrain-only workaround that duplicates shared material placement/page-build semantics.

Acceptance criteria:

- Terrain no longer renders flat color when source data and page commits provide required color/detail/mask roles.
- If terrain cannot render full fidelity for a source-data or shader-capacity reason, diagnostics name the missing role, page, sampler, shader input, or unsupported fidelity.
- Terrain role buckets remain an application of replacement texture policy, not a separate terrain materialization pipeline.
- Tests cover terrain role readiness and renderer input binding at the replacement contract level.
- Terrain and all-domain browser harness runs prove terrain material visibility without reintroducing main-thread texture placement bursts.

Task checklist:

- [x] Trace terrain texture intents from the terrain static layer through reservation, page build, texture commit, scene commit, and `prepareTerrainLayeredPayload(...)`.
- [x] Audit terrain role page grouping and renderer page-role capacity against object material bucket/purpose grouping.
- [x] Add terrain role readiness diagnostics using Phase 27 records.
- [x] Fix the smallest shared-contract gap that explains flat-color terrain.
- [x] Delete any terrain-only workaround made obsolete by the shared fix.
- [x] Run terrain-focused and all-domain browser harness cases.

Decisions and course corrections:

- Phase 29 completed on 2026-07-07.
- Terrain intent trace: `terrain-geometry-baker.ts` emits static texture placement intents for `terrain-color`, `terrain-detail`, and `terrain-mask` purposes; the open-world controller retains those claims through `OpenWorldTextureClaimRegistry`; page build tasks emit replacement texture commits; terrain scene commits can apply independently; `webgl2-terrain-payloads.ts` and `webgl2-renderer.ts` bind the resulting page resources for layered terrain draw units.
- Terrain role buckets are not a separate materialization pipeline. They are replacement texture buckets with `domain=outdoor-terrain`, `scope=static-domain`, and purpose-specific roles. This differs from regular static objects only in renderer material semantics: object visuals can have color/detail/index/palette purposes per material family, while terrain has role-specific layered samplers for color/detail/mask. Both use the same replacement placement/claim/page-build/commit machinery.
- Removed the terrain-only rejection that forced any clamped non-alpha terrain binding into `terrain-debug-flat`. The worksheet model treats wrap mode as material/shader sampling policy, not page-placement compatibility.
- Removed the remaining implicit static placement-policy default from `createStaticTexturePlacementIntent(...)`. Terrain now passes `createStaticDomainTexturePlacementPolicy()` explicitly, matching the Phase 28 object/structured-interior correction and preventing new static callers from inheriting a silent bucket policy.
- Added replacement-native `terrain-material-issue` readiness diagnostics from draw-unit fallback reasons. Terrain fidelity failures are now visible through material readiness with draw-unit, owner, task, pcode, texture id, material family, and reason code instead of relying on renderer warning text.
- The renderer warning for `terrain-debug-flat` still exists as a renderer-side smoke alarm for unsupported layered terrain resources. It is no longer the primary diagnostics contract. Phase 33 owns deciding whether that warning becomes structured renderer diagnostics or is deleted after all terrain fallback cases are covered upstream.
- Harness evidence: terrain-only `npm run harness:browser -- --domains terrain --layer-distance 0 --timeout-ms 60000 --output /tmp/holtburger-phase29-terrain.json` passed with 3 terrain draw units, renderer `error: null`, and no frame gaps over 50 ms or 100 ms, but its final readiness sample was captured before all texture page builds settled. That run proves loose ordering tolerance, not final texture residency.
- Harness evidence: all-domain `npm run harness:browser -- --domains terrain,generated-scenery,explicit-objects,env-cells --layer-distance 0 --timeout-ms 60000 --output /tmp/holtburger-phase29-all-domain-r0.json` passed with 4 ready artifacts, 4 applied scene commits, 11 resident texture pages, 11 committed page builds, 3 terrain draw units, 26,989 rendered triangles, zero failed texture dependencies, zero pending texture dependencies, zero terrain material issues, and two structured-interior deferred-material issues.
- Verification: `npm run check`, focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/static/terrain/bake/terrain-material-family-classifier.test.ts src/lib/static/terrain/bake/terrain-geometry-baker.test.ts src/lib/renderer/webgl2/webgl2-terrain-payloads.test.ts src/lib/textures/placement.test.ts src/lib/static/bake/static-material-texture-policy.test.ts`, and the browser harness runs noted above.

### Phase 30: Resteering Checkpoint 6 - Readiness/Diagnostics Review

Deliverables:

- Dry-run Phases 31-36 against the current code after direct readiness, renderer late binding, diagnostics, static object reconciliation, and terrain role work.
- Recheck every touched contract against the worksheet north star before worker-boundary cleanup begins.
- Classify every touched consumer as direct migration, deletion, legacy-edge shim, or durable adapter.
- Decide whether any remaining material/fidelity issue blocks cleanup or should be explicitly deferred as renderer backlog.

Acceptance criteria:

- The plan records whether remaining issues are architecture debt, material fidelity backlog, renderer capability backlog, diagnostics debt, worker-boundary debt, or acceptable future scope.
- No phase proceeds with a legacy-shaped diagnostic, DTO, or test expectation inside replacement internals.
- Every remaining shim has a deletion task or is promoted to a durable adapter with a real post-cutover boundary reason.
- The cleanup phases are specific enough to execute without guessing.

Task checklist:

- [x] Dry-run worker-boundary cleanup, placement/readiness cleanup, diagnostics cleanup, source-tree cleanup, and final verification from the current code tree.
- [x] Audit direct builder production usage in `material-texture-placement-plan.ts`, `object-visual-texture-placement-plan.ts`, `direct-page-builder.ts`, `page-build.worker.ts`, `object-visual-atlas-builder.ts`, and `object-visual-atlas.worker.ts`.
- [x] Audit placement and readiness contract drift in `placement.ts`, `material-texture-placement-policy.ts`, terrain/object/static tests, and `open-world-streaming-controller.ts`.
- [x] Audit diagnostic compatibility projections in `client-runtime-adapter.ts`, `browser-pipeline-harness.mjs`, renderer fallback warnings, visual baker warnings, and env-cell warnings.
- [x] Audit tests for legacy bucket/readiness/diagnostic parity assumptions.
- [x] Update Phases 31-36 with any ordering changes discovered by the dry run.
- [x] Record explicitly deferred material fidelity work with evidence and reactivation criteria.

Decisions and course corrections:

- Phase 30 completed on 2026-07-07.
- Worksheet recheck: Requirements 5, 7, 13, 14, and the page-build split still steer the remaining work. The target remains explicit replacement bucket policy, static-authored dynamic sharing by parent/static-domain where content-stable, terrain/object isomorphic placement, multi-owner texture claims, loose scene/texture ordering, and worker-owned source preparation/page materialization.
- Dry-run finding for Phase 31: production terrain, outdoor object, env-cell, and runtime-entity artifact runners already call `reserveMaterialTexturePlacements(...)` or `reserveObjectVisualTexturePlacements(...)`, then hand `pageBuildRequests` to the controller's task stream. The risk is no longer broad production use of synchronous page building; the risk is the misleading exported `buildMaterialTexturePlacementPlan(...)`, `buildObjectVisualTexturePlacementPlan(...)`, and `buildReservedMaterialTexturePages(...)` trapdoor plus tests that still treat direct builders as the normal plan path.
- Phase 31 is therefore steered toward deleting or test-isolating synchronous builder convenience APIs and rewriting tests around reservation plus worker/page-build settlement. This is a cleaner cut than wrapping the direct path with more policy.
- Dry-run finding for Phase 32: Phase 29 removed the implicit runtime behavior from `createStaticTexturePlacementIntent(...)` at runtime, but `TexturePlacementIntentOptions.placementPolicy` is still optional at the type level. That weakens the direct contract and should be tightened instead of relying on runtime throws forever. `createObjectVisualStaticTexturePlacementIntent(...)` and `createDynamicTexturePlacementIntent(...)` need the same type-level audit.
- Phase 32 should also decide whether legacy `ownerIds`, `pageClass`, and old texture-use identity fields are adapter inputs, bake-facing facts, or vestigial fields. Do not delete them blindly; classify them against current static bake consumers first.
- Dry-run finding for Phase 33: remaining materialization-ish `console.warn(...)` sites are concrete: terrain layered fallback in `webgl2-renderer.ts`, unsupported visual material in `visual/object-visual-baker.ts`, structured-interior missing recipe dependencies and geometry surface omissions in `env-cell-system-baker.ts`, and env-cell BVH/static placement omissions in `env-cell-system-resolver.ts`. Some are renderer/debug smoke alarms, not all are material-readiness defects.
- Dry-run finding for Phase 34: `client-runtime-adapter.ts` still projects replacement diagnostics into `RuntimeOverviewSnapshot.static`, and `browser-pipeline-harness.mjs` still stores `staticOverview` beside replacement `openWorldStreaming`. That is an edge projection, but it remains a shim-shaped consumer that should be migrated or deleted before final cutover.
- Dry-run finding for Phase 35: the currently proven unresolved fidelity issue is the two structured-interior `deferred-material` readiness records from the Phase 29 all-domain harness. Treat them as the first backlog triage target; terrain has zero material issues in the same run.
- Classification summary: direct migration targets are placement intent option types, placement/readiness tests, page-build tests, and harness diagnostics consumers. Deletion targets are direct synchronous build-plan helpers if no production caller remains, warning-text-only tests, and legacy-shaped overview projections that survive only for old reports. Durable adapters are worker handlers, renderer texture commit appliers, asset readers, and harness composition. Edge shims are `client-runtime-adapter.ts` overview projection and harness `staticOverview` until migrated.
- Spicy bit: the code shape is better than the phase text assumed. The trap is not that production still uses the direct builders everywhere; it is that the API and tests make the wrong path look blessed. Leaving that around would quietly teach future code to reintroduce the worksheet's original stutter mechanism.

### Phase 31: Worker Boundary And Production Page-Build Cutover

Deliverables:

- Preserve the current production split where terrain, outdoor object, env-cell, and runtime-entity runners call reservation APIs and the controller owns page-build task settlement.
- Delete or test-isolate synchronous convenience helpers in `texture-residency/placement/material-texture-placement-plan.ts` and `texture-residency/placement/object-visual-texture-placement-plan.ts`.
- Route tests that need page pixels through worker-client/handler settlement or explicitly named worker-internal direct builders.
- Keep direct builders test-only or worker-internal, with names/import paths that make that status obvious.
- Remove or rename APIs that imply `buildReservedMaterialTexturePages(...)` is production-safe from the browser main loop.

Acceptance criteria:

- No production static or runtime materialization path calls `buildReservedMaterialTexturePages(...)`.
- `DirectOpenWorldTexturePageBuilder` and `DirectOpenWorldObjectVisualAtlasBuilder` are imported only by tests or worker handlers.
- Production bake-facing placement plans return immutable placement/source facts and reservations, not already materialized page pixels.
- `buildMaterialTexturePlacementPlan(...)` and `buildObjectVisualTexturePlacementPlan(...)` are deleted, renamed as test-only helpers, or otherwise made impossible to import from production modules.
- Any remaining synchronous source-preparation work on the browser main thread is measured, named, and accepted as a deliberate exception against the worksheet.
- Tests cover the worker-client/handler path and stale/noop/failure settlement rather than direct-builder production shortcuts.
- Browser harness does not show a new main-thread packing/page-materialization blackout.

Task checklist:

- [x] Audit imports of `buildReservedMaterialTexturePages`, `DirectOpenWorldTexturePageBuilder`, and `DirectOpenWorldObjectVisualAtlasBuilder`.
- [x] Confirm production callers use `reserveMaterialTexturePlacements(...)` or `reserveObjectVisualTexturePlacements(...)` and controller-owned page-build tasks, not synchronous build-plan helpers.
- [x] Delete or move `buildMaterialTexturePlacementPlan(...)`, `buildObjectVisualTexturePlacementPlan(...)`, and `buildReservedMaterialTexturePages(...)` behind test-only or worker-internal boundaries.
- [x] Replace direct build-plan tests with reservation tests plus page-build worker/settlement tests.
- [x] Keep worker handlers as the only non-test callers of `DirectOpenWorldTexturePageBuilder` and `DirectOpenWorldObjectVisualAtlasBuilder`.
- [x] Move any direct-builder fixtures into test-only helpers if production modules no longer need them.
- [x] Add or update tests for worker-client page-build output, object-visual atlas worker output, and controller settlement.
- [x] Run `npm run check`, focused worker/page-build/placement tests, and all-domain browser harness.

Decisions and course corrections:

- Phase 31 completed on 2026-07-07.
- Deleted the synchronous public build-plan helpers: `buildMaterialTexturePlacementPlan(...)`, `buildObjectVisualTexturePlacementPlan(...)`, and `buildReservedMaterialTexturePages(...)`. Replacement production paths now expose reservation APIs only; page pixels flow through page-build task settlement.
- Production caller audit: `terrain-artifact-runner.ts`, `outdoor-object-artifact-runner.ts`, `env-cell-artifact-runner.ts`, and `runtime-entity-system.ts` already use `reserveMaterialTexturePlacements(...)` or `reserveObjectVisualTexturePlacements(...)` and then let the controller/task stream settle `pageBuildRequests`. No production static/runtime materialization path calls the removed synchronous helpers.
- Direct builder boundary audit: `DirectOpenWorldTexturePageBuilder` remains imported only by `page-build.worker.ts` and `page-build.test.ts`; `DirectOpenWorldObjectVisualAtlasBuilder` remains imported only by `object-visual-atlas.worker.ts` and the object visual placement test. That keeps direct builders worker-internal or test-local.
- Test steer: `material-texture-placement-plan.test.ts` now covers bake-facing reservations and page-build requests, not immediate resident texture commits. `object-visual-texture-placement-plan.test.ts` now asserts placement snapshots, claim registry building state, and page-build requests. Page pixel materialization and settlement remain covered by `page-build.test.ts`.
- Spicy bit: this phase removed an attractive but wrong API rather than adding another guard around it. The previous helper name made it too easy for future production code to await page pixels before bake, recreating the worksheet's main-thread texture transaction shape.
- Harness evidence: `npm run harness:browser -- --domains terrain,generated-scenery,explicit-objects,env-cells --layer-distance 0 --timeout-ms 60000 --output /tmp/holtburger-phase31-all-domain-r0.json` passed with 4 ready artifacts, 4 applied scene commits, 11 resident texture pages, 11 accepted/committed page builds, 0 active page builds, 0 pending texture dependencies, 0 failed texture dependencies, 3 terrain draw units, 26,989 rendered triangles, max long task about 118 ms, and max renderer frame delta about 118.8 ms.
- Remaining debt after Phase 31: the all-domain harness still reports 2 structured-interior `deferred-material` readiness issues. That is unchanged from Phase 29 and remains Phase 35's first triage target.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/page-build/page-build.test.ts`, and the all-domain browser harness above.

### Phase 32: Static Placement And Material Readiness Contract Cleanup

Deliverables:

- Collapse static terrain, static object, structured interior, and static-authored dynamic texture placement onto explicit replacement policy facts.
- Remove ignored or misleading placement fields from production replacement contracts.
- Ensure material coverage stays diagnostic-only and cannot be interpreted as successful render readiness.
- Make pending, failed, unsupported, and deferred material states direct replacement readiness facts.

Acceptance criteria:

- `createStaticTexturePlacementIntent(...)` has no implicit static-domain behavior and every production caller passes an explicit `TexturePlacementPolicy`.
- No replacement production path uses `placementBucketKey` or legacy `TexturePlacementBucketKey` as authority for bucket policy.
- Static object, terrain, structured interior, and static-authored dynamic placement tests assert policy facts instead of old bucket string parity.
- `materialReadiness` distinguishes pending texture dependencies, failed texture dependencies, unsupported materials, deferred fidelity, skipped partitions, terrain material issues, and pipeline bugs without renderer warning dependence.

Task checklist:

- [x] Audit `apps/holtburger-3d/src/lib/textures/placement.ts` for optional defaults and legacy placement fields that replacement callers can still accidentally use.
- [x] Make replacement placement policy required at the type level for static and dynamic placement intent creation, or split input types so legacy texture-use facts cannot omit replacement policy.
- [x] Audit `material-texture-placement-policy.ts`, `object-visual-texture-placement-plan.ts`, `static-material-texture-policy.test.ts`, `placement.test.ts`, terrain bake tests, and object visual tests for old bucket parity expectations.
- [x] Classify `ownerIds`, `pageClass`, `textureKey`, and bake-facing item ids as durable bake/renderer facts, adapter inputs, or vestigial fields before deleting or renaming them.
- [x] Remove or isolate any production use of ignored `placementBucketKey` facts.
- [x] Add readiness tests that prove material coverage alone does not mark a resource renderable.
- [x] Update all touched consumers as direct migrations, deletions, edge shims, or durable adapters in the phase decisions.
- [x] Run focused placement/material-readiness tests and `npm run check`.

Decisions and course corrections:

- Phase 32 completed on 2026-07-07.
- Tightened the placement intent API: `TexturePlacementIntentOptions.placementPolicy` is now required at the type level, and `createStaticTexturePlacementIntent(...)`, `createObjectVisualStaticTexturePlacementIntent(...)`, `createDynamicTexturePlacementIntent(...)`, and `createObjectVisualDynamicTexturePlacementIntent(...)` no longer accept omitted replacement policy. The old runtime throw tests were deleted because the compiler is now the guard.
- Split internal identity validation away from `TexturePlacementIntentOptions` so replacement policy is required only at the API boundary, not smuggled into helper shapes that only validate binding/owner/page identity.
- Placement field classification:
  - `textureKey` remains durable canonical texture identity used for source dedupe and renderer/bake placement facts.
  - `pageClass` remains durable atlas compatibility policy used by placement planning and renderer legality.
  - `ownerIds` remains an adapter/bake bridge while older static/dynamic texture-use facts still carry texture-owner vocabulary; replacement ownership authority is still `MaterializationOwnerId` plus texture claim owner state.
  - Static `itemId` and object-visual numeric bake ids remain bake-facing lookup facts, not residency ownership.
- Legacy bucket audit: no production replacement path references old `placementBucketKey` or `TexturePlacementBucketKey`. The remaining `createMaterialTexturePlacementBucketKey(...)` uses replacement `TexturePlacementPolicy` and `OpenWorldTextureBucketKey`, so it is direct replacement contract, not legacy parity.
- Readiness cleanup: added a controller test proving rendered material coverage reports do not create material readiness issues. Unsupported/deferred coverage remains the source of readiness issues; coverage itself stays diagnostic evidence, not proof of render readiness.
- Consumer classification: placement intent callers are direct migrations; deleted omission tests were architecture-preserving tests; `material-texture-placement-policy.ts` remains the durable replacement policy reducer; no edge shim was added.
- Spicy bit: leaving `placementPolicy` optional with a runtime throw was a polite lie. It made the new contract look optional to TypeScript and would let dead-shape tests keep old call forms alive.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/textures/placement.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts src/lib/visual/object-visual-texture-placement-planner.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-policy.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts`.

### Phase 33: Renderer And Domain Diagnostics Contract Cleanup

Deliverables:

- Replace remaining renderer/domain `console.warn(...)` materialization diagnostics with direct replacement diagnostics or delete them if they preserve obsolete concepts.
- Classify renderer fallback warnings separately from source/bake/material readiness.
- Preserve durable debug output only when it names a current replacement-domain failure mode and is not a legacy compatibility report.

Acceptance criteria:

- `webgl2-renderer.ts` terrain layered fallback warning is either deleted or backed by structured renderer/fidelity diagnostics that do not duplicate material readiness.
- `visual/object-visual-baker.ts` unsupported-material warning is either replaced by direct visual/material diagnostics or proven to be outside static-object replacement material coverage.
- `env-cell-system-baker.ts` and `env-cell-system-resolver.ts` warnings are classified as geometry/publication/BVH diagnostics, direct replacement diagnostics, or deleted.
- The browser harness and UI diagnostics consume replacement-native diagnostics where they survive cutover; any temporary projection is named as a legacy-edge shim with a deletion trigger.

Task checklist:

- [x] Audit `webgl2-renderer.ts` `#warnTerrainLayeredFallback(...)` and its tests after Phase 29 terrain readiness diagnostics.
- [x] Audit `visual/object-visual-baker.ts` warning paths and decide whether dynamic/runtime visual consumers need a direct diagnostic before deletion.
- [x] Replace unsupported visual material warning text with structured diagnostics when the unsupported recipe is expected to survive into dynamic/runtime visual paths.
- [x] Audit `static/env-cells/bake/env-cell-system-baker.ts` warnings for material, geometry, publication, and BVH categories.
- [x] Audit `static/env-cells/env-cell-system-resolver.ts` BVH warnings for whether they belong in replacement diagnostics or debug-only tooling.
- [x] Keep browser interaction warnings in `BrowserDisplay.svelte` and spawn seed resolver warnings out of this phase unless they preserve materialization/streaming pipeline concepts.
- [x] Migrate surviving diagnostics consumers in `client-runtime-adapter.ts`, `BrowserPipelineHarness.svelte`, and `browser-pipeline-harness.mjs` to direct replacement contracts where practical.
- [x] Add tests for any new structured diagnostics and delete tests that only preserve warning text.

Decisions and course corrections:

- Phase 33 completed on 2026-07-07.
- Deleted renderer terrain layered fallback console warnings from `webgl2-renderer.ts`. Terrain fallback reasons are now replacement readiness diagnostics from Phase 29, so renderer hot paths no longer narrate materialization failures.
- Deleted `hasDeferredTerrainLayeredTextureReadiness(...)` and its tests after removing the renderer warning path. That helper existed only to decide whether to log; keeping it would preserve warning-driven design.
- Deleted the unsupported object visual material console warning from `object-visual-baker.ts`. Static object unsupported/deferred material facts are already reported through planner coverage and `materialReadiness`; dynamic/runtime unsupported visual material diagnostics remain a Phase 35 fidelity/diagnostics backlog item rather than console text.
- Deleted the structured-interior missing-dependency publication warning from `env-cell-system-baker.ts`. Outdoor static objects already expose equivalent publication failures through `StaticObjectVisualRecipePublicationDiagnostics`; structured-interior publication diagnostics should get the same direct shape in a later env-cell diagnostics pass instead of a warning side channel.
- Retained the structured-interior geometry surface omission warning in `env-cell-system-baker.ts` for now. It is geometry/source omission evidence, not material readiness, and it names the current replacement-domain failure mode. Phase 35/34 may promote it to structured diagnostics if it must survive final cutover.
- Retained `env-cell-system-resolver.ts` BVH and omitted static seed warnings as resolver/source geometry diagnostics. They do not preserve old texture/materialization categories and are not a legacy diagnostic snapshot.
- Browser interaction warnings in `BrowserDisplay.svelte` and spawn seed resolver warnings were explicitly left out of scope; they do not preserve open-world materialization pipeline concepts.
- `client-runtime-adapter.ts`, `BrowserPipelineHarness.svelte`, and `browser-pipeline-harness.mjs` did not need Phase 33 changes after warning deletion. Their remaining legacy-shaped overview/harness projections are Phase 34 shim cleanup, not renderer/domain warning cleanup.
- No new structured diagnostics were added in this phase because the correct replacement readiness records already existed for terrain/static material coverage. Adding new records only to replace warning text would duplicate Phase 27/29 diagnostics.
- Spicy bit: deleting `hasDeferredTerrainLayeredTextureReadiness(...)` was the tell. Once the warning was gone, the helper had no design job left. Keeping it would have made tests protect a dead diagnostic pathway.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/renderer/webgl2/webgl2-renderer.test.ts src/lib/renderer/webgl2/webgl2-terrain-payloads.test.ts src/lib/visual/object-visual-baker.test.ts src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/env-cells/env-cell-system-resolver.test.ts src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`.

### Phase 34: Runtime/Harness Shim Audit And Resteer

Deliverables:

- Close the current broad cleanup phase by auditing what is still unresolved against the [open-world streaming stutter investigation worksheet](./holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md).
- Split unresolved work into implementation phases that are grounded in current code, not issue symptoms.
- Classify every remaining touched consumer as direct migration, deletion, legacy-edge shim, or durable adapter.
- Preserve the design north star explicitly: worker-owned source preparation/layout/page build where feasible, replacement-native diagnostics, direct contracts, and hard vestigial wipe.

Acceptance criteria:

- The plan identifies concrete current-code gaps instead of bug-expression triage buckets.
- The next phases link back to the worksheet and name the current files/symbols they will change or delete.
- Any unresolved Phase 34 cleanup task is moved into a later phase with acceptance criteria and a verification path.
- Final hard cutover remains deletion-oriented; no compatibility projection is rebranded as durable architecture.

Task checklist:

- [x] Audit production imports for `StaticCoordinator`, `TextureManager`, old static commit counters, old diagnostics snapshots, and legacy-shaped runtime projections.
- [x] Identify runtime/harness/UI projections that still preserve old static overview shape.
- [x] Audit material coverage and readiness code for places where diagnostics may be smuggling old broad static concepts into replacement truth.
- [x] Audit texture placement/page-build code for worksheet deviations around main-thread source preparation, layout, packing, and page materialization.
- [x] Move unresolved deletion and migration work into concrete follow-up phases instead of leaving it as one oversized cleanup bucket.
- [x] Dry-run the next phases through hard cutover and revise ordering.

Decisions and course corrections:

- Phase 34 completed as a closeout/resteer phase, not as the final wipe. The original Phase 34 scope mixed four different jobs: worker-ownership gaps, diagnostics contract shape, UI/harness shim deletion, and source-tree/hard-cutover cleanup. Keeping that as one phase would encourage hand-wavy deletion.
- Import audit found no replacement-internal imports of `StaticCoordinator` or `TextureManager`, which is good. The remaining vestigial pressure is now mostly at consumers and boundaries: `client-runtime-adapter.ts` still projects `RuntimeOverviewSnapshot.static`, `browser-pipeline-harness.mjs` still includes `staticOverview`, and `BrowserDisplay.svelte` still reads the legacy-shaped overview for browser panels.
- Phase 34 audit risk against the worksheet: `DirectOpenWorldObjectVisualAtlasBuilder` in `texture-residency/placement/object-visual-atlas-builder.ts` still performs `texture-source-preparation` and `texture-layout`. Phase 35 must prove production browser composition reaches that direct builder only inside a worker entrypoint, because the worksheet's target model says source preparation, layout search, guttered blits, and page rebuilds should be worker-owned unless a measured constraint proves a narrow exception.
- Phase 34 audit risk against the worksheet: `reserveMaterialTexturePlacements(...)` in `texture-residency/placement/material-texture-placement-plan.ts` has a good replacement-native reservation/page-build shape, but Phase 35 must verify production object atlas layout reaches that shape through a worker-backed builder rather than a browser-side direct builder.
- Current-code gap against the worksheet: `static-object-material-coverage.ts` remains a broad static material coverage report. It is useful evidence, but if it becomes the surviving readiness contract it will preserve static-era categories instead of the replacement model's direct material readiness facts.
- Current-code gap against the migration policy: `RuntimeOverviewSnapshot.static`, `createRuntimeStaticOverviewFromController(...)`, and harness `staticOverview` are shims. They are allowed only as deletion-targeted edge projections and must not survive the hard cutover.
- Resteer: split the remaining work into worker-owned material atlas work, direct material/readiness diagnostics, deferred fidelity triage, runtime/harness/UI shim deletion, source-tree ownership cleanup, and final hard cutover.

### Phase 35: Worker-Owned Material Atlas Source And Layout

Design north star:

- Follow the [worksheet's texture split](./holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md): placement reservation and authoritative registry updates stay in the replacement main-loop service, while expensive source preparation, layout search, packing, guttered blits, and page rebuilds move to worker-owned transforms unless measured evidence proves a narrow exception.

Deliverables:

- Replace production use of `DirectOpenWorldObjectVisualAtlasBuilder` with a worker-backed material atlas builder that preserves the direct replacement contract from `object-visual-atlas-builder.ts`.
- Define the data ownership contract for prepared texture pixels before transfer. The implementation must not detach shared prepared-asset cache buffers as the Phase 11C failed experiment did.
- Keep `reserveMaterialTexturePlacements(...)` as the reservation/page-build contract and move only the expensive atlas source/layout work behind the builder boundary.
- Keep direct builders test-only, worker-internal, or explicitly named debug fallbacks; production browser composition should not silently choose main-thread atlas source/layout.
- Add replacement-native worker-boundary diagnostics for source preparation, layout, page count, source count, and transfer/copy behavior.

Acceptance criteria:

- Browser production composition injects a worker-backed `OpenWorldMaterialTextureAtlasBuilder` for object/env-cell/runtime material placement.
- No production browser path uses `DirectOpenWorldObjectVisualAtlasBuilder` for object visual material atlas work.
- Prepared texture transfer/copy semantics are explicit and tested; shared asset-cache buffers are not detached.
- Texture placement diagnostics distinguish source preparation, layout, page-build request settlement, and renderer texture commit apply without recreating legacy `TextureManager` mutation categories.
- All-domain radius-1 harness remains settled inside the existing gate and records worker-boundary evidence for material atlas jobs.

Task checklist:

- [x] Inspect `create-browser-runtime.ts` composition and every `OpenWorldMaterialTextureAtlasBuilder` provider.
- [x] Design the worker request/response DTO around owned or copy-safe pixel buffers, not borrowed prepared-asset cache views.
- [x] Implement the worker-backed atlas source/layout builder beside `object-visual-atlas-builder.ts` or move the module under a clearer `texture-residency/atlas-build/` owner if that improves navigation.
- [x] Keep `DirectOpenWorldObjectVisualAtlasBuilder` only for tests, worker handler internals, or an explicitly named non-production harness path.
- [x] Wire production open-world streaming composition to the worker-backed builder.
- [x] Add tests for transfer safety, worker diagnostics, and production composition selection.
- [x] Run `npm run check`, `npm run lint`, focused texture placement/packing tests, and all-domain browser harness.

Decisions and course corrections:

- Phase 35 found that the core worker-owned atlas boundary had already landed before the phase ledger caught up. `create-browser-runtime.ts` composes `WorkerPoolOpenWorldObjectVisualAtlasBuilder`, and production browser composition no longer instantiates `DirectOpenWorldObjectVisualAtlasBuilder` directly.
- Added production-composition proof by exporting and testing `createWorkerObjectVisualAtlasBuilder(...)` in `create-browser-runtime.test.ts`. This matches the existing worker factory tests for static resolver and dynamic visual workers.
- Added atlas worker diagnostics proof in `object-visual-atlas-worker-client.test.ts`: queued and active atlas layout jobs now expose `open-world-texture-layout` worker-pool diagnostics with task ids.
- Added worker handler proof that atlas jobs use request-scoped prepared asset access. The fake builder intentionally calls `assetReader.requestPreparedAsset(...)`; the test proves that becomes a worker service request instead of a browser-side direct asset read.
- Transfer/copy decision: atlas layout output is layout-only (`pages`, `rects`, `stageTimings`) and intentionally carries no page pixels, so the atlas worker response has no transferable pixel buffers to detach. Prepared texture bytes are consumed inside the worker through the request-scoped prepared asset service. Page pixel transfer remains owned and tested by the texture page-build worker.
- Source-tree decision: do not move `object-visual-atlas-builder.ts` yet. The module is already inside `systems/open-world-streaming/texture-residency/placement`, which is the current owner of placement reservation and layout. Phase 40 can still rename/move it if the readiness and reclamation phases reveal a cleaner `atlas-build` owner.
- Durable adapter classification: `WorkerPoolOpenWorldObjectVisualAtlasBuilder` is a worker transport adapter; `object-visual-atlas.worker.ts` is a worker entrypoint that may instantiate the direct builder internally. The direct builder is not a production browser composition path.
- Spicy bit: the phase mostly exposed plan lag, not missing architecture. The missing work was proof and ledger hygiene; rewriting the existing worker boundary would have been churn cosplay.
- Verification: `npm run check`, `npm run lint`, focused `npm run test:ts -- --run src/lib/browser/create-browser-runtime.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-atlas-worker-client.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/object-visual-texture-placement-plan.test.ts src/lib/systems/open-world-streaming/texture-residency/placement/material-texture-placement-plan.test.ts src/lib/textures/packing/worker-client.test.ts`.
- Harness verification: `npm run harness:browser -- --layer-distance 1 --timeout-ms 60000 --output /tmp/holtburger-phase35-all-domain-r1.json` settled with `errorMessage: null`, 45 requested/completed static tasks, 45 applied scene commits, 17 texture buckets, 146 resident texture pages, 2 page builds still in flight at sample time, 8 long tasks with max 167 ms, renderer frame `over50Ms: 0`, and runtime tick `over50Ms: 0`.
- Carried debt: the harness still reports 15 deferred material issues, 10 pipeline-bug material readiness issues, 2 skipped static-object partitions, and 2 pending texture dependencies at sample time. These are not atlas worker-boundary failures; they remain Phase 36/37 readiness and fidelity triage inputs.

### Phase 36: Direct Material Readiness Contract

Design north star:

- Diagnostics are not exempt from migration policy. Replacement diagnostics must explain replacement ownership, material readiness, texture dependency readiness, and renderer capability facts directly; broad legacy static coverage reports may feed evidence but must not become the surviving contract.

Deliverables:

- Split material readiness from broad static material coverage where the replacement controller currently consumes or exposes coverage facts.
- Introduce or consolidate a direct replacement material-readiness contract under `systems/open-world-streaming/diagnostics` or the owning static-layer domain.
- Make terrain, outdoor objects, env-cells, and runtime-authored visuals report the same readiness vocabulary for rendered, pending texture dependency, failed texture dependency, deferred renderer capability, unsupported source material, and skipped geometry.
- Decide whether `static-object-material-coverage.ts` remains a source-evidence transform, moves under the owning system, or is replaced by replacement-native reporting.
- Update BrowserDisplay/harness diagnostics consumers to read the direct readiness contract rather than broad static coverage summaries.

Acceptance criteria:

- Remaining flat-color, missing-texture, deferred, and unsupported material behavior is explainable through direct replacement readiness diagnostics.
- `StaticMaterialCoverageReport` is not the canonical replacement readiness contract.
- Renderer-local warning paths are not required to discover material readiness failures.
- Tests prove readiness classification from planner/baker facts to controller diagnostics without asserting legacy coverage parity.
- The plan records any deliberate deviation from the worksheet with evidence and reactivation criteria.

Task checklist:

- [x] Trace current readiness facts through `static-object-material-coverage.ts`, `open-world-streaming-controller.ts`, `object-visual-material-planner.ts`, `structured-interior-material-planner.ts`, terrain payload readiness, and renderer binding readiness.
- [x] Define the replacement readiness issue/event type and owner/domain identity fields.
- [x] Migrate controller diagnostics to emit direct readiness facts.
- [x] Migrate BrowserDisplay and browser harness summaries to direct readiness diagnostics.
- [x] Delete or demote tests that preserve broad coverage reports as the final truth source.
- [x] Add focused tests for readiness classification and texture dependency readiness.
- [x] Run `npm run check`, `npm run lint`, focused material/readiness tests, and terrain plus all-domain browser harness.

Decisions and course corrections:

- Phase 36 changed the direct readiness contract instead of preserving coverage-shaped issue identity. `OpenWorldStreamingMaterialReadinessIssue` now reports `renderer-capability-deferred`, `unsupported-source-material`, and `skipped-geometry` for the material paths that previously surfaced as `deferred-material`, `unsupported-material`, and `skipped-static-object-partition`.
- `StaticMaterialCoverageReport` remains source evidence, not canonical replacement readiness. Coverage identifiers now live under `sourceEvidence: { kind: "static-material-coverage", reportKey, reportKind }` when a readiness issue originates from broad static material coverage.
- Summary counters were renamed to direct vocabulary: `deferredRendererCapabilityIssueCount`, `unsupportedSourceMaterialIssueCount`, and `skippedGeometryIssueCount`.
- BrowserDisplay and the browser harness do not currently hard-code material readiness fields; they serialize the direct open-world diagnostics. No UI shim was needed in this phase.
- Focused controller tests now assert the direct readiness vocabulary and source-evidence shape. This prevents future code from treating `coverageKey`/`coverageKind` as the replacement issue identity.
- Spicy bit: this is still a projection from broad static coverage evidence. The code is more honest now, but Phase 37 still has to decide which of the reported renderer-capability deferrals are real fidelity backlog versus contract bugs.
- Verification: `npm run check`, `npm run lint`, and focused `npm run test:ts -- --run src/lib/systems/open-world-streaming/composition/open-world-streaming-controller.test.ts`.
- Harness verification: `npm run harness:browser -- --domains terrain --layer-distance 1 --timeout-ms 60000 --output /tmp/holtburger-phase36-terrain-r1.json` settled with `errorMessage: null`, 9 requested/completed static tasks, 9 applied scene commits, zero material readiness issues, 2 long tasks with max 61 ms, renderer frame `over50Ms: 0`, and runtime tick `over50Ms: 0`.
- Harness verification: `npm run harness:browser -- --layer-distance 1 --timeout-ms 60000 --output /tmp/holtburger-phase36-all-domain-r1.json` settled with `errorMessage: null`, 45 requested/completed static tasks, 45 applied scene commits, direct readiness summary counts of 15 `deferredRendererCapabilityIssueCount`, 10 `pipelineBugIssueCount`, 2 `skippedGeometryIssueCount`, 3 `pendingTextureDependencyCount`, zero unsupported source material issues, 6 long tasks with max 166 ms, renderer frame `over50Ms: 0`, and runtime tick `over50Ms: 0`.
- Carried debt: Phase 37 should start from the all-domain direct readiness counts, especially renderer-capability deferrals and pipeline-bug issues. The remaining issues are now expressed in direct replacement vocabulary instead of broad coverage identity.

### Phase 37: Deferred Fidelity And Material Backlog Triage

Deliverables:

- Convert remaining material/fidelity limitations into explicit backlog records with source evidence, renderer capability requirement, and reactivation criteria.
- Decide which structured-interior deferred-material issues remain in scope for this remodel versus later renderer fidelity work.
- Ensure deferred fidelity does not hide architecture drift, missing page commits, failed texture dependencies, or unsupported source facts.

Acceptance criteria:

- Every remaining `deferred-material`, `unsupported-material`, skipped static partition, and terrain material issue is classified as contract bug, source-data limitation, renderer capability backlog, or acceptable future scope.
- Structured-interior deferred-material issues from Phase 28/29 harness runs are either fixed or documented with exact file/symbol ownership and reactivation criteria.
- The remodel does not close with unexplained flat-color, missing-texture, or warning-only material behavior.
- Plan decisions name any deliberate deviation from the worksheet and why it is not blocking the hard cutover.

Task checklist:

- [ ] Re-run all-domain harness and capture `materialReadiness.recentIssues` plus texture page-build summaries.
- [ ] Start with the two structured-interior `deferred-material` records proven by `/tmp/holtburger-phase29-all-domain-r0.json`; do not broaden this phase until those are explained.
- [ ] Triage structured-interior deferred-material issues back through `structured-interior-material-planner.ts`, `env-cell-system-baker.ts`, and renderer pass support.
- [ ] Triage remaining unsupported material cases through `object-visual-material-planner.ts` and `object-visual-baker.ts`.
- [ ] Triage skipped partitions through static object partition diagnostics and renderer capability.
- [ ] Update this plan with each accepted deferral and deletion/fix target.
- [ ] Add focused tests for any fixed contract bug; do not add tests that simply assert a feature remains missing.

Decisions and course corrections:

- Pending.

### Phase 38: Runtime, Harness, And UI Shim Deletion

Design north star:

- Migrate direct contracts, shim legacy. At this point surviving browser UI and harness consumers should use replacement-native diagnostics and overview contracts directly. Legacy-shaped runtime snapshots should be deleted, not made healthier.

Deliverables:

- Delete `RuntimeOverviewSnapshot.static` and `createRuntimeStaticOverviewFromController(...)`.
- Remove `staticOverview` from `browser-pipeline-harness.mjs` scenario samples once `openWorldStreaming` and material readiness diagnostics provide direct evidence.
- Migrate `BrowserDisplay.svelte` status/resource/material panels from legacy-shaped overview fields to direct replacement diagnostics where the panel still needs to survive.
- Remove tests that assert old runtime overview/static diagnostic parity.
- Record every surviving adapter and prove it crosses a durable boundary rather than preserving a retired concept.

Acceptance criteria:

- `client-runtime-adapter.ts` contains durable app/runtime adapter logic only; it does not project replacement materialization into old static coordinator-shaped summaries.
- `RuntimeOverviewSnapshot` no longer has static coordinator-style materialization counters.
- `browser-pipeline-harness.mjs` and `BrowserPipelineHarness.svelte` consume direct `open-world-streaming` diagnostics or named durable harness composition data.
- No production code has `staticOverview`, `committedStaticCommitInstallCount`, `pendingStaticCommitInstallCount`, or old static commit lifecycle counters for the replacement pipeline.
- Every surviving adapter is named as host asset access, worker transport, renderer mutation, diagnostics export plumbing, or harness composition.

Task checklist:

- [ ] Search `apps/holtburger-3d/src` and `apps/holtburger-3d/scripts` for `staticOverview`, `RuntimeOverviewSnapshot.static`, old static commit counters, and legacy diagnostics snapshots.
- [ ] Migrate BrowserDisplay polling and panels to `runtime.createDiagnosticsReport()` direct replacement domains.
- [ ] Delete `createRuntimeStaticOverviewFromController(...)` and the `RuntimeStaticOverviewSnapshot` interface.
- [ ] Remove `staticOverview` from harness sample output and downstream assertions.
- [ ] Delete obsolete tests instead of updating them to preserve old overview shape.
- [ ] Run `npm run check`, `npm run lint`, `npm run lint:dead`, and browser harness.

Decisions and course corrections:

- Pending.

### Phase 39: Ownerless Page Reclamation And Eviction Truth

Design north star:

- Releases should follow the [worksheet owner-claim model](./holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md): cheap owner-claim mutations first, with page deletion, repack, and renderer removal treated as separate policy decisions that must not be hidden inside owner release or legacy lease/pin vocabulary.

Deliverables:

- Define the exact states for ownerless resident pages: retained cache, reclaimable, in-flight rebuild dependency, renderer-resident, renderer-removal pending, and removed.
- Implement or explicitly defer page reclamation policy in `texture-residency/claims`, page-build, and texture commit diagnostics.
- Ensure `releaseTextureOwner(ownerId)`-style behavior remains idempotent and cheap; cleanup must be explicit and separately diagnosable.
- Prove binding readiness stays honest when ownerless pages remain resident or are reclaimed.
- Remove any remaining lease/pin terms that leak into replacement contracts unless they refer to a durable renderer-installed-resource guard.

Acceptance criteria:

- Owner release does not trigger broad repack/page materialization work.
- Diagnostics can explain resident pages with zero current owners without implying a leak or a live owner.
- Reclamation/removal emits direct texture commits and readiness transitions when it actually mutates renderer state.
- Tests cover owner release, retained ownerless pages, explicit reclamation, stale page-build completion after release, and renderer readiness after reclamation.
- The implementation matches the worksheet release/currentness requirements or records a deliberate deviation.

Task checklist:

- [ ] Audit `OpenWorldTextureClaimRegistry` owner release, page reservation, and snapshot fields.
- [ ] Audit renderer texture binding readiness for ownerless or reclaimed pages.
- [ ] Define ownerless page lifecycle states and diagnostics fields.
- [ ] Implement explicit reclamation policy or document why it remains deferred with measurable risk.
- [ ] Delete replacement-facing lease/pin naming that is no longer structurally accurate.
- [ ] Add focused claim registry/page-build/texture commit readiness tests.
- [ ] Run `npm run check`, `npm run lint`, focused texture residency tests, and all-domain harness.

Decisions and course corrections:

- Pending.

### Phase 40: Source-Tree Ownership Cleanup

Design north star:

- The source tree should explain the system. New replacement code should be organized by owning workflow/domain, while reusable legacy transforms should be intentionally named as adapters or promoted only with evidence.

Deliverables:

- Move or rename modules whose current location hides the owning system after Phases 35-39.
- Keep durable adapters explicit for host assets, worker transport, renderer mutation, diagnostics export plumbing, and harness composition.
- Delete concept-bucket leftovers that exist only because the old source tree grouped by broad nouns such as `textures`, `static`, or `visual`.
- Update imports and tests after moves without leaving compatibility barrel exports that hide retired ownership.

Acceptance criteria:

- Open-world streaming materialization can be followed from composition through scheduling, owners, texture residency, static layers, scene commits, diagnostics, and tests without jumping through legacy concept folders except at named adapter boundaries.
- No replacement production module imports old orchestration internals.
- Reusable transforms outside `systems/open-world-streaming` have neutral names and are not lifecycle authorities.
- No new broad dumping-ground directory is created.
- `npm run lint:dead` has no replacement-related dead exports after moves/deletions.

Task checklist:

- [ ] Audit imports from `systems/open-world-streaming` into `static`, `visual`, `textures`, `runtime`, and `renderer` modules.
- [ ] Classify each cross-tree import as durable transform, durable adapter, legacy shim, or deletion target.
- [ ] Move worker-owned atlas builder modules if Phase 35 proves a clearer owner folder.
- [ ] Move or rename material readiness code if Phase 36 proves `static-object-material-coverage.ts` is no longer the owning concept.
- [ ] Delete compatibility barrels or aliases created only to avoid import churn.
- [ ] Run `npm run check`, `npm run lint`, `npm run lint:dead`, and focused tests touched by moves.

Decisions and course corrections:

- Pending.

### Phase 41: Texture Remodel Final Verification And Hard Cutover

Deliverables:

- Delete dead placement fields, ignored policy paths, obsolete tests, stale diagnostic categories, and temporary shims introduced by Phases 19-40.
- Re-run dead-code, type, lint, unit, and browser harness verification.
- Update this plan and the worksheet cross-reference with final evidence and any remaining intentionally deferred material fidelity.

Acceptance criteria:

- No replacement code references ignored legacy placement policy fields.
- No replacement tests preserve old bucket/lifetime assumptions.
- No production shim survives unless it crosses a durable host, worker, renderer, diagnostics export, or harness boundary without preserving retired concepts.
- Direct builders remain test-only or worker-internal; production browser composition uses worker-owned layout/page-build boundaries.
- No production replacement code references old static coordinator, texture manager mutation, old diagnostics snapshots, old materialization lifecycle concepts, or ignored placement policy fields.
- `npm run check`, `npm run lint`, `npm run lint:dead`, focused texture/material tests, and browser harness scenarios pass.
- The plan records every remaining deferral with a reason and evidence required to reactivate it.

Task checklist:

- [ ] Delete temporary migration shims and old compatibility fields.
- [ ] Delete or unexport direct builder APIs that are no longer needed outside tests/worker entrypoints.
- [ ] Delete any terrain-only workaround replaced by the shared readiness/material policy.
- [ ] Delete diagnostic compatibility projections that preserve old material/texture categories.
- [ ] Search for `StaticCoordinator`, `TextureManager`, `staticOverview`, old static commit counters, ignored placement fields, legacy diagnostic categories, and direct production atlas builders.
- [ ] Run `npm run check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run lint:dead`.
- [ ] Run focused texture residency/material coverage tests.
- [ ] Run terrain, generated scenery, env-cell, and all-domain browser harness scenarios.
- [ ] Update the worksheet/design cross-reference status.

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

### Risk: The Texture Remodel Recreates A Broad Texture Manager

Mitigation:

- Keep policy resolution, placement reservation, page build, renderer texture upload, readiness diagnostics, and owner release as separately owned contracts.
- Do not introduce a single service that serializes every texture concern just because the split creates more artifacts.
- At each new phase, name which state authority owns the edited code: policy, owner claims, placement/page reservation, worker page build, committed page map, renderer apply, or diagnostics.

### Risk: Worksheet Drift Returns During Remediation

Mitigation:

- Treat the worksheet as the design guardrail for Phases 19-41.
- Record deliberate deviations in the phase decisions before implementation proceeds.
- Prefer pausing a phase over landing a convenient contract that contradicts static-authored dynamic sharing, worker-owned page build, loose readiness, or direct replacement diagnostics.

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
- Replacement texture policy chooses bucket scope from explicit replacement-owned facts, not ignored legacy fields or ad hoc domain/purpose hardcoding.
- Static-authored dynamic content-stable textures can share compatible static-domain buckets, while owner-specific/generated/runtime-custom textures remain isolated by explicit policy.
- Bake-facing placement reservation is split from worker-owned page pixel build.
- Source preparation, layout search, packing, guttered blits, and page materialization are worker-owned for production browser material pages unless a measured exception is documented.
- Scene/visual commits and texture commits can arrive in either order without renderer hot-path exceptions for normal pending readiness.
- Missing-not-in-flight bindings, failed page builds, unsupported material cases, and intentionally deferred fidelity are reported through replacement-native diagnostics.
- Material coverage remains diagnostic-only and cannot be mistaken for successful rendering.
- No tests preserve ignored placement policy fields, old bucket lifetime assumptions, or legacy diagnostic parity.
- `npm run check`, `npm run lint`, and focused test suites pass from `apps/holtburger-3d`.

## Open Questions

- Which bake consumers truly need physical atlas `rect`, if any?
- What is the smallest renderer readiness model that avoids hot-path logging and still reports missing bindings loudly?
- Should `releaseTextureOwner(ownerId)` return assertion counts, or should diagnostics query release effects separately?
- What initial page lifecycle policy should classify ownerless resident pages: cached, reclaimable, or orphaned?
- Which current texture placement worker pieces can be reused, and which need a new page-build worker protocol?
- What immutable source facts are sufficient for page-build workers to prepare DAT/render-surface/palette pixels without borrowing mutable main-thread cache buffers?
- Which static-authored dynamic texture sources are truly generated, placement-specific, tint-baked, or runtime-customized enough to require owner-scoped buckets?
- Does runtime-authored dynamic texture churn require per-entity buckets after the policy contract is honest, or can some runtime-authored content share a broader runtime bucket safely?
- Which renderer resources, if any, can legitimately outlive owner claims after loose scene/texture ordering is fully implemented?
- How much frame-budgeting belongs in the artifact runner versus commit appliers?
- Which current consumers need a temporary legacy-side projection before they can migrate to replacement-native contracts?
