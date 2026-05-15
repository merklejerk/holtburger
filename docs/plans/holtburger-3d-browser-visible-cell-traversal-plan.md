# Holtburger 3D Browser Visible-Cell Traversal Plan

## Goal

Make browser mode render a broader structured-interior scene by recursively traversing DAT-authored `VisibleCells` from browser-selected or outdoor-linked env-cell seeds.

Client/runtime mode should remain unchanged: it should continue to render only the authoritative focus env cell plus the one visible-cell set supplied by runtime residency.

## Ground Truth

- ACE `EnvCell` stores `CellPortals` and `VisibleCells` as separate fields in [ACE/Source/ACE.DatLoader/FileTypes/EnvCell.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.DatLoader/FileTypes/EnvCell.cs).
- ACE object maintenance uses current env cell plus `VisibleCells` for dungeon/env-cell object visibility in [ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs).
- ACE comments warn that `VisibleCells` relationships can be asymmetric in [ACE/Source/ACE.Server/Command/Handlers/PlayerCommands.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Command/Handlers/PlayerCommands.cs).

## Current Behavior

- Live indoor residency renders `focusEnvCellId + visibleCellIds` from `RuntimeResidencyDto`.
- Browser-selected indoor env cells render the selected env cell plus one direct `visibleCellIds` layer after the focus env-cell asset is prepared.
- Outdoor-linked interiors render only env cells linked by outdoor building portals. They do not recursively expand through those cells' `visibleCellIds`.

## Desired Browser Behavior

Browser mode should compute a structured-interior coverage set:

- Seed cells:
  - manual/browser-selected indoor env cell
  - outdoor building portal-linked env cells discovered from prepared outdoor static scene assets
- Expansion:
  - when an `indoor-env-cell/*` asset is prepared, add its `visibleCellIds`
  - repeat incrementally as newly requested env-cell metadata arrives
  - do not use portal adjacency for this phase
- Termination:
  - stop when prepared env cells expose no new visible-cell ids
  - keep a reasonable max-cell guard to avoid pathological or very large browser loads

This should be named as browser coverage, not runtime visibility parity. The traversal intentionally serves inspection, not live-client residency.

## Design Shape

Keep the asset discovery and hydration path isomorphic between runtime/client mode and browser mode. The only mode-specific decision should be how the active env-cell membership set is chosen.

Add a small frontend-owned helper, likely near [apps/holtburger-3d/src/lib/assets/asset-channel.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/assets/asset-channel.ts), that derives structured-interior coverage from a membership policy:

```ts
type StructuredInteriorMembershipPolicy =
	| { kind: "direct"; envCellIds: number[] }
	| { kind: "visible-cell-closure"; seedEnvCellIds: number[] };
```

The helper should accept `preparedByAssetId` and optional limits such as `maxEnvCells`, then return a stable sorted result:

```ts
interface StructuredInteriorCoverage {
	envCellIds: number[];
	truncated: boolean;
}
```

Policy selection:

- Runtime/client indoor residency uses `direct` with `focusEnvCellId + RuntimeResidencyDto.visibleCellIds`.
- Browser-selected indoor env cells use `visible-cell-closure` seeded by the selected env cell.
- Outdoor-linked interiors use `visible-cell-closure` seeded by the env cells linked from outdoor building portals.

Everything after coverage derivation should use the same path:

```text
structured-interior coverage
  -> request missing indoor-env-cell/*
  -> request environment/* for prepared env cells
  -> collect indoor static object source assets
  -> derive structured-interior scene geometry
```

Keep this helper pure and testable. Avoid hiding policy inside Three.js mesh creation, worker preparation, or the generic asset graph scheduler.

## Integration Points

### Asset Requests

Refactor structured-interior scene coverage requests so they accept a `StructuredInteriorMembershipPolicy`.

The request builder should first derive a `StructuredInteriorCoverage`, then use that coverage for all indoor env-cell and environment requests. Runtime indoor residency should pass a `direct` policy. Browser flows should pass a `visible-cell-closure` policy.

The app-level asset sync loop in [apps/holtburger-3d/src/App.svelte](/home/cluracan/code/holtburger/apps/holtburger-3d/src/App.svelte) can remain unchanged: it should still ask `createSceneCoverageRequests` for the next requests, then hydrate each returned asset through the existing direct-vs-graph path.

### Scene Model

Pass the same derived `StructuredInteriorCoverage.envCellIds` into [apps/holtburger-3d/src/lib/world-display/structured-interior-scene.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/world-display/structured-interior-scene.ts) so geometry membership matches asset discovery.

Avoid keeping a separate one-layer browser expansion inside `deriveStructuredInteriorSceneModel`; it should consume already-derived coverage where possible.

### Static Renderables

Use the same `StructuredInteriorCoverage.envCellIds` for indoor static-object source collection. Geometry and static objects must not be derived from different env-cell sets.

### UI Telemetry

Update browser display text to distinguish:

- direct outdoor-linked env-cell seeds
- total visible-cell-expanded coverage
- truncation, if the max-cell guard is hit

## Dry Run Notes

### Current Duplication To Remove

The current code derives active indoor env cells in multiple places:

- asset request planning in [apps/holtburger-3d/src/lib/assets/asset-channel.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/assets/asset-channel.ts)
- structured-interior geometry membership in [apps/holtburger-3d/src/lib/world-display/structured-interior-scene.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/world-display/structured-interior-scene.ts)
- indoor static renderable membership in [apps/holtburger-3d/src/lib/world-display/static-renderables.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/world-display/static-renderables.ts)

That duplication is the main awkwardness to fix. The traversal helper should become the single source for env-cell coverage, and the scene/static derivation functions should consume an already-derived coverage set where practical.

### Suggested File Shape

A cleaner fit than placing the helper directly in `asset-channel.ts` may be a small colocated module such as:

- `apps/holtburger-3d/src/lib/assets/structured-interior-coverage.ts`

That module can depend on prepared asset types without pulling rendering code into the asset layer. `asset-channel.ts`, `structured-interior-scene.ts`, and `static-renderables.ts` can all consume the same coverage result.

### Incremental Execution

1. Add `deriveStructuredInteriorCoverage(policy, preparedByAssetId, options)` and tests for direct vs visible-cell closure.
2. Refactor `createIndoorCoverageRequests` and outdoor-linked interior coverage requests to use the helper.
3. Thread the derived coverage into `BrowserWorldDisplay.svelte` so structured-interior geometry and static renderables receive the same env-cell ids.
4. Remove one-layer browser expansion from scene/static helpers once their callers pass coverage directly.
5. Keep `App.svelte`, `AssetChannelController`, `AssetGraphScheduler`, and worker preparation behavior unchanged unless tests expose a real integration issue.

### Cleaner Approach Than A Browser-Only Branch

Avoid a separate `createBrowserInteriorRequests` function. It would work, but it would duplicate the runtime indoor request path and make future asset behavior drift likely. Prefer one structured-interior request function that accepts a membership policy.

### Open Implementation Detail

The plan should choose a default `maxEnvCells`. The value should be high enough for normal building interiors and small dungeons, but low enough to prevent accidental full-world or malformed-data loads. A first pass can use a named constant and surface truncation in UI telemetry.

## Tests

Add focused TypeScript tests:

- `direct` policy returns only the supplied env cells, even when prepared cells expose more `visibleCellIds`
- `visible-cell-closure` policy requests the seed first
- after seed metadata is prepared, `visible-cell-closure` coverage requests direct visible cells
- after a direct visible cell is prepared, `visible-cell-closure` coverage requests its visible cells
- runtime indoor residency does not recursively expand beyond `RuntimeResidencyDto.visibleCellIds`
- outdoor-linked interiors expand through prepared env-cell `visibleCellIds`
- static renderable request collection uses the same coverage as structured-interior scene geometry
- max-cell guard truncates deterministically

## Non-Goals

- Do not traverse `CellPortals` in this phase.
- Do not change client/runtime scene residency.
- Do not move browser coverage policy into shared Rust crates yet.
- Do not infer symmetric visible-cell relationships.
- Do not attempt whole-dungeon discovery from DAT indexes beyond visible-cell traversal.
- Do not split runtime and browser hydration into separate duplicate pipelines.

## Acceptance Criteria

- Browser mode can progressively reveal reachable-by-visible-cell structured interiors beyond one direct layer.
- Client/runtime mode remains AC-shaped and one visible-cell set deep.
- Scene geometry and indoor static renderables use the same structured-interior coverage set.
- Tests cover recursive browser expansion and runtime non-expansion.

## Implementation Progress

- In progress: adding a frontend-owned structured-interior coverage helper so request planning, scene geometry, and static renderables share one env-cell membership calculation.
- Decision: keep `AssetGraphScheduler`, worker preparation, and `App.svelte` unchanged. The behavior belongs in scene coverage policy, not graph dependencies.
- Course correction from the dry run: the helper should also expose small formatting helpers for `indoor-env-cell/*` and `environment/*` asset ids so callers do not keep private duplicate string construction.
- Completed: asset request planning now uses `direct` coverage for runtime indoor residency and `visible-cell-closure` coverage for browser-selected and outdoor-linked interiors.
- Completed: browser rendering now derives one structured-interior coverage result and passes it to both structured-interior geometry and static renderables.
- Decision: runtime request planning still includes `RuntimeResidencyDto.environmentId` as an extra first-class environment request, preserving the existing client-mode fast path while keeping cell membership direct-only.
- Completed: added focused TypeScript coverage tests for direct membership, progressive visible-cell closure, deterministic truncation, browser recursive request expansion, and runtime non-expansion.
- Verified: `npm run test:ts`, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run format:check` pass in `apps/holtburger-3d`.
- Completed: added a `maxVisibleCellDepth` guard in addition to total `maxEnvCells`; depth `0` means seed cells only, depth `1` means one `visibleCellIds` hop, and larger values allow recursive browser inspection without unbounded traversal.
- Course correction: moved the coverage limits into browser mode state and threaded them through asset discovery and rendering instead of keeping them as hidden helper constants, so they can be surfaced or tuned from browser UI.
- Completed: surfaced browser controls for structured-interior max env cells and visible-cell depth.
- Verified after the depth/configuration change: `npm run test:ts`, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run format:check` pass in `apps/holtburger-3d`.
