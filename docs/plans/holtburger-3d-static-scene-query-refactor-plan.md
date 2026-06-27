# Holtburger 3D Static Scene Query Refactor Plan

## Context

`apps/holtburger-3d/src/lib/runtime/static-scene-query.ts` has grown into a 4k-line module that
owns static scene query contracts, selection keys, outdoor/env-cell/terrain picking, landblock grid
indexing, committed env-cell records, portal and residency queries, debug bounds, ray math, and sort
helpers. The next dynamic entity phase needs a merged scene-query surface that composes static and
dynamic hits. Adding that on top of the current file would reinforce the god object instead of
creating a clean query boundary.

This plan decomposes the static query module before dynamic query integration. The refactor is
intended to preserve behavior exactly while splitting responsibilities into modules that a merged
static/dynamic query can compose without importing static-only internals.

## Goal

Turn `StaticSceneQuery` into a small facade over focused static scene-query modules with no intended
behavior change.

## Scope

In scope:

- Split static query contracts, selection keys, geometry helpers, landblock grid indexing, static
  runtime roots, picking, env-cell committed records, portal projections, env-cell residency,
  selection debug/details, and diagnostics helpers into focused modules.
- Keep the public `StaticSceneQuery` API behavior stable during the refactor.
- Preserve existing browser/runtime behavior and test expectations.
- Add focused tests for extracted primitives where existing integration tests are too broad to catch
  regressions.
- Leave a clean composition point for the dynamic merged scene-query phase.

Out of scope:

- Dynamic scene-query behavior.
- Renderer changes.
- Browser selection UX changes beyond import-path updates required by the refactor.
- Semantic changes to env-cell residency, portal projection, static selection, or static diagnostics.
- Compatibility shims that preserve obsolete import paths indefinitely.

## Ground Truth

Primary files:

- `apps/holtburger-3d/src/lib/runtime/static-scene-query.ts`
- `apps/holtburger-3d/src/lib/runtime/static-scene-query.test.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.test.ts`
- `apps/holtburger-3d/src/lib/browser/static-picking.ts`
- `apps/holtburger-3d/src/lib/browser/static-picking.test.ts`
- `apps/holtburger-3d/src/pages/BrowserDisplay.svelte`

Dependent plan:

- [docs/plans/holtburger-3d-dynamic-entity-system-implementation-plan.md](holtburger-3d-dynamic-entity-system-implementation-plan.md)

Verification commands:

- `cd apps/holtburger-3d && npm run test:ts -- --run src/lib/runtime/static-scene-query.test.ts src/lib/runtime/client-runtime.test.ts src/lib/browser/static-picking.test.ts`
- `cd apps/holtburger-3d && npm run test:ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`

## Target Module Shape

The exact split may change during implementation, but the ownership should land roughly here:

```text
apps/holtburger-3d/src/lib/runtime/scene-query/
  contracts.ts
  static-scene-query.ts
  static-selection-keys.ts
  static-query-state.ts
  static-picking.ts
  static-selection-debug.ts
  landblock-grid-spatial-index.ts
  env-cell-committed-records.ts
  env-cell-portal-projections.ts
  env-cell-residency.ts
  geometry.ts
  sort-keys.ts
```

Ownership rules:

- `contracts.ts` owns shared query DTOs and type contracts.
- `static-selection-keys.ts` owns static selection key creation, comparison, and description.
- `static-query-state.ts` owns static runtime root and item types such as terrain BVH roots, outdoor
  static BVH roots, env-cell landblock roots, env-cell cell roots, runtime item records, source
  diagnostics roots, and snapshot-supporting counters that are shared by the facade, grid index,
  picking, residency, and debug modules.
- `geometry.ts` owns generic ray, point, bounds, and distance helpers that dynamic query can later
  reuse.
- `landblock-grid-spatial-index.ts` owns outdoor render-cell candidate indexing and ray cell tracing.
- `env-cell-committed-records.ts` owns committed env-cell record storage/grouping/keying, env-cell
  static bounds overrides, layer-owned record clearing, retained-scope pruning, and env-cell runtime
  root materialization.
- `env-cell-portal-projections.ts` owns portal projection query/cache behavior over committed
  interiors, portal graphs, aperture resources, and projection roots.
- `env-cell-residency.ts` owns BSP/coarse/portal-graph residency decisions.
- `static-picking.ts` owns static hit production for terrain, outdoor static objects, env-cell static
  objects, and portal debug hits.
- `static-selection-debug.ts` owns selected static debug bounds and detail lookup.
- `static-scene-query.ts` coordinates the modules and remains the main runtime-facing facade.

State ownership rules:

- Extracted modules should either own coherent mutable state or consume explicit immutable/query
  state inputs. Avoid modules that mutate facade-private maps through callback soup.
- The facade may coordinate invalidation and cross-module updates, but it should not continue to own
  all maps while extracted modules merely operate on them.
- Public type contracts that leak through exported unions or indexed access must be exported
  explicitly. In particular, `StaticScenePickFilters` and env-cell portal hit contracts should not
  remain private-public TypeScript accidents.
- Split or relocate tests with the modules they validate. A single `static-scene-query.test.ts`
  should not remain the only home for grid tracing, committed records, residency, picking, and portal
  projection coverage once those modules are extracted.

## Phases

### Phase 1: Carve Out Contracts And Selection Keys

Status: pending.

Purpose:

- Move public static pick contracts and static selection key helpers out of the god module first so
  call sites depend on a stable query contract namespace.

Deliverables:

- Create `runtime/scene-query/contracts.ts`.
- Create `runtime/scene-query/static-selection-keys.ts`.
- Export public filters and hit variants explicitly, including `StaticScenePickFilters` and the
  env-cell portal pick hit type.
- Update imports in runtime, browser, page, and tests.
- Keep `StaticSceneQuery` behavior unchanged.

Acceptance criteria:

- Existing static picking and runtime tests pass.
- No new dynamic behavior exists.
- No stale public selection-key helpers remain in the old module.

Task checklist:

- [ ] Move static ray, pick context, pick request, pick filters, hit variants, details, snapshot,
      camera residency, committed env-cell record DTO, and debug-bound contracts.
- [ ] Move static selection key create/compare/describe helpers.
- [ ] Update all imports.
- [ ] Run focused static query/browser/runtime tests.

Decisions and course corrections:

- Pending.

### Phase 2: Extract Runtime Root State And Generic Geometry

Status: pending.

Purpose:

- Separate shared runtime root/item types and reusable math from static scene orchestration so later
  modules do not form cycles or duplicate terrain/outdoor/env-cell root shapes.

Deliverables:

- Create `runtime/scene-query/static-query-state.ts`.
- Create `runtime/scene-query/geometry.ts`.
- Move terrain, outdoor static, env-cell landblock, env-cell cell, runtime item, source diagnostics,
  residency evidence, cached projection, and committed record entry types as needed.
- Move ray normalization, ray/bounds intersection, point-on-ray, bounds translation, union,
  containment, distance, vector, and BVH traversal helpers that are structurally generic.
- Add focused tests for geometry behavior if existing integration coverage is too indirect.

Acceptance criteria:

- Static hit ordering and selection debug bounds behavior are unchanged.
- Shared root/state types are imported from one module by grid, picking, residency, debug, and facade
  code.
- Generic geometry helpers have no dependency on static object, env-cell, or terrain record types.

Task checklist:

- [ ] Move shared runtime root/item/state types into `static-query-state.ts`.
- [ ] Move generic geometry helpers.
- [ ] Add or relocate geometry tests for ray/bounds, translated bounds, containment, and BVH traversal
      edge cases where coverage is too indirect.
- [ ] Run focused static query tests.

Decisions and course corrections:

- 2026-06-26: Dry run found a missing state/type ownership home. Grid, picking, debug, residency,
  and facade all need the same root shapes; without `static-query-state.ts`, the refactor would
  either duplicate types or create import cycles.

### Phase 3: Extract Landblock Grid Spatial Index

Status: pending.

Purpose:

- Separate outdoor render-cell candidate indexing and ray cell tracing from static scene
  orchestration.

Deliverables:

- Create `runtime/scene-query/landblock-grid-spatial-index.ts`.
- Move `LandblockGridSpatialIndex`, landblock spatial bucket/candidate creation, render-cell key
  expansion, candidate distance estimation, and `traceLandblockGridRayCells`.
- Move existing grid tracing tests next to the extracted module.

Acceptance criteria:

- Static outdoor picking still visits anchored and neighboring landblocks in the same order.
- Grid tracing tests prove ray order and nearest-hit early stop behavior from the new module.
- The index consumes explicit static root state and does not reach into the facade.

Task checklist:

- [ ] Move `LandblockGridSpatialIndex`.
- [ ] Move grid trace/candidate helpers and tests.
- [ ] Update facade ingestion/retention paths to update the extracted index.
- [ ] Run focused grid and static outdoor picking tests.

Decisions and course corrections:

- Pending.

### Phase 4: Extract Env-Cell Committed Records, System Layers, And Projections

Status: pending.

Purpose:

- Separate env-cell committed record storage, system-layer records, bounds overrides, root
  materialization, and portal projection cache from static picking and facade orchestration before
  env-cell picking/debug/residency are moved.

Deliverables:

- Create `runtime/scene-query/env-cell-committed-records.ts`.
- Create `runtime/scene-query/env-cell-portal-projections.ts`.
- Move committed record keying/grouping/sorting, layer-owned record clearing, draw-unit resource
  removal, retained-scope pruning, accepted-env-cell derivation, env-cell static bounds overrides,
  committed env-cell root materialization, and retained committed-record snapshots.
- Move portal projection cache invalidation/query behavior and portal aperture resource access.

Acceptance criteria:

- Env-cell committed record, retained-scope, system-layer, portal graph, and portal projection tests
  remain unchanged.
- The facade delegates committed record mutation/query behavior to an explicit store.
- The committed record store owns env-cell static bounds overrides and materialized env-cell roots,
  instead of leaving those maps in the facade.
- Portal projection cache invalidation is explicit and tied to committed portal graph/interior or
  system-layer changes.
- Record key helpers are not exposed beyond modules that need them.

Task checklist:

- [ ] Move committed env-cell record maps behind a store.
- [ ] Move env-cell static bounds overrides and committed env-cell root materialization into the
      store.
- [ ] Move system-layer access/clearing into the store or a clearly owned collaborator.
- [ ] Move portal projection cache/query behavior into `env-cell-portal-projections.ts`.
- [ ] Move record key/group/sort helpers into private store modules.
- [ ] Move or split committed-record and portal-projection tests.
- [ ] Run static scene query and client runtime tests.

Decisions and course corrections:

- 2026-06-26: Dry run found that env-cell picking, debug bounds, and residency all depend on roots
  and bounds overrides produced by committed records. Extracting this state before picking avoids
  double-touch churn and prevents the facade from remaining the hidden state owner.

### Phase 5: Extract Env-Cell Residency

Status: pending.

Purpose:

- Move BSP/coarse/portal-graph residency decisions and residency counters behind an explicit module.

Deliverables:

- Create `runtime/scene-query/env-cell-residency.ts`.
- Move `queryEnvCellAtPoint`, render-space residency selection, landblock-local residency selection,
  graph evidence derivation, BSP helpers, and residency counters.

Acceptance criteria:

- Env-cell residency tests remain unchanged.
- Residency counters still appear in `StaticSceneQuerySnapshot`.
- The residency module consumes env-cell root/query state from the committed record store rather than
  facade-private maps.

Task checklist:

- [ ] Move env-cell residency graph and BSP helpers into a residency module.
- [ ] Move residency counters into a state object owned by the residency module.
- [ ] Move or split residency-focused tests.
- [ ] Run focused residency and client runtime tests.

Decisions and course corrections:

- Pending.

### Phase 6: Extract Static Picking

Status: pending.

Purpose:

- Move static hit production out of the facade while keeping static query semantics identical.

Deliverables:

- Create `runtime/scene-query/static-picking.ts`.
- Move outdoor static object, terrain, env-cell static object, and env-cell portal pick logic.
- Keep static filter behavior and nearest-hit ordering unchanged.

Acceptance criteria:

- `StaticSceneQuery.pickRay` delegates to the extracted picker.
- Static picking tests continue to prove outdoor static, terrain, env-cell, and portal debug hit
  behavior.
- The extracted picker has clear injected query state rather than reaching back into facade internals.

Task checklist:

- [ ] Identify the minimum immutable/query state needed by static picking.
- [ ] Move pick helpers behind an explicit picker function or class.
- [ ] Preserve filter and tie-break behavior.
- [ ] Move or split static picking tests.
- [ ] Run focused static query/browser picking tests.

Decisions and course corrections:

- Pending.

### Phase 7: Extract Static Selection Debug And Diagnostics Details

Status: pending.

Purpose:

- Keep debug/detail lookup code out of core query orchestration so the dynamic entity plan's merged
  query phase can add dynamic inspection without attaching it to static selection-key labels.

Deliverables:

- Create `runtime/scene-query/static-selection-debug.ts`.
- Move static selection debug bounds, object details, source diagnostics, terrain details, and
  env-cell static object details lookup as appropriate.

Acceptance criteria:

- Browser selection diagnostics continue to report the same static information.
- Static debug lookup consumes public selection-key contracts, not private facade internals.
- Dynamic inspection can later add its own detail provider without modifying static detail code.

Task checklist:

- [ ] Move static detail/debug lookup helpers.
- [ ] Update `ClientRuntimeImpl` imports/calls as needed.
- [ ] Move or split debug/detail tests.
- [ ] Run client runtime and browser diagnostics-related tests.

Decisions and course corrections:

- Pending.

### Phase 8: Facade Cleanup And Resteer

Status: pending.

Purpose:

- Finish the decomposition by reducing `StaticSceneQuery` to orchestration and deciding whether the
  resulting boundary is ready for dynamic merged query work.

Acceptance criteria:

- `static-scene-query.ts` is no longer the owner of picking algorithms, generic geometry, committed
  record stores, selection-key helpers, runtime root state, projection caches, residency counters, or
  grid traversal.
- `StaticSceneQuery` still exposes the required runtime-facing static query API.
- No compatibility barrel or legacy import path remains unless recorded as explicit cleanup debt.
- Extracted module tests replace the single mega-test shape where practical.
- Full TypeScript tests, checks, lint, and dead-code checks pass.
- The dynamic implementation plan is updated if Phase 7 needs adjustment based on the final module
  shape.

Task checklist:

- [ ] Remove dead helpers and obsolete exports from the original module.
- [ ] Review module dependency graph for circular or static-only leakage.
- [ ] Review tests for module ownership and split any remaining mega-test sections that now validate
      extracted modules directly.
- [ ] Update this plan with final decisions and any remaining cleanup debt.
- [ ] Run full verification commands.

Decisions and course corrections:

- Pending.

## Risks And Mitigations

- Risk: behavior changes hide inside module movement.
  Mitigation: keep each phase behavior-preserving, run focused tests after every phase, and defer all
  dynamic query changes until this plan is complete.

- Risk: the facade remains a god object with relocated helper files.
  Mitigation: each extracted module must own a coherent responsibility and expose explicit inputs,
  not mutate facade private state by proxy.

- Risk: refactor size blocks dynamic entity progress.
  Mitigation: phase the decomposition so every step leaves the app compiling and testable; stop at
  the resteer phase if the boundary is sufficient for merged query composition.

- Risk: generic helpers become too abstract or leak static vocabulary.
  Mitigation: only move primitives that are already structurally generic, such as ray/bounds math and
  grid traversal. Keep static-object-specific facts in static modules.

- Risk: browser diagnostics force compatibility shims to stay around.
  Mitigation: update browser/runtime imports decisively during the relevant phase and record any
  unavoidable wrapper as cleanup debt with an owner.

## Definition Of Done

- `StaticSceneQuery` is a facade over focused scene-query modules.
- Static query behavior, browser picking, selection diagnostics, env-cell residency, and portal
  debug behavior are unchanged.
- Generic geometry/grid helpers are reusable by dynamic scene query without importing static
  scene-query internals.
- No dead compatibility exports remain.
- Verification commands pass, or unrelated pre-existing failures are documented.
- The dynamic entity implementation plan can proceed to merged static/dynamic scene query with a
  clean static adapter boundary.

## Open Questions

- None currently. This refactor should not make product or UX decisions.
