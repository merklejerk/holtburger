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

**Runtime evidence from the bug reports**

- The bug appears under follow-mode streaming where landblocks are evicted and new landblocks stream in.
- Selection diagnostics show active renderer payloads can report `pageVersion.placementRevision` behind `latestResidentPageRevision` for the same page ref.
- The stale state is visible at the texture commit/resolution boundary before guessing about shader or browser-control behavior.
- Captured repros include cross-landblock buildings with shared material texture sources but different landblock/resource ownership.
- The fuzz target must therefore exercise owner churn, placement revision movement, page repack/growth, and active binding resolution after eviction/re-add.

## Answered Design Decisions

- **Aliases are the footgun we are deleting.** Sharing must be represented as many `TextureBindingId`s and `TextureOwnerId`s pointing at one immutable `TextureKey` entry. Do not preserve alias lists, alias scans, or shared mutable `physicalEntry` objects.
- **`textureUseId` is not a real primitive.** It mixed source identity, material binding semantics, residency ownership, and placement lookup. New code should not mint replacement `textureUseId` values or preserve its spelling as a compatibility token.
- **Existing canonical handles are ingredients, not the final model.** `sourceKey` / `physicalSourceKey` can feed `TextureKey`, but the public pipeline target is still `TextureKey`, `TextureBindingId`, `TextureOwnerId`, and `TexturePageClass`. Do not add another canonical-string layer beside them.
- **No owner discriminants in texture identity.** Landblock id, source instance id, visual resource id, draw unit id, and bake task id are ownership or binding facts. They deliberately sabotage texture-pool dedupe if they enter `TextureKey`.
- **Sampler policy is not texture identity.** Filtering, mip generation, and anisotropy are renderer/global policy derived from sample class. Material wrap belongs to binding semantics, and physical wrap belongs to page compatibility only when shader virtual wrap cannot provide the sampling behavior.
- **Palette replacements have one identity policy.** Replacement palettes are not assets for identity purposes. All palette replacement identity is based on normalized replacement ranges with a cheap deterministic 64-bit byte hash; no asset-id-first or pixel-hash fallback is allowed.
- **Resolver prediction wins over prepared pixels.** The resolver may read palette range bytes needed for fingerprints, but it must not compose/load full prepared palette textures merely to predict a `TextureKey`.
- **Tests should ossify the new contract, not the migration.** Delete or rewrite tests that preserve old scoped strings, alias behavior, or equality between binding and placement ids.
- **Speculative fixes are debt unless the model proves them.** Any earlier workaround that cannot be justified by a failing state-machine reproducer should be deleted during cleanup instead of defended as hardening.
- **A texture source id means immutable texture content, not render ownership.** Render surface id, base palette id, or runtime-authored content id may enter `TextureKey`; source asset id, object instance id, landblock id, draw unit id, and visual resource id may not.
- **The remaining renderer bridge is explicitly temporary.** Any map that exists only because renderer payloads still resolve by legacy item ids must be deleted by the renderer binding cutover. It must not grow behavior or become a second registry.

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
- **Reproduction before repair.** If Phase 5 cannot reproduce the observed stale revision class, it must produce a narrower proof that the fault lives outside `TextureManager` commit state before the plan proceeds.
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
- source asset id when it names the object/model owner rather than immutable texture content;
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

**Status:** Complete.

**Course correction:** Once planners emit real `TextureRequest`s, the registry cutover can delete alias behavior instead of translating old scoped ids. Current evidence after Phase 3 shows one missing boundary: `StaticBakeTextureUse` and `DynamicTextureUseCommit` still reach `TextureManager` without planner-provided `TextureKey`, `TextureBindingId`, `TextureOwnerId`, and `TexturePageClass` facts. Phase 4 must first upgrade those commit payloads and their producers. Deleting `createLegacyTexturePlacementIdentity(...)` before that would only move the guessing into a different helper.

**Steering update:** The answered identity questions make this a clean-cutover phase, not an adapter phase. `TextureManager` must stop treating `textureUseId` as a source of truth and must not create a replacement mega-id from owner, sampler, and source facts. Commit payloads may carry legacy renderer/dependency ids only while a downstream boundary still requires them, but registry identity, ownership, placement, and eviction decisions must use the separated planner facts exclusively.

**Deliverables**

- Extend static and dynamic texture-use commit payloads to carry planner-provided:
  - `TextureBindingId`;
  - `TextureKey`;
  - `TextureOwnerId[]`;
  - `TexturePageClass`.
- Update static object visual publication, structured interior publication, terrain bake texture uses, and dynamic visual runtime commits to pass those facts from placement snapshots or material planning instead of deriving them in `TextureManager`.
- Replace `VisualTextureKey = domain + bucket + textureUseId` with registry entries keyed by `TextureKey`.
- Replace owner maps with `TextureOwnerId -> TextureKey` ownership/lease state. A plain `Set<TextureKey>` is acceptable only if the commit model proves owner removal is always whole-owner removal; otherwise use a small explicit lease count keyed by `(TextureOwnerId, TextureKey)` rather than reintroducing aliases.
- Replace renderer update production with a resolved binding map that starts from `TextureBindingId` and resolves through `TextureKey`.
- Delete `physicalEntry.textureUseIds` and implicit shared-entry aliasing during the cutover. Do not create a bridge object that keeps the alias model alive under a different name.
- Delete `createLegacyTexturePlacementIdentity(...)` at the start of this phase. Any caller that still needs it blocks the phase and must be converted rather than given a broader shim.
- Use planner-provided `TextureKey`, `TextureBindingId`, `TextureOwnerId`, and `TexturePageClass`; do not rederive identity from old strings inside `TextureManager`.
- Consume the Phase 3 palette recipe keys for palette texture `TextureKey`s. Do not derive palette identity from replacement palette asset ids or prepared `contentHash`.
- Keep placement revisions, renderer `textureRefId`s, and atlas rects as mutable placement facts behind the `TextureKey` entry, never as key components.
- Keep filtering, mip generation, and anisotropy entirely in sampler policy updates. They must not enter registry keys, owner maps, or page class derivation.
- Keep material wrap on binding/material data. Only physical page incompatibility belongs in `TexturePageClass`; wrap must never become part of `TextureKey`.
- Treat `sourceKey` and `physicalSourceKey` as source facts feeding `TextureKey`, not independent lookup handles inside the registry.

**Acceptance criteria**

- `StaticBakeTextureUse` and `DynamicTextureUseCommit` provide identity facts directly; `TextureManager` does not synthesize them from `textureUseId`, owners, or source bytes.
- Texture placement requests use `TextureKey`.
- No registry entries share mutable `physicalEntry` references.
- A page move updates one texture-pool entry, then all active bindings derive from that entry.
- Active binding lookup is `TextureBindingId -> TextureKey -> current placement`, not `TextureBindingId -> stale copied rect`.
- Owner removal is expressed in `TextureOwnerId`s and cannot accidentally release a canonical texture still retained by another owner.
- Tests assert that owner churn in follow mode changes owners/bindings without changing canonical texture keys.
- No helper needs to “find aliases” by scanning registry entries.
- `TextureManager` consumes planner-provided `TextureKey`, `TextureBindingId`, `TextureOwnerId`, and `TexturePageClass` from placement snapshots/commits. It must not derive canonical identity from old scoped strings except during the deleted-at-end migration step.
- The current `createLegacyTexturePlacementIdentity(...)` helper is removed or the phase is not complete.
- New tests should assert the negative space: landblock id, visual resource id, draw unit id, material wrap, filter, mip policy, anisotropy, placement revision, and renderer `textureRefId` do not affect registry `TextureKey` selection.
- Any remaining `textureUseId` field at this phase boundary must be documented as a downstream renderer/dependency compatibility field, not registry identity. If it influences registry state, the phase is not complete.

**Phase notes**

- `StaticBakeTextureUse` and `DynamicTextureUseCommit` now carry planner-provided `bindingId`, `textureKey`, `ownerIds`, and `pageClass`. `TextureManager` consumes those facts directly and no longer builds canonical identity from old scoped `textureUseId` strings.
- Deleted `createLegacyTexturePlacementIdentity(...)` and its owner/output-format helpers. Missing identity facts now fail at producer/test boundaries instead of being guessed in the manager.
- Registry keys are canonical `TextureKey`s. The old `VisualTextureKey = domain + bucket + textureUseId` composite was collapsed to the branded `TextureKey`.
- Owner lifetime state uses `TextureOwnerId -> registry entry ref` sets, not a lossy `TextureOwnerId -> TextureKey` map. This avoids the bucket-collision bug where the same canonical texture key could exist in multiple placement buckets and owner removal would find an arbitrary entry.
- Removed shared mutable `physicalEntry.textureUseIds`. Multiple legacy renderer item ids are tracked in a separate entry-ref lookup bridge only for the downstream renderer/dependency boundary that still resolves by `textureUseId`.
- Removed physical-source/content-hash dedupe from registry placement. Dedupe now happens through `TextureKey`; two different palette recipes with matching prepared bytes remain distinct canonical texture entries, though they may still pack onto the same atlas page.
- Renamed atlas diagnostics from `entryAliasCount` to `registryEntryCount` so diagnostics stop presenting the new model as aliases.
- Spicy bit: Phase 6 must delete the remaining `#itemIdsByTextureEntryRef` bridge by moving renderer material payloads and dependency pinning to `TextureBindingId`. Until then, it is an explicitly labeled compatibility seam, not registry identity.
- Verification for this phase included `npm run check` and focused Vitest coverage for `texture-manager`, dynamic visual baking, object visual static publication, and terrain geometry baking.

### Phase 5: TextureManager Fuzz and Palette Resolver Proof

**Status:** Complete.

**Steering update:** This phase is now a correctness gate. The follow-mode bug survived multiple narrow patches, so the plan must stop treating fuzz as extra confidence and use it as the place where the state machine is made observable. No renderer cutover work should proceed until the manager-level model either reproduces stale placement revision skew or proves the stale state is introduced downstream.

**Deliverables**

- Add the stateful fuzz harness around the new commit model before renderer payload cutover continues.
- Model follow-mode behavior explicitly: landblock owner add/remove, object visual reuse, page growth, page moves, texture eviction, and re-addition.
- Maintain an independent model of active owners, active bindings, canonical texture keys, expected placement revisions, and expected resident page revisions.
- Check invariants after every generated operation, not only at the end of a sequence.
- Add fixed seeds for the captured `db56ffff` / `01001117` and `da55ffff` / `01002a1b` failure shapes using synthetic checked-in texture facts rather than runtime-only assets.
- Generate palette replacement range recipes from runtime-authored replacement bytes and prove resolver-predictable keys do not require prepared texture texels.
- Include a reproducer printer that logs operation sequence, active owners, active bindings, texture keys, page revisions, and atlas rects.
- Keep the fuzz target close to `TextureManager` state, not browser controls or renderer draw code.
- Seed the model with the observed failure shape: an active binding whose reported placement revision lags the latest resident page revision after follow-mode eviction/re-add or page movement.
- Generate equivalent texture sources across distinct owner ids and landblocks so the harness proves dedupe through `TextureKey`, not through scoped aliases.
- Generate bindings that vary wrap while sharing one `TextureKey`, so the harness proves material sampling facts remain binding facts.
- Generate sampler policy changes during active ownership, so filtering/mips/aniso are proven to update sampler state without changing texture identity.
- Generate palette replacement recipes from normalized byte ranges and assert the resolver can predict keys without prepared texture pixel hashes.
- Prefer a deterministic in-repo seeded harness over adding a fuzz dependency unless dependency value is proven. The important artifact is replayable operation history, not library branding.
- Keep test helpers identity-aware. If a helper needs many stubs to build a texture commit, either collapse it into a focused fixture builder or fix the production API shape rather than expanding hollow mocks.

**Acceptance criteria**

- The fuzz harness can reproduce the follow-mode eviction/re-add class that motivated this plan, or it produces a narrower counterexample showing the bug lives outside texture commit state.
- The existing resident-page invariant remains and is expressed in terms of `TextureKey`, not logical texture-use aliases.
- An active binding may never point at a page version older than the resident texture page for its `TextureKey`.
- `pageVersion.placementRevision` and `latestResidentPageRevision` are compared as first-class model facts for every active binding after every operation.
- Owner eviction may only remove owner references. It must not invalidate the canonical texture entry while another owner or binding still references it.
- Re-adding an owner with the same canonical texture must reuse the existing `TextureKey` entry or recreate an equivalent entry with no stale binding state carried across.
- No helper needs to “find aliases” by scanning registry entries.
- Palette replacement fuzz covers runtime-authored replacement byte ranges with the single cheap-hash policy.
- Fuzz failures print separated binding id, texture key, owner id, page class, page revision, resident revision, and rect. They must not require decoding a composite id to understand the failure.
- Tests do not assert old scoped `textureUseId` spellings.
- If the manager-level fuzz cannot fail on the captured stale-revision shape, Phase 8 must own the next reproducer boundary explicitly instead of continuing to patch `TextureManager`.

**Phase notes**

- Added deterministic stateful fuzz coverage directly against `TextureManager` using real `applyStaticCommitDelta(...)`, owner removal, palette placement, page absorption, sampler policy updates, and placement-resolution snapshots.
- The harness seeds the reported `db56ffff` / `01001117` and `da55ffff` / `01002a1b` shapes with synthetic checked-in texture facts, then continues with deterministic pseudo-random owner churn and texture additions.
- The first harness run reproduced the stale-revision class before the fix. The minimal failure shape was: two bindings share one `TextureKey`; one owner is evicted and re-added; a later compatible texture is absorbed into the same page; the resident page revision advances, but an existing binding record still reports the old revision.
- Root cause: the atlas absorption path updated existing registry entries' physical placement revision/runtime page, but did not refresh every binding/item placement record for those existing entries. Page-local repack already did this correctly; absorption was the missing branch.
- Fix: when absorption advances a page revision, refresh placement records and resolved placements for every existing binding associated with each existing registry entry before recording the newly absorbed entries.
- The older unit test for compatible absorption was rewritten because it ossified the bug by expecting only the newly absorbed binding in `resolvedTexturePlacements`. The correct contract is that a page revision change resolves all active bindings on that page.
- Palette replacement fuzz uses runtime-authored byte ranges with the shared cheap fingerprint policy. It does not read prepared palette texture pixels to predict recipe keys.
- Spicy bit: the fuzz invariant still probes active bindings through `createPlacementResolutionSnapshot(itemIds)`, which is the Phase 6 renderer bridge boundary. This is intentional for Phase 5 because the bug is visible there, but Phase 6 must delete the legacy item-id lookup bridge and move the same invariant to `TextureBindingId`.

### Phase 6: Renderer Binding Cutover

**Status:** Complete.

**Deliverables**

- Update `StaticMaterialTableEntry` texture fields from `*TextureUseId` to `*TextureBindingId`.
- Add a renderer-side or commit-side binding table:
  - `TextureBindingId -> TextureKey`
  - `TextureKey -> ResolvedTexturePlacement`
- Shape commit/update payloads so WebGL object and terrain payloads can resolve by binding id without rebuilding a `Map<textureUseId, placement>`.
- Update WebGL2 object and terrain payload preparation to resolve through this split.
- Delete renderer-facing payload fields that still expose texture pool identity as `*TextureUseId`.
- Delete the current renderer lookup bridge that maps legacy item ids to registry entry refs.
- Ensure renderer material payloads do not cache copied atlas rect/page-version state when they can resolve current placement through `TextureBindingId`.
- Keep material wrap in material payload/binding data. Do not move wrap into `TextureKey` to make renderer lookup easier.
- Keep filtering, mip generation, and anisotropy in renderer sampler policy. Do not serialize them through placement snapshots as identity facts.

**Acceptance criteria**

- Renderer diagnostics show binding id and texture key separately.
- Missing binding, missing texture key, missing placement, and missing resident page are distinct failures.
- No renderer code assumes a binding id is a texture pool id.
- No renderer helper accepts either `TextureBindingId` or `TextureKey` as a plain interchangeable string parameter.
- Renderer tests prove two bindings with different wrap can resolve the same `TextureKey` while producing different wrap uniforms where required.
- Renderer tests prove a page movement updates active binding resolution without stale copied placement payloads.

**Phase notes**

- Renderer placement maps now key resolved placements by `TextureBindingId`, not legacy texture-use item ids. WebGL object and terrain payload preparation resolve material entries through binding ids.
- Static object, structured interior, terrain, dynamic visual, and reusable visual geometry payloads now carry branded `TextureBindingId` values for renderer material texture references.
- `ResolvedTexturePlacement` now carries both `bindingId` and legacy `textureUseId`. Renderer code consumes `bindingId`; `textureUseId` remains diagnostics/publication residue until the cleanup phase deletes the remaining item-id terminology.
- Terrain placement intents now use the binding id as the placement item id. This removed the terrain-only branch where bake-time draw units used legacy prepared texture ids while renderer placement snapshots used a different concept.
- Object/structured/static material tests were rewritten to assert binding-id relationships instead of ossifying old scoped string spellings. Fixture placement records now include real binding ids, which caught stale test lies that previously produced `undefined` material bindings.
- Spicy bit: public fields named `textureUseIds` still exist in draw units and visual payloads, but their renderer-facing values are now binding ids. This is a naming debt, not a compatibility path. Phase 7/cleanup must either rename them or remove them from reusable identity surfaces.
- Spicy bit: `TextureManager` still has item-id bookkeeping for placement records and publication diagnostics. The renderer no longer consumes that as its lookup key, but the manager's internal `#bindingIdByItemId` bridge remains as a transition detail because `TexturePlacementUpdate` still publishes legacy diagnostic item ids.
- Steering decision: do not add shims that accept both old and new renderer ids. Tests should construct `TextureBindingId`s through the real builders or compare producer relationships.

### Phase 7: Visual Resource Key Cleanup

**Status:** Complete.

**Deliverables**

- Replace `textureUseIds` in object visual resource keys with stable material binding layout and texture identity keys where resource identity truly depends on material texture identity. Do not keep binding ids in reusable resource keys when they include resource/draw-unit scope.
- Verify landblock-scoped owner ids cannot enter reusable visual resource keys.
- If `TextureBindingId` contains resource or draw-unit scope, do not include it in reusable resource identity. Use slot/role/material layout plus `TextureKey` instead.
- Remove resource-key tests that only assert legacy scoped texture-use id sorting.
- Rename or delete renderer-facing `textureUseIds` fields after they stop participating in reusable resource identity. If a field remains for dependency pinning, name it `textureBindingIds`.

**Acceptance criteria**

- Same source visual resource in different landblocks can share resource identity when geometry/material/pool texture identity match.
- Tests explicitly cover cross-landblock shared texture/source cases.
- Visual resource ids do not change when only owner/landblock changes.

**Phase notes**

- Removed `textureUseIds` from reusable object visual resource keys. Resource key serialization no longer includes scoped renderer binding ids.
- Added stable texture identity key fields to static/object visual material entries beside the renderer binding ids. The renderer still consumes `*TextureBindingId`; resource-key comparison consumes `*TextureKey` fields.
- Course correction: full `TextureKey` is not available at `StaticMaterialTableEntry` creation without moving resolver texture identity work earlier. Static-authored entries therefore store the resolver-predictable `TextureBindingRequirement.sourceKey` in the `*TextureKey` fields. Dynamic/object-visual bindings use their already resolved texture key. This is the cleanest available boundary for Phase 7 and avoids decoding scoped binding strings.
- Resource key tests now prove scoped binding id changes do not change reusable resource identity, while stable texture identity key changes do.
- Spicy bit: the field names are still `*TextureKey` even though static-authored values are source keys at this boundary. The cleanup phase should either rename these to `*TextureIdentityKey` or move texture-key resolution earlier so the names become literal.
- Remaining naming debt: draw units and visual payloads still expose `textureUseIds` arrays whose renderer-facing values are `TextureBindingId`s. This is not part of reusable resource identity anymore, but the cleanup phase should rename it to `textureBindingIds` where the field remains.

### Phase 8: Follow-Mode Scenario Regression And Diagnostics

**Status:** Complete.

**Steering update:** Phase 5 already reproduced the stale page-revision class inside the `TextureManager` state machine and turned it into a deterministic regression. After the Phase 6 renderer binding cutover, no new independent renderer-owned placement cache appeared in the audited path. Phase 8 therefore stays focused on separated diagnostics and on keeping the Phase 5 model as the canonical follow-mode reproducer, instead of adding a browser harness that would duplicate the same state boundary with more stubs.

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
- If Phase 5 proved the stale state is downstream of `TextureManager`, this phase becomes the primary reproducer phase and must model the exact downstream boundary that copied or failed to refresh placement state.

**Acceptance criteria**

- Fuzz fails if an active binding points at a stale page revision.
- Fuzz fails if two equivalent texture sources with different owner ids create distinct texture pool entries.
- Fuzz fails if owner eviction releases a texture still retained by another owner.
- Scenario diagnostics can distinguish stale binding, stale texture key, stale resident page, and stale atlas rect without reading a composite string.
- The captured follow-mode scenario either stays green or emits a short reproducer from the Phase 5 model.
- Any fix for the original bug must point to a failing reproducer first, then the commit that turns it green. No more guessed patches, respectfully.

**Phase notes**

- Selection/runtime texture placement snapshots now expose `bindingId` and `textureKey` as separate facts beside `itemId`, `textureRefId`, `pageVersion`, atlas `rect`, and `activeReferenceCount`.
- Renderer texture diagnostics already print `latestResidentPageRevision` and `lastTexturePlacementUpdateRevision` beside material-entry page versions and rects. With the new snapshot fields, stale binding, stale canonical texture identity, stale resident page, and stale atlas rect can be distinguished without decoding a composite string.
- Found and fixed a diagnostic-only alias bug: secondary placement records were reporting the canonical registry entry binding id instead of the specific item binding id. Rendering had already cut over to binding ids; this bug made diagnostics look more alias-shaped than the runtime path.
- The Phase 5 manager fuzz remains the follow-mode regression boundary for `db56ffff` / `01001117` and `da55ffff` / `01002a1b`-style owner churn. It checks active binding page revisions against resident page revisions after add, evict, re-add, absorb, repack, and sampler-policy operations.
- Browser harness validation later found a distinct binding-resolution bug at the object-visual placement snapshot boundary: shared canonical texture entries were correctly deduped by `TextureKey`, but planned placements could still be stamped with the first registry-entry binding instead of the current requesting `TextureBindingId`. The fix was to key object-visual snapshots by binding id and to have planned placements preserve the current intent binding while sharing the physical texture entry.
- Remaining debt: owner ids are still not printed directly in per-selection placement snapshots. Owner lifetime is visible through manager reference snapshots and active reference counts; Phase 9 should decide whether per-selection owner details are worth the extra surface.

### Phase 9: Simplification Audit And Resteer

**Status:** Complete.

**Steering update:** The answered identity questions are now reflected in the target model: no owner/source-instance discriminants in `TextureKey`, sampler policy split out of identity, material wrap kept on binding/page compatibility, one cheap palette replacement fingerprint policy, and resolver-predictable keys without prepared texel composition. The remaining risk is no longer conceptual uncertainty; it is cleanup debt from old field names and item-id bridges still carrying binding ids under `textureUseId` vocabulary.

**Deliverables**

- Measure non-test production SLOC for the touched texture identity paths against the pre-refactor baseline or first available commit before this plan's implementation.
- Audit cyclomatic/state complexity qualitatively:
  - count alias maps and scans;
  - count bridge maps between old and new ids;
  - count call boundaries accepting plain `string` where a branded texture id should exist.
- Audit dynamic texture identity:
  - identify whether runtime-authored source keys are truly runtime-local bytes or accidental static texture aliases;
  - decide whether dynamic palette/runtime replacements need their own asset-reader-backed planning boundary before final cleanup.
- Audit remaining canonical-handle vocabulary:
  - `sourceKey` / `physicalSourceKey` must be source facts only;
  - `textureRefId` must be renderer page identity only;
  - no public path should present any of them as the canonical texture-pool handle.
- Re-run forbidden-discriminant tests for `TextureKey`, `TexturePageClass`, and renderer sampler policy after the registry and renderer cutovers.
- Resteer the final cleanup checklist based on actual remaining hits, not assumptions.
- Identify and delete any earlier speculative fix that is not required by the fuzz/model invariants.
- Record a before/after count for compatibility bridges, alias maps, owner maps, and plain-string public texture identity parameters.

**Acceptance criteria**

- The plan has a concrete metric note stating whether non-test production SLOC is trending down, flat, or up, and why.
- Any production SLOC increase is paired with a deleted complexity note, such as removed alias fanout or removed stale-placement state.
- No new cleanup phase begins with unresolved uncertainty about palette replacement identity, sampler policy placement, or canonical handle ownership.
- Dynamic/runtime identity debt is either resolved or explicitly moved to a named follow-up with its blocked boundary and desired shape.

**Phase notes**

- Baseline for the production SLOC metric is `f74b997f^`, the parent of the first texture identity-builder commit. Current touched non-test paths under `textures`, `static`, `visual`, and `renderer` are net **+1,042 lines** (`1601` insertions, `559` deletions).
- The increase is concentrated in real new model code, not mostly shims: `textures/identity.ts`, `textures/material-texture-identity.ts`, `textures/palette-replacement-recipe.ts`, and `static/texture-owner-identity.ts` account for `684` added lines. `TextureManager` itself is net `-6` lines across the refactor so far.
- This is acceptable only as an interim metric. The final metric must trend down or explicitly justify the remaining increase by deleted state-machine complexity. Phase 10 should therefore delete/rename old identity surfaces before adding any new production abstraction.
- Production audit found `211` remaining hits for old identity or bridge vocabulary: `textureUseId`, `textureUseIds`, `bindingKey`, `placementItemId`, `Legacy`, `Bridge`, or `Compat`.
- The largest remaining debt is `TextureManager` diagnostic/packing item-id vocabulary: `#bindingIdByItemId`, `#placementRecordsByItemId`, `textureUseIds` sets on pending entries, and placement publication helpers. These now mostly carry `TextureBindingId`s and should be renamed/collapsed around binding ids, not treated as texture identity.
- Public/static payload debt remains in `static/contracts.ts`, `visual/visual-geometry.ts`, terrain material outputs, and recipe publication: fields named `textureUseIds` are typed as `TextureBindingId[]`. Phase 10 should cleanly rename those to `textureBindingIds`.
- `TextureBindingRequirement.bindingKey`, `placementItemId`, and `textureUseId` remain in `textures/placement.ts` and planner call sites. They are the biggest conceptual fossil. Phase 10 should collapse them into explicit `bindingId` plus any truly separate numeric/object-visual placement id, instead of preserving the old triple.
- `StaticMaterialTableEntry.*TextureKey` fields still hold source-key strings for static-authored entries. Phase 10 should either rename them to texture identity/source keys or move full resolver `TextureKey` construction earlier so the field names become literal.
- Existing `sourceKey` / `physicalSourceKey` uses are source facts and physical prepared-source facts, not canonical handles. Keep them where they describe source data, but do not let them substitute for `TextureKey` at pool boundaries.
- Phase 9 did not initially identify dynamic/runtime identity as a blocker, but Phase 10 proved that was too optimistic: runtime-authored dynamic visual dependencies still pinned legacy `textureUseId` values and blocked renderer resource commits after the binding-id cutover. Dynamic material cleanup is therefore in scope where it touches the shared `TextureManager` commit path.

### Phase 10: Holistic Cleanup And Compatibility Purge

**Status:** Complete.

**Steering update:** Cleanup order matters. Start with public contract names that already carry `TextureBindingId`, then collapse planner triples, then remove manager item-id bridges, then clean packing protocol names. Do not add shims. If a rename reveals that two concepts are still actually distinct, split them into honest typed fields and delete the old composite field in the same phase.

**Policy steering from answered questions:** This phase is no longer a rename-only sweep. It is the final contract pass that proves the design decisions above actually reached the code:

- `TextureKey` is the canonical texture handle. `sourceKey` and `physicalSourceKey` may remain only as source/prepared-source facts, not as competing canonical handles.
- `TextureBindingId` is the material-consumer handle. Material wrap may live there or in material binding data, but it must not leak into `TextureKey`.
- Filtering, mip generation, and anisotropy are renderer/global sampler policy. They must not appear in `TextureKey`, `TexturePageClass`, registry keys, placement item keys, or binding ids.
- `TexturePageClass` is atlas/page compatibility only. Keep physical wrap there only if the renderer cannot virtualize the material wrap behavior in shader.
- Palette replacement identity has one production policy: normalized replacement ranges plus cheap deterministic 64-bit range-byte fingerprints. No replacement palette asset id fallback, no prepared-pixel hash fallback, no SHA-256.
- Landblock id, source object/model id, visual resource id, draw unit id, bake task id, and runtime owner id are forbidden texture-pool discriminants. If they appear in a key, it must be a binding or owner key, not a texture key.
- Any previous speculative stale-placement fix that is not required by Phase 5/8 fuzz invariants should be removed. The harness decides what is real; diagnostics do not get to drive architecture.
- The final result must trend toward less code and less state. If non-test production SLOC remains above the baseline, the phase must record the specific alias/bridge/state-machine complexity that was deleted to justify it.

**Deliverables**

- Remove or rename `textureUseId` in touched runtime texture paths.
- Rename public arrays currently typed as `TextureBindingId[]` from `textureUseIds` to `textureBindingIds` in static contracts, visual geometry, terrain material outputs, draw units, recipe publication, and renderer consumers.
- Collapse `TextureBindingRequirement.bindingKey`, `placementItemId`, and `textureUseId` into explicit `bindingId` plus any truly separate object-visual placement id. Do not keep three fields when they all carry the same material consumer identity.
- Replace `TextureManager`'s item-id diagnostic bridge vocabulary with binding-id vocabulary where the values are binding ids, then delete `#bindingIdByItemId` if the record key itself can become `TextureBindingId`.
- Rename packing protocol `textureUseId` fields to neutral atlas entry ids only if the packer still needs non-binding atlas entry keys; otherwise pass `TextureBindingId` through directly.
- Resolve the static-authored `*TextureKey` naming debt by either moving resolver `TextureKey` facts into material entries or renaming the resource-key fields to a source/identity-key name that does not lie.
- Delete alias helpers introduced to patch shared `physicalEntry` behavior.
- Delete any speculative stale-placement workaround that Phase 5/8 did not require.
- Delete tests that preserve old scoped `textureUseId` string formats.
- Delete all temporary types/functions/files containing `Legacy`, `Bridge`, or `Compat` from this refactor.
- Remove bridge fields where both old and new identity are carried in the same object.
- Remove alias fanout, bridge maps, old equality comments, old test fixtures, and stringly helper signatures as behavior cleanup, not just symbol cleanup.
- Revisit `TextureBindingRequirement`, `TexturePlacementIntent`, `TexturePlacement`, `StaticBakeTextureUse`, `StaticMaterialTableEntry`, `StaticObjectVisualResourceKey`, and renderer diagnostics for stale names.
- Replace stringly helper parameters with branded or structured identity types where the distinction matters.
- Update diagnostics labels and docs.
- Delete empty compatibility wrappers that only convert one branded id to another branded id without changing domain meaning.
- Collapse or remove any test factories that exist only to feed both old and new fields.
- Collapse fixture APIs that require broad stubbing just to submit a texture commit. Those tests are telling us the production boundary is still too god-object-shaped.
- Audit all remaining `sourceKey`, `physicalSourceKey`, and `textureRefId` fields. Rename any field that pretends to be canonical texture identity when it is actually source identity, prepared-source identity, or renderer page identity.
- Audit texture key builders for forbidden discriminants: landblock, object/source model owner, visual resource, draw unit, bake task, wrap, filter, mip policy, anisotropy, placement revision, and renderer texture ref.
- Audit page-class builders for sampler-policy leakage. Page class may describe page compatibility, not current renderer sampler settings.
- Audit palette replacement builders for the one-policy rule. Delete any branch that prefers replacement palette asset ids, prepared palette texture hashes, or cryptographic hashing.
- Audit the earlier stale-placement work against the Phase 5 reproducer. Delete any logic whose only justification was "hardening" rather than a failing invariant.
- Re-run `rg` audits for forbidden identity mixing:
  - `textureUseId`;
  - `bindingKey`;
  - `placementItemId`;
  - `sourceKey`;
  - `physicalSourceKey`;
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
- `TextureKey` builders reject or never receive owner/resource/sampler-policy discriminants.
- `TexturePageClass` builders do not include filter, mip generation, anisotropy, binding id, owner id, or material scope.
- Palette replacement identity has exactly one implementation path and it uses the shared cheap 64-bit range-byte fingerprint policy.
- Remaining `sourceKey`, `physicalSourceKey`, and `textureRefId` names are source/prepared-source/page facts only; none are described or consumed as the canonical texture-pool handle.
- Any retained stale-placement update logic is tied to a Phase 5/8 invariant or deleted.
- The final diff removes more identity compatibility code than it adds.
- Final non-test production SLOC in touched identity paths is lower than the plan baseline, or the remaining increase is explicitly accepted because a measurable alias/state-machine complexity class was deleted.

**Phase notes**

- Renamed public draw/resource arrays from `textureUseIds` to `textureBindingIds` where the values are material binding handles: static contracts, terrain/static object/env-cell draw units, visual geometry, recipe publication, runtime diagnostics, and renderer-facing fixtures.
- Collapsed the production `TextureBindingRequirement` triple. `bindingKey`, `placementItemId`, and `textureUseId` no longer travel together as three names for one material consumer identity; production requirements now expose `bindingId` plus the remaining bake-time placement lookup only where that is actually distinct.
- Deleted production `createStaticMaterialTextureUseId` / `createTerrainTextureUseId` minting. Static material policy now creates binding ids directly from material/resource binding axes instead of source/owner scoped texture-use strings.
- Removed the `TextureManager` `#bindingIdByItemId` bridge and moved packing/update internals toward binding ids or neutral `entryKey`s. The packer protocol no longer calls its entries `textureUseId`.
- Fixed a real dynamic/runtime cutover bug: `LocalDynamicVisualBaker` was still pinning dynamic texture dependencies by legacy `textureUseId`. Renderer resource sync then failed with `Cannot pin unknown texture placement item ...` after all assets and placements were ready. Dynamic dependencies now pin the live binding id used by the shared texture-manager placement records.
- Removed the remaining production `textureUseId` / `textureUseIds` spelling from runtime texture placement paths, renderer placement DTOs, object-visual placement planning, and static material adapter callbacks. Exact spelling now survives only in this historical plan text.
- Audit result: production no longer contains `textureUseId`, plural `textureUseIds`, `bindingKey`, `#bindingIdByItemId`, or the deleted texture-use-id builder helpers. Remaining `placementItemId` occurrences are legitimate bake-time lookup plumbing for object visual material partitioning.
- Audit result: `sourceKey` / `physicalSourceKey` remain source/prepared-source facts and are not used as competing canonical pool handles. `textureRefId` remains renderer page identity. No Phase 10 changes added owner/sampler policy discriminants to `TextureKey`.
- Palette replacement policy remains the one-policy design from Phases 1-2: normalized ranges plus the shared cheap 64-bit range-byte fingerprint. No SHA or asset-id fallback was added.
- SLOC metric: the Phase 10 diff is roughly code-neutral (`+657/-610` overall at validation time), with production complexity reduced by deleting the old static texture-use id minting helpers, the manager item-id-to-binding bridge, and stale triple-field requirements. The net line increase is accepted because it buys clearer contracts and less hidden state.
- Validation:
  - `npm run test:ts` passed: 87 files, 703 tests.
  - `npm exec tsc -- --noEmit --pretty false` passed.
  - `npm run lint:dead` passed.
  - `npm run lint:ts` passed.
  - `npm run check` passed.
  - `npm run harness:browser` passed after the binding-resolution fix. The sandboxed run cannot bind the local dev asset host; the successful run was unsandboxed.
  - `git diff --check` passed.

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
