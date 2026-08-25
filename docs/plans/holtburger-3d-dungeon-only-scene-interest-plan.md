# Holtburger 3D Dungeon-Only Scene Interest Plan

Date: 2026-08-24
Status: original implementation complete; Phases 1-11 and Addendum A complete; retained-outdoor
policy superseded by Addendum B

> Historical note: the original plan intentionally retained the previous outdoor render window
> during dungeon visits. Runtime evidence later proved that policy observable and unsafe when camera
> authority targeted a still-registered entity outside current collision interest. Addendum B records
> the clean replacement cutover; earlier retention sections remain as implementation history.

## Context And Boundaries

### Goal

Make dungeon navigation request only the owning landblock's EnvCell presentation while preserving a
bounded previously loaded outdoor window, with classification and interest planning reusable by both
the Explorer and the future client route.

### Background

Before implementation, Explorer world input already distinguished an eight-digit EnvCell DID from
an outdoor landblock DID, but `ExplorerCameraCoordinator.requestSceneInterest(...)` collapsed both
into the same outdoor-centered `SceneInterestRequest`. The outdoor planner unconditionally included
terrain across `terrainRadius`, so requesting `00050100` loaded a full outdoor neighborhood even
though `0005FFFF` is a dungeon-only landblock.

The renderer materialization pipeline is not the owner of this decision. The decision depends on
stable facts in `CellLandblock` and `LandblockInfo`, and it must happen before the app knows which
renderer layers to request. The canonical shallow `LandblockAsset` already reads those records and
is cached by `ContentAssetService`, so classification can be computed once in
`holtburger-content` and projected through a small profile capability without creating another DAT
asset or decoding the landblock twice.

The desired residency policy is intentionally narrower than retail. Retail uses each EnvCell's
`SeenOutside` flag to release or retain landscape. This plan does not reproduce that memory policy.
Modern hardware permits retaining the last outdoor neighborhood while visiting a dungeon, and no
demonstrated requirement justifies per-cell outdoor eviction. `SeenOutside` remains authoritative
for rendering, lighting, ambience, and portal semantics; it does not drive static scene interest.

### In Scope

- Derive one canonical shallow landblock classification in `holtburger-content`.
- Match ACE's proven dungeon-only classifier, including its northwest-island exception.
- Expose a lightweight landblock-profile capability through both Tauri and the development HTTP
  host.
- Cache and deduplicate frontend profile requests per landblock owner.
- Introduce shared app-runtime scene-target and resolved-interest contracts usable by Explorer and
  future client mode.
- Support explicit outdoor, exact EnvCell, and automatic four-digit landblock targets.
- Resolve automatic and EnvCell targets through the landblock profile before renderer
  materialization.
- Request exactly the owning `EnvCells` layer for a dungeon-only target.
- Retain at most one previously established outdoor interest window while a dungeon target is
  active; never synthesize an outdoor radius around the dungeon.
- Retain at most one active dungeon EnvCell demand; a new dungeon target replaces that demand, and
  the effective diff evicts the old owner's layer only when retained outdoor interest does not also
  require it.
- Preserve Explorer outdoor radius controls while they are temporarily inapplicable to a dungeon.
- Give a bare dungeon owner a deterministic Explorer focus cell of `0x0100`, explicitly treated as
  frontend focus policy rather than an authored entrance claim.
- Keep follow-camera interest anchored to the active dungeon owner when free flight crosses nominal
  outdoor landblock coordinates or leaves all authored EnvCell containment.
- Extend the browser harness to prove cold dungeon loading, exact-cell loading, retained outdoor
  interest, dungeon follow-camera containment loss, and later outdoor replacement.
- Remove or rename outdoor-only scene-interest vocabulary made false by the cutover.

### Out Of Scope

- Reproducing retail's per-EnvCell landscape release behavior.
- Using `SeenOutside` to switch static content residency.
- Inferring dungeon status from an EnvCell suffix, `SeenOutside`, flat terrain alone, or EnvCell
  presence alone.
- Changing simulation-interest radius or static collision residency. The existing radius-two
  simulation policy remains independent until measured cost or correctness evidence justifies a
  change.
- Implementing the future `ClientApp` product surface. This plan leaves it a direct shared-runtime
  consumer rather than adding speculative client UI or server-session behavior.
- Retaining an unbounded history of outdoor or dungeon scenes.
- Adding a renderer-side dungeon branch, dungeon renderer DTO, or dungeon-specific materialization
  worker.
- Adding a new HBA record or precomputed classification table.
- Treating `0x0100` as a proven dungeon entrance or canonical teleport destination.
- Treating free-camera noclip movement as an authored dungeon exit or authoritative world
  transition.
- Modifying ACE, ACViewer, or the retail decompile.

## Ground Truth

### Primary Reference Sources

- `ACViewer/ACE/Source/ACE.Server/Entity/Landblock.cs:1241-1301`
  - `IsDungeon` means no traversable overworld.
  - The classifier requires every height byte to be zero, at least one EnvCell, and zero buildings.
  - Landblocks with `X < 0x08` and `Y > 0xF8` are explicitly excluded because northwest water-cell
    authoring makes the raw signature unreliable there.
  - `HasDungeon` is distinct from `IsDungeon`; mixed landblocks must remain on the outdoor path.
- `ACViewer/ACE/Source/ACE.Server/Managers/LandblockManager.cs:203-217,577-582`
  - ACE places each `IsDungeon` landblock in its own group, excludes dungeon groups from outdoor
    grouping, and returns no coordinate-adjacent landblocks for a dungeon.
- `ACViewer/ACE/Source/ACE.Server/Entity/Landblock.cs:1111-1123`
  - Activating an `IsDungeon` landblock does not recursively activate coordinate-adjacent
    landblocks, unlike outdoor activation.
- `ACViewer/ACE/Source/ACE.Server/Entity/LandblockGroup.cs:85-107`
  - ACE enforces the one-dungeon-landblock group invariant in both directions: nothing may join a
    dungeon group, and a dungeon may not join an existing group.
- `acclient-eor-source/acclient.c:140315-140340`
  - Retail distinguishes outdoor cells from EnvCells by the low 16-bit cell selector before
    prefetch.
- `acclient-eor-source/acclient.c:140474-140485`
  - Retail may release landscape in an EnvCell without `SeenOutside`; this is evidence about retail,
    not a requirement adopted by this plan.
- `crates/holtburger-dat/src/landblock.rs`
  - Canonical decoded `CellLandblock` and `LandblockInfo` fields used by classification.
- `crates/holtburger-content/src/landblock.rs`
  - Canonical shallow `LandblockAsset` assembly, normalized ownership, terrain height indices,
    buildings, and contiguous EnvCell references.
- `crates/holtburger-core/src/content_assets.rs`
  - Shared `ContentAssetService::load_landblock(...)` foundation cache and
    `ContentAssetRuntime` in-flight request deduplication.
- `apps/holtburger-3d/src-tauri/src/landblock_source_batch.rs`
  - Renderer source batches already load the same shallow foundation and resolve only requested
    deep products.

### Existing App Patterns

- `apps/holtburger-3d/src/lib/assets/landblock-source-batch.ts`
  - Narrow source capability injected into the materialization pipeline.
- `apps/holtburger-3d/src/lib/assets/tauri-landblock-source-batch.ts`
  - Tauri implementation of an app asset capability.
- `apps/holtburger-3d/src/lib/assets/http-landblock-content-source.ts`
  - Browser-harness implementation of the same host capability family.
- `apps/holtburger-3d/src-tauri/src/lib.rs`
  - Shared Rust response builder used by Tauri commands and non-Tauri diagnostics.
- `apps/holtburger-3d/src-tauri/src/bin/dev_landblock_content_host.rs`
  - HTTP route parity for the production content runtime.
- `apps/holtburger-3d/src/lib/game/runtime/scene-interest.ts`
  - Current layer-map derivation and diff contract.
- `apps/holtburger-3d/src/lib/game/runtime/scene-interest-commit-coordinator.ts`
  - Revisioned asynchronous layer preparation, stale rejection, and exact diff eviction.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
  - Current scene-interest application, terrain-fog coverage, layer realization, and teardown.
- `apps/holtburger-3d/src/explorer/world-input.ts`
  - Explorer-only parsing of four-digit prefixes, full DIDs, and map coordinates.
- `apps/holtburger-3d/src/explorer/explorer-camera-coordinator.ts`
  - Current Explorer-owned request/focus flow that must delegate shared interest resolution while
    retaining camera policy.
- `apps/holtburger-3d/src/explorer/explorer-residency.ts`
  - Current point-resolution policy retains whether a camera residency came from exact EnvCell
    containment or from the coordinate-derived outdoor fallback.
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
  - Canonical point query proves an EnvCell keeps its authored owner even when its geometry extends
    across the owner's nominal 192-meter outdoor landblock boundary.
- `apps/holtburger-3d/src/harness/browser/BrowserHarnessApp.svelte`
  - Canonical noninteractive runtime composition and scene-interest control surface.
- `apps/holtburger-3d/scripts/browser-harness.mjs`
  - Production-content request diagnostics and runtime assertions.

### Investigation Evidence

The repository-local `dats/assets.hba` census covered 65,025 landblock roots:

- 1,744 roots matched the raw zero-height/EnvCell/no-building signature.
- 24 of those were in ACE's northwest exception, leaving 1,720 dungeon-only roots.
- 28 roots contained unattached EnvCells but non-flat outdoor terrain and therefore remained mixed.
- 1,633 roots had building-owned interiors.
- 26,227 roots had all-zero heights without a dungeon, proving that flat terrain alone is not a
  classifier.
- No `CellLandblock` that promised `LandblockInfo` was missing its matching record.

`0005FFFF` is the representative acceptance fixture:

- all 81 authored height bytes are zero;
- `LandblockInfo.NumCells` is 817;
- building count is zero;
- explicit outdoor object count is zero;
- `00050100` exists and does not carry `SeenOutside`;
- its complete topology contains zero outdoor-transition portals and zero `SeenOutside` cells.

An archive-wide portal census covered 5,346 landblocks and 729,888 EnvCells with zero content
failures. Every one of the 15,028 outdoor-transition cells carried `SeenOutside`. This supports
keeping `SeenOutside` in visibility/render semantics while omitting a speculative loading state
machine.

That portal census was not used to claim that every classifier-positive dungeon has zero authored
exterior portals. This plan needs no such claim: ACE's `IsDungeon` adjacency and activation policy
is owner-isolated, while an authored portal, teleport, explicit Explorer relocation, or future
server residency update is an explicit demand transition rather than coordinate-derived
follow-camera adjacency.

EnvCell internal portal and visibility selectors are 16-bit local cell ids. The content assembler
reattaches the owner's high 16 bits, so a contiguous EnvCell graph cannot span landblock owners.
Teleporting portals may change owners, but they do not make one cross-landblock dungeon graph.

## North Stars

- **Classify once at the data owner.** Consumers receive `DungeonOnly` or `OutdoorOrMixed`; they do
  not reconstruct the decision from raw heights, cell counts, or buildings.
- **Routing precedes rendering.** A profile lookup decides which layers to request. Renderer source
  batches and materializers remain exact, dungeon-agnostic consumers.
- **Dungeon-only means one EnvCell owner.** Radius controls have no semantic effect on the dungeon
  layer set.
- **Retention is bounded and boring.** Preserve at most one outdoor window and one dungeon owner;
  never accumulate visited scenes.
- **Do not reenact obsolete scarcity.** `SeenOutside` remains a world/render fact, not an excuse for
  per-cell content churn.
- **The shared path serves the real client.** Explorer supplies navigation and focus policy; future
  client mode supplies authoritative residency. Neither owns classification or layer planning.
- **No fallback lies.** Missing or malformed profile data is unavailable/error state, never an
  implicit outdoor classification.
- **Authored residency beats coordinate bins.** A free camera leaving dungeon cell containment is
  noclip, not evidence that scene interest reached the outdoor landblock beneath its coordinates.
- **Keep the hot pipeline unchanged where possible.** The materialization pipeline receives exact
  layer demand and should not gain classification, input parsing, or retention policy.
- **Cold dungeon loading is the defining proof.** Starting at `0005` or `00050100` must issue no
  terrain, building, explicit-object, or generated-object source request.

## Target Architecture

### Canonical Content Classification

Add a canonical, fully commented classification to the shallow landblock contract:

```rust
pub enum LandblockTraversalClass {
    DungeonOnly,
    OutdoorOrMixed,
}

pub struct LandblockAsset {
    // Existing canonical fields.
    pub traversal_class: LandblockTraversalClass,
}
```

`LandblockAssetAssembler` computes the value from the decoded records it already owns. The
classification should be implemented in one small pure helper so every clause has a focused input:

1. Apply the northwest exception to the normalized owner coordinates.
2. Require every authored height index to be zero.
3. Require a present `LandblockInfo` with `num_cells > 0`.
4. Require zero buildings.
5. Classify every other available landblock as `OutdoorOrMixed`.

The enum is a canonical static-data fact and belongs in `holtburger-content`, beside
`LandblockAsset`. It is not a frontend preference and should not live in Tauri, TypeScript, the
renderer, or `holtburger-world`.

This behavior is based on ACE's data classifier, not on a proven retail UI behavior for bare
landblock navigation. Do not add a `RETAIL QUIRK` or `RETAIL DIVERGENCE` marker unless later retail
evidence establishes an observable compatibility claim.

### Lightweight Profile Capability

Project only the facts needed to route an app request:

```ts
type LandblockTraversalClass = "dungeon-only" | "outdoor-or-mixed";

interface LandblockProfile {
  readonly landblockId: LandblockId;
  readonly traversalClass: LandblockTraversalClass;
}

interface LandblockProfileSource {
  loadLandblockProfile(
    landblockId: LandblockId,
  ): Promise<LandblockProfile | null>;
}
```

`null` means the normalized `CellLandblock` is absent. Decode, invariant, and transport failures
remain thrown errors. Callers must not translate absence or error into `OutdoorOrMixed`.

Add one Rust builder used by both host transports. It should request
`ContentAssetRequest::Landblock(owner)` from the existing `ContentAssetRuntime` and project the
cached `LandblockAsset`; it should not add `ContentAssetRequest::LandblockProfile`, another content
cache, or another assembler.

Use a compact JSON response rather than inventing a binary envelope for two scalar fields. Validate
the untrusted response with Zod in TypeScript, including exact requested/returned owner identity.

Provide:

- `load_landblock_profile` Tauri command;
- `POST /landblock-profile` development-host route;
- `TauriLandblockProfileSource`;
- profile loading in `HttpLandblockContentSource` or a focused HTTP profile adapter if that keeps
  the interface smaller;
- one shared promise cache keyed by normalized owner, with concurrent request deduplication and
  failed-entry removal so a transient failure can be retried.

The first profile lookup may add one host round trip, but the later renderer source batch reuses the
same host-side shallow foundation cache. Do not piggyback classification into HBLB records unless
measurement later proves the round trip material.

### Shared Scene Target Resolution

Introduce app-runtime contracts under `apps/holtburger-3d/src/lib/game/runtime`, not under
`explorer`:

```ts
type SceneInterestTarget =
  | { readonly kind: "automatic-landblock"; readonly landblockId: LandblockId }
  | { readonly kind: "outdoor"; readonly landblockId: LandblockId }
  | {
      readonly kind: "env-cell";
      readonly landblockId: LandblockId;
      readonly envCellId: EnvCellId;
    };

type ClassifiableSceneInterestTarget = Exclude<
  SceneInterestTarget,
  { readonly kind: "outdoor" }
>;

type ResolvedSceneInterestTarget =
  | { readonly kind: "outdoor"; readonly requested: SceneInterestTarget }
  | {
      readonly kind: "dungeon";
      readonly requested: ClassifiableSceneInterestTarget;
    };
```

Resolution rules:

- explicit `outdoor` skips the profile lookup;
- `automatic-landblock` loads the profile and maps `DungeonOnly` to `dungeon`, otherwise
  `outdoor`;
- `env-cell` loads the owner profile and maps `DungeonOnly` to `dungeon`; an EnvCell in
  `OutdoorOrMixed` resolves to `outdoor` for residency purposes;
- every result preserves the original target, including an exact requested EnvCell, but does not
  prescribe camera placement;
- only Explorer translates an automatic dungeon target into deterministic camera focus at
  `0x0100`. The classifier guarantees at least one EnvCell, and the DAT range is contiguous from
  `0x0100`, but neither fact makes that cell an authored entrance.

The resolution result must carry both the classification decision and original request intent.
Consumers do not call the profile source again or inspect profile fields independently. Runtime
interest planning reads the resolved kind; Explorer camera policy reads the preserved request.

### Bounded Scene Interest Composition

Replace the outdoor-only single-map assumption with two explicitly owned components:

```text
retained outdoor interest: zero or one radius-derived map
active dungeon interest:   zero or one owner with EnvCells only
effective interest:         union(outdoor, dungeon)
```

Component changes describe logical sources of demand, not guaranteed fetches or evictions. The
runtime diffs only the effective union: adding dungeon demand for an EnvCells layer already present
in retained outdoor interest performs no materialization work, and removing dungeon demand leaves
that layer resident while outdoor interest still requires it.

Behavior:

- An outdoor request computes and replaces the retained outdoor map, clears active dungeon
  interest, and applies the resulting outdoor map.
- A dungeon request preserves the retained outdoor map if one exists, replaces active dungeon
  interest with `{ owner -> EnvCells }`, and applies their union.
- A cold dungeon request has no retained outdoor map and therefore requests exactly one EnvCells
  layer.
- A second dungeon request replaces the active dungeon component but retains the same outdoor map;
  the previous owner's EnvCells are evicted only if they are absent from that retained map.
- `clearSceneInterest()` clears both components and therefore evicts every effective layer.
- Dungeon requests do not alter the stored outdoor radii. Returning outdoors reuses or replaces
  them through the existing caller-provided policy.
- Terrain fog coverage follows the retained outdoor map. It is `null` for a cold dungeon and remains
  tied to the preserved outdoor radius while that outdoor map is retained.

Keep the union/diff mechanics in the shared game runtime. `SceneInterestCommitCoordinator` should
continue receiving one exact effective `SceneInterestMap`; it does not need to learn about
dungeons, profiles, targets, or retention.

Prefer a small pure planner plus explicit runtime state over adding optional radii, sentinel radius
values, or an `isDungeon` boolean to the current outdoor request. A radius of zero still means one
outdoor terrain block and is not dungeon-only behavior.

### Consumer Boundaries

#### Explorer

- `world-input.ts` preserves the syntactic distinction currently erased:
  - four hex digits -> `automatic-landblock`;
  - full `FFFF` DID -> explicit `outdoor`;
  - full non-`FFFF` DID -> `env-cell`;
  - map coordinates -> explicit `outdoor`.
- `ExplorerCameraCoordinator` remains responsible for automatic camera placement, manual-control
  cancellation, and focus status.
- Shared target resolution and runtime interest composition must not be named `Explorer*`.
- An automatic dungeon owner focuses deterministic cell `0x0100`; an exact EnvCell focuses that
  exact cell.
- While the resolved target is dungeon-only, follow-camera interest remains anchored to that owner.
  Same-owner EnvCell motion needs no replan; crossing nominal outdoor coordinates or losing all
  EnvCell containment does not synthesize an outdoor request.
- Leaving a dungeon-only context requires explicit Explorer navigation or an authoritative
  traversal event. The future client will translate authored portal/teleport results and server
  residency updates into explicit target demand rather than Explorer follow-camera adjacency.
- Outdoor radius controls remain unchanged and preserve their values while the current target is a
  dungeon.
- Status and diagnostics distinguish automatic owner resolution, dungeon EnvCell loading, and
  outdoor neighborhood loading.

#### Future Client Mode

- The future client route can submit server-authoritative outdoor or EnvCell residency through the
  same `SceneInterestRequestCoordinator` and resolved runtime request.
- Authored portal/teleport traversal and server residency changes replace target demand explicitly;
  they do not depend on outdoor coordinate adjacency or free-camera containment fallback.
- It does not need Explorer input parsing or camera framing.
- No speculative `ClientApp` implementation is required to prove reuse. Shared module placement,
  dependency injection, and tests against a non-Explorer caller boundary are sufficient for this
  change.

#### Browser Harness

- Keep existing outdoor `--landblock` scenarios stable so performance baselines do not silently
  change meaning.
- Add a focused dungeon-target option or explicit harness API rather than reinterpreting every
  existing outdoor test argument.
- Compose the same HTTP profile source and shared scene-interest request coordinator used by the app.

## Phased Implementation

## Phase 1: Canonical Landblock Classification

### Deliverables

- Add `LandblockTraversalClass` beside `LandblockAsset` in
  `crates/holtburger-content/src/landblock.rs`.
- Add the commented `traversal_class` field to `LandblockAsset`.
- Add one pure classification helper implementing the ACE predicate and northwest exception.
- Update every synthetic `LandblockAsset` constructor and fixture through honest field values.
- Re-export the canonical enum from `holtburger-content` as needed.

### Task Checklist

- [x] Express the northwest exception against normalized owner bytes without coordinate ambiguity.
- [x] Make all-zero height, positive EnvCell count, and zero buildings jointly necessary.
- [x] Classify mixed, building-interior, flat-empty, and ordinary outdoor fixtures as
      `OutdoorOrMixed`.
- [x] Classify representative `0005` facts as `DungeonOnly` in an asset-independent unit test.
- [x] Cover each classifier failure clause with an input that reaches that clause.
- [x] Avoid a permanent test that depends on repo-local runtime assets.
- [x] Run content formatting and tests before proceeding; clippy remains part of the final gates.

### Acceptance Criteria

- [x] Exactly one canonical helper computes the classification.
- [x] `LandblockAsset` always contains the result; no consumer can observe an unclassified available
      landblock.
- [x] Focused tests prove the full ACE predicate and exception.
- [x] No TypeScript, Tauri, or renderer code derives classification from raw content facts.

### Decisions And Course Corrections

- The existing shallow `LandblockAsset` representation already carries the normalized owner,
  height indices, EnvCell count, and building projection required by ACE's predicate. The
  classifier therefore adds one derived enum field and no workaround/static-data fields.
- The classifier is tested against synthetic shallow facts, keeping runtime archive data as
  investigation evidence rather than a permanent test dependency. Focused and full
  `holtburger-content` tests pass (70 unit tests plus doc-tests).

## Phase 2: Landblock Profile Host Capability

### Deliverables

- Add a minimal serializable app-host profile projection in `apps/holtburger-3d/src-tauri`.
- Add a shared `load_landblock_profile(...)` response builder over
  `ContentAssetRequest::Landblock`.
- Register `load_landblock_profile` as a Tauri command.
- Add matching `POST /landblock-profile` handling to
  `dev_landblock_content_host.rs`.
- Add host tests for available dungeon, available outdoor/mixed, normalized requested ids, absent
  landblocks, and propagated content failure.

### Task Checklist

- [x] Return only normalized owner identity and traversal class.
- [x] Represent missing `CellLandblock` explicitly without defaulting its class.
- [x] Reuse `ContentAssetRuntime`; do not instantiate another repository, decoder, or foundation
      cache.
- [x] Prove profile loading is backed by the same runtime foundation path used by source batches;
      host projection tests cover the shared builder and existing runtime cache tests cover
      repeated shallow loads.
- [x] Keep Tauri and HTTP behavior on the same Rust response-building function.
- [x] Register the new Tauri command and add shared-builder tests for available, absent, normalized,
      and failing content.

### Acceptance Criteria

- [x] A profile request performs no EnvCell, generated-scenery, geometry, texture, or renderer
      preparation.
- [x] A later layer batch for the same owner uses the existing cached shallow `Arc<LandblockAsset>`
      path rather than a profile-specific asset/cache.
- [x] Tauri and development-host responses call the same response builder and are semantically
      identical.
- [x] Missing and failing content remain distinguishable.

### Decisions And Course Corrections

- The host projection is a compact JSON object, not a binary record. It is only two scalar facts and
  does not belong in the renderer source-batch envelope.
- The profile builder consumes `ContentAssetRequest::Landblock` and projects the cached asset. No
  profile-specific repository, decoder, cache, or classifier was introduced.
- Synthetic HBA fixtures cover available dungeon/outdoor owners, normalized requests, absence, and
  promised-content failure without depending on repo-local runtime assets.

## Phase 3: Typed Frontend Profile Source And Cache

### Deliverables

- Add `LandblockProfile`, `LandblockTraversalClass`, and `LandblockProfileSource` under
  `apps/holtburger-3d/src/lib/assets`.
- Add strict Zod decoding and requested/returned owner validation.
- Add `TauriLandblockProfileSource`.
- Add HTTP profile loading for the browser harness.
- Add one shared caching/deduplication wrapper or owner that stores in-flight/completed profiles and
  removes failed promises.

### Task Checklist

- [x] Normalize owner identities at the boundary and reject malformed ids.
- [x] Reject unknown traversal-class strings.
- [x] Deduplicate concurrent loads for one owner.
- [x] Return cached stable results without another host request.
- [x] Permit retry after transport or decode failure.
- [x] Preserve `null` as absence rather than translating it into an available profile.
- [x] Compose the capability in both Explorer/Tauri and browser-harness startup paths.

### Acceptance Criteria

- Profile decoding is type-safe and exact.
- Two concurrent requests for one owner issue one transport request.
- A failed request can be retried.
- No renderer materialization source interface gains profile fields or classification methods.

### Decisions And Course Corrections

- Prefer a focused profile source over expanding `LandblockSourceBatchSource`; merge HTTP adapter
  classes only if composition shows they share real lifecycle state rather than a hostname alone.
- The shared cache owns only profile state; it wraps the existing Tauri or HTTP source and is
  constructed once per frontend runtime. No renderer source-batch interface gained classification
  fields. Focused profile/cache tests pass.

## Phase 4: Shared Target Resolution And Explorer Input Cutover

### Deliverables

- Add shared `SceneInterestTarget`, `ResolvedSceneInterestTarget`, and target-resolution logic under
  `apps/holtburger-3d/src/lib/game/runtime`.
- Update `world-input.ts` to preserve automatic-prefix, explicit-outdoor, and exact-EnvCell intent.
- Route Explorer requests through the injected profile source and shared resolver before camera
  focus or materialization.
- Make supersession explicit so a slow older profile lookup cannot replace a newer navigation
  target.
- Retain the resolved target kind and original request in the one request coordinator so later
  Explorer follow-camera policy can distinguish an outdoor context from a dungeon context.
- Update Explorer statuses and diagnostics to report resolved target kind.

### Task Checklist

- [x] Make explicit outdoor targets skip profile lookup.
- [x] Resolve four-digit `0005` to dungeon through its profile.
- [x] Keep eight-digit `0005FFFF` explicitly outdoor.
- [x] Resolve `00050100` to dungeon and preserve its exact requested target.
- [x] Resolve an EnvCell owned by `OutdoorOrMixed` without claiming the owner is dungeon-only.
- [x] Resolve absent profile as actionable unavailable status.
- [x] Reject stale profile completions after a newer request.
- [x] Preserve automatic-focus cancellation under manual camera control.
- [x] Keep the choice of `0x0100` inside Explorer camera policy while using the shared resolved
      target and its preserved request intent.

### Acceptance Criteria

- Input syntax has stable, tested semantics:
  - `0005` is automatic;
  - `0005FFFF` is explicit outdoor;
  - `00050100` is exact EnvCell.
- Profile resolution is shared-runtime code rather than an Explorer-only classifier.
- A stale asynchronous resolution cannot move interest or camera focus.
- The future client route can construct the same target contracts without importing Explorer code.

### Decisions And Course Corrections

- If camera focus and interest resolution cannot share one revision without making the runtime
  contract stateful in two places, introduce one small target-request coordinator and remove the
  superseded Explorer anchor ownership. Do not retain two competing current-target fields.
- `SceneInterestRequestCoordinator` owns monotonic profile-request currentness; the accepted
  resolved target remains in the camera/runtime owners. This keeps stale completion handling shared
  without duplicating the active target map.

## Phase 5: Dungeon Interest Composition And Clean Cutover

### Deliverables

- Split current scene-interest derivation into explicit outdoor and dungeon planners.
- Add exact map union support with one retained outdoor component and one active dungeon component.
- Update `GameRuntime.updateSceneInterest(...)` or replace it with a discriminated resolved-target
  API that owns this bounded composition.
- Preserve `SceneInterestCommitCoordinator` as the exact effective-map reconciler.
- Update terrain-fog coverage ownership for cold and retained-outdoor dungeon cases.
- Remove the outdoor-only request shape and misleading comments after all consumers migrate.

### Task Checklist

- [x] Outdoor planning remains behaviorally identical for existing requests.
- [x] Dungeon planning produces exactly `{ owner -> EnvCells }`.
- [x] A cold dungeon request contains no terrain or outdoor-static layer.
- [x] An outdoor-to-dungeon request retains the prior outdoor map unchanged and adds only dungeon
      EnvCells demand; if that layer is already in the outdoor map, the effective diff is empty.
- [x] A dungeon-to-dungeon request replaces the active dungeon owner without accumulating both
      demand components; the effective diff retains any old or new EnvCells layer still required by
      the outdoor map.
- [x] A dungeon-to-outdoor request clears the dungeon component and replaces the outdoor window;
      its effective diff evicts dungeon EnvCells only when the new outdoor map does not require
      them.
- [x] `clearSceneInterest()` clears both demand components, producing an effective diff that evicts
      every previously demanded layer.
- [x] Dungeon requests preserve stored outdoor radii for later outdoor use.
- [x] Cold dungeon terrain-fog coverage is absent; retained outdoor coverage keeps its existing
      radius.
- [x] Layer availability/failure events remain tied to exact dispatch revisions.
- [x] Sweep `outdoor anchor`, `around`, radius-only, and other false vocabulary from surviving
      symbols, comments, diagnostics, tests, and UI labels.

### Acceptance Criteria

- Runtime unit tests prove the complete transition table without renderer or host dependencies.
- Transition tests assert component state separately from the effective layer diff; they never use
  logical demand replacement as a synonym for physical eviction.
- The commit pipeline receives only exact layer demand and remains dungeon-agnostic.
- Effective scene interest is bounded by one outdoor window plus one dungeon EnvCell owner.
- Existing outdoor tests remain unchanged except for deliberate request-type migration.
- No sentinel radius, nullable mandatory radius, or `isDungeon` boolean is introduced.

### Decisions And Course Corrections

- Record the exact owner of target resolution and retained-interest state after the cutover. If both
  `GameRuntime` and another controller retain equivalent maps or revisions, collapse them before
  continuing.
- `GameRuntime` owns the bounded retained-outdoor and active-dungeon components; the camera
  coordinator owns one Explorer scene-interest snapshot for focus/follow policy. The shared target
  coordinator owns only asynchronous profile currentness. The commit coordinator still sees only
  the effective layer map.
- The outdoor planner is named `computeOutdoorSceneInterest`, and the Explorer request status now
  reports the parsed target rather than saying every request is "around" a landblock. Remaining
  `anchorLandblockId` names belong to renderer frame, collision, or simulation coordinate anchors,
  not the retired outdoor-only scene-interest contract.

## Phase 6: Explorer Focus, Follow, And Diagnostics

### Deliverables

- Focus a bare dungeon owner through deterministic EnvCell `0x0100` after its EnvCell topology is
  available.
- Focus an exact dungeon cell through the requested DID.
- Preserve existing outdoor focus behavior for explicit and outdoor/mixed targets.
- Preserve residency-resolution provenance through follow mode instead of reducing it to a bare
  `SceneResidency` before the coordinator applies context policy.
- Keep outdoor follow mode's existing coordinate-derived owner crossings, while making a resolved
  dungeon target owner-sticky until explicit navigation replaces it.
- Update Explorer world-panel and frame-diagnostic presentations.

### Task Checklist

- [x] Do not attempt terrain focus for a resolved dungeon target.
- [x] Surface missing default or exact EnvCell topology as a loud focus failure.
- [x] Keep outdoor radii visible and unchanged while they are ignored by dungeon demand.
- [x] Pass the complete Explorer residency resolution, including `cell-containment` versus
      `outdoor` provenance, into follow-camera policy.
- [x] Keep a containing EnvCell's authored owner when its geometry crosses the nominal 192-meter
      outdoor landblock boundary.
- [x] Do not replan or reclassify same-owner EnvCell movement.
- [x] While the resolved target is dungeon-only, reject coordinate-derived outdoor fallback as a
      camera-driven interest transition and keep the active dungeon owner unchanged.
- [x] Treat loss of all active-dungeon EnvCell containment as an Explorer outside-topology status,
      not as an outdoor target or profile lookup.
- [x] Keep simulation interest on the dungeon owner when such a follow-camera transition is
      rejected.
- [x] Preserve existing owner-crossing and profile-cache behavior while the resolved context is
      outdoor or mixed.
- [x] Ensure follow-mode stale resolution cannot undo an explicit newer relocation.
- [x] Update diagnostic snapshots to distinguish requested target, resolved target, retained outdoor
      component, and active dungeon owner only where each field has a named consumer.
- [x] Avoid adding `SeenOutside` or per-cell residency states to scene-interest diagnostics.

### Acceptance Criteria

- `0005` and `00050100` both reach interior focus without terrain availability.
- Outdoor focus remains terrain-driven.
- A dungeon EnvCell extending into another nominal outdoor landblock remains owned by its authored
  dungeon landblock and does not move interest.
- Noclipping out of all dungeon EnvCells leaves dungeon scene and simulation interest unchanged,
  performs no profile lookup, and reports the camera outside active dungeon topology.
- Outdoor follow mode retains its existing coordinate-grid re-anchoring behavior.
- Diagnostics explain why outdoor layers remain resident during a dungeon visit without implying
  that they are centered on the dungeon.

### Decisions And Course Corrections

- If `0x0100` produces unusable camera framing in representative dungeon-only fixtures, stop and
  collect content evidence before replacing it. Do not guess an entrance-selection heuristic into
  the shared content contract.
- If implementation cannot preserve residency provenance without duplicating target ownership,
  change the one coordinator input contract; do not infer dungeon exit from raw world coordinates.
- Follow-camera policy stayed Explorer-local. `ExplorerCameraCoordinator` consumes the complete
  residency resolution, keeps a dungeon owner sticky, and reports outside-topology when containment
  is lost. It does not call the profile source or mutate shared scene interest in that case; the
  Explorer only mirrors accepted outdoor crossings into simulation interest.
- The deterministic `0x0100` focus policy remains frontend-only. Production-content exact-cell
  capture rendered a real EnvCell scene with zero terrain frame inputs, so no evidence justified an
  entrance heuristic or a shared content field.

## Phase 7: Browser Runtime Verification

### Deliverables

- Add a focused dungeon target control to `BrowserHarnessApp.svelte` and
  `browser-harness.mjs` without changing existing outdoor benchmark argument semantics.
- Expose exact profile requests, resolved targets, source-batch layer requests, and resident-layer
  counts needed for assertions.
- Run production-content harness scenarios on a deterministic branch-derived port.

### Task Checklist

- [x] Cold `0005` automatic target:
  - one successful profile resolution to `dungeon-only`;
  - an EnvCells source batch for `0x0005ffff`;
  - no terrain/buildings/objects/generated request for `0x0005ffff` or its neighbors;
  - renderable camera focus in the selected EnvCell.
- [x] Cold `00050100` exact target:
  - same layer behavior;
  - exact focus cell preserved.
- [x] Dungeon follow-camera policy:
  - focused Explorer coordinator tests cover the policy; the browser harness intentionally composes
    the shared runtime rather than Explorer camera UX;
  - crossing the owner's nominal outdoor boundary while still contained by an EnvCell does not
    move scene or simulation interest;
  - leaving all dungeon EnvCell containment does not issue a profile or outdoor layer request;
  - active dungeon EnvCells remain resident;
  - Explorer reports outside active dungeon topology.
- [x] Explicit `0005FFFF` followed by exact dungeon target `00050100`, with EnvCells enabled for
      the outdoor request:
  - the outdoor request skips profile lookup and loads the configured outdoor window, including the
    owner-wide `0005` EnvCells layer;
  - the exact target resolves through the profile and changes the active context to dungeon;
  - retained outdoor demand remains unchanged;
  - no EnvCells source request, layer publication, or eviction occurs during the context change
    because the effective union already contains `0005` EnvCells.
- [x] Outdoor `DA55FFFF` followed by dungeon `00050100`:
  - retained DA55 outdoor interest remains installed;
  - no outdoor interest is synthesized around `0005`;
  - only the `0005` EnvCells layer is added to effective demand when it was outside the retained
    outdoor EnvCell radius.
- [x] Cold dungeon followed by another dungeon:
  - active dungeon demand moves to the new owner;
  - previous dungeon EnvCells are evicted because no retained outdoor demand references them;
  - retained outdoor window remains bounded and unchanged.
- [x] Dungeon followed by a new outdoor target:
  - active dungeon demand is cleared;
  - old outdoor window is replaced by the new outdoor plan;
  - dungeon EnvCells remain exactly when the new outdoor map requires them and are otherwise
    evicted.
- [x] Capture browser errors and a screenshot for the cold exact-cell dungeon scenario.
- [x] Do not run the interactive TUI client.

### Acceptance Criteria

- Machine-readable harness evidence proves demand-component state, effective layer diffs, retained
  layers, and target resolution.
- No browser, worker, decoder, WebGL, or unhandled-promise error occurs.
- A screenshot proves the EnvCell scene renders without resident terrain.
- Existing outdoor harness behavior and performance flags retain their previous meaning.

### Decisions And Course Corrections

- If cold dungeon rendering implicitly depends on terrain installation, identify and remove the
  concrete dependency rather than loading dummy terrain as a fallback.
- The browser harness remains a shared-runtime/content probe, not a second Explorer policy owner.
  Follow-camera containment and outside-topology behavior are therefore verified in the focused
  coordinator tests, while production-content browser runs verify the layer requests, effective
  union, focus, rendering, and transition eviction/publication behavior.
- Production-content runs used deterministic ports and reported no page console errors. The only
  emitted browser diagnostics were Chrome's external GCM/zygote warnings; they did not affect the
  harness result.

## Phase 8: Cleanup And Verification

### Deliverables

- Delete superseded outdoor-only request contracts, duplicate anchor state, compatibility helpers,
  and architecture-preserving tests.
- Update relevant architecture comments/docs if the final ownership differs from their current
  description.
- Run repository and app verification gates.

### Task Checklist

- [x] Search for surviving direct calls to the retired outdoor-only scene-interest API.
- [x] Search for classification vocabulary outside `holtburger-content` and typed profile
      projections; remove duplicate derivations.
- [x] Search for `SeenOutside` in scene-interest planning and remove any accidental residency use.
- [x] Confirm every new field has a named runtime, diagnostic, or UI consumer.
- [x] Confirm every new validation error has a reachable distinct failure input.
- [x] Run `cargo fmt --all -- --check`.
- [x] Run focused and then workspace Rust tests.
- [x] Run workspace clippy with warnings denied.
- [x] Run `npm run test:ts` in `apps/holtburger-3d`.
- [x] Run `npm run check` in `apps/holtburger-3d`.
- [x] Run `npm run lint` in `apps/holtburger-3d`.
- [x] Run `npm run format:check` in `apps/holtburger-3d`.
- [x] Run `git diff --check`.
- [x] Re-run the focused production-content browser scenarios after cleanup.

### Acceptance Criteria

- All maintained compile, format, lint, unit-test, and browser-runtime gates pass.
- Clippy emits no warnings.
- No temporary census code, runtime-asset test, debug output, compatibility shim, or stale
  dungeon-loading vocabulary remains.
- The final diff contains no changes to ACE, ACViewer, or the retail client decompile.

### Decisions And Course Corrections

- Record any unrelated pre-existing gate failure with exact reproduction and evidence before
  excluding it. Do not silently label failures pre-existing.
- The first sandboxed `cargo test --workspace --all-targets` attempt was blocked by the V8 test's
  listener permission, not by an assertion. The same full command passed with the required listener
  permission; no test was excluded.
- Final post-cleanup browser evidence is `/tmp/holtburger-dungeon-exact-final.png` and the matching
  exact-cell report: one `EnvCells` source batch for `0x0005ffff`, no terrain frame inputs, the
  preserved exact requested cell, and no page console errors. Earlier production runs cover the
  retained-outdoor overlap, outdoor-to-dungeon addition, dungeon-to-dungeon replacement, and
  dungeon-to-outdoor replacement cases.

### Final Verification Record

- `cargo fmt --all -- --check` passed.
- `cargo test -p holtburger-content` passed: 70 unit tests and doc-tests.
- `cargo test --workspace --all-targets` passed with listener permission, including the V8 host test.
- `cargo clippy --workspace --all-targets -- -D warnings` passed.
- `npm run test:ts` passed: 190 files, 1,452 tests.
- `npm run check`, `npm run lint`, and `npm run format:check` passed in `apps/holtburger-3d`.
- `git diff --check` passed.
- Production-content browser evidence passed for cold automatic/exact dungeon loading, retained
  outdoor overlap, outdoor-to-dungeon addition, dungeon-to-dungeon replacement, and
  dungeon-to-outdoor replacement. No interactive TUI run and no reference-submodule edits were
  made.

## Risks And Mitigations

### Classification Drift

**Risk:** A simplified predicate misclassifies mixed landblocks or northwest water cells.

**Mitigation:** Keep the complete ACE predicate and exception in one content-owned helper; cover
every clause with synthetic tests; retain the archive census as implementation evidence rather than
a permanent runtime-asset test.

### Routing/Materialization Cycle

**Risk:** Classification is added to HBLB output even though classification is required to decide
which HBLB layers to request.

**Mitigation:** Keep the lightweight profile capability logically before materialization and reuse
the same host-side shallow foundation cache.

### Duplicate Current-Target Ownership

**Risk:** Explorer, a shared resolver, and `GameRuntime` each retain their own target/revision and
can disagree after asynchronous profile resolution.

**Mitigation:** During Phase 4, identify one target-request coordinator. Camera code consumes its
resolved result; runtime owns only effective layer components and commit revisions. Delete replaced
anchor state rather than synchronizing copies.

### Stale Profile Completion

**Risk:** A slow profile response for an older navigation request supersedes a newer target.

**Mitigation:** Assign a monotonic target request revision before profile loading and check exact
currentness before applying interest or focus. Cache content independently from request currentness.

### Retained Outdoor Memory

**Risk:** Outdoor content accumulates across dungeon visits.

**Mitigation:** Retain exactly one outdoor interest map, replace it on the next outdoor target, and
retain exactly one dungeon owner. Add transition-table tests and diagnostic counts that prove the
bound.

### Cold Dungeon Hidden Terrain Dependency

**Risk:** Camera focus, fog, map, lighting, renderer setup, or scene bounds accidentally assume at
least one terrain layer is resident.

**Mitigation:** Make cold `00050100` with zero terrain residents a required browser-harness test.
Fix the concrete dependency instead of adding implicit terrain fallback.

### Coordinate-Derived Dungeon Escape

**Risk:** Once a free camera leaves all resident EnvCells, the existing point resolver supplies the
outdoor landblock beneath its world coordinates. Follow mode could mistake that fallback for an
authored dungeon exit, evict the dungeon, and load an unrelated outdoor neighborhood.

**Mitigation:** Preserve point-resolution provenance into `ExplorerCameraCoordinator` and gate it
against the one active resolved target. A dungeon context accepts no camera-driven owner change;
coordinate fallback produces outside-topology status while scene and simulation interest remain on
the dungeon. Explicit Explorer navigation and future authoritative server updates remain the only
exit mechanisms.

### Profile Round-Trip Latency

**Risk:** The extra host request becomes visible during future client teleport transitions.

**Mitigation:** Cache by owner and deduplicate concurrent requests. Measure before optimizing. If
later evidence warrants it, piggyback the already canonical profile in a source response without
moving classification into the renderer pipeline.

### Ambiguous Bare-Dungeon Focus

**Risk:** Cell `0x0100` exists but is a poor initial viewpoint.

**Mitigation:** Label it as deterministic Explorer policy and verify representative framing. If it
fails, investigate authored topology or known portal destinations before adding another heuristic.

### Vocabulary Overreach

**Risk:** `DungeonOnly` leaks into renderer systems or is used as a synonym for every interior.

**Mitigation:** Keep the canonical enum in content, the serialized projection in assets, and the
resolved target in shared runtime. Renderer layers remain terrain/buildings/objects/generated/
EnvCells; mixed and building interiors stay `OutdoorOrMixed`.

## Definition Of Done

- [x] `LandblockAsset` carries one content-owned `LandblockTraversalClass` computed by the complete
      ACE predicate and northwest exception.
- [x] No downstream consumer re-derives classification.
- [x] Tauri and HTTP expose one lightweight, validated profile capability backed by the existing
      shallow foundation cache.
- [x] Profile requests are cached, concurrently deduplicated, and retryable after failure.
- [x] Four-digit, explicit outdoor, and exact EnvCell inputs retain distinct intent.
- [x] Shared target resolution is usable without importing Explorer code.
- [x] A cold dungeon target requests only the owning EnvCells layer.
- [x] Dungeon interest ignores outdoor radii without mutating the saved outdoor settings.
- [x] A previous outdoor window may remain resident during a dungeon visit, but no outdoor window
      is centered on the dungeon.
- [x] Effective interest is bounded to one outdoor window and one dungeon owner.
- [x] Logical demand replacement and physical layer eviction remain distinct: a layer is fetched or
      evicted only when membership in the effective outdoor/dungeon union changes.
- [x] `0005FFFF` followed by `00050100` with outdoor EnvCells enabled performs no EnvCells fetch,
      publication, or eviction during the context change.
- [x] Simulation-interest radius and retention policy are unchanged; simulation re-anchors only
      when follow-camera policy accepts the matching scene-owner transition.
- [x] `SeenOutside` has no role in static scene-interest planning.
- [x] Explorer focuses `0005` through deterministic cell `00050100` and exact EnvCell requests
      through their requested cell.
- [x] Follow-camera movement within an authored dungeon EnvCell never changes owner because of a
      nominal outdoor landblock boundary crossing.
- [x] Noclipping outside all active-dungeon EnvCells leaves scene and simulation interest anchored
      to the dungeon, issues no profile or outdoor layer request, and surfaces outside-topology
      status.
- [x] Explicit Explorer navigation and future authoritative residency remain the only mechanisms
      that leave a dungeon-only context.
- [x] Browser-harness evidence proves cold dungeon, retained outdoor, replacement, and cleanup
      behavior with production content.
- [x] Existing outdoor behavior remains covered and unchanged.
- [x] All format, compile, test, lint, clippy, and runtime verification gates pass.
- [x] No temporary diagnostics remain in the repository, and this diff contains no reference-
      submodule modifications.

## Open Questions

No blocking product or architecture questions remain for implementation.

During execution, stop and request direction only if evidence shows one of the following:

- the ACE classifier cannot be expressed from the canonical shallow foundation without adding a
  new static-data fact;
- cold dungeon rendering has a fundamental, intentional terrain dependency rather than an
  accidental assumption;
- deterministic `0x0100` focus is unusable and no evidence-backed replacement policy is available;
  or
- retaining one outdoor window exceeds a measured resource limit on supported hardware.

---

## Addendum A: Suppress Dungeon EnvCells From Ambient Outdoor Interest

Status: implementation and verification complete

### Context And Goal

The completed dungeon-only implementation correctly interprets an explicit four-digit target such
as `5f50` as an automatic landblock request. Production content classifies `5f50FFFF` as
`DungeonOnly`, so that request loads its 575 EnvCells without terrain.

The same owner can also enter scene interest for a different reason: an outdoor camera can move
organically into `5f50` while “scene interest follows camera” is enabled. The sea terrain remains
valid outdoor presentation even though it is not a traversable outdoor surface under ACE's dungeon
classifier. Camera follow therefore must retain ordinary outdoor demand for `5f50` while omitting
the sealed dungeon's EnvCells.

The addendum's goal is to make ambient outdoor EnvCell demand classification-aware without changing
explicit dungeon navigation, outdoor terrain coverage, or renderer materialization.

### Scope

#### In Scope

- Reuse the existing `LandblockProfile.traversalClass`; add no content or wire facts.
- Resolve profiles for owners inside an outdoor request's enabled `envCellRadius`.
- Include an owner in ambient outdoor EnvCell demand only when its profile is
  `OutdoorOrMixed`.
- Continue requesting terrain, buildings, explicit objects, and generated scenery entirely from
  their existing outdoor radii, regardless of traversal classification.
- Preserve direct target semantics:
  - automatic `5f50` resolves to dungeon and requests exactly `5f50` EnvCells;
  - explicit `5f50FFFF` remains outdoor intent and omits `5f50` EnvCells;
  - outdoor camera follow into `5f50` retains outdoor layers and omits `5f50` EnvCells;
  - explicitly requesting `5f50` after arriving outdoors retains that outdoor window and adds
    `5f50` EnvCells as active dungeon demand.
- Extend the existing revisioned request coordinator into one shared resolved-request coordinator so
  Explorer, the browser harness, and future client mode use identical policy.
- Preserve latest-request-wins behavior when follow-camera requests cross owners faster than profile
  resolution completes.
- Replace the original plan's `0005FFFF -> 00050100` outdoor-overlap no-op expectation: a
  dungeon-only owner is no longer preloaded by ambient outdoor EnvCell radius, so explicit dungeon
  demand adds its EnvCells.

#### Out Of Scope

- Reading or interpreting building-portal stab lists for scene-interest policy.
- Detecting closed portal-graph components or filtering unattached EnvCells in
  `OutdoorOrMixed` owners.
- Adding another traversal classification or landblock-profile field.
- Cell-selective EnvCell fetch, publication, retention, or eviction.
- Changing outdoor terrain/static radii, simulation interest, dungeon camera stickiness, or retained
  outdoor ownership.
- Adding a profile-batch endpoint, HBA lookup table, renderer branch, or source-batch request mode
  before measurements demonstrate a need.
- Reproducing retail's per-view PVS or landscape release behavior.

### Ground Truth

- `crates/holtburger-content/src/landblock.rs`
  - `LandblockTraversalClass::DungeonOnly` is already computed from ACE's complete shallow
    predicate. It means there is no traversable outdoor surface, not that the outdoor terrain record
    is absent or should never render.
- `apps/holtburger-3d/src/lib/game/runtime/scene-target.ts`
  - Automatic landblock requests already consult the profile.
  - Explicit outdoor targets bypass dungeon target classification.
  - `SceneInterestRequestCoordinator` already owns monotonic currentness for asynchronous profile
    resolution.
- `apps/holtburger-3d/src/explorer/explorer-camera-coordinator.ts`
  - Accepted outdoor follow transitions already create explicit outdoor targets.
- `apps/holtburger-3d/src/lib/game/runtime/scene-interest.ts`
  - The current outdoor planner adds terrain independently, then adds the owner-wide EnvCells layer
    solely from `envCellRadius`.
- Production `5f50` evidence gathered on 2026-08-24:
  - automatic `5f50` resolves to a dungeon target;
  - the cold request publishes one EnvCells layer containing 575 cells;
  - it supplies zero terrain frame inputs;
  - the browser reports no console errors.

No further archive census is required for this narrow change. The policy relies only on the already
proven `DungeonOnly` classification and does not claim anything about mixed-owner reachability.

### North Stars

- Request origin is part of scene-interest semantics.
- “Dungeon-only traversal” must never be misread as “outdoor terrain does not exist.”
- Direct user or server demand outranks ambient radius demand.
- Classification and asynchronous policy stay above the synchronous materialization pipeline.
- Extend the existing coordinator rather than introducing a second currentness owner.
- Measure profile fanout before optimizing it.

### Planned Architecture

```text
SceneInterestTarget + radii
        |
        v
shared SceneInterestRequestCoordinator
  - resolves automatic target classification
  - for outdoor targets, enumerates envCellRadius owners
  - loads cached profiles concurrently
  - retains only OutdoorOrMixed owners for ambient EnvCells
  - rejects stale completions
        |
        v
ResolvedSceneInterestRequest
  - resolved target
  - radii
  - ambient outdoor EnvCell owners
        |
        v
GameRuntime
  - computes retained outdoor layers synchronously
  - computes active dungeon demand synchronously
  - unions and diffs the two components
        |
        v
unchanged acquisition, commit, and renderer paths
```

`GameRuntime` remains asset-source agnostic. `computeOutdoorSceneInterest` receives the resolved
ambient EnvCell owner set and filters only additions of `LandblockLayerKind.EnvCells`. All outdoor
layers continue to be derived from radii exactly as they are today.

The existing `CachedLandblockProfileSource` deduplicates both completed and concurrent owner
requests. Candidate owners can therefore be resolved concurrently without a new host contract.
Absent candidate profiles simply cannot contribute EnvCells; decode, transport, and owner-mismatch
failures remain errors. Automatic or exact targets retain the existing typed unavailable-target
failure.

### Phase 9: Resolve Complete Scene-Interest Requests

#### Deliverables

- Use `SceneInterestRequestCoordinator` as the shared coordinator that accepts
  `SceneInterestTarget + SceneInterestRadii` and returns one composite resolved request.
- Add a pure helper that enumerates owners inside the enabled `envCellRadius`, clipped to world
  bounds.
- Load those candidate profiles concurrently through `CachedLandblockProfileSource`.
- Preserve one monotonic revision across target classification, candidate resolution, and caller
  application.
- Update Explorer and browser-harness composition to consume the composite request.

#### Acceptance Criteria

- Dungeon targets perform no outdoor candidate expansion.
- `envCellRadius: null` performs no ambient candidate profile requests.
- Outdoor candidates classified `OutdoorOrMixed` enter the resolved ambient EnvCell owner set.
- Outdoor candidates classified `DungeonOnly`, including `5f50`, do not.
- Missing candidate profiles are omitted as absent content; actual source and validation failures
  reject the request.
- Candidate requests run concurrently and reuse the existing cache.
- A newer navigation or follow request prevents every older completion from mutating runtime,
  camera-interest bookkeeping, or simulation interest.
- No second coordinator or revision counter survives the cutover.

#### Checklist

- [x] Define and document the composite resolved-request type.
- [x] Add pure candidate enumeration and profile-resolution tests.
- [x] Use the composite request coordinator and sweep retired vocabulary.
- [x] Update Explorer navigation and follow-camera application.
- [x] Update browser-harness navigation and scripted follow flight.
- [x] Keep Explorer focus and status presentation app-local.

#### Execution Notes

- The composite request is `SceneInterestRequest`; `ambientOutdoorEnvCellOwners` is the only
  classification-derived field and is computed before runtime materialization.
- Candidate owners are enumerated as a clipped square using the existing EnvCell radius and
  loaded concurrently through the cached profile source. Missing candidate profiles are omitted;
  source and validation failures still reject the request.
- Explorer and browser-harness follow transitions now resolve the complete request before applying
  runtime interest. The request coordinator revision remains the sole currentness gate.

### Phase 10: Filter Only Ambient EnvCell Demand

#### Deliverables

- Update `computeOutdoorSceneInterest` to accept the resolved ambient EnvCell owner set.
- Update `GameRuntime.updateSceneInterest` to consume a complete resolved request without loading
  profiles itself.
- Rewrite transition tests whose outdoor maps previously included dungeon-only EnvCells.

#### Acceptance Criteria

- Organic outdoor interest at `5f50` contains terrain according to radius and no `5f50`
  EnvCells.
- Buildings, explicit objects, generated scenery, fog coverage, and surrounding terrain remain
  unchanged.
- Automatic `5f50` still produces exactly one active dungeon EnvCells layer and no
  dungeon-centered outdoor map.
- Organic outdoor arrival at `5f50` followed by explicit automatic `5f50` retains the outdoor
  map and adds the dungeon EnvCells layer.
- Returning to outdoor intent clears active dungeon demand and evicts its EnvCells when no other
  direct demand owns them.
- Existing `OutdoorOrMixed` EnvCell-radius behavior remains unchanged.
- Commit, source acquisition, and renderer code do not import traversal classification or learn why
  the EnvCells layer was requested.

#### Checklist

- [x] Filter only `EnvCells` additions in the pure outdoor planner.
- [x] Update runtime request and transition fixtures.
- [x] Delete superseded outdoor/dungeon overlap expectations.
- [x] Verify diagnostics describe ambient, active-dungeon, and effective demand honestly.
- [x] Sweep any wording that implies dungeon classification suppresses outdoor terrain.

#### Execution Notes

- Runtime transition coverage now proves organic outdoor `5f50` interest retains terrain, buildings,
  objects, and generated scenery without EnvCells; explicit dungeon demand adds only the active
  `5f50` EnvCells layer while retaining that outdoor map.
- `GameRuntime` remains synchronous and profile-agnostic. The planner receives the resolved owner
  set and filters only EnvCell additions; all other outdoor layers retain their existing radius
  behavior.

### Phase 11: Production Verification And Cleanup

#### Deliverables

- Browser-harness coverage for explicit dungeon targeting and organic outdoor follow at `5f50`.
- Updated evidence and completed addendum checklist.
- Formatting, lint, test, clippy, and vocabulary cleanup across touched files.

#### Acceptance Criteria

- Cold automatic `5f50` still loads one 575-cell EnvCells layer with zero terrain frame inputs.
- An outdoor follow-camera transition into `5f50` loads its outdoor terrain/static interest and
  publishes no `5f50` EnvCells layer.
- Explicitly targeting `5f50` after that transition adds the dungeon while retaining the outdoor
  window.
- Repeated or rapidly superseded follow transitions cannot restore an older interest window.
- A representative `OutdoorOrMixed` owner still loads EnvCells under outdoor radius.
- Browser console output contains no errors.
- `cargo fmt --all -- --check`, focused and workspace Rust tests, clippy with warnings denied,
  frontend tests, Svelte check, lint, format check, and `git diff --check` pass.
- No temporary production-asset tests, diagnostics, or reference-submodule modifications remain.

#### Checklist

- [x] Exercise and inspect the three `5f50` scenarios.
- [x] Run an `OutdoorOrMixed` regression scenario.
- [x] Run all repository verification gates.
- [x] Record implementation decisions, course corrections, and final evidence here.

#### Execution Notes

- Production browser harness evidence on 2026-08-24:
  - automatic `5f50` resolved to `dungeon`, published one `env-cells` layer for all 575 cells,
    and reported `terrainFrameInputs: 0`;
  - explicit outdoor `5f50FFFF` resolved to `outdoor`, published terrain/buildings, and reported
    no EnvCells;
  - relocating from explicit outdoor `5f50FFFF` to automatic `5f50` retained the outdoor map and
    added the dungeon EnvCells layer;
  - following the camera from outdoor `5f4F` into `5f50` published only outdoor terrain/buildings
    at the destination, with no active dungeon demand;
  - `da55` retained its existing outdoor-radius EnvCells behavior (236 EnvCells).
- Browser page console output was empty in each successful production run. Chrome's own headless
  process emitted registration/termination warnings outside the page console and did not affect
  harness assertions.
- The first workspace Rust test pass was sandbox-blocked by the existing V8 listener test; the
  escalated rerun passed the complete workspace. No implementation failure was observed.

### Risks And Mitigations

#### Profile Fanout Delays Outdoor Follow

**Risk:** Outdoor interest waits for every EnvCell-radius profile before applying the next window.

**Mitigation:** Resolve candidates concurrently and reuse the existing cache. Measure the actual
follow transition before adding a batch endpoint or split-phase application. If latency is material,
resteer at the shared coordinator boundary; do not move classification into source acquisition or
rendering.

#### Traversal Classification Is Applied Too Broadly

**Risk:** A caller interprets `DungeonOnly` as permission to suppress `5f50` terrain or other
outdoor layers.

**Mitigation:** The resolved contract controls only ambient EnvCell membership. Unit and browser
tests require `5f50` terrain during organic outdoor traversal.

#### Stale Follow Completion Rewinds Interest

**Risk:** The camera crosses owners faster than profile resolution, allowing an older request to
replace the newest outdoor window.

**Mitigation:** One coordinator revision covers the entire asynchronous resolution and is checked
before all runtime and follow bookkeeping mutations.

#### Explicit Dungeon Demand Is Mistaken For Ambient Demand

**Risk:** The ambient filter also removes EnvCells from an automatic dungeon target.

**Mitigation:** Dungeon targets bypass outdoor candidate planning and continue through the existing
active-dungeon component. Verify the cold and retained-outdoor `5f50` scenarios in unit and browser
tests.

### Addendum Definition Of Done

- [x] No new content classification, profile field, stab policy, or renderer mode is introduced.
- [x] One shared coordinator resolves targets and ambient outdoor EnvCell eligibility.
- [x] `GameRuntime` remains synchronous and independent of profile fetching.
- [x] Organic outdoor traversal into `5f50` retains outdoor terrain and omits dungeon EnvCells.
- [x] Explicit automatic `5f50` still requests the dungeon only.
- [x] Explicit dungeon demand after organic arrival retains outdoor demand and adds the dungeon.
- [x] `OutdoorOrMixed` ambient EnvCell behavior remains unchanged.
- [x] Latest-request-wins behavior holds during rapid camera-follow transitions.
- [x] Production browser evidence and all repository verification gates pass.
- [x] No speculative batch endpoint, cell-selective ownership, or mixed-interior policy is added.

### Addendum Open Questions

No product or architecture question currently blocks implementation. During execution, stop and
request direction only if measured profile fanout makes outdoor follow visibly regress or production
evidence shows `5f50` does not retain outdoor terrain under an explicit outdoor request.

---

## Addendum B: Replace The Complete Render Scene On Every Explicit Target

Status: implementation and verification complete

### Evidence And Correction

The retained-outdoor policy was intentionally bounded, but it was not semantically inert. After
loading outdoor `da55`, spawning an entity, and selecting dungeon `0007`, the application had five
different answers to “what world is current”:

- the resolved scene target was `0007`;
- collision simulation interest contained `0007` and evicted `da55`;
- render demand contained both `0007` and the retained `da55` outdoor window;
- the Explorer entity registry still contained the explicitly spawned `da55` entity; and
- possession accepted that remote entity and let the boom camera publish a `da55` outdoor pose.

The entity registry is correctly independent from static streaming: future server-authored entity
lifetime must be driven by spawn/despawn authority. The render component union was not required for
that separation. It made stale presentation observable and allowed an invalid camera handoff to look
like a coherent scene transition.

The corrected invariant is:

```text
resolved scene target -> one complete render-interest replacement
resolved scene target -> one complete collision-interest replacement
entity authority       -> independent semantic lifetime
possession/boom         -> target must be resident in current collision snapshot
```

### Implementation

- `GameRuntime` owns one current `SceneInterestMap`; outdoor and dungeon planners each produce a
  complete replacement.
- Dungeon selection clears outdoor terrain-fog coverage and evicts every outdoor layer absent from
  the dungeon map.
- The retired `SceneInterestComponents`, union helper, component diagnostics, and harness fields were
  deleted.
- The host exposes one atomic body/collision/residency snapshot using the world-owned canonical
  `physical_body_scene_residency` decision.
- Explorer possession rejects missing collision owners before changing possession authority.
- Boom startup repeats the residency check against the exact collision snapshot used to seed its
  controller, covering interest movement after possession was accepted.

### Acceptance Criteria

- [x] Outdoor-to-dungeon and dungeon-to-outdoor transitions reacquire and evict layers through normal
      replacement diffs.
- [x] No render-demand component can survive a newer scene target.
- [x] Spawned entities survive until explicit despawn/reset but cannot be possessed outside current
      collision interest.
- [x] Boom startup cannot publish a path for a target outside its collision snapshot.
- [x] Current diagnostics expose one interest map and one resolved target.
- [x] Complete frontend, Rust, lint, formatting, and production-harness gates pass.

### Verification Evidence

- The complete selected Rust suites passed 932 tests, including direct rejection of remote physical
  possession and boom startup after collision-interest movement.
- The complete Explorer frontend suite passed 1,460 tests across 190 files; Svelte/TypeScript checks,
  ESLint, Knip, Prettier, rustfmt, and clippy with warnings denied passed.
- Settled and immediate production-content `da55 -> 0007` harness transitions both reported exactly
  `0x0007ffff/env-cells`, zero terrain frame inputs, zero outdoor light scopes, and no browser page
  errors or exceptions.
