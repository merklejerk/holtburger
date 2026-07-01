# Holtburger 3D Simplified Texture Packing Pipeline Implementation Plan

Status: implementation plan draft.

## Purpose

Explore a simpler frontend render-resource pipeline for `apps/holtburger-3d` where texture packing
happens before baking, bakers produce renderer-legal immutable draw units, and the main thread stops
performing baker-like draw-unit refinement after texture placement.

The north star is reduced complexity. The preferred design should accept more draw units and draw
calls if that lets the pipeline use simpler contracts, simpler shaders, simpler atlas constraints,
and fewer post-bake correction passes.

## North Stars

1. Reduce pipeline complexity, even at the cost of more draw units.

   The preferred design should trade clever batching for simpler contracts unless measurements prove
   the extra draw pressure is unacceptable.

2. Keep each stage dumb in the right way.

   The resolver discovers source facts and texture needs. `TextureManager` plans CPU-side atlas
   placement by calling the packer for page/rect decisions. The baker owns draw-unit construction.
   The runtime owns residency, entity lifecycle, and renderer commits. The renderer uploads and
   draws already-legal resources.

   Complexity is acceptable inside resolver and baker workers when it is contained there. Prefer
   moving source interpretation, material-family legality, and draw-unit partitioning into those
   worker-owned modules over adding runtime orchestration branches, texture-manager policy, or packer
   domain knowledge.

3. Prefer isomorphic shared code paths.

   Terrain, static objects, static-authored dynamics, and runtime-authored dynamics should flow
   through the same resolver -> `TextureManager` placement -> baker -> runtime install -> eviction
   machinery wherever practical. Differences such as terrain page limits or object material-family
   rules should be expressed as baker-owned legality policy, not as separate orchestration branches
   or parallel texture-management paths.

4. Make bakers the only draw-unit authors.

   Resolvers must not establish draw units, and the main thread must not perform baker-like geometry
   splitting after packing. Draw-unit legality should be constructed in worker-side bake products.

5. Keep the packer domain-agnostic.

   The packer may understand pool, purpose, dimensions, format, and opaque affinity hints. It must
   not understand landblocks, objects, materials, draw units, appearances, renderer policy, or active
   draw-unit legality.

6. Prefer the simplest legal page contract per material family.

   Object draw units should depend on at most one page for each relevant role. Terrain draw units
   should use the existing terrain shader limits: up to four color pages, up to four mask pages, and
   one detail page. In both cases, the baker owns legality and the packer only places texture items.

7. Active draw units are immutable until eviction.

   Repacking must not move active placements. It may reclaim zombie placements from evicted
   resources, but it must not force active draw units to rebake.

8. Treat placement-before-bake as guarded continuations, not a separate orchestration mode.

   Source resolution should produce a continuation-shaped source-ready value: source payloads,
   texture placement intents, and a guarded bake continuation. Runtime placement supplies a
   `TexturePlacementSnapshot` and invokes that continuation. The guard rejects work that is no longer
   demanded, cancelled work, failed placement, duplicate invocation, or disposal. Do not model normal
   work as replaceable by a newer revision; static authored source should be immutable for a task
   identity, and runtime authored dynamics should create distinct work identities. This is one async
   pipeline, not a durable side queue of half-finished work.

9. Draw-unit eviction is not texture-packer policy.

   Static retention, dynamic lifetime, and renderer residency decide when resources disappear. The
   texture manager may observe zero-reference atlas placements and reclaim them, but it must not
   decide what should be evicted.

10. Defer naming cleanup when it would block structural cleanup.

`textureUseId` is suspect, but it can remain as a migration-era item ID while the resolver ->
packer -> baker boundary is corrected. Rename or split it after the new flow reveals what identity
concepts are still real.

11. Diagnostics are useful only if they survive honestly.

Keep diagnostics that still describe meaningful runtime behavior. Delete diagnostics that only
preserve obsolete pipeline internals or create churn disproportionate to their value.

12. Cut over cleanly and delete vestigial code.

The eventual implementation should replace the old pipeline rather than preserving a durable
parallel path. Temporary adapters are acceptable only when they have an explicit removal target.
Once the simplified path owns a responsibility, remove the old owner instead of leaving legacy
shims, fallback paths, or obsolete tests behind.

## Current Verified Facts

Current code paths that matter:

- `apps/holtburger-3d/src/lib/browser/create-browser-runtime.ts`
  - wires static resolver, static baker, dynamic visual recipe, dynamic visual bake, and texture
    packing worker pools in normal Tauri/browser runtime.
- `apps/holtburger-3d/src/lib/static/coordinator/static-coordinator.ts`
  - owns static demand reconciliation, source resolution, static bake batching, and static prep
    commits.
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
  - owns static materialization, texture placement application, dynamic resource sync, renderer
    layer installation, and runtime dynamic spawn prep.
- `apps/holtburger-3d/src/lib/runtime/static-materializer.ts`
  - currently fine-splits static object draw units after texture packing.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`
  - stores texture pages by `textureRefId` and texture bindings by owner key.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.ts`
  - resolves material entries through owner-scoped texture bindings into per-draw uniforms and
    WebGL texture handles.
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
  - currently translates static/dynamic texture uses into texture placement updates and binding
    tables.

Renderer facts:

- Object draw resources already use stable texture usage handles in material entries.
- Texture placement updates can update bindings without rebuilding geometry when an existing draw
  resource still satisfies its page constraints.
- Binding updates are owner-granular where possible. Texture page creation/removal currently dirties
  all prepared object/terrain payloads because the renderer does not keep a reverse texture-ref owner
  index.
- The current object renderer uses one monolithic object-material shader for `flat-color`,
  `texture-rgba`, and `indexed-paletted` families. It selects behavior with `uMaterialModes`.
- Current object draw limits are:
  - 8 material entries per draw.
  - 4 base-color pages per draw.
  - 4 index pages per draw.
  - 4 palette pages per draw.
  - 4 detail pages per draw.
- The current main-thread static materializer exists because baked draw units may exceed those
  per-draw page limits after texture packing assigns pages.

Terrain renderer facts:

- The current terrain renderer has terrain-specific shader limits:
  - 8 layered terrain entries per draw.
  - 3 overlays per layer.
  - 2 roads per layer.
  - 4 color pages per draw.
  - 4 mask pages per draw.
  - 1 detail page per draw.
- Current terrain baking already slices by layer count before renderer binding, but it does not slice
  by final packed color/mask/detail page assignment.
- Terrain role-page overflow is currently detected during texture binding preparation. If layered
  terrain cannot be fully satisfied after packing, the renderer falls back to `terrain-debug-flat`.

## Scoping Thesis

The current architecture is too clever at the wrong boundary:

```text
resolver worker
  -> static baker worker creates candidate draw units
  -> texture packer worker assigns pages
  -> main thread fine-splits candidate draw units into renderer-legal draw units
  -> renderer installs layers
```

The proposed architecture makes CPU-side atlas placement precede draw-unit construction:

```text
resolver worker
  -> source payload + texture placement intents
  -> texture packer worker assigns pages
  -> baker worker creates renderer-legal immutable draw units from known assignments
  -> main thread installs layers/resources
```

The simplifying concession for object material families is one page per relevant texture role per
draw unit.

For object material families:

```text
flat-color draw unit
  no texture pages

texture-rgba draw unit
  <= 1 base-color page
  <= 1 detail page

indexed-paletted draw unit
  <= 1 index page
  <= 1 palette page
  <= 1 detail page
```

This likely increases draw-unit count, but it removes the need for multi-page object role bindings
inside a single draw unit and lets repack avoid active draw-unit legality entirely by pinning active
placements.

Terrain participates in the same topology, but not the exact object rule:

```text
terrain-debug-flat draw unit
  no texture pages

terrain-single-base-color draw unit
  <= 1 terrain color page
  optional <= 1 terrain detail page

terrain-layered draw unit
  <= 8 layer entries
  <= 3 overlays per layer
  <= 2 roads per layer
  <= 4 terrain color pages
  <= 4 terrain mask pages
  <= 1 terrain detail page
```

The terrain baker, not the packer, owns these terrain legality rules. The packer still only receives
placement items, pool/purpose, and affinity hints.

## Boundaries

In scope for this plan:

- Naming and contract shapes for a texture-before-bake pipeline.
- Explicit main-thread versus worker responsibilities.
- Static-authored and runtime-authored dynamic texture/resource alignment.
- Draw-unit immutability and texture reclaim/repack boundaries.
- How to keep the packer unaware of landblocks, draw units, materials, objects, and renderer
  semantics beyond opaque grouping hints.
- Phased implementation, including clean cutover and vestige removal.
- First-class terrain support in the same texture-before-bake model, with terrain-specific baker
  legality rules.
- Object shader-family specialization after the texture-before-bake path is established.

Out of scope for this plan:

- Performance targets beyond the complexity/performance tradeoff statement.
- Immediate deletion or renaming of `textureUseId`.
- Moving draw-unit eviction policy into texture packing.
- Allowing texture repack to invalidate or force rebake of active draw units.

## Vocabulary

Phase 0 locks these as first-pass implementation names. Later phases may rename only when real code
proves a name is dishonest, not because the contract is still fuzzy.

The canonical home for the new placement vocabulary is
`apps/holtburger-3d/src/lib/textures/placement.ts`. `TextureManager` remains the planning boundary
that consumes placement intents and produces placement snapshots. Static, dynamic, baker, and
renderer modules may import these contracts, but they must not duplicate or fork the placement
vocabulary.

### Source Payload

Decoded, renderer-independent source facts needed by bakers.

Examples:

- terrain source facts;
- outdoor static object placements and source object facts;
- env-cell system source facts;
- setup-backed dynamic visual source facts.

The resolver may discover source texture needs, but it should not create draw units.

### Texture Placement Intent

A request for `TextureManager` to place one opaque texture item into an atlas page. This is CPU-side
placement planning, not GPU/WebGL resource allocation.

The caller may continue using current `textureUseId` values as item IDs during migration, but the
packer contract should not know or care what a `textureUseId` means.

Locked first-pass shape:

```ts
type TextureUsagePurpose =
  | "object-base-color"
  | "object-detail"
  | "object-index"
  | "object-palette"
  | "terrain-color"
  | "terrain-mask"
  | "terrain-detail";

interface TexturePlacementIntent {
  readonly itemId: string;
  readonly purpose: TextureUsagePurpose;
  readonly pool: TexturePlacementPool;
  readonly affinityKey: string | null;
  readonly source: TexturePlacementSource;
}
```

Notes:

- `itemId` is an opaque placement item ID. It may initially be the current `textureUseId`.
- `purpose` selects page compatibility and shader role.
- `pool` selects atlas compatibility, page policy, and expected churn.
- `affinityKey` is an opaque clustering hint. It may correlate to setup model, appearance, GFX
  object, terrain material, landblock, or another caller-owned identity, but the packer must not
  interpret it.
- If `affinityKey` starts becoming an encoded diary of domain facts, reassess the contract instead
  of continuing to pack more meaning into one string.
- `source` identifies bytes or prepared texture source. Its exact shape can reuse current prepared
  texture contracts initially.

### Texture Placement Pool

A `TextureManager` placement pool with compatible atlas policy, shader purpose, and churn
expectations.

Locked first-pass shape:

```ts
type TexturePlacementPool =
  | "terrain"
  | "static-authored-object"
  | "runtime-authored-object";
```

Notes:

- Terrain is always static-authored, but it gets a separate pool because terrain color/mask/detail
  pages have terrain-specific atlas policy and shader constraints.
- Static-authored object textures and runtime-authored object textures share placement machinery
  without sharing one high-churn atlas pool.
- The pool is not a domain object. It is a `TextureManager` grouping key used before invoking the
  packer.
- A separate transient pool is not part of the current thesis. Add one only if a concrete runtime use
  case proves that these pools are too coarse.

### Texture Placement

The packer's result for one item.

Locked first-pass shape:

```ts
interface TexturePlacement {
  readonly itemId: string;
  readonly purpose: TextureUsagePurpose;
  readonly pool: TexturePlacementPool;
  readonly pageId: string;
  readonly rect: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
}
```

### Texture Placement Snapshot

The compact baker input produced by `TextureManager` after placing a batch of intents.

Locked first-pass shape:

```ts
interface TexturePlacementSnapshot {
  readonly placementsByItemId: ReadonlyMap<string, TexturePlacement>;
}
```

Notes:

- The snapshot is keyed by opaque `itemId` so bakers can reason about page legality without knowing
  `TextureManager` internals.
- The snapshot should not include renderer `WebGLTexture` handles or owner/lease state.
- Terrain, object, and dynamic bakers should consume the same snapshot shape.

### Draw Unit Texture Dependencies

The baker-owned record of placement items that an immutable draw unit depends on. `TextureManager`
uses these dependencies to retain active placements. The packer does not consume this type.

Locked first-pass shape:

```ts
interface DrawUnitTextureDependencies {
  readonly drawUnitId: string;
  readonly roles: readonly DrawUnitTextureRoleDependency[];
}

interface DrawUnitTextureRoleDependency {
  readonly purpose: TextureUsagePurpose;
  readonly itemIds: readonly string[];
}
```

Active dependencies pin their placements. Repack may reclaim placements after dependencies are
released, but it must not move active placements.

### Contract Homes

- `apps/holtburger-3d/src/lib/textures/placement.ts`
  - Owns `TextureUsagePurpose`, `TexturePlacementPool`, `TexturePlacementIntent`,
    `TexturePlacement`, `TexturePlacementSnapshot`, `DrawUnitTextureDependencies`, and supporting
    placement-source/helper types introduced in Phase 1.
  - Owns generic adapter helpers only when they are texture-domain concepts rather than static,
    dynamic, or renderer policy.
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
  - Owns placement planning, placement state, active reference counts, zombie detection, and
    calls into the texture packer.
  - Consumes placement intents and produces placement snapshots.
- `apps/holtburger-3d/src/lib/textures/packing/protocol.ts`
  - Remains the packer worker protocol for pixel sources, pages, and rects.
  - Must not learn about draw units, landblocks, materials, dynamics, or renderer ownership.
- `apps/holtburger-3d/src/lib/static/contracts.ts`
  - May reference placement snapshots and draw-unit dependencies in static bake inputs/results.
  - Must not own the canonical placement contracts.
- `apps/holtburger-3d/src/lib/dynamic/contracts.ts`
  - May reference placement intents, snapshots, and dependencies for dynamic recipe/bake contracts.
  - Must not define a parallel runtime-only placement vocabulary.
- `apps/holtburger-3d/src/lib/renderer/types.ts`
  - Remains the GPU upload, texture binding, and draw submission contract home.
  - Must not own pre-bake placement planning contracts.

### Rejected Phase 0 Shapes

- No generic `static-authored` pool. Terrain starts in its own `terrain` pool; object textures start
  in `static-authored-object` or `runtime-authored-object`.
- No `revision` field on `TexturePlacementSnapshot`. Currentness belongs to guarded continuations
  and task demand checks, not to placement snapshots.
- No public `resumeToken`/supersession contract for source-ready continuation work.
- No public split between static and dynamic placement snapshot types.
- Do not rename `textureUseId` in Phase 1. Use current `textureUseId` values as opaque `itemId`s
  until the larger pipeline exposes what identity concepts remain real.

## Proposed Static Sequence

```mermaid
sequenceDiagram
  participant Main as Main thread runtime
  participant Coord as StaticCoordinator
  participant Resolver as Static resolver worker
  participant Packer as Texture packing worker
  participant Baker as Static bake worker
  participant Renderer as Renderer

  Main->>Coord: scene interest -> StaticDemand
  Coord->>Coord: plan retained owners and source requests
  Coord->>Resolver: resolve source request
  Resolver->>Resolver: decode source payloads
  Resolver->>Resolver: discover texture placement intents
  Resolver-->>Coord: source payloads + intents
  Coord-->>Main: source payloads + intents
  Main->>Main: merge intents with TextureManager placement state
  Main->>Packer: pack unplaced items by pool/purpose/affinity
  Packer->>Packer: preserve active placements; use free/zombie space only
  Packer-->>Main: placements + page images
  Main->>Baker: bake source payloads with placement snapshot
  Baker->>Baker: create renderer-legal immutable draw units
  Baker->>Baker: enforce material-family page legality
  Baker-->>Main: static prep product + texture dependencies
  Main->>Renderer: apply texture page update
  Main->>Renderer: install static layers/resources
  Main->>Main: register active texture dependencies
  Main->>Coord: mark static commit materialized
```

Main-thread work should be orchestration and installation. It should not copy/filter geometry to make
draw units renderer-legal after packing.

## Proposed Terrain Static Sequence

Terrain uses the same static topology as objects, but the terrain baker applies terrain-specific
shader constraints from the placement snapshot.

```mermaid
sequenceDiagram
  participant Main as Main thread runtime
  participant Coord as StaticCoordinator
  participant Resolver as Static resolver worker
  participant Packer as Texture packing worker
  participant Baker as Terrain bake worker
  participant Renderer as Renderer

  Main->>Coord: terrain scene interest -> StaticDemand
  Coord->>Resolver: resolve terrain source request
  Resolver->>Resolver: decode landblock terrain source facts
  Resolver->>Resolver: discover terrain-color/mask/detail placement intents
  Resolver-->>Coord: terrain source payload + intents
  Coord-->>Main: terrain source payload + intents
  Main->>Packer: pack terrain items by pool/purpose/affinity
  Packer->>Packer: preserve active placements; use free/zombie space only
  Packer-->>Main: placements + terrain page updates
  Main->>Baker: bake terrain with placement snapshot
  Baker->>Baker: build layer plans from source facts
  Baker->>Baker: split by terrain shader limits
  Baker->>Baker: emit draw units legal for color/mask/detail pages
  Baker-->>Main: terrain prep product + texture dependencies
  Main->>Renderer: apply texture page update
  Main->>Renderer: install terrain resources
  Main->>Main: register active terrain texture dependencies
  Main->>Coord: mark terrain commit materialized
```

Terrain legality is a baker concern:

```text
terrain-layered candidate slice is legal when:
  layer entries <= 8
  overlays per layer <= 3
  roads per layer <= 2
  unique terrain-color pages <= 4
  unique terrain-mask pages <= 4
  unique terrain-detail pages <= 1
```

The packer receives none of those terrain concepts. It only receives placement intents for currently
packable items; active placements are pinned by `TextureManager`.

## Proposed Runtime-Authored Dynamic Sequence

```mermaid
sequenceDiagram
  participant Main as Main thread runtime
  participant Controller as DynamicEntityController
  participant Recipe as Dynamic recipe worker
  participant Packer as Texture packing worker
  participant Baker as Dynamic visual bake worker
  participant Renderer as Renderer

  Main->>Controller: create runtime spawn entity record
  Main->>Recipe: resolve setup-backed dynamic recipe
  Recipe->>Recipe: discover dynamic source recipe and texture intents
  Recipe-->>Main: dynamic source recipe + texture placement intents
  Main->>Main: merge intents with TextureManager placement state
  Main->>Packer: pack unplaced runtime-authored items
  Packer->>Packer: preserve active placements; use free/zombie space only
  Packer-->>Main: placements + page updates
  Main->>Baker: bake dynamic visual with placement snapshot
  Baker->>Baker: create renderer-legal visual parts
  Baker->>Baker: enforce object visual one-page-per-role rule
  Baker-->>Main: dynamic visual resource + texture dependencies
  Main->>Controller: apply baked visual readiness
  Main->>Renderer: apply texture page update
  Main->>Renderer: commit dynamic resources
  Main->>Renderer: commit dynamic instances
  Main->>Main: register active texture dependencies
```

Runtime-authored dynamics should use the same placement vocabulary as static content. Authorship
should affect placement pool, retention, provenance, and entity lifecycle, not the packer contract.

## Proposed Static-Authored Dynamic Sequence

Static-authored dynamics remain discovered by static source work, but their visual bake remains a
dynamic visual bake.

```mermaid
sequenceDiagram
  participant Main as Main thread runtime
  participant Coord as StaticCoordinator
  participant Resolver as Static resolver worker
  participant Packer as Texture packing worker
  participant StaticBaker as Static bake worker
  participant DynamicBaker as Dynamic visual bake worker
  participant Controller as DynamicEntityController
  participant Renderer as Renderer

  Coord->>Resolver: resolve static source request
  Resolver->>Resolver: discover static layer source payloads
  Resolver->>Resolver: discover static-authored dynamic placements
  Resolver->>Resolver: discover dynamic recipes/intents
  Resolver-->>Coord: static source + dynamic placement/recipe data
  Coord-->>Main: source payloads + texture placement intents
  Main->>Packer: pack static and static-authored dynamic intents
  Packer->>Packer: preserve active placements; use free/zombie space only
  Packer-->>Main: placements + page updates
  Main->>StaticBaker: bake static layer draw units
  Main->>DynamicBaker: bake static-authored dynamic visuals
  StaticBaker-->>Main: static layer product + dependencies
  DynamicBaker-->>Main: dynamic visual resources + dependencies
  Main->>Renderer: apply texture page update
  Main->>Renderer: install static layer
  Main->>Controller: activate static-authored dynamic placements
  Main->>Controller: apply baked dynamic visuals
  Main->>Renderer: commit dynamic resources/instances
  Main->>Main: register active texture dependencies
```

The dynamic visual resource still should not become a static draw unit. It should share
`TextureManager` placement machinery, then flow through dynamic renderer resource
commits.

## Texture Manager, Repack, and Reclaim Model

Draw-unit eviction is not a texture packing decision. Static retention, dynamic lifetime, and
renderer residency decide when draw units/resources are removed.

`TextureManager` is the placement-planning boundary in the current codebase. It already owns texture batch
registries, owner leases, source aliases, calls into `TexturePacker`, and emits renderer placement
updates. This plan should reshape `TextureManager` into the simpler placement model rather than
creating a durable sibling placement service.

Texture packing reacts to runtime lifecycle through `TextureManager`:

```text
draw unit/resource installed
  -> texture dependencies pin active placements

draw unit/resource evicted
  -> texture dependencies are removed
  -> placements with no active owner become zombies
  -> pages with enough zombie area become repack candidates

repack
  -> must not move active placements
  -> may reclaim zombie space
  -> must not force active draw units to rebake
```

`TextureManager` can be more liberal than today only because active placements are pinned instead of
being repacked under the feet of active draw units. Repack must never invalidate active draw units.
If reclaiming space would require moving an active placement, that reclaim is illegal for this plan.

Repacking should be on-demand rather than a continuous background policy. When new work arrives and
packing needs space, `TextureManager` can inspect existing atlas placements, identify items with
zero active references, and decide whether reclaiming those zombie placements is worthwhile. The
packer should not own draw-unit eviction or retention policy; it should receive only currently
packable items and free/zombie placement state. Live-placement repack is explicitly out of scope
unless a future design adds a separate constraint model.

## TextureUseId Stance

`textureUseId` should not be treated as a packer concept.

Current code uses it as the material-entry lookup handle into texture bindings. That can remain as a
migration detail, but the packer should receive only opaque `itemId` values plus explicit placement
fields:

- purpose;
- pool;
- affinity key;
- source bytes/prepared source;
- dimensions/format.

Likely over-modeled responsibilities currently associated with `textureUseId`:

- filtering and mip policy;
- wrap policy;
- lifetime;
- usage role;
- source identity;
- palette/subpalette identity.

Scoping decision for now:

- Keep current `textureUseId` naming where required to land the broader pipeline refactor.
- At the packer boundary, treat it as `itemId`.
- Defer a larger rename/split until after the texture-before-bake flow is established.
- Palette ranges may still need item-level identity. Accept current behavior for this plan.

Follow-up concern:

The current `textureUseId` concept may be carrying accidental complexity rather than a real domain
primitive. During execution, revisit whether it should survive at all after the broader pipeline
shape becomes clearer.

Working skepticism:

- Filter and mip settings should usually be global policy or imposed by texture format/purpose.
- Wrap settings are shader behavior and should not make a distinct placement identity.
- Lifetime and churn should be expressed by texture placement pool, not by texture usage identity.
- Role/purpose should be an explicit placement field.
- Source identity should be separate from placement identity.
- Palette/subpalette ranges may be the main remaining reason for per-use identity, but that can be
  examined after the texture-before-bake flow is in place.

Do not block the larger refactor on deleting or renaming `textureUseId`. Treat this as a cleanup and
model-clarification target once the new resolver -> packer -> baker boundaries expose which parts of
the current handle are still meaningful.

## Shader and Renderer Implications

Current object rendering is monolithic. The simpler texture pipeline creates pressure to split object
material families into simpler shader programs. Shader-family splitting is part of the broader
mission, but it does not need to block the first implementation steps. The first cut can keep the
monolithic shader while the baker enforces the simpler object draw-unit contract.

Possible simplified object-family model:

```text
flat-color family
  no texture pages

rgba-texture family
  one base-color page
  optional one detail page

indexed-paletted family
  one index page
  one palette page
  optional one detail page
```

The current monolithic shader can continue rendering simplified draw units while the pipeline
boundaries are corrected. A later implementation step can split shader families to remove dead
uniform paths and reduce per-draw binding complexity once the data flow has settled.

## Expected Complexity Wins

- Delete or drastically shrink `static-materializer.ts` geometry splitting.
- Move renderer-legality partitioning into worker-side bakers.
- Allow resolver/baker internals to carry domain complexity while keeping runtime, `TextureManager`,
  and packer contracts small.
- Make texture packer input domain-agnostic and dumb.
- Collapse terrain, object, and dynamic texture placement onto shared code paths instead of parallel
  orchestration branches.
- Make repack avoid active draw-unit invalidation by pinning active placements and reclaiming only
  zero-reference placement space.
- Keep active draw units immutable until eviction.
- Reduce main-thread CPU work during scene-interest commits.
- Make terrain, static-authored object, static-authored dynamic, and runtime-authored dynamic
  texture placement use one vocabulary.
- Make terrain use the same placement vocabulary without making the packer terrain-aware.
- Avoid a rebake-on-repack model.

## Working Decisions

- Shader-family splitting belongs to this plan, but should be deferred until after the
  texture-before-bake pipeline shape is established.
- Terrain is first-class in the target pipeline. It uses the same placement-before-bake topology and
  `TextureManager` placement vocabulary, but its baker enforces terrain-specific page and layer
  limits instead of the object one-page-per-role rule.
- Isomorphism means shared code paths and reduced branching. Material-family differences should be
  expressed as baker legality policy or data, not as separate runtime, texture-manager, or packer
  flows.
- Resolver/baker complexity is an acceptable pressure valve as long as it stays behind worker-owned
  contracts and does not leak into main-thread materialization, texture placement, or packer policy.
- Initial `TextureManager` placement pools should be `terrain`, `static-authored-object`, and
  `runtime-authored-object`.
- Sequencing remains object-first for the bake cutover: Phase 0/1 lock terrain-aware pool contracts,
  Phase 4 proves the object texture-before-bake path, and Phase 7 applies the same topology to
  terrain with terrain-specific legality. Do not create a temporary generic static pool just to defer
  the terrain decision.
- `affinityKey` starts as one opaque string. If callers begin encoding structured domain records into
  it, revisit the contract.
- Palette/subpalette identity cleanup is deferred. Current `textureUseId`-style identity can carry
  palette range distinctions during the larger refactor.
- Repacking is on-demand when new packing work needs space. `TextureManager` can identify
  zero-reference atlas placements at pack time and reclaim them without moving active placements.
- Keep high-value diagnostics that survive the cutover with low churn. Drop diagnostics that are
  tightly coupled to obsolete pipeline internals.

## Dry Run Findings

These findings came from walking the plan against the current `apps/holtburger-3d` code before
implementation.

1. `StaticCoordinator` currently resolves source payloads and immediately bakes them before the
   runtime or `TextureManager` sees the work.

   Texture-before-bake therefore requires splitting the current internal `resolve -> bake` call chain
   into a guarded source-ready continuation. The coordinator does not need a new orchestration
   subsystem; it needs a way to produce source payloads plus placement intents, let runtime placement
   supply a `TexturePlacementSnapshot`, and invoke the bake continuation only if the task is still
   demanded. This is a sequencing change, not just a contract rename.

2. `TextureManager` currently couples placement, owner leases, role-page slot assignment, and
   renderer texture update production in one post-bake pass.

   Pre-bake placement intents do not have draw-unit or resource owners yet. The manager needs split
   APIs: one to place intents and return a placement snapshot, and one to pin/release placements from
   baked `DrawUnitTextureDependencies`.

3. On-demand zombie reclaim is real, but premature before the shared pinning model exists.

   The current packing protocol receives fresh sources and returns fresh pages. It does not model
   existing page occupancy or free rectangles. Reclaim should move later, after terrain, static
   objects, and dynamics all use placement snapshots and active placement pinning.

4. Removing main-thread static materialization affects more than geometry copies.

   `static-materializer.ts` also remaps source draw-unit IDs to materialized draw-unit IDs, remaps
   texture bindings, and filters peer records. Once bakers emit final draw units, functional
   selection/picking records should point at baker-authored IDs directly. Debug-only source lineage is
   low priority and should be dropped if preserving it creates churn.

5. Dynamic visuals need the same placement-before-bake continuation shape as static content.

   Runtime-authored dynamics currently resolve a recipe, bake a visual resource, and only place
   textures later during dynamic renderer resource sync. Static-authored dynamics are baked inside
   the static coordinator. Both paths need to converge on placement intents -> placement snapshot ->
   dynamic visual bake.

6. Role-page slot assignment is currently a `TextureManager`/renderer binding concern.

   Bakers need page identity in the placement snapshot to prove legality, but they do not necessarily
   need to own final uniform slot numbering. If slot assignment stays outside bakers, tests must prove
   that the post-bake binding step cannot overflow baker-legal draw units.

## Implementation Phases

### Phase 0A: Source-Ready Continuation Contract Spike

Goal: prove the static source-ready continuation guard before locking the broader placement
contracts.

Deliverables:

- Create a segregated contract spike or harness for the continuation shape. It may be:
  - a short-lived test harness that is deleted or replaced during Phase 3; or
  - a tiny production-neutral state reducer/continuation guard that is expected to survive.
- Model only the sequencing contract:
  - source resolution produces source payloads and placement intents;
  - coordinator exposes source-ready work with a guarded continuation;
  - runtime-like test code supplies a fake `TexturePlacementSnapshot`;
  - the continuation invokes bake if its guard still accepts the work;
  - commit emits normally.
- Use a fake placement provider keyed by `itemId`. Do not use the real `TextureManager`, renderer,
  texture packer, terrain baker, or object baker.
- Test invalidation and failure cases:
  - demand removed while placement is in flight;
  - placement failure;
  - bake failure after placement succeeds;
  - duplicate continuation invocation;
  - coordinator disposal/cancellation while placement is in flight;
  - out-of-order source-ready completions.
- Record whether the spike validates the planned `TexturePlacementIntent`,
  `TexturePlacementSnapshot`, continuation, and guard shape or forces naming/contract changes before
  Phase 0.

Acceptance criteria:

- The continuation guard can be modeled without real texture packing or renderer dependencies.
- The continuation rejects no-longer-demanded, duplicate, cancelled, failed, or disposed work
  deterministically.
- The fake placement provider is trivial. If it is not trivial, the planned placement snapshot shape
  is too coupled and Phase 0 must be revised.
- The spike has an explicit disposition before Phase 3: promote into real coordinator tests or delete
  it. Do not keep a vestigial spec-only harness.

### Phase 0: Contract Audit and Naming Lock

Goal: freeze the first-pass vocabulary before code starts moving.

Deliverables:

- Confirm first-pass names for `TextureUsagePurpose`, `TexturePlacementPool`,
  `TexturePlacementIntent`, `TexturePlacement`, `TexturePlacementSnapshot`, and
  `DrawUnitTextureDependencies`.
- Lock the initial placement pools as `terrain`, `static-authored-object`, and
  `runtime-authored-object`; do not start with a generic `static-authored` pool that terrain must
  later escape.
- Identify the concrete files that should own the new contracts. Likely candidates:
  - `apps/holtburger-3d/src/lib/textures/`;
  - `apps/holtburger-3d/src/lib/static/contracts.ts`;
  - `apps/holtburger-3d/src/lib/dynamic/contracts.ts`;
  - `apps/holtburger-3d/src/lib/renderer/types.ts`.
- Decide whether the first contract home is a new texture-placement module under
  `apps/holtburger-3d/src/lib/textures/` or a narrower extension of existing `TextureManager`
  contracts. In either case, `TextureManager` remains the placement-planning boundary.
- Record any renamed or rejected candidate shape in this plan's course-correction notes.

Acceptance criteria:

- The implementation vocabulary is documented in this plan before code changes begin.
- The first code phase has a clear contract home and does not need to invent names mid-change.
- Any remaining disagreement about pool or affinity naming is captured explicitly.

### Phase 1: Introduce Placement Contracts Without Behavior Change

Goal: add the new placement vocabulary and adapters while keeping the existing renderer output
unchanged.

Deliverables:

- Add typed placement contracts for item identity, purpose, pool, affinity, atlas placement,
  placement snapshots, and draw-unit texture dependencies.
- Add adapter functions that can translate current static/dynamic texture-use records into
  `TexturePlacementIntent` values using current `textureUseId` values as opaque `itemId`s.
- Add focused tests for:
  - purpose classification;
  - pool assignment;
  - terrain texture uses mapping to the `terrain` pool;
  - static-authored dynamic object texture uses mapping to the `static-authored-object` pool;
  - runtime-authored dynamic object texture uses mapping to the `runtime-authored-object` pool;
  - affinity key pass-through;
  - preservation of current palette/subpalette identity behavior.
- Do not change static bake sequencing, renderer layer installation, or dynamic renderer commits in
  this phase.

Acceptance criteria:

- Existing tests still pass.
- New contract tests prove the adapters are lossless for current texture-use records.
- No new implementation path consumes the contracts yet; this is a pure vocabulary bridge.

### Phase 2: Split TextureManager Placement and Pinning Around Existing Behavior

Goal: separate texture placement from resource ownership while keeping current render behavior.

Deliverables:

- Refactor or extend `TextureManager` state so it explicitly tracks:
  - placement item ID;
  - pool;
  - purpose;
  - page assignment;
  - active reference count;
  - unreferenced/freeable status.
- Add a placement API that can stage `TexturePlacementIntent` values and return a
  `TexturePlacementSnapshot` without requiring draw-unit/resource owners.
- Add pin/release APIs that consume `DrawUnitTextureDependencies` after bake and update active
  placement references.
- Keep existing owner-based static/dynamic texture delta methods as temporary adapters over the new
  placement/pinning internals.
- Teach install/evict paths to update active references for terrain draw units, static object draw
  units, static object visual resources, and dynamic visual resources.
- Preserve current texture page upload and renderer binding behavior.
- Add tests proving:
  - placement can happen before owners exist;
  - baked dependencies pin placements after install;
  - evicted owners/dependencies cause their placement items to become zero-reference candidates.

Acceptance criteria:

- Existing static and dynamic rendering behavior is unchanged.
- Zero-reference placements can be queried from `TextureManager` at pack time without relying on
  renderer internals.
- The packer still does not know draw units, materials, landblocks, or dynamic entities.

### Phase 3: Add Static Source-Ready Placement Continuation

Goal: split `StaticCoordinator`'s current source resolution -> bake closure so runtime texture
placement can supply a placement snapshot before the guarded bake continuation runs.

Deliverables:

- Add a `StaticCoordinator.setSourceReadyHandler(...)`-style runtime-installed handler, mirroring
  the current `setAtlasSnapshotProvider(...)` wiring pattern.
- The handler receives source-ready continuation work carrying:
  - resolved source payloads;
  - placement intents;
  - a guarded bake continuation with enough task identity to verify the work is still demanded.
- Add a runtime path that receives source-ready work, asks `TextureManager` for a
  `TexturePlacementSnapshot`, and invokes the guarded bake continuation with that snapshot.
- Do not expose a public resume token or revision/supersession contract. If an opaque id is needed
  for message routing or diagnostics, keep it private plumbing.
- Keep the old resolve-then-bake flow only as a temporary adapter for unmigrated domains, with a
  documented removal target.
- Preserve cancellation/current-task checks inside the continuation guard.
- Preserve existing static timing diagnostics, adding placement timing only if it is low-churn.

Acceptance criteria:

- Existing render output is unchanged while the continuation path is introduced.
- Source-ready work cannot invoke bake after it leaves demand, is cancelled, fails placement, or has
  already been invoked.
- Phase 3 source-ready API is a runtime-installed guarded continuation handler, not a public
  resume-token/state-machine API.
- Static coordinator tests cover resolve -> source-ready -> placement snapshot -> bake -> commit.
- The runtime, not the packer, remains responsible for `TextureManager` ownership.

### Resteering 1: Placement Continuation Review

Before changing bake order, review:

- whether the initial `terrain`, `static-authored-object`, and `runtime-authored-object` pools were
  enough;
- whether `affinityKey` stayed opaque or started encoding domain records;
- whether unowned placement staging and dependency pinning are simple enough to keep;
- whether the source-ready continuation is creating acceptable or excessive coordinator/runtime
  coupling;
- whether `TextureManager` is still the right placement-planning boundary;
- whether current diagnostics are already producing churn;
- whether the contract names still read honestly after real code touched them.

If the design has drifted, update this plan before continuing. Do not paper over drift with
compatibility shims.

### Phase 4: Move Static Object Texture Placement Before Static Object Baking

Goal: prove the texture-before-bake model on the object/static-object path before cutting over
terrain.

Deliverables:

- Move outdoor static object and env-cell static object texture intent discovery ahead of static
  object baking.
- Feed the resulting placement snapshot into the static object baker.
- Update static object baker output so object draw units are already renderer-legal under the
  one-page-per-role rule.
- Emit `DrawUnitTextureDependencies` from static object bake output.
- Ensure functional selection/picking records point at baker-authored draw-unit IDs after
  baker-owned partitioning. Treat debug-only source lineage as disposable.
- Identify any static coordinator sequencing hooks terrain will need in Phase 7, but do not create
  fake terrain compatibility plumbing in this phase.

Acceptance criteria:

- Static object draw units emitted by the baker do not require main-thread fine splitting.
- Static object draw units obey one-page-per-role constraints.
- Static object texture dependencies pin active placements after install.
- Existing object selection/query peer records map to baker-emitted draw units without relying on
  `static-materializer.ts` remapping.

### Phase 5: Remove Main-Thread Static Object Fine Splitting

Goal: cut over static object materialization so the main thread installs baked draw units instead of
fixing them.

Deliverables:

- Delete or shrink the static-object geometry-copying path in
  `apps/holtburger-3d/src/lib/runtime/static-materializer.ts`.
- Remove remapping logic that only exists because source draw-unit IDs are split after packing.
- Move any functional selection/picking mapping needs to baker output or static peer records; do not
  keep materializer-owned source-to-fine remapping as a compatibility layer. Drop diagnostic-only
  lineage if it is not worth the churn.
- Update removal handling so evicted baked draw units release placement references directly.
- Rewrite tests that encode post-pack fine splitting; do not preserve hollow legacy assertions.

Acceptance criteria:

- Main thread no longer copies/filters static object geometry to satisfy page limits.
- Static object renderer layer installation consumes baker-emitted draw units directly.
- Tests prove removal releases placement references and renderer resources without source-to-fine
  draw-unit remapping.

### Phase 6: Bring Dynamic Visual Baking Onto the Same Placement Contract

Goal: make static-authored and runtime-authored dynamic visuals use the same placement vocabulary as
static object baking.

Deliverables:

- Dynamic recipe resolution emits placement intents or a directly equivalent pre-bake texture
  requirement shape.
- `TextureManager` places those intents before dynamic visual baking and returns the same
  `TexturePlacementSnapshot` shape used by static bakers.
- Runtime-authored dynamic visual bake receives a placement snapshot before producing render
  parts.
- Static-authored dynamic visual prep uses the same placement path when riding static source work;
  it must not remain a coordinator-internal bake that bypasses placement snapshots.
- Dynamic visual bake products emit texture dependencies that pin active placements.
- Dynamic renderer resource removal releases placement references.

Acceptance criteria:

- Static-authored dynamics and runtime-authored dynamics share the same texture placement contract.
- Dynamic renderer resource commits still remain resource/instance based.
- Dynamic visuals do not become static draw units.
- No separate runtime-only texture packing concept remains.

### Resteering 2: Cutover Health Check

Before terrain, reclaim, or shader-family cleanup, review:

- remaining references to old texture-use/materialization concepts;
- remaining main-thread CPU work that looks baker-like;
- draw-unit count and draw-call changes in representative scenes;
- which diagnostics still explain real behavior;
- whether `textureUseId` has become clearer or more obviously bogus.

Update this plan with any course corrections before moving into broader renderer cleanup.

### Phase 7: Bring Terrain Onto the Same Placement-Before-Bake Contract

Goal: make terrain a first-class participant in the same texture-before-bake `TextureManager`
placement model while preserving terrain-specific shader legality rules.

Deliverables:

- Move terrain texture placement intent discovery before terrain baking.
- Feed terrain placement snapshots into `TerrainGeometryStaticBaker`.
- Update terrain material layer planning or add a terrain bake partitioner so terrain draw units are
  legal against known placement assignments:
  - layer entries <= 8;
  - overlays per layer <= 3;
  - roads per layer <= 2;
  - terrain color pages <= 4;
  - terrain mask pages <= 4;
  - terrain detail pages <= 1.
- Emit terrain `DrawUnitTextureDependencies` so terrain placements stay pinned while draw units are
  active.
- Remove terrain role-page overflow fallback as a normal expected path. Keep a loud diagnostic only
  for invariant violations or genuinely missing texture residency.
- Preserve terrain selection/source mapping records against baker-emitted terrain draw units.

Acceptance criteria:

- Terrain texture packing runs before terrain baking.
- Terrain draw units emitted by the baker satisfy terrain shader page and layer limits without
  renderer fallback.
- Terrain active dependencies pin placements; the packer remains unaware of terrain layers, pcodes,
  roads, overlays, draw units, and terrain shader page limits.
- Terrain diagnostics describe real missing residency/invariant failures, not expected post-pack
  overflow.

### Phase 8: Add On-Demand Zombie Reclaim

Goal: let `TextureManager` reuse/repack zombie-heavy atlas space without moving active placements.

Deliverables:

- Extend placement planning so `TextureManager` can offer reclaimable zero-reference placements to
  packing work.
- Keep active placements pinned and excluded from reclaim/repack candidates.
- Decide whether reclaim is implemented as:
  - packing into tracked free rectangles on existing pages; or
  - rebuilding pages made entirely of zero-reference placements.
- Extend texture page update/removal handling so old page disposal remains a runtime/renderer
  concern, not a baker concern.
- Add tests for:
  - unplaced items cluster by pool, purpose, and affinity where possible;
  - zero-reference placements can be reclaimed;
  - active placements are never moved;
  - reclaim is triggered only by new packing work needing space.

Acceptance criteria:

- Existing render output remains equivalent.
- Tests prove active placements are pinned and zero-reference placements are reclaimable.
- Reclaim remains on-demand and does not become a continuous background eviction policy.
- The packer still does not know draw units, materials, landblocks, dynamic entities, or terrain
  legality.

### Resteering 3: Reclaim and Renderer Cleanup Review

Before shader-family cleanup, review:

- whether reclaim added too much `TextureManager` state;
- whether page replacement/removal dirties too much renderer payload state;
- whether diagnostics around atlas pages still explain real behavior;
- whether draw-unit count increases are acceptable enough to proceed with shader simplification.

### Phase 9: Simplify Renderer Payload Prep and Specialize Shader Families

Goal: reduce object renderer complexity made unnecessary by the object one-page-per-role contract
and replace the monolithic object shader with family-specific shader paths.

Deliverables:

- Simplify object material prepared payload code around one page per relevant role.
- Remove dead object multi-page role-page machinery once no active object draw units require it.
- Introduce family-specific shaders for:
  - flat color;
  - RGBA texture;
  - indexed-paletted;
  - detail variants only where needed.
- Route object draw resources to shader families from baker-authored material family data.
- Delete object material mode branches and uniforms that only supported the old monolithic shader.

Acceptance criteria:

- Renderer code no longer carries unused 4-pages-per-role assumptions for simplified object draw
  units.
- Family-specific shader paths render flat-color, RGBA texture, and indexed-paletted object draw
  units without relying on `uMaterialModes`.
- Old monolithic-only material mode paths are removed rather than left as parallel behavior.

### Phase 10: TextureUseId Cleanup Decision

Goal: make an evidence-based cut on `textureUseId` after the new boundaries reveal what identity
concepts remain real.

Deliverables:

- Audit uses of `textureUseId` after placement contracts, pre-bake packing, and baker-owned draw
  units are live.
- Decide whether to:
  - keep `textureUseId` as a material lookup handle;
  - rename it to `itemId`/`placementItemId`;
  - split it into source identity, palette range identity, and placement identity.
- Apply the chosen cleanup as a clean cutover. Do not preserve aliases unless a public API forces
  them.

Acceptance criteria:

- The final name describes the concept it actually represents.
- Palette/subpalette range identity is explicit enough to avoid accidental dedupe.
- No vestigial `textureUseId` compatibility layer remains if the concept is renamed or split.

### Phase 11: Final Cleanup and Vestige Removal

Goal: complete the clean cutover and remove obsolete code, tests, and diagnostics.

Deliverables:

- Delete old post-pack materialization helpers that no longer have a caller.
- Delete obsolete tests that only asserted the old sequencing or remapping behavior.
- Remove unused diagnostics, counters, and reports tied to retired internals.
- Remove temporary adapters introduced in earlier phases.
- Update architecture comments/docs that still describe the old bake -> pack -> materialize flow.

Acceptance criteria:

- No durable parallel texture/materialization pipeline remains.
- No compatibility shims remain without an explicit owner-approved reason.
- `npm`/project test and lint commands relevant to `apps/holtburger-3d` pass.
- The plan's course-correction notes capture any intentional deviations.

## Task Checklist

- [x] Phase 0A: prove source-ready continuation contract in a segregated spike.
- [x] Phase 0: lock first-pass contract names and homes.
- [x] Phase 1: add placement contracts and no-behavior-change adapters.
- [x] Phase 2: split `TextureManager` placement and pinning around current behavior.
- [x] Phase 3: add static source-ready placement continuation.
- [ ] Resteering 1: review placement continuation shape.
- [ ] Phase 4: move static object placement planning before static object baking.
- [ ] Phase 5: remove main-thread static object fine splitting.
- [ ] Phase 6: bring dynamic visual baking onto the same placement contract.
- [ ] Resteering 2: review cutover health.
- [ ] Phase 7: bring terrain onto the same placement-before-bake contract.
- [ ] Phase 8: add on-demand zombie reclaim.
- [ ] Resteering 3: review reclaim and renderer cleanup readiness.
- [ ] Phase 9: simplify renderer payload prep and specialize shader families.
- [ ] Phase 10: resolve `textureUseId` cleanup.
- [ ] Phase 11: delete vestigial code and obsolete tests.

## Decisions and Course Corrections

- Dry run steered Phase 3 away from zombie reclaim and toward the static source-ready placement
  continuation. Current code bakes inside `StaticCoordinator` before runtime texture placement, so
  texture-before-bake is blocked until that continuation exists.
- User feedback promoted the source-ready continuation confidence work ahead of Phase 0. The spike
  must validate or revise the planned continuation/snapshot shape before names are locked.
- Phase 0A was implemented as a small production-neutral `StaticSourceReadyHandshake` state machine
  with a segregated contract test suite. Phase 3 must either integrate/promote it into the real
  coordinator continuation guard or delete it during cutover; do not leave it as unused spec theater.
- User feedback reframed the source-ready split as a closure/continuation boundary, not a scary
  standalone pause/resume subsystem. Phase 0 should decide whether current `handshake` naming is
  still honest or should be renamed before promotion.
- User feedback rejected revision-based supersession as a normal pipeline concept. A continuation is
  valid while its work is still demanded and unconsumed; if a future path needs an opaque correlation
  id for message routing or diagnostics, it must not become public `resumeToken` doctrine.
- Phase 3 source-ready API is decided: use a runtime-installed handler on `StaticCoordinator`,
  following the existing `setAtlasSnapshotProvider(...)` wiring style. The handler receives guarded
  continuation work and invokes it after `TextureManager` placement. Do not expose resume tokens or a
  public revision/supersession contract.
- Phase 0 locked the first-pass placement vocabulary in this plan. Phase 1 should add the canonical
  contracts in `apps/holtburger-3d/src/lib/textures/placement.ts`; static, dynamic, and renderer
  modules should import those contracts rather than defining local equivalents.
- Phase 0 rejected a generic `static-authored` pool, `TexturePlacementSnapshot.revision`, public
  source-ready resume tokens, public source-ready supersession, and separate static/dynamic
  placement snapshot types.
- Phase 0 found no remaining pool-name disagreement. `affinityKey` remains the locked first-pass
  name and must stay an opaque clustering hint; if it starts encoding structured domain facts, the
  contract should be revisited rather than expanded.
- Phase 1 added `apps/holtburger-3d/src/lib/textures/placement.ts` as the canonical placement
  contract home. The first adapters are pure vocabulary bridges: static and dynamic texture-use
  records keep current `textureUseId` values as opaque `itemId`s, preserve the existing
  material-texture data use plus sampling policy in `TexturePlacementSource`, and classify purpose
  using the same terrain/object rules currently embedded in `TextureManager`.
- Phase 1 maps static-authored dynamic texture commits by their static visual texture domain
  (`outdoor-buildings`, `outdoor-generated-scenery`, `env-cell-system`, etc.) into the
  `static-authored-object` pool, while `runtime-object-material` maps to `runtime-authored-object`.
  This keeps static-authored and runtime-authored dynamics isomorphic without inventing a dynamic-only
  placement vocabulary.
- Phase 2 added ownerless `TextureManager.placeTextureIntents(...)` placement planning,
  draw-unit dependency pin/release APIs, and `createPlacementReferenceSnapshot()` for active vs.
  zero-reference placement queries. Existing static and dynamic owner-based commit methods now update
  the same placement reference records while preserving current renderer texture updates.
- Phase 2 kept existing static/dynamic renderer upload behavior intact by adapting the new placement
  records behind the old owner-based APIs. Static draw-unit owners, static object visual resource
  owners, and dynamic visual resource owners all flow through the same active-reference accounting
  path.
- Phase 3 added the real `StaticCoordinator.setSourceReadyHandler(...)` guarded continuation path.
  `ClientRuntime` installs the handler and asks `TextureManager.placeTextureIntents(...)` for a
  placement snapshot before invoking the continuation. The old Phase 0A `StaticSourceReadyHandshake`
  spike was deleted once coordinator tests covered the real source-ready boundary.
- Phase 3 intentionally emits empty placement intent arrays until Phase 4 moves static object intent
  discovery ahead of bake. This keeps current renderer texture upload behavior unchanged; pre-packing
  real static textures before the old materialization path can upload pages would make render output
  wrong.
- Dry run split `TextureManager` responsibilities into placement and pinning. Current owner leases
  require post-bake draw-unit/resource owners, but pre-bake placement intents intentionally do not
  have owners yet.
- Dry run moved on-demand zombie reclaim after terrain cutover. The current packer protocol is
  fresh-source/fresh-page oriented and has no existing-page occupancy model, so reclaim is cleaner
  once all domains share placement snapshots and active placement pinning.
- Dry run clarified that removing `static-materializer.ts` affects peer-record mapping in addition
  to geometry splitting. Functional selection/picking records must survive; diagnostic-only lineage is
  low priority and can be dropped.

## Tracked Debt

- `apps/holtburger-3d/src/lib/renderer/types.ts` has a private renderer-upload interface named
  `TexturePlacement`. When Phase 1 introduces exported texture-domain `TexturePlacement`, rename the
  renderer-local type if an import would cause ambiguity.
- Current `StaticAtlasBatchSnapshot`, `VisualTextureDomain`, `TextureUsePlacement`, and
  `placementRevision` names remain old-pipeline vocabulary. Phase 1 and Phase 2 should bridge or
  retire them deliberately instead of creating compatibility aliases that survive the cutover.
- `TexturePlacementSource` currently preserves material data use plus sampling policy as a single
  bridge source. Later phases may split byte/source identity from sampling policy if that simplifies
  `TextureManager`; do not do that until real placement planning needs it.
- Phase 1 adapters are intentionally unused by runtime paths. Phase 2 must either integrate them into
  `TextureManager` internals or delete/rewrite them during the clean cutover; do not leave a parallel
  vocabulary bridge around after placement planning owns the flow.
- `TextureManager.placeTextureIntents(...)` privately maps placement pools onto legacy
  `VisualTextureDomain` values because `textures/packing/protocol.ts` still requires that domain
  field. A later cleanup should rename or narrow the packer protocol once renderer-era domain
  ownership is no longer part of placement planning.
- Phase 2 active references are tracked by placement `itemId`, matching the migration-era
  `textureUseId` assumption. If Phase 10 splits `textureUseId`, the placement reference index must
  move to the final placement item identity at the same time.
- Phase 3 source-ready work carries empty placement intents as a temporary no-behavior-change
  adapter. Phase 4 must replace that with real static object placement intents; do not let empty
  source-ready placement survive as a hidden fallback.

## Risks and Concessions

### More Draw Units and Draw Calls

The object one-page-per-role rule will probably create more object draw units than the current
4-pages-per-role shader. Terrain may also create more draw units once it partitions by final page
assignments. This is an intentional concession unless profiling proves it unacceptable.

### Bigger Static Bake Inputs

Bakers need placement snapshots or lookup tables. This increases worker message payload size unless
the placement snapshot is compact and keyed by item ID.

### Guarded Static Continuations

Static source resolution and static baking become explicitly separated by runtime texture placement,
but the implementation should read as one async closure: resolve source facts, place texture intents,
then invoke a guarded bake continuation. The coordinator must not grow a durable side queue or broad
orchestration subsystem just to remember half-finished work. The dry run showed this split is not
optional: `StaticCoordinator` currently owns the resolve -> bake sequence, while `TextureManager`
lives on the runtime side.

### Texture Page Images and Placement State

If the packer can repack zombie-heavy pages, `TextureManager` needs careful ownership of page image
generation, page replacement, and old page disposal. This must remain a texture-manager/runtime
concern, not a baker concern.

### Terrain Has Separate Baker Rules

Terrain already has layered material limits and terrain-specific shader behavior. The one-page
object rule must not flatten terrain. Terrain uses the same `TextureManager` placement vocabulary
with terrain-specific baker legality rules and pinned active placements.

### Worker Complexity Can Still Become a Dumping Ground

This plan intentionally allows more complexity in resolvers and bakers, but that complexity must
remain cohesive: source interpretation belongs in resolvers; renderer-legality partitioning belongs
in bakers. If either worker starts accumulating runtime lifecycle, texture placement, or packer policy
decisions, stop and split the responsibility back to the owning stage.

## Open Questions

- Does palette/subpalette identity remain encoded in current `textureUseId`, or should palette
  ranges become explicit placement sources before the larger refactor?
- What exact active-reference index should `TextureManager` maintain so zero-reference atlas
  placements are cheap to identify at pack time?
- Should reclaim first support free rectangles inside partially live pages, or only rebuild pages
  that contain no active placements?
- Which existing diagnostics remain high-value after the pipeline cutover, and which should be
  deleted rather than preserved through churn?

## Definition of Done

- Resolver output for migrated static, terrain, object, and dynamic texture paths carries source
  facts and texture placement intents, not draw units.
- Texture packing runs before terrain, object/static-object, and dynamic visual baking for the
  migrated paths.
- Static source resolution produces guarded continuations that accept placement snapshots without
  accepting no-longer-demanded, cancelled, failed, disposed, or already-invoked work.
- The Phase 0A continuation spike is either promoted into durable coordinator tests or deleted.
- Bakers produce renderer-legal immutable draw units/resources under their material-family legality
  contracts.
- Resolver/baker complexity remains contained behind worker-owned contracts and does not leak into
  `TextureManager`, packer, or main-thread runtime orchestration.
- Main-thread runtime no longer performs static object geometry splitting after texture packing.
- Active draw units/resources pin placements and release placement references
  on eviction/removal.
- Repacking can reclaim zero-reference atlas placements on demand without invalidating active draw
  units.
- Static-authored and runtime-authored dynamic visuals use the same texture placement vocabulary.
- Terrain is integrated into the new placement model with terrain-specific baker legality and no
  expected role-page overflow fallback.
- Terrain, static objects, and dynamic visuals share the same placement/reference/reclaim machinery;
  remaining branches are baker-owned legality choices rather than parallel orchestration paths.
- Shader-family splitting is completed for flat-color, RGBA texture, and indexed-paletted object
  families.
- `textureUseId` is either honestly retained, renamed, or split with no vestigial compatibility
  layer.
- Obsolete post-pack materialization code, old tests, and stale diagnostics are deleted.
- Relevant lint and test commands for `apps/holtburger-3d` pass.

## Review Notes

Review should focus on whether the phases preserve the north stars:

- clean cutover over compatibility layering;
- shared code paths over special-case orchestration branches;
- packer remains domain-agnostic;
- baker owns draw-unit authorship;
- runtime owns residency and eviction;
- active draw units never require rebake because of repack;
- diagnostics and naming cleanup do not drag vestigial code forward.
