# Holtburger 3D Outdoor LoD Streaming Plan

## Context

Browser mode currently exposes one landblock coverage radius. That radius drives several different behaviors at once:

- outdoor terrain request/render coverage,
- outdoor static-scene fact requests,
- building source and gfx hydration,
- smaller scenery and generated scenery hydration,
- outdoor-linked interior/env-cell discovery,
- static renderable scene filtering.

That was acceptable while proving the first browser-mode world view, but it now hides the real user-facing model. We want outdoor scene streaming to behave like a moving interest policy:

```ts
interface OutdoorSceneInterest {
	focusLandblockId: number;
	terrainRadius: number;
	buildingRadius: number;
	detailRadius: number;
}
```

Browser mode will derive `focusLandblockId` from the selected anchor/destination. Future client mode can derive the same field from authoritative player residency as the player moves. The rest of the streaming/rendering code should not care which mode supplied the focus.

## Goals

- Replace the single outdoor coverage control with explicit terrain, building, and detail LoD distances.
- Keep the implementation frontend-local in `apps/holtburger-3d`; this is browser/client rendering policy, not shared game semantics.
- Make the code reusable for a future player-following client mode by modeling a focus landblock plus derived interest sets.
- Move browser scene asset streaming orchestration out of `App.svelte` before growing the LoD policy.
- Keep the asset graph scheduler unchanged. LoD affects which graph roots are selected, not how dependency graphs are prepared.
- Ensure landblocks entering an interest set hydrate on demand.
- Ensure landblocks leaving an interest set stop contributing render instances, while prepared assets may remain cached until a later eviction policy exists.
- Avoid scattered distance checks and ad hoc conditionals by deriving named interest sets once.

## Non-Goals

- Implement cache eviction or memory-pressure policy.
- Move rendering policy into Rust or shared crates.
- Redesign the asset worker, asset graph scheduler, or native asset lookup contract.
- Build final gameplay client camera/input behavior.
- Add occlusion, impostors, or progressive mesh LoD in this pass.

## Terminology

- **Focus landblock**: the normalized outdoor landblock around which scene interest is derived.
- **Terrain radius**: how many landblocks out from focus should request and render terrain.
- **Building radius**: how many landblocks out from focus should hydrate and render building landmarks.
- **Detail radius**: how many landblocks out from focus should hydrate and render smaller scenery, generated scenery, and outdoor-linked interiors.
- **Static scene facts**: landblock-scoped outdoor source data from `outdoor-static-scene/<landblock>`.
- **Renderable dependency assets**: heavier setup/gfx assets, such as `setup-model/*` and `gfx-obj/*`.
- **Interest sets**: named derived landblock sets consumed by request planning and scene selection.

## Target Model

Introduce a browser/client-agnostic frontend helper for outdoor scene interest:

```ts
interface OutdoorSceneInterest {
	focusLandblockId: number;
	terrainRadius: number;
	buildingRadius: number;
	detailRadius: number;
}

interface OutdoorSceneInterestLandblocks {
	terrainLandblockIds: readonly number[];
	buildingLandblockIds: readonly number[];
	detailLandblockIds: readonly number[];
}
```

Outdoor static-scene fact loading still needs the union of `buildingLandblockIds` and `detailLandblockIds`, because building and scenery source facts both live in the same outdoor static-scene payload. That union should be computed inside the request planner or by a small helper, not stored as canonical interest state. This keeps the core model from carrying duplicated derived data that could drift.

Arrays should be deterministic and sorted in the same priority order used for request planning. Callers that need membership checks can build local `ReadonlySet` views from those arrays instead of making unordered sets the canonical output.

Expected consumption:

- `terrainLandblockIds`: request and render terrain meshes.
- `buildingLandblockIds`: enqueue/render building source assets and building parts.
- `detailLandblockIds`: enqueue/render scenery, generated scenery, and outdoor-linked interiors/env cells.
- `union(buildingLandblockIds, detailLandblockIds)`: request `outdoor-static-scene/*` facts.

The detail set should normally be less than or equal to the building set, and the building set should normally be less than or equal to the terrain set. The code should clamp or normalize invalid slider combinations rather than silently producing surprising interest sets.

## Current Code Effects

### `App.svelte`

`App.svelte` currently owns scene streaming orchestration:

- in-flight asset id tracking,
- coverage key construction,
- calls to `createSceneCoverageRequests`,
- direct-vs-graph hydration dispatch,
- prepared asset/error application,
- request lifecycle debug logging.

That is too much policy for the root component. Adding three LoD distances here would make the component harder to reason about.

### Asset Request Planning

`createSceneCoverageRequests` currently accepts one `landblockRadius` and passes it through to terrain, static-scene, linked-interior, and static-renderable planning. This is the main function that needs semantic splitting.

The asset graph builder should not need changes. It prepares dependencies for selected roots. LoD changes which roots are selected.

### Render Scene Selection

`deriveTerrainSceneModel`, `deriveStaticRenderableSceneModel`, `BrowserWorldDisplay`, and older debug model text rebuild or consume the same single coverage ring. These should consume the explicit interest sets instead of rebuilding equivalent rings independently.

## Dry-Run Findings Against Current Code

The first-pass plan is directionally correct, but a code-level dry run exposed several refinements:

- `AssetGraphScheduler` already has the better response-first traversal shape from the asset hydration work. It should stay untouched; this plan should not reopen graph scheduling.
- `asset-channel.ts` currently mixes two different responsibilities:
  - `AssetChannelController` for lookup, worker preparation, in-flight de-dupe, and graph scheduling gateway behavior.
  - scene request planning helpers such as `createSceneCoverageRequests`, `createTerrainCoverageRequests`, and `createStaticRenderableAssetRequests`.
- Extracting a streaming controller before extracting request planning would move too much mixed policy at once. A cleaner sequence is to first pull scene request planning into its own pure module, then move orchestration out of `App.svelte`.
- Outdoor LoD applies only to outdoor interest. Indoor browser destinations and runtime indoor residency should keep using `StructuredInteriorCoverageOptions` and visible-cell policies. The public input shape should probably be a union such as `SceneInterest = OutdoorSceneInterest | IndoorSceneInterest`, not outdoor-only fields forced through every branch.
- `deriveStaticRenderableSceneModel` currently collects scenery, buildings, and generated scenery from one `activeLandblockSet`. To support separate building/detail radii cleanly, source-instance collection needs a selection policy by instance kind rather than an extra conditional around the existing collector.
- Outdoor-linked interior discovery currently follows the same active landblock set as statics. Under the new model it should follow the detail set, not the building set, even though building portal facts come from static-scene payloads.
- `createOutdoorStaticSceneCoverageRequests` is private today. Tests call `createSceneCoverageRequests`, so request-planner extraction should add targeted tests for the static-scene union behavior instead of making more internals public than needed.
- The current bootstrap policy requests only the focus landblock for terrain and static scene facts. Keep that as the default first-paint behavior unless profiling or UX says landmarks need a wider bootstrap pass.
- Sets are useful for membership checks, but stable arrays are better for request ordering, coverage keys, and tests. The interest helper should expose deterministic arrays or provide stable serialization instead of making every caller sort sets independently.
- `deriveWorldDisplayModel` still carries older phase/debug text and single-radius concepts. It should not be a blocker for the LoD model, but it should be updated or retired where browser panel rows no longer need that older explanatory model.

## Revised Component Boundaries

Use three layers instead of growing any one file:

- **Outdoor interest helpers**: pure focus/radius normalization and deterministic landblock set derivation.
- **Scene request planner**: pure request selection from runtime state, destination, prepared assets, pending ids, and scene interest. It does not own workers, Tauri, or Svelte state.
- **Scene asset streaming controller**: impure orchestration around request keys, in-flight ids, direct-vs-graph preparation, error handling, and applying prepared assets.

`AssetChannelController` should remain the low-level asset channel and graph gateway. It should not grow new LoD policy.

## Phase 1: Extract Pure Scene Request Planning

### Work

- Move scene request planning helpers out of `asset-channel.ts` into a frontend-local module such as `scene-asset-request-planner.ts`.
- Keep `AssetChannelController`, `AssetPreparationGateway`, and `prepareAssetGraph` in `asset-channel.ts`.
- Preserve current single-radius behavior during this extraction.
- Keep `createSceneCoverageRequests` as the public planner entry point during the extraction if that minimizes churn, but move it out of the channel controller module.
- Add or preserve tests around:
  - terrain request ordering,
  - static-scene fact request ordering,
  - linked-interior request discovery,
  - static renderable root selection,
  - direct scene assets versus graph-backed renderable roots.

### Exit Criteria

- `asset-channel.ts` no longer owns scene coverage request planning.
- Request planning is testable without constructing an `AssetChannelController`.
- Existing browser mode behavior is unchanged.

## Phase 2: Extract Scene Asset Streaming From `App.svelte`

### Work

- Add a frontend-local streaming controller, for example:

```ts
class SceneAssetStreamingController {
	syncSceneInterest(input: SceneAssetStreamingInput): Promise<void>;
	dispose(): void;
}
```

- Move these responsibilities out of `App.svelte`:
  - in-flight asset id tracking,
  - request key/change detection,
  - calls to request planners,
  - direct-vs-graph hydration dispatch,
  - prepared asset/error application.
- Keep `App.svelte` responsible for top-level lifecycle wiring:
  - read debug config,
  - listen for runtime notifications,
  - load initial snapshot,
  - pass state changes to the streamer.
- Keep current behavior during the extraction. The first pass should be a relocation plus tests, not a behavior change.
- Use one scheduling ingress. Runtime notifications should update `frontendState`; the streamer should react through the same state-change path rather than also being called directly from the notification listener.
- Use a coalescing sync loop:
  - if a sync is already running, mark the latest input dirty instead of starting a parallel full pass,
  - keep `inFlightAssetIds` shared across cycles,
  - after the current pass settles, run once more if the latest stable key changed while work was in flight.
- Keep bootstrap and streaming priorities explicit, but schedule them from one controller pass so duplicate request planning is visible and testable.

### Exit Criteria

- `App.svelte` no longer directly calls `createSceneCoverageRequests`.
- The new controller has focused tests for de-duping, direct-vs-graph dispatch, and error application.
- Existing browser mode behavior is unchanged.

## Phase 3: Introduce Outdoor Scene Interest Helpers

### Work

- Add a pure helper module for outdoor interest derivation.
- Derive all landblock sets from one `OutdoorSceneInterest` input.
- Return deterministic arrays for request order and coverage keys, and build local `ReadonlySet` views or helper predicates for membership checks.
- Normalize invalid radii with explicit rules:
  - radii are integer and non-negative,
  - `terrainRadius >= buildingRadius >= detailRadius`,
  - UI updates should clamp dependent values when needed.
- Keep indoor interest separate. Outdoor LoD fields should not be forced into indoor visible-cell coverage.

### Exit Criteria

- Tests prove set derivation for focus-only, neighbor rings, clamping, and map-edge landblocks.
- Existing call sites can consume named sets without knowing the distance math.

## Phase 4: Split Request Planning By Interest Set

### Work

- Replace `OutdoorCoverageOptions.landblockRadius` with terrain/building/detail radii or prederived interest sets.
- Update terrain request planning to use `terrainLandblockIds`.
- Update outdoor static-scene fact requests to use the planner-local union of `buildingLandblockIds` and `detailLandblockIds`.
- Update static renderable asset requests:
  - buildings use `buildingLandblockIds`,
  - scenery and generated scenery use `detailLandblockIds`.
- Update outdoor-linked interior coverage:
  - linked env cells come only from static-scene facts inside `detailLandblockIds`.
- Keep scene coverage assets classified as `direct`; keep setup/gfx roots classified as `graph`.
- Keep bootstrap focus-only by default for terrain and static-scene facts, then let streaming fill wider terrain/building/detail sets.

### Exit Criteria

- If `terrainRadius > buildingRadius`, outer landblocks request/render terrain only.
- If `buildingRadius > detailRadius`, outer landmark landblocks request static-scene facts and building renderable dependencies, but not smaller scenery/generated-detail dependencies.
- The asset graph scheduler remains unchanged.

## Phase 5: Split Render Scene Selection

### Work

- Update terrain scene derivation to consume `terrainLandblockIds`.
- Update static renderable scene derivation to consume building/detail sets.
- Replace the single active outdoor static set with a source-instance selection policy by kind:
  - `building` instances use `buildingLandblockIds`,
  - `scenery` and `generated-scenery` instances use `detailLandblockIds`,
  - `indoor-static` from outdoor-linked interiors uses env cells discovered from `detailLandblockIds`.
- Ensure prepared assets outside the current set remain cached but do not produce active render parts.
- Update structured interior scene derivation so outdoor-linked interiors follow the detail set.
- Remove old single-radius ring rebuilding where possible.

### Exit Criteria

- Moving the focus landblock naturally causes newly in-range terrain/buildings/details to hydrate on demand.
- Landblocks falling outside building/detail ranges stop rendering those objects without requiring cache deletion.
- Scene/debug rows report terrain/building/detail counts separately enough to diagnose streaming.

## Phase 6: Browser Panel UX

### Work

- Rename the current `Coverage` tab to `LoD`.
- Surface three sliders:
  - `Terrain distance`,
  - `Building distance`,
  - `Detail distance`.
- Keep env-cell controls in the same tab or a nearby subgroup, but do not present them as navigation controls.
- Show concrete values, for example:
  - `3 landblocks out`,
  - `49 terrain tiles`,
  - `25 building tiles`,
  - `9 detail tiles`.
- Clamp dependent sliders in the UI so the user cannot create impossible ordering.

### Exit Criteria

- The panel no longer exposes "landblock coverage" as the primary concept.
- All three LoD distances are visible and adjustable.
- The labels describe user-observable behavior rather than implementation internals.

## Phase 7: Cleanup And Convergence

### Work

- Revisit every touched module after the behavior lands:
  - `App.svelte`,
  - scene request planner,
  - scene asset streaming controller,
  - outdoor interest helpers,
  - browser mode state/store helpers,
  - browser panel,
  - terrain scene derivation,
  - static renderable scene derivation,
  - structured interior scene derivation,
  - older debug/world-display model helpers.
- Remove dead code, unused exports, stale tests, and compatibility wrappers introduced during the transition.
- Remove legacy single-radius naming where it no longer reflects behavior:
  - `coverage`,
  - `landblockCoverageRadius`,
  - `landblockRadius`,
  - older "ring" text where it now means only one of terrain/building/detail.
- Collapse hollow abstractions that only forward arguments or hide a single call without adding a meaningful boundary.
- Keep abstractions that have earned their keep through one of:
  - pure tested policy,
  - impure lifecycle/state ownership,
  - reusable browser/client mode boundary,
  - materially reduced duplication.
- Audit debug/status text for stale phase references and misleading descriptions.
- Ensure request-planning tests describe terrain/building/detail behavior rather than old coverage behavior.
- Confirm there are no browser-only LoD concepts leaking into shared renderer APIs or lower-level crates.
- Re-run TypeScript checks, formatting checks, tests, and build.

### Exit Criteria

- No old single-radius API remains unless it is still genuinely single-purpose.
- No transition shims or reexports remain.
- Debug text and panel labels match the final LoD model.
- The final diff has clear ownership boundaries instead of forwarding layers.

## Testing Strategy

- Unit-test pure interest derivation independently.
- Unit-test request planning for terrain-only outer rings, building-only middle rings, and full-detail inner rings.
- Unit-test static renderable filtering by instance kind and owning landblock set.
- Keep asset graph scheduler tests focused on graph behavior; do not add LoD concerns there.
- Run the existing TypeScript checks and app build after implementation:
  - `npm run check`
  - `npm run lint:ts`
  - `npm run test:ts`
  - `npm run build`

## Risks And Design Notes

- `outdoor-static-scene/*` is still needed for building rings because buildings and scenery share one source payload. The important optimization is not hydrating/rendering every smaller source asset outside `detailRadius`.
- Prepared asset cache retention means "despawn" is a render-selection effect, not immediate memory reclamation.
- The old `coverage` naming will likely linger in some debug/provenance text until the model split lands. Renaming should happen where it clarifies ownership, not as a blind global sweep.
- If future profiling shows static-scene fact payloads are too heavy at large building radius, a later source-fact split may be warranted. That is separate from this LoD policy.
- Coverage keys should be built from stable serialized interest arrays, not from unsorted `Set` iteration.
- Avoid adding browser-only LoD fields directly to shared renderer props. Pass derived scene models or mode-owned interest inputs through browser/client wrappers.

## Open Questions

- Should the default distances be `terrain=2`, `building=1`, `detail=1`, or should terrain start larger immediately?
- Should bootstrap priority always request only the focus landblock for every category, or should landmarks get a wider bootstrap pass than details?
- Should generated scenery follow `detailRadius`, or should it eventually get a separate vegetation/decor radius?
