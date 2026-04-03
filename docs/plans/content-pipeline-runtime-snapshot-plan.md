# Content Pipeline And Runtime Bootstrap Plan

## Context And Boundaries

### Goal
Introduce a dedicated content pipeline layer that owns archive mounting, world-bootstrap resolution, and reference-data assembly, while `holtburger-core` consumes `WorldBootstrap` instead of disk-backed loaders.

### In Scope
- Define the crate boundary and API surface for a new content-facing crate.
- Define the narrow bootstrap contract that `holtburger-core` and `holtburger-world` should consume.
- Remove asset discovery and disk-path concerns from runtime builder APIs.
- Define the minimum frontend-facing query surfaces needed for a future 3D client to load assets on demand.
- Identify phased implementation work that can land incrementally without blocking the current TUI.

### Out Of Scope
- Implementing the full DDD protocol flow or dynamic patch invalidation policy in this pass.
- Building the actual 3D renderer or render-time asset cache.
- Solving every hot-reload case up front.
- Reworking unrelated protocol/session architecture beyond the seams required for content bootstrap inversion.
- Final naming for every crate/type. The API shapes below are concrete enough to implement, but some names may still change.

## Problem Statement

Today runtime bootstrap is still too disk-shaped:

- `holtburger-core`'s client builder discovers HBA files from a path, mounts namespaces, validates required assets, and constructs `WorldState`.
- `holtburger-world` still bootstraps from a broad resource lookup layer even though it only needs a narrow subset of parsed startup assets.
- Frontends do not yet have a first-class content service for static reference data or future heavy assets.

That creates two architectural problems:

1. Runtime and content-pipeline responsibilities are mixed.
2. The runtime dependency boundary is wider and more disk-oriented than the semantics actually require.

The fix is not merely “move the asset manager into another crate”; the fix is to make content resolution produce direct bootstrap inputs that runtime consumes explicitly.

## Ground Truth And Existing Patterns

### Reference Sources
- [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs)
- [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs)
- [crates/holtburger-dat/src/lib.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/lib.rs)
- [docs/reference_data_and_asset_delivery.md](/home/cluracan/code/holtburger/docs/reference_data_and_asset_delivery.md)
- [docs/plans/derived-motion-kinematics-asset-plan.md](/home/cluracan/code/holtburger/docs/plans/derived-motion-kinematics-asset-plan.md)
- [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs)

### Existing Patterns To Preserve
- `holtburger-dat` owns raw DAT/HBA parsing, namespaces, and deterministic file decoding.
- `apps/holtburger-tools` owns archive building, derivation, and packaging workflows.
- `holtburger-world` should consume parsed semantic bootstrap data, not perform archive discovery.
- `holtburger-core` should orchestrate session and runtime behavior, not own disk-path or archive-mount policy.
- Future shared contracts should be plausible for both the current TUI and a conventional 3D client.

## Design Conclusion

### Architectural Summary
Introduce a new crate that owns content mounting, bootstrap resolution, and reference-data assembly. Runtime then consumes `WorldBootstrap` produced by that crate.

Recommended crate name:
- `holtburger-content`

Acceptable alternative if you want stronger 3D-client framing:
- `holtburger-assets`

I recommend `holtburger-content` because this layer is broader than render assets alone. It owns reference data, bootstrap tables, and content assembly policy without forcing those concerns into `holtburger-core`.

### High-Level Flow
1. Frontend/tooling creates a content repository from HBA providers or mounted archives.
2. The repository resolves the required `WorldBootstrap`.
3. `ClientRuntimeBuilder` consumes that `WorldBootstrap` and creates runtime state.
4. Frontends or tools can query optional reference data directly from the repository when needed.

### Deferred Dynamic Patch Work
Dynamic patches, DDD, and runtime invalidation are real future concerns, but this plan deliberately punts them. The first implementation should establish the content-pipeline and runtime-inversion seams cleanly before adding live update policy.

## Proposed API Shapes

### Crate Layout

```rust
// crates/holtburger-content/src/lib.rs
// bootstrap.rs contains assembly helpers that resolve holtburger_world::WorldBootstrap
// from mounted content sources; it does not define a parallel bootstrap type.
pub mod bootstrap;
pub mod repository;
```

### Repository And Mounting Surface

```rust
// crates/holtburger-content/src/repository.rs
use anyhow::Result;
use holtburger_dat::ResourceSource;
use std::sync::Arc;

pub struct ContentRepository {
    mounts: Vec<Arc<dyn ResourceSource>>,
}

impl ContentRepository {
    pub fn from_mounts(mounts: Vec<Arc<dyn ResourceSource>>) -> Self;

    pub fn world_bootstrap(&self) -> Result<Arc<holtburger_world::WorldBootstrap>>;
}
```

Important boundary:
- Phase 1 ships `from_mounts(...)`; Phase 2 adds HBA path and directory constructors and moves all mount discovery into this crate.
- `WorldBootstrap` is the only runtime dependency product from this crate in the initial design.
- Optional reference-data helpers such as `spell_catalog()` still belong here, but they are intentionally deferred until Phase 3.

### World Bootstrap Contract

```rust
// crates/holtburger-world/src/bootstrap.rs
use crate::SpellCatalog;
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct WorldBootstrap {
    pub skill_table: Arc<SkillTable>,
    pub spell_table: Arc<SpellTable>,
    pub xp_table: Arc<XpTable>,
    pub motion_kinematics: Arc<MotionKinematics>,
}

impl WorldBootstrap {
    pub fn spell_catalog(&self) -> Arc<SpellCatalog>;
}
```

This is the important contract. It is intentionally not disk-shaped and not namespace-iteration-shaped. It captures what runtime actually semantically depends on.

`SpellCatalog` is deliberately not embedded here. It is derived reference data used by frontend-facing consumers, not a core runtime bootstrap dependency. The runtime already needs `SpellTable`; a second spell-derived bucket inside the same bootstrap contract would just duplicate responsibility.

### Runtime Builder Updates

```rust
// crates/holtburger-core/src/client/builder.rs
pub struct ClientRuntimeBuilder {
    account_name: String,
    server_endpoint: Option<ServerEndpoint>,
    world_bootstrap: Option<Arc<WorldBootstrap>>,
    spatial_physics: Option<Arc<dyn SpatialPhysics>>,
}

impl ClientRuntimeBuilder {
    pub fn new(account_name: impl Into<String>) -> Self;

    pub fn server(mut self, host: impl Into<String>, port: u16) -> Self;

    pub fn world_bootstrap(mut self, bootstrap: Arc<WorldBootstrap>) -> Self;

    pub fn spatial_physics(mut self, physics: Arc<dyn SpatialPhysics>) -> Self;

    pub async fn connect(self) -> anyhow::Result<ClientRuntime>;
}
```

Migration note:
- `ClientBuilder::dats_path(...)` should disappear from core.
- Rename `Client` to `ClientRuntime` while touching this seam, because the new name better matches the role.

### World Bootstrap Updates

`WorldState::new_with_spatial_physics(...)` should become:

```rust
impl WorldState {
    pub fn new_with_spatial_physics(
        bootstrap: Arc<WorldBootstrap>,
        spatial_physics: Arc<dyn SpatialPhysics>,
    ) -> Self;
}
```

This keeps parsed bootstrap state in a semantically named type instead of smuggling it through a broad resolver. `holtburger-content` should produce this type, not define a parallel copy of it.

Phase 1 implementation note:
- This constructor is intentionally infallible because all fallible parsing now lives in `holtburger-content`.

### Frontend Query Surface For A Future 3D Client

```rust
// crates/holtburger-content/src/repository.rs
impl ContentRepository {
    pub fn resource_view(&self) -> Arc<dyn ContentResourceView>;
    pub fn spell_catalog(&self) -> Result<Arc<holtburger_world::SpellCatalog>>;
}
```

This is intentionally thin. A future 3D frontend can build higher-level caches and streaming policy on top of it without forcing those concerns into `holtburger-core`.

## Phased Implementation

### Phase 1: Define Bootstrap Contracts And Move Bootstrap Parsing To Named Types

#### Deliverables
- Add the new content-facing crate with the core repository type plus bootstrap-construction helpers that produce `holtburger_world::WorldBootstrap`.
- Introduce `WorldBootstrap` and switch `holtburger-world` to consume it instead of a broad resolver for startup.
- Keep archive lookup details below the content/runtime boundary.
- Remove `WorldState.resources` rather than preserving it as a post-bootstrap back door.

#### Files To Touch
- new files under [crates/holtburger-content/src](/home/cluracan/code/holtburger/crates/holtburger-content/src)
- [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs)
- new bootstrap module under [crates/holtburger-world/src](/home/cluracan/code/holtburger/crates/holtburger-world/src)
- [Cargo.toml](/home/cluracan/code/holtburger/Cargo.toml)

#### Acceptance Criteria
- Runtime bootstrap no longer requires `WorldState` callers to pass a broad resource resolver.
- The bootstrap contract is a named parsed-data struct, not raw bytes and not path-based state.
- Existing skill/spell/xp/motion bootstrap behavior remains intact.
- `WorldState.resources` and provider-backed world constructors are gone.

### Phase 2: Move HBA Discovery And Mount Policy Out Of Core

#### Deliverables
- Move `dats_path`, HBA discovery, and namespace mounting logic out of `ClientBuilder` into `ContentRepository` constructors.
- Rename `ClientBuilder` to `ClientRuntimeBuilder` and `Client` to `ClientRuntime`.
- Make runtime builder require `WorldBootstrap`.
- Update CLI and harness startup to construct a repository first, then pass `WorldBootstrap` to core.

#### Files To Touch
- [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs)
- [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- [apps/holtburger-cli/src/bin/tui.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/bin/tui.rs)
- [crates/holtburger-debug-harness/src/bin/extractor.rs](/home/cluracan/code/holtburger/crates/holtburger-debug-harness/src/bin/extractor.rs)

#### Acceptance Criteria
- `holtburger-core` no longer exposes disk-path asset-loading APIs.
- CLI/harness startup still works by constructing `WorldBootstrap` externally.
- Runtime tests can inject `WorldBootstrap` directly without mounting on-disk archives.
- HBA discovery and missing-required-asset validation live in `holtburger-content`, not in `holtburger-core`.

#### Dry-Run Adjustment
- `ClientBuilder` currently mixes two distinct seams: content discovery/mounting and network session startup. This phase is still practical, but it should keep the session half stable while only extracting the content-loading half.
- Builder fixture tests in [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) currently validate HBA discovery and namespace mounting through `dats_path(...)`. Those tests should move with the content-loading code into `holtburger-content`, not be deleted.

### Phase 2.5: Replace Namespace-Mounted Resolver With Namespace-Aware Sources

#### Why This Exists
- After Phase 2, `holtburger-core` is cleanly inverted, but `holtburger-dat` and `holtburger-content` still model lookup through namespace-at-mount projection instead of source-oriented lookup.
- That shape still assumes a source is effectively single-namespace and the namespace lives at the mount edge instead of in the lookup contract.
- Now that HBA archives are expected to contain mixed namespaces, that abstraction is backwards: the physical source can serve many namespaces, while overlay/precedence should live in the repository layer.

#### Deliverables
- Replace the remaining mount-time namespace binding model with a namespace-aware source trait keyed by `ResourceKey`.
- Replace `MountedResourceProvider` with a source mount type that represents source precedence, not a fake single-namespace projection.
- Replace `ScopedResourceResolver` with `LayeredResourceResolver`, which queries mounted sources by full `ResourceKey`.
- Keep `holtburger-dat` free of legacy portal/cell-specific convenience shapes; namespace-aware lookup should be the only runtime-facing model.
- Update `holtburger-content` to build bootstrap and validation on the new layered resolver without wrapping the same archive once per namespace.

#### Proposed Direction

```rust
// crates/holtburger-dat/src/lib.rs
pub trait ResourceSource: Send + Sync {
    fn get_file_by_key(&self, key: ResourceKey<'_>) -> Result<Vec<u8>>;
    fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata>;
    fn has_namespace(&self, namespace: &str) -> bool;
}

pub struct LayeredResourceResolver {
    sources: Vec<Arc<dyn ResourceSource>>,
}
```

Design constraint:
- Namespace belongs in `ResourceKey` and lookup calls.
- Mounts should express layer ordering and override policy only.
- A mixed-namespace HBA should be mountable exactly once.

#### Files To Touch
- [crates/holtburger-dat/src/lib.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/lib.rs)
- [crates/holtburger-content/src/bootstrap.rs](/home/cluracan/code/holtburger/crates/holtburger-content/src/bootstrap.rs)
- [crates/holtburger-content/src/repository.rs](/home/cluracan/code/holtburger/crates/holtburger-content/src/repository.rs)
- [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs) if any helper APIs there still assume namespace-at-mount

#### Acceptance Criteria
- No runtime library code depends on `MountedResourceProvider` or `ScopedResourceResolver`.
- No runtime library code needs to mount the same archive once per namespace.
- Namespace-aware lookup is driven by `ResourceKey`, not by portal/cell-style scope helpers or per-namespace provider wrappers.
- `holtburger-content` bootstrap/validation behavior is unchanged from the caller's perspective.

#### Dry-Run Adjustment
- This phase should stay below the content/runtime boundary and must not get entangled with Phase 3's spell-reference delivery work.
- If the new dat-layer trait names or exact structs want to differ from the sketch above, that is fine; the important thing is the ownership model, not the spelling.

### Phase 3: Add Reference-Data And Frontend Query Surfaces

#### Deliverables
- Add repository-side reference-data helpers such as `spell_catalog()`.
- Move spell-catalog bootstrap out of ad hoc runtime event delivery and make it obtainable from the content repository rather than from core runtime bootstrap.
- Keep `ClientViewEvent` focused on semantic world/core state.
- Document which static datasets are reference data versus authoritative gameplay semantics.
- If `resource_view()` is introduced during implementation, add an in-code TODO comment next to that API noting that it is intentionally deferred from the initial consumer path until a concrete frontend/tool need appears.

#### Explicit Migration Targets
- Remove spell catalog from `ClientCommand::RequestInitialViewState` once the frontend can read reference data from `holtburger-content` directly.
- Remove `ClientViewEvent::SpellCatalogLoaded` as a core-to-frontend reference-data transport event.
- Delete the corresponding `emit_spell_catalog_loaded()` path in core runtime startup.
- Update the CLI to populate its local spell lookup from `ContentRepository::spell_catalog()` instead of waiting for a pushed core event.

#### Dry-Run Adjustment
- `RequestInitialViewState` currently also drives fellowship and runtime-body bootstrap in [crates/holtburger-core/src/client/runtime.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime.rs). Phase 3 should narrow that command/event flow rather than assuming the whole command disappears in the same pass.
- The CLI currently sends `RequestInitialViewState` from multiple bootstrap/reconnect paths in [apps/holtburger-cli/src/bin/tui.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/bin/tui.rs). Spell catalog removal is practical, but the remaining initial-state projection flow still needs to survive for non-content runtime state.

#### Files To Touch
- [crates/holtburger-core/src/client](/home/cluracan/code/holtburger/crates/holtburger-core/src/client)
- [apps/holtburger-cli/src](/home/cluracan/code/holtburger/apps/holtburger-cli/src)
- [docs/reference_data_and_asset_delivery.md](/home/cluracan/code/holtburger/docs/reference_data_and_asset_delivery.md)

#### Acceptance Criteria
- Frontend can query static spell metadata without core pretending it is live world state.
- Core event surfaces shrink toward semantic state only.
- `RequestInitialViewState` and `SpellCatalogLoaded` are no longer required for spell reference data bootstrap.
- The resulting seam is plausible for future 3D asset/reference lookups.

## Deferred Follow-Up

- Add heavier frontend-facing asset lookup helpers only when a renderer or other concrete consumer needs them.
- Consider introducing `resource_view()` only when a concrete frontend/tool consumer proves the generic query surface is necessary.

## Risks And Mitigations

### Risk: Circular dependencies between content, world, and core
Mitigation:
- Keep `holtburger-content` dependent on `holtburger-dat` and, if needed, `holtburger-world` only for shared parsed reference types that already semantically belong there.
- If that becomes awkward, move neutral bootstrap structs into a small shared module rather than letting core own them.

### Risk: `WorldState.resources` lingers as a back door after bootstrap inversion
Mitigation:
- Phase 1 removes `WorldState.resources` entirely.
- World/runtime tests should construct `WorldBootstrap` directly or go through `holtburger-content`, depending on what seam they are validating.

### Risk: The content API becomes a god object
Mitigation:
- Do not introduce a runtime snapshot object in the initial design.
- Keep the runtime contract limited to `WorldBootstrap`.

### Risk: Namespace-aware sources stay bolted onto a fake single-namespace mount model
Mitigation:
- Do not keep `MountedResourceProvider`/`ScopedResourceResolver` around once the mixed-namespace source model lands.
- Make the dat/content layers resolve by `ResourceKey` against mounted sources directly.
- Treat per-namespace source wrapping as obsolete infrastructure, not as a compatibility layer to preserve.

### Risk: We over-design for dynamic patching before the basic seam lands
Mitigation:
- Punt dynamic patch policy entirely from this implementation plan.
- Add update/revision machinery later only once a concrete runtime consumer exists.

### Risk: Frontends bypass the bootstrap/query boundary and start depending on raw archive details again
Mitigation:
- Keep archive/path mounting APIs in `holtburger-content`.
- Remove path-based APIs from `holtburger-core` entirely.

### Risk: The refactor gets diluted by backwards-compatibility shims
Mitigation:
- Do not preserve `WorldState.resources`, builder-era startup helpers, or spell-catalog delivery paths solely to avoid rewriting tests.
- Move tests to `WorldBootstrap` and `ContentRepository` seams instead of preserving obsolete APIs.
- Prefer cleaner crate boundaries and ownership over transitional compatibility, including for tests.

## Definition Of Done

- `holtburger-core` runtime builder no longer accepts disk paths or directly mounts archives.
- `holtburger-world` bootstraps from a narrow parsed bootstrap contract.
- There is a dedicated content crate that owns content repository, bootstrap assembly, and reference-data assembly.
- Frontends have a thin query surface for static/reference data without turning `ClientViewEvent` into an asset bus.
- CLI and harness startup paths compile and run using the new `WorldBootstrap` flow.

## Living Worksheet

### Task Checklist
- [x] Phase 1: Add `holtburger-content` with repository and bootstrap modules.
- [x] Phase 1: Add `WorldBootstrap` and move `WorldState` startup to it.
- [x] Phase 2: Rename `Client` to `ClientRuntime`.
- [x] Phase 2: Replace `dats_path` startup with `WorldBootstrap` injection.
- [x] Phase 2: Move HBA discovery into `ContentRepository` constructors.
- [x] Phase 2.5: Replace namespace-mounted providers with namespace-aware source layers.
- [x] Phase 3: Add spell-catalog query access outside the core runtime bootstrap path.

### Decisions Log
- 2026-04-03: Prefer a narrow bootstrap boundary over an explicit staged-runtime split.
- 2026-04-03: Prefer `holtburger-content` over `holtburger-assets` because the problem includes reference data and bootstrap assembly, not only render assets.
- 2026-04-03: Keep runtime bootstrap narrow and parsed; do not pass disk-shaped providers into core by default.
- 2026-04-03: Punt dynamic patch and invalidation policy until the asset-pipeline inversion seam is landed.
- 2026-04-03: Keep `SpellCatalog` in `holtburger-world` for now; revisit only if runtime-needed spell semantics and frontend reference data need to split later.
- 2026-04-03: Ship `ContentRepository::from_mounts(...)` first and leave HBA path/directory constructors for Phase 2 with the rest of the mount-policy move.
- 2026-04-03: Defer `ContentResourceView` from the first implementation unless a concrete frontend/tool consumer appears.
- 2026-04-03: Do not preserve old bootstrap seams or test helpers for backwards compatibility alone; prefer the cleaner design and move tests to the new seam.
- 2026-04-03: Make `WorldState` bootstrap construction infallible because all fallible parsing now happens in `holtburger-content`.
- 2026-04-03: Remove `WorldState.resources` outright instead of retaining a bootstrap-era test seam.
- 2026-04-03: Keep `holtburger-core` independent of `holtburger-content`; the frontend or tool should assemble `WorldBootstrap` and pass it into the runtime builder.
- 2026-04-03: Keep required-asset validation errors in `holtburger-content` so path/namespace/file-id context stays attached to content-loading failures after the inversion.
- 2026-04-03: Do not preserve the namespace-at-mount model in runtime libraries now that mixed-namespace HBA sources are the expected shape.
- 2026-04-03: Phase 2.5 should replace `MountedResourceProvider` and `ScopedResourceResolver` rather than layering more API on top of them.
- 2026-04-03: Keep `ResourceProvider` as a lower-level single-dataset convenience for DAT/tooling seams, but make `ResourceSource` plus `LayeredResourceResolver` the runtime/content lookup path.
- 2026-04-03: Mount each HBA archive exactly once in `ContentRepository`; layer ordering now lives in repository source order instead of namespace-specific mount deduplication.
- 2026-04-03: Drop `MountedResourceSource`; plain `Arc<dyn ResourceSource>` already expresses the only real invariant, and wrapper types should wait until there is actual per-layer metadata to carry.
- 2026-04-03: Keep `RequestInitialViewState` for semantic runtime bootstrap only; static spell metadata now belongs to `ContentRepository::spell_catalog()` instead of `ClientViewEvent` delivery.
- 2026-04-03: Seed frontend spell lookup state from bootstrap content ownership in the frontend layer rather than from pushed core runtime events.
- 2026-04-03: Post-refactor cleanup should prune leftover body-ID and bootstrap wrapper shims when the underlying abstraction is already explicit.

### Verification Log
- 2026-04-03: Reviewed current core builder/resource bootstrap flow in [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) and [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs).
- 2026-04-03: Cross-checked static-reference-data concerns against [docs/reference_data_and_asset_delivery.md](/home/cluracan/code/holtburger/docs/reference_data_and_asset_delivery.md).
- 2026-04-03: Dry run found that builder fixture tests in [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) need to migrate with content discovery rather than being treated as incidental startup tests.
- 2026-04-03: Dry run found that `RequestInitialViewState` currently bootstraps spell catalog, fellowship state, and runtime body snapshots, so Phase 3 must narrow that flow instead of deleting it wholesale.
- 2026-04-03: Implemented Phase 1 in [crates/holtburger-content/src](/home/cluracan/code/holtburger/crates/holtburger-content/src), [crates/holtburger-world/src/bootstrap.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/bootstrap.rs), and [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs).
- 2026-04-03: Confirmed Phase 1 with `cargo test -p holtburger-content -p holtburger-world -p holtburger-core`.
- 2026-04-03: Implemented Phase 2 in [crates/holtburger-content/src/repository.rs](/home/cluracan/code/holtburger/crates/holtburger-content/src/repository.rs), [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs), [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), [apps/holtburger-cli/src/bin/tui.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/bin/tui.rs), and [crates/holtburger-debug-harness/src/bin/extractor.rs](/home/cluracan/code/holtburger/crates/holtburger-debug-harness/src/bin/extractor.rs).
- 2026-04-03: Confirmed Phase 2 with `cargo test -p holtburger-content -p holtburger-core -p holtburger-world` and `cargo check -p holtburger-cli -p holtburger-debug-harness`.
- 2026-04-03: Post-Phase-2 review found that `MountedResourceProvider` and `ScopedResourceResolver` still encode namespace at the mount layer, which is the wrong abstraction for mixed-namespace HBA sources and should be addressed before Phase 3.
- 2026-04-03: Implemented Phase 2.5 in [crates/holtburger-dat/src/lib.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/lib.rs), [crates/holtburger-dat/src/archive.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/archive.rs), [crates/holtburger-content/src/bootstrap.rs](/home/cluracan/code/holtburger/crates/holtburger-content/src/bootstrap.rs), and [crates/holtburger-content/src/repository.rs](/home/cluracan/code/holtburger/crates/holtburger-content/src/repository.rs).
- 2026-04-03: Confirmed Phase 2.5 with `cargo test -p holtburger-dat -p holtburger-content -p holtburger-core -p holtburger-world` and `cargo check -p holtburger-cli -p holtburger-debug-harness`.
- 2026-04-03: Implemented Phase 3 in [crates/holtburger-content/src/repository.rs](/home/cluracan/code/holtburger/crates/holtburger-content/src/repository.rs), [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs), [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), [crates/holtburger-core/src/client/runtime.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime.rs), [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs), [apps/holtburger-cli/src/bin/tui.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/bin/tui.rs), [apps/holtburger-cli/src/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/state.rs), [apps/holtburger-cli/src/update/app_action.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/update/app_action.rs), [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs), and [docs/reference_data_and_asset_delivery.md](/home/cluracan/code/holtburger/docs/reference_data_and_asset_delivery.md).
- 2026-04-03: Confirmed Phase 3 with `cargo fmt && cargo test -p holtburger-content -p holtburger-core -p holtburger-world -p holtburger-cli && cargo check -p holtburger-debug-harness`.
- 2026-04-03: Pruned remaining post-refactor shims by making `ClientSimulationSystem` track `SpatialBodyId` directly, inlining the one-call `emit_initial_view_state()` wrapper into command handling, and updating stale spell-bootstrap wording in [docs/reference_data_and_asset_delivery.md](/home/cluracan/code/holtburger/docs/reference_data_and_asset_delivery.md).
- 2026-04-03: Confirmed post-refactor cleanup with `cargo test -p holtburger-core -p holtburger-cli && cargo check -p holtburger-debug-harness`.

### Resolved Questions
- `SpellCatalog` stays in `holtburger-world` for the initial implementation because shared runtime/world code still uses spell metadata for behavior and semantic projection.
- `ContentRepository` now exposes `from_mounts(...)`, `from_hba_path(...)`, and `from_hba_dir(...)`; runtime code consumes only the resulting `WorldBootstrap`.
- The dat/content lookup seam is now source-oriented and `ResourceKey`-oriented; mixed-namespace HBA archives mount once and layered precedence lives in repository source order.
- `ContentRepository::spell_catalog()` is now the frontend-facing spell reference-data seam; `RequestInitialViewState` remains only for runtime state that is actually projected from core.
- `ContentResourceView` is a deferred future seam and should stay out of the initial implementation unless a concrete consumer appears.