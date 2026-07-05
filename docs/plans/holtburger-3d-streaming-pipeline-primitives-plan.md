# Holtburger 3D Streaming Pipeline Primitives Plan

Status: Phase 6 complete; Phase 7 renderer texture binding readiness primitive planned before the
texture placement transaction remodel.

Related context:

- [Holtburger 3D Open World Streaming Stutter Investigation Worksheet](./holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md)
- [Holtburger 3D Standard Worker Pool Plan](./holtburger-3d-standard-worker-pool-plan.md)
- [Holtburger 3D Simplified Texture Packing Pipeline Implementation Plan](./holtburger-3d-simplified-texture-packing-pipeline-plan.md)
- [Holtburger 3D Texture Key Simplification Plan](./holtburger-3d-texture-key-simplification-plan.md)

## Purpose

Tighten the small data and lifetime primitives needed for a cleaner open-world streaming pipeline
before attempting a broader static/dynamic visual pipeline remodel.

The stutter investigation showed that the main-thread bottleneck is structural: the current pipeline
still pushes too much texture preparation, placement, lifetime bookkeeping, and install coordination
through serialized runtime paths. The standard worker pool gives the app a better off-thread
execution substrate, but the pipeline also needs clearer artifacts at domain boundaries. This plan
standardizes those artifacts in a conservative order:

1. binary sidecar ownership for typed-array payloads crossing worker boundaries;
2. explicit texture/resource lease sets for residency lifetime;
3. an install-product shape discovered from the simplified sidecar and lease model, not assumed up
   front;
4. renderer-facing texture binding readiness so visuals can be installed separately from physical
   texture residency without rendering placeholders.

## North Stars

1. **Prefer isomorphism over parallel architecture.**

   Static layers, static-authored dynamics, and runtime-authored dynamics should use comparable
   materialization, texture residency, and renderer-install concepts wherever the real domain facts
   permit it. Differences should be expressed as data or narrow domain policy, not as separate
   orchestration traditions.

2. **Reduce complexity rather than rename it.**

   Each primitive must delete or collapse existing special-case handling, ambiguous ownership, or
   scattered lifecycle bookkeeping. A new type that merely wraps old confusion is not progress.

3. **Standardize boundary artifacts, not the whole pipeline.**

   This plan should not introduce a general scheduler, generic job framework, global cancellation
   model, or deep generational bookkeeping. The worker pool already owns worker orchestration. These
   primitives should clarify what crosses boundaries and what keeps resources alive.

4. **Do not make the visual bundle a bag of stuff.**

   A shared install product is valuable only if it preserves important distinctions: reusable
   geometry versus instances, texture demand versus texture residency, static layer replacement
   versus dynamic resource refresh, and renderer payloads versus world/query records.

5. **Binary ownership must be explicit.**

   Large texture and geometry buffers should either be worker-owned transferables or deliberately
   borrowed non-transferable inputs. DTOs must make that distinction visible enough that call sites do
   not detach cache-owned or inspection-owned buffers by accident.

6. **Leases should make unload boring.**

   Resource lifetime should be expressed by explicit owner/resource ids and lease sets. Removing a
   static layer or dynamic visual resource should mechanically release its texture residency without
   relying on scattered string conventions.

7. **Diagnostics follow the cleaned-up model.**

   Existing temporary diagnostics from the stutter investigation are disposable. Keep diagnostics
   only when they describe durable concepts such as transfer bytes, lease counts, installed resource
   counts, or worker-pool lifecycle. Delete obsolete probes when convenient.

8. **Stay app-local.**

   These are browser/Tauri renderer pipeline primitives. Keep them inside `apps/holtburger-3d`
   unless another frontend proves it needs the same TypeScript/browser concepts.

## Scope

In scope:

- standardizing typed-array transfer ownership conventions for worker inputs and outputs;
- adding or refining protocol-local transfer collectors for texture and geometry worker products;
- making texture residency leases explicit in the texture/runtime install boundary;
- converting static and dynamic renderer install paths to the same lease-set vocabulary where
  practical;
- making renderer texture binding readiness explicit before the broader texture placement
  transaction remodel;
- auditing the post-lease static/dynamic install products before extracting any shared visual
  install product;
- deleting or renaming obsolete temporary diagnostics and compatibility shims when they block the
  cleaner shape.

Out of scope:

- redesigning the full texture placement transaction pipeline;
- adding frame-budgeted scheduling;
- adding a global pipeline cancellation/currentness framework;
- adding deep generational snapshot/proposal infrastructure;
- changing renderer draw behavior except where required by the new boundary types;
- rendering placeholder or fallback textures for pending bindings;
- moving browser/Tauri pipeline types into shared Rust crates or other app layers.

## Current Verified Facts

Worker and transfer groundwork:

- `apps/holtburger-3d/src/lib/workers/pool.ts`
  - provides `StandardWorkerPool`, typed request/response envelopes, service requests, progress,
    cancellation handles, and `transferInput`.
- `apps/holtburger-3d/src/lib/workers/handler.ts`
  - provides `installWorkerHandler` for worker-side protocol handling.
- `apps/holtburger-3d/src/lib/workers/transfers.ts`
  - collects full-buffer typed-array transfers, rejects partial views by default, and rejects
    `SharedArrayBuffer` because it is not transferable.
- `apps/holtburger-3d/src/lib/textures/packing/transfers.ts`
  - already transfers `TexturePackingResult.pages[].pixels`, the cleanest first candidate because
    worker-created page pixels are handed off to the main thread.

Existing binary payloads:

- `apps/holtburger-3d/src/lib/textures/packing/protocol.ts`
  - texture packing jobs and results carry `Uint8Array` source/page pixel buffers.
- `apps/holtburger-3d/src/lib/static/contracts.ts`
  - terrain, static object, and structured-interior draw units carry `Float32Array`,
    `Uint16Array`, and `Uint32Array` geometry buffers.
- `apps/holtburger-3d/src/lib/visual/visual-geometry.ts`
  - shared visual geometry payloads are used by dynamic and instanced/static visual resources.
- `apps/holtburger-3d/src/lib/dynamic/visual-bake-sidecars.ts`
  - dynamic visual bake sidecars already expose geometry-like typed-array payloads that should be
    reviewed for transfer ownership.

Existing lifetime and install behavior:

- `apps/holtburger-3d/src/lib/textures/placement.ts`
  - defines `TexturePlacementIntent`, `TexturePlacementSnapshot`, and
    `TextureResourceDependencies`.
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
  - pins and releases texture dependencies through `pinTextureResourceDependencies(...)` and
    `releaseTextureResourceDependencies(...)`.
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
  - releases static texture dependencies before static commit install and pins new dependencies
    afterward;
  - syncs dynamic visual resources through separate release/pin calls before renderer dynamic
    resource commits.
- `apps/holtburger-3d/src/lib/runtime/static-commit-installer.ts`
  - validates committed static texture bindings and produces renderer install results.
- `apps/holtburger-3d/src/lib/renderer/types.ts`
  - static layer payloads, dynamic visual resource commits, and texture placement updates already
    contain the future install-product ingredients, but they are not one shared product shape.

Existing renderer texture binding behavior:

- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`
  - keeps renderer-owned WebGL texture objects in `#textures`, keyed by `textureRefId`;
  - keeps resolved material binding placements in `#texturePlacements`, keyed by
    `TextureBindingId`;
  - applies `TexturePlacementUpdate` by deleting removed texture refs, uploading/replacing page
    textures, and recording `bindingId -> ResolvedTexturePlacement`;
  - conservatively dirties all object-material and terrain prepared payloads after texture placement
    changes because there is not yet a reverse binding-to-prepared-payload invalidation model.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.ts`
  - resolves object material texture bindings only when both a resolved placement and WebGL texture
    are resident; missing bindings remain unbound and required material resources are skipped.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-terrain-payloads.ts`
  - resolves terrain page bindings only when resident placement and WebGL texture state are
    available; required missing bindings make a terrain payload not renderable.

## Phase 0: Baseline And Naming Audit

Goal: prove the first cutover targets before adding new nouns.

Status: complete.

Deliverables:

- Inventory every worker protocol that returns large typed arrays.
- Inventory every runtime path that pins or releases `TextureResourceDependencies`.
- Inventory static and dynamic install DTOs that currently mix renderer payloads, texture uses,
  texture dependencies, scene query records, and ownership metadata.
- Record a small baseline in this plan:
  - transfer collector locations;
  - number of direct `pinTextureResourceDependencies` and `releaseTextureResourceDependencies`
    call sites;
  - static and dynamic install DTOs considered for the later install-product phase.

Acceptance criteria:

- The audit names concrete files and symbols.
- The first binary transfer candidates are worker-owned outputs, not borrowed input buffers.
- The lease phase has a clear starting owner model before implementation begins.

### Phase 0 Findings

Worker protocols that can carry large typed arrays:

- `apps/holtburger-3d/src/lib/textures/packing/protocol.ts`
  - input: `TexturePackingJob.sources[].source.pixels`;
  - output: `TexturePackingResult.pages[].pixels`;
  - transfer status: output pixels already have `collectTexturePackingResultTransfers(...)` in
    `apps/holtburger-3d/src/lib/textures/packing/transfers.ts`;
  - ownership note: output page pixels are worker-created and owned-transferable; input source pixels
    are still borrowed from prepared/direct material texture sources and should not be transferred in
    the sidecar convention phase.
- `apps/holtburger-3d/src/lib/static/bake/protocol.ts`
  - input: `StaticBakeJobInput.resources.envCellCellStructureGeometry[].buffer` and
    `StaticBakeJobInput.resources.staticObjectSourceGeometry[].buffer`;
  - output: `StaticBakeJobResult.drawUnits`, `StaticBakeJobResult.objectVisualInstallSet`, and
    related static visual resources contain geometry buffers;
  - transfer status: no protocol-local transfer collector found;
  - ownership note: source geometry inputs are prepared resources and should be treated as borrowed
    until copied or otherwise proven worker-owned. Bake outputs are worker-created and are the best
    static geometry transfer candidate.
- `apps/holtburger-3d/src/lib/dynamic/visual-bake-protocol.ts`
  - input: `DynamicVisualBakeInput.sourceGeometry`;
  - output: `DynamicVisualBakeResult.product.resource.renderParts` carry
    `VisualGeometryPayload`-style buffers;
  - transfer status: no protocol-local transfer collector found;
  - ownership note: source geometry inputs are borrowed prepared sidecars; baked render parts are
    worker-created and are the best dynamic geometry transfer candidate. Optional
    `product.resource.objectVisual?.geometryBuffers` values are source-local sidecars, not an
    automatic transfer target.
- `apps/holtburger-3d/src/lib/static/resolver/protocol.ts`
  - output: `StaticResolverWorkerOutput.payload` can include rich source payloads and prepared asset
    facts;
  - transfer status: no protocol-local transfer collector found;
  - ownership note: resolver output should not be an early transfer target. It mixes source facts,
    prepared asset references, and static scene data rather than clean worker-owned render buffers.
- `apps/holtburger-3d/src/lib/dynamic/visual-recipe-protocol.ts`
  - output: `DynamicEntityRecipe`;
  - transfer status: no protocol-local transfer collector found;
  - ownership note: recipe resolution is asset/fact assembly, not the first binary transfer target.

Current transfer collectors:

- `apps/holtburger-3d/src/lib/workers/transfers.ts`
  - `collectTransferableArrayBuffers(...)`;
  - `addTransferableArrayBuffer(...)`;
  - rejects partial typed-array views by default;
  - rejects `SharedArrayBuffer` because it is not transferable.
- `apps/holtburger-3d/src/lib/textures/packing/transfers.ts`
  - `collectTexturePackingResultTransfers(...)`;
  - currently collects `TexturePackingResult.pages[].pixels`.

Runtime texture dependency call-site baseline:

- Production direct call sites outside `TextureManager`: four in
  `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`.
  - Static install release:
    `#textureManager.releaseTextureResourceDependencies(collectStaticDrawUnitResourceIds(delta.removedResources))`.
  - Static install pin:
    `#textureManager.pinTextureResourceDependencies(delta.textureDependencies)`.
  - Dynamic resource sync release:
    `#textureManager.releaseTextureResourceDependencies(removedResourceIds)`.
  - Dynamic resource sync pin:
    `#textureManager.pinTextureResourceDependencies(resources.flatMap((resource) => resource.textureDependencies))`.
- Internal manager behavior:
  - `TextureManager.pinTextureResourceDependencies(...)` first releases any existing dependency for
    the same `TextureResourceDependencies.resourceId`, then pins every role item id.
  - `TextureManager.releaseTextureResourceDependencies(...)` releases by resource id.
- Test-only direct call sites exist in `apps/holtburger-3d/src/lib/textures/texture-manager.test.ts`
  and should remain low-level manager tests unless the public API is fully cut over.

Lease model facts:

- `TextureResourceDependencies` in `apps/holtburger-3d/src/lib/textures/placement.ts` already
  contains the release identity:

  ```ts
  interface TextureResourceDependencies {
    readonly resourceId: string;
    readonly roles: readonly TextureResourceRoleDependency[];
  }
  ```

- The Phase 3 candidate `TextureLeaseSet.resourceIds` field is probably redundant. The cleaner first
  implementation should prefer a compact wrapper around `readonly TextureResourceDependencies[]`
  unless the runtime cutover discovers a real need for separate removed-resource ids.
- The phrase "lease set" should describe a resource-residency boundary, not a second ownership graph.

Static and dynamic install DTOs considered for the later install-product phase:

- `StaticCoordinatorCommitDelta` in `apps/holtburger-3d/src/lib/static/contracts.ts`
  - mixes renderer install inputs (`addedDrawUnits`, `addedPortalApertureResources`,
    `objectVisualInstallSet`), texture lifecycle (`textureUses`, `textureDependencies`), removals
    (`removedResources`), scene/query records, material coverage, tasks, and revision.
- `StaticScopePrepCommit` in `apps/holtburger-3d/src/lib/static/contracts.ts`
  - wraps the static commit plus static-authored dynamic placements, recipes, and dynamic visual bake
    results.
- `StaticCommitInstallResult` in
  `apps/holtburger-3d/src/lib/runtime/static-commit-installer.ts`
  - validates committed texture placements and exposes renderer/static-scene publication products.
- `StaticLandblockLayerPayload` in `apps/holtburger-3d/src/lib/renderer/types.ts`
  - renderer-facing static layer payload with texture uses, draw units, source mappings, spatial
    records, and layer-specific records.
- `DynamicRendererVisualResource` and `DynamicRendererResourceCommit` in
  `apps/holtburger-3d/src/lib/renderer/types.ts`
  - renderer-facing dynamic resource install/refresh shape; dynamic visual resources carry
    `textureDependencies` directly.
- `BakedDynamicVisualResource` and `DynamicVisualBakeResult` in
  `apps/holtburger-3d/src/lib/dynamic/contracts.ts`
  - dynamic bake output and runtime source for renderer dynamic resource creation.

Phase 0 conclusions:

- First transfer implementation target: worker-created geometry outputs from static bake and dynamic
  visual bake. These are closer to texture packing result pages than resolver or recipe outputs.
- First non-targets: texture packing input pixels, static bake source geometry inputs, dynamic visual
  bake source geometry inputs, static resolver outputs, and dynamic recipe outputs.
- First lease implementation target: replace the four production runtime direct dependency
  pin/release call sites with a compact texture lease-set vocabulary.
- Install-product extraction remains intentionally gated. Current DTOs show real overlap, but also
  important differences between static layer replacement, static-authored dynamic materialization,
  dynamic resource refresh, renderer install payloads, and scene/query publication records.

Decisions and course corrections:

- Phase 3 should avoid the initially sketched `TextureLeaseSet.resourceIds` field unless a later
  implementation step proves it is necessary. `TextureResourceDependencies.resourceId` already
  carries the release key.
- The next phase after Phase 5 should not introduce `VisualResourceBundle` before Phase 5 proves that
  one shared envelope preserves static/dynamic distinctions better than smaller shared component
  types.

### Resteering After Phase 0

The remaining phases should stay narrower than the original draft:

- Phase 1 is a transfer ownership helper phase, not a DTO redesign phase.
- Phase 2 should target only worker-created bake outputs and should leave all borrowed worker inputs
  alone.
- Phase 3 should model lease sets as a compact wrapper over `TextureResourceDependencies[]`.
- Phase 4 should cut over exactly the four production runtime pin/release call sites found in Phase
  0.
- Phase 5 remains a required stop point before any shared visual install product is introduced.
- The post-Phase-5 path should prefer scoped cleanup and then shared components over a shared
  envelope unless the code proves the envelope reduces complexity without flattening
  provenance-specific facts.

## Dry Run Through Phase 5

This dry run walks the remaining near-term phases against the current code without implementing them.

### Phase 1 Dry Run

Likely implementation:

- Extend `apps/holtburger-3d/src/lib/workers/transfers.ts` with ownership-aware binary sidecar
  helpers:

  ```ts
  interface BinarySidecarView<TView extends ArrayBufferView = ArrayBufferView> {
    readonly label: string;
    readonly ownership: "owned-transferable" | "borrowed";
    readonly view: TView;
  }
  ```

- Recommended helper names:
  - `collectTransferableBinarySidecars(...)`;
  - `createOwnedTransferableView(...)` only if call sites get noisy;
  - avoid a registry or sidecar manager.
- Default behavior should reject borrowed views if a caller passes them into a transfer collector.
  Protocol collectors should normally pass only owned views. A skip policy can exist for future mixed
  collectors, but the first migrated collectors should not need it.
- Convert `apps/holtburger-3d/src/lib/textures/packing/transfers.ts` to wrap
  `TexturePackingResult.pages[].pixels` as owned views and delegate to the new helper.
- Extend `apps/holtburger-3d/src/lib/workers/transfers.test.ts` and keep
  `apps/holtburger-3d/src/lib/textures/packing/transfers.test.ts` as protocol-specific coverage.

Expected code pressure:

- Low. This should be a small helper/test phase.
- Existing `installWorkerHandler` already supports result transfer lists.
- Existing texture packing transfer tests already prove the pilot path; they should become a guard
  that the new helper preserves behavior.

Do not do in Phase 1:

- Do not add transfer collectors for static/dynamic bake yet.
- Do not transfer any worker input buffers.
- Do not rename every typed-array payload to "sidecar".

### Phase 2 Dry Run

Likely implementation:

- Add a shared visual-geometry transfer collector in a new
  `apps/holtburger-3d/src/lib/visual/visual-geometry-transfers.ts`.
  - This keeps worker-transfer concerns out of `visual-geometry.ts` while colocating the collector
    with `VisualGeometryPayload`.
  - The collector should gather `positions`, `texCoords`, `materialSlotIndices`, and `indices`.
- Add `apps/holtburger-3d/src/lib/dynamic/visual-bake-transfers.ts`.
  - Collect from `DynamicVisualBakeResult.product.resource.renderParts`.
  - Do not collect `product.resource.objectVisual?.geometryBuffers` by default; those are
    source-local sidecars unless a later audit proves the worker creates independent copies.
- Add `apps/holtburger-3d/src/lib/static/bake/transfers.ts`.
  - Collect terrain draw-unit buffers: `positions`, `texCoords`, `layerSlots`, `indices`.
  - Collect object-style draw-unit buffers: `positions`, `texCoords`, `materialSlotIndices`,
    `indices`.
  - Collect `StaticBakeJobResult.objectVisualInstallSet.visualResources` through the shared
    `VisualGeometryPayload` collector.
  - It is acceptable if the same backing buffer appears through multiple result fields; transfer
    collection already dedupes buffers.
- Wire transfer collectors into:
  - `apps/holtburger-3d/src/lib/dynamic/visual-bake-worker-handler.ts`;
  - `apps/holtburger-3d/src/lib/static/bake/worker-handler.ts`.
- Upgrade fixture worker ports in:
  - `apps/holtburger-3d/src/lib/dynamic/visual-bake-worker-client.test.ts`;
  - `apps/holtburger-3d/src/lib/static/bake/worker-client.test.ts`.
  Existing fixture ports currently ignore transfer-list arguments, unlike
  `apps/holtburger-3d/src/lib/workers/handler.test.ts`.

Expected code pressure:

- Moderate but contained. The hard part is not transport; it is building small fixture results with
  real full-buffer typed arrays so transfer assertions are meaningful.
- Static bake progress/trace is the regression risk because the handler will go from
  `return { output: result }` to `return { output: result, transfer: collectStaticBakeJobResultTransfers(result) }`.
  The existing progress tests should remain intact and gain a transfer assertion, not be replaced.

Do not do in Phase 2:

- Do not transfer `StaticBakeJobInput.resources.*Geometry[].buffer`.
- Do not transfer `DynamicVisualBakeInput.sourceGeometry`.
- Do not transfer resolver or recipe worker outputs.
- Do not chase `StaticPortalApertureResource`; its `indices` and `vertices` are plain arrays, not
  typed-array transfer candidates.

### Phase 3 Dry Run

Likely implementation:

- Add a new module: `apps/holtburger-3d/src/lib/textures/leases.ts`.
  - This answers the module-location question: lease sets should not live in `placement.ts`.
    `placement.ts` already owns placement vocabulary and `TextureResourceDependencies`; a separate
    texture lifetime module avoids bloating that file.
  - The module should import `TextureResourceDependencies` from `placement.ts`.
- Candidate shape:

  ```ts
  interface TextureLeaseSet {
    readonly dependencies: readonly TextureResourceDependencies[];
  }
  ```

- Likely helpers:
  - `EMPTY_TEXTURE_LEASE_SET`;
  - `createTextureLeaseSet(dependencies)`;
  - `collectTextureLeaseResourceIds(leaseSet)`;
  - `mergeTextureLeaseSets(...)` only if Phase 4 call sites prove it removes duplication.
- `createTextureLeaseSet(...)` should fail loudly on duplicate `resourceId` values unless the
  implementation discovers an existing legitimate duplicate case. Do not hide duplicate resource
  ownership inside the lease abstraction.
- Add `apps/holtburger-3d/src/lib/textures/leases.test.ts`.
- Add `TextureManager` APIs:
  - `pinTextureLeaseSet(leaseSet)`;
  - `releaseTextureLeaseResourceIds(resourceIds)`;
  - keep the current low-level resource-dependency methods private or test-only after the runtime
    cutover.

Expected code pressure:

- Low to moderate. Most of the existing lifetime behavior is already centralized in
  `TextureManager`.
- The only design trap is inventing parallel owner/resource fields. The dry-run answer is: do not.

### Phase 4 Dry Run

Likely implementation:

- Static install release currently has only removed `StaticResourceKey[]`, not dependencies. The
  cleanest cutover is likely a release helper based on resource ids, for example:

  ```ts
  textureManager.releaseTextureLeaseResourceIds(
    collectStaticDrawUnitResourceIds(delta.removedResources),
  );
  ```

  This means Phase 3 may need both a lease-set pin API and a resource-id release API. That is still
  not a second ownership graph; it reflects that eviction input is already a set of removed resource
  ids.
- Static install pin should become:

  ```ts
  textureManager.pinTextureLeaseSet(createTextureLeaseSet(delta.textureDependencies));
  ```

- Dynamic sync release already has `removedResourceIds`, so it should use the same resource-id
  release helper as static.
- Dynamic sync pin should become:

  ```ts
  textureManager.pinTextureLeaseSet(
    createTextureLeaseSet(resources.flatMap((resource) => resource.textureDependencies)),
  );
  ```

- The public low-level methods `pinTextureResourceDependencies(...)` and
  `releaseTextureResourceDependencies(...)` can either become private implementation helpers or be
  retained only if tests need to target the low-level manager behavior. Runtime code should stop
  calling them directly.

Expected code pressure:

- Low. The cutover is deliberately four call sites.
- Static timing diagnostics can keep the same behavior, but Phase 6 should revisit names if the
  lease cutover makes dependency wording actively misleading.

Do not do in Phase 4:

- Do not move texture lease construction into `static-commit-installer.ts`.
- Do not change renderer install DTOs.
- Do not use this phase to remodel `TextureManager.applyStaticCommitDelta(...)` or
  `applyDynamicTextureUseDelta(...)`.

### Phase 5 Dry Run

Expected assessment after Phases 1-4:

- Sidecar work should make static and dynamic worker results more isomorphic at the byte ownership
  boundary.
- Lease work should make static and dynamic runtime residency more isomorphic at the texture
  lifetime boundary.
- Neither change by itself proves that a single `VisualResourceBundle` envelope is honest.

Working answer for the install-product naming question:

- Do not introduce `VisualResourceBundle` in this plan before Phase 5 is actually reached.
- If Phase 5 extracts anything, prefer smaller component names first:
  - `TextureLeaseSet`;
  - `VisualGeometryTransfer` or protocol-local transfer collectors;
  - possibly `RendererVisualResourceProduct` only if static and dynamic renderer resources converge
    without optional-field soup.
- Treat `VisualResourceBundle` as retired for now. It can be revived only if Phase 5 proves one
  shared envelope reduces code more than shared components do.

Stop/go criteria at Phase 5:

- Stop this plan and hand off to a texture placement transaction remodel if sidecars and leases are
  complete and the remaining stutter bottleneck is still dominated by `placement-intents` main-thread
  preparation.
- Continue toward install-product extraction only if the static/dynamic install code now shows
  obvious duplication that can be deleted by extracting a small shared component.

## Phase 1: Binary Sidecar Ownership Convention

Goal: make typed-array ownership explicit for worker DTOs without adding a broad sidecar framework.

Status: complete.

Target shape:

```ts
interface BinarySidecarView<TView extends ArrayBufferView = ArrayBufferView> {
  /** Typed-array view carrying binary payload bytes. */
  readonly view: TView;
  /** Whether this DTO owns the bytes strongly enough to transfer the backing buffer. */
  readonly ownership: "owned-transferable" | "borrowed";
  /** Human-readable transfer label used in errors and diagnostics. */
  readonly label: string;
}
```

The exact naming may change during implementation. The important contract is ownership, not the
specific interface spelling.

Deliverables:

- Extend or colocate with `apps/holtburger-3d/src/lib/workers/transfers.ts`:
  - a helper that collects only `owned-transferable` sidecar views;
  - clear rejection errors for partial views, shared buffers, and accidentally borrowed views.
- Convert `apps/holtburger-3d/src/lib/textures/packing/transfers.ts` to use the new helper as the
  pilot protocol-local collector.
- Add tests covering:
  - full-buffer owned typed arrays transfer;
  - borrowed views are skipped or rejected according to the helper contract;
  - partial views remain rejected by default;
  - repeated views dedupe the backing buffer.
- Document the convention in code comments on the new exported type/helper.

Acceptance criteria:

- Worker protocols have a single blessed helper for transferable typed-array ownership.
- Existing `collectTexturePackingResultTransfers(...)` remains a protocol-local wrapper and delegates
  to the new ownership-aware helper.
- No cache-owned or prepared-asset-owned input buffer becomes transferable merely because it is large.
- No worker input protocol is migrated to transfer ownership in this phase.

Decisions and course corrections:

- Phase 0 selected texture packing result pages as the pilot because they are already
  worker-created, transferred, and covered by protocol-local tests.
- Implemented the shared ownership helper in `apps/holtburger-3d/src/lib/workers/transfers.ts`:
  - `BinarySidecarView`;
  - `collectTransferableBinarySidecars(...)`;
  - `addTransferableBinarySidecar(...)`.
- `collectTexturePackingResultTransfers(...)` remains protocol-local in
  `apps/holtburger-3d/src/lib/textures/packing/transfers.ts` and now delegates to the ownership-aware
  helper.
- Borrowed sidecars fail loudly when passed to the transferable collector. Phase 1 deliberately did
  not add a skip mode for borrowed views because the pilot collector should only pass owned result
  pages.
- No worker input protocols were migrated.

## Phase 2: Transfer Worker-Owned Geometry Outputs

Goal: apply the sidecar convention to the highest-value worker-created geometry outputs after the
ownership rules exist.

Status: complete.

Steered target order:

1. Add shared collector helpers for `VisualGeometryPayload` buffers:
   - `positions`;
   - `texCoords`;
   - `materialSlotIndices`;
   - `indices`.
2. Migrate dynamic visual bake output transfers:
   - `DynamicVisualBakeResult.product.resource.renderParts`.
3. Migrate static bake output transfers:
   - object-style static visual resources that use `VisualGeometryPayload`;
   - terrain draw units (`positions`, `texCoords`, `layerSlots`, `indices`);
   - static object and structured-interior draw units (`positions`, `texCoords`,
     `materialSlotIndices`, `indices`).

Non-targets for this phase:

- resolver inputs or prepared asset buffers read from caches;
- texture packing input source pixels that are borrowed from prepared material texture sources;
- static bake `StaticBakeJobInput.resources.*Geometry[].buffer` inputs;
- dynamic visual bake `DynamicVisualBakeInput.sourceGeometry` inputs;
- dynamic `product.resource.objectVisual?.geometryBuffers` source-local sidecars unless a later audit
  proves they are worker-owned copies;
- any partial typed-array views unless they are copied into full-buffer owned outputs first.

Deliverables:

- Add protocol-local transfer collectors:
  - likely `apps/holtburger-3d/src/lib/dynamic/visual-bake-transfers.ts`;
  - likely `apps/holtburger-3d/src/lib/static/bake/transfers.ts`;
  - shared visual geometry collector in
    `apps/holtburger-3d/src/lib/visual/visual-geometry-transfers.ts`.
- Wire `apps/holtburger-3d/src/lib/dynamic/visual-bake-worker-handler.ts` to return result transfers.
- Wire `apps/holtburger-3d/src/lib/static/bake/worker-handler.ts` to return result transfers while
  preserving progress/trace reporting.
- Keep transfer extraction out of renderer/runtime call sites.
- Add focused tests proving result buffers are transferred for each migrated worker family.

Acceptance criteria:

- Static and dynamic worker-created geometry outputs use the same binary ownership convention.
- Transfer lists are protocol-owned and discoverable with `rg "collect.*Transfers"`.
- No transfer collector knows about renderer install policy or texture lifetime.
- Static bake progress events still work after adding result transfer extraction.

Decisions and course corrections:

- Phase 0 rejected resolver and recipe worker outputs as first transfer targets because they mix
  source facts and prepared asset references rather than clean worker-owned render buffers.
- Implemented a shared visual geometry collector in
  `apps/holtburger-3d/src/lib/visual/visual-geometry-transfers.ts`.
- Implemented protocol-local collectors:
  - `apps/holtburger-3d/src/lib/dynamic/visual-bake-transfers.ts`;
  - `apps/holtburger-3d/src/lib/static/bake/transfers.ts`.
- Wired dynamic and static bake worker handlers to include result transfer lists.
- Static bake transfer extraction also includes `objectVisualInstallSet.renderInstances[].sourceToLandblockMatrix`.
  Phase 0 did not call this out, but it is a worker-created typed-array payload crossing the same
  result boundary.
- Static bake transfer extraction deliberately does not include `StaticPortalApertureResource`
  arrays because those are plain arrays rather than typed-array transfer candidates.
- Added a defensive unsupported-kind error in the static draw-unit transfer collector. The production
  type is exhaustive, but the focused test exposed that malformed fixtures otherwise fail with a
  vague iterable error.

## Phase 3: Texture Lease Set Primitive

Goal: turn the existing dependency pin/release behavior into an explicit lease-set boundary.

Status: complete.

Candidate shape:

```ts
interface TextureLeaseSet {
  /** Placement dependencies that must stay resident while their resources are installed. */
  readonly dependencies: readonly TextureResourceDependencies[];
}
```

This shape is intentionally small because `TextureResourceDependencies.resourceId` already carries
the release identity. Add separate removed-resource ids only if the runtime cutover proves they are
needed; do not introduce interdependent fields that can drift apart.

Deliverables:

- Add a texture-local lease-set type in `apps/holtburger-3d/src/lib/textures/leases.ts`.
- Add the smallest useful helpers, likely:
  - `createTextureLeaseSet(dependencies)`;
  - `EMPTY_TEXTURE_LEASE_SET`;
  - `collectTextureLeaseResourceIds(leaseSet)`.
- Add `TextureManager` APIs that pin lease sets and release by resource ids without broadening its
  ownership role.
- Keep existing low-level dependency maps private to `TextureManager`.
- Audit whether duplicate `TextureResourceDependencies.resourceId` values exist in current static or
  dynamic producers. If they do, fix or normalize the producer instead of teaching lease sets to hide
  ambiguity.

Acceptance criteria:

- Static and dynamic paths can express texture residency through the same lease-set vocabulary.
- Lease construction is deterministic and fails loudly if resource ids or dependencies disagree.
- Runtime release remains resource-id based where eviction inputs are already removed resource ids.
- Existing texture dependency behavior is preserved.

Decisions and course corrections:

- Phase 0 showed that `TextureResourceDependencies.resourceId` already carries the release identity,
  so this phase should not add a parallel `resourceIds` field unless implementation proves the need.
- Implemented lease-set vocabulary in `apps/holtburger-3d/src/lib/textures/leases.ts`:
  - `TextureLeaseSet`;
  - `EMPTY_TEXTURE_LEASE_SET`;
  - `createTextureLeaseSet(...)`;
  - `collectTextureLeaseResourceIds(...)`.
- `createTextureLeaseSet(...)` rejects duplicate `resourceId` values. That keeps producer ambiguity
  visible instead of allowing the lease abstraction to hide it.
- Added `TextureManager.pinTextureLeaseSet(...)` and
  `TextureManager.releaseTextureLeaseResourceIds(...)`.
- Kept the existing low-level `pinTextureResourceDependencies(...)` and
  `releaseTextureResourceDependencies(...)` methods for internal/test coverage during the cutover.
- Did not add `mergeTextureLeaseSets(...)`; Phase 4 call sites do not need it yet.

## Phase 4: Cut Runtime Install Paths Over To Lease Sets

Goal: make static and dynamic texture residency install/release mechanically comparable.

Status: complete.

Deliverables:

- Convert the two static commit install call sites in
  `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`:
  - release removed static resource dependencies through the new resource-id release helper;
  - pin `delta.textureDependencies` through lease-set vocabulary.
- Convert the two dynamic renderer resource sync call sites in `client-runtime.ts`:
  - release removed dynamic visual resource dependencies through the same resource-id release helper;
  - pin `resources.flatMap((resource) => resource.textureDependencies)` through lease-set
    vocabulary.
- Update `apps/holtburger-3d/src/lib/runtime/static-commit-installer.ts` and related tests only if
  install result shapes need to expose lease sets directly.
- Remove direct dependency pin/release calls from runtime code once the lease-set boundary owns them.

Acceptance criteria:

- Static and dynamic runtime install paths use the same texture residency vocabulary.
- `rg "pinTextureResourceDependencies|releaseTextureResourceDependencies" apps/holtburger-3d/src/lib --glob '!**/*.test.ts'`
  shows no runtime direct call sites outside `TextureManager` after cutover, unless a remaining
  compatibility call site has an explicit cleanup note.
- Renderer install behavior and texture placement update behavior remain unchanged.

Decisions and course corrections:

- Phase 0 found exactly four production direct runtime call sites; this phase should not expand into
  renderer install-product extraction.
- Converted the four runtime call sites in `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`:
  - static release uses `releaseTextureLeaseResourceIds(...)`;
  - static pin uses `pinTextureLeaseSet(createTextureLeaseSet(...))`;
  - dynamic release uses `releaseTextureLeaseResourceIds(...)`;
  - dynamic pin uses `pinTextureLeaseSet(createTextureLeaseSet(...))`.
- Production direct calls to `pinTextureResourceDependencies(...)` and
  `releaseTextureResourceDependencies(...)` now remain only inside `TextureManager`.
- Runtime static commit timing diagnostics kept their existing names. The test helper now strips
  timing details in exact diagnostic comparisons because these tests care about commit phase and
  residency behavior, not sub-millisecond timing values.
- Did not move lease construction into `static-commit-installer.ts` and did not change renderer
  install DTOs.

## Phase 5: Resteer Before Visual Install Product Extraction

Goal: reassess whether a shared visual install product is real after sidecars and leases are explicit.

Status: complete.

Questions to answer:

- Which static and dynamic install DTO fields are now genuinely shared?
- Which fields are provenance-specific and should remain separate?
- Are scene/query records part of the renderer install product, or should they remain a runtime
  publication concern?
- Does the shared shape want to be one envelope, or smaller shared components such as geometry
  resource products, instance products, and texture lease sets?
- Did sidecar and lease cutovers reduce complexity, or did they reveal a different first bottleneck?
- Did the four-call-site lease cutover make static and dynamic install flows read more similarly, or
  is their similarity still mostly superficial?

Acceptance criteria:

- This plan is updated with a decision before any broad `VisualResourceBundle`-style type is added.
- The decision explicitly preserves or rejects the term `VisualResourceBundle`.
- If the shared shape is rejected, the plan records the smaller shared parts that should be
  extracted instead.
- If the next bottleneck is clearly texture placement transaction structure, this plan may stop here
  and hand off to a texture placement remodel plan.

Decisions and course corrections:

- Phase 0 strengthened this gate. Static and dynamic install products share ingredients, but they do
  not yet prove that one shared envelope is the simplest model.
- Phases 1 and 2 made worker-created byte ownership isomorphic at the transfer boundary. Texture
  packing pages, static bake geometry outputs, and dynamic visual bake geometry outputs now describe
  owned typed-array sidecars through protocol-local collectors.
- Phases 3 and 4 made texture residency isomorphic at the runtime boundary. Static layer installs
  and dynamic visual resource syncs now pin through `TextureLeaseSet` and release by resource id.
- The shared similarity is component-level, not envelope-level. Static install still means layer
  replacement plus static scene/query publication. Dynamic install still means visual resource
  refresh plus entity instance/resource commits.
- Scene/query records should remain runtime publication concerns. They are not part of a renderer
  install product unless a future renderer boundary proves it owns those records directly.
- Reject `VisualResourceBundle` for this plan. A broad bundle would either hide provenance-specific
  facts behind optional fields or preserve the current split under a more impressive name.
- Preserve these smaller shared parts instead:
  - `TextureLeaseSet` for texture residency lifetime;
  - protocol-local transfer collectors for worker-owned binary outputs;
  - shared `VisualGeometryPayload` transfer collection for renderer geometry bytes.
- Defer any `RendererVisualResourceProduct` extraction until static and dynamic renderer resource
  shapes converge without optional-field soup.
- Stop before install-product extraction. Promote a scoped cleanup phase first, then hand off to a
  texture placement transaction remodel that separates off-thread/source preparation from the small
  ordered main-thread placement commit.
- The lease cutover intentionally hides owner bookkeeping from `TextureManager`. The manager still
  owns residency pin/release mechanics, but it no longer needs runtime/static/dynamic owner concepts
  to be passed through the public install paths.
- Temporary stutter diagnostics remain disposable. Prefer deleting obsolete probes when convenient
  instead of bending the new boundary types around them.

## Phase 6: Boundary Cleanup Before Texture Placement Remodel

Goal: delete or clarify residue from the sidecar/lease cutover before starting the texture placement
transaction remodel.

Status: complete.

Scope:

- Delete obsolete temporary diagnostics from the stutter investigation when they describe old
  pipeline internals rather than durable sidecar, lease, worker, or transaction concepts.
- Rename or update diagnostics labels only when the current wording now actively misleads.
- Prefer making low-level `TextureManager` dependency methods private if focused tests can still
  cover the behavior through lease APIs.
- If low-level methods must remain reachable for implementation or tests, add an explicit cleanup
  note or doc comment explaining that runtime code should use lease-facing APIs.
- Delete compatibility helpers, dead aliases, and tests that only preserve pre-sidecar or pre-lease
  paths.

Non-goals:

- Do not remodel texture placement.
- Do not extract renderer install products.
- Do not add new diagnostics unless deleting old diagnostics would otherwise leave no way to verify
  an active investigation question.
- Do not preserve temporary probes just because tests or snapshots happen to mention them.

Acceptance criteria:

- `rg "pinTextureResourceDependencies|releaseTextureResourceDependencies" apps/holtburger-3d/src/lib --glob '!**/*.test.ts'`
  shows no production runtime call sites outside the texture manager implementation.
- `rg "VisualResourceBundle" apps/holtburger-3d/src docs/plans` shows no production type adoption
  and only historical/plan discussion.
- Temporary investigation diagnostics are deleted, or the plan records why a remaining diagnostic is
  durable.
- Runtime-facing texture residency code continues to use `TextureLeaseSet` and resource-id release
  vocabulary.
- Focused touched tests and `npm run check` pass.
- This plan records what was deleted, what was retained, and why.

Decisions and course corrections:

- Promoted immediately after Phase 5 because the cleanup is useful before the texture placement
  transaction remodel and should remain scoped to subtraction or sharper boundaries.
- The cleanup bar is deletion or clarity. Diagnostics should not drive the next design.
- Renamed static commit timing fields from dependency wording to lease wording:
  - `pinTextureLeasesMs`;
  - `releaseTextureLeasesMs`.
- Made `TextureManager` dependency pin/release mechanics private implementation details:
  - `#pinTextureResourceDependencies(...)`;
  - `#releaseTextureResourceDependencies(...)`.
- Updated texture manager tests to exercise the public lease API instead of preserving direct
  dependency-method access.
- `lint:dead` exposed two public-surface leftovers from earlier phases. Removed the unused
  `collectVisualGeometryPayloadTransfers(...)` export and collapsed `BinaryTransferOwnership` into
  the exported `BinarySidecarView.ownership` field.
- Retained texture mutation queue diagnostics as durable rather than temporary. They measure the
  next known bottleneck: cross-kind queue wait, mutation run time, placement-intent volume, and
  phase timing inside the serialized texture transaction path.
- Did not delete the stutter investigation worksheet. It is historical evidence and still documents
  the benchmark and bottleneck attribution.

## Phase 7: Renderer Texture Binding Readiness Primitive

Goal: make renderer-facing texture binding readiness explicit so renderer resources can be installed
without pretending every required texture is physically resident immediately.

Status: planned.

Target shape:

```ts
type RendererTextureBindingState =
  | {
      readonly kind: "pending";
      readonly bindingId: TextureBindingId;
    }
  | {
      readonly kind: "resident";
      readonly bindingId: TextureBindingId;
      readonly placement: ResolvedTexturePlacement;
    }
  | {
      readonly kind: "failed";
      readonly bindingId: TextureBindingId;
      readonly reason: string;
    };
```

The exact naming may change during implementation. The important contract is readiness, not
placeholder rendering.

Deliverables:

- Add a WebGL2-local texture binding table module, likely
  `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-texture-bindings.ts`.
- Move the current renderer texture maps behind a readiness-aware table:
  - `textureRefId -> WebGLTexture` remains the renderer-owned GPU texture mirror;
  - `TextureBindingId -> RendererTextureBindingState` replaces raw
    `TextureBindingId -> ResolvedTexturePlacement` access.
- Keep the first table intentionally boring:

  ```ts
  interface ResidentRendererTextureBinding {
    readonly bindingId: TextureBindingId;
    readonly placement: ResolvedTexturePlacement;
    readonly texture: WebGLTexture;
  }

  interface RendererTextureBindingTable {
    getState(bindingId: TextureBindingId): RendererTextureBindingState;
    getResident(bindingId: TextureBindingId): ResidentRendererTextureBinding | null;
  }
  ```

- Adapt `Webgl2Renderer.applyTexturePlacementUpdate(...)` to update the table while preserving WebGL
  texture creation/deletion ownership in the renderer.
- Treat unknown required bindings as `pending` at lookup time unless an explicit `failed` state has
  been recorded. This preserves current behavior while making readiness inspectable.
- Add explicit `markFailed(bindingId, reason)` or equivalent only if the implementation can keep it
  renderer-local and testable without inventing the future texture ingestion service.
- Update object-material and terrain payload preparation to consume resident bindings through the
  table API instead of parallel raw placement and texture maps.
- Keep prepared payload invalidation conservative unless the implementation naturally exposes a
  smaller affected-binding set.
- Add focused renderer tests proving resident, pending, and failed binding behavior.

Non-goals:

- Do not add fallback/checkerboard rendering.
- Do not make renderer binding state authoritative for texture residency lifetime.
- Do not add the texture ingestion service yet.
- Do not attempt precise dirtying by reverse binding ownership unless it falls out naturally. The
  current conservative invalidation is acceptable for this primitive.
- Do not require every layer/resource install call to pre-register pending bindings in the first
  pass. Missing required bindings can be interpreted as pending until the texture service exists.

Acceptance criteria:

- Draw units or renderer resources that require pending texture bindings are skipped/not prepared,
  not rendered with placeholder textures.
- Resident bindings preserve current rendering behavior.
- Failed bindings are skipped and produce diagnostics or inspectable state.
- Texture placement updates transition bindings to resident and dirty affected prepared payloads at
  least as safely as the current conservative invalidation.
- Renderer texture lifetime remains a GPU mirror only. Texture residency ownership stays in the
  texture service/manager and lease model.
- No broad pipeline remodel, texture placement transaction rewrite, or install-product extraction is
  included in this phase.
- Focused WebGL2 renderer/payload tests, `npm run check`, and `npm run lint:dead` pass.

Decisions and course corrections:

- Planned after Phase 6 because the larger pipeline redesign needs a renderer boundary that can
  represent non-resident required bindings without installing fake fallback textures.
- The primitive should formalize behavior the renderer already has implicitly: resources with missing
  required bindings are not renderable yet.
- This phase should not introduce a new texture lifetime owner. Renderer binding state is derived
  from committed texture placement updates and WebGL texture residency.
- Implementation should be moderate but localized. The renderer currently passes `#texturePlacements`
  and `#textures` into exactly the payload-preparation seams Phase 7 needs.
- Existing object-material payload tests already prove resident and missing-required behavior. Migrate
  them to the table API instead of duplicating coverage.
- Existing terrain payload tests already prove missing required bindings make terrain payload
  preparation return `false`. Use them as the primary pending-binding coverage.
- Existing WebGL2 renderer tests already cover invalidation after `applyTexturePlacementUpdate(...)`.
  Add only targeted coverage for table transitions and renderer invalidation.

Open implementation questions for Phase 7:

- Should failed binding state be public diagnostic state immediately, or should the first cut only
  model it in the table API until the texture service can produce real failures?
- Should the readiness table expose aggregate diagnostics, such as resident/pending/failed counts,
  or should that wait until the texture ingestion service exists?

## Phase 8: Extract The Smallest Honest Install Product Shape

Goal: remove static/dynamic install duplication only where the real post-lease model supports it.

Status: deferred by Phase 5, Phase 6, and Phase 7.

Possible outcomes:

- A small shared install interface, only if Phase 5 proves it pays for itself:

  ```ts
  interface VisualInstallProduct {
    readonly ownerId: string;
    readonly textureLeaseSet: TextureLeaseSet;
  }
  ```

- Shared component types but no shared envelope:
  - `RendererGeometryResourceProduct`;
  - `RendererInstanceProduct`;
  - `TextureLeaseSet`;
  - static-specific layer publication records;
  - dynamic-specific entity instance commits.

- No extraction yet, if the audit shows the similarity is still superficial.

Deliverables:

- Extract only the shared install product or component types approved by Phase 5.
- Keep static layer replacement semantics and dynamic resource refresh semantics explicit.
- Update tests to assert the new install boundary rather than old path-specific bookkeeping.
- Delete any compatibility wrappers that only preserve old DTO names.

Acceptance criteria:

- Static and dynamic code read as isomorphic where they truly are.
- The final shape does not flatten provenance-specific facts into optional fields.
- There is a measurable reduction in duplicated install/lifetime code or a documented reason the
  extraction was deferred.
- Static layer replacement and dynamic resource refresh remain explicit in type names or call sites.

Decisions and course corrections:

- If the shared shape requires many optional fields for static-only or dynamic-only facts, reject the
  shared envelope and extract smaller components instead.
- Phase 5 rejected a broad install-product envelope for this plan. Future work should revisit only a
  smaller renderer-resource product, and only if it deletes real static/dynamic duplication without
  flattening layer replacement, scene publication, or dynamic resource refresh semantics.

## Phase 9: Final Cleanup And Measurement

Goal: remove migration debris and verify the primitives improved clarity.

Status: deferred until after any future extraction or texture placement remodel that uses these
primitives.

Deliverables:

- Delete obsolete temporary diagnostics from the stutter investigation when they no longer describe
  the cleaned-up boundary model.
- Delete old compatibility helpers, dead DTO aliases, and tests that preserve removed architecture.
- Update related plan docs with final status and any follow-up pipeline-remodel recommendations.
- Run focused checks for the touched app code.

Acceptance criteria:

- `npm run check` passes in `apps/holtburger-3d`.
- Focused worker, texture, static, dynamic, and runtime tests pass for touched modules.
- New primitive names appear at domain boundaries; old direct lifecycle and transfer conventions do
  not remain as parallel production paths.
- The implementation reduces cognitive complexity by collapsing at least one static/dynamic special
  case or deleting an equivalent amount of bespoke transfer/lifetime code.

Decisions and course corrections:

- Replaced by the scoped Phase 6 cleanup for immediate residue. Keep this final cleanup phase for
  later work that actually extracts or remodels pipeline code.

## Risks And Mitigations

- **Risk: the binary sidecar abstraction becomes ceremony.**
  - Mitigation: keep it as a small ownership convention plus transfer collector helpers. Do not add a
    registry, metadata graph, or runtime sidecar manager.

- **Risk: borrowed buffers are transferred and detached.**
  - Mitigation: require explicit `owned-transferable` ownership and keep partial/buffer-sharing
    rejection as the default. Inputs from caches or prepared assets remain borrowed unless copied.

- **Risk: lease sets grow into a second ownership graph.**
  - Mitigation: keep the first shape as a compact wrapper over `TextureResourceDependencies[]`.
    `TextureResourceDependencies.resourceId` already carries the release key; add separate owner
    fields only if implementation proves they are necessary.

- **Risk: the visual install product erases important static/dynamic differences.**
  - Mitigation: make Phase 5 a required resteer gate. Extract smaller shared components if a shared
    envelope is too broad.

- **Risk: this plan delays the texture placement bottleneck fix.**
  - Mitigation: keep phases small and only standardize primitives that directly support moving
    texture/visual materialization off the main thread. Stop after leases if the next best move is
    the texture placement transaction remodel.

- **Risk: diagnostics preserve obsolete internals.**
  - Mitigation: prefer deleting temporary diagnostics over maintaining compatibility. Rebuild durable
    diagnostics from the new sidecar, lease, and install-product concepts if needed.

- **Risk: pending texture bindings become placeholder rendering.**
  - Mitigation: pending and failed bindings should make affected draw units/resources not renderable.
    Do not introduce fallback textures in the binding readiness primitive.

- **Risk: renderer binding state becomes a second residency owner.**
  - Mitigation: renderer binding state is a derived GPU/cache mirror of committed texture placement
    updates. Texture lifetime remains owned by the texture service/manager and `TextureLeaseSet`.

## Definition Of Done

- Binary typed-array ownership is explicit for migrated worker DTOs.
- Worker-created texture and geometry outputs have protocol-local transfer collectors.
- Static and dynamic texture residency use a shared lease-set vocabulary.
- Renderer texture binding readiness is explicit, and pending required bindings skip affected draw
  units/resources instead of rendering placeholders.
- The codebase either has a small honest shared install product/component shape or a documented
  decision to defer extraction.
- Obsolete direct transfer/lifetime compatibility paths are removed or have explicit cleanup notes.
  Existing low-level `TextureManager` dependency methods remain as implementation/test coverage
  behind the lease-facing runtime boundary.
- The implementation preserves current rendering behavior.
- App checks and focused tests pass.
- This plan records final decisions, course corrections, and remaining follow-up work.

## Open Questions

None before Phase 1.

Closed during the dry run:

- Lease sets should live in a new texture lifetime module, likely
  `apps/holtburger-3d/src/lib/textures/leases.ts`, not in `placement.ts` or runtime install code.
- `VisualResourceBundle` should be treated as retired for this plan unless Phase 5 proves that one
  shared envelope is clearer than smaller shared components.

Closed during Phase 5:

- `VisualResourceBundle` is rejected for this plan.
- Pinning is explicit residency behavior, but owner identity is intentionally hidden from
  `TextureManager` behind lease sets and resource-id releases.
- The next architecture effort should be a texture placement transaction remodel, not a renderer
  install-product extraction.

Closed during Phase 7 planning:

- Renderer texture binding readiness should be added as a primitive before the broader texture
  placement transaction remodel.
- Pending required texture bindings should skip affected draw units/resources, not render fallback
  textures.
- Renderer texture binding state is a derived cache/readiness table. It must not own authoritative
  texture residency lifetime.
