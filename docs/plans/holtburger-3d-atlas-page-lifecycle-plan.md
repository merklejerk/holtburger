# Holtburger 3D Atlas Page Lifecycle Plan

## Goal

Make runtime atlas pages self-cleaning and less fragmented without introducing
whole-bucket repacks or broad binding churn.

## Scope

In scope:

- Reclaim fully unreachable atlas pages during normal texture mutations.
- Move durable texture binding state behind stable `textureUseId` placement
  resolution.
- Treat `pageSlot` as transient draw/material payload prep state.
- Give newly packed atlas pages one general-purpose size tier of runway.
- Insert later compatible texture placements into existing atlas-page vacancy
  without moving existing rects.
- Keep the behavior sample-class agnostic.

Out of scope:

- Whole-bucket compaction.
- Moving existing placements during opportunistic insertion.
- Palette-specific packing rules.
- Renderer architecture changes beyond accepting page pixel replacement updates
  and resolving placements by `textureUseId`.

## Ground Truth

Reference files:

- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
- `apps/holtburger-3d/src/lib/textures/packing/atlas-layout.ts`
- `apps/holtburger-3d/src/lib/textures/packing/packer.ts`
- `apps/holtburger-3d/src/lib/textures/placement.ts`
- `apps/holtburger-3d/src/lib/textures/sampling-policy.ts`
- `apps/holtburger-3d/src/lib/textures/texture-manager.test.ts`
- `apps/holtburger-3d/src/lib/textures/packing/atlas-layout.test.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`

Current facts:

- `TextureManager` can delete owner-based placements when owner leases reach
  zero.
- `#reclaimZeroReferencePagesForTextureMutation()` deletes zero-reference
  physical pages and returns the reclaimed ids to renderer-facing mutations.
- Pending placement packing only packs new pending entries; it does not repack
  retained live entries.
- The packer chooses the fewest pages, then the smallest allocated area. Runtime
  jobs materialize the selected page with one tier of runway.

## Dry Run Findings

These findings came from walking the plan against the current code before
implementation.

1. Reclaim is two different lifecycles.
   Owner-based removals already emit `removedTextureRefIds` from
   `#removeOwnerTextureRefs()`. Ownerless pre-bake pages created by
   `placeTextureIntents()` are not uploaded to the renderer until a later owner
   commit reuses them, so reclaiming those pages mainly deletes texture-manager
   residency and placement records. The reclaim helper returns reclaimed page
   ids, but only renderer-visible paths emit remove updates.
2. Page runway should happen after pack-attempt selection.
   The existing layout comparison intentionally chooses the smallest page area
   once texture count is minimized. The one-tier runway should grow the
   selected materialized page dimensions, not distort candidate comparison or
   overflow diagnostics.
3. `ResolvedTexturePlacement` is the likely cutover bridge.
   `TexturePlacementUpdate` already carries `resolvedTexturePlacements` with
   `bindingKey`, `textureRefId`, `rect`, and size. That shape should evolve
   into the durable `textureUseId -> placement` table. The current
   `textureBindings` array is the stale physical binding model carrying owner
   and `pageSlot`.
4. Phase 3 touches more than `TextureManager`.
   `TextureBinding` is consumed by renderer public types, WebGL texture update
   handling, terrain payload prep, object-material payload prep, and many tests.
   The cutover should be direct, but it needs a named replacement contract
   before deleting old binding fields.
5. Existing page absorption needs locked-placement support.
   Reconstructing free rects ad hoc would create allocator drift. Prefer
   extending `atlas-layout.ts` with an existing-page/locked-placement helper so
   insertion uses the same free-rect splitting and placement scoring as normal
   packing.
6. Renderer dirtying can stay conservative at first.
   The renderer currently dirties all terrain/object material prepared payloads
   on page replacement because it lacks a reverse page-to-owner index. That is
   acceptable for this plan; do not add reverse ownership tracking just to make
   absorption land.

## North Stars

1. Reclaim is hygiene, not compaction.
   It may delete pages nobody can reach, but it must not move live placements.
2. New-page runway is general.
   Apply the same one-tier growth rule to all sample classes unless a page has
   already hit max size.
3. Absorption must preserve existing rects.
   Existing texture uses keep resolving correctly because old placements do not
   move.
4. Texture uses are logical; pages are physical.
   Renderer resources should carry stable `textureUseId`s. Atlas placement
   maps those uses to current page/rect state. Physical page ids stay internal
   to texture upload and lifetime.
5. `pageSlot` is draw-local.
   It is assigned while preparing terrain/object material payloads, based on
   the currently resolved placements and shader limits. It should not be stored
   as durable texture placement identity.
6. Avoid second allocator semantics.
   Reconstruct existing page free space and reuse the same placement/free-rect
   logic where practical.
7. Emit honest renderer updates.
   If an existing page's pixels change, upload a replacement page payload. If a
   page is deleted, emit `removedTextureRefIds`.
8. Prefer clean cutovers over compatibility layers.
   Once placement resolution moves behind `textureUseId`, remove the old
   durable binding fields from production paths instead of supporting both
   models in parallel.
9. Yeet ossified tests.
   Tests that only prove cached physical bindings, durable `pageSlot`, or
   append-only atlas behavior still exist should be deleted or rewritten around
   the new logical-use and placement-resolution contract.
10. Keep naming brutally honest.
    Use names that distinguish logical texture uses, physical atlas pages, and
    draw-local sampler slots. Do not keep legacy names that blur those
    concepts just to reduce churn.

## Phase 1: Always-On Reclaim

Deliverables:

- Enable zero-reference page reclamation from placement mutation paths.
- Ensure reclaimed pages are not pages staged or reused by the current mutation.
- Emit removed texture refs for any page the renderer may hold.

Acceptance criteria:

- Ownerless pre-bake pages with zero active references are removed before later
  unrelated placement work.
- Active, leased, or current-operation pages are retained.
- Existing owner-removal behavior still emits removed texture refs.

Task checklist:

- [x] Replace dead `reclaimZeroReferencePages: false` callsites with a real policy.
- [x] Change the reclaim helper to return reclaimed physical page ids instead of
  silently deleting them.
- [x] Keep `placeTextureIntents()` reclaim ownerless pages without pretending it can
  emit renderer updates.
- [x] Add tests for reclaiming ownerless pages during `placeTextureIntents()`.
- [x] Add tests for not reclaiming retained/reused pages in the same mutation.
- [x] Keep owner-based removal tests passing.

Implementation notes:

- `#packPendingTexturePlacements()` now returns both newly uploaded placements
  and reclaimed physical texture ref ids.
- `placeTextureIntents()` enables reclaim and deliberately ignores reclaimed ids
  because pre-bake planning does not talk to the renderer.
- Renderer-facing texture deltas merge owner-removal ids with reclaim ids, so a
  physical page removed by either path is represented once.
- Reclaim now also runs for removal-only texture deltas. The old
  "freeable-but-still-resident" snapshot state was removed instead of preserved
  as a compatibility layer.

## Phase 2: General Page Runway

Deliverables:

- Add a packer/layout option that grows successful newly allocated pages by one
  texture-size tier.
- Cap growth at `MAX_RUNTIME_ATLAS_PAGE_SIZE`.
- Prefer growing the shorter side first; if already square, grow both sides one
  tier.

Acceptance criteria:

- A minimum `256x128` result materializes as `256x256`.
- A square `256x256` result materializes as `512x512`.
- Max-size pages do not exceed `2048x2048`.
- Tests cover at least RGBA and data/exact sample-class jobs through generic
  atlas layout behavior, not palette-specific branches.

Task checklist:

- [x] Add page runway policy to `atlas-layout.ts` or the texture packing job
  protocol, applied after the winning pack attempt is selected.
- [x] Update packer tests for grown materialized page dimensions.
- [x] Keep overflow diagnostics based on attempted candidate sizes, not grown
  runway dimensions.
- [x] Keep placement rects based on original packed coordinates.

Implementation notes:

- `pageRunway: "one-tier"` is an explicit layout/packing policy. Bare
  `planAtlasLayout()` calls default to exact selected page sizes.
- Runtime texture packing jobs request one-tier runway for all sample classes.
- Runway grows the shorter side first; square pages grow both dimensions. Growth
  is capped at the page max size.
- Tests cover both RGBA and exact data pages through the shared atlas layout
  path, with rects unchanged after materialized page growth.

## Phase 3: TextureUse Placement Resolution

Deliverables:

- Introduce an authoritative placement table keyed by stable `textureUseId`.
- Evolve `resolvedTexturePlacements` into the durable placement-update payload.
- Keep physical page identity as internal page/upload state, not renderer
  resource identity.
- Remove `textureBindings` and `pageSlot` from durable renderer update state.
- Resolve `pageSlot` while preparing terrain and object-material payloads from
  current placement rows.

Acceptance criteria:

- Renderer resources continue to store logical texture use ids.
- Replacing or relocating a page updates placement rows without requiring
  material/resource rebinding.
- Terrain payload prep derives color/mask/detail page slots from the resolved
  placements for that draw unit.
- Object-material payload prep derives role-local slot `0` from resolved
  placements.
- Existing texture binding tests are replaced or rewritten around placement
  resolution, not cached physical bindings.

Task checklist:

- [x] Emit placement resolution rows keyed by `textureUseId` from
  `TextureManager`.
- [x] Replace renderer `#textureBindings` with a placement map keyed by
  `textureUseId`.
- [x] Move `pageId`/physical texture refs behind renderer texture page management.
- [x] Refactor terrain payload builders to assign page slots during prep.
- [x] Refactor object material payload builders to resolve placements by texture use
  id during prep.
- [x] Yeet or rewrite tests that assert durable `pageSlot` fields.

Implementation notes:

- `TexturePlacementUpdate` no longer carries durable `textureBindings`.
  `resolvedTexturePlacements` is the renderer update contract and uses
  `textureUseId` directly.
- The renderer owns `textureUseId -> ResolvedTexturePlacement` because draw-time
  payload preparation also needs the current WebGL texture handles.
- `TextureManager` no longer assigns `pageSlot`; it only manages residency,
  packing, leases, uploads, and logical placement rows.
- Terrain payload prep assigns color/mask page slots from resolved placements
  while walking the terrain material plan. Detail textures remain a separate
  uniform path.
- Object-material payload prep resolves role textures from material-entry
  texture use ids; shader slot `0` is role-local and no longer durable state.
- Deleted texture-manager tests that only protected the old owner-scoped
  `pageSlot` allocator. Replacement coverage lives in terrain/object payload
  prep tests where slots are now assigned.

## Phase 4: Existing Page Absorption

Deliverables:

- For compatible pending groups, find existing pages in the same
  bucket/page-class.
- Reconstruct page occupancy/free rects from committed rects and gutter policy.
- Try placing pending entries into existing page vacancy before creating a new
  page.
- Upload an updated page payload when absorption succeeds.

Acceptance criteria:

- Later compatible entries can land on an existing page without changing old
  rects.
- Existing texture uses continue resolving to the same page and rect after
  absorption.
- New texture uses resolve to their inserted page and rect.
- If no existing page has room, current new-page packing still works.

Task checklist:

- [x] Persist or reconstruct enough page facts to classify compatible insertion
  targets.
- [x] Extend `atlas-layout.ts` with existing-page/locked-placement insertion support
  instead of copying free-rect logic into `TextureManager`.
- [x] Route successful insertion through the same runtime placement update path.
- [x] Add tests for two-wave placement producing one page after absorption.

Implementation notes:

- Added `planAtlasPageInsertion()` to rebuild free rects from locked placements
  and insert new entries without moving existing rects.
- `TextureManager` now tries compatible existing pages before creating new pack
  jobs. Successful absorption reuses the existing `textureRefId`, rebuilds that
  page's pixels, and emits a normal replacement placement update.
- Registry entries now persist `pageClassKey` and source `gutterPixels`; those
  are the minimum page facts needed to classify compatible targets and rebuild
  locked occupancy correctly.
- Alias records can share one physical source rect, so absorption reconstructs
  locked occupancy from unique physical placements, not every logical alias.
- If no compatible page has room, the existing new-page packer path runs
  unchanged.

## Phase 5: Cleanup And Diagnostics

Deliverables:

- Remove misleading tests or names that imply full repack exists.
- Add diagnostics that distinguish created, absorbed, reclaimed, and retained
  pages.
- Keep atlas inspection useful after page pixel replacement.
- Rename public concepts so logical texture uses, physical pages, and draw-local
  page slots are not blurred together.

Acceptance criteria:

- Diagnostics explain why a page count changed.
- No dead reclaim flags remain.
- No palette-specific packing logic was added.

## Risks

- Reclaim may delete a page still referenced by renderer state if records and
  registry entries disagree.
  Mitigation: require both placement records and registry lease checks before
  deletion; test mismatched record/lease cases.
- Absorption may accidentally move old rects if it reuses the full packer
  naively.
  Mitigation: insertion helper starts from committed occupied rects and only
  places new entries.
- Page pixel replacement may need renderer update plumbing distinct from new
  page creation.
  Mitigation: first verify whether existing placement update handling already
  treats same `textureRefId` as reupload; add explicit tests if unclear.
- Moving `pageSlot` out of durable bindings may expose hidden coupling in
  terrain and object-material payload prep.
  Mitigation: refactor one draw path at a time, with tests proving page-slot
  assignment still respects shader page limits.

## Definition Of Done

- `npm run test:ts`
- `npm run check`
- `npm run lint`
- Atlas diagnostics show fewer dead ownerless pages after churn.
- Renderer resources resolve placements by `textureUseId`; durable bindings no
  longer expose `pageSlot`.
- Two-wave compatible atlas placement can reuse a prior page when vacancy
  exists.
- No whole-bucket repack or palette-specific branch is introduced.

## Open Questions

- Should diagnostics expose page runway separately from occupied pixels, or is
  current packing efficiency enough?
- Is conservative "dirty all prepared payloads on page replacement" acceptable
  long term, or should a later optimization add reverse page-to-owner tracking?
