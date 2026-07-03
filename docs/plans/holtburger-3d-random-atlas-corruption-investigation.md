# Holtburger 3D Random Atlas Corruption Investigation

Date: 2026-07-03
Status: root cause identified and fix implemented; awaiting user repro validation in the 3D client.

## Purpose

Track the investigation into order-dependent wrong-texture rendering in `apps/holtburger-3d`, especially while follow-mode scene interest moves across landblocks. This is an investigation log, not a completed fix note.

The current git state contains the work performed during this bug hunt. Keep this file updated before changing direction so the next pass does not rediscover the same theories.

## Current Symptom

Some static objects and terrain render with apparently unrelated atlas regions. The failure is not fully deterministic; it depends on movement, landblock load order, and which scene-interest waves were committed first.

Observed examples include:

- `outdoor-explicit-objects`, landblock `0xdc56ffff`, instance `landblock-static/dc56ffff/object/0003/02000248`, setup model `02000248`, expected primary texture `06003ec4`.
- `outdoor-buildings`, landblock `0xdb56ffff`, building `01001117`, multiple base/detail texture placements.
- Terrain in landblock `0xd956ffff`, where the rendered output looked like the terrain mask path was wrong or missing.

Important visual evidence:

- The object selected in the atlas inspector appeared to have the correct source texture in the expected atlas page.
- The wrong rendered texture did not obviously appear in that inspected CPU-side atlas page.
- Disabling mipmaps did not fix the issue and is not an acceptable fix.

## Current Worktree Scope

Modified files:

- `apps/holtburger-3d/src/lib/renderer/types.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.test.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.test.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.test.ts`
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
- `apps/holtburger-3d/src/lib/textures/texture-manager.test.ts`

Temporary probe file removed before committing:

- `apps/holtburger-3d/src/lib/textures/pixel-hash.ts`

## Evidence Collected

For the recurring `0xdc56ffff/object/0003/02000248` case:

- Draw unit geometry had `texCoordBounds` of `[0, 0]..[1, 1]`.
- Draw unit geometry had `materialSlots: [0]` and `materialSlotBounds: { min: 0, max: 0 }`.
- Latest texture manager placement resolved the expected base-color texture use to rect `[4, 260, 128, 256]` on a `2048x2048` page.
- Renderer prepared material payload reported the same base-color rect and same texture ref.
- Renderer prepared material payload reported `wasPreparedPayloadDirty: false`.
- First CPU/GPU hash report for this object:
  - CPU `rectPixelHash`: `9f857641`
  - GPU same numeric rect `pixelHash`: `fdd1430e`
  - GPU same numeric rect row-flipped `yFlippedPixelHash`: `069d102e`
- Follow-up CPU/GPU hash report for the same object:
  - CPU `rectPixelHash`: `9f857641`
  - GPU same numeric rect `pixelHash`: `102a1312`
  - GPU same numeric rect row-flipped `yFlippedPixelHash`: `24d395ca`
  - GPU mirrored-Y rect `mirroredYPixelHash`: `e5ea2a22`
  - GPU mirrored-Y rect row-flipped `mirroredYFlippedPixelHash`: `e5ea2a22`
- None of the GPU hashes matched the CPU rect hash. This proves the texture manager CPU page and the WebGL texture object diverged for the same texture ref and rect.

This strongly argues against:

- Material-slot attribute drift within the selected draw unit.
- UVs escaping the logical texture rect.
- The runtime selection diagnostic reading an obsolete renderer payload.
- The texture manager resolving a different rect than the renderer prepared payload.

It does not yet prove:

- The actual draw call binds the texture object reported by the prepared payload.
- The shader samples the rect through the expected object-material path.

The WebGL texture object does not contain the same pixels as the texture manager CPU page for the broken report above, so upload/revision/lifetime is the primary path.

## Theories

### 1. Repack Alias Invalidation

Theory: page-local repack moved a shared physical source but only emitted placement updates for one logical texture use id. Other logical aliases continued to point at stale rect/page data.

Evidence:

- Texture manager had shared physical sources with multiple logical texture use ids.
- Repack code previously updated `existingEntry.itemId` directly, which could miss aliases that share the same registry entry.
- The symptom is order-dependent, which is consistent with stale alias updates after incremental repacks.

Implemented fix:

- `TextureManager` now discovers all logical texture use ids for a registry entry during page-local repack.
- Repack records placement state for every alias and emits `ResolvedTexturePlacement` for every alias.
- Added regression test: `updates every logical alias when page-local repack moves a shared physical source`.

Current status:

- This is a real bug class and the fix should stay.
- User still reproduced corruption after this line of work, so it is not sufficient.

### 2. Raw WebGL Calls Invalidated the State Cache

Theory: scene-domain target allocation used raw `gl.bindTexture` / `gl.bindFramebuffer` calls, but the renderer state cache still believed object atlas textures were bound. A later object draw could skip rebinding the atlas and sample whatever texture raw allocation left on the unit.

Evidence:

- `createSceneDomainTargets()` allocates textures/framebuffers outside `Webgl2StateCache`.
- Follow mode and portal/interior rendering can allocate or resize scene-domain targets while static resources remain resident.
- The symptom looked like a valid texture page was sampled through the wrong binding.

Implemented fix:

- `Webgl2Renderer.#ensureSceneDomainTargets()` invalidates `#stateCache` after scene-domain target creation.
- Added regression test: `invalidates cached texture bindings after scene-domain target allocation`.

Current status:

- This is a real renderer hygiene bug and the fix should stay.
- User still reproduced corruption after this fix, so it is not sufficient.

### 3. CPU Atlas Page Correct, GPU Texture Object Wrong

Theory: the texture manager and atlas inspector show correct CPU pixels, but the WebGL texture object bound for the page was not uploaded, replaced, or retained correctly.

Evidence:

- User visually inspected the reported atlas page and found the expected texture at the expected rect.
- The wrong rendered texture did not appear in that inspected page.
- Prepared payload and texture manager agreed on rect and texture ref.

Diagnostics added:

- `TexturePlacementResolutionSnapshot` now reports `format` and `rectPixelHash`, a cheap FNV-1a hash over the CPU-side runtime page rect.
- Renderer object-material diagnostics now include `textureRectProbes`, which probe the WebGL texture object with `gl.readPixels`.
- The probe reports `pixelHash`, `yFlippedPixelHash`, `mirroredYPixelHash`, and `mirroredYFlippedPixelHash` so texture row-origin and framebuffer-coordinate differences do not masquerade as corruption.
- Shared hashing lives in `src/lib/textures/pixel-hash.ts` so CPU and GPU hashes use the same algorithm.

How to interpret the next broken-object report:

- If `texturePlacements[].rectPixelHash` matches any GPU probe hash, the WebGL texture object contains the expected rect pixels. Continue with draw-time binding/shader-state investigation.
- If `texturePlacements[].rectPixelHash` matches none of the GPU probe hashes, the CPU atlas inspector and WebGL texture object disagree. Continue with upload, replacement, page reclamation, and texture-ref lifetime investigation.

Confirmed root cause:

- `placeTextureIntents()` can mutate or absorb into an existing live atlas page during pre-bake/offline placement.
- That pre-bake path returns planned placements to the caller, but it does not emit a `TexturePlacementUpdate` to the renderer, so the WebGL page is not uploaded.
- Later, `applyStaticCommitDelta()` can activate the already-existing ownerless entry.
- The previous first-activation upload guard skipped upload when any sibling entry on the same texture ref already had a live lease.
- That made the commit publish a correct rect and texture ref while leaving the WebGL texture object at the older page contents.

Implemented fix:

- `TextureManager` now tracks the last uploaded `placementRevision` per `textureRefId`.
- First activation of an ownerless existing entry uploads its runtime page when that exact texture ref revision has not already been emitted.
- Texture ref deletion clears the uploaded-revision marker.
- Added regression test: `uploads a live page when committing an offline placement absorbed into it`.

Current status:

- This is the best fit for the CPU/GPU hash divergence and order-dependent repro.
- Awaiting fresh in-client validation after this fix.

### 4. Actual Draw-Time Binding Differs From Prepared Payload

Theory: prepared payload diagnostics are correct, but the final draw path binds a different texture object, skips a bind due to cached state, or uses stale program/uniform state.

Evidence:

- Prepared payload shows the expected rect and texture ref.
- Wrong rendering can show several atlas regions on one part, which is consistent with sampling a full atlas through incorrect rect math or the wrong texture object.
- State-cache invalidation after scene-domain allocation did not fully fix the issue, so another raw WebGL path or cached binding mismatch may still exist.

Current status:

- Deprioritized for the current object-material bug because CPU/GPU hashes differed.
- Revisit only if the latest fix still reproduces with matching CPU/GPU hashes or if a draw-time diagnostic contradicts the upload-revision explanation.

### 5. Terrain Mask Path Has a Related But Separate Bug

Theory: terrain corruption may involve mask/color/detail layering rather than object-material base-color binding.

Evidence:

- User observed terrain that looked like the mask was not applied.
- Current GPU rect probe only targets object-material base-color textures, because that is the proven failing path for the selected static object.

Current status:

- Keep terrain as a separate follow-up unless object-material hash results implicate shared texture upload/ref lifetime.
- Do not broaden diagnostics to terrain before the object path has a clear result.

## Ruled Out Or Deprioritized

Mip bleed:

- Disabling mips did not fix the issue.
- The symptom includes entire wrong regions on a part, not edge bleed.
- Disabling mips is not an acceptable workaround.

Material slot leak for the selected object:

- Geometry diagnostics showed a single slot, slot `0`, across the selected draw unit.

UV range escape for the selected object:

- Geometry diagnostics showed UV bounds `[0, 0]..[1, 1]`.

Texture manager versus prepared payload rect mismatch:

- Both reported the same rect for the recurring object case.

## Code Smells Found During Investigation

The bug hunt exposed several design smells that made this harder than it should be:

- Logical texture use ids and physical texture refs were not consistently surfaced together, making alias and page-ref reasoning too implicit.
- Repack code mutated physical entries but had to rediscover logical aliases after the fact.
- Raw WebGL calls existed beside a state cache without explicit invalidation at every boundary.
- Diagnostics initially stopped above the GPU object, so the system could say "rect is correct" without proving that the WebGL texture contained the rect.
- Tests around old placement assumptions were too easy to satisfy without proving alias correctness across repack.

## Implemented Diagnostics And Fixes

Texture manager:

- Added `TexturePlacementResolutionSnapshot`.
- Fixed page-local repack to update every logical alias for a moved shared physical source.
- Fixed offline/pre-bake activation to upload an existing live page when the current placement revision has not yet reached the renderer.
- Added alias repack regression coverage.
- Added offline placement activation upload regression coverage.

Runtime selection diagnostics:

- Added draw unit geometry diagnostics: UV bounds, material slot bounds, and sampled material slots.
- Added texture placement diagnostics per draw unit.
- Added renderer texture diagnostics per selected draw unit.

Renderer:

- Added `Renderer.createObjectMaterialTextureDiagnostics()`.
- Exposed texture refs on object-material prepared texture bindings.
- Added object-material entry diagnostics for rects, wrap mode, detail enablement, and bound texture refs.
- Invalidated cached WebGL state after scene-domain target allocation.
- Added regression coverage for the scene-domain target state-cache invalidation.

## Structural Follow-Up Implementation Plan

Goal: replace the current fix scaffolding with explicit texture page revision ownership so offline planning, repack, upload, and draw-time resolution share one contract.

### Debug/Fix Separation Strategy

The investigation branch mixed three kinds of changes:

- durable bug fixes, such as stale page upload handling, alias repack updates, and WebGL state-cache invalidation;
- stable diagnostics, such as selected draw unit geometry, resolved placements, page versions, and renderer binding summaries;
- temporary probes, such as CPU/GPU rect hashes and framebuffer readback helpers.

The plan treats those differently. Durable fixes stay. Temporary probes are deleted, not hidden behind flags. Stable diagnostics may stay only when they expose renderer contracts that are useful after the refactor; if a type change makes the same invariant structurally obvious, the diagnostic should shrink or disappear.

Implementation rule:

- Each phase should separate cleanup from structural change where practical. If a phase removes an incident-only diagnostic, commit that deletion with the phase that made the diagnostic unnecessary.
- Do not keep tests for deleted probes, old partial placement shapes, or debug-only accounting.
- Do not preserve a diagnostic field merely because a runtime panel currently displays it. The runtime panel is a low-priority consumer compared with clean texture/page ownership.

### Pre-Structural Commit Cleanup

Before committing the current investigation work or starting the structural phases, split temporary diagnostics away from durable fixes.

Status: completed before the corruption-fix checkpoint commit.

Deliverables:

- Remove temporary GPU probe plumbing:
  - `rendererTextures.textureRectProbes`,
  - framebuffer/readback probe helpers,
  - mirrored/flipped hash fields,
  - tests that assert probe output.
- Remove temporary CPU rect hash diagnostics and the shared `pixel-hash.ts` helper if no durable diagnostic path still needs it.
- Keep durable diagnostics that are cheap and structurally useful:
  - resolved texture placements,
  - texture refs/page versions once available,
  - selected draw unit geometry/material slot bounds if they remain useful for inspection.
- Keep durable fixes:
  - revision-aware texture page upload,
  - alias repack update,
  - WebGL state-cache invalidation.
- Keep regression tests that prove durable fixes.
- Update this investigation doc to record that probe diagnostics were removed before committing.

Completed cleanup:

- Removed `rendererTextures.textureRectProbes` from renderer diagnostics.
- Removed GPU framebuffer/readback probe helpers and mirrored/flipped hash fields.
- Removed CPU rect hash reporting from `TexturePlacementResolutionSnapshot`.
- Removed `apps/holtburger-3d/src/lib/textures/pixel-hash.ts`.
- Kept stable selection diagnostics: draw unit geometry bounds, resolved texture placements, renderer material rects, texture bindings, and payload dirty status.

Acceptance criteria:

- The working tree no longer contains temporary GPU probe/readback code.
- No normal selection diagnostic contains probe-only hashes.
- Tests pass after probe removal.
- The remaining diff is a clean checkpoint suitable for a fix commit before structural refactoring.

Suggested commit boundary:

- Commit the cleaned current checkpoint as the corruption fix and investigation plan.
- Start the structural phases in later commits.

### North Stars

- A texture page mutation must produce a page identity that cannot be mistaken for an already-uploaded page.
- Renderer-visible placement state must carry page revision identity directly, not infer freshness from leases or texture ref liveness.
- Offline/pre-bake placement must not mutate renderer-owned page state invisibly. If it can affect a live page, that mutation must be represented as pending page content with an explicit later upload.
- Logical texture uses and physical atlas entries must be related through a first-class alias set, not rediscovered by parsing texture keys after mutation.
- Diagnostics should prove invariants while the system is under repair, then shrink back to stable debug surfaces. No permanent probe zoo.
- Tests should verify structural invariants and externally observable behavior. Delete or rewrite tests that only preserve old coordinate choices, stale internals, or temporary diagnostics.

### Phase 1: Model Texture Page Revision As A First-Class Identity

Status: completed.

Deliverables:

- Introduce a compact composite type for renderer-visible page identity, tentatively `TexturePageVersion`, containing `textureRefId` and `placementRevision`.
- Thread `TexturePageVersion` through `RuntimeTexturePlacement`, `ResolvedTexturePlacement`, and renderer binding records.
- Use page-version comparisons at the mutation/update boundary. Keep the private uploaded-version map temporarily until Phase 2 makes planned mutations explicit.
- Keep `textureRefId` available where renderer texture-object lookup needs it, but avoid passing a bare ref where freshness matters.

Completed implementation:

- Added `TexturePageVersion` to renderer contracts.
- Added `pageVersion` to uploaded texture placements, resolved texture placements, object-material texture bindings, renderer binding diagnostics, and texture-manager placement resolution snapshots.
- Updated terrain detail placement compatibility to compare page versions.
- Updated placement test factories and assertions so resolved rects are proven to carry the page version that owns them.

Acceptance criteria:

- A placement resolver cannot hand the renderer a rect without also carrying the page version that owns the pixels.
- Upload decisions compare page versions directly.
- Existing object-material and terrain payload builders compile without reconstructing page freshness from independent fields.

Test strategy:

- Replace the current offline activation regression with a test that asserts an offline mutation produces a newer `TexturePageVersion` and commit emits that version.
- Keep the behavior covered, but stop asserting the implementation detail that a side map noticed the revision.

Decision:

- Kept `#uploadedPlacementRevisionByTextureRefId` for now. This is intentional phase debt: until Phase 2 makes planned/offline mutations explicit, the side map is still the only durable record of which page versions have actually reached the renderer.

Debt:

- `textureRefId` and `placementRevision` still exist beside `pageVersion` on renderer-visible records. Later phases should collapse call sites toward `pageVersion` and leave bare refs only for physical WebGL texture lookup, sampler policy updates, removals, and debug labels.

### Phase 2: Separate Planned Atlas Mutations From Committed Renderer Pages

Status: completed.

Deliverables:

- Split the result of `placeTextureIntents()` from committed runtime uploads. The planned path should return placement lookups, but any live-page mutation it performs must be represented as staged page content that is not silently considered renderer-current.
- Make the commit path the only path that marks a page version uploaded to the renderer.
- Audit page-local absorption and repack so both paths return the same explicit mutation object instead of manually pushing runtime placements from multiple branches.

Completed implementation:

- Added explicit unuploaded page-version tracking for texture placements produced by `placeTextureIntents()`.
- Commit activation now consumes an unuploaded planned page placement and emits that exact page version to the renderer.
- Removed the previous uploaded-revision side map.
- Texture ref deletion and successful uploads clear pending unuploaded placements.

Acceptance criteria:

- Calling `placeTextureIntents()` can never make renderer upload state stale by itself.
- `applyStaticCommitDelta()` and `applyDynamicTextureUseDelta()` are the only public mutation paths that produce renderer upload updates.
- A planned placement that later becomes owned must either reuse an already-uploaded matching page version or emit the page upload in the same commit update.

Test strategy:

- Rewrite the current offline activation test around public behavior:
  - place an inactive texture into a page that already has a live owner,
  - commit that texture later,
  - assert the commit emits a page upload with the same page version used by resolved placements.
- Delete tests that only assert exact fake-packer coordinates when they are not behavioral requirements.

Decision:

- Kept registry mutation during planning for this phase. A pure immutable planning model would be a larger architectural cutover and is not required now that unuploaded page versions are explicit.

Debt:

- Packing, absorption, and repack still return separate placement/result arrays from several branches. Later alias-set work should consolidate those around a single mutation object.

### Phase 3: Make Alias Sets Explicit

Status: completed.

Deliverables:

- Add a registry-level physical entry record with:
  - physical source key,
  - page version,
  - rect,
  - page policy,
  - set of logical texture use ids.
- Store aliases as data on the physical entry instead of rediscovering them from `registry.entries` and parsing `VisualTextureKey`.
- Scope alias sets by physical source plus compatible page policy. Same pixels with incompatible wrap/sample/page behavior must not collapse into one alias set.
- Change repack and page-local absorption to update the physical entry once, then emit resolved placements for its alias set.

Completed implementation:

- Added `VisualTexturePhysicalEntry` as the shared committed placement record behind logical `VisualTextureRegistryEntry` aliases.
- Moved the committed alias set onto `VisualTexturePhysicalEntry.textureUseIds`.
- Changed alias creation to add logical texture-use ids to the shared physical entry instead of relying on registry-key parsing.
- Changed page-local repack, placement resolution, page inspection, and atlas diagnostics to read page/rect/revision data from the shared physical entry.
- Removed `parseTextureUseIdFromVisualTextureKey`; repack now emits moved placements from the explicit alias set.
- Strengthened the alias repack regression so both logical aliases must resolve to the moved page version.

Acceptance criteria:

- Repack code does not parse texture keys to recover logical aliases.
- Adding an alias and moving a physical entry use the same alias set.
- It is impossible to move a shared physical source and update only one logical texture use id without failing type-level or helper-level invariants.

Test strategy:

- Replace `updates every logical alias when page-local repack moves a shared physical source` with a smaller test against the alias set invariant plus one integration test for repack.
- Keep coverage for the bug class, but remove the diary-style registry archaeology once aliases are explicit.

Debug cleanup:

- Remove any diagnostics or tests that only exist to prove aliases can be rediscovered by parsing texture keys.
- Keep resolved-placement diagnostics only if they report the explicit alias set/page-version relationship rather than the old inferred registry shape.

Decision:

- Kept logical `VisualTextureRegistryEntry` records for ownership, wrap/material policy, and lease counting, but made every logical alias point at a shared `VisualTexturePhysicalEntry` for page content, rect, revision, and alias-set state. This is the clean cut for the bug class without forcing Phase 4's payload/binding collapse into the same commit.

Debt:

- `VisualTextureRegistryEntry` still carries some mirrored physical fields (`textureRefId`, `rect`, `textureWidth`, `textureHeight`, `placementRevision`, and related diagnostic fields) for older call sites. Phase 4 should either delete those fields or confine them behind accessors so renderer payloads cannot combine stale logical copies with current physical placement state.
- `physicalEntryId` is intentionally stable across repacks (`textureRefId|physicalSourceKey`) and does not encode rect. If a later phase needs per-revision identity, use `TexturePageVersion` rather than overloading this id.

Verification:

- `npm run test:ts -- --run src/lib/textures/texture-manager.test.ts` passed.
- `npm run test:ts -- --run src/lib/runtime/client-runtime.test.ts src/lib/textures/texture-manager.test.ts src/lib/renderer/webgl2/webgl2-object-material-payloads.test.ts src/lib/renderer/webgl2/webgl2-terrain-payloads.test.ts src/lib/renderer/webgl2/webgl2-renderer.test.ts src/lib/runtime/static-commit-installer.test.ts` passed.
- `npm run check` passed.
- `npm run lint:ts` passed.
- `git diff --check` passed.

Resteering after Phase 3:

- Phase 4 still makes sense, but it should start by deleting or confining mirrored physical fields on `VisualTextureRegistryEntry`; otherwise page-version payload work will continue to have two possible sources of truth.
- The explicit alias set removed the need for registry-key parsing during repack. It did not remove the need for conservative dirtying yet.
- Terrain and object-material paths already receive page versions, but they still consume placements through separate payload builders. Phase 4 should make those builders consume one production placement shape rather than hand-assembled fields.

### Phase 4: Collapse Placement And Binding Inputs Around Page Version

Status: completed.

Deliverables:

- Update object-material and terrain payload builders to consume a placement object that includes page version, rect, and texture role together.
- Move `pageSlot` allocation behind renderer-local draw preparation, keyed by page version where freshness matters and by texture ref only where a physical WebGL object is sufficient.
- Audit uses of `textureRefId` in renderer maps and split them into:
  - physical texture object lookup,
  - page-version freshness checks,
  - debug labels.

Completed implementation:

- Removed mirrored physical placement fields from `VisualTextureRegistryEntry`; logical aliases now carry ownership/material policy while `VisualTexturePhysicalEntry` is the only source for page content, rect, dimensions, texture ref, and placement revision.
- Updated planned placement snapshots, absorption, repack, retention, deletion, sampler-policy updates, and diagnostics to read physical placement state from `physicalEntry`.
- Changed object-material payload prep to build an `ObjectMaterialResolvedTextureResource` map that couples `ResolvedTexturePlacement` with the resident `WebGLTexture` once at the draw-prep boundary.
- Changed terrain payload prep to build a `TerrainResolvedTextureResource` map and use it for page binding, detail texture resolution, rect writes, and page-slot resolution.
- Left physical WebGL texture lookup keyed by bare `textureRefId`; that is still the correct physical object lookup key.

Acceptance criteria:

- Draw unit payload code cannot combine a rect from one page revision with a texture binding from another.
- Terrain and object-material placement resolution use the same page-version shape.
- Any remaining bare `textureRefId` use is local to texture object storage, page slot reuse, or debug output.

Test strategy:

- Update payload tests to build placements through the shared page-version helper.
- Delete tests that manually fabricate partial `ResolvedTexturePlacement` shapes once those shapes are no longer valid.

Debug cleanup:

- Revisit `rendererTextures` selection diagnostics after the shared placement input exists.
- Keep page version, role, rect, dimensions, and texture binding summaries if they mirror the real payload contract.
- Delete fields that duplicate production state only because older call sites accepted incomplete placement records.

Decision:

- Kept `ResolvedTexturePlacement.textureRefId` beside `pageVersion` for now because texture-object lookup still naturally uses the physical ref. Freshness comparisons and diagnostics should use `pageVersion`.
- Kept terrain page slots keyed by `textureRefId` inside draw prep. The slot is renderer-local binding state; Phase 4 made the resolved placement resource coherent before slot allocation rather than making slots globally versioned.

Debt:

- Object and terrain resource-map helpers are currently local and structurally similar. If another payload path needs this shape, extract a shared renderer-local helper instead of duplicating a third copy.
- Selection diagnostics still expose renderer texture binding summaries. They now mirror production payload state, but Phase 6 should trim any field that stops matching a production composite type.

Verification:

- `npm run test:ts -- --run src/lib/runtime/client-runtime.test.ts src/lib/textures/texture-manager.test.ts src/lib/renderer/webgl2/webgl2-object-material-payloads.test.ts src/lib/renderer/webgl2/webgl2-terrain-payloads.test.ts src/lib/renderer/webgl2/webgl2-renderer.test.ts src/lib/runtime/static-commit-installer.test.ts` passed.
- `npm run check` passed.
- `npm run lint:ts` passed.
- `git diff --check` passed.

### Phase 5: Renderer State Boundary Audit

Deliverables:

- Inventory raw WebGL state mutations outside `Webgl2StateCache`.
- Either move them behind the cache or require explicit invalidation at each boundary.
- Add a small helper for operations that intentionally bypass the cache so invalidation is not caller folklore.

Acceptance criteria:

- Scene-domain target allocation is not a one-off special case.
- A search for raw `gl.bindTexture`, `gl.bindFramebuffer`, and similar stateful calls has an explicit explanation or wrapper at each site.
- Renderer tests cover the state-cache invalidation helper, not every individual caller.

Test strategy:

- Keep one state-boundary regression for scene-domain target allocation until the helper exists.
- After the helper lands, replace caller-specific tests with one helper-level test plus one integration test.

Debug cleanup:

- Do not add broad WebGL trace diagnostics as a substitute for a state-boundary abstraction.
- If a runtime diagnostic is needed, expose the wrapper/helper state at the boundary, not raw per-draw probe data.

### Phase 6: Diagnostics Cutover And Probe Cleanup

Deliverables:

- Finish the diagnostic split started before the structural phases.
- Keep stable diagnostics only where they expose active renderer contracts:
  - selected draw unit geometry bounds,
  - resolved texture placements,
  - texture refs/page versions used by prepared payloads.
- Remove incident-only diagnostics:
  - GPU rect readback probes,
  - per-rect CPU hashes,
  - mirrored/flipped hash variants,
  - alias rediscovery output,
  - any fields that exist only to debug this incident or bridge old placement shapes.
- Delete the current GPU probe plumbing instead of preserving it behind a debug flag. If this class of issue returns, write a fresh focused probe for that investigation.

Acceptance criteria:

- Normal selection diagnostics explain what the renderer intends to draw without expensive GPU readback.
- GPU rect readback probes, mirrored/flipped hash variants, and probe-specific diagnostics are removed.
- Remaining selection diagnostics correspond to production composite types, not hand-assembled debug-only records.
- No tests depend on debug-only probe output.

Test strategy:

- Delete probe-output assertions from general runtime diagnostics tests.
- Delete focused GPU-probe tests with the probe implementation.
- Rewrite or delete diagnostics tests that depend on legacy partial placement shapes once the production types prevent those shapes.

### Phase 7: Test Suite Cleanup And Clean Cutover

Deliverables:

- Remove transitional helpers introduced only for this investigation once page versions and alias sets are first-class.
- Rewrite tests around public invariants:
  - page mutation emits a new page version,
  - resolved placements carry that page version,
  - renderer upload consumes that page version,
  - aliases share movement and revision updates.
- Delete ossified tests that protect fake-packer pixel coordinates, legacy bare-ref assumptions, or temporary diagnostic fields.

Acceptance criteria:

- No test asserts an exact atlas coordinate unless the coordinate is part of an authored asset contract or public packing rule.
- No test constructs a stale placement shape that production code cannot construct.
- Focused texture, renderer payload, runtime, check, lint, and `git diff --check` all pass.

### Resteering Checkpoint

Run this after Phase 3 and again after Phase 6:

- Confirm whether `TexturePageVersion` and explicit alias sets removed the need for `#uploadedPlacementRevisionByTextureRefId`.
- Confirm whether any diagnostics still exist only because old types are too weak.
- Confirm whether terrain and object-material paths now share the same placement freshness contract.
- Decide whether remaining regression tests are structural or should be deleted and rewritten.

### Risks And Mitigations

- Risk: page version threading could churn many tests.
  Mitigation: introduce factory helpers for valid placements, then delete tests that hand-roll obsolete partial placement records.
- Risk: planned placement and committed upload split could duplicate atlas mutation code.
  Mitigation: make both paths return the same internal mutation object and differ only at the public boundary that marks uploads.
- Risk: alias-set refactor could accidentally change dedupe behavior.
  Mitigation: keep physical source keys and page policy matching unchanged during the alias phase; only move alias ownership data.
- Risk: removing diagnostics could slow a future repro.
  Mitigation: keep the stable placement/page-version diagnostics, but delete the current GPU probes. Recreate a smaller purpose-built probe only if a future investigation proves it is needed.

## Structural Plan Dry Run

This dry run checks the implementation phases against the current code seams rather than assuming the plan lands cleanly.

### Phase 1 Dry Run: Texture Page Version

Current seams:

- `TexturePlacementUpdate` carries `placementRevision` only on upload placements.
- `ResolvedTexturePlacement` carries `textureRefId`, dimensions, and rect, but not the revision that owns those pixels.
- Object-material and terrain payload builders accept `ReadonlyMap<string, ResolvedTexturePlacement>` and look up WebGL textures by bare `textureRefId`.
- `Webgl2Renderer.applyTexturePlacementUpdate()` stores textures by bare ref and stores resolved placements separately.

Expected implementation path:

- Add `TexturePageVersion` in `renderer/types.ts`.
- Add `pageVersion` to both uploaded placements and resolved placements.
- Keep `textureRefId` as a convenience field or accessor only where physical WebGL object lookup needs it.
- Update placement factories in tests first so test churn is concentrated.

Friction:

- This phase alone does not eliminate `#uploadedPlacementRevisionByTextureRefId`. `placeTextureIntents()` can still mutate CPU page state without emitting renderer updates, so the side map remains necessary until Phase 2.
- Tests currently hand-roll many partial placement records. They should be migrated through helpers rather than patched one by one.

Course correction:

- Phase 1 should introduce `TexturePageVersion` and convert consumers, but not delete the uploaded-version map yet.

### Phase 2 Dry Run: Planned Mutations Versus Committed Uploads

Current seams:

- `placeTextureIntents()` calls the same packing/absorption machinery as commit paths.
- That path can call page-local absorption/repack and mutate registry entries, runtime page pixels, and placement revisions.
- Only `applyStaticCommitDelta()` and `applyDynamicTextureUseDelta()` return `TexturePlacementUpdate` to the renderer.

Expected implementation path:

- Make internal atlas mutation return a single object, tentatively `TexturePageMutation`, with:
  - page version,
  - runtime page pixels,
  - resolved logical placements,
  - whether the mutation has been emitted to the renderer.
- `placeTextureIntents()` may still create planned placements, but it must leave an explicit unuploaded mutation marker when it changes a live page.
- Commit paths consume those markers and emit uploads when the owning texture use becomes live.

Friction:

- A hard split where planned placement never mutates registry state may be too large and may break object visual pre-bake expectations. A smaller first cut is to keep registry mutation but make the unuploaded page version explicit.
- Zero-ref page reclamation currently runs during planned placement. That behavior needs a careful audit before changing it.

Course correction:

- Do not attempt a pure immutable planning model in one jump. First make hidden planned mutations visible and impossible to mark renderer-current accidentally.

### Phase 3 Dry Run: Explicit Alias Sets

Current seams:

- `registry.entries` maps `VisualTextureKey` to `VisualTextureRegistryEntry`.
- Multiple keys can point at the same entry object, but aliases can also be copied through `createRegistryEntryAliasForPagePolicy()`.
- Page-local repack currently reconstructs aliases by scanning `registry.entries` and parsing texture-use ids from registry keys.

Expected implementation path:

- Introduce a physical page entry keyed by physical source, rect, and compatible page policy.
- Store logical texture use ids on that physical entry.
- Keep a separate logical lookup from texture use id/key to physical entry.
- Repack mutates the physical entry once and emits resolved placements for its logical ids.

Friction:

- Alias sets cannot be keyed by content alone. Wrap behavior, sample class, page policy, and shader-virtual-wrap rules affect whether two logical uses can share a physical entry.
- Existing `itemId` on `VisualTextureRegistryEntry` currently does too much: primary alias label, atlas entry key, diagnostic label, and sometimes physical identity.

Course correction:

- Rename concepts during the refactor rather than preserving `itemId` everywhere. Use names like `physicalEntryId`, `textureUseIds`, and `diagnosticLabel` so the code stops reading like a diary.

### Phase 4 Dry Run: Placement And Binding Inputs

Current seams:

- Object-material payloads write rect uniforms from placements and texture bindings from the texture map in separate passes.
- Terrain payloads allocate page slots by `textureRefId`.
- Prepared payloads hold `WebGLTexture` handles, so renderer uploads conservatively dirty all static and terrain payloads.

Expected implementation path:

- Create a shared resolved placement shape that carries `pageVersion`, rect, dimensions, and role.
- Payload builders consume that shape so rect and texture binding come from the same page version.
- Keep physical WebGL texture storage keyed by `textureRefId`, but prepared payload diagnostics and dirtying compare page versions.

Friction:

- Terrain page slots can probably stay keyed by `textureRefId` while payloads are fully dirtied on replacement. If we later make dirtying precise, page slots need version-aware invalidation.
- This phase should not try to optimize dirtying first. Correct page-version coupling comes before narrower invalidation.

Course correction:

- Keep conservative dirtying until page-version plumbing is stable. Then decide whether targeted dirtying is worth the extra reverse index.

### Phase 5 Dry Run: Renderer State Boundary

Current seams:

- Some raw WebGL calls already invalidate `#stateCache`; others need an audit.
- `applyTexturePlacementUpdate()` creates/deletes texture objects and invalidates after uploads.
- Scene-domain target allocation was a proven state-cache boundary bug.

Expected implementation path:

- Search raw `gl.bindTexture`, `gl.bindFramebuffer`, `gl.useProgram`, and buffer/VAO binds.
- Add a wrapper/helper for intentional raw state mutation that invalidates cache by construction.
- Convert call sites incrementally.

Friction:

- WebGL setup code legitimately does many raw calls. The goal is not wrapping every call into ceremony; it is making stateful runtime calls obvious and hard to forget.

Course correction:

- Scope the audit to runtime paths first: texture uploads, target allocation/resizing, debug overlay uploads, and draw preparation.

### Phase 6 Dry Run: Diagnostics Cleanup

Current seams:

- CPU rect hashes are now attached to placement resolution snapshots.
- GPU probes read texture objects through framebuffer readback.
- Selection diagnostics currently mix stable inspection fields with incident-specific proof fields.

Expected implementation path:

- Keep geometry bounds, material slots, resolved placements, texture refs/page versions, and prepared payload status.
- Delete GPU rect probes and probe-specific hash fields from normal diagnostics.
- Remove hash fields from normal selection diagnostics.

Friction:

- The probe was valuable because screenshots were misleading, but keeping it would preserve investigation scaffolding as architecture.

Course correction:

- Delete the current probe implementation. If follow-mode validation finds a second bug, write a smaller purpose-built probe for that bug instead of carrying this one forward.

### Phase 7 Dry Run: Tests And Clean Cutover

Current seams:

- Some tests assert exact fake-packer coordinates.
- Some tests construct minimal `ResolvedTexturePlacement` records manually.
- The two new regressions are valid for the current architecture but should become redundant once page versions and alias sets are explicit.

Expected implementation path:

- Add test factories that require valid page versions.
- Rewrite current regressions around structural invariants:
  - planned live-page mutation creates an unuploaded page version,
  - commit emits that same page version,
  - aliases are stored on the physical entry and all receive moved placements.
- Delete tests that only assert legacy field combinations or temporary probe output.

Friction:

- There will be churn, but it is good churn if it removes impossible partial placement objects from tests.

Course correction:

- Do not preserve old tests as compatibility ballast. If the new type model makes a bug impossible, keep one integration proof and yeet the old pin-the-tail tests.

## Verification Run

From `apps/holtburger-3d`:

```sh
npm run test:ts -- --run src/lib/runtime/client-runtime.test.ts src/lib/textures/texture-manager.test.ts src/lib/renderer/webgl2/webgl2-object-material-payloads.test.ts src/lib/renderer/webgl2/webgl2-renderer.test.ts
npm run check
npm run lint:ts
```

Results:

- Focused texture-manager suite passed: 1 file, 41 tests.
- Focused affected suite passed: 4 files, 125 tests.
- `npm run check` passed.
- `npm run lint:ts` passed.
- `git diff --check` passed from the repo root.

## Next Steps

1. Rebuild/reload the 3D client and try to reproduce the `0xdc56ffff/object/0003/02000248` corruption again.
2. If it reproduces after probe cleanup, capture the selected-object diagnostic report and inspect page-version and placement identity:
   - resolved placement page version,
   - renderer prepared payload page version,
   - texture ref deletion/recreation history,
   - page-local repack upload order.
3. If placement/page-version identity still agrees but rendering is wrong, write a fresh focused GPU probe for the new failure mode rather than restoring the old probe plumbing.
4. Inspect remaining texture upload/replacement/page lifetime:
   - `applyTexturePlacementUpdate`
   - texture ref deletion/recreation
   - page-local repack upload order
   - zero-ref page reclamation
5. If page versions match, instrument draw-time binding:
   - texture unit binds immediately before object-material draw
   - object material uniform uploads for the selected draw unit
   - shader rect normalization path
   - any raw WebGL state mutation between diagnostics and draw
6. Keep terrain-mask investigation separate until object-material results prove the shared layer is below both paths.

## Guardrails

- Do not disable mipmaps as a workaround.
- Do not guess based on screenshots alone.
- Do not add implicit fallbacks that hide missing texture refs or failed probes.
- Do not keep debug-only APIs if the final root cause can be proven and fixed without them.
- Prefer deleting ossified tests that only preserve stale texture architecture, but keep regression tests for the actual root cause once identified.
