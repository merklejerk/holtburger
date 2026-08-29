# Plan: Resident Atlas Incremental Publication

## Context & Boundaries

**Goal:** Make streaming-time texture cost proportional to inserted bytes by replacing
whole-page rebuild-and-republish with metadata-only releases and region-patch inserts.

**Motivation.** The resident atlas rebuilds any page whose placement list changes at all: one
insert or release triggers a full CPU recomposite of every retained source on that page, a new GPU
page resource, and release of the old one. Measured on a 2-landblock relocation
(`0xda55ffff` → `0xda57ffff`, radii 8/2, RX 7900 XT): **7 inserted textures (464 KB source)
caused 8 full page republishes (117 MB uploaded)**, 57 MB of source copies, and a 26.2 ms worst
single publication op — ~250x write amplification, and the dominant main-thread hitch during
streaming. This precedes and unblocks the
[generated scenery hybrid baking plan](holtburger-3d-generated-scenery-hybrid-baking-plan.md):
every streaming measurement that plan depends on (bake toll, follow mode, cutover A/B) currently
sits on this noise floor.

**In scope:**

- Release-only placement changes becoming metadata-only (no pixel work, no GPU work).
- Insertion-only placement changes becoming region patches (`texSubImage3D` into the existing
  page resource) built by the page-build worker at placement granularity.
- Compaction planning gated by a fragmentation policy instead of computed every epoch.
- Diagnostics and harness evidence for all of the above.

**Out of scope:**

- Changing the layout algorithm (`planStableAtlasLayout` is already stable/incremental).
- Changing page size, purpose partitioning, mip policy, or texture preparation.
- Any scenery/baking work — that is the other plan, sequenced after this one.

## Ground Truth

- `apps/holtburger-3d/src/lib/game/textures/atlas/resident-texture-atlas.ts` — epoch loop
  (`#synchronizePurpose`), rebuild (`#rebuildPurpose`, `#planPurposeRebuild`), full-page build
  (`#buildPage`), publish (`#publishPlan`).
- `apps/holtburger-3d/src/lib/game/textures/atlas/layout.ts` — the stable plan already reports
  `insertedKeys`/`releasedKeys` and retains placements immutably; free-rect reconstruction
  already reopens released regions.
- `apps/holtburger-3d/src/lib/game/textures/atlas/page-build.ts` + `page-build-worker.ts` —
  full-page compositing including per-placement gutters; the patch job reuses this compositing at
  region granularity.
- `apps/holtburger-3d/src/lib/game/textures/atlas/page-publication.ts` — resource creation,
  binding swap, superseded-page release. Each page is its own `TEXTURE_2D` resource (created by
  `createTexture2D`), **not** a layer of a texture array as this plan first stated.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts` — `texImage2D` upload
  and per-texture `generateMipmap`; `updateTexture2DRegions` adds the `texSubImage2D` path.
- Baseline capture: relocation sweep numbers above, recorded with configuration in the scenery
  plan's Decisions (2026-08-18 entries).

## Guarantees Deleted and Their Replacements

The rebuild-everything design silently provides these; each must have a named successor:

| Deleted guarantee                         | Replacement                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page pixels always match placement list   | Released regions keep ghost pixels; nothing samples unreferenced regions (UVs come only from live placements) and inserts overwrite holes. Harness validation mode compares a patched page against a full rebuild pixel-exact. |
| Releases shrink VRAM incidentally         | Empty pages are still dropped (metadata-only, free). Fragmented reclamation becomes compaction's sole job, triggered by an explicit reclaimable-fraction policy.                                                               |
| Published page resources are immutable    | Patches mutate live pages inside WebGL's ordered command stream. Placement metadata commits only after all region writes succeed; a consumer audit confirms nothing caches per-resource derived state.                         |
| Atomic swap on failure                    | A failed patch epoch falls back to the full-rebuild path, which survives as the compaction / context-restore / failure implementation — not a legacy mode.                                                                     |
| Full path exercised constantly, bugs loud | Patch compositing gets a metamorphic unit test (patch result must equal full-rebuild reference byte-for-byte) plus post-relocation screenshot comparison.                                                                      |

Known persisting cost: `generateMipmap` still runs after a patched page's regions are written
(GPU-internal work, no bus transfer; output identical to a full rebuild because level zero
matches). Because each page is its own texture, this is per patched page and cannot be batched
further — one regeneration per `updateTexture2DRegions` call, regardless of region count.

## North Stars

1. Streaming texture cost scales with inserted bytes, not resident bytes.
2. One publication contract: patch and full rebuild are two implementations of the same
   `StableAtlasLayoutPlan`; callers cannot observe which ran except through diagnostics.
3. Fail loudly, fall back cleanly: a patch that cannot be proven correct becomes a full rebuild,
   never a silent skip.
4. Compaction earns its runs: planning happens when fragmentation warrants it, not per epoch.
5. Every step lands with before/after relocation-sweep evidence, since noise reduction is the
   point.

## Phased Implementation

### Phase 1: Release-Only Fast Path

The publication layer already reconciles a "layout changed, no pixels built" page correctly:
`#nextPages` falls back to the existing GPU resource when no built page is supplied,
`#nextBindings` re-derives the binding table from plan placements (released keys drop out), and
`#releaseSupersededPages` frees only pages absent from the plan (covering the emptied-page case
with zero build work). The phase therefore reduces to the rebuild predicate.

**Deliverables:**

- In `#publishPlan`, change the `pagesToBuild` predicate from "layout changed"
  (`!pageLayoutsEqual`) to "page is new or carries a placement in `plan.insertedKeys`".
  Release-only pages flow through `publish()` with their resource retained and metadata swapped.
- Prove the key-immutability assumption this rests on: an `AssetTextureKey` must always map to
  the same pixel content, or "no inserted keys" could skip a genuinely needed rebuild. Verify at
  the key-derivation site and record the proof in Decisions; if the invariant does not hold,
  the predicate must incorporate content revision.
- Diagnostics: count metadata-only page updates distinctly from rebuilt pages, so the A/B can
  split release-driven from insert-driven republishes (today's counters cannot).

**Acceptance criteria:**

- Relocation sweep: eviction-driven page rebuilds drop to zero; `uploadedAtlasPageBytes` delta
  for a crossing reflects only insert-bearing pages.
- Unit tests cover release-only, release-to-empty, and mixed release+insert epochs (the last
  still rebuilds in this phase).
- Rendering unchanged: post-relocation screenshot comparison passes.

**Tasks:**

- [x] Classify per-page deltas — `pageRetainsOnlyPublishedPlacements` in
      `resident-texture-atlas.ts`; the empty case needed nothing (the planner drops empty pages
      and publication already releases their resources without a build).
- [x] Metadata-only publication path + diagnostics (`metadataOnlyPageUpdateCount` /
      `metadataOnlyAtlasPageUpdates`).
- [x] Unit tests (release-only skip, resource retention, binding removal, later-insert rebuild
      overwriting ghosts); release-to-empty was already covered by the existing physical-page
      test. Relocation sweep A/B recorded in Decisions.

### Phase 2: Insert Patches

**Deliverables:**

- Page-build worker patch job: composite only the new placements (content plus gutter region)
  into transferable region buffers. Reuses the existing per-placement compositing.
- Publication patch path: `texSubImage3D` each region into the existing page layer; commit
  placement metadata after all writes succeed; on any failure, discard and run the full-rebuild
  path for that page.
- Whole-array mip regeneration batched to once per settled epoch per purpose, with a diagnostic
  counter.
- Consumer audit (recorded in Decisions) confirming no caller caches derived state keyed on page
  resource identity.
- Metamorphic test: for generated layouts, patched page equals full rebuild byte-for-byte.
- Harness validation flag that runs both paths and compares, for use in future atlas work.

**Acceptance criteria:**

- Relocation sweep: `uploadedAtlasPageBytes` per crossing within the same order of magnitude as
  inserted source bytes; worst publication op no longer a streaming-hitch contributor
  (`longestAtlasPublicationDurationMs` small relative to the 26.2 ms baseline).
- Metamorphic test and post-relocation screenshot comparison pass.
- Full rebuild demonstrably still reachable (compaction test and forced-failure test).

**Tasks:**

- [x] Patch job type in page-build worker + region compositing (`buildAtlasPagePatch`,
      `AtlasPageWorkerJob` envelope; `blitSourceWithGutter` generalized to any destination rect so
      build and patch share one compositor).
- [x] Publication patch application with commit-after-success and rebuild fallback
      (`AtlasPagePayloads`, `#applyPatches` before resource creation, `#patchFallbackCount`).
- [x] Mip regeneration — one `generateMipmap` per patched page inside `updateTexture2DRegions`;
      per-purpose batching is impossible since pages are separate textures (see Ground Truth).
- [x] Consumer audit; metamorphic + failure-path tests; sweep A/B recorded in Decisions.

### Phase 3: Compaction Gating & Cleanup

**Deliverables:**

- Compaction planning triggered by a fragmentation policy (reclaimable fraction and/or
  eliminable-page count threshold) instead of every epoch; thresholds live in
  `frontend-tuning.ts`.
- Retune acceptance if needed: compaction is now the only reclaimer, so it must actually run
  under sustained streaming (watch `activeAtlasPageBytes` vs `residentSourceBytes`).
- Cleanup: remove per-epoch compact-plan computation, stale diagnostics vocabulary, and any
  scaffolding from Phases 1–2.

**Acceptance criteria:**

- A long relocation sequence (or follow-mode run, once available) holds
  `activeAtlasPageBytes` bounded relative to `residentSourceBytes` — no monotonic VRAM creep.
- Layout-worker compact-planning runs drop from once per epoch to policy-triggered only.

**Tasks:**

- [x] Compaction planning gate (`couldCompactionReducePages`) — an exact necessary-condition test,
      not a tuned threshold, so no new tuning knob was needed (see Decisions).
- [x] Sustained-streaming VRAM boundedness evidence recorded in Decisions, measured through a new
      harness `--relocate-sequence` flag.
- [x] Cleanup sweep (knip clean; `pageRetainsOnlyPublishedPlacements` from Phase 1 was subsumed by
      `classifyAtlasPageDisposition` and deleted; `AtlasPagePatchRegion` un-exported).

## Risks & Mitigations

- **Gutter/bleed correctness at patch boundaries.** Region compositing must reproduce exactly
  what full-page compositing produces for the same placement. _Mitigation:_ the metamorphic test
  is the gate; any divergence fails the build.
- **VRAM creep with metadata-only releases.** _Mitigation:_ Phase 3's fragmentation policy plus
  the boundedness acceptance run; until Phase 3 lands, compaction still gets its per-epoch
  evaluation.
- **Hidden resource-identity consumers.** Something may assume page resources never mutate.
  _Mitigation:_ Phase 2's audit is a deliverable, not a hope; findings recorded before the patch
  path ships.
- **Worker protocol churn.** A second job type complicates the page-build worker. _Mitigation:_
  patch jobs reuse the existing compositing internals; if the sharing turns out poor, prefer
  extracting a shared compositor over duplicating it.

## Definition of Done

- [x] Release-only epochs perform zero pixel and zero GPU work.
- [x] Insert epochs upload bytes proportional to inserted content; measured at zero full-page
      republishes per crossing. Full-page republish remains only for new pages, compaction,
      context restore, and patch failure.
- [x] Compaction planning is gated and provably reclaims under sustained streaming (five
      crossings, active page bytes flat).
- [x] Metamorphic, failure-path, and screenshot comparisons pass; 1160 unit tests, eslint, knip,
      and prettier clean. `npm run check` reports only two pre-existing
      `explorer-entity-tree.test.ts` errors, reproduced with these changes stashed.
- [x] Before/after relocation-sweep numbers recorded in Decisions with configuration.
- [x] The scenery plan's audit item for atlas churn points at this plan's outcome, and the commit
      densification finding is recorded there.

## Open Questions

- None currently.

## Decisions and Course Corrections

- (2026-08-18) **Quality pass after implementation, against an independent review.** The
  implementation had been lint/test/knip-clean throughout but never deliberately quality-reviewed.
  Fixes, most significant first:
  - **The patch fallback caught far too much.** The `try` wrapped source copying, every page build,
    and `publish()` itself, so an unrelated failure — a lost retained source, a failed
    `createTexture2D` — was relabelled `atlasPatchFallbacks` and the whole plan was redone, usually
    to fail identically after paying double worker and GPU cost. Now only the patch jobs are
    retryable (`#preparePayloads`), which is the only failure with a correct fallback; everything
    else propagates. Builds also no longer re-run on fallback.
  - **Patch metrics counted work that never landed.** `#patchedPageCount`/`#patchedRegionBytes`
    incremented inside `#applyPatches` before `#createResources` could throw, and
    `#metadataOnlyPageUpdateCount` incremented before the publication was attempted at all — so a
    failed attempt inflated exactly the counters meant to explain it. All three now commit after
    the publication they describe.
  - **`pageSize` optionality was the wrong shape.** Four `?? SHARED_FRONTEND_TUNING…pageSize` resolutions
    had accumulated, and the Phase 1 helper `resolveAtlasPageSize` institutionalized the implicit
    default instead of removing it. The fixture override now resolves once into a `readonly
#pageSize`, and the helper plus every `??` and optional-chain site is gone.
  - **Two `this.#physical!` assertions removed** by passing the resolved dependencies down from the
    caller that already established them, and a silent `if (publication === null) return;` in the
    publish path replaced with a loud throw.
  - **An unreachable validation clause deleted.** The new `validatePlacementFitsPage` made the
    bounds test inside `blitSourceWithGutter` unreachable from both callers — two error messages
    for one failure mode. The blit now documents that its callers own that check.
  - Deduplicated per-placement source validation (`resolveValidatedSource`) and texel-payload
    validation (`validateTexelPayload`, shared by full uploads and region writes); named the
    previously anonymous `WebGL2TextureFormat`; renamed `AtlasPagePatchRegion.pixels` to `data` so
    a region _is_ a `Texture2DRegionUpload` and the re-shaping map at the upload site disappeared.
  - **`publish()`'s doc no longer claims atomicity it lost.** It now states precisely what stayed
    atomic (page set, bindings, releases) and what lands before the swap (patched texels, in
    regions the published layout does not reference).
  - Harness: the eight-argument `requestSceneInterest` tuple had reached five copies — the same
    contract whose drift caused the seven-argument bug found in Phase 1 — now one
    `sceneInterestArgs` builder plus a `hopToLandblock` helper shared by both relocation paths;
    `--cpuprofile` renamed to `--cpu-profile` for consistency with every other flag in the file
    (docs swept); `--relocate-sequence` added to the mutual-exclusion guards it was missing and
    `--relocate-hop-ms` now errors without it.
  - Explorer: `ExplorerTexturesPanel` surfaces every atlas metric, and the four new ones were
    missing — during streaming it would have shown "0 uploaded · 0 released" with no sign that
    patching was doing the work. Added in-place patches, metadata-only updates, and patch
    fallbacks.
  - Test fixtures: replaced a `!` and two parallel maps in the fake device with one record per
    texture, deleted a subclass whose entire body was a default argument, and replaced
    `ReturnType<typeof …>` with the result types the interface already names.
    Verified after: 1160 unit tests, eslint, knip, prettier, and `svelte-check` clean; a live
    two-hop streaming run reports 21 patched pages, zero fallbacks, flat 70 MB active pages, no
    console errors, and a clean screenshot.

- (2026-08-18) **Phase 3 complete.** Compaction planning is gated by `couldCompactionReducePages`,
  which needed **no tuning knob**: allocation area is an exact lower bound on the pages any packing
  can occupy, so a layout already at that bound can never compact to fewer pages, and a bound above
  `maximumCompactionRebuildPages` can never yield an acceptable plan. Both are necessary conditions
  of `shouldAcceptCompaction`, so the gate cannot skip a compaction that would have been accepted —
  a fragmentation _heuristic_ (the plan's original wording) would have risked exactly that. Effect,
  same relocation sweep: compaction plans computed per run fell from **~135 to 0–1**, with the
  accepted count unchanged in distribution.

- (2026-08-18) **Sustained-streaming VRAM verified, not deferred.** The plan's acceptance asked for
  a long relocation sequence, which the harness could not express, so `--relocate-sequence` (with
  `--relocate-hop-ms`, and per-hop `resetTiming` so each crossing reports its own worst frame) was
  added. Five crossings, `0xda55ffff → 0xda57 → 0xda59 → 0xdc59 → 0xdc57 → 0xda55`, radii 8/2,
  RX 7900 XT:

  | hop        | active page MB | active/resident | compaction plans | patched region MB (cumulative) |
  | ---------- | -------------- | --------------- | ---------------- | ------------------------------ |
  | 0xda57ffff | 70             | 2.42            | 1                | 11.9                           |
  | 0xda59ffff | 70             | 2.55            | 1                | 13.2                           |
  | 0xdc59ffff | 70             | 2.69            | 1                | 14.2                           |
  | 0xdc57ffff | 70             | 2.44            | 2                | 14.6                           |
  | 0xda55ffff | 70             | 2.46            | 2                | 15.9                           |

  Active page bytes are flat at 70 MB and equal the observed peak, so metadata-only releases cause
  no VRAM creep across sustained crossings; the occupancy ratio oscillates without drifting.
  Streaming cost is now ~1 MB of patched regions per crossing. Zero patch fallbacks, zero failed
  transactions, zero console errors. This flag also satisfies the scenery plan's Phase 2 need for a
  scripted multi-boundary interest re-issue rig.

- (2026-08-18) **Debt: the returning hop is the expensive one.** Per-hop worst frames were 21.6,
  18.2, 22.2, 25.3, then **42.8 ms** on the hop returning to the origin landblock, which re-hydrates
  a neighborhood evicted four hops earlier. Same commit-densification mechanism recorded above, and
  more evidence that streaming smoothness needs a commit budget rather than more atlas work.

- (2026-08-18) **Phase 2 complete.** Insert-bearing pages are now patched in place. Relocation
  sweep A/B (`0xda55ffff` → `0xda57ffff`, radii 8/2, RX 7900 XT), crossing-window deltas, with
  repeated samples this time because single samples proved unreliable (see the correction below):

  | metric (per crossing)           | baseline (n=4) | phase 2 (n=5) |
  | ------------------------------- | -------------- | ------------- |
  | page republishes                | 8              | **0**         |
  | uploaded bytes                  | 117.4 MB       | **0 B**       |
  | patched region bytes            | —              | 703 KB        |
  | worker source copies            | 57.1 MB        | **549 KB**    |
  | atlas publication time (median) | 31.6 ms        | **1.9 ms**    |
  | patch fallbacks                 | —              | 0             |

  Both Phase 2 acceptance criteria are met and then some: uploads per crossing are not merely
  proportional to inserted bytes, they are zero — every crossing page was patchable. Initial load
  also fell from 143 MB to 92 MB uploaded. No console errors; post-relocation screenshot clean.

- (2026-08-18) **Correction: the Phase 1 frame-hitch claim was noise.** Phase 1 recorded worst
  frame work falling 38.8 → 20.1 ms from single samples. Repeated baseline sampling shows the
  baseline median is **20.0 ms** (range 18.5–38.8) — the 38.8 ms figure was an outlier, and
  Phase 1's apparent hitch win did not exist. Phase 1's real, reproducible win is the elimination
  of release-driven republishes; its byte and publication-time numbers stand. Standing rule for
  the rest of this plan: **no streaming timing claim from a single sample.**

- (2026-08-18) **Discovered debt: commit work is unbudgeted, and the atlas was accidentally
  rate-limiting it.** Despite removing 117 MB of uploads and ~30 ms of publication time per
  crossing, worst-frame time did not improve and appears slightly worse (baseline median 20.0 ms,
  n=4; phase 2 median 25.7 ms, n=5). The increase is entirely in the tick, not the frame's render
  (`longestRenderMs` is unchanged at ~10–11 ms in both), and mean tick cost is identical — it is a
  taller peak, not more sustained work. Verified mechanism: `static-layer-realizer.ts` publishes a
  layer only after `Promise.all([geometry, atlasHandle.completion, companion])`, so texture
  readiness gates geometry publication. A slow atlas staggered those publications; a fast atlas
  lets several land in the same tick. The work is not new — it is merely no longer spread.
  Consequence: streaming smoothness now needs an explicit commit budget or spreading policy, which
  is out of scope here and belongs with the scenery plan's follow-mode work, where sustained
  crossings will make it obvious. Recorded there as well.

- (2026-08-18) **Concession: the harness patch-validation flag was dropped.** The plan asked for a
  harness mode running both paths and comparing. Validating a patched page against a rebuild
  requires retained page pixels, and the codebase deliberately refuses to keep a CPU-side texture
  cache (`getAtlasPageDiagnostics` documents exactly that). Instead the same guarantee is proven
  where it is cheaper and exact: `page-build.test.ts` asserts that applying a patch's regions to a
  published page yields byte-identical bits to a whole-page rebuild, and
  `resident-texture-atlas.test.ts` asserts the same end to end through the real publication path
  with an in-memory device, using an 8px gutter and distinct per-source pixels so a misplaced
  region cannot compare equal.

- (2026-08-18) **Consumer audit result: no resource-identity assumptions.** `getAtlasBinding`
  consumers resolve the WebGL handle per use through `#prepareObjectTextureBinding`, and patching
  mutates that same handle's contents, so retained handles observe updates with no invalidation
  step. Sampler selection keys on `mipLevels`, which patching does not change. The one live
  consumer of page identity is the Explorer's on-demand page readback
  (`getTextureAtlasPageResource`), which reads current device state and will now show ghost texels
  in released regions — the documented consequence, not a defect.

- (2026-08-18) **Design note: one compositor, two shapes.** `blitSourceWithGutter` now writes into
  any destination rectangle, so a patch region is literally the same code path a full build uses
  for that placement, with the destination being the allocation rect instead of the page. A patch
  region always spans the placement's full allocation bounds (content plus gutter ring), which is
  why patched and rebuilt pages agree bit for bit.

- (2026-08-18) **Phase 1 complete.** Key-immutability proven: `AssetTextureKey` is
  `asset-texture:{purpose}:{sourceAssetId}` over immutable DAT assets
  (`types.ts` `createAssetTextureKey`), and `#prepareSource` already reuses resident sources by
  key (`avoidedPreparationCount`) — the atlas has always depended on the invariant. Relocation
  sweep A/B (`0xda55ffff` → `0xda57ffff`, radii 8/2, RX 7900 XT), relocation-window deltas:
  | metric | before | after |
  | --- | --- | --- |
  | page republishes | 8 | 5 (3 metadata-only) |
  | uploaded bytes | 117.4 MB | 75.5 MB |
  | copied source bytes | 57.1 MB | 41.5 MB |
  | publication time | 33.1 ms | 18.2 ms |
  | worst frame work / gap | 38.8 / 46.2 ms | **20.1 / 27.2 ms** |
  3 of the 8 crossing republishes were release-driven and now cost nothing; initial load also
  dropped 143 → 117 MB uploaded. Post-relocation screenshot renders clean. The remaining 5
  insert-driven full-page republishes (75 MB) are Phase 2's target.

- (2026-08-18) Plan created from the atlas churn findings recorded in the scenery plan's
  Decisions (2026-08-18). Sequenced **before** the scenery plan's remaining phases at the
  user's direction, so streaming measurements happen against a clean noise floor.
- (2026-08-18) **Debounce/aggregation considered and rejected as the primary fix.** Rapid layer
  commits are the trigger (54 commits → ~35 rebuild cycles in the relocation sweep; the epoch
  loop's implicit coalescing is weak), but the write amplification is per-page, not per-event: a
  perfectly aggregated single rebuild for the measured crossing would still reprint the same ~8
  touched pages (~117 MB). Debouncing also delays texture availability, trading a hitch for
  visible fallback pop-in. Once epochs cost ~inserted bytes (Phases 1–2), epoch frequency is a
  rounding error; the frequency-shaped residues are already covered (mip regen batched per
  settled epoch, compact planning gated in Phase 3). Revisit only if post-Phase-2 sweeps show
  planning round-trips themselves as a measurable cost.
- (2026-08-18) Phase 1 design refined after reading `page-publication.ts`: reconciliation
  already supports resource-retained metadata updates, so the fast path is a rebuild-predicate
  change rather than a new publication path. The atomic-swap and immutable-resource guarantees
  are untouched until Phase 2. Added the `AssetTextureKey` content-immutability proof as a
  Phase 1 deliverable — the predicate's correctness rests on it.
- (2026-08-18) Full rebuild is retained as the compaction / context-restore / failure
  implementation rather than deleted — patching is a fast path over the same plan contract, not
  a second mode.
