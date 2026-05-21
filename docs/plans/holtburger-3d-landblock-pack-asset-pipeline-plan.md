# Holtburger 3D Landblock Pack Asset Pipeline Plan

Status: phased implementation plan.

This plan coalesces the landblock-pack optimization investigation into an implementable sequence. It replaces the earlier WIP note shape while preserving the important goals, decisions, profiling findings, and constraints.

## Goals

- Reduce startup and navigation stalls caused by loading landblock-scoped content.
- Keep reusable static-content loading below `apps/holtburger-3d/src-tauri` so the work serves the current Tauri/browser renderer, future full client mode, Rust-side world/physics simulation, diagnostics, and harnesses.
- Preserve typed Rust runtime products as the source of truth, then project browser/Tauri DTOs from those products.
- Avoid duplicating heavy decoded source assets or prepared data across landblocks unless a measured use case justifies it.
- Reduce JSON payload pressure for full landblock packs, especially large homogeneous numeric arrays.
- Add cache/runtime infrastructure without letting current browser DTOs define long-term content architecture.

## Non-Goals

- Do not redesign frontend LoD scheduling, Three.js object creation, renderer cache policy, or browser-mode UX except where those surfaces consume new Rust payloads.
- Do not move browser-specific control or presentation policy into shared Rust crates.
- Do not binary-pack object-heavy semantic graphs in the first binary phase.
- Do not treat DAT archive byte caching as the first fix unless new measurements contradict the current profile.

## Current Shape

`landblock-pack/<XXYYFFFF>` is produced by `LandblockPackAssembler` in `holtburger-content` and serialized by the 3D Tauri adapter.

For one pack, Rust may currently:

- read and decode `CellLandblock` from `XXYYFFFF`;
- read and decode `LandblockInfo` from `XXYYFFFE`;
- enumerate `LandblockInfo.num_cells` and read/decode every env cell `XXYY0100..`;
- read/decode unique `Environment` records referenced by env cells;
- build prepared terrain, interiors, static instances/meshes, spatial items, and a landblock-scoped static BVH;
- read/decode setup models and gfx objects for static expansion and bounds;
- invoke `StaticOutdoorSceneAssembler`, which independently loads some of the same roots and generated scenery inputs;
- serialize source facts plus prepared facts into one large JSON payload.

The repository/archive layer has mounted archive metadata and file handles, but it does not provide a decoded source asset cache. Repeated source access can still pay lookup, byte read, decompression, allocation, and decode costs. OS page cache may reduce physical IO, but application work remains.

## Profiling Findings

Startup scene-load profiling was captured through `apps/holtburger-3d`'s `npm run profile` helper after prebuilding the Rust `profiling` profile. The useful capture avoided earlier `rustc`/LLVM rebuild noise and produced:

- `target/profiles/holtburger-3d-profile.perf.data`: about 63 MiB.
- `target/profiles/holtburger-3d-profile.perf.script`: about 2.2 MiB.

Whole-process sampled CPU ranking:

1. `WebKitWebProcess`: about 78%.
   Dominant visible families were JavaScriptCore/WebKit string, allocation, and GC paths such as `WTF::StringImpl::hashSlowCase`, `JSC::JSRopeString::resolveRope`, `JSC::LocalAllocator::allocateSlowCase`, `WTF::String::number`, and heap/deallocation helpers.
2. WebKit/JSC worker and helper threads:
   `JITWorker` about 4.6%, `WebCore: Worker` about 3.7%, `MainThread` about 2.6%, and `HeapHelper` about 2.3%.
3. Rust host JSON projection/serialization cluster:
   `serde_json::Value` object insertion, `serde_json::Value::serialize`, string formatting, and `serde_json::Value` drop/free paths.
4. Rust static mesh grouping/sorting:
   `build_prepared_static_meshes`, `sort_by`, and quicksort over `PreparedStaticMesh`.
5. Rust polygon render geometry construction:
   `build_polygon_set_render_geometry` and vertex/polygon lookup/filtering paths.
6. Rust source decode/decompression:
   `ZSTD_decompress*` is visible but not dominant.
7. Rust archive reads:
   `read_entry_at` / `pread` is visible but small in this capture.

Interpretation:

- The first-order startup scene-load stall appears to be payload shape and JSON materialization across Rust and WebKit/JSC, not raw DAT disk IO.
- Decode caching remains valuable because it removes repeated source work, supports follow-up asset routes, and is required for future runtime/client mode.
- Binary transport for large homogeneous arrays is high priority because it attacks Rust `serde_json::Value` churn and browser-side JS object/string/GC churn together.
- Coarse Rust timing spans are still required because sampled CPU does not fully answer wall-clock phase ordering or command-thread residency.

## Architectural Decisions

- Put reusable content loading, decode caching, worker execution, and landblock assembly below `apps/holtburger-3d/src-tauri`.
- Treat the Tauri adapter as an adapter: parse frontend asset ids, call reusable content APIs, and serialize/provide browser-facing projections.
- Keep typed Rust source/static products as the reusable runtime contract. Browser/Tauri DTOs are projections.
- Keep `landblock-render-local` spatial items/BVH renderer-facing. Do not overload them as physics/collision contracts.
- Add source/static-world spatial products later when runtime physics, collision, or source-space queries need them.
- Use a distinct `landblock-summary/*` browser asset for cheap distant landblocks instead of making `landblock-pack/*` conditionally partial.
- Keep building source facts in summaries, but omit building renderable expansion, setup/gfx expansion, bounds, and BVH from the first summary shape.
- Use decoded source caching first. Do not add raw-byte caching until measurements show repeated decompression/archive reads remain material after decoded caching.
- Use pinned caches for singleton/global records and bounded LRU caches for repeatable decoded records. Do not use TTL; DAT content is immutable for the mounted content set.
- Use a self-contained binary envelope for large prepared arrays. Avoid manifest-plus-buffer-sidecar commands because they create buffer lifetime, cleanup, and abandoned-request coordination problems.
- Make the first binary transport implementation a `landblock-pack/*` bulk-array phase, not a BVH-only or single-array proof.

## Target Runtime Shape

Longer-term reusable content runtime:

```rust
ContentAssetRuntime {
    repository: Arc<ContentRepository>,
    decode_cache: Arc<ContentDecodeCache>,
    executor: AssetJobExecutor,
}
```

Target APIs:

```rust
impl ContentAssetRuntime {
    async fn load_landblock_pack(&self, landblock_id: u32) -> Result<LandblockPack>;
    async fn load_landblock_summary(&self, landblock_id: u32) -> Result<LandblockSummary>;
    async fn load_gfx_obj(&self, gfx_obj_id: u32) -> Result<GfxObjAsset>;
    async fn load_setup_model(&self, setup_model_id: u32) -> Result<SetupModelAsset>;
}
```

Operation-scoped pack coordination remains useful:

```rust
LandblockPackAssemblyContext<'a> {
    content: &'a ContentRepository,
    decode_cache: &'a ContentDecodeCache,
    per_pack: PerPackDerivedCache,
}
```

Cache split:

```rust
ContentDecodeCache {
    pinned: PinnedContentCache,
    lru: LruDecodedRecordCache,
}
```

Pinned records:

- `RegionDesc`.
- Future small singleton/global tables.

LRU records:

- `Scene`.
- `SetupModel`.
- `GfxObj`.
- `CellLandblock`.
- `LandblockInfo`.
- `EnvCell`.
- `Environment`.

## Codebase Dry-Run Findings

The current codebase shape changes the implementation sequence in a few important ways:

- `LandblockPackAssembler` currently loads decoded roots, immediately derives facts, and discards the decoded `CellLandblock`, `LandblockInfo`, `EnvCell`, and `Environment` records. Phase 2 must preserve decoded roots in the assembly context, not only cache derived facts.
- `StaticOutdoorSceneAssembler` already has a private loaded-input implementation seam. Phase 3 should expose that seam cleanly instead of inventing a parallel static outdoor assembly path.
- Static outdoor assembly and pack assembly both read setup models, gfx objects, region data, scenes, and root landblock records through direct `ContentRepository` helper functions. The cleaner approach is a shared typed source reader/context used by both modules, not pack-only helper methods that static outdoor cannot consume.
- `AssetLookupGateway` already coalesces duplicate frontend asset requests by `assetId` inside one gateway instance. Runtime coalescing is still useful for future client mode, cross-route reuse, and non-frontend callers, but it is not the first duplicate-request fix.
- The existing Tauri contract cannot carry binary payloads despite having a `bytes` payload-kind enum value: `AssetLookupResponseDto.payload` is still `serde_json::Value`, and frontend dependency derivation ignores non-JSON payloads. Phase 8 requires a real binary command/normalization path plus dependency metadata that remains inspectable.
- `landblock-summary/*` is not Rust-only. It needs Rust product/projection work and frontend planner/cache/render policy work before it reduces far-ring full-pack pressure.
- Proven dungeon outdoor-work skipping becomes easy after Phase 2/3 root loading is clean. It should move earlier than the broader summary/binary contract work.

Hard blockers identified by the dry run:

- Phase 4 resolved the `ContentDecodeCache` implementation strategy as small typed LRU buckets with standard-library synchronization. Avoid a generic type-erased `Any` cache unless a concrete need appears.
- Decide where the async/bounded executor lives before Phase 5. Do not force `tokio` into `holtburger-content` as an accident of the current Tauri app; a synchronous reusable content service plus an executor wrapper in `holtburger-core` or a dedicated runtime layer may be cleaner.
- Define the binary response contract before Phase 8 implementation. The current `lookup_asset` JSON DTO is not a viable container for binary landblock packs.
- Preserve frontend dependency scheduling when binary packs arrive. Dependencies currently come from JSON payload inspection, so the binary envelope must expose dependency metadata in the manifest or normalized response.

## Phase 0: Profiling Harness And Baseline

Status: partially complete.

Goal: make startup/load profiling repeatable and record the baseline that motivated the plan.

Completed:

- Added `apps/holtburger-3d` script `npm run profile`.
- Added `apps/holtburger-3d/scripts/profile.sh`.
- The script prebuilds `src-tauri` with Cargo profile `profiling`, records with `perf` at default `49 Hz`, and emits both `.perf.data` and `.perf.script`.
- Captured an initial useful profile showing WebKit/JSC payload materialization and Rust JSON projection as the dominant bottleneck family.

Remaining work:

- Add a short README or inline comment in the script if future users need common `perf_event_paranoid` troubleshooting.
- Consider adding optional script knobs for output name, duration, and whether to skip `.perf.script` generation for very large captures.

Validation:

- `bash -n apps/holtburger-3d/scripts/profile.sh`.
- `npm run --prefix apps/holtburger-3d profile` produces `target/profiles/holtburger-3d-profile.perf.data` and `.perf.script`.

## Phase 1: Coarse Rust Timing Spans

Status: optional support phase. Do not block implementation on this phase.

Goal: establish wall-clock phase timings before making deeper scheduling and micro-optimization decisions.

Scope:

- Add low-overhead timing spans around the synchronous Rust asset lookup path.
- Capture at least:
  - `asset_lookup` total;
  - request parse / route dispatch;
  - landblock pack assembly total;
  - root record load/decode;
  - env cell and environment load/decode;
  - prepared terrain;
  - prepared interiors;
  - prepared static instances and meshes;
  - spatial items and BVH;
  - browser DTO projection;
  - JSON serialization / response construction;
  - Tauri response handoff boundary where observable.
- Keep diagnostics opt-in or low-noise. Do not write tests for debug-only logging.

Implementation notes:

- Prefer scoped timing helpers in `holtburger-content` or the Tauri adapter depending on the phase being measured.
- Reusable content timing should not depend on frontend DTO types.
- Report aggregate timing in verbose diagnostics or a debug-only host overview field if that already fits local patterns.

Validation:

- Capture startup scene load with timing enabled.
- Confirm timings explain where wall-clock stall is spent.
- Compare timing shape with the existing `perf` profile.

Exit criteria:

- We can rank wall-clock phases for a representative startup scene load.
- The next phases can be prioritized with data, not only sampled CPU.

## Phase 2: Typed Pack Assembly Context

Status: implemented.

Goal: centralize landblock pack assembly source access and remove duplicate work inside one pack build without committing all cache policy up front.

Implemented:

- Added `ContentSourceReader` in `holtburger-content` as the shared typed source access layer.
- Added pack-local decoded caches for `CellLandblock`, `LandblockInfo`, `EnvCell`, `Environment`, `RegionDesc`, `Scene`, `SetupModel`, and `GfxObj`.
- Added `LandblockPackAssemblyContext` to own the source reader and pack diagnostics for one full pack build.
- Changed landblock pack assembly to preserve decoded official roots, then derive facts from those decoded records.
- Routed env-cell, environment, setup-model, gfx-object, static outdoor, scene, and region-desc reads through the shared reader during pack assembly.
- Updated `StaticOutdoorSceneAssembler` to accept the shared source reader for pack assembly while keeping the standalone route intact.

Decisions:

- The shared reader returns cloned typed records from pack-local caches. That keeps borrow lifetimes simple for Phase 2 and avoids exposing mutable cache internals to assemblers.
- Phase 2 deliberately does not add cross-pack LRU policy. The reader is operation-scoped only; Phase 4 can reuse its typed loading methods as the integration point for shared decoded caching.
- Static outdoor assembly now depends on the shared reader instead of a pack-specific API. That keeps static outdoor usable as an independent direct source route and avoids making pack assembly the owner of outdoor semantics.
- Diagnostics remain owned by `LandblockPackAssemblyContext`; the shared reader reports typed `Result`s and does not know pack diagnostic DTOs.

Course corrections:

- Some Phase 3 groundwork landed in Phase 2 because static outdoor generated scenery reads `RegionDesc`, `Scene`, `SetupModel`, and `GfxObj`. Sharing roots without also sharing those generated-scenery reads would have left the most useful source-reader seam split.
- The implementation currently classifies pack source failures from the contextual load error. This preserves the existing diagnostic shape but should become a cleaner typed source error before shared LRU/runtime work hardens the interface.

Refinements for later phases:

- Phase 3 should now focus on making the static outdoor loaded-input/source-reader contract explicit and tested, rather than inventing another loaded-root path.
- Phase 4 should plug shared LRU buckets into `ContentSourceReader` instead of adding another parallel cache surface.
- Phase 10 can revisit cloning cost in `ContentSourceReader` if profiles show large decoded records being cloned enough to matter. `Arc`-backed cached records may be cleaner once cross-pack caching exists.

Potential cleanup targets:

- Replace string/context-based source error classification with a typed source-read/decode error.
- Remove any remaining direct decode helper duplication once direct source routes are migrated to `ContentSourceReader`.
- Revisit whether `LandblockPackAssemblyContext` should remain private or expose a narrow test seam after Phase 4.

Scope:

- Introduce `LandblockPackAssemblyContext` in `holtburger-content`.
- Introduce or extract a shared typed source reader used by both pack assembly and static outdoor assembly.
- Route pack source reads through the context/source reader.
- Preserve loaded decoded roots before deriving facts:
  - `CellLandblock`;
  - `LandblockInfo`;
  - `EnvCell`;
  - `Environment`.
- Cache decoded source records within a single pack build:
  - `CellLandblock`;
  - `LandblockInfo`;
  - `EnvCell`;
  - `Environment`;
  - `RegionDesc`;
  - `Scene`;
  - `SetupModel`;
  - `GfxObj`.
- Add pack-local derived caches where useful:
  - selected setup placements;
  - gfx render bounds;
  - repeated generated-scenery inputs.
- Keep browser DTO projection out of the context.

Implementation notes:

- Cache decoded source records and reusable derived facts, not serialized DTO fragments.
- Facts should be derived from context-held decoded records so later phases can reuse official roots without reloading them.
- Preserve diagnostics that distinguish missing/corrupt source records from intentionally skipped products.
- Keep public API narrow; avoid exposing cache internals just because tests are convenient.
- Do not make static outdoor call pack-specific APIs. Shared source access should sit below both assemblers.

Validation:

- Existing Rust checks/tests for `holtburger-content` and `apps/holtburger-3d/src-tauri`.
- Timing spans show fewer repeated source/decode events inside one pack.
- Unit coverage confirms fact derivation and prepared assembly use the same decoded root records.
- Landblock pack payloads remain behaviorally equivalent.
- Completed validation:
  - `cargo check --manifest-path crates/holtburger-content/Cargo.toml`
  - `cargo fmt --all`
  - `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
  - `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

Exit criteria:

- Pack assembly uses one source access path.
- Obvious repeated reads/decodes inside a single pack are gone or measured.
- Decoded official roots remain available to later pack phases without re-reading DAT resources.

## Phase 3: Static Outdoor Assembly Root Reuse

Status: implemented.

Goal: remove duplicate landblock root loads between full pack assembly and outdoor static scene assembly.

Implemented:

- Kept full pack assembly on the shared `ContentSourceReader` path introduced in Phase 2.
- Added a focused regression test proving pack-triggered static outdoor assembly does not re-fetch `CellLandblock` or `LandblockInfo` from the repository when those roots were already loaded by pack assembly.
- Preserved the standalone static outdoor route by having it instantiate its own operation-scoped source reader.

Decisions:

- Keep `StaticOutdoorSceneAssembler::assemble_landblock_with_source` `pub(crate)` for now. It is the correct internal seam for pack assembly, but it should not become a public content API until Phase 4 decides the shared cache/runtime contract.
- Do not add a separate loaded-root DTO for Phase 3. The shared reader already provides the ownership/lifetime boundary we need, and an extra DTO would mostly duplicate cache state.
- Treat `RegionDesc`, `Scene`, `SetupModel`, and `GfxObj` reuse as part of the same static outdoor path, not a separate generated-scenery optimization. Generated scenery is where static outdoor tends to fan out into those records.

Course corrections:

- Phase 2 already did the structural work for root reuse, so Phase 3 became a proof/hardening slice instead of another refactor.
- The regression test uses minimal valid official root bytes and intentionally omits `RegionDesc`; this isolates the root reuse behavior without requiring full generated-scenery fixture data.

Refinements for later phases:

- Phase 4 should keep the same source-reader entry points and replace the operation-local-only storage with shared typed LRU buckets where appropriate.
- Add source read/decode counters or timing spans if future profiling needs wall-clock confirmation beyond the unit-level read-count proof.
- Consider `Arc`-backed decoded records when shared cache storage lands, but avoid that churn until clone cost is measured.

Potential cleanup targets:

- Revisit the `assemble_landblock_with_source` name after Phase 4; `assemble_landblock_from_source` or a named source-input struct may read cleaner once the cache/runtime shape is final.
- Keep the in-memory counting source local to tests unless more cache behavior needs reusable test fixtures.

Scope:

- Add a loaded-input path to `StaticOutdoorSceneAssembler`.
- Let `LandblockPackAssembler` pass already-decoded `CellLandblock` and `LandblockInfo`.
- Reuse loaded or cached `RegionDesc` through the shared source reader.
- Keep the standalone static outdoor scene/debug route available through the same lower-level implementation.

Implementation notes:

- Avoid compatibility shims that leave two competing assembly paths.
- Make source ownership explicit: the loaded-input path should receive typed decoded records or references with clear lifetimes.
- The current private loaded-input implementation should become the single implementation behind both standalone and pack assembly.
- Keep generated scenery setup/gfx access on the shared reader path so Phase 4 can cache it.

Progress:

- Full pack assembly now calls `StaticOutdoorSceneAssembler` through a shared `ContentSourceReader`, so pack-loaded `CellLandblock`, `LandblockInfo`, `RegionDesc`, `Scene`, `SetupModel`, and `GfxObj` records are reused inside the same pack operation.
- The standalone static outdoor route still instantiates its own reader, preserving the direct source route without a compatibility shim.
- `pack_static_outdoor_assembly_reuses_loaded_landblock_roots` proves pack assembly reads `XXYYFFFF` and `XXYYFFFE` once even though static outdoor assembly also asks for those roots.

Validation:

- Timing/source counters show root records are not decoded twice for one full pack.
- Existing static outdoor scene behavior remains intact.
- Static outdoor route and full pack route produce equivalent outdoor facts for the same landblock roots.
- Completed validation:
  - `cargo test --manifest-path crates/holtburger-content/Cargo.toml landblock_pack::tests::pack_static_outdoor_assembly_reuses_loaded_landblock_roots`
  - `cargo fmt --all`
  - `cargo test --manifest-path crates/holtburger-content/Cargo.toml`
  - `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
  - `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

Exit criteria:

- `CellLandblock`/`LandblockInfo` root decode duplication is removed for pack builds.

## Phase 4: Shared Content Decode Cache

Status: implemented.

Goal: preserve hot decoded source records across pack builds and follow-up asset lookups.

Implemented:

- Added `ContentDecodeCache` in `holtburger-content`.
- Added a pinned cache for `RegionDesc`.
- Added bounded typed LRU buckets for `CellLandblock`, `LandblockInfo`, `EnvCell`, `Environment`, `Scene`, `SetupModel`, and `GfxObj`.
- Wired `ContentSourceReader` to use an optional shared decode cache while keeping its operation-local cache as the first read path.
- Added `LandblockPackAssembler::assemble_landblock_with_cache` so callers can opt into shared decoded caching without breaking existing direct callers.
- Added one shared `Arc<ContentDecodeCache>` to the Tauri host adapter.
- Routed Tauri `landblock-pack/*`, `gfx-obj/*`, and `setup-model/*` lookups through the shared cache.
- Added cache tests for decoded-record reuse and LRU eviction.

Decisions:

- Used an internal typed `Mutex<HashMap + VecDeque>` LRU instead of adding a dependency. The implementation is small, explicit, and avoids inventing dependency versions during this phase.
- Kept buckets typed instead of using a type-erased `Any` cache. This keeps call sites straightforward and avoids downcast failure modes.
- Kept `ContentSourceReader` operation-local caching even when a shared cache is present. The operation-local map prevents repeated cloning/locking inside a single pack build, while the shared cache preserves decoded records across requests.
- Kept cache values clone-returning for now. This preserves simple lifetimes at the cost of possible clone overhead that should be measured before switching to `Arc` records.
- Did not add raw byte caching. Current profiling still points at JSON/materialization and repeated decoded products before raw archive reads.

Course corrections:

- The cache integration required a narrow `ContentRepository::source_description()` accessor so Tauri cached `gfx-obj/*` and `setup-model/*` projections can keep provenance details without re-reading the raw resource.
- The first shared-cache integration covers full packs, gfx objects, and setup models. Other direct source routes still decode directly and should be migrated only where useful instead of forcing every route through the cache in one slice.

Refinements for later phases:

- Phase 5 should reuse the same `Arc<ContentRepository>` plus `Arc<ContentDecodeCache>` pair instead of creating another cache/runtime ownership model.
- Cache capacity tuning should be based on movement/startup profiles. Initial capacities are intentionally conservative but not evidence-backed.
- Add lightweight cache hit/miss counters if Phase 5 or Phase 10 needs proof of reuse under real navigation workloads.
- Revisit whether `ContentSourceReader::with_decode_cache` should remain `pub(crate)` once reusable runtime APIs are introduced.

Potential cleanup targets:

- Deduplicate in-memory counting-source test fixtures if more cache/runtime tests need them.
- Replace string/context-based read-vs-decode error classification with typed source errors before cache/runtime APIs harden.
- Consider extracting the simple LRU into a narrower utility module if more caches use it; keep it private while only `ContentDecodeCache` needs it.

Scope:

- Introduce `ContentDecodeCache` below the Tauri adapter, likely in `holtburger-content`.
- Share it between landblock pack assembly and source/asset routes that decode DAT records:
  - `landblock-pack/*`;
  - `landblock-summary/*`;
  - `gfx-obj/*`;
  - `setup-model/*`;
  - direct source routes such as `indoor-env-cell/*` and `environment/*` where clean.
- Add pinned `RegionDesc`.
- Add bounded LRU buckets for `Scene`, `SetupModel`, `GfxObj`, `CellLandblock`, `LandblockInfo`, `EnvCell`, and `Environment`.

Implementation notes:

- Use size/count-bounded LRU. Do not use TTL.
- Pick conservative initial capacities and adjust from measurements.
- The cache returns decoded records, not DTOs.
- Prefer typed cache buckets for each decoded record family. Avoid a type-erased generic cache unless typed buckets become demonstrably awkward.
- If adding an LRU dependency, add it through the package tool rather than inventing a version number. If dependency churn is not worth it, implement a small typed `Mutex<HashMap + VecDeque>` cache with explicit capacity limits.
- Avoid raw-byte caching in this phase unless timing proves repeated decompression remains dominant.

Validation:

- Decode counters show follow-up `gfx-obj/*` and `setup-model/*` lookups can reuse records decoded during landblock pack construction.
- Startup/navigation timings improve or at least duplicate decode counts fall.
- No unbounded growth under movement across many landblocks.
- Completed validation:
  - `cargo fmt --all`
  - `cargo test --manifest-path crates/holtburger-content/Cargo.toml decode_cache`
  - `cargo test --manifest-path crates/holtburger-content/Cargo.toml`
  - `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
  - `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

Exit criteria:

- Shared decoded source cache exists and is used by at least full pack, gfx object, and setup model paths.

## Phase 5: Reusable Content Asset Runtime

Status: implemented.

Goal: move heavy content jobs behind a reusable runtime with bounded concurrency and in-flight coalescing, without making Tauri own content architecture.

Implemented:

- Added `holtburger_core::content_assets` as the reusable typed runtime boundary.
- Added `ContentAssetRequest` and `ContentAsset` so runtime jobs return Rust-native content products rather than Tauri/browser DTOs.
- Added `ContentAssetService` to own reusable synchronous content loading over shared `Arc<ContentRepository>` and `Arc<ContentDecodeCache>`.
- Added `ContentAssetRuntime` with:
  - bounded background execution using `spawn_blocking`;
  - conservative default concurrency of `2`;
  - in-flight request coalescing keyed by typed `ContentAssetRequest`;
  - boxed large asset variants to avoid large enum value churn.
- Made the Tauri `lookup_asset` command asynchronous.
- Routed content-backed asset ids through the runtime:
  - `landblock-pack/*`;
  - `terrain/*`;
  - `outdoor-static-scene/*`;
  - `indoor-env-cell/*`;
  - `environment/*`;
  - `gfx-obj/*`;
  - `setup-model/*`.
- Kept app-local debug appearance manifests outside the shared runtime because they are not static content assets.
- Moved browser/Tauri JSON projection back into the 3D adapter, so `holtburger-core` stays DTO-agnostic.
- Removed now-dead synchronous adapter payload-loading paths for terrain, outdoor static scene, env cell, environment, gfx object, and setup model. Test-only helpers remain where tests intentionally inspect lower-level fixture discovery.

Decisions:

- Placed the executor/runtime in `holtburger-core`, not `holtburger-content` and not the Tauri adapter. `holtburger-content` remains synchronous static content discovery/decoding; `holtburger-core` owns reusable client execution policy that future client mode can reuse.
- Used one bounded worker pool with no priority classes. The current workload needs non-blocking/coalesced execution more than scheduling policy.
- Kept final IPC serialization at the Tauri command boundary. The runtime returns native Rust products, then the app adapter projects them into the current JSON DTO shape.
- Kept `lookup_asset` fallbacks for app-local debug manifests as adapter-owned behavior. They do not enter the content runtime because they are not DAT/content records.
- Added a blocking helper only for local tests/synchronous callers. Production Tauri lookup uses the async runtime path.

Course corrections:

- Async Tauri commands that borrow state must return `Result`, so `lookup_asset` now clones `HostRuntimeService` before awaiting and returns `Result<AssetLookupResponseDto, String>`.
- Clippy flagged `ContentAsset` as too large; large native products are boxed inside the enum while preserving typed runtime semantics.
- Phase 5 did not move expensive JSON projection into background jobs. That would either push DTO concerns into `holtburger-core` or require a separate app-local projection executor. Keep this as a measured follow-up after Phase 8 binary transport work clarifies how much JSON projection remains.
- The direct source route name `indoor-env-cell/*` remains for compatibility with existing frontend ids. Cleanup should rename this to `env-cell/*` once the frontend route migration is scheduled.

Refinements for later phases:

- Add runtime counters for queue wait time, coalesced waiters, worker duration, and per-request result size before tuning concurrency above `2`.
- Consider a separate app-local projection worker only if profiling shows JSON DTO projection itself still causes a user-visible stall after binary transport.
- Phase 6 added `landblock-summary/*` as a native `ContentAssetRequest` variant first, then projected it in the 3D adapter.
- Phase 8 binary transport should consume the same native runtime results rather than creating a parallel lookup path.

Potential cleanup targets:

- Revisit whether `ContentAssetRuntime::load_blocking` should remain public after tests and non-Tauri diagnostics move to async/native runtime use.
- Convert the test-only outdoor static scene fixture helpers to typed runtime assertions where possible.
- Add focused coalescing tests with instrumentation rather than relying only on implementation review.
- Retire remaining direct `ContentRepository` reads in the Tauri adapter, including runtime residency metadata, once authoritative runtime/world residency uses shared content services.

Scope:

- Introduce a reusable content asset service/runtime facade.
- Make Tauri `lookup_asset` asynchronous and route every asset lookup through the runtime boundary.
- Keep reusable content operations synchronous internally:
  - load/decode source records;
  - assemble `landblock-pack/*`;
  - load/project `gfx-obj/*`;
  - load/project `setup-model/*`;
  - `landblock-summary/*`;
  - existing direct source routes.
- Run asset lookup jobs on a bounded background blocking executor instead of the Tauri command path.
- Have reusable runtime jobs return Rust-native content results, not Tauri/browser DTOs.
- Own/share:
  - `Arc<ContentRepository>`;
  - `Arc<ContentDecodeCache>`;
  - bounded worker/job execution;
  - in-flight job map keyed by typed content request, where the chosen execution model supports it.
- Coalesce duplicate in-flight requests by typed content key, not frontend request id.

Implementation notes:

- Background execution is mandatory for this phase. Do not ship a runtime facade that is still called inline on the Tauri command path.
- The runtime may call synchronous content functions inside worker jobs. Do not make source decoding/assembly async or Tauri-shaped just because the browser app needs non-blocking execution.
- Keep the reusable runtime DTO-agnostic. Browser/Tauri projection remains an app adapter concern.
- Move expensive app-local DTO construction into background jobs where clean, but recognize that final Tauri IPC response serialization still happens at the command boundary. Phase 8 binary transport is still needed to reduce final JSON serialization/materialization costs.
- Use one simple bounded queue/pool first. Do not add priority classes unless real workloads show starvation or responsiveness problems.
- Do not make Tauri own the core content runtime. The Tauri adapter may instantiate and call it, but reusable loading semantics must serve future client mode and diagnostics.
- Do not force async/Tokio into `holtburger-content` just to satisfy the current app. If an async executor is needed, place it deliberately in `holtburger-core`, a dedicated runtime module, or another boundary that matches future client-mode ownership.
- Start with conservative concurrency, likely `2`.
- Tune to `4` only if measurements show scaling without hurting responsiveness.
- Leave cancellation/stale-work preemption as follow-up unless measurements show stale work dominates.
- Tauri adapter should instantiate/use the runtime but not define cache/executor semantics.
- Frontend `AssetLookupGateway` already coalesces duplicate requests by `assetId` within one gateway instance. Treat runtime coalescing as cross-route/future-client infrastructure, not as the only duplicate frontend request fix.

Validation:

- Tauri `lookup_asset` returns through an async command path and does not run decode/assembly inline.
- Runtime jobs return typed Rust-native asset results; app-local projection remains separate from reusable content loading.
- Concurrent identical asset requests share one producer.
- App still returns per-request frontend wrappers/ids correctly.
- Startup/navigation load no longer duplicates identical heavy jobs under bursty request patterns.
- Existing frontend asset-channel coalescing tests remain valid.
- Completed validation:
  - `cargo fmt --all`
  - `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
  - `cargo test --manifest-path crates/holtburger-core/Cargo.toml content_assets`
  - `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml boundary_overview_and_asset_lookup_remain_runtime_asset_split`
  - `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
  - `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

Exit criteria:

- Every asset lookup route enters the runtime/background execution boundary.
- Heavy content loading happens off the Tauri command path.
- Any expensive browser DTO construction that remains before Phase 8 is isolated as app-local projection work, not part of the reusable content runtime contract.
- Tauri command boundary is narrower and adapter-like.

## Phase 6: Landblock Summary Asset

Status: implemented.

Goal: avoid full pack assembly for distant outdoor LoD landblocks.

Browser asset id:

```text
landblock-summary/<XXYYFFFF>
```

Implemented:

- Added `LandblockSummary` and `LandblockSummaryAssembler` in `holtburger-content`.
- Summary assembly reuses the shared root decode/cache path and loads only:
  - `CellLandblock`;
  - `LandblockInfo`.
- Summary payload includes:
  - root `CellLandblockFact`;
  - root `LandblockInfoFact`;
  - prepared terrain mesh;
  - authored `LandblockInfo.objects` references/placements;
  - authored `LandblockInfo.buildings` references/placements;
  - building `num_leaves`;
  - building portal flags, target suffixes, stab lists, and derived linked env-cell ids;
  - cheap root diagnostics.
- Summary payload excludes env-cell enumeration, `Environment` records, generated scenery, setup/gfx expansion, static mesh preparation, spatial items, and BVH.
- Added `ContentAssetRequest::LandblockSummary` / `ContentAsset::LandblockSummary` to the reusable runtime.
- Added Tauri/browser route support for `landblock-summary/*`.
- Added Zod DTO validation and worker normalization for `landblock-summary`.
- Added prepared frontend asset type support and terrain-scene consumption of summary terrain meshes.
- Updated scene coverage planning:
  - bootstrap still requests only the focused full `landblock-pack/*`;
  - streaming requests full packs for focus/building/detail/env-cell interest;
  - streaming requests summaries for terrain-only landblocks;
  - default outdoor terrain radius is now `2`, while building/detail/env-cell radii remain `1`.
- Updated hydration/dependency policy so summaries are direct scene-coverage roots with no graph dependencies.

Decisions:

- Kept summaries rooted in official landblock records, not renderer-only terrain DTOs. The summary is cheap because it avoids child env-cell/environment/static mesh expansion, not because it is terrain-only.
- Included authored object/building references even though the renderer currently only consumes terrain from summaries. This preserves cheap metadata for future distant building placeholders or full-pack upgrade decisions.
- Did not request renderable dependencies from summaries. Loading setup/gfx assets for terrain-only LoD would erase most of the win.
- Kept bootstrap focused on one full pack to avoid starting the app by fanning out a larger terrain summary ring.
- Made summaries independent prepared assets rather than treating full packs as cache hits for summary asset ids. Full packs satisfy rendering needs, but cache aliasing separate asset ids would complicate retention and invalidation.

Course corrections:

- The first frontend policy draft made bootstrap request the distant summary ring. That was too aggressive for startup, so summaries are streaming-only.
- Existing tests named around "landblock pack coverage" now cover mixed full-pack/summary scene coverage. Test names/assertions were updated where the behavior changed.
- Summary object/building placements use the same frontend placement DTO shape as other static facts even though source `LandblockInfo` frames live in a separate Rust type from graphics frames.

Refinements for later phases:

- Decide whether summaries should render cheap authored building placeholders before full packs arrive, or whether terrain-only rendering is enough until full-pack upgrade.
- Consider summary-to-full-pack upgrade policy based on camera distance, building radius, or interaction demand.
- Add summary/full-pack root-fact equivalence tests at the content layer if future refactors touch root fact extraction.
- Measure scene-load fanout again with default terrain radius `2`; the number of requests increases, but the expensive full-pack count should stay bounded to the interactive ring.

Potential cleanup targets:

- Rename request-planner functions that still say `LandblockPackCoverage` even though they now return mixed full-pack and summary coverage requests.
- Reduce duplicated landblock root serialization between pack and summary payloads before Phase 8 binary manifests add another projection path.
- Revisit whether `landblock-summary` should share a normalized frontend terrain mesh adapter with `terrain-landblock` and `landblock-pack` to avoid three terrain-bearing payload shapes.
- Add a single helper for "full pack covers summary needs" so cache retention/eviction policy can avoid retaining redundant summaries beside full packs.

Scope:

- Add a typed Rust static landblock summary product.
- Add browser/Tauri projection for `landblock-summary/*`.
- Include cheap root-record facts:
  - `CellLandblockFact`;
  - prepared terrain mesh or terrain chunk payload;
  - `LandblockInfoFact`;
  - outdoor/dungeon classification;
  - explicit object references/placements from `LandblockInfo.objects`;
  - building references, placements, `num_leaves`, and portal/link metadata from `LandblockInfo.buildings`;
  - cheap root diagnostics.
- Exclude:
  - env cell enumeration/decode;
  - `Environment` records;
  - prepared structured interiors;
  - indoor static objects;
  - generated scenery initially;
  - static mesh part expansion;
  - gfx/setup bounds;
  - full spatial items and BVH.

Implementation notes:

- A full pack can satisfy summary needs via shared terrain/building-fact extraction helpers.
- A cached summary can upgrade to a full pack when the landblock moves into an interactive ring.
- Do not call it `terrain-landblock/*`; the asset is a cheap official-root summary, not a renderer slice.
- This phase includes frontend scheduler/cache/render-policy integration. The Rust route alone will not reduce default scene-load pressure until the planner requests summaries for distant landblocks.

Validation:

- Far terrain ring can request summaries without requiring full packs.
- Full pack and summary agree on root facts and terrain output.
- Timing shows fewer full pack builds during default outdoor scene load once frontend policy uses summaries.
- Completed validation:
  - `cargo fmt --all`
  - `cargo test --manifest-path crates/holtburger-content/Cargo.toml`
  - `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
  - `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`
  - `npm run --prefix apps/holtburger-3d check`
  - `npm run --prefix apps/holtburger-3d test:ts`

Exit criteria:

- Summary route exists and can be consumed by the frontend for distant outdoor terrain/building facts.

## Phase 6.1: Summary Building Hydration

Goal: render exterior building visuals from `landblock-summary/*` plus independent renderable assets, without promoting every building-distance landblock to a full `landblock-pack/*`.

Scope:

- Keep `landblock-pack/*` for focus/detail/env-cell/full spatial coverage.
- Change building-distance coverage so building-radius landblocks can be satisfied by `landblock-summary/*` instead of full packs when no other full-pack interest applies.
- Derive building renderable dependency requests from prepared summaries:
  - `sourceAssetId` from summary buildings;
  - `setup-model/*` and `gfx-obj/*` dependencies through the existing graph hydration path.
- Add a frontend render-preparation path that expands prepared summary buildings into exterior static render work using fetched renderable assets.
- Render summary building instances at their summary placements.
- Preserve full-pack building rendering for landblocks that are already loaded as full packs.
- Ensure a full pack supersedes any summary building render work for the same landblock to avoid duplicate buildings.

Out of scope:

- Summary object/detail rendering from `LandblockInfo.objects`.
- Generated outdoor scenery.
- Building interiors, env-cell residency, portal traversal, or structured cell coverage.
- Full pack spatial items, BVH, ray-pick parity, or occlusion behavior for summary buildings.
- Removing the browser building-distance slider.

Implementation notes:

- Treat summary building visuals as exterior renderables only.
- Do not request renderable dependencies for every summary. Only request building assets for summaries selected by building-distance policy.
- Keep the summary dependency list cheap and explicit; use a planner-side dependency derivation for selected summary buildings rather than making every summary graph-hydrate by default.
- Prefer reusing existing static renderable instancing/material paths, but keep summary-origin instance identity separate from full-pack instance identity.
- If a summary building source is unsupported or missing, skip that building with diagnostics rather than promoting the landblock to a full pack.

Validation:

- A building-distance landblock outside detail/env-cell coverage requests `landblock-summary/*`, not `landblock-pack/*`.
- Prepared summaries inside building radius produce renderable asset requests for building `sourceAssetId`s.
- Summary building instances render once their `setup-model/*` or `gfx-obj/*` payloads are prepared.
- Loading a full pack for the same landblock removes/replaces summary building instances, preventing duplicate exterior buildings.
- Existing full-pack building rendering remains unchanged.

Exit criteria:

- Building-distance coverage can show exterior authored buildings without full pack assembly for those landblocks.

Progress:

- Implemented in `apps/holtburger-3d`:
  - building-radius landblocks are now satisfied by `landblock-summary/*` unless focus/detail/env-cell coverage requires a full `landblock-pack/*`;
  - selected prepared summaries produce demand-driven renderable source requests for building `sourceAssetId` values;
  - summary building render work reuses the existing static renderable scene model and instanced mesh path;
  - full packs supersede summary building render work for the same landblock to prevent duplicate exterior buildings.
- Added focused TypeScript coverage for planner behavior, summary building hydration, and full-pack superseding.

Decisions:

- Kept summary dependency extraction out of default asset graph hydration. Summary building renderables are requested only when the current outdoor building-distance policy selects that landblock.
- Reused the existing static renderable render-domain/chunk grouping path rather than adding a second summary-specific renderer.
- Treated summary building instances as exterior-only renderables with no interior residency, portal traversal, picking, or BVH parity.

Course corrections:

- Building interest no longer contributes to full-pack coverage. Full-pack coverage is now focus/detail/env-cell driven; building interest contributes to summary coverage unless the same landblock is already covered by a full pack.
- Summary setup-model expansion currently uses the setup model part list and part scale available in prepared frontend assets. It does not reconstruct Rust-prepared full-pack static mesh bounds or richer setup placement transforms for summary buildings.

Refinements for later phases:

- Consider moving summary building expansion into Rust if we need exact parity with full-pack prepared static meshes, source bounds, or future summary spatial/BVH work.
- Add cache retention behavior that drops redundant summary assets when a full pack for the same landblock is prepared.
- Revisit the browser building-distance slider once summary building hydration has been exercised in real scenes; it may remain useful as an exterior-building radius rather than a full-pack radius.

Potential cleanup targets:

- Rename mixed scene-coverage request planner APIs that still say `LandblockPackCoverage`.
- Consolidate duplicated summary building test fixtures and static renderable asset fixtures.
- Tighten `PreparedLandblockSummaryBuilding.sourceAssetId`; renderable buildings should not expose nullable source asset ids if unsupported sources are filtered before the DTO.
- Revisit summary setup-model expansion naming so it does not imply full full-pack static mesh parity.

## Phase 7: Dungeon Outdoor-Work Skip

Goal: avoid outdoor generated-scene/static work for root facts that prove a landblock is a dungeon.

Scope:

- Classify from loaded root facts.
- Skip outdoor static scene assembly only when classification is proven dungeon.
- Preserve conservative behavior for missing, corrupt, or ambiguous roots.
- Implement after Phase 2/3 have made decoded roots and static outdoor dispatch explicit. This phase does not need to wait for summary or binary transport work.

Current safe dungeon rule:

- `CellLandblockFact.all_heights_zero`.
- `LandblockInfo.numEnvCells > 0`.
- `LandblockInfo.buildingCount == 0`.

Implementation notes:

- Record the decision in diagnostics so absent outdoor facts are intentional.
- Do not infer dungeon from asset name or request path.

Validation:

- Dungeon packs no longer spend time in outdoor generated-scenery assembly.
- Outdoor packs remain unchanged.
- Ambiguous or corrupt roots do not silently skip outdoor work.

Exit criteria:

- Proven dungeon packs avoid outdoor-only work.

## Phase 8: Binary Landblock Pack Bulk Arrays

Goal: remove the dominant JSON materialization cost for large prepared numeric arrays in full landblock packs.

Scope:

- Add a self-contained binary envelope for high-volume `landblock-pack/*` prepared arrays:

```text
[fixed header]
[manifest JSON bytes]
[binary sections]
```

- Fixed header includes:
  - magic/version;
  - manifest byte length;
  - total byte length or equivalent validation data;
  - alignment/padding convention for typed-array views.
- Manifest JSON is Zod-validatable after UTF-8 decode and describes each section by:
  - semantic role;
  - scalar type;
  - component count;
  - byte offset;
  - element count;
  - byte length;
  - ordering/identity linkage where needed.
- Add a binary response command, likely `lookup_asset_binary`, returning `tauri::ipc::Response`.
- Normalize JSON and binary transports behind one frontend `lookupAsset(...)` abstraction.
- Keep dependency metadata available to the frontend scheduler. Either include dependencies in the manifest or normalize them into the same app-level response shape before dependency derivation runs.

First binary sections:

- `prepared.terrainMesh.vertices`.
- `prepared.terrainMesh.triangles`.
- `prepared.interiorCells[].renderGeometry.positions`.
- `prepared.interiorCells[].renderGeometry.normals`.
- `prepared.interiorCells[].renderGeometry.uvs`.
- `prepared.interiorCells[].renderGeometry.triangles`, if the fixed fields encode cleanly.
- `prepared.interiorCells[].portalApertures[].points`.
- `prepared.spatialItems[].bounds`, if identity/order remains clear.
- `prepared.staticLandblockBvh.nodes`.

Remain JSON in the first pass:

- static instances and static mesh object graphs;
- source facts;
- diagnostics;
- dependency lists;
- ids and strings;
- nullable owner/source fields;
- placement objects;
- variant-heavy metadata.

Implementation notes:

- Binary transport is an adapter projection over typed Rust products, not the native runtime representation.
- Keep normal JSON `lookup_asset` for small/debug/control assets.
- Avoid broad BSON-like replacement; the problem is dense numeric arrays, not every object graph.
- Do not rely on `AssetPayloadKindDto::Bytes` alone. The current response DTO still stores `payload` as JSON, so the binary path needs an explicit command/contract and frontend decoder.
- The asset worker should receive a normalized prepared payload shape so renderer code does not branch on transport details.

Validation:

- Compare payload byte size, Rust projection/serialization timing, WebKit/JSC CPU profile, and startup/navigation stall before/after.
- Frontend validates manifest ranges/alignment before constructing typed views.
- Existing renderer behavior remains equivalent.
- Asset dependency scheduling remains correct for binary landblock packs.

Exit criteria:

- Full landblock packs can carry bulk prepared numeric arrays through binary sections.
- Profiling shows reduced Rust JSON work and reduced WebKit/JSC materialization work.

## Phase 9: DTO Trimming And Contract Tightening

Goal: remove large or legacy browser DTO fields and optional-field ambiguity after binary and summary paths clarify real contracts.

Scope:

- Inventory frontend consumption of `sourceFacts`.
- Current known runtime direct use: `sourceFacts.outdoor.buildings`.
- Terrain, interiors, static rendering, and spatial work consume `prepared.*`.
- Trim or split browser DTO fields that are not runtime-consumed and are not needed for active diagnostics.
- Tighten DTO optionality where fields are required in practice.

Implementation notes:

- Do not remove useful typed Rust source facts just because the current frontend does not serialize/consume them.
- Distinguish runtime content model from browser DTO projection.
- Keep direct source routes explicit instead of carrying raw-ish fields in every full pack.

Validation:

- TypeScript contracts get simpler, not more nullable.
- Renderer and debug panels continue to receive required data.
- Payload size drops or remains stable after binary migration.

Exit criteria:

- Browser DTOs represent actual browser needs instead of historical migration shape.

## Phase 10: Rust-Side Assembly Hotspot Follow-Up

Goal: optimize secondary Rust hotspots only after payload and cache/runtime phases settle.

Candidate hotspots:

- `build_prepared_static_meshes` grouping/sorting.
- `build_polygon_set_render_geometry`.
- Residual `ZSTD_decompress*` or `read_entry_at` if decoded cache does not remove enough repeated source work.

Scope:

- Use Phase 1 timing spans plus updated `perf` captures.
- Optimize only hotspots that remain consequential after binary transport and decode caching.

Possible directions:

- Reduce repeated sorting or sort large values by lighter keys/indices.
- Avoid copying large `PreparedStaticMesh` values during ordering.
- Precompute or cache polygon vertex lookup facts inside the assembly context.
- Revisit raw-byte caching only if decompression/archive reads still matter.

Validation:

- Before/after timings for the specific hotspot.
- Existing pack payload equivalence.
- No broad refactor without measured payoff.

Exit criteria:

- Secondary Rust hotspots are either improved or explicitly deprioritized with measurements.

## Phase 11: Cleanup Legacy Smells And Migration Scaffolding

Status: running cleanup punch list. Add to it whenever a phase leaves behind a temporary adapter, naming mismatch, duplicated helper, compatibility shim, optional-field workaround, or migration-only abstraction.

Goal: remove legacy smells created during migration and leave one coherent content-loading path after the cache/runtime/binary/summary work lands.

Initial cleanup targets:

- Remove legacy landblock/env-cell discovery paths that are no longer needed after root-based pack/summary loading.
- Keep lower-level direct source routes explicit if they remain useful, but stop presenting them as normal scene-loading concepts.
- Rename the direct `indoor-env-cell/*` source route to `env-cell/*` once normal scene loading no longer depends on the migration-era name. Dungeon env cells and outdoor-linked interior env cells are the same official env-cell record family; `indoor` is app-era terminology, not an official asset distinction.
- Remove compatibility shims or duplicate route helpers introduced only for transition.
- Consolidate naming around `landblock`, `landblock-pack`, and `landblock-summary`; avoid indoor/outdoor assumptions in asset ids unless the payload is actually classification-specific.
- Tighten contracts/interfaces where optional fields are not optional in practice.
- Audit `null`, `undefined`, optional properties, `unknown[]`, broad unions, and "maybe present" DTO fields after each migration slice. Split types when only some variants genuinely allow absence.
- Remove stale diagnostics that the renderer can compute locally.
- Collapse duplicated fixture/build helper logic once binary and JSON paths share normalized frontend assets.
- Delete dead code after frontend uses summary/binary/runtime paths.
- Remove duplicated source helper functions once the shared typed source reader is established.
- Fix minor code smells found during dry run, including duplicate portal id deduplication and missing-source diagnostic suppression that can collide across setup-model and gfx-object roles.
- Retire legacy `payloadKind: "bytes"` dead-end assumptions after the real binary command contract exists.
- Replace Phase 2's contextual/string-based source error classification with typed read/decode errors before the source reader becomes a shared runtime contract.
- Audit `ContentSourceReader` clone-returning APIs after Phase 4; keep them if they remain cheap enough, or move cached decoded records to `Arc` when shared LRU storage lands.
- Tune `ContentDecodeCache` bucket capacities from measured navigation/startup workloads instead of keeping Phase 4's conservative guesses forever.
- Add cache hit/miss counters if profiling cannot otherwise prove that shared decoded caching is paying for itself.
- Revisit `StaticOutdoorSceneAssembler::assemble_landblock_with_source` naming/API shape after Phase 4 decides whether the shared cache is source-reader-owned or injected from a higher runtime.
- Remove or rename cache/runtime helper names that are pack-specific after they become shared by summaries, gfx/setup routes, diagnostics, or future client mode.
- Revisit `ContentAssetRuntime` and `LandblockPackAssemblyContext` public surface area after Phase 5 so implementation-only cache/executor details do not leak.
- Revisit Phase 5's boxed `ContentAsset` variants once binary transport and summary assets clarify whether native products should move as `Arc` handles instead of cloned boxed values.
- Decide whether app-local JSON projection needs its own bounded background worker after Phase 8; do not move DTO projection into `holtburger-core`.
- Replace remaining Tauri adapter direct content reads used for residency metadata with a typed shared content/runtime path once world/client-mode residency owns that data.
- Add runtime instrumentation for coalesced request count, queue wait, worker time, and projection time before tuning worker concurrency.
- Audit and reduce excessive visibility after each phase. Downgrade `pub`/`pub(crate)` items that only exist for migration wiring or tests once the final ownership boundary is clear.
- Consolidate Rust and TypeScript landblock id/env-cell enumeration helpers into one canonical helper per side.
- Remove redundant prepared terrain/interior/static JSON serializers once binary normalization becomes the primary pack path, or move shared projection helpers out of the Tauri adapter if the adapter keeps accumulating serializer weight.
- Remove binary/JSON dual-path test scaffolding once the normalized frontend asset shape is stable.
- Revisit frontend asset dependency derivation after binary manifests land so dependency extraction is not split between incompatible JSON and binary conventions.
- Remove summary/full-pack upgrade shims once distance-ring request policy has a single normal path.
- Rename mixed scene-coverage request planner APIs that still say `LandblockPackCoverage` after Phase 6 introduced `landblock-summary/*` coverage.
- Consolidate terrain-bearing frontend payload handling across `terrain-landblock`, `landblock-pack`, and `landblock-summary`.
- Add cache-retention rules that can drop redundant summaries when a full pack for the same landblock is prepared.
- Revisit summary authored object/building facts after distant building placeholder rendering lands; keep them cheap or remove fields the renderer never uses.
- After Phase 6.1, revisit whether the browser building-distance slider should remain user-facing or become a derived internal full-pack/summary-building policy.
- Tighten summary building DTO contracts so renderable building records do not carry nullable `sourceAssetId` values after unsupported sources have already been filtered or represented as a distinct variant.
- Revisit summary setup-model expansion after real-scene validation; if placement or bounds parity matters, move that transformation into the Rust loader beside full-pack static mesh preparation.
- Retire stale profiling/timing scaffolding that was useful for this optimization campaign but is too noisy for day-to-day development.
- Re-check crate boundaries after runtime work lands: content should own static content discovery/decoding, core/runtime should own reusable client execution policy if that split proves cleaner, and the Tauri adapter should remain projection/glue.

Implemented cleanup slices:

- Phase 5 removed dead synchronous adapter payload loaders that were superseded by the typed runtime path.
- Phase 5 removed the redundant adapter-owned decode-cache field; cache ownership now flows through the shared content asset runtime/service.

Decisions:

- Cleanup is an explicit final phase, not an invitation to leave known debt untracked. If a phase creates a temporary shim or misleading name, add it to this punch list immediately.
- Compatibility with migration-era tests is not a reason to keep stale abstractions. Update tests to describe the intended pack/cache/runtime behavior.

Course corrections:

- The initial dry run found this plan needs a running cleanup punch list like the original landblock pack plan. Phase 11 now owns that list.

Validation:

- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`.
- Relevant `holtburger-content` tests/checks.
- `npm run --prefix apps/holtburger-3d check`.
- Targeted frontend tests for asset channel, landblock pack preparation, and static renderables.

## Suggested Phase Order

1. Phase 2: Typed pack assembly context.
2. Phase 3: Static outdoor root reuse.
3. Phase 7: Dungeon outdoor-work skip.
4. Phase 4: Shared content decode cache.
5. Phase 5: Reusable content asset runtime with coalescing.
6. Phase 8: Binary landblock pack bulk arrays.
7. Phase 6: Landblock summary asset.
8. Phase 6.1: Summary building hydration.
9. Phase 9: DTO trimming and contract tightening.
10. Phase 10: Rust-side assembly hotspot follow-up.
11. Phase 11: Cleanup legacy smells and migration scaffolding.

Phase 1 can be added opportunistically whenever a phase needs wall-clock clarity, but it is not the starting point.

Rationale for this order:

- Assembly context and root reuse reduce local waste and make shared cache integration cleaner.
- Dungeon skipping is small and becomes clean immediately after root/classification flow is explicit.
- Shared cache and runtime/coalescing prevent multithreading from multiplying duplicate decode work.
- Binary transport is high priority from profiling, but it benefits from typed runtime/projection boundaries being clearer first.
- Summary assets reduce far-ring full-pack pressure after the full-pack path is better structured.
- Summary assets are scheduled after binary/cache/runtime because they require frontend planner policy, not just a Rust route.
- Summary building hydration follows summaries so the building-distance slider controls visible exterior buildings without forcing full-pack promotion.
- Existing `perf` data is strong enough to justify starting with assembly/cache structure. Add Phase 1 timing only when a later decision needs wall-clock evidence.

## Validation Matrix

Run targeted validation after each phase:

- Rust compile/check:
  - `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
  - `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`
- Frontend:
  - `npm run --prefix apps/holtburger-3d check`
  - targeted `vitest` suites for asset channel and renderer preparation.
- Profiling:
  - `npm run --prefix apps/holtburger-3d profile`
  - compare `.perf.script` whole-process and Rust-host-only reports.
- Runtime smoke:
  - startup outdoor scene load;
  - navigation far enough to load new landblocks;
  - dense outdoor town;
  - dungeon with many env cells;
  - outdoor building/interior transition.

## Open Questions

- Whether summary terrain should initially reuse full prepared terrain shape or introduce a smaller terrain chunk DTO immediately.
- Exact binary command shape and whether dependencies live in the manifest or normalized response metadata.
- Whether spatial item bounds belong in the first binary phase if preserving item identity/order makes the manifest too awkward.
- Whether static mesh object graphs become large enough to justify a later binary or table-oriented representation.
- Whether cancellation/stale-work preemption is needed once runtime coalescing and summaries are in place.
