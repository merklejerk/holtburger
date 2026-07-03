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

- [x] Diagnostics explain why a page count changed.
- [x] No dead reclaim flags remain.
- [x] No palette-specific packing logic was added.

Implementation notes:

- Atlas diagnostics now expose cumulative page lifecycle counters:
  `created`, `absorbed`, `reclaimed`, and `retained`.
- The resources overview and atlas page panel surface the lifecycle totals so
  page-count changes are visible without opening the full diagnostics report.
- `retained` counts pages that a reclaim pass saw and deliberately kept because
  they were active, leased, or part of the current mutation.
- This is lifecycle telemetry, not per-update event history. If we need a
  timeline later, add an explicit bounded event ring rather than overloading the
  snapshot summary.

## Phase 6: Page-Local Repack And Growth

Goal:

- Recover packing density when an early small page becomes the compatible target
  for later texture waves, without falling back to whole-bucket repacking.

Deliverables:

- Add a page-local repack/grow path that runs when simple existing-page
  absorption cannot fit all compatible pending entries.
- For each candidate physical page, collect metadata for unique physical entries
  already on that page plus the compatible incoming entries.
- Run layout-only candidate planning before any old source pixels are
  re-requested.
- Re-run pixel materialization only for the one selected candidate page,
  allowing the page to grow by normal size tiers up to the runtime max.
- Rebuild the same `textureRefId` with the new larger page pixels when the
  page-local repack succeeds.
- Update registry rects and emit `resolvedTexturePlacements` for every texture
  use whose rect moved, including existing aliases on that page.
- Preserve the current new-page fallback when no candidate page-local repack can
  fit the incoming entries.

Out of scope:

- No whole-bucket repack.
- No cross-page merge pass.
- No palette-specific packing branch.
- No global "optimize all atlas pages" maintenance job.

Acceptance criteria:

- A fresh run where one `46x46` palette arrives before four later compatible
  palettes can grow/repack the original `128x128` page into a larger page
  instead of producing a `4 + 1` page split.
- Page-local repack may move rects only for texture uses already on the selected
  physical page plus the incoming compatible entries.
- Texture uses on other pages in the same bucket keep their `textureRefId`,
  rect, and pixels untouched.
- Renderer placement maps receive updated rows for every moved or inserted
  `textureUseId`.
- If the candidate page cannot fit after growth, current new-page packing still
  works.

Task checklist:

- [x] Add a page-local layout-only repack planner API in `atlas-layout.ts` or a thin
  TextureManager-local adapter over the existing packer, with explicit
  candidate-page inputs.
- [x] Teach `TextureManager` to try page-local repack/grow after insertion
  fails and before creating a brand-new page.
- [x] Score/select a candidate page using only dimensions, gutters, page class,
  and existing registry metadata; do not request old pixels during candidate
  planning.
- [x] Re-request/reprepare old unique physical sources only after a candidate
  page-local repack plan has been selected.
- [x] Materialize the grown page under the existing `textureRefId`, copying or
  rebuilding pixels from unique physical sources.
- [x] Update all registry aliases that point at moved physical placements.
- [x] Emit `resolvedTexturePlacements` for all moved and inserted logical
  texture uses.
- [x] Add tests for the `46x46` one-then-four palette wave producing one grown
  page instead of `4 + 1`.
- [x] Add guard tests proving unrelated pages in the same bucket are not
  repacked or moved.

Implementation notes:

- This phase exists because vacancy-only absorption preserves old rects and page
  size. That is good for low churn, but it locks in unlucky early pages such as
  a one-texture `64x64 -> 128x128` runway page.
- Page-local repack is the middle ground: it is allowed to move rects within one
  selected physical page, but it is not allowed to reconsider the whole bucket.
- Because renderer placement is now canonical by `textureUseId`, moved rects can
  be announced cleanly through `resolvedTexturePlacements`.
- Candidate selection is metadata-only. The implementation uses registry
  dimensions, gutters, and current page dimensions to pick one page, then
  re-requests only the selected page's unique old physical sources before
  rebuilding pixels. Incoming textures are already prepared by the existing
  placement pipeline.
- The memory-minimizing planner may grow the observed `46x46` one-then-four
  palette wave to `256x128`, not necessarily `256x256`. That is intentional:
  the rule is preserve-or-grow the selected page, not force square pages.

Dry-run notes:

- `TextureManager` currently stores source identity and physical keys on
  registry entries, but not the prepared/direct pixel source. Page-local repack
  needs pixels only after a candidate is selected. Candidate selection must stay
  layout-only and use registry dimensions/gutters plus incoming source metadata.
- After selecting one candidate page, re-request/reprepare only that page's old
  unique physical sources through `AssetService`. Persisting direct sources in
  registry entries is faster but increases retained CPU memory and should be
  avoided unless profiling proves the reprepare path is too expensive.
- The worker packer should not be used for candidate scoring because its current
  protocol requires source pixels. Reuse `atlas-layout.ts` for layout-only
  planning, then use shared materialization/blit helpers only for the selected
  candidate.
- The existing packer protocol can stay unchanged for normal new-page packing.
  Page-local replacement may ignore generated page ids entirely because the
  materialized page keeps the existing `textureRefId`.
- `atlas-layout.ts` currently generates candidates from source sizes up to
  `maxTextureSize`; page-local growth needs a minimum page-size floor so it does
  not shrink an existing page during repack. Add that as explicit policy rather
  than inferring it from locked pages.
- Current texture placement updates only resolve incoming `textureUseId`s.
  Page-local repack moves existing rects, so the repack helper must return
  `ResolvedTexturePlacement` rows for every moved alias and every inserted
  texture use.
- Existing aliases may share one physical source but differ in authored wrap
  policy. Repacking must choose the original physical materialization policy for
  the unique source, not an arbitrary alias policy, or gutter pixels can change
  by accident.
- `placeTextureIntents()` also uses the packing path before renderer ownership
  exists. If a pre-bake placement intent triggers page-local repack, placement
  records for moved old aliases still need to update even though no renderer
  update is emitted.

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
- Page-local repack may quietly become whole-bucket repack if the candidate
  source collection is not tightly bounded.
  Mitigation: candidate inputs must be one physical page plus incoming compatible
  entries; tests assert unrelated pages do not move.
- Moving existing rects requires complete renderer placement invalidation for
  every alias on the repacked page.
  Mitigation: derive moved logical texture uses from registry aliases and assert
  every affected `textureUseId` appears in `resolvedTexturePlacements`.

## Definition Of Done

- `npm run test:ts`
- `npm run check`
- `npm run lint`
- Atlas diagnostics show fewer dead ownerless pages after churn.
- Renderer resources resolve placements by `textureUseId`; durable bindings no
  longer expose `pageSlot`.
- Two-wave compatible atlas placement can reuse a prior page when vacancy
  exists.
- Page-local repack/grow fixes unlucky early-page sizing without whole-bucket
  repack.
- No whole-bucket repack or palette-specific branch is introduced.

## Open Questions

- Should diagnostics expose page runway separately from occupied pixels, or is
  current packing efficiency enough?
- Is conservative "dirty all prepared payloads on page replacement" acceptable
  long term, or should a later optimization add reverse page-to-owner tracking?
