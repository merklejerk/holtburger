# HBA V2 Namespace Archive Plan

## Context And Boundaries

### Goal
Replace the current scope-split HBA distribution model with a single namespace-aware HBA v2 artifact that can carry multiple retail DAT domains plus custom derived assets without ID collisions.

### In Scope
- Define an HBA v2 entry model that adds a fixed-width namespace label while retaining `file_id`, `type_id`, and current blob storage semantics.
- Replace `ResourceScope`-centric lookup with namespace-aware lookup in shared archive/provider code.
- Extend `dat2hba` to ingest multiple retail DAT inputs into one output archive under explicit namespaces such as `eor/portal` and `eor/cell`.
- Preserve current pruning/profile behavior where it still makes sense, but move selection logic onto namespaced inputs instead of assuming one DAT per output artifact.
- Reserve a custom logical file type for derived assets that do not map to a retail DAT class.
- Update HBA docs, CLI help, and migration notes for the breaking format change.
- Add tests and focused verification for archive round-trip, lookup semantics, duplicate handling, and multi-DAT packing.

### Out Of Scope
- Changing retail DAT decoding rules or ACE-derived file semantics.
- Designing the full custom asset pipeline beyond the archive/type seams required to store and retrieve custom assets.
- Collapsing all mounted asset domains into an anonymous bag with no namespace semantics.
- Preserving backward compatibility with the current HBA v1 format in-place. Compatibility may be handled by explicit migration tooling, not by pretending the formats are interchangeable.
- Optimizing for speculative million-entry archive scales before we have measurements showing the simpler design is insufficient.

## Ground Truth And Existing Patterns

### Reference Sources
- Current HBA format spec in [docs/hba_format.md](/home/cluracan/code/holtburger/docs/hba_format.md)
- Current HBA reader/writer implementation in [crates/holtburger-dat/src/archive.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/archive.rs)
- Current provider and scoped resolver abstractions in [crates/holtburger-dat/src/lib.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/lib.rs)
- Current DAT type classification in [crates/holtburger-dat/src/file_type/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/mod.rs)
- Current strip manifest shape in [crates/holtburger-dat/src/manifest.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/manifest.rs)
- Current `dat2hba` flow in [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs)
- Current `dat-tool` HBA pack/open behavior in [apps/holtburger-tools/src/bin/dat-tool.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/bin/dat-tool.rs)
- Current client bootstrap expectations around mounted dataset roles in [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs)

### Existing Patterns To Follow
- Keep `holtburger-dat` focused on static data access, archive format, and provider concerns only.
- Keep runtime orchestration and mounted-dataset policy in `holtburger-core`, not in CLI-specific code.
- Preserve lossless representations in shared crates so the future 3D client is not boxed in by current TUI assumptions.
- Prefer explicit mounted-domain semantics over filename magic.
- Keep archive lookup deterministic and inspectable on disk.

## Dry-Run Findings Against The Current Codebase

### The Current Static Resource Helpers Bake Portal Scope Into File Decoders
`SkillTable`, `SpellTable`, and `XpTable` implement `ScopedResource` directly in their parser modules, which hardcodes `ResourceScope::Portal` into types that should really just describe retail file contents. That is an awkward seam because the namespace migration is not merely a resolver change; it also requires moving static asset-key declarations out of the decoder modules and into a namespaced key abstraction that callers can consume without dragging `portal` policy through every parser file.

### The Provider Abstraction Is Raw-ID-Centric And Shared By DAT And HBA
`ResourceProvider` currently exposes only `get_file(id)` and `get_metadata(id)`, which is a natural fit for `DatDatabase` and HBA v1 but not for a multi-namespace HBA v2. Forcing every provider to become natively multi-namespace would make `DatDatabase` awkward. The cleaner seam is to introduce a namespaced lookup abstraction for callers and resolver code while still allowing single-namespace mounted sources and adapters under the hood.

### Client Bootstrap Still Probes Legacy Paths Instead Of Discovering Archive Namespaces
`ClientBuilder` currently probes `portal` and `cell` paths through `open_provider`, then mounts them under hardcoded `ResourceScope` values. A single namespaced HBA artifact does not fit that discovery model. The plan must include a new archive-opening/bootstrap path rather than assuming the current path probe can be massaged into the new model.

### Tooling And Inspection Currently Assume HBA Is ID-Only
`dat-tool` lists HBA contents by `id`, calls `find_entry(id)`, and displays type information using `DatFileType::from_id(id)` instead of the stored HBA `type_id`. That is already lossy for HBA and becomes outright wrong once custom assets exist. The CLI migration is not optional polish; it is part of making the new format usable.

### Test Churn Will Be Real And Should Be Planned As First-Class Work
Core and world tests create synthetic HBAs with `HbaWriter::add(id, type_id, data)` and mount them under `ResourceScope::Portal`. Many tests also assume repo-local `portal.hba` fixtures by filename. This is manageable, but it means the migration has a broad test-helper seam that should be treated as part of the runtime migration phase rather than as incidental cleanup.

### Per-Namespace LUTs Fit The Codebase Better Than Hash-Sorted Global Lookup
The current archive and resolver logic already separate concerns into lookup first, blob read second. Extending that to a namespace lookup table plus file-ID search inside a namespace-local partition is mechanically compatible with the existing style and avoids introducing hash ordering or opaque key material where the rest of the codebase expects inspectable deterministic structures.

## Recommended Architecture

### Core Archive Identity
Use the tuple `(namespace, file_id)` as the authoritative lookup key for HBA v2.

- `namespace`: `char[32]`, case-sensitive, zero-padded on disk, treated as an opaque label rather than a hierarchical path type.
- `file_id`: retained as `u32` so retail identity is preserved and existing content decoders do not lose the original ID semantics.
- `type_id`: retained as `u32` metadata. Retail assets continue to use their logical DAT type, and custom derived assets use a reserved custom type value.

### On-Disk Ordering
Sort entries lexicographically by serialized namespace bytes and then by `file_id`.

Rationale:
- deterministic and collision-free without introducing hash semantics into the canonical index order
- easy to inspect and reason about in tooling and debug output
- cheap enough at the expected archive sizes because lookup remains `O(log n)` and comparisons operate on fixed-width keys

Build namespace-partitioned lookup tables into HBA v2 from the start so a request first resolves the namespace and then performs file-ID lookup inside that namespace-local partition. Do not make a hash-derived order the primary identity unless measurement later justifies the extra complexity.

### Namespace Model
Initial reserved namespace labels:
- `eor/portal`
- `eor/cell`
- `derived/*` for Holtburger-generated artifacts

Namespace labels are not interpreted by the archive format itself. Runtime code may assign semantic meaning to specific labels, but the archive remains a generic namespaced blob container.

### Custom Asset Support
Reserve a `DatFileType::Custom` logical type to identify non-retail assets stored in HBA v2. Do not overload retail ranges for derived assets. New derived formats should start life under `Custom` and only graduate to more specific logical types if they prove stable and broadly useful.

### Migration Principle
Break the format deliberately and migrate the runtime/tooling in a controlled sequence:
- archive format and namespaced lookup seam first
- tooling and custom-asset support second
- runtime/bootstrap and consumer migration third
- docs, migration tooling, and benchmarks last

## Phased Implementation

### Phase 1: Land HBA V2 And The Namespaced Lookup Seam

#### Deliverables
- Update [docs/hba_format.md](/home/cluracan/code/holtburger/docs/hba_format.md) to describe HBA v2 header/versioning, namespaced entries, and canonical sort order.
- Refactor [crates/holtburger-dat/src/archive.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/archive.rs) so `HbaEntry` includes namespace bytes, retained `file_id`, retained `type_id`, and an updated fixed entry size.
- Replace ID-only binary search with namespace-partitioned lookup in `HbaReader`: resolve the namespace's lookup table or entry span first, then binary-search `file_id` within that namespace.
- Update writer duplicate detection from `id` to `(namespace, file_id)`.
- Add archive-level helpers for namespace serialization, validation, and comparison.
- Add namespaced lookup-table support to the reader/writer so namespace resolution is first-class in the archive format rather than a deferred optimization.
- Refactor [crates/holtburger-dat/src/lib.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/lib.rs) to introduce the namespaced key and resolver abstractions that callers will use.
- Replace `ScopedResource` with a namespace-aware static asset-key pattern so parser modules stop hardcoding `portal` scope.

#### Acceptance Criteria
- The HBA reader rejects invalid namespace encoding and malformed entry sizes cleanly.
- The HBA writer emits a deterministic index sorted by namespace then file ID.
- The HBA reader can resolve a namespace to its lookup table or entry span without scanning the full archive for every request.
- Archive round-trip tests prove multiple namespaces can safely contain the same `file_id`.
- Shared callers can request a namespace-qualified asset without going through `ResourceScope`.

### Phase 2: Update Tooling And Custom Asset Support

#### Deliverables
- Refactor [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs) so it accepts multiple DAT inputs, each paired with an explicit namespace label.
- Preserve current profile/manifests, but evaluate inclusion per input namespace rather than assuming one source DAT.
- Emit one HBA containing all selected inputs under their declared namespaces.
- Extend [crates/holtburger-dat/src/file_type/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/mod.rs) with `DatFileType::Custom` for HBA-only assets.
- Refactor [crates/holtburger-dat/src/manifest.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/manifest.rs) so manifests can target namespace-qualified content and custom assets where needed.
- Update [apps/holtburger-tools/src/bin/dat-tool.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/bin/dat-tool.rs) to inspect, export, and display namespace-qualified entries and to use stored `type_id` for HBA metadata instead of recomputing type from `file_id`.

#### Acceptance Criteria
- The tool can ingest at least portal and cell DATs in one invocation and produce one HBA.
- Duplicate `file_id` values across input DATs no longer collide as long as namespaces differ.
- Custom entries can coexist with retail entries and are inspectable through CLI tooling without lossy type reporting.
- Existing pruning/micro-style selection still works when applied to the relevant namespaced input.

### Phase 3: Migrate Runtime, World, And Tests To Namespace Policy

#### Deliverables
- Refactor [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) to open and validate a single namespaced archive artifact instead of probing `portal` and `cell` paths.
- Refactor [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs), [crates/holtburger-world/src/state/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/motion_table.rs), and related callers to use namespace-qualified asset keys.
- Update builder/world/core test helpers that currently create mini HBAs and mount them under `ResourceScope::Portal`.
- Replace repo-local `portal.hba` filename assumptions in tests with namespaced combined-archive fixtures or helper builders.
- Preserve explicit runtime requirements by namespace, for example the current gameplay tables under `eor/portal`.

#### Acceptance Criteria
- Runtime startup can load a single HBA artifact and resolve portal and cell content by namespace.
- Missing namespace or required-asset diagnostics name the actual missing namespace-qualified asset.
- World and core tests no longer depend on `ResourceScope` or hardcoded `portal.hba` naming conventions.

### Phase 4: Documentation, Migration Tooling, Benchmarks, And Final Verification

#### Deliverables
- Update user-facing docs in [README.md](/home/cluracan/code/holtburger/README.md), [dats/README.md](/home/cluracan/code/holtburger/dats/README.md), and [docs/hba_format.md](/home/cluracan/code/holtburger/docs/hba_format.md) to describe the single-artifact namespaced model.
- Add or update migration tooling to re-pack current assets into HBA v2 instead of trying to open HBA v1 transparently.
- Add focused benchmarks for namespaced archive lookup and list operations so the compare-cost concern is measured instead of debated.
- Record verification output for the new CLI flow and runtime startup against a combined archive fixture.

#### Acceptance Criteria
- Docs describe the namespace format, reserved labels, and custom asset support clearly.
- A maintainer can generate and consume the new single-archive artifact using documented commands.
- Benchmark data exists for lookup performance on representative archive sizes.

## Risks And Mitigations

### Risk: Namespace Comparison Cost Becomes A Real Hot Path
Mitigation:
- Start with fixed-width namespace bytes and lexicographic ordering.
- Add microbenchmarks before introducing hash-derived ordering.
- Keep namespace-partitioned lookup tables as the default acceleration strategy.

### Risk: Shared API Churn Ripples Through Too Many Callers At Once
Mitigation:
- Land the archive/key abstractions and static asset-key replacements together so callers are not left between `ResourceScope` and namespace models.
- Prefer a deliberate cutover in callers over a long-lived dual API surface.
- Keep crate responsibilities clean: generic lookup in `holtburger-dat`, runtime namespace policy in `holtburger-core`.

### Risk: HBA V2 Leaks Multi-Namespace Complexity Into `DatDatabase`
Mitigation:
- Keep single-DAT sources mountable under one declared namespace rather than forcing `DatDatabase` itself to become a multi-namespace store.
- Let the namespaced resolver and HBA v2 reader provide the multi-namespace surface callers need.

### Risk: CLI And Debugging Become Worse During The Transition
Mitigation:
- Treat CLI inspection and export as part of the core migration, not as optional polish.
- Display stored `type_id`, namespace, and namespaced key explicitly for HBA entries.
- Keep archive ordering inspectable rather than hash-derived.

### Risk: Manifest Logic Becomes Confusing Across Retail And Custom Assets
Mitigation:
- Keep manifest rules explicit about whether they target namespace, type, exact file ID, or exact namespaced asset.
- Avoid magic fallback behavior for custom assets.

### Risk: Single-Artifact Packaging Hides Missing Namespace Errors
Mitigation:
- Make CLI inspection output show namespace distributions and counts.
- Make runtime diagnostics report the missing namespace-qualified key directly.

### Risk: Breaking Format Change Leaves Existing Local Bundles Stranded
Mitigation:
- Provide an explicit repack/migration path.
- Version the format clearly in docs and code.
- Do not silently attempt to interpret HBA v1 as HBA v2.

## Definition Of Done

- HBA v2 is documented with a stable entry layout and canonical ordering.
- Archive tests cover duplicate retail IDs across namespaces, custom asset storage, and namespaced binary search.
- `dat2hba` can emit one archive from multiple DAT inputs under explicit namespaces.
- Runtime/provider code can resolve namespace-qualified assets without `ResourceScope`.
- Current required portal gameplay assets can be loaded from a combined archive under the expected namespace.
- CLI/docs explain how to build, inspect, and consume the new archive format.
- Lookup performance has been measured on representative archive sizes.
- `cargo test` for touched crates passes and any new benchmark commands are documented.

## Living Worksheet

### Task Checklist
- [ ] Phase 1: Land HBA v2 and the namespaced lookup seam
- [ ] Phase 2: Update tooling and custom asset support
- [ ] Phase 3: Migrate runtime, world, and tests to namespace policy
- [ ] Phase 4: Documentation, migration tooling, benchmarks, and final verification

### Decisions Log
- Canonical key: `(namespace, file_id)`
- Namespace serialization: fixed 32-byte case-sensitive zero-padded label
- Canonical index order: namespace bytes, then file ID
- `type_id` stays as metadata; custom assets start under `DatFileType::Custom`
- Format compatibility: explicit breaking change, not transparent in-place compatibility
- Consumer migration: update all consumers to use namespaced keys directly rather than preserving a long-lived scope compatibility layer

### Verification Log
- Pending implementation.

### Open Questions
- None at the plan level. Archive-format details should assume namespaced lookup tables are part of HBA v2 from the start.