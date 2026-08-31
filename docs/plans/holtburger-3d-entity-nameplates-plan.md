# Holtburger 3D Entity Nameplates Plan

Status: **Completed 2026-08-31; phase-by-phase dry run completed before implementation.**

## Context and Boundaries

### Goal

Render configurable name-and-level plates above visible dynamic entities in both Client and
Explorer modes as camera-facing WebGL geometry that is naturally hidden by opaque scene geometry,
while leaving a narrow path for later icon and text indicators.

### In Scope

- Shared source facts for an entity's display name and optional level, projected by both the live
  client authority and the Explorer catalog-backed authority.
- A clean same-generation update path so a changed name or level updates the retained plate without
  rebuilding the entity's setup, materials, animation, behavior, or scene tree.
- A shared frame setting that enables nameplates independently for `player`, `selfPlayer`, `npc`,
  `mob`, and `other` dynamic categories. Initial defaults enable remote players, NPCs, and mobs.
- A configurable per-view visible-nameplate budget. After ordinary entity selection and category
  filtering, the nearest candidates win with stable entity identity as the distance tie-breaker.
  The shared tuning default is 50.
- Reuse of the renderer's existing dynamic-entity selection. A nameplate is eligible only when its
  entity survives the existing scene/frustum and object-footprint selection, is draw-visible, and
  has at least one retained rigid-part contribution. There is no independent nameplate visibility
  culler.
- Canvas2D rasterization of one complete plate, cached by its complete visual value rather than by
  entity identity.
- Instanced camera-facing quads grouped by cached plate texture, so repeated mobs with the same name
  and level use one texture and one draw per render domain.
- Depth-tested, non-depth-writing alpha rendering in the flat and portal schedules. Opaque terrain,
  buildings, objects, and entities occlude plates through the existing scene depth.
- Explorer category controls and tuning-backed Client defaults. Both frontends consume the same
  renderer setting without moving frontend control policy into host or shared game authority.
- Diagnostics and synthetic browser-harness workloads covering hundreds of entities.

### Out of Scope

- A font engine, glyph atlas, SDF/MSDF rendering, text shaping implementation, or dependency on an
  external typography package. Canvas2D remains the browser-owned font implementation.
- Packing complete plates into an atlas. The cache and pass contracts must allow that physical
  optimization later, but the first implementation uses one texture per unique plate.
- Independent distance, frustum, overlap, line-of-sight, raycast, or GPU occlusion culling for
  nameplates. Existing entity selection is the sole coarse visibility decision; the depth test is
  the pixel-level occlusion decision.
- Category-specific priorities or reserved budget shares. The initial budget treats every enabled
  category uniformly and selects strictly by camera distance.
- Transparent-surface occlusion. The current blended scene path does not write depth, so transparent
  windows, particles, and blended materials do not become nameplate occluders.
- Buff/status protocol projection or arbitrary indicator contracts. The Canvas compositor may later
  accept ordered icon/text items, but this plan adds no unused fields for absent producers.
- Screen-space collision avoidance, label stacking between entities, interaction/hit testing, or
  selection highlights.
- Retail nameplate parity. Retail references may inform later styling, but the requested behavior is
  a frontend presentation feature and does not require reproducing a retail defect or constraint.

## Ground Truth and Existing Seams

### Source and Host Facts

- `crates/holtburger-core/src/dynamic_entity_view.rs` owns the source-neutral entity projection used
  by both producer compositions. `DynamicEntityIdentityView` currently mixes GUID/WCID identity with
  the display name; no level is projected.
- `crates/holtburger-core/src/client/dynamic_entity_view.rs` builds the live-client view from a
  hydrated `WorldState` entity. `PropertyString::Name` is already required there, and
  `PropertyInt::Level` is available from the same property store.
- `crates/holtburger-core/src/client/mod.rs` emits a dynamic-entity upsert for every accepted
  `WorldEvent::PropertiesUpdated`, so a server name or level mutation already reaches the shared
  projection cadence; no second client event channel is needed.
- `crates/holtburger-weenie-catalog/src/model.rs` retains Explorer template facts, but currently
  omits raw `PropertyInt::Level`.
- `apps/holtburger-tools/src/weenie_catalog_export.rs` is the one ACE World SQL extraction boundary.
  Its selected integer-property query must add Level rather than introducing an Explorer-only query.
- `crates/holtburger-weenie-catalog/src/lib.rs` currently declares catalog format version 8. Adding
  level changes the portable record and therefore requires a version bump and catalog re-export.
- `apps/holtburger-3d/host/src/explorer_entity_driver.rs` is the Explorer producer boundary that
  joins catalog templates with prepared content before using the same dynamic-entity projector as
  the client.

### Frontend Runtime and Selection

- `apps/holtburger-3d/src/lib/game/runtime/dynamic-entity-feed.ts` validates the complete host view
  with Zod. Display facts must be added here as a strict, typed wire contract.
- `apps/holtburger-3d/src/lib/game/runtime/dynamic-entity-presentation.ts` adapts a host view and its
  resolved setup visual into one `PlacedDynamicPresentationSource`.
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts` distinguishes immutable
  visual identity, placement identity, and mutable presentation state. Its same-generation path
  currently updates placement, physics presentation, and the playing clip but not display facts.
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts` owns retained dynamic records,
  current rigid-pose bounds, hidden/`noDraw` consequences, and renderer-neutral visible rigid-part
  expansion. It is the correct owner of retained nameplate content and a display-population revision;
  it must not own Canvas or WebGL resources.
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts` is the renderer's narrow read gateway
  into scene and dynamic systems. Nameplate content and current rigid bounds reach the renderer
  through this gateway rather than exposing the mutable dynamic record.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts` already selects dynamic entities in
  `#resolveSceneContributions`. The nameplate candidate is formed in that same branch only after
  the entity's existing selection succeeds; no second scene query or spatial policy is introduced.

### Rendering Precedents

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-world-marker-pass.ts` proves a small
  renderer-owned pass can draw blended, depth-tested, non-depth-writing geometry and route fragments
  through `PORTAL_DEFERRED_VISIBILITY_GLSL`.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-particle-pass.ts` and
  `webgl2-particle-record-store.ts` provide the frame-streamed instancing and explicit GPU-resource
  lifecycle precedents.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts` draws deferred blended content,
  scoped particles, trajectories, and the world marker after opaque depth has been resolved into the
  final scene target. Nameplates join that deferred presentation region and reuse its depth.
- `apps/holtburger-3d/src/lib/game/textures/texture-manager.ts` and
  `textures/atlas/resident-texture-atlas.ts` own DAT-backed and stable generated content residency.
  Nameplate pixels are ephemeral renderer presentation, so they remain in a dedicated
  `NameplateTextureCache` rather than acquiring asset keys, resident-atlas claims, or content
  invalidation semantics.

## Settled Direction Decisions

1. **Entity visibility is the nameplate's coarse visibility.** If the entity is not selected for
   ordinary rendering, no nameplate work occurs. If it is selected, category policy may admit a
   candidate, the per-view budget may retain it, and the depth buffer decides which plate fragments
   are actually visible.
2. **Category policy is frontend presentation policy.** `FrameSettings` carries one validated
   boolean per existing producer-resolved `DynamicEntityCategory`. The host never filters entities
   for a display preference, and consumers never reconstruct category from radar color or WCID.
3. **Canvas owns typography.** One complete plate is measured and rasterized using Canvas2D. The
   implementation does not parse fonts, lay out glyphs, or create a glyph-level cache.
4. **Repeated content, not repeated entities, determines physical work.** The cache key includes all
   facts that change pixels: name, optional level, style revision, and raster density. Visible
   instances sharing a key are submitted together.
5. **The plate cache is renderer-local, not a new content system.** It owns Canvas-derived pixels,
   WebGL textures, exact byte diagnostics, and destruction with the renderer. `TextureManager`
   remains the authority for content-backed texture residency.
6. **Display updates do not restage visuals.** Name and level are a mutable display level, distinct
   from setup/appearance identity and from physics presentation state. A same-generation update
   changes only that level and the nameplate-population revision.
7. **Current rigid geometry determines the anchor.** Renderer space is Y-up, so the object-local
   anchor is `{ x: midpoint(min.x, max.x), y: max.y, z: midpoint(min.z, max.z) }` plus one named
   padding constant. Transform it through the entity placement and landblock offset exactly once.
   Particle-preservation envelopes do not push labels upward.
8. **Perspective-scaled geometry still has scene depth.** The quad derives clip-space offsets from
   its raster dimensions and configured reference distance around the projected world anchor,
   retaining the anchor's clip depth. It faces the camera without becoming a DOM overlay.
9. **Future indicators extend composition, not placement.** A later producer may add ordered icon or
   text semantics and teach the Canvas compositor to paint them. It should not replace the scene
   anchor, depth, cache, or submission path built here.
10. **A budget bounds the worst case without inventing visibility.** After existing selection and
    category filtering, retain the nearest `maximumVisible` candidates per view by squared camera
    distance, breaking equal-distance ties by stable producer identity. This is deterministic
    workload selection, not another frustum, range, or occlusion system.

## North Stars

1. A nameplate should feel attached to the world because it shares scene placement and depth, not
   because a parallel UI system estimates where the entity appeared.
2. Entity selection remains one authoritative decision. Nameplates consume it; they do not build a
   second, subtly different idea of what the renderer can see.
3. Cost follows visible information and has an explicit ceiling. Repeated mobs share raster and
   draw work, disabled categories cost neither, and candidate population cannot grow submitted
   instances past the configured budget.
4. Rare content changes should produce rare resource changes. Movement and animation update only
   instance placement, never pixels.
5. The initial implementation earns future extensibility through clean ownership seams, not unused
   indicator types or speculative font infrastructure.

## Phase 1: Display Facts and Catalog Cutover

Status: **Completed 2026-08-31.**

Carry honest name and optional-level facts through both producer compositions with one clean wire
shape.

### Deliverables

- Introduce a documented `DynamicEntityDisplayView` in
  `crates/holtburger-core/src/dynamic_entity_view.rs` containing:
  - required producer-resolved `name`;
  - optional validated nonnegative `level`.
- Move display name out of `DynamicEntityIdentityView` into the new composite display field and
  sweep all Rust, TypeScript, harness, probe, diagnostics, and Explorer UI consumers in the same
  change. Identity retains only GUID and WCID. Do not alter the independent catalog-template
  identity name; the dry run confirmed it is a separate source model, not stale dynamic-view
  vocabulary.
- Add raw optional `level: i32` to `WeenieTemplate`, the ACE SQL integer-property extraction,
  projection, codec, fixtures, and durable catalog documentation.
- Bump the `.hwc` format version and update unsupported-version tests. Do not add compatibility
  decoding; an old catalog fails loudly and is regenerated with the existing export tool.
- Project live-client `PropertyInt::Level` and Explorer template level through one shared validation
  rule. Absence remains `None`; a negative authored value warns with producer identity and becomes
  absent rather than wrapping to a large unsigned value or rejecting the entire entity.
- Update `dynamicEntityViewSchema`, exported TS types, mirrors, fixtures, and event tests.

### Acceptance Criteria

- Client and Explorer fixtures produce the same display shape for equivalent source facts.
- Missing level yields a name-only display; level zero remains distinguishable from absence.
- A same-generation client `PropertyInt::Level` update emits a dynamic upsert with the new display
  value.
- Catalog round-trip and unsupported-version tests pass, and the local ignored catalog regeneration
  requirement is recorded in the phase results.

### Task Checklist

- [x] Shared Rust display contract and clean name cutover
- [x] Client level projection
- [x] Explorer catalog extraction, model, codec, and version bump
- [x] Browser schema and consumer sweep
- [x] Focused Rust and TypeScript tests

### Decisions and Course Corrections

- Added `DynamicEntityDisplayView { name, level }`; wire identity now contains only GUID and WCID.
  The source-neutral definition retains raw optional `i32` level so catalog facts remain lossless,
  while the shared view projector converts nonnegative values to `u32` and warns/drops negatives.
- Reused the existing client `PropertiesUpdated` upsert path. A focused test mutates Level and proves
  the resulting same-generation upsert carries the new display value.
- Bumped `.hwc` from v8 to v9 and updated the durable format document, which had itself fallen behind
  at v6. The catalog identity prefix remains intentionally independent of dynamic-view identity.
- Evidence: 321 serial core tests, 21 catalog tests, 13 exporter tests, 1,719 TypeScript tests, and
  `npm run check` passed. One parallel broad run tripped an unrelated collision test; the exact test
  and the full serial core suite both passed, identifying suite interference rather than a feature
  regression.
- Debt: the ignored local `dats/weenies.hwc` is still an older format because
  `ACE_WORLD_SQL_URL` is not configured. Regenerate it before Explorer browser/runtime evidence.

## Phase 2: Retained Nameplate State and Category Policy

Status: **Completed 2026-08-31.**

Give display content and configuration explicit owners without creating renderer or Svelte-driven
hot state.

### Deliverables

- Add a small validated nameplate policy module under `src/lib/game/renderer/`:
  - exhaustive category visibility and fill-color records;
  - `NameplateSettings` containing category visibility, layout, appearance, legibility, and a
    nonnegative integer `maximumVisible`;
  - defaults sourced from shared frontend tuning: player/NPC/mob enabled, other disabled, maximum
    visible 50.
- Add `FrameSettings.nameplates`. Explorer copies cold checkbox changes through its existing
  `applyFrameSettings()` path; Client receives its defaults from `CLIENT_TUNING`.
- Add `NameplateContent` to the dynamic presentation source/record and a focused
  `DynamicEntitySystem.updateNameplateContent(nodeId, content)` method.
- Track one monotonic nameplate-population revision in `DynamicEntitySystem`, incremented only when
  an installed entity is added, removed, or changes its nameplate visual key.
- Expose through `RenderWorld`:
  - the population revision;
  - an allocation-free or revision-bounded enumeration of installed nameplate content keys for
    exact cache reference reconciliation;
  - current nameplate facts for one already-selected dynamic node: content and current rigid bounds.
- Extend `GamePresentationRuntime`'s same-generation state application so name/level updates do not
  alter `dynamicVisualKey`, placement, physics state, or playback. The dynamic system remains the
  sole owner of display-value equality and revision changes.
- Reuse the existing client `PropertiesUpdated` dynamic-upsert path. The dry run confirmed that no
  new event type, subscription, or host command is required for name/level changes.
- Add Explorer category toggles to the existing world/presentation controls. These remain cold UI
  state and never receive entity or camera payloads.

### Acceptance Criteria

- Changing level or name updates only retained nameplate content; tests prove no dynamic owner,
  setup visual, or animation preparation is replaced.
- Category setting changes require no entity rebuild and affect the next rendered frame.
- Budget changes require no entity rebuild and affect the next rendered frame; zero submits no
  plates.
- Adding/removing/updating an entity increments the nameplate revision exactly when the unique
  content reference population changes.
- `other` entities are disabled by default in both modes.

### Task Checklist

- [x] Exhaustive category/budget policy and tuning defaults
- [x] Frame settings and Explorer controls
- [x] Dynamic-system content/update/revision ownership
- [x] RenderWorld query port
- [x] Same-generation runtime update path
- [x] Focused state and policy tests

### Decisions and Course Corrections

- `DynamicPresentationSource` carries nullable `NameplateContent`; only host-projected entity
  presentations populate it, while authored dynamic scene objects explicitly carry `null`.
- `DynamicEntitySystem` owns the mutable installed value and population revision. It exposes a
  callback-based enumeration and focused selected-entity facts through `RenderWorld`, avoiding a
  mutable-record leak or per-frame population array.
- Same-generation display changes call only `updateNameplateContent`; that owning system compares
  the display value and advances its revision. The existing setup visual, scene nodes, placement,
  physics state, and playback remain untouched. Tests cover revision changes, idempotence, removal,
  and no visual reload on rename/level change.
- Nameplate settings are validated at runtime construction and every cold frame-settings update.
  Explorer exposes one toggle for every producer category; Client inherits the shared
  player/NPC/mob-on, self/other-off, 50-visible defaults.
- Course correction: the Phase 2 criterion that a zero budget "submits no plates" can only be
  proven once the pass exists. Phase 2 proves zero is a valid cold setting; zero-work submission is
  retained as a Phase 3 acceptance requirement.
- Evidence: `npm run check`, 47 focused policy/system/runtime tests, and the complete 1,722-test
  TypeScript suite passed.

## Phase 3: Canvas Plate Cache and Flat Renderer Pass

Build the smallest real rendering slice before adding portal routing.

Status: **Completed 2026-08-31.**

### Deliverables

- `webgl2-nameplate-texture-cache.ts`:
  - canonical complete visual key from content, style revision, and raster density;
  - population reconciliation from the dynamic-system revision, retaining the set of installed
    content keys while creating GPU textures lazily on first visible use;
  - Canvas2D measurement and rasterization of centered name plus optional `Level N` row;
  - a readable outline/shadow and transparent background;
  - dimensions checked against the WebGL device's `MAX_TEXTURE_SIZE` and an explicit renderer-owned
    byte ceiling; an impossible plate records a named diagnostic and fails that cache insertion
    rather than allocating without a bound;
  - exact texture-byte, live-entry, rasterization, hit, miss, and release diagnostics;
  - explicit `destroy()` that releases every texture.
- `webgl2-nameplate-pass.ts`:
  - one static unit quad and one reusable frame instance buffer;
  - anchor-relative entity positions plus pixel offsets in the vertex shader;
  - instanced draws grouped by complete plate texture;
  - depth test enabled, depth writes disabled, culling disabled, conventional alpha blending;
  - no framebuffer ownership and no dependency on `TextureManager`.
- Extend flat-view contribution resolution to collect a nameplate instance only when:
  - the dynamic entity survives the existing object-footprint selection;
  - visible contribution expansion is not `hidden`;
  - at least one rigid-part material contribution survives retail-geometry visibility policy;
  - its existing producer-resolved category is enabled.
- After candidate collection, sort by squared camera-to-anchor distance with stable producer
  identity as the tie-breaker and retain at most `NameplateSettings.maximumVisible`. Use the simple
  stable sort for the expected hundreds of candidates; do not add a heap or selection algorithm
  unless profiling attributes meaningful time to it.
- Derive the anchor from current rigid bounds and entity placement once while resolving the selected
  contribution. Renderer space is Y-up: use bounds-center X/Z and `max.y`, then apply padding,
  `localToLandblock`, and the existing landblock-relative offset. Do not create a nameplate scene
  node or expand scene culling bounds.
- Submit grouped plates after the ordinary blended/particle work and before final scene presentation,
  preserving the scene target's opaque depth.
- Add deterministic browser-harness fixture controls for 100 repeated labels, 100 unique labels,
  and 500 eligible entities at known distances. These are verification workloads, not a prerequisite
  catalog census.

### Acceptance Criteria

- A flat outdoor and flat interior fixture show stable, camera-facing name/level plates.
- An opaque synthetic wall completely hides the covered plate without a CPU visibility query.
- Moving or animating an entity moves the anchor without rerasterizing unchanged text.
- One hundred identical visible mobs produce one live texture, one grouped draw, and 50 instances
  under the default budget.
- One hundred unique visible plates exercise the bounded maximum of 50 texture-group draws without
  requiring an atlas.
- Five hundred otherwise eligible candidates produce exactly the nearest 50 instances under the
  default budget, with deterministic results for equal distances.
- Hidden/`noDraw`, disabled-category, scene-rejected, and rigid-part-invisible entities produce no
  instances and no lazy texture creation.
- Removing the last installed user of a content key releases its texture during revision
  reconciliation.

### Task Checklist

- [x] Canvas rasterizer and value cache
- [x] Exact population reconciliation and resource destruction
- [x] Instanced flat nameplate pass
- [x] Existing-selection candidate collection
- [x] Deterministic nearest-candidate budget
- [x] Anchor derivation from current rigid bounds
- [x] Flat visual, occlusion, grouping, and lifecycle tests
- [x] Repeated-100, unique-100, and ordered-distance 500-candidate fixtures

### Decisions and Course Corrections

- A complete plate key only needs installed/not-installed liveness. The dry-run wording called for
  retained reference counts, but no consumer distinguishes one installed entity from two. The
  implementation therefore reconciles a set of content keys and releases a texture when its key is
  absent, avoiding a field with no named consumer.
- Oversized Canvas results fail before `createTexture`, increment a dedicated rejected-raster
  diagnostic, and leave no cache entry. This preserves the planned hard memory bound while keeping
  the failure loud.
- Focused policy, selection, anchor, cache, pass, and synthetic-workload tests pass, as does the
  complete frontend TypeScript/Svelte check.
- Harness fixtures use one harness-only setup source adapter and synthetic `DynamicEntityView`
  populations. They still traverse shared runtime realization, scene selection, category policy,
  renderer collection, cache, and GPU submission, but do not require a catalog record. This avoids
  turning stale local reference data into a rendering-test dependency.
- SwiftShader functional evidence proves the structural contracts: repeated values share one draw,
  texture, and rasterization; unique values reach the configured draw ceiling; ordered-500 retains
  only the nearest configured budget. These are functional assertions, not Phase 4 hardware
  performance evidence.
- Flat outdoor and real interior screenshots at render scale 1 show the Canvas name and level rows
  above synthetic entity geometry. Dense overlap is intentionally unchanged because collision
  avoidance remains out of scope.
- A deterministic open/wall A/B fixture submits the same one target plate in both runs. The open
  capture shows it; the opaque-wall capture fully hides it, proving ordinary scene depth performs
  pixel occlusion without a CPU visibility query.
- Same-generation movement from Y=104 to Y=106 retained one rasterization and one live shared
  texture. Retiring all 100 repeated-value entities then released that texture and returned live
  entries and bytes to zero. The harness asserts both outcomes.

## Phase 4: Verify the Budgeted Worst Case

Status: **Completed 2026-08-31.**

Review the real implementation before portal complexity makes its contracts expensive to change.

### Deliverables

- Run the repeated-100, unique-100, and 500-candidate workloads with nameplates enabled and disabled
  in the same implementation, using at least five hardware-GPU samples per configuration. This
  paired measurement supplies the baseline; no separate pre-implementation capture is needed.
- Compare visible instances, unique texture count, draw count, cache bytes, rasterization count,
  renderer CPU phase cost, total GPU cost, and worst-frame behavior.
- Inspect screenshots at supported render scales and representative near/far camera positions.
- Confirm the 100-unique maximum-draw workload is acceptable. If it is materially over budget, use
  profiling to distinguish candidate ordering, instance preparation, draw calls, and texture
  switching; stop and revise the configured budget or this plan's physical-texture scope rather
  than silently introducing an atlas.
- Dry-run Phase 5 against any corrected cache/submission contract and update this plan before
  continuing.

### Acceptance Criteria

- The accepted `maximumVisible` default and per-texture draw strategy are recorded with workload and
  timing evidence.
- No independent spatial/occlusion culler, atlas, or glyph engine is introduced as a reaction to a
  surprising single run. Perspective legibility may provide a direct presentation cutoff.
- Visual issues in anchoring, raster density, and depth behavior are corrected before portal work.

### Task Checklist

- [x] Five-run repeated-100 workload comparison
- [x] Five-run unique-100 workload comparison
- [x] Five-run 500-candidate budget comparison
- [x] Render-scale and distance screenshots
- [x] Submission strategy decision recorded
- [x] Remaining phases dry-run and updated

### Decisions and Course Corrections

- Added a harness-local paired benchmark that reverses enabled/disabled order for each pair and
  resets browser timing plus renderer CPU/GPU profiling for every one-second sample. All results
  below are five samples per configuration on
  `ANGLE (AMD Radeon RX 7900 XT, Vulkan/RADV)` at 1280x720, render scale 1. Ranges are the minimum
  and maximum sample means; worst render is the largest individual browser render sample.

| Workload     | State    | Browser render mean median (range), ms | Renderer CPU mean median (range), ms | GPU total mean median (range), ms | Worst render, ms |
| ------------ | -------- | -------------------------------------: | -----------------------------------: | --------------------------------: | ---------------: |
| repeated-100 | disabled |                    0.370 (0.362–0.382) |                  0.345 (0.339–0.357) |               0.207 (0.204–0.213) |              2.2 |
| repeated-100 | enabled  |                    0.416 (0.405–0.430) |                  0.392 (0.380–0.404) |               0.221 (0.215–0.226) |              4.8 |
| unique-100   | disabled |                    0.367 (0.356–0.404) |                  0.343 (0.332–0.377) |               0.209 (0.206–0.221) |              5.9 |
| unique-100   | enabled  |                    0.450 (0.435–0.457) |                  0.425 (0.411–0.430) |               0.231 (0.227–0.239) |              5.1 |
| ordered-500  | disabled |                    1.383 (1.322–1.389) |                  1.305 (1.251–1.315) |               0.211 (0.197–0.228) |              4.8 |
| ordered-500  | enabled  |                    1.496 (1.462–1.569) |                  1.422 (1.388–1.493) |               0.377 (0.366–0.388) |              5.4 |

- The enabled workload contracts stayed exact in every accepted run: repeated-100 used one
  texture/draw and 100 instances (11,424 bytes); unique-100 used 100 textures/draws and 100
  instances (1,936,536 bytes); ordered-500 admitted 500, rejected 400 by budget, and submitted 100
  through one repeated-value draw. Canvas rasterization stayed at one or 100 respectively rather
  than tracking frames.
- Course correction: the first hardware ordered-500 run admitted 498 candidates because the two
  outer near-row entities grazed the ordinary camera frustum. The fixture now starts its 20-column
  grid farther from the camera, keeping all 500 comfortably visible without weakening production
  selection. Its exact 500/400/100 assertion and focused unit test pass.
- The 100-unique ceiling is accepted. Its median delta over disabled is about 0.083 ms in both
  browser render time and profiled renderer CPU, with about 0.022 ms total GPU delta. This does not
  justify an atlas, glyph engine, or new visibility policy. The per-texture draw strategy was
  retained; the product default was later tuned independently to `maximumVisible = 50`.
- Hardware screenshots at the supported 0.5 and 2 render-scale extremes established the raster
  density and anchor behavior. A later product correction made plate size perspective-aware and
  added a projected-name legibility cutoff; the same depth and cache ownership remain.
- Phase 5 dry run remains a direct extension: the budget is already applied once before candidates
  retain their selected `renderScopeKeys`; the portal path can expand those retained candidates by
  scope and texture after budgeting, route a portal shader variant through the existing deferred
  visibility uniform contract, and share the cache, quad buffers, and instance shape with flat mode.
  No new ownership seam or plan change is required.
- The paired disabled windows intentionally retain textures already warmed by the enabled workload
  while proving zero candidate preparation, upload, and draw. A separate cold-disabled run remains
  in Phase 6 to prove zero initial Canvas rasterization and texture allocation.

## Phase 5: Portal Routing and Complete Mode Integration

Status: **Completed 2026-08-31.**

Route the proven plate pass through the same physical visibility domains as its selected entity.

### Deliverables

- Add a portal shader variant using `PORTAL_DEFERRED_VISIBILITY_GLSL`, following the world-marker
  pass rather than inventing another portal mask contract.
- Group portal instances by render-scope key and plate texture. Submit only selected scope keys from
  the entity's existing dynamic contribution routing.
- Apply the nearest-nameplate budget once per view before expanding retained candidates into their
  selected portal scope keys; plural membership must not consume the budget more than once.
- Draw scoped plates in the deferred portal scene after scoped particles and before final
  presentation. Preserve depth-test/non-depth-write behavior.
- Wire both Client and Explorer frame settings and lifecycle through their shared runtime. No
  mode-specific renderer pass or duplicated plate cache is permitted.
- Add browser-harness screenshot/probe coverage for:
  - an entity visible through an open portal;
  - the same entity hidden by the portal wall/closed depth;
  - an entity whose plural spatial membership reaches the selected portal domains without duplicate
    final pixels;
  - Client-shaped and Explorer-shaped display feeds reaching the same renderer behavior.

### Acceptance Criteria

- Flat and portal modes use the same cache, layout, instance record, and pass API.
- Portal boundaries and ordinary opaque depth both hide the appropriate plate fragments.
- A selected entity is not independently rejected by nameplate-specific spatial logic.
- Both application modes render category-filtered plates from their own authority data.

### Task Checklist

- [x] Portal shader and routing variant
- [x] Scope/texture grouping
- [x] Client and Explorer integration
- [x] Portal occlusion fixtures
- [x] Shared-mode behavior evidence

### Decisions and Course Corrections

- `WebGL2NameplatePass` owns flat and portal shader siblings while sharing its quad, streamed anchor
  buffer, draw context, texture bindings, and diagnostics. The portal fragment uses the existing
  deferred visibility GLSL and routing uniform contract; no nameplate-specific mask exists.
- The renderer applies the nearest-nameplate budget once, then expands retained candidates by their
  already-selected scope keys and groups on `(scope, texture)`. A portal-straddling synthetic entity
  proved one eligible/budgeted candidate, one texture/rasterization, and two scoped draws/instances.
- A real-driver dry run found a GLSL namespace collision between the pass-local matrix uniform and
  the portal metadata block's `uClipFromAnchor`; the local uniform is now honestly named
  `uNameplateClipFromAnchor`. The AMD Vulkan driver links and executes both variants.
- Hardware portal-mode A/B evidence submits the same one outdoor-scoped target in both captures:
  the open capture shows the name/level plate, while the opaque synthetic wall completely hides it.
  A real indoor portal capture also submitted 100 plates while authored room geometry hid them.
- Valid plural membership must include the authoritative resident scope. The fixture initially
  coupled `reachesOutdoors` to an empty EnvCell list and the scene graph correctly rejected it; the
  helper now models those independent source facts without weakening the invariant.
- Frozen outdoor captures for identical single-membership and plural-membership entities were
  byte-identical (`29bf44e7…`) when only the outdoor scope was selected. In an indoor view where
  both resident EnvCell and outdoor scopes were selected, diagnostics proved two routed physical
  submissions from one budget slot; authored depth hid both, so this is routing evidence rather
  than a visible overlap comparison. The shared portal envelope's existing executor coverage remains
  the pixel-level authority for disjoint selected domains.
- Both application compositions already terminate in the same strict `DynamicEntityView` display
  contract and shared runtime/renderer. Phase 1 producer tests prove Client property updates and
  Explorer catalog projection reach that contract; the browser workloads prove the source-neutral
  contract renders in flat and portal modes. No mode-specific cache, pass, or setting path was added.

## Phase 6: Cleanup, Diagnostics, and Final Verification

Status: **Completed 2026-08-31.**

Remove implementation debris and prove the completed slice at repository and browser boundaries.

### Deliverables

- Add nameplate metrics to the renderer diagnostic snapshot and Explorer frame panel only where each
  metric has a distinct troubleshooting scenario: eligible candidates, budget-rejected candidates,
  submitted instances, unique textures/draws, rasterizations, and cache bytes. Do not expose raw
  per-frame entity arrays to Svelte.
- Sweep stale `identity.name` vocabulary and temporary compatibility shapes from Rust, TypeScript,
  scripts, tests, diagnostics, and UI labels.
- Retain the synthetic browser workloads because they are the regression/performance evidence
  surface; no one-off catalog census utility should be introduced.
- Update durable catalog documentation for the new version and regeneration command. Do not move
  temporary execution notes out of this plan.
- Run scoped formatting and the complete relevant checks:
  - `cargo test -p holtburger-weenie-catalog`;
  - focused `holtburger-tools`, `holtburger-core`, and host tests;
  - `npm run test:ts`;
  - `npm run check` and `npm run check:rust`;
  - `npm run lint` with Clippy warnings denied;
  - `npm run harness:browser -- --gpu ...` for flat and portal visual/performance scenarios.

### Acceptance Criteria

- No compatibility alias or duplicate display-name field survives the clean cutover.
- All GPU textures, buffers, vertex arrays, programs, and Canvas references have explicit renderer
  teardown.
- Disabled nameplates add no Canvas rasterization, texture allocation, instance upload, or draw.
- Enabled nameplates meet the recorded accepted performance envelope for both repeated and unique
  workloads.
- Static checks, focused tests, full TypeScript tests, lint, and browser/GPU evidence pass.

### Task Checklist

- [x] Focused diagnostics with named consumers
- [x] Vocabulary and dead-code sweep
- [x] Catalog documentation and regeneration note
- [x] Resource-lifecycle audit
- [x] Static, unit, browser, and GPU verification
- [x] Final plan results and remaining debt recorded

### Decisions and Course Corrections

- The Explorer Frame panel now consumes the atomic nameplate snapshot and displays the distinct
  selection, budget, submission, cache residency/bytes, rasterization rejection, and release facts.
  The exported frame-report schema is version 6.
- A cold hardware run installed 100 unique-value entities after setting `maximumVisible = 0` and
  observed zero eligible candidates, cache hits/misses, rasterizations, live textures, bytes,
  uploads, and draws. Disabled policy therefore performs no Canvas or GPU plate work.
- Resource audit: the renderer owns one cache and one pass; destruction releases every cached
  texture plus both shader programs, two buffers, and the vertex array. The existing renderer
  replacement/context-loss lifecycle invokes that same destruction boundary.
- Vocabulary sweep found no surviving dynamic `identity.name`. The three matches are the separately
  documented catalog-template identity and remain intentional. Dead-export analysis found four
  unnecessary new exports; all were made internal or inlined instead of preserving speculative API.
- Final evidence passed: the complete TypeScript suite; Svelte/TypeScript checks with zero
  diagnostics; ESLint; Knip; Prettier; Clippy with warnings denied; catalog, core, tool, and host
  tests; `git diff --check`; focused flat/portal/lifecycle browser assertions; and hardware GPU
  functional, visual, cold-disabled, and five-pair performance runs.
- Remaining debt: the ignored local `dats/weenies.hwc` was not regenerated because
  `ACE_WORLD_SQL_URL` is unavailable in this worktree. The durable catalog document names the
  regeneration command, format v9 rejects the old artifact loudly, and synthetic browser workloads
  deliberately do not make runtime rendering evidence depend on that local file.

## Risks and Mitigations

| Risk                                                                                                 | Consequence                                                            | Mitigation                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing catalogs become unreadable after the level field is added                                   | Explorer entity spawning fails until reference data is refreshed       | Make the version bump explicit, fail with the existing unsupported-version diagnostic, document and perform the local catalog re-export during execution                        |
| The 50-plate budget is saturated by unique player names                                              | The pass reaches its maximum 50 texture-group draws                    | Measure the unique workload directly; if unacceptable, attribute the cost and explicitly revise the budget or physical cache plan rather than adding an implicit optimization   |
| System fonts differ across operating systems                                                         | Plate dimensions and appearance vary slightly between packaged targets | Keep metrics and rasterization in one Canvas operation, test bounds rather than screenshot bytes, and bundle a licensed font later only if product styling requires determinism |
| Canvas raster density becomes stale after render-scale changes                                       | Text looks soft or cache entries use the wrong dimensions              | Include raster density in the complete visual key and reconcile/retire old-density entries when frame quality changes                                                           |
| Name or level changes accidentally rebuild the dynamic visual                                        | Setup/animation resources churn on ordinary property updates           | Give display state its own equality/update path and focused same-generation tests proving the visual owner/generation remains unchanged                                         |
| Current rigid bounds move under animation                                                            | Plates lag, clip into tall poses, or rasterize unnecessarily           | Recompute only the world anchor from current bounds per selected frame; cache keys contain content/style only, never placement or bounds                                        |
| Entity selection admits a node whose parts are all suppressed by retail visibility                   | A plate appears for an entity with no drawn model                      | Require at least one retained draw-visible rigid-part material contribution before collecting its plate                                                                         |
| Portal membership yields duplicate submissions                                                       | One plate blends over itself and appears too bright                    | Reuse the renderer's deduplicated selected dynamic render-scope keys and test plural-membership fixtures                                                                        |
| Equal-distance candidates reorder between frames                                                     | Plates flicker at the budget boundary                                  | Sort by squared camera distance and then stable producer identity; test input-order independence                                                                                |
| Transparent geometry does not hide plates                                                            | A plate may remain visible through a translucent window or particle    | Record this as an explicit first-version boundary; do not mutate the scene's transparent depth policy for a nameplate feature                                                   |
| No independent nameplate culling means an offscreen quad can be prepared near a selected edge entity | Small avoidable instance work at view edges                            | Accept the bounded overdraw initially; entity selection remains the single coarse owner, and profiling—not a parallel culler—must justify changing it                           |

## Definition of Done

- [x] Client and Explorer project required name plus optional validated level through one shared
      display contract.
- [x] Explorer catalog format and export path retain raw Level and old catalogs fail with an honest
      regeneration diagnostic.
- [x] Same-generation display updates do not rebuild visuals, scene trees, animation, or behavior.
- [x] Player, NPC, mob, and other category visibility is exhaustively configurable; defaults enable
      player/NPC/mob and disable other.
- [x] A configurable nonnegative per-view budget defaults to 50; the nearest candidates win with a
      stable identity tie-breaker, and zero submits no plates.
- [x] Nameplates are collected only from already-visible dynamic entities and have no independent
      spatial query, overlap, raycast, or occlusion culler. Camera depth removes plates below the
      configured projected legibility threshold before distance orders the remaining candidates.
- [x] Canvas2D rasterizes one complete cached plate; repeated visual values share one texture.
- [x] Visible instances sharing a texture are submitted with instancing.
- [x] Flat and portal modes render camera-facing nameplates with opaque-scene depth occlusion and no
      depth writes.
- [x] Disabled or ineligible nameplates allocate and draw nothing.
- [x] Cache/resource lifetimes are exact across add, update, removal, render-scale change, renderer
      destruction, and context loss/restart policy.
- [x] Synthetic repeated-100, unique-100, and ordered-distance 500-candidate workloads are measured
      on the hardware GPU with workload, budget, render scale, run count, median, and spread
      recorded.
- [x] Relevant Rust, TypeScript, lint, formatting, browser-harness, and GPU checks pass with no
      suppressed warnings.

## Open Questions

These are visual/product choices that do not alter the architecture and may be settled during the
first flat screenshots:

1. The locally controlled player has a distinct `selfPlayer` category and is hidden by default;
   frontends may enable it without renderer special casing.
2. What exact font size, outline, row spacing, world-anchor padding, and category colors should ship?
   Begin with one neutral shared style and tune from real Client and Explorer captures.
3. Should a present level render as `Level 12`, `Lvl 12`, or `12`? Begin with `Level N` for clarity;
   the cache key already carries a style revision for a clean later change.
