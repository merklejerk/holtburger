# Holtburger 3D Texture Key Simplification Plan

## Context & Boundaries

**Goal:** Replace overloaded `textureUseId` identity with a small texture pipeline model: `TextureKey` for canonical texture identity, `TextureBindingId` for material consumers, and `TextureOwnerId` for residency ownership.

**In scope**

- Static material texture identity used by terrain, outdoor static objects, generated scenery, and env-cell static object rendering.
- `TextureManager` registry shape, commit/update payloads, placement snapshots, and fuzz coverage.
- Renderer-facing resolved placement lookup, so material bindings resolve through `TextureBindingId -> TextureKey -> placement`.
- Cleanup of implicit aliasing through shared `physicalEntry` references.
- Focused diagnostics that report binding id, texture key, owner id, texture ref/page revision, and atlas rect as separate facts.
- Removal of temporary adapters, bridge fields, legacy tests, and compatibility aliases created during the refactor.

**Out of scope**

- Dynamic entity material systems unless they directly share the same `TextureManager` commit path.
- Texture compression, atlas packing algorithm tuning, or GPU upload performance work.
- New visual features or material parity changes.
- Backwards compatibility for old `textureUseId` string formats after the cutover.

**Shim policy**

- Temporary shims are allowed only inside the phase that introduces them.
- Every shim must be named with `Legacy`, `Bridge`, or `Compat` and listed in that phase's cleanup checklist.
- No phase may finish with both old and new identity models accepted by a public boundary unless the next phase begins by deleting the old path.
- Do not preserve old id string formats for tests, diagnostics, or hidden compatibility.
- If a shim starts influencing production behavior beyond a single call boundary, stop and split the phase.

## Ground Truth

**Current code paths**

- `apps/holtburger-3d/src/lib/static/bake/static-material-texture-policy.ts`
  - Currently creates scoped `textureUseId` values from scope, namespace, source, and sampler.
  - Already exposes `sourceKey`, which is close to the canonical texture-source handle.
- `apps/holtburger-3d/src/lib/textures/placement.ts`
  - Current bridge between material binding requirements, placement item ids, and texture-resource dependency ids.
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
  - Current registry, placement, ownership, aliasing, page movement, and renderer update producer.
- `apps/holtburger-3d/src/lib/static/contracts.ts`
  - Current draw-unit texture binding fields and static texture-use owner contracts.
- `apps/holtburger-3d/src/lib/visual/object-visual-resource-key.ts`
  - Current visual resource key includes `textureUseIds`, which can poison reusable resource identity when ids include landblock scope.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.ts`
  - Renderer material payload currently resolves texture bindings by `textureUseId`.

**Useful existing concepts**

- `sourceKey` / `createMaterialTextureDataUseKey(...)`: canonical-ish source handle; should become a component of `TextureKey`.
- `physicalSourceKey`: prepared texture identity after palette/replacement resolution; should become or feed `TextureKey`.
- `textureRefId`: renderer page/GPU texture identity after packing; this is not canonical texture identity.
- `TextureBindingRequirement.bindingKey`: material consumer binding key; should become `TextureBindingId`.
- Static resource keys and layer owner keys: ownership/lifetime concepts; should feed `TextureOwnerId`, not `TextureKey`.

## Answered Design Decisions

- **Aliases are the footgun we are deleting.** Sharing must be represented as many `TextureBindingId`s and `TextureOwnerId`s pointing at one immutable `TextureKey` entry. Do not preserve alias lists, alias scans, or shared mutable `physicalEntry` objects.
- **`textureUseId` is not a real primitive.** It mixed source identity, material binding semantics, residency ownership, and placement lookup. New code should not mint replacement `textureUseId` values or preserve its spelling as a compatibility token.
- **Existing canonical handles are ingredients, not the final model.** `sourceKey` / `physicalSourceKey` can feed `TextureKey`, but the public pipeline target is still `TextureKey`, `TextureBindingId`, `TextureOwnerId`, and `TexturePageClass`. Do not add another canonical-string layer beside them.
- **No owner discriminants in texture identity.** Landblock id, source instance id, visual resource id, draw unit id, and bake task id are ownership or binding facts. They deliberately sabotage texture-pool dedupe if they enter `TextureKey`.
- **Sampler policy is not texture identity.** Filtering, mip generation, and anisotropy are renderer/global policy derived from sample class. Material wrap belongs to binding semantics, and physical wrap belongs to page compatibility only when shader virtual wrap cannot provide the sampling behavior.
- **Palette replacements have one identity policy.** Replacement palettes are not assets for identity purposes. All palette replacement identity is based on normalized replacement ranges with a cheap deterministic 64-bit byte hash; no asset-id-first or pixel-hash fallback is allowed.
- **Resolver prediction wins over prepared pixels.** The resolver may read palette range bytes needed for fingerprints, but it must not compose/load full prepared palette textures merely to predict a `TextureKey`.
- **Tests should ossify the new contract, not the migration.** Delete or rewrite tests that preserve old scoped strings, alias behavior, or equality between binding and placement ids.

## North Stars

- **Texture identity is not ownership.** If a value changes because a landblock, layer, draw unit, visual resource, or bake task changes, it is not a texture identity.
- **One texture concept gets one id.** `TextureKey`, `TextureBindingId`, and `TextureOwnerId` must stay separate. Do not create a new mega-id under a cleaner name.
- **Clean cutover beats compatibility.** Prefer changing call sites decisively over accepting both old and new shapes. Temporary bridges are only tactical scaffolding and must be deleted inside the same phase or explicitly first thing in the next phase.
- **Simplification is a deliverable.** A successful phase should reduce identity branching, map indirection, alias fanout, or string parsing. A phase that only adds wrappers is not done.
- **Measure deletion, not renaming.** Track non-test production SLOC and branch/map count in the touched texture identity paths. The final result should be smaller or must justify any increase with deleted state-machine complexity.
- **Delete ossified tests.** Tests that assert old scoped `textureUseId` spelling, old equality between binding and placement ids, or old alias behavior should be deleted or rewritten from first principles. Do not migrate brittle snapshots just to keep legacy architecture alive.
- **No hidden aliases.** Multiple consumers may share one `TextureKey`, but that sharing must be represented as data flow through binding/owner maps, not shared mutable registry objects.
- **Fail loudly at boundaries.** If a binding id is passed where a texture key is expected, or an owner id is used in pool identity, make it a type or validation error. Do not silently normalize it.
- **Fuzz the state machine, not anecdotes.** Follow-mode streaming, eviction, re-addition, page growth, and cross-owner texture sharing must be covered by stateful tests that can print a useful reproducer.
- **Diagnostics should explain identity.** Reports should show binding id, texture key, owner id, texture ref/page revision, and rect separately so future bugs do not require reverse-engineering a composite string.
- **Do not optimize the wrong thing.** Some duplicate uploads are acceptable during cutover if they let us delete alias complexity and prove correctness. Re-introduce dedupe only through `TextureKey`.
- **The final shape should be smaller.** A temporary non-test SLOC increase is acceptable during cutover, but the completed refactor should reduce production texture identity code and branch complexity. If the final diff only wraps old behavior in new names, the plan failed.

## Target Model

### TextureKey

Only identifies the texture pool entry. It must not include landblock, draw unit, resource owner, render instance, batch, or task ids.

Required discriminants:

- source kind and source id:
  - render surface id for render-surface textures;
  - base palette id, palette domain, and normalized replacement range fingerprints for palette textures;
  - direct/dynamic source identity for runtime authored textures.
- usage/role where it changes bytes or shader interpretation:
  - `rgba-color`, `rgba-detail`, `index8`, `index16`, `palette`, terrain mask/color/detail.
- prepared output format/color interpretation.
- page sample class only where shader interpretation differs.

Sampler axes that must not enter `TextureKey`:

- material wrap mode;
- global filtering mode;
- mip generation policy;
- anisotropy.

Those axes belong elsewhere:

- material wrap mode belongs to `TextureBindingId` / material binding data;
- physical wrap belongs to `TexturePageClass` only when shader virtual wrap is unavailable;
- filter/mips/aniso belong to renderer sampler policy derived from global filtering mode and sample class.

Palette texture replacement policy:

- Use one identity policy for all palette texture replacements.
- Never use replacement palette asset ids in `TextureKey`.
- Never use prepared/composed palette texture pixel hashes in `TextureKey`.
- Replacement identity is the canonical list of final replacement ranges:
  - `offset`;
  - `count`;
  - cheap deterministic 64-bit hash of the replacement range bytes/colors.
- Sort normalized replacement ranges by `offset`, then `count`, then hash.
- Use `repl=none` when there are no replacements.
- The resolver may read replacement range color bytes needed to compute these fingerprints, but must not compose or load full prepared palette texture texels just to predict `TextureKey`.
- Use one shared cheap 64-bit hash implementation for replacement range fingerprints. This is an identity fingerprint, not a cryptographic guarantee.

Explicitly forbidden discriminants:

- landblock id;
- layer owner id;
- draw unit id;
- visual resource id;
- object instance id;
- bake task id;
- generated batch id;
- material wrap mode;
- global filtering mode;
- mip generation policy;
- anisotropy;
- placement revision;
- renderer `textureRefId`.

### TextureBindingId

Identifies a material consumer binding. It is allowed to be local and scoped because it is not used for texture dedupe.

Recommended discriminants:

- material resource id or draw resource id;
- material slot;
- binding role: base color, detail, index, palette;
- material wrap mode for bindings whose sampling semantics depend on wrap;
- material variant signature if one material slot emits multiple consumer variants.

### TexturePageClass

Identifies physical atlas page compatibility. It may include renderer/domain constraints that affect packing or upload legality, but it is not canonical texture identity.

Recommended discriminants:

- texture domain/purpose when shader or page layout differs. Terrain and object pages remain separated in this refactor unless a later proof shows page/shader compatibility;
- page sample class;
- page format/gutter policy;
- physical wrap mode only when the renderer cannot virtualize wrap in shader for that domain/sample class.

Explicitly forbidden discriminants:

- material binding id;
- owner id;
- global filtering mode;
- mip generation policy;
- anisotropy.

### TextureOwnerId

Identifies residency lifetime. It is allowed to include landblock/resource scope because eviction is its purpose.

Recommended discriminants:

- layer owner id for layer-owned textures;
- visual resource id for reusable static object visual resources;
- dynamic resource id for runtime visual resources.

### Identity Serialization

Internally, identity builders should accept structured inputs and return branded strings only at map or serialization boundaries. Diagnostics should print the relevant structured facts beside opaque ids. Do not make human-readable mega-strings the primary API shape.

## Phased Implementation

### Phase 1: Introduce Named Identity Types

**Status:** Complete.

**Deliverables**

- Add explicit types near `textures/placement.ts` or a new colocated `textures/identity.ts`:
  - `TextureKey`
  - `TextureBindingId`
  - `TextureOwnerId`
  - `TextureRequest`
- Add deterministic builders:
  - `createMaterialTextureSourceKey`
  - `createPaletteReplacementFingerprint`
  - `createPaletteReplacementRecipeKey`
  - `createTextureKey`
  - `createTextureBindingId`
  - `createTextureOwnerId`
  - `createTexturePageClass`
- Build `TextureKey` from the existing material source identity plus shader interpretation facts. Do not create a parallel canonicalization path beside current `sourceKey` and `physicalSourceKey` logic.
- Build `TexturePageClass` separately from `TextureKey`; sampler/page facts that are only physical compatibility constraints must not leak into canonical texture identity.

**Acceptance criteria**

- New tests prove `TextureKey` does not change across landblocks for the same source and shader interpretation.
- New tests prove `TextureBindingId` and `TextureOwnerId` may differ while sharing a `TextureKey`.
- New tests prove changing filter/mips/aniso does not change `TextureKey`.
- New tests prove changing material wrap changes binding/page compatibility only where required, not source texture identity.
- New tests prove palette texture keys are based on replacement range fingerprints, not replacement palette asset ids or prepared texture content hashes.
- New tests prove replacement range canonicalization is stable across caller ordering.
- No production behavior changes yet.
- No adapter accepts legacy `textureUseId` values as a `TextureKey`.
- New builder names do not preserve `textureUseId` language.

**Phase notes**

- Added the new identity vocabulary as an isolated module before rewiring production call sites. This keeps Phase 1 behavior-neutral while giving later phases typed boundaries to cut toward.
- Palette replacement identity now has one policy in the target API: final replacement ranges are identified by `offset`, `count`, and a cheap FNV-1a 64-bit hash of RGBA range bytes. Replacement palette asset ids and prepared texture content hashes are not accepted by the builder.
- `TextureKey` inputs intentionally exclude owner scope, material wrap, filtering, mip generation, anisotropy, placement revision, and renderer texture refs.
- `TextureBindingId` carries material wrap because the material consumer owns that sampling fact.
- `TexturePageClass` can carry physical wrap only when page compatibility needs it; virtualized material wrap stays out of the canonical texture key.
- Concession: the new builders are not yet wired into `TexturePlacement` or `TextureManager`. Phase 2 first provides resolver-predictable palette recipe keys; Phase 3 then moves identity creation to the planner edge so the current `bindingKey` / `placementItemId` / `textureUseId` equality bridge can be deleted instead of wrapped.

### Phase 2: Palette Range Identity Prerequisite

**Status:** Complete.

**Course correction:** The placement and registry cutovers need resolver-predictable `TextureKey`s for palette textures. Current prepared palette payloads expose the composed palette texture pixels and old replacement triples, while `AssetService` only exposes full prepared assets. A clean cutover would otherwise be forced to keep replacement palette ids or prepared `contentHash` in identity. This phase adds the missing cheap palette-range identity boundary first.

**Deliverables**

- Add a host/asset request path that can resolve replacement palette range bytes without composing the full prepared palette texture.
- Represent runtime-authored palette replacement ranges with the same `offset`, `count`, and RGBA byte range shape as static palette replacements.
- Route static palette replacement asset ids through the same byte-range fingerprint builder added in Phase 1.
- Replace duplicated replacement signature helpers in static material planning with the shared palette replacement recipe builder where the range bytes are available.
- Keep prepared full palette texture loading for actual pixels, but stop using its `contentHash` as a candidate identity source.

**Acceptance criteria**

- Palette replacement recipe keys can be computed before `prepareDirectPaletteTextureSource(...)` returns composed pixels.
- Static and runtime-authored palette replacements use the same `createPaletteReplacementFingerprint(...)` / `createPaletteReplacementRecipeKey(...)` policy.
- No new code path introduces a fallback identity based on replacement palette asset id when bytes are unavailable.
- Tests prove two replacement sources with the same range bytes produce one recipe key even when their source labels differ.
- Tests prove two replacement ranges with the same source label but different bytes produce different recipe keys.

**Phase notes**

- Reused the existing `palette/<id>` prepared asset route instead of adding a new host route. The resolver reads the replacement palette's color table and fingerprints only the requested range; it does not request or compose `prepared-palette-texture` pixels.
- Added a shared static replacement recipe helper that converts DAT ARGB palette colors to the same RGBA byte range format accepted by `createPaletteReplacementFingerprint(...)`.
- The palette id remains a fetch address and diagnostic label only. It is not part of the returned fingerprint or recipe key.
- Runtime-authored replacements can feed the Phase 1 byte-range builder directly; static replacement palette assets now converge on that same byte policy.

### Phase 3: Planner-Edge Texture Request Cutover

**Status:** Complete.

**Course correction:** Placement-contract changes cannot honestly start inside `TextureManager`. Static planners currently create synchronous scoped `textureUseId` strings, while palette `TextureKey` prediction now requires palette metadata. If `TextureManager` keeps deriving canonical identity from old placement ids, the next registry change would either guess, keep aliases, or rebuild palette identity from prepared texture pixels. This phase moves identity creation to the planning edge first.

**Deliverables**

- Update material/planning identity contracts together, not one boundary at a time:
  - `TextureBindingRequirement`;
  - `TexturePlacementIntent`;
  - `TexturePlacement`;
  - `ObjectVisualTexturePlacementSnapshot`;
  - `DynamicTexturePlacementUse`.
- Carry separated identity through those contracts:
  - `bindingId`;
  - `textureKey` on placement intents and snapshots, where palette metadata is available before atlas placement;
  - `ownerIds` where already known;
  - `pageClass`;
  - source facts;
  - material binding facts such as wrap;
  - physical page compatibility facts without filter/mip/aniso policy.
- Stop setting `bindingKey`, `placementItemId`, and `textureUseId` to the same string.
- Replace `ObjectVisualTexturePlacementSnapshot.itemIdsByTextureUseId` with a snapshot lookup keyed by `TextureBindingId`, or remove the bridge entirely if the bake path can carry numeric placement ids alongside binding ids directly.
- Rename any remaining planner-edge bridge map by what it actually maps. A `TextureBindingId -> TexturePlacementItemId` bridge is acceptable only while numeric placement ids still exist; a `textureUseId -> itemId` bridge is not.
- Update `static-material-texture-policy.ts`, terrain material planning, object material planning, and structured interior planning.
- Delete the current comment that presents binding key and placement item id equality as a bridge.
- Give static planners access to the asset reader needed for Phase 2 palette replacement recipe keys.
- Keep bake-worker material binding requirements synchronous. They should recreate `TextureBindingId` and placement lookup facts, not request palette metadata just to recompute a `TextureKey`.
- The source-ready placement path is the async identity boundary: it owns `TextureKey` construction and passes canonical identity through placement intents/snapshots.
- Build `TextureKey` from:
  - render-surface source id plus usage/output interpretation for render-surface textures;
  - base palette id, palette domain, usage/output interpretation, and replacement range recipe for palette textures;
  - runtime source id plus usage/output interpretation for runtime-authored textures.
- Build `TextureBindingId` from the material consumer facts, including wrap where the material binding semantics depend on wrap.
- Build `TexturePageClass` from placement compatibility facts only. Do not include filtering, mip generation, anisotropy, binding id, owner id, or material scope.
- Keep material wrap out of `TexturePageClass` when shader virtual wrap can provide the material sampling behavior. Only physical page incompatibility belongs in `TexturePageClass`.
- Keep prepared full texture loading for actual pixels only; do not use prepared palette `contentHash` or replacement palette ids for `TextureKey`.

**Acceptance criteria**

- Material entries and placement intents carry `TextureBindingId`, `TextureKey`, and `TexturePageClass` as separate fields.
- Static planners can compute palette texture keys before requesting composed prepared palette texture pixels.
- Bake workers do not require `PreparedAssetReader` access merely to recreate material binding requirements.
- Existing bake tests are rewritten around separated ids, not updated to preserve old string equality.
- Any `LegacyTextureUseRequirement` or equivalent bridge introduced in this phase is deleted before the phase is complete.
- The object-visual numeric placement path does not require a `textureUseId -> itemId` bridge after this phase.
- `TextureBindingRequirement`, `TexturePlacementIntent`, and snapshot helpers no longer encode the old equality bridge between binding key, placement item id, and texture-use id.
- Tests assert that owner or landblock churn changes owners/bindings without changing canonical texture keys.
- Tests prove filter, mip generation, and anisotropy are absent from planner-produced texture keys and page classes.
- Tests prove material wrap changes `TextureBindingId` and, where needed, physical page class, but not `TextureKey`.
- Tests prove replacement palette asset ids are fetch inputs only, not texture identity.
- Phase-close audit includes `rg "itemIdsByTextureUseId|bindingKey.*placementItemId|placementItemId.*textureUseId|createLegacyTexturePlacementIdentity"` and every remaining hit is either deleted in Phase 3 or moved into Phase 4's first deletion checklist.

**Phase notes**

- Added a shared material texture identity-facts helper that produces `sourceKey`, `textureKey`, `pageClass`, and current runtime page policy from material texture source facts.
- The helper uses Phase 2 palette replacement recipes and proves replacement palette asset ids are fetch addresses, not canonical texture identity.
- Added branded `bindingId` to `TextureBindingRequirement` and updated static object, structured interior, terrain, dynamic, and test requirement producers to provide it.
- Source-ready placement planners for static objects, structured interiors, and terrain are now async and asset-reader-backed. This is the intentional boundary that may resolve palette replacement range bytes and attach canonical `TextureKey` / `TexturePageClass` facts to placement intents.
- `StaticCoordinator` now requires a texture identity asset reader before dispatching source-ready placement work. Missing identity DI is a hard failure, not a fallback to old scoped ids.
- `TexturePlacementIntent` and `TexturePlacement` now carry `bindingId`, `textureKey`, `ownerIds`, and `pageClass`. Tests that create placement intents directly must provide real request facts instead of leaning on scoped `textureUseId` equality.
- The runtime atlas gutter/page-class policy was collapsed into the shared identity helper so planner-produced page classes and `TextureManager` page classes do not drift.
- Spicy bit: bake workers still recreate material binding requirements synchronously. That is intentional; bake workers should not request palette metadata or recompute canonical pool identity.
- Spicy bit: dynamic visual planning currently uses a runtime-authored source key because it does not have a palette-aware static asset reader at that boundary. Keep this visible for Phase 4/9 cleanup; do not let it become a hidden canonical static texture path.
- Object-visual placement snapshots now expose `itemIdsByBindingId`; static object, structured interior, dynamic visual, recipe publication, and test helpers resolve numeric bake item ids through `TextureBindingId` instead of `textureUseId`.
- Object-visual placement planning deduplicates by `TextureBindingId`, not `textureUseId`. Canonical texture sharing remains a `TextureKey`/registry responsibility.
- Static material and terrain requirements no longer set `bindingKey`, `placementItemId`, and `textureUseId` to the same value. `placementItemId` now carries the branded binding id where the old field remains, while renderer/dependency `textureUseId` fields continue to carry legacy binding keys until Phase 6 removes renderer-facing `*TextureUseId`.
- Phase-close audit result: no `itemIdsByTextureUseId`, no `bindingKey`/`placementItemId` equality comments, and no triple equality bridge remain in the touched planner-edge paths.
- Temporary debt carried deliberately into Phase 4: `TextureManager` still has a `createLegacyTexturePlacementIdentity(...)` derivation path for commit payloads that have not yet been converted to planner-provided request facts. Phase 4 must delete that first instead of expanding it.

### Phase 4: Registry Identity Cutover

**Course correction:** Once planners emit real `TextureRequest`s, the registry cutover can delete alias behavior instead of translating old scoped ids. This phase owns the minimum registry and commit-state change needed to make the placement split real.

**Deliverables**

- Replace `VisualTextureKey = domain + bucket + textureUseId` with registry entries keyed by `TextureKey`.
- Replace owner maps with `TextureOwnerId -> Set<TextureKey>`.
- Replace renderer update production with a resolved binding map that starts from `TextureBindingId` and resolves through `TextureKey`.
- Delete `physicalEntry.textureUseIds` and implicit shared-entry aliasing during the cutover. Do not create a bridge object that keeps the alias model alive under a different name.
- Delete `createLegacyTexturePlacementIdentity(...)` at the start of this phase. Any caller that still needs it blocks the phase and must be converted rather than given a broader shim.
- Use planner-provided `TextureKey`, `TextureBindingId`, `TextureOwnerId`, and `TexturePageClass`; do not rederive identity from old strings inside `TextureManager`.
- Consume the Phase 3 palette recipe keys for palette texture `TextureKey`s. Do not derive palette identity from replacement palette asset ids or prepared `contentHash`.
- Keep placement revisions, renderer `textureRefId`s, and atlas rects as mutable placement facts behind the `TextureKey` entry, never as key components.

**Acceptance criteria**

- Texture placement requests use `TextureKey`.
- No registry entries share mutable `physicalEntry` references.
- A page move updates one texture-pool entry, then all active bindings derive from that entry.
- Active binding lookup is `TextureBindingId -> TextureKey -> current placement`, not `TextureBindingId -> stale copied rect`.
- Tests assert that owner churn in follow mode changes owners/bindings without changing canonical texture keys.
- No helper needs to “find aliases” by scanning registry entries.
- `TextureManager` consumes planner-provided `TextureKey`, `TextureBindingId`, `TextureOwnerId`, and `TexturePageClass` from placement snapshots/commits. It must not derive canonical identity from old scoped strings except during the deleted-at-end migration step.
- The current `createLegacyTexturePlacementIdentity(...)` helper is removed or the phase is not complete.

### Phase 5: TextureManager Fuzz and Palette Resolver Proof

**Deliverables**

- Add the stateful fuzz harness around the new commit model before renderer payload cutover continues.
- Model follow-mode behavior explicitly: landblock owner add/remove, object visual reuse, page growth, page moves, texture eviction, and re-addition.
- Generate palette replacement range recipes from runtime-authored replacement bytes and prove resolver-predictable keys do not require prepared texture texels.
- Include a reproducer printer that logs operation sequence, active owners, active bindings, texture keys, page revisions, and atlas rects.
- Keep the fuzz target close to `TextureManager` state, not browser controls or renderer draw code.
- Seed the model with the observed failure shape: an active binding whose reported placement revision lags the latest resident page revision after follow-mode eviction/re-add or page movement.
- Generate equivalent texture sources across distinct owner ids and landblocks so the harness proves dedupe through `TextureKey`, not through scoped aliases.

**Acceptance criteria**

- The fuzz harness can reproduce the follow-mode eviction/re-add class that motivated this plan, or it produces a narrower counterexample showing the bug lives outside texture commit state.
- The existing resident-page invariant remains and is expressed in terms of `TextureKey`, not logical texture-use aliases.
- An active binding may never point at a page version older than the resident texture page for its `TextureKey`.
- Owner eviction may only remove owner references. It must not invalidate the canonical texture entry while another owner or binding still references it.
- Re-adding an owner with the same canonical texture must reuse the existing `TextureKey` entry or recreate an equivalent entry with no stale binding state carried across.
- No helper needs to “find aliases” by scanning registry entries.
- Palette replacement fuzz covers runtime-authored replacement byte ranges with the single cheap-hash policy.
- Tests do not assert old scoped `textureUseId` spellings.

### Phase 6: Renderer Binding Cutover

**Deliverables**

- Update `StaticMaterialTableEntry` texture fields from `*TextureUseId` to `*TextureBindingId`.
- Add a renderer-side or commit-side binding table:
  - `TextureBindingId -> TextureKey`
  - `TextureKey -> ResolvedTexturePlacement`
- Shape commit/update payloads so WebGL object and terrain payloads can resolve by binding id without rebuilding a `Map<textureUseId, placement>`.
- Update WebGL2 object and terrain payload preparation to resolve through this split.
- Delete renderer-facing payload fields that still expose texture pool identity as `*TextureUseId`.
- Keep material wrap in material payload/binding data. Do not move wrap into `TextureKey` to make renderer lookup easier.
- Keep filtering, mip generation, and anisotropy in renderer sampler policy. Do not serialize them through placement snapshots as identity facts.

**Acceptance criteria**

- Renderer diagnostics show binding id and texture key separately.
- Missing binding, missing texture key, missing placement, and missing resident page are distinct failures.
- No renderer code assumes a binding id is a texture pool id.
- No renderer helper accepts either `TextureBindingId` or `TextureKey` as a plain interchangeable string parameter.
- Renderer tests prove two bindings with different wrap can resolve the same `TextureKey` while producing different wrap uniforms where required.

### Phase 7: Visual Resource Key Cleanup

**Deliverables**

- Replace `textureUseIds` in object visual resource keys with stable material binding layout and texture keys where resource identity truly depends on material texture identity.
- Verify landblock-scoped owner ids cannot enter reusable visual resource keys.
- If `TextureBindingId` contains resource or draw-unit scope, do not include it in reusable resource identity. Use slot/role/material layout plus `TextureKey` instead.
- Remove resource-key tests that only assert legacy scoped texture-use id sorting.

**Acceptance criteria**

- Same source visual resource in different landblocks can share resource identity when geometry/material/pool texture identity match.
- Tests explicitly cover cross-landblock shared texture/source cases.
- Visual resource ids do not change when only owner/landblock changes.

### Phase 8: Follow-Mode Scenario Regression And Diagnostics

**Deliverables**

- Extend the Phase 5 state-machine fuzz only if renderer cutover exposes new state that the manager-level model cannot see.
- Add focused browser/harness scenarios for follow-mode streaming:
  - add landblock/layer;
  - evict landblock/layer;
  - re-add a previously evicted landblock;
  - select objects whose materials share one `TextureKey` across different owner ids;
  - force page growth/repack while bindings remain active.
- Update selection diagnostics to print binding id, texture key, owner id, page ref, logical page revision, latest resident page revision, and atlas rect as separate fields.
- Add a captured scenario for the `da55ffff` / `01002a1b` class of failures if the harness can reproduce it from checked-in or generated data.

**Acceptance criteria**

- Fuzz fails if an active binding points at a stale page revision.
- Fuzz fails if two equivalent texture sources with different owner ids create distinct texture pool entries.
- Fuzz fails if owner eviction releases a texture still retained by another owner.
- Scenario diagnostics can distinguish stale binding, stale texture key, stale resident page, and stale atlas rect without reading a composite string.
- The captured follow-mode scenario either stays green or emits a short reproducer from the Phase 5 model.

### Phase 9: Simplification Audit And Resteer

**Deliverables**

- Measure non-test production SLOC for the touched texture identity paths against the pre-refactor baseline or first available commit before this plan's implementation.
- Audit cyclomatic/state complexity qualitatively:
  - count alias maps and scans;
  - count bridge maps between old and new ids;
  - count call boundaries accepting plain `string` where a branded texture id should exist.
- Audit dynamic texture identity:
  - identify whether runtime-authored source keys are truly runtime-local bytes or accidental static texture aliases;
  - decide whether dynamic palette/runtime replacements need their own asset-reader-backed planning boundary before final cleanup.
- Re-run forbidden-discriminant tests for `TextureKey`, `TexturePageClass`, and renderer sampler policy after the registry and renderer cutovers.
- Resteer the final cleanup checklist based on actual remaining hits, not assumptions.

**Acceptance criteria**

- The plan has a concrete metric note stating whether non-test production SLOC is trending down, flat, or up, and why.
- Any production SLOC increase is paired with a deleted complexity note, such as removed alias fanout or removed stale-placement state.
- No new cleanup phase begins with unresolved uncertainty about palette replacement identity, sampler policy placement, or canonical handle ownership.
- Dynamic/runtime identity debt is either resolved or explicitly moved to a named follow-up with its blocked boundary and desired shape.

### Phase 10: Holistic Cleanup And Compatibility Purge

**Deliverables**

- Remove or rename `textureUseId` in touched runtime texture paths.
- Delete alias helpers introduced to patch shared `physicalEntry` behavior.
- Delete tests that preserve old scoped `textureUseId` string formats.
- Delete all temporary types/functions/files containing `Legacy`, `Bridge`, or `Compat` from this refactor.
- Remove bridge fields where both old and new identity are carried in the same object.
- Remove alias fanout, bridge maps, old equality comments, old test fixtures, and stringly helper signatures as behavior cleanup, not just symbol cleanup.
- Revisit `TextureBindingRequirement`, `TexturePlacementIntent`, `TexturePlacement`, `StaticBakeTextureUse`, `StaticMaterialTableEntry`, `StaticObjectVisualResourceKey`, and renderer diagnostics for stale names.
- Replace stringly helper parameters with branded or structured identity types where the distinction matters.
- Update diagnostics labels and docs.
- Delete empty compatibility wrappers that only convert one branded id to another branded id without changing domain meaning.
- Collapse or remove any test factories that exist only to feed both old and new fields.
- Re-run `rg` audits for forbidden identity mixing:
  - `textureUseId`;
  - `bindingKey`;
  - `placementItemId`;
  - `sourceKey`;
  - `textureRefId`;
  - `Legacy`;
  - `Bridge`;
  - `Compat`.

**Acceptance criteria**

- `rg "textureUseId"` no longer finds runtime atlas/pool identity usage in the refactored paths.
- Remaining `textureUseId` occurrences are either deleted or documented as pending outside this scope.
- No comments describe renderer binding keys and placement item ids as intentionally equal.
- No public boundary accepts old scoped texture-use strings.
- No tests assert old scoped id spelling except fixtures explicitly outside this plan's scope.
- No production file contains refactor shims named `Legacy`, `Bridge`, or `Compat`.
- The final diff removes more identity compatibility code than it adds.
- Final non-test production SLOC in touched identity paths is lower than the plan baseline, or the remaining increase is explicitly accepted because a measurable alias/state-machine complexity class was deleted.

## Risks & Mitigations

- **Risk: broad test churn.**
  - Mitigation: rewrite brittle identity-string tests instead of preserving legacy equality.
- **Risk: terrain and object paths diverge.**
  - Mitigation: put identity builders in one shared texture module and force both through the same request type.
- **Risk: dynamic textures need owner-scoped identity.**
  - Mitigation: owner scope belongs in `TextureOwnerId`; include runtime source identity in `TextureKey` only when the source bytes are actually owner-local.
- **Risk: atlas page class still needs domain separation.**
  - Mitigation: keep purpose/page class in `TextureKey` only when renderer/page compatibility requires it.
- **Risk: temporary adapter layer becomes permanent.**
  - Mitigation: enforce the shim policy above; each phase must delete the old equality bridge in the touched path before moving on.
- **Risk: cleanup becomes a rename-only pass.**
  - Mitigation: Phase 9 audits behavior boundaries, tests, diagnostics, and type shapes, not just symbol names.
- **Risk: cheap palette replacement fingerprints collide.**
  - Mitigation: include `offset` and `count` outside the hash, use a shared deterministic 64-bit hash over replacement range bytes/colors, and treat a collision as acceptable visual-risk rather than a correctness/security guarantee. Do not upgrade to cryptographic hashes unless measured collisions become a real problem.

## Definition of Done

- Same source and shader interpretation in two landblocks maps to one `TextureKey`.
- Palette texture identity is resolver-predictable from base palette id, domain, usage, and replacement range fingerprints; it does not depend on replacement palette asset ids or prepared texture content hashes.
- Distinct material consumers bind through distinct `TextureBindingId`s without creating duplicate texture pool entries.
- Landblock eviction releases only owner references, not canonical texture identity.
- No texture-manager registry entry shares a mutable physical placement object with another entry.
- Follow-mode fuzz covers add/evict/re-add and cross-owner texture sharing.
- No temporary compatibility bridge remains in production code.
- Public texture pipeline boundaries expose separated texture, binding, and owner identity.
- Final non-test production SLOC in the touched texture identity paths is lower than before the refactor, or any increase is explicitly justified by deleted cyclomatic complexity.
- The final diff deletes more alias/bridge/compatibility code than it adds.
- No production path can construct a `TextureKey` from landblock id, object instance id, visual resource id, draw unit id, material wrap, filtering, mip generation, anisotropy, placement revision, or renderer `textureRefId`.
- Palette replacement identity has exactly one production policy: normalized ranges plus cheap deterministic 64-bit byte hashes.
- `npm run test:ts`, `npm run check`, and `npm run lint:ts` pass for `apps/holtburger-3d`.

## Open Questions

- None currently. Re-open only with a concrete counterexample from ACE, ACViewer, or captured runtime data.
