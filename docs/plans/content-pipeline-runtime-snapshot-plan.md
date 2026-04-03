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
- `holtburger-world` still bootstraps from a broad `ScopedResourceResolver` even though it only needs a narrow subset of parsed startup assets.
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
use holtburger_dat::{MountedResourceProvider, ResourceKey};
use std::path::PathBuf;
use std::sync::Arc;

pub struct ContentRepository {
    inner: Arc<ContentRepositoryInner>,
}

impl ContentRepository {
    pub fn from_hba_path(path: impl Into<PathBuf>) -> Result<Self>;
    pub fn from_hba_dir(path: impl Into<PathBuf>) -> Result<Self>;
    pub fn from_mounts(mounts: Vec<MountedResourceProvider>) -> Result<Self>;

    pub fn world_bootstrap(&self) -> Result<holtburger_world::WorldBootstrap>;
    pub fn spell_catalog(&self) -> Result<Arc<holtburger_world::SpellCatalog>>;
    // TODO: If this is introduced in the first implementation, add the same note in code:
    // keep it out of the initial consumer path unless a concrete frontend/tool need appears.
    // This is a future seam, not part of the initial bootstrap inversion slice.
    pub fn resource_view(&self) -> Arc<dyn ContentResourceView>;
}

pub trait ContentResourceView: Send + Sync {
    fn get_file(&self, key: ResourceKey<'_>) -> holtburger_dat::Result<Vec<u8>>;
    fn exists(&self, key: ResourceKey<'_>) -> bool;
    fn get_metadata(&self, key: ResourceKey<'_>) -> Option<holtburger_dat::FileMetadata>;
}
```

Important boundary:
- HBA path and mount resolution belong here, not in `holtburger-core`.
- `WorldBootstrap` is the only runtime dependency product from this crate in the initial design.
- Optional reference-data helpers such as `spell_catalog()` also belong here, but they are not part of the core runtime bootstrap contract.

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
    pub fn new_with_bootstrap(
        bootstrap: Arc<WorldBootstrap>,
        spatial_physics: Arc<dyn SpatialPhysics>,
    ) -> anyhow::Result<Self>;
}
```

This keeps parsed bootstrap state in a semantically named type instead of smuggling it through a broad resolver. `holtburger-content` should produce this type, not define a parallel copy of it.

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
- Introduce `WorldBootstrap` and switch `holtburger-world` to consume it instead of `ScopedResourceResolver` for startup.
- Keep `ScopedResourceResolver` internal to the content crate's bootstrap-building implementation.

#### Files To Touch
- new files under [crates/holtburger-content/src](/home/cluracan/code/holtburger/crates/holtburger-content/src)
- [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs)
- new bootstrap module under [crates/holtburger-world/src](/home/cluracan/code/holtburger/crates/holtburger-world/src)
- [Cargo.toml](/home/cluracan/code/holtburger/Cargo.toml)

#### Acceptance Criteria
- Runtime bootstrap no longer requires `WorldState` callers to pass a broad resource resolver.
- The bootstrap contract is a named parsed-data struct, not raw bytes and not path-based state.
- Existing skill/spell/xp/motion bootstrap behavior remains intact.

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

#### Dry-Run Adjustment
- `ClientBuilder` currently mixes two distinct seams: content discovery/mounting and network session startup. This phase is still practical, but it should keep the session half stable while only extracting the content-loading half.
- Builder fixture tests in [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) currently validate HBA discovery and namespace mounting through `dats_path(...)`. Those tests should move with the content-loading code into `holtburger-content`, not be deleted.

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
- Dry run shows very little non-bootstrap usage, but `WorldState` still stores `resources` today and at least one test mutates it directly.
- Phase 1 should explicitly decide whether `resources` is removed entirely, replaced with a narrower optional hook for the few remaining tests, or retained only under test support.

### Risk: The content API becomes a god object
Mitigation:
- Do not introduce a runtime snapshot object in the initial design.
- Keep the runtime contract limited to `WorldBootstrap`.

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
- [ ] Phase 1: Add `holtburger-content` with repository and bootstrap modules.
- [ ] Phase 1: Add `WorldBootstrap` and move `WorldState` startup to it.
- [ ] Phase 2: Rename `Client` to `ClientRuntime`.
- [ ] Phase 2: Replace `dats_path` startup with `WorldBootstrap` injection.
- [ ] Phase 2: Move HBA discovery into `ContentRepository` constructors.
- [ ] Phase 3: Add spell-catalog query access outside the core runtime bootstrap path.

### Decisions Log
- 2026-04-03: Prefer a narrow bootstrap boundary over an explicit staged-runtime split.
- 2026-04-03: Prefer `holtburger-content` over `holtburger-assets` because the problem includes reference data and bootstrap assembly, not only render assets.
- 2026-04-03: Keep runtime bootstrap narrow and parsed; do not pass disk-shaped providers into core by default.
- 2026-04-03: Punt dynamic patch and invalidation policy until the asset-pipeline inversion seam is landed.
- 2026-04-03: Keep `SpellCatalog` in `holtburger-world` for now; revisit only if runtime-needed spell semantics and frontend reference data need to split later.
- 2026-04-03: Support `ContentRepository::from_mounts(...)` in the first implementation so tests, harnesses, and non-disk inputs are first-class alongside HBA path helpers.
- 2026-04-03: Defer `ContentResourceView` from the first implementation unless a concrete frontend/tool consumer appears.
- 2026-04-03: Do not preserve old bootstrap seams or test helpers for backwards compatibility alone; prefer the cleaner design and move tests to the new seam.

### Verification Log
- 2026-04-03: Reviewed current core builder/resource bootstrap flow in [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) and [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs).
- 2026-04-03: Cross-checked static-reference-data concerns against [docs/reference_data_and_asset_delivery.md](/home/cluracan/code/holtburger/docs/reference_data_and_asset_delivery.md).
- 2026-04-03: Dry run found that builder fixture tests in [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) need to migrate with content discovery rather than being treated as incidental startup tests.
- 2026-04-03: Dry run found that `RequestInitialViewState` currently bootstraps spell catalog, fellowship state, and runtime body snapshots, so Phase 3 must narrow that flow instead of deleting it wholesale.
- 2026-04-03: Dry run found that `WorldState.resources` has minimal runtime use but still exists as mutable state and a direct test seam in [crates/holtburger-world/src/state/tests.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/tests.rs).

### Resolved Questions
- `SpellCatalog` stays in `holtburger-world` for the initial implementation because shared runtime/world code still uses spell metadata for behavior and semantic projection.
- The first `ContentRepository` implementation should support both HBA-backed constructors and `from_mounts(...)` so tests and harnesses are not forced through disk-shaped setup.
- `ContentResourceView` is a deferred future seam and should stay out of the initial implementation unless a concrete consumer appears.