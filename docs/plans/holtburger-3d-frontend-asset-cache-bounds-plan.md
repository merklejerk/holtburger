# Holtburger 3D Frontend Asset Cache Bounds Plan

Status: complete.

## Purpose

Bound the `apps/holtburger-3d` prepared-asset cache so browser/world exploration does not grow
unbounded JavaScript heap over long sessions.

The current frontend already reuses prepared assets by `assetId`, including `gfx-obj` dependencies,
but it does not evict old prepared payloads from app state. This plan introduces an explicit
frontend asset cache policy that retains active scene coverage and dependency closures while
allowing old warm assets to be pruned.

## Current Code Shape

- `frontendState.asset.preparedByAssetId` is the long-lived prepared asset cache.
- `SceneAssetStreamingController` decides which scene-coverage assets to request from current scene
  interest.
- `AssetChannelController` owns Tauri lookup, worker preparation, and in-flight dedupe. It clears
  load entries after requests complete and is not a long-lived cache owner.
- `AssetGraphScheduler` accepts an initial `preparedByAssetId` snapshot and skips already-prepared
  root/dependency assets.
- `BrowserWorldDisplay` derives scene models from prepared assets.
- `world-display-renderer` owns Three.js/GPU resources and disposes inactive meshes/geometries; it
  should not decide which prepared assets remain in RAM.

## Codebase Dry-Run Findings

- `createSceneCoverageRequests` returns only unprepared request records. It is not enough for cache
  policy because pruning needs the complete active asset set, including assets that are already
  prepared or in flight. Add a sibling helper that derives active scene-interest asset ids without
  filtering out prepared assets.
- Static renderable source assets are not the same thing as scene-coverage roots. Outdoor static
  scene roots expose many possible instances, while current LoD settings decide which building,
  detail, generated, and linked-indoor source assets are actually rendered. For the first pass,
  conservative retention is acceptable: if an outdoor static scene root is active, retain all
  prepared dependencies reachable from that root and let TTL age them out after the root leaves
  active/warm coverage.
- `getPreparedAssetDependencies` is broad enough for first-pass dependency retention. It may keep
  static source assets that current LoD does not render, but it is dependency-correct and avoids
  duplicating static renderable LoD selection inside the cache policy. LoD-aware static dependency
  pruning should only be added later if memory profiling shows broad static dependencies dominate.
- Structured-interior coverage already treats env-cell and environment payloads as explicit
  coverage assets. The cache policy should mark both the active env-cell asset ids and active
  environment asset ids, including runtime `environmentId` when indoors.
- In-flight assets live in `SceneAssetStreamingController.inFlightAssetIds`, not frontend state.
  Pruning must receive that set from the controller and retain those ids even if they are not yet in
  `preparedByAssetId`.
- `preparedByPriority` stores the latest prepared asset by priority, not a semantic cache root.
  Pruning should treat it as presentation/status state and clear entries that point at evicted
  payloads rather than using it for retention.
- The existing activity history is bounded and records only metadata, so it should not participate
  in retention and should not block pruning.
- `world-display-renderer` already disposes inactive GPU resources. RAM pruning should not try to
  coordinate with renderer disposal; scene-model changes will naturally cause GPU resources to be
  rebuilt when retained or re-requested prepared assets become active again.

## Problem

Prepared assets accumulate indefinitely:

- terrain landblocks
- outdoor static scene roots
- indoor env-cell metadata
- environment/cell-structure payloads
- setup-models
- `gfx-obj` render payloads

This is not a missing disposal bug in the renderer. It is an unbounded RAM cache in frontend app
state. Revisited content benefits from the cache, but long roaming sessions can retain every
previously prepared payload.

## Ownership Decision

`SceneAssetStreamingController` should own cache policy decisions, while `frontendState` stores and
mutates cache state.

Responsibilities:

- `SceneAssetStreamingController`
  - owns scene interest and current coverage context
  - computes active root assets and dependency retention
  - invokes pruning after scene streaming/apply steps
- `asset-cache-policy.ts`
  - pure policy helpers for mark/sweep, time TTL retention, and diagnostics
- `asset-state.ts`
  - immutable state updates for pruning prepared assets and storing cache diagnostics/metadata
- `AssetChannelController`
  - remains lookup/preparation/in-flight-dedupe only
- `world-display-renderer`
  - remains GPU resource owner only

## Goals

- Keep active scene coverage complete.
- Keep prepared dependency closure complete for active coverage.
- Reuse already prepared `gfx-obj`/setup-model/environment payloads where useful.
- Bound memory growth with predictable policy.
- Avoid pruning assets that are currently in flight or currently required by scene interest.
- Surface useful cache diagnostics in browser debug UI.
- Keep policy app-local to `apps/holtburger-3d`; do not move browser-mode cache policy into shared
  Rust crates.

## Non-Goals

- Do not add host-side asset cache policy.
- Do not make `AssetChannelController` a long-lived cache manager.
- Do not make `world-display-renderer` own prepared asset lifetimes.
- Do not implement perfect byte accounting in the first pass.
- Do not implement count or byte budgets in the first pass.
- Do not preserve every prepared asset for compatibility with tests.

## Proposed Model

### Retention Classes

- **Active coverage roots:** terrain/static/interior root assets requested by current scene
  interest.
- **Dependency-retained:** prepared dependencies reachable from active roots, such as `gfx-obj`
  payloads referenced by active static/setup-model roots or environment payloads referenced by
  active indoor cells.
- **Warm cache:** recently retained assets outside active coverage, retained for a small time TTL.
- **Evictable:** old assets outside active coverage and dependency closure.

### Mark And Sweep

Each prune pass should:

1. Derive current active coverage asset ids from scene interest, including already prepared assets.
2. Walk prepared dependencies from active coverage assets with existing
   `getPreparedAssetDependencies`.
3. Recursively retain dependencies from active static source assets, especially setup-model part
   `gfx-obj` dependencies.
4. Mark active-coverage, dependency-retained, and in-flight assets.
5. Add warm-cache survivors whose last retained timestamp is within the configured warm TTL.
6. Remove everything else from `preparedByAssetId` and cache metadata.
7. Return diagnostics describing prepared, retained, and evicted counts by asset kind.

### Initial Warm Retention

Do not add count or byte budgets in the first pass. Use a simple time-based TTL:

- pass an injected `nowMs` into the pure policy helpers so tests stay deterministic
- stamp retained active/dependency/in-flight assets with `lastRetainedAtMs = nowMs`
- initialize newly prepared assets with `lastPreparedAtMs = nowMs` and `lastRetainedAtMs = nowMs`
- retain non-active warm assets while `nowMs - lastRetainedAtMs <= warmRetainMs`
- do not refresh `lastRetainedAtMs` for warm-only survivors; otherwise warm assets never age out
- evict non-active assets older than the warm TTL

This keeps recently visited assets available for quick backtracking without adding per-kind budget
accounting. Count or byte budgets can be added later if profiling shows TTL-only retention is not
enough.

## Phases

### Phase 1: Cache Inventory And Diagnostics

- Add asset-kind counting utilities for `preparedByAssetId`.
- Surface cache counts in existing browser asset diagnostics.
- Add tests for the new bounded behavior, not tests that preserve the old unbounded-cache behavior.

Progress:

- Added `asset-cache-diagnostics.ts` with prepared-asset kind counting and debug formatting helpers.
- Wired prepared cache kind counts into the existing browser asset debug summary.
- Added targeted diagnostics tests. Bounded-retention behavior tests remain scheduled for the
  policy/prune phases where the behavior exists.

Validation:

- `npm run test:ts -- asset-cache-diagnostics`

### Phase 2: Explicit Cache Metadata

- Add cache metadata to asset state, likely parallel to `preparedByAssetId`:
  - `lastPreparedAtMs`
  - `lastRetainedAtMs`
  - optional retain/evict diagnostics
- Update `applyPreparedAssets` to initialize/update metadata.
- Keep `preparedByAssetId` shape stable for existing scene model consumers.

Progress:

- Added `cacheMetadataByAssetId` alongside `preparedByAssetId`.
- Added `PreparedAssetCacheMetadata` with `lastPreparedAtMs` and `lastRetainedAtMs`.
- Updated `applyPreparedAssets` to stamp prepared assets with an injectable `nowMs`.
- Kept prepared asset records unchanged so scene model consumers still read `preparedByAssetId`
  exactly as before.

Validation:

- `npm run test:ts -- asset-state`

### Phase 3: Active Root And Dependency Closure Policy

- Add `asset-cache-policy.ts` with pure mark/sweep helpers.
- Add or extract helpers from scene request planning to derive active coverage asset ids without
  filtering out prepared assets.
- Reuse `getPreparedAssetDependencies` for first-pass dependency closure, including broad outdoor
  static scene dependencies.
- Do not extract LoD-aware static renderable source derivation in the first pass; add it only if
  profiling proves broad static dependency retention is too expensive.
- Protect in-flight asset ids supplied by `SceneAssetStreamingController`.
- Retain warm assets by time TTL; do not add count or byte budgets.
- Unit test outdoor, indoor, shared dependency, setup-model, and mixed coverage cases.

Progress:

- Added `deriveSceneCoverageAssetIds` to derive active scene coverage roots without filtering out
  assets that are already prepared.
- Added `asset-cache-policy.ts` with a pure `planPreparedAssetCachePrune` helper.
- The policy retains active coverage roots, recursively prepared dependencies, in-flight ids, and
  warm assets inside `warmRetainMs`.
- Warm-only survivors keep their previous `lastRetainedAtMs`; active/dependency/in-flight prepared
  assets are stamped with the current `nowMs`.
- Kept LoD-aware static pruning out of v1. Outdoor static scene roots conservatively retain prepared
  dependencies through `getPreparedAssetDependencies`.

Course corrections:

- Coverage-id tests use real prepared records where helper logic inspects payloads, instead of fake
  partial records.

Validation:

- `npm run test:ts -- asset-cache-policy scene-asset-request-planner-cache`

### Phase 4: Prune State Mutation

- Add `prunePreparedAssets` or `applyAssetCachePrune` to `asset-state.ts` and `frontendState`.
- Remove evicted ids from:
  - `preparedByAssetId`
  - cache metadata
  - `preparedByPriority` when it references an evicted asset
- Decide whether `preparedAsset` and `lastResponse` should keep full payload references. If they
  should not, replace them with metadata-only status before pruning lands; if they remain, clear
  them when they reference an evicted asset.
- Keep history bounded as it is today; do not make history retain evicted payloads.
- Do not use `preparedByPriority`, `preparedAsset`, or `lastResponse` as retention roots.

Progress:

- Added `applyAssetCachePrune` to `asset-state.ts`.
- Added `frontendState.applyAssetCachePrune` as the store boundary method.
- Pruning removes evicted ids from `preparedByAssetId`, cache metadata, and `preparedByPriority`.
- `preparedAsset` and `lastResponse` remain latest-status fields, but are cleared when they point
  at evicted assets.
- History remains metadata-only and does not participate in retention.

Decision:

- Do not replace `preparedAsset`/`lastResponse` with metadata-only fields in this phase. Clearing
  dangling references gives the needed cache safety without broad UI churn.

Validation:

- `npm run test:ts -- asset-state frontend-state`

### Phase 5: Streaming Integration

- Have `SceneAssetStreamingController` invoke prune after applying prepared assets and after scene
  interest stabilizes.
- Use the latest scene interest and current prepared cache snapshot.
- Ensure pruning does not fight in-flight graph preparation.
- Use an injected/current `nowMs` at each prune point; repeated prepared-asset applications for the
  same interest refresh only assets that are active, dependency-retained, or in flight.
- Add tests proving recent backtracking reuses warm-retained assets and older revisits re-request
  only the missing root/dependencies.

Progress:

- Integrated `planPreparedAssetCachePrune` into `SceneAssetStreamingController`.
- Added controller dependencies for cache metadata, prune application, injected clock, and TTL.
- Added default `DEFAULT_PREPARED_ASSET_WARM_RETAIN_MS = 120_000`.
- The controller prunes after priority sync work and also when a priority has no new requests.
- `App.svelte` now wires cache metadata and prune application through the frontend store.
- Added streaming-controller tests for warm backtracking reuse and expired revisit re-requesting.

Course corrections:

- Changed the controller asset-channel dependency from the concrete `AssetChannelController` class
  to a structural `SceneAssetChannel` interface so tests can use a fake without spinning up workers.
- Streaming tests must provide `structuredInteriorMaxEnvCells >= 1`, matching the existing coverage
  invariant.

Validation:

- `npm run test:ts -- scene-asset-streaming-controller`

### Phase 6: Tuning And UX

- Choose a conservative default `warmRetainMs`.
- Add basic debug diagnostics for prepared, retained, and evicted counts by asset kind.
- Profile RAM behavior during long browser-mode roaming.
- Adjust time TTL to avoid obvious thrashing.
- Add count or byte budgets only if TTL-only retention is insufficient.

Progress:

- Set the first-pass default TTL in code as `DEFAULT_PREPARED_ASSET_WARM_RETAIN_MS = 120_000`.
- Added cache diagnostics to asset state.
- `applyAssetCachePrune` records the latest prepared/retained/evicted counts by asset kind.
- Browser asset pipeline debug text now includes retained and evicted cache counts from the latest
  prune.

Decision:

- Do not add count or byte budgets in this implementation. Time TTL remains the only v1 bound.
- Manual RAM profiling remains a follow-up after this implementation is available in the running
  frontend.

Validation:

- `npm run test:ts -- asset-cache-diagnostics asset-state scene-asset-streaming-controller`

### Phase 7: Cleanup And Simplification

- Remove temporary compatibility paths introduced during cache migration.
- Remove legacy fields, parameters, or helper APIs that exist only to bridge old unbounded-cache
  behavior.
- Remove hollow cache abstractions that do not own real policy, state, or behavior.
- Collapse duplicated active-root/dependency traversal logic into the cache policy module or the
  existing scene request planner, depending on which owns the real concept.
- Remove tests that only assert deprecated cache behavior, such as preserving every prepared asset
  indefinitely or retaining stale `preparedByPriority`/`preparedAsset` references after pruning.
- Revisit debug diagnostics and remove noisy transitional rows once retained/evicted counts are
  covered by stable cache summaries.
- Update this plan with final decisions, course corrections, validation, and any remaining targeted
  follow-up.

Progress:

- Collapsed duplicated structured-interior coverage asset id derivation so request planning and
  cache root derivation share the same helper.
- Kept request ordering stable for existing request consumers while sorting only cache-root outputs
  that need deterministic set order.
- No compatibility shims or deprecated cache behavior tests were left behind.
- No special-case `gfx-obj` TTL, count budget, byte budget, or manual prune control was added.

Course corrections:

- A broad Prettier check over all `src` surfaced unrelated existing formatting drift in
  `src/app/browser-mode.ts`. Left it untouched and ran targeted Prettier validation for files
  changed by this implementation.

Validation:

- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- Targeted Prettier check for all files touched by this implementation and this plan.

## Risks And Footguns

- Evicting a dependency still referenced by an active root can cause scene hydration churn or missing
  geometry.
- Evicting a root while its graph request is still in flight can create duplicate request work.
- TTL-only retention is not a hard memory ceiling under pathological teleporting or very broad
  scene-interest churn. It is the first pragmatic bound, not a final memory budget.
- `preparedByPriority`, `preparedAsset`, and `lastResponse` can become stale references if pruning
  only deletes from `preparedByAssetId`.
- The renderer may rebuild GPU geometry when a retained RAM asset becomes active again. That is
  acceptable; RAM cache and VRAM cache have different lifetimes.

## Validation

- Unit tests for pure cache policy helpers.
- Unit tests for asset-state pruning mutation.
- Streaming-controller tests for in-flight protection and revisit behavior.
- Existing frontend checks:
  - `npm run test:ts`
  - `npm run check`
  - `npm run lint:ts`
  - targeted Prettier checks for touched files

## Initial Tuning Decision

- Start with `warmRetainMs = 120_000`.
- Tune after RAM profiling during long roaming.

## Remaining Follow-Up

- Profile browser-mode RAM during long roaming now that TTL pruning is active.
- Revisit count or byte budgets only if profiling shows time TTL is insufficient.
- Existing unrelated Prettier drift remains in `apps/holtburger-3d/src/app/browser-mode.ts`.
