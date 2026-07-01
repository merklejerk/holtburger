# Holtburger 3D Texture Pipeline Performance Investigation Worksheet

Date: 2026-07-01
Status: Active investigation

## Purpose

Track the browser-runtime investigation into outdoor scene load CPU burn after the simplified texture packing pipeline refactor. The immediate goal is to preserve measured evidence, code-path findings, and next probes before changing pipeline behavior.

This worksheet is diagnostic, not an implementation plan. Implementation should continue to prioritize the texture-pipeline north stars already captured in `docs/plans/holtburger-3d-simplified-texture-packing-pipeline-plan.md`: isomorphic paths, contained resolver/baker complexity, clean cutover, no vestigial code, and no guessing.

## Current Harness

The investigation used a new browser pipeline harness in `apps/holtburger-3d`:

- `src/pages/BrowserPipelineHarness.svelte` creates the real browser runtime against a bare canvas and installs `window.__HOLTBURGER_3D_HARNESS__`.
- `scripts/browser-pipeline-harness.mjs` launches the dev asset host, Vite, and Chrome via CDP.
- `src-tauri/src/bin/dev_asset_host.rs` serves the same host asset lookup APIs over HTTP for the harness.
- `src/lib/host/runtime-host.ts` selects the HTTP host only when the harness route includes `?assetHost=...`.

The harness intentionally does not use `BrowserDisplay`. That keeps browser UI policy, panels, follow-mode state, and manual controls out of pipeline debugging.

Important harness readiness correction:

- `RuntimeOverviewSnapshot.status === "static-active"` means static demand is active, not that static work is settled.
- The harness waits for stricter static readiness: requested work exists, `resolving === 0`, `baking === 0`, and `committed === requested`.
- Failed/timeout harness runs still write diagnostics when `--output` is provided.

## Commands Run

All commands were run from `apps/holtburger-3d`.

```sh
npm run harness:browser -- --timeout-ms 60000 --landblock 0xda55ffff --domains terrain --output /tmp/holtburger-harness-terrain.json
npm run harness:browser -- --timeout-ms 90000 --landblock 0xda55ffff --domains terrain,buildings --output /tmp/holtburger-harness-terrain-buildings.json
npm run harness:browser -- --timeout-ms 90000 --landblock 0xda55ffff --domains terrain,generated-scenery --output /tmp/holtburger-harness-terrain-generated.json
npm run harness:browser -- --timeout-ms 90000 --landblock 0xda55ffff --domains terrain,explicit-objects --output /tmp/holtburger-harness-terrain-explicit.json
npm run harness:browser -- --timeout-ms 90000 --landblock 0xda55ffff --domains terrain,env-cells --output /tmp/holtburger-harness-terrain-env-cells.json
npm run harness:browser -- --timeout-ms 180000 --landblock 0xda55ffff --output /tmp/holtburger-harness-full-settle.json
```

Verification after harness edits:

```sh
node --check scripts/browser-pipeline-harness.mjs
npm run lint:dead
npm run check
```

## Measured Results

The timings below are runtime diagnostics sums from `staticCoordinator.timingSummary`, not wall-clock duration unless explicitly stated. They are useful for scale and relative comparison, but some attribution is batch-shaped rather than pure per-domain stopwatch timing.

| Scenario | Static tasks | Draw units | Resolver ms | Bake ms | Texture placement ms | Atlas MB | Atlas batches | Atlas pages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `terrain` | 21 | 55 | 16,853 | 83 | 854 | 159 | 3 | 11 |
| `terrain,buildings` | 30 | 90 | 24,603 | 498 | 5,780 | 171 | 4 | 15 |
| `terrain,generated-scenery` | 39 | 240 | 54,751 | 17,131 | 9,836 | 263 | 8 | 25 |
| `terrain,explicit-objects` | 39 | 240 | 48,881 | 18,155 | 9,056 | 170 | 5 | 14 |
| `terrain,env-cells` | 30 | 553 | 127,473 | 34,756 | 19,838 | 217 | 7 | 26 |
| full settled | 57 | 713 | 817,596 | 115,797 | 36,812 | 632 | 32 | 108 |

The full scene settled successfully under a 180s ceiling, but took roughly 150s wall-clock in the harness. This matches the user-observed long CPU burn much better than any single isolated domain slice.

## Atlas Evidence

Settled full-scene atlas totals by domain:

| Domain | Batches | Pages | Approx bytes | Approx MB | Entry aliases | Unique sources |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `outdoor-terrain` | 8 | 26 | 360,710,120 | 344 | 208 | 88 |
| `outdoor-generated-scenery` | 6 | 30 | 236,574,032 | 226 | 230 | 145 |
| `env-cell-system` | 6 | 20 | 27,131,896 | 26 | 284 | 250 |
| `outdoor-buildings` | 6 | 18 | 24,876,368 | 24 | 113 | 89 |
| `outdoor-explicit-objects` | 6 | 14 | 13,383,000 | 13 | 70 | 59 |

Largest retained batches in the settled full run:

- Two terrain batches are each about `62,914,556` bytes. Each contains one detail page, one mask page, and two color pages.
- Several generated-scenery batches are each about `45,077,844` bytes. Most repeat large `rgba-color` pages with relatively small unique source counts.
- The final full-scene atlas is larger than the 45s partial snapshot. The page growth is retained, not just temporary packing garbage.

Direct code-path evidence:

- `TextureManager.placeTextureIntents()` maps every intent through `createVisualTextureUseCommitFromIntent(intent, input.placementBatchId)`.
- `#stageTexturePlacement()` reuses existing sources only inside `#getRegistry(textureUse.domain, textureUse.textureBatchId)`.
- Static pre-bake passes `work.staticBatchId` as the placement batch id.
- Therefore current pre-bake placement reuse is scoped to `(domain, staticBatchId)`, where static batch ids are layer-owner/batch-shaped. Neighboring landblocks can repeatedly pack identical or similar texture sources into separate atlas pages instead of sharing broader domain/purpose pages.

This is consistent with the refactor concern: the current implementation still behaves much more like per-layer static allocation than the intended domain/purpose-oriented packing closure.

## Demand Planning Findings

Domain-slice testing found two important demand-planning constraints:

1. `normalizeOutdoorLodRadii()` clamps buildings/detail/env-cells radii to the terrain radius.
2. `createStaticDemand()` collapses `explicit-objects` and `generated-scenery` into one `detail` radius.

Consequences:

- Requesting `generated-scenery` alone or `env-cells` alone planned zero work because terrain was not included and the terrain radius clamp forced the relevant radius below zero.
- Testing non-terrain outdoor domains currently requires including `terrain` as the coverage ceiling.
- Requesting either `explicit-objects` or `generated-scenery` currently schedules both detail domains in `planStaticDemand()`, because the planner receives only one `detail` radius.

This explains why the `terrain,explicit-objects` slice still reported generated-scenery bake work. It is not just noisy diagnostics; it is a real loss of domain specificity between scene interest and static demand.

## Timing Caveats

Do not over-read the `slowestResolver.domain` field as pure per-domain truth.

Current coordinator timing has several limitations:

- Recent timing is capped, so the summary is not always a complete historical trace.
- Resolver timing is attached to source/bake batches and later summed from current tasks.
- Source requests can contain multiple requested layers for one landblock scene LOD payload.
- The displayed domain for a timing record may be batch-shaped or representative, not a clean profiler span for one domain.

The following findings are still direct enough to trust:

- Full settled atlas size, batch count, and page count.
- Texture manager reuse scope: `(domain, textureBatchId)`.
- Demand planner collapse from explicit/generated to one `detail` radius.
- Terrain radius clamp affecting domain-slice diagnostics.
- Env-cell and generated-scenery slices are materially heavier than terrain/buildings.

## Working Diagnosis

The regression is probably not a single infinite retry loop. The harness did not show static task failures or pending waiters in settled runs.

The stronger diagnosis is cumulative pipeline work:

- Per-layer/batch texture registries prevent page reuse across neighboring landblocks and domains.
- Terrain and generated-scenery create large repeated pages.
- Env-cell processing is the dominant wall-clock path, especially in resolver and bake.
- Full-scene demand combines the expensive paths and finishes late, especially for the center landblock after neighboring coverage work.
- Static-authored generated scenery also triggers dynamic animation catch-up warnings during load. Those warnings correlate with heavy load, but are not yet proven to be the root CPU cost.

## Architectural Course Correction

The investigation initially framed the fix as splitting `StaticBakeBatchId` from texture allocation identity. That is probably still too timid.

Current direction:

- Batching still earns its keep as an internal coordinator scheduling behavior: coalesce source-ready payloads, cap max payloads, delay briefly, and send one bake input.
- A persistent `staticBatchId` does not clearly earn its keep in the current closure-based architecture.
- `staticBatchId` mostly behaves as a correlation string that leaked into placement, bake inputs, commit deltas, diagnostics, dynamic visual bake ids, and tests.
- The harmful leak is texture placement: using `staticBatchId` as `placementBatchId` makes every source-ready bake batch a private atlas namespace.

North star:

- Keep batching internal to `StaticCoordinator`.
- Do not expose batch identity as a texture placement namespace.
- Prefer deleting `staticBatchId` from public/static product contracts rather than renaming it.
- Use more precise identities for the jobs `staticBatchId` currently fakes:
  - task ids for task-level diagnostics and currentness checks
  - commit ids for install tracking
  - owner/resource ids for lifetime and eviction
  - closure-local state for async continuation guards
  - placement bucket keys for texture allocation lifetime and sharing

This does not mean every string id disappears in one pass. It means new code should not preserve "batch id" as a first-class architectural concept unless a concrete responsibility remains after the audit.

## Phased Fix Plan

Status: Blocked in Phase 5 on 2026-07-01 by full-scene generated-scenery page-legality failures.

Goal: remove batch-scoped texture placement and retire `staticBatchId` as a public/static product identity while preserving internal coordinator batching as an implementation detail.

### Phase 0: Responsibility Audit

Status: Completed 2026-07-01.

Purpose: prove exactly which `staticBatchId` uses remain necessary before changing behavior.

Deliverables:

- Audit every production `staticBatchId`, `textureBatchId`, and `placementBatchId` use in `apps/holtburger-3d/src/lib/static`, `src/lib/runtime`, and `src/lib/textures`.
- Classify each use as:
  - delete outright
  - replace with task id
  - replace with commit id
  - replace with owner/resource id
  - replace with texture placement bucket key
  - keep temporarily as closure-local debug text
- Update this worksheet with the audit table and any surprising constraints.

Acceptance criteria:

- No behavior changes.
- The audit identifies every public/static product contract that still exposes `staticBatchId`.
- The audit identifies every place where `staticBatchId` currently affects texture placement or atlas lookup.
- `npm run --prefix apps/holtburger-3d check` passes if any type-only/doc-adjacent edits are made.

Decision gate:

- If a `staticBatchId` consumer has a real responsibility that cannot be replaced cleanly, document it and rename the concept to that responsibility before implementation.

Audit results:

| Current consumer | Current responsibility | Classification | Replacement / steering |
| --- | --- | --- | --- |
| `StaticSourceReadyWork.staticBatchId` and `createStaticBatchId()` in `static-coordinator.ts` | Correlates one source-ready closure through placement, bake, diagnostics, and commit id creation. | Delete as public/static product identity; keep at most closure-local debug text during migration. | The closure already guards `continueWithPlacement()`. Use task ids for represented work and generate commit ids independently. |
| `TextureIntentPlacementInput.placementBatchId`, `VisualTextureUseCommit.textureBatchId`, texture manager registry keys, texture ref ids, page ref ids, and pending placement grouping in `texture-manager.ts` | Defines atlas namespace and page grouping. This is the source of batch-scoped placement. | Replace with texture placement bucket key. | Phase 1/2 should introduce an explicit allocation identity and make source reuse search by bucket, not source-ready bake batch. |
| `createStaticAtlasBatchSnapshot(payloads, staticBatchId)` and `StaticAtlasBatchSnapshot.staticBatchId` | Gives bakers an atlas view scoped to the current static batch. | Replace with placement-facts query. | Phase 3 should query resolved placements for the texture uses needed by the bake input. The snapshot shape should lose batch identity or be renamed if still needed. |
| `StaticBakeBatchInput.staticBatchId` and `StaticBakeBatchResult.staticBatchId` | Propagates batch id into bakers and then back into commits. | Delete or replace with concrete identities. | Bakers should receive `items`, task ids, owner ids, domain, revision, placement facts, and attachments. If a generated resource id needs a prefix, use owner/resource identity. |
| `StaticBakeTextureUse.staticBatchId` and `createStaticVisualTextureUseCommit()` | Carries batch id into committed texture uses so commit-time texture placement uses the same namespace. | Delete; replace with placement bucket key only if commit-time texture uses still need one. | Static texture uses should describe source, owners, domain, sampling, and binding id. Allocation namespace belongs to texture manager placement records. |
| Static object, terrain, and env-cell placement planners | Accept `staticBatchId` only to build planning `StaticBakeTextureUse` values. | Delete after texture uses stop carrying static batch id. | These planners should emit placement intents with source/purpose/affinity facts. Affinity can remain object/terrain/env specific without becoming allocation identity. |
| Static object, terrain, and env-cell bakers | Copy `input.staticBatchId` into results, diagnostics, or helper calls; terrain material classifier uses it in material keys like `batch:${staticBatchId}`. | Replace with task/owner/resource/placement facts. | Any material key using `batch:${staticBatchId}` is suspicious. Use stable material/owner/terrain legality keys that reflect draw-unit grouping, not bake work grouping. |
| Static commit deltas and `createStaticCommitId(staticBatchId)` | Exposes batch id to runtime install tracking and derives commit id from it. | Replace with independent commit id and task/resource identities. | Commit id should be the commit/install correlation id. Task ids and owner/resource ids should explain what changed. |
| Eviction commits via `createEvictionStaticBatchId()` | Fabricates a static batch id for removal-only commits. | Delete. | Eviction needs a commit id and removed resource ids, not a fake batch. |
| Runtime static commit install snapshots/diagnostics | Records `staticBatchId` beside commit phase and warning text. | Replace with commit id plus task/resource facts. | Install diagnostics should still identify failed work, but "draw units from batch X" should become task/resource-oriented text. |
| `#textureBatchIdByStaticLayerOwner` and static-authored dynamic presentation policy | Bridges static-authored dynamic placements to the source commit's texture batch id. | Replace with owner/resource-scoped static-authored dynamic placement bucket. | This is the main non-obvious constraint. Static-authored dynamics need a stable texture bucket policy, but it should be derived from owner/resource/lifetime, not the commit that revealed the placement. |
| Runtime-authored dynamic `textureBatchId` policy | Gives runtime-spawn visuals an isolated texture namespace. | Rename/replace with placement bucket key. | Runtime-authored dynamics may keep per-entity buckets for lifetime/churn isolation, but the concept should be explicit placement bucket identity, not "batch." |
| Static-authored dynamic visual bake `batchId` derived from `staticBatchId` | Correlates dynamic visual bake work produced from static-authored recipes. | Replace with owner/resource scoped bake id or closure-local debug id. | If the dynamic visual baker needs an id, make it about visual resource ownership or recipe set identity. |
| `fake-workers.ts` and tests | Use `staticBatchId` as an async completion handle. | Replace with test-only pending input handles or task ids. | Test convenience does not justify production contract shape. Update tests during the phase that removes the production field. |
| Runtime and coordinator timing diagnostics | Report `staticBatchId` as a convenient batch correlation string. | Replace with task ids, commit id, and source-request diagnostics. | Phase 5 needs better timing attribution anyway; do not preserve batch identity just for old summaries. |

Phase 0 decisions:

- No audited production use requires `staticBatchId` to remain a public/static product identity.
- The only real surviving concept is internal coordinator coalescing. That should be represented by local pending batch state, not a cross-layer id.
- Texture allocation identity must be introduced before removing most batch fields, because static, dynamic, and static-authored dynamic texture flows all currently spell allocation namespace as `textureBatchId`.
- Static-authored dynamics are the highest-risk migration path because they currently inherit the static commit texture namespace through `#textureBatchIdByStaticLayerOwner`.

Phase 0 debt recorded:

- Terrain material family keys that include `batch:${staticBatchId}` need special care; they may be hiding draw-unit grouping assumptions.
- Timing diagnostics are too batch-shaped to prove per-domain costs. The cleanup should add source-request/task-oriented timing before removing the old field from diagnostics.
- Tests are likely to make this refactor look larger than the production behavior change because many fake-worker helpers complete work by `staticBatchId`.

### Phase 1: Introduce Explicit Placement Buckets

Status: Completed 2026-07-01.

Purpose: create the correct texture allocation identity without changing static bake semantics yet.

Deliverables:

- Add a typed texture placement bucket identity in the texture placement/manager layer.
- Bucket identity should be based on texture allocation lifetime and sharing policy, not bake grouping.
- Static-authored placement should use broad static buckets, subdivided only by constraints the packer already understands or can remain domain-agnostic about:
  - texture domain/lifetime bucket
  - usage/purpose/page policy
  - terrain-vs-non-terrain only if required by page policy or shader legality
- Static-authored dynamic placements should derive texture buckets from static owner/resource lifetime, not from the commit that revealed the placement.
- Runtime-authored dynamics should keep a separate runtime-authored bucket policy.
- Keep static bake grouping internal to `StaticCoordinator`.

Acceptance criteria:

- Existing static and dynamic texture tests pass.
- New tests prove two different static work closures using the same source/purpose can resolve to the same placement bucket.
- New tests prove runtime-authored dynamic placement does not accidentally share static-authored buckets.
- No baker or commit contract is required to know placement bucket internals.

Decision gate:

- If terrain needs a distinct bucket, the reason must be shader/page legality, not landblock or bake batch identity.

Implementation notes:

- Added `TexturePlacementBucketKey`, `TexturePlacementBucketLifetime`, and `TexturePlacementBucketInput` in `src/lib/textures/placement.ts`.
- Added derivation helpers for:
  - broad static-authored placement buckets
  - static-authored dynamic buckets keyed by static owner lifetime
  - runtime-authored dynamic buckets keyed by runtime entity lifetime
- The bucket key is opaque and currently encodes only:
  - texture domain
  - placement pool
  - shader/page purpose
  - allocation lifetime
- The key intentionally does not include:
  - source-ready closure id
  - static batch id
  - texture placement item id
  - affinity key
  - source fingerprint

Phase 1 verification:

```sh
npm run test:ts -- src/lib/textures/placement.test.ts
npm run check
```

Both passed.

Phase 1 steering:

- The manager still uses legacy `placementBatchId`/`textureBatchId`; Phase 1 only made the replacement identity explicit and test-covered.
- Static-authored dynamics should migrate from inherited static commit texture batch ids to static owner lifetime bucket keys in Phase 2 or Phase 4, depending on where the manager contract cut lands.
- The bucket string is intentionally not a public schema. If downstream code starts parsing it, stop and introduce a structured field instead.

### Phase 2: Stop Batch-Scoped Pre-Bake Placement

Status: Completed 2026-07-01.

Purpose: remove the behavior causing private per-layer atlas namespaces.

Deliverables:

- Stop passing `work.staticBatchId` as `placementBatchId`.
- Convert `TextureManager.placeTextureIntents()` to accept placement bucket identity from the intent/planning layer or derive it from intent facts.
- Change registry lookup from `(domain, textureBatchId)` to the new placement bucket key.
- Ensure source reuse searches the appropriate placement bucket, not the source-ready bake batch.
- Update diagnostics to report placement buckets rather than static batches where relevant.

Acceptance criteria:

- Focused texture-manager tests prove static-authored terrain/generated/object/env-cell sources can reuse atlas placement across different source-ready work closures.
- Harness full-scene run for `0xda55ffff` shows materially fewer atlas batches/pages/MB than the recorded baseline:
  - baseline settled full run: 32 batches, 108 pages, about 632 MiB reported in diagnostics
- Texture placement time should decrease materially from the recorded full baseline:
  - baseline full run `texturePlacementMs`: about 36,812 ms aggregate
- No dual path or compatibility flag remains.

Decision gate:

- If page reuse improves but terrain legality regresses, fix legality in the terrain baker or terrain page policy, not by restoring batch-scoped allocation.

Implementation notes:

- `TexturePlacementIntent` now carries `placementBucketKey`.
- `TextureManager.placeTextureIntents()` no longer accepts `placementBatchId`.
- Static pre-bake placement and static commit placement derive the same broad static-authored bucket from:
  - texture domain
  - placement pool
  - shader/page purpose
  - `static-authored` lifetime
- Runtime-authored dynamic pre-bake placement and dynamic commit placement derive the same runtime-authored bucket from:
  - `runtime-object-material`
  - shader/page purpose
  - runtime entity lifetime
- Static-authored dynamic commit placement derives an owner-lifetime bucket from:
  - static texture domain
  - shader/page purpose
  - static layer owner id
- The legacy atlas snapshot query now derives static placement buckets per texture use. This is intentionally transitional; Phase 3 should replace the snapshot shape instead of polishing it.
- Internal texture-manager structs still use `textureBatchId` names for the bucket value. That is terminology debt reserved for Phase 4/6 so the Phase 2 behavior change stayed reviewable.

Phase 2 behavior changes proven by tests:

- Compatible static texture sources now reuse across independent `staticBatchId` values.
- Pre-bake placement and commit placement reuse the same static bucket.
- Runtime-authored dynamic pre-bake and commit placement reuse the same runtime bucket.
- Static-authored dynamic texture placement no longer inherits the static commit batch namespace; in the current implementation it uses a separate owner-lifetime bucket.

Phase 2 verification:

```sh
npm run test:ts -- src/lib/textures/placement.test.ts src/lib/textures/texture-manager.test.ts
npm run test:ts -- src/lib/dynamic/visual-baker.test.ts src/lib/runtime/client-runtime.test.ts
npm run check
```

All passed during Phase 2 implementation.

Phase 2 steering:

- Static-authored dynamic owner-lifetime buckets are structurally aligned with the plan, but they may duplicate pages that broad static-authored buckets already contain. Keep this on the harness watch list; if the real atlas metrics show excessive duplication here, reassess whether static-authored dynamics should share the broad static bucket while relying on resource dependency ref counts for eviction.
- Texture ref ids now include opaque bucket keys. That is acceptable as an internal renderer/diagnostic id, but consumers must not parse the string.

### Phase 3: Replace Batch-Shaped Atlas Snapshots

Status: Completed 2026-07-01.

Purpose: make the baker consume placement facts for its texture uses, independent of bake grouping.

Deliverables:

- Replace `createStaticAtlasBatchSnapshot(payloads, staticBatchId)` with a placement-facts query keyed by the texture uses needed by the current bake input.
- Remove `StaticAtlasBatchSnapshot.staticBatchId`.
- Rename or replace `StaticAtlasBatchSnapshot` if the old name remains misleading after the shape changes.
- Ensure terrain, static-object, and env-cell bakers only receive:
  - texture use identities
  - resolved placement facts
  - page/purpose facts needed to form legal draw units
- Keep draw-unit legality inside bakers.

Acceptance criteria:

- Static baker tests pass for terrain, env-cell, and static object paths.
- Tests prove the baker can bake two different closures against placements from the same bucket without requiring a batch id.
- No atlas snapshot lookup uses static batch identity.

Decision gate:

- If a baker only uses the snapshot for diagnostics, delete that dependency instead of preserving a renamed artifact.

Implementation notes:

- Removed `StaticAtlasBatchSnapshot` and `StaticBakeBatchInput.atlasSnapshot`.
- Removed `StaticCoordinatorOptions.createAtlasSnapshot`, `StaticCoordinator#setAtlasSnapshotProvider()`, and the coordinator's empty atlas snapshot fallback.
- Removed `TextureManager.createStaticAtlasBatchSnapshot()` and its payload texture-use helpers.
- Updated static bake fixtures to pass only the surviving bake inputs:
  - attachments
  - domain/items/revision
  - `texturePlacementSnapshot`
  - current `staticBatchId` until Phase 4 removes or renames that responsibility
- No production baker consumed `atlasSnapshot`; all real draw-unit legality and dependency grouping now use `texturePlacementSnapshot`.

Phase 3 verification:

```sh
npm run check
npm run test:ts -- src/lib/textures/texture-manager.test.ts src/lib/static/bake/worker-client.test.ts src/lib/static/resolver/landblock-scene-lod-source-resolver.test.ts src/lib/static/terrain/bake/terrain-geometry-baker.test.ts src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts
```

Both passed during Phase 3 implementation.

Phase 3 steering:

- This phase confirmed the atlas snapshot was vestigial. Replacing it with another snapshot-like artifact would have preserved unnecessary complexity.
- `staticBatchId` still remains on bake input/result and several baker-local diagnostics. Phase 4 should now be narrower because one of the batch-shaped contract consumers is gone.

### Phase 4: Retire Public `staticBatchId` Plumbing

Status: Completed 2026-07-01.

Purpose: delete `staticBatchId` from contracts where it no longer has a concrete responsibility.

Deliverables:

- Remove `staticBatchId` from committed texture uses if texture placement no longer depends on it.
- Replace static commit/install tracking by `staticBatchId` with commit id, task ids, and resource/owner identities.
- Replace bake-input/result `staticBatchId` fields with closure-local implementation details or delete them.
- Replace static-authored dynamic visual bake `batchId` derivation with an identity that reflects its real owner/resource scope.
- Remove or update diagnostics that report `staticBatchId` merely because it used to exist.
- Delete tests that only preserve old batch id behavior.

Acceptance criteria:

- `rg "staticBatchId|placementBatchId|textureBatchId" apps/holtburger-3d/src/lib/static apps/holtburger-3d/src/lib/runtime apps/holtburger-3d/src/lib/textures` returns only intentional surviving uses documented in the worksheet.
- No public static product contract exposes `staticBatchId` unless the audit documented a concrete surviving responsibility.
- Static eviction still releases texture/resource ownership through owner/resource identities.
- Static commit install diagnostics still identify failed work through commit/task/resource facts.

Decision gate:

- If a replacement identity becomes a generic "work id," reassess before landing; that likely recreates `staticBatchId` under a different name.

Progress on 2026-07-01:

- Removed dynamic presentation `textureBatchId`.
- Removed runtime `#textureBatchIdByStaticLayerOwner`, its static-owner lookup helpers, and the install-time recorder/pruner.
- `DynamicEntityController.ingestStaticPlacements()` no longer accepts a texture batch lookup map.
- Dynamic texture commits now carry only `placementBucketKey` plus `textureDomain`; the legacy `textureBatchId` field was removed from `DynamicTextureUseCommit`.
- Removed `StaticBakeTextureUse.staticBatchId`.
- Removed now-unused static object and structured-interior placement planner `staticBatchId` parameters.
- Removed `StaticCoordinatorCommitDelta.staticBatchId`; runtime install tracking and warnings now use commit ids plus revision.
- Static commit ids are derived from revision and task ids. Eviction commits use `static-commit:<revision>:evict` and no longer fabricate a fake static batch.
- Removed `bakeBatchId` from runtime static commit install snapshots and `static-commit-install-failed` warning events.
- Removed terrain material-family dependence on bake batch identity. Single-base terrain keys use the primary texture-use id; layered terrain keys use the actual prepared texture-use id set plus the plan signature.
- Renamed test surfaces from `staticBatchId` to `bakeBatchId` only where they exercise worker completion of a coalesced bake input.

Phase 4 verification:

```sh
npm run check
npm run lint:ts
npm run test:ts -- src/lib/dynamic/dynamic-entity-controller.test.ts src/lib/dynamic/dynamic-placement-tracker.test.ts src/lib/dynamic/dynamic-animation-player.test.ts src/lib/dynamic/dynamic-animation-update-cadence.test.ts src/lib/runtime/client-runtime.test.ts src/lib/textures/texture-manager.test.ts
npm run test:ts -- src/lib/textures/placement.test.ts src/lib/textures/texture-manager.test.ts src/lib/static/bake/static-material-texture-policy.test.ts src/lib/static/terrain/bake/terrain-geometry-baker.test.ts src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/objects/bake/static-object-batch-baker.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts src/lib/dynamic/dynamic-entity-controller.test.ts src/lib/runtime/client-runtime.test.ts
npm run test:ts -- src/lib/static/terrain/bake/terrain-material-family-classifier.test.ts src/lib/static/terrain/bake/terrain-geometry-baker.test.ts src/lib/static/coordinator/static-coordinator.test.ts src/lib/runtime/client-runtime.test.ts src/lib/runtime/static-commit-installer.test.ts src/lib/runtime/env-cell-system-layer-publication.test.ts
npm run test:ts -- src/lib/textures/placement.test.ts src/lib/textures/texture-manager.test.ts src/lib/static/bake/static-material-texture-policy.test.ts src/lib/static/objects/bake/static-object-bake-attachments.test.ts src/lib/static/env-cells/bake/env-cell-system-geometry-attachments.test.ts src/lib/static/env-cells/bake/env-cell-system-baker.test.ts src/lib/static/objects/bake/static-object-batch-baker.test.ts src/lib/static/objects/bake/static-object-batch-partitioner.test.ts
```

All passed after the completed Phase 4 subcuts.

Phase 4 decisions:

- `bakeBatchId` remains only as an internal coalesced bake input/worker correlation handle and in baker-local diagnostics. It is not a texture placement namespace, commit id source, install diagnostic field, or terrain material legality key.
- Removing the internal bake handle entirely is lower value than proving performance first. The remaining name is still mild debt, but it has a concrete responsibility.
- Texture-manager internals still use `textureBatchId` for the already-new placement bucket value. That is Phase 6 cleanup debt, not Phase 4 behavior risk.
- Static-authored dynamic visual bake ids still derive from the internal bake handle. This is not texture placement, but it is terminology debt and should be revisited during cleanup if the dynamic visual baker can complete by recipe/task ownership instead.

### Phase 5: Harness Proof And Resteer

Status: Blocked 2026-07-01.

Purpose: prove the pipeline changed in the intended direction before broad cleanup.

Deliverables:

- Run the browser pipeline harness for:
  - `terrain`
  - `terrain,generated-scenery`
  - `terrain,env-cells`
  - full `0xda55ffff`
- Record after numbers in this worksheet next to the existing baseline.
- Compare atlas batches/pages/MB, texture placement time, resolver/bake timing, and wall-clock settle time.
- Decide whether remaining wall-clock cost is still texture placement/page duplication or primarily resolver/baker CPU.

Acceptance criteria:

- Full-scene settled atlas metrics improve materially from baseline.
- If full wall-clock remains high, diagnostics identify the next dominant cost without relying on console vibes.
- Any remaining env-cell or generated-scenery hot path has a documented next action.

Decision gate:

- If atlas metrics do not improve, stop and inspect bucket key derivation before continuing cleanup.

Phase 5 implementation and evidence:

- Tightened browser harness readiness. Static coordinator completion is not enough; the harness now also requires drained static commit installs and matching installed/source draw-unit counts.
- Fixed source-ready placement reclaim. `placeTextureIntents()` now retains texture refs staged by the current placement request so a zero-ref pre-bake alias cannot be reclaimed before its snapshot is returned.
- Disabled zero-ref page reclaim during commit install. Commit install materializes a baker closure and must not reclaim pre-bake pages owned by other not-yet-installed closures.
- Serialized `TextureManager` async mutations. Placement closures and commit-time texture mutations now run through one mutation queue so concurrent source-ready workers cannot reclaim or rewrite each other's staged state.
- Fixed object-material page legality de-duping. Legality now de-dupes by material-entry key plus texture requirements, not material-entry key alone.
- Added `textureRefId` to `TexturePlacement`; object-material page legality now compares renderer page identity instead of packer-local `pageId`.
- Added placement revision to multi-source texture page refs so repeated packer jobs cannot create the same renderer texture ref for different physical pages.

Phase 5 after metrics:

| Scenario | Result | Static tasks | Draw units | Resolver ms | Bake ms | Texture placement ms | Atlas MB | Atlas batches | Atlas pages |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `terrain` | settled | 21 | 55 | 15,380 | 78 | 781 | 61 | 3 | 5 |
| `terrain,buildings` | settled | 30 | 90 | 24,044 | 1,506 | 1,451 | 78 | 7 | 9 |
| `terrain,generated-scenery` | settled | 39 | 334 | 56,599 | 8,723 | 9,667 | 150 | 21 | 29 |
| `terrain,env-cells` | settled | 30 | 866 | 128,617 | 34,537 | 15,935 | 73 | 7 | 14 |
| full `0xda55ffff`, 360s | blocked | 57 requested / 51 committed / 4 failed / 6 baking | 572 installed / 651 committed | 144,949 | 1,496,929 | 23,019 | 153 | 23 active / 29 total | 34 |

Phase 5 blocker:

- Full-scene correctness still fails after the texture-manager race and page-identity fixes.
- The remaining concrete failure is generated-scenery reusable static-object resources in a multi-landblock commit. Example from the harness: `draw-unit:outdoor-generated-scenery:0xda56ffff:static-object-partition:slice-7-0` exceeded one page for `object-base-color` while installing the commit for `0xda56ffff`, `0xdb54ffff`, `0xdb55ffff`, and `0xdb56ffff`.
- Isolated `terrain,generated-scenery` settles, so the failure depends on full-scene interaction/order or reusable-resource aggregation, not basic generated-scenery rendering alone.
- This means Phase 6 cleanup is not appropriate yet. The next phase must focus on generated-scenery reusable static-object page legality under broad placement buckets.

Phase 5 steering:

- Add a new Phase 5A before cleanup: reproduce the failing reusable generated-scenery partition in a segregated test or harness slice, then make the static object baker/resource aggregator preserve one-page-per-role legality using `textureRefId`.
- Keep the texture-manager fixes. They removed real races and made isolated slices reliable.
- Reassess mutation queue cost after the generated-scenery blocker is fixed. Full-scene timings are not yet a fair performance comparison because the run times out with failures and active bake work.

### Phase 5A: Generated-Scenery Page Legality And Snapshot Stability

Status: In progress 2026-07-01. Correctness failure converted into long-running bake timeout; acceptance not yet met.

Purpose: close the full-scene correctness gap exposed by Phase 5 without backing away from broad texture placement buckets.

Deliverables:

- Reproduce the full-scene failure in a focused generated-scenery/static-object test or a narrower harness scenario.
- Identify whether the failing draw unit is produced by reusable static-object visual resource aggregation, generated-source instancing, or multi-landblock commit batching.
- Ensure static object draw units and reusable visual resources are split by renderer `textureRefId` per object-material role, not by material layout or packer-local page id.
- Add a regression test for a repeated material layout whose placement item ids land on different texture refs.
- Rerun the full `0xda55ffff` harness and replace the blocked Phase 5 full-scene row with settled metrics.

Acceptance criteria:

- Full `0xda55ffff` settles with `failed === 0`, `baking === 0`, `pendingStaticCommitInstallCount === 0`, and no WebGL missing-binding errors.
- No implicit fallback disables generated-scenery or object texture bindings.
- Focused static object and env-cell tests still pass with `textureRefId` legality.

Phase 5A implementation and evidence:

- Added temporary commit-time diagnostics and proved the failing owner was a regular generated-scenery static object draw unit, not a reusable visual resource:
  - `draw-unit:outdoor-generated-scenery:0xda56ffff:static-object-partition:slice-7-0`
  - later `slice-10-2` after a narrow wrap-axis experiment
- The conflicts paired two `object-base-color` placements with different renderer `textureRefId`s for the same draw-unit owner. Examples:
  - `0600378c` repeat vs `060037a1` clamp
  - `060037a0` clamp vs `060037a1` clamp
- A broad concrete-material-entry partition cut eliminated the page conflict but was rejected as too expensive: the 360s harness timed out at `51/57` committed with `1165` installed draw units. That was a useful proof but not an acceptable north-star direction.
- Kept the narrower static-object wrap-axis split. Wrap/sampler policy is a real shader/page compatibility axis and should not depend on placement-page luck.
- Identified a stronger root cause: pre-bake placement snapshots were not stable while bake closures were in flight. `placeTextureIntents()` could reclaim/repack zero-ref ownerless pages when later source-ready work arrived, so a baker could split using snapshot A and commit against atlas state B.
- Changed pre-bake `placeTextureIntents()` to avoid zero-ref page reclaim. Commit install already avoids reclaim. This preserves placement facts for in-flight closures and keeps the packer domain-agnostic.
- Updated texture-manager tests so placement planning retains zero-reference ownerless pages instead of reclaiming them.

Phase 5A harness result after snapshot-stability fix:

| Scenario | Result | Static tasks | Draw units | Resolver ms | Bake ms | Texture placement ms | Atlas MB | Atlas batches | Atlas pages |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full `0xda55ffff`, 360s | timeout, no failures | 57 requested / 49 committed / 0 failed / 8 baking | 421 installed | 120,467 | 1,684,517 | 22,617 | 165 | 29 | 49 |

Phase 5A diagnostic result:

- The generated-scenery page-legality failure did not recur after disabling pre-bake reclaim, but the full scene still does not settle under the 360s harness ceiling.
- Remaining in-flight tasks at timeout were: center terrain, one buildings task, five env-cell-system tasks, and one explicit-objects task.
- Phase 5A fixed a real correctness race, but the user's original CPU-burn report remained active and was dominated by long-running bake closures rather than atlas page-conflict retry/failure.

Phase 5A steering:

- Do not proceed to Phase 6 cleanup until full-scene harness settles.
- Add harness-visible active bake stage diagnostics before changing bake behavior.
- Preserve the stable-snapshot fix unless a stronger lifetime model replaces it.

### Phase 5B: Active Bake Stage Diagnostics

Status: Completed 2026-07-01.

Purpose: prove which coordinator-side stage owns long-running `baking` tasks.

Implementation notes:

- Added `activeBakeStage`, `activeBakeStageStartedAtMs`, and `activeBakeStageAgeMs` to static layer task diagnostics.
- Stages are intentionally coarse: source-ready handler, attachments, static baker, dynamic visual baker, and commit synthesis.
- The full harness still timed out at `51/57` with `6 baking`, but all six in-flight tasks were in `static-baker`.

Phase 5B evidence:

- Old tasks had `phaseAgeMs` around `249s` to `266s`.
- The active bake stage was `static-baker` for:
  - one `outdoor-buildings` task
  - one `outdoor-generated-scenery` task
  - four `env-cell-system` tasks in one bake closure

Steering:

- The coordinator was not stuck in attachment, dynamic visual bake, commit synthesis, or stale materialization state.
- The next diagnostic cut needed to distinguish worker-pool queue wait from actual worker execution.

### Phase 5C: Static Baker Worker Queue Diagnostics

Status: Completed 2026-07-01.

Purpose: distinguish "posted to static baker" from "actively executing inside a worker."

Implementation notes:

- Static bake workers now post a diagnostic `static-batch-bake-started` message when a worker begins executing a job.
- `StaticBakeWorkerClient`, `WorkerPoolStaticBaker`, `BrowserStaticBaker`, static coordinator snapshots, and runtime diagnostics now expose pending static baker jobs with:
  - worker/pool request id
  - bake batch id
  - domain
  - item count
  - `queued` vs `executing`
  - queue/stage ages
- The static bake result/failure protocol remains unchanged.

Phase 5C evidence:

- Full harness timed out again at `51/57`, `6 baking`.
- Worker diagnostics showed one `env-cell-system` 4-item job executing for about `271s`.
- The buildings and generated-scenery center jobs were queued for about `255s` behind that env-cell job on the same worker.
- The pool had two workers, but only worker 1 had pending jobs at timeout. Worker 0 had no pending job in the diagnostic snapshot.

Steering:

- This proved two separate issues:
  - blind per-worker queueing caused an idle worker while another worker had queued jobs;
  - the 4-item env-cell bake was itself a long-running worker job.

### Phase 5D: Work-Conserving Static Baker Pool

Status: Completed 2026-07-01.

Purpose: stop posting new static bake jobs into a busy worker's private queue when another worker can take future work.

Implementation notes:

- Replaced blind round-robin worker submission with a pool-level queue.
- Jobs dispatch only to idle workers; if all workers are busy, the pool retains the queued request centrally until a worker finishes.
- Added a focused worker-pool test for the measured failure shape: one worker busy, another idle, and the next pointer aimed at the busy worker.

Phase 5D evidence:

| Scenario | Result | Static tasks | Draw units | Resolver ms | Bake ms | Texture placement ms | Atlas MB | Atlas batches | Atlas pages |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full `0xda55ffff`, central worker queue, 360s | timeout, no failures | 57 requested / 53 committed / 0 failed / 4 baking | 1122 installed | 263,367 | 1,131,981 | 30,419 | 165 | 29 | 44 |

- The buildings and generated-scenery tail jobs completed after the central queue change.
- The only remaining in-flight work was the 4-item `env-cell-system` bake closure:
  - `0xda56ffff`
  - `0xdb55ffff`
  - `0xdb54ffff`
  - `0xdb56ffff`
- The worker job was executing, not queued.

Steering:

- The worker pool fix is worth keeping. It improved committed work and removed artificial queue tail.
- The remaining blocker was a single bundled env-cell worker job, so the next fix should reduce env-cell batch granularity.

### Phase 5E: Env-Cell Single-Item Bake Batches

Status: Completed 2026-07-01.

Purpose: eliminate multi-landblock env-cell worker whales and let the worker pool schedule smaller env-cell closures.

Implementation notes:

- `StaticCoordinator` now caps `env-cell-system` bake batches at one item.
- Other domains continue using the configured batch cap.
- Updated the coordinator test that preserved multi-item env-cell batching; the new invariant is that env-cell tasks are isolated into single-item bake inputs.

Phase 5E evidence:

| Scenario | Result | Static tasks | Draw units | Resolver ms | Bake ms | Texture placement ms | Atlas MB | Atlas batches | Atlas pages |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full `0xda55ffff`, env-cell split, 360s | settled | 57 requested / 57 committed / 0 failed / 0 baking | 1556 installed | 285,977 | 1,705,232 | 74,010 | 165 | 29 | 58 |

Acceptance notes:

- Full `0xda55ffff` settled with `failed === 0`, `baking === 0`, `pendingStaticCommitInstallCount === 0`, and matching installed/source draw-unit counts.
- The full-scene "active bake forever" blocker is closed.
- CPU load is still substantial. The aggregate timing counters are worse in some categories because more env-cell jobs now complete and report, not because the run is still blocked.
- Dynamic animation catch-up warnings still appear during heavy generated-scenery load. They remain correlated symptoms and need a separate investigation before changing animation behavior.

### Phase 6: Cleanup And Contract Hardening

Status: Ready after Phase 5E settles full-scene harness.

Purpose: remove vestiges and make the new architecture hard to accidentally regress.

Deliverables:

- Delete stale helpers, test fixtures, and comments that imply batch-scoped atlas allocation.
- Rename remaining "batch" terminology so it only describes internal coordinator coalescing or true worker batch execution.
- Add focused regression tests for cross-landblock placement reuse.
- Add a small diagnostics invariant or test that detects unexpected atlas namespace explosion for repeated source placements.
- Update this worksheet with final before/after metrics and remaining debt.

Acceptance criteria:

- `npm run --prefix apps/holtburger-3d check` passes.
- `npm run --prefix apps/holtburger-3d lint:ts` passes.
- `npm run --prefix apps/holtburger-3d lint:dead` passes.
- `npm run --prefix apps/holtburger-3d lint:rust` passes if Rust harness/asset-host code changed.
- Focused texture/static/runtime tests pass.
- No vestigial compatibility path remains for batch-scoped static placement.

## Next Probes

High-value follow-ups:

1. Add per-source-request timing diagnostics that preserve:
   - source landblock id
   - requested layer kinds
   - source LOD
   - resolver start/end
   - placement start/end
   - bake start/end
   - resulting task ids
2. Add texture-packer diagnostics by job:
   - domain
   - placement bucket key, or legacy texture batch id while still in transition
   - page class key
   - source count
   - unique source fingerprints
   - output page bytes
   - whether sources already existed in another active registry
3. Compare atlas source fingerprints across terrain and generated-scenery batches to quantify duplicate page content rather than inferring from page shapes.
4. Separate static demand detail radii or domain filters so `explicit-objects` and `generated-scenery` can be independently diagnosed.
5. Decide whether terrain should remain the coverage ceiling for all outdoor domains or whether per-domain slices need a diagnostic-only override.
Candidate implementation direction if the diagnosis holds:

- Move pre-bake texture placement away from source-ready/static-batch registries and toward broader domain/purpose/lifetime buckets, matching the simplified pipeline plan.
- Remove `staticBatchId` from texture placement intents, committed texture uses, and atlas snapshot lookup.
- Replace `createStaticAtlasBatchSnapshot(payloads, staticBatchId)` with a placement-facts query for the texture uses the baker needs, independent of bake grouping.
- Replace static commit install tracking by `staticBatchId` with commit ids and task/resource identities.
- Keep draw-unit legality and terrain shader constraints in the baker.
- Avoid making the packer domain-aware beyond purpose/page constraints.
- Preserve clean cutover: do not shim a second legacy batch registry beside the new one.

## Open Debt

- Zero-ref page reclaim is disabled during pre-bake placement planning to keep snapshots stable for in-flight bake closures. Reintroduce reclaim only with an explicit lifetime model that cannot invalidate active snapshots.
- Env-cell worker jobs are now single-item to avoid multi-landblock bake whales. This is intentionally conservative; if future profiling makes env-cell baking cheap enough, revisit the cap with evidence.
- Static baker worker diagnostics are new production diagnostics. Keep them if they continue to pay rent during cleanup; otherwise remove them instead of preserving low-value noise.
- Harness CLI `--domains` is useful, but domain slices are currently distorted by runtime demand clamping and detail-domain collapse.
- Static timing diagnostics are not sufficient for precise per-domain attribution.
- Atlas diagnostics summarize batches and pages but do not yet expose duplicate source fingerprints across registries.
- The final full-scene atlas size is large enough that page reuse should be investigated before more micro-optimizing worker code.
- The animation catch-up warnings during generated-scenery load need a separate check; they may be downstream symptoms of long load stalls.
- `textureBatchId` remains as internal texture-manager terminology for placement buckets. Rename it in Phase 6 if the harness proof confirms the bucket behavior is correct.
- `bakeBatchId` remains as an internal worker-correlation handle. If it starts leaking into product contracts again, delete or rename it immediately; no second life as architecture glitter.
