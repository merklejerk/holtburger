# Micro HBA And World Collision Plan

## Context And Boundaries

### Goal
Add a TUI-oriented micro DAT bundle that contains only the portal tables the current TUI actually needs, while removing automatic geometry-backed collision handling from `holtburger-world` until a future 3D client defines the right semantics.

### In Scope
- Define the minimum viable micro bundle contents for the current TUI/runtime path.
- Refactor DAT stripping so bundle selection can be driven by exact file IDs instead of only broad `DatFileType` buckets.
- Add a first-class micro bundle mode to `holtburger-tools`.
- Refactor client startup so mounted dataset discovery and required-asset validation are explicit and table-centric.
- Remove automatic collision checks from `holtburger-world::tick()` and the shared world physics loop.
- Introduce a real `ClientBuilder` and migrate construction away from the current ad hoc constructor path.
- Remove unused replay-based client construction paths.
- Preserve spell, XP, and skill-table-backed UI behavior in the TUI.
- Update documentation and packaging expectations to describe micro-bundle support clearly.

### Out Of Scope
- Implementing meaningful local collision, raycasting, or visibility from DAT geometry.
- Designing the future 3D client's asset streaming or physics architecture.
- Replacing the current coarse entity-retention heuristics with ACE-parity visibility.
- Reintroducing `cell.dat` dependencies through a new fallback path.
- Changing ACE protocol layouts or reverse-engineering new message formats.
- Removing packet-capture writing support from live sessions. Only replay-based consumption is in scope for removal.

## Ground Truth And Existing Patterns

### Reference Sources
- Current HBA/archive and provider abstractions in [crates/holtburger-dat/src/archive.rs](/home/me/code/holtburger/crates/holtburger-dat/src/archive.rs) and [crates/holtburger-dat/src/lib.rs](/home/me/code/holtburger/crates/holtburger-dat/src/lib.rs)
- Current stripping flow in [apps/holtburger-tools/src/lib.rs](/home/me/code/holtburger/apps/holtburger-tools/src/lib.rs) and [apps/holtburger-tools/src/bin/dat2hba.rs](/home/me/code/holtburger/apps/holtburger-tools/src/bin/dat2hba.rs)
- Current strip-manifest shape in [crates/holtburger-dat/src/manifest.rs](/home/me/code/holtburger/crates/holtburger-dat/src/manifest.rs)
- Current world bootstrap and deferred table loading in [crates/holtburger-world/src/state/types.rs](/home/me/code/holtburger/crates/holtburger-world/src/state/types.rs)
- Current shared physics tick and collision path in [crates/holtburger-world/src/state/physics.rs](/home/me/code/holtburger/crates/holtburger-world/src/state/physics.rs) and [crates/holtburger-core/src/client/mod.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- Current client bootstrap requirements in [crates/holtburger-core/src/client/builder.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/builder.rs)
- Current spell, XP, and skill table parsers in [crates/holtburger-dat/src/file_type/spell_table.rs](/home/me/code/holtburger/crates/holtburger-dat/src/file_type/spell_table.rs), [crates/holtburger-dat/src/file_type/xp_table.rs](/home/me/code/holtburger/crates/holtburger-dat/src/file_type/xp_table.rs), and [crates/holtburger-dat/src/file_type/skill_table.rs](/home/me/code/holtburger/crates/holtburger-dat/src/file_type/skill_table.rs)
- Current user-facing DAT/HBA expectations in [README.md](/home/me/code/holtburger/README.md), [dats/README.md](/home/me/code/holtburger/dats/README.md), [docs/hba_format.md](/home/me/code/holtburger/docs/hba_format.md), and [docs/dat_stripper_spec.md](/home/me/code/holtburger/docs/dat_stripper_spec.md)

### Existing Patterns To Follow
- Keep `holtburger-dat` content-agnostic and focused on archive/provider concerns.
- Keep `holtburger-world` authoritative for world state, but do not let TUI-era hacks harden into permanent shared-physics architecture.
- Keep `holtburger-core` responsible for client orchestration and runtime feature gating.
- Prefer explicit system/config seams over implicit behavior based on whether a specific file happened to load.
- Prefer tolerant asset consumption in reusable systems, but keep universally required gameplay tables as explicit hard requirements.
- Keep provider discovery based on mounted dataset roles or roots, not on ad hoc filename rules, because raw asset IDs alone are not sufficient to namespace every DAT/HBA source safely.

## Dry-Run Findings Against The Current Codebase

### The Current Pruned Bundle Is Still Too Broad
`StripperManifest::logic_only()` in [crates/holtburger-dat/src/manifest.rs](/home/me/code/holtburger/crates/holtburger-dat/src/manifest.rs) keeps whole file-type classes such as `DatFileType::Table`, `Model`, `SetupModel`, `EnvCell`, `Landblock`, and `IndoorCell`. That is appropriate for a logic/physics-oriented pruned bundle, but it is far too coarse for a TUI-only micro bundle.

### The Current TUI Path Needs More Than Spell And XP Tables
`WorldState::new()` eagerly loads `SkillTable::FILE_ID`, and `load_deferred_tables()` loads `SpellTable::FILE_ID` and `XpTable::FILE_ID` from portal data in [crates/holtburger-world/src/state/types.rs](/home/me/code/holtburger/crates/holtburger-world/src/state/types.rs). Player mutation logic consumes the skill table for skill cost and derivation behavior in [crates/holtburger-world/src/player/mutations.rs](/home/me/code/holtburger/crates/holtburger-world/src/player/mutations.rs). So the minimum confirmed micro payload is:

- `0x0E000004` skill table
- `0x0E00000E` spell table
- `0x0E000018` XP table

Anything smaller is currently under-provisioned for the shared world/TUI stack.

### Client Startup Is Hardcoded To Portal Plus Cell
`Client::create_with_session_and_dats()` currently rejects startup unless both portal and cell providers load in [crates/holtburger-core/src/client/builder.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/builder.rs). That is the first hard blocker for micro-bundle consumption.

### `cell_dat` Is Enforced But Effectively Unused Today
The current code stores `cell_dat` on `WorldState`, but the present world/core/TUI path does not actually read from it anywhere. The startup check in [crates/holtburger-core/src/client/builder.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/builder.rs) is therefore enforcing a requirement that the current runtime does not use. That lowers the risk of making cell optional for the TUI path.

### Shared World Tick Still Has TUI-Era Collision Behavior
`Client::run()` always calls `world.tick()` on the physics interval in [crates/holtburger-core/src/client/mod.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/mod.rs). `WorldState::tick()` in [crates/holtburger-world/src/state/physics.rs](/home/me/code/holtburger/crates/holtburger-world/src/state/physics.rs) then performs local movement integration and geometry-backed collision checks via `is_colliding()`, which loads `GfxObj` physics BSP data from portal resources. That behavior is no longer justified for the TUI and directly conflicts with the micro-bundle goal.

### Visibility Is Already Conservative And Not Backed By Cell Geometry Yet
The same physics module already documents that visibility pruning is still conservative and not ACE-parity because envcell visibility is not wired up. That is a good signal that dropping automatic collision now is architecturally cleaner than preserving a half-meaningful geometry dependency for the TUI.

### The Real Hard Requirements Are Gameplay Tables, Not Legacy File Names
The current code effectively treats `portal` and `cell` as the hard startup contract, but the actually confirmed always-needed data lives inside portal tables loaded by [crates/holtburger-world/src/state/types.rs](/home/me/code/holtburger/crates/holtburger-world/src/state/types.rs). For the current shared world and TUI path, those hard requirements are:

- skill table: `0x0E000004`
- spell table: `0x0E00000E`
- XP table: `0x0E000018`

That suggests the cleaner long-term contract is "required systems declare required assets," not "all clients must mount portal plus cell."

### Asset Discovery Still Needs Dataset Namespacing
The VFS/provider abstraction keys lookups by raw `u32` asset ID in [crates/holtburger-dat/src/lib.rs](/home/me/code/holtburger/crates/holtburger-dat/src/lib.rs). That is good for lookup, but it is not enough by itself to infer which mounted source should satisfy every request because portal and cell datasets are distinct domains and can contain overlapping ID values. So the plan should stop relying on filename-based requirements, but it should still preserve a notion of mounted dataset role or namespace such as:

- portal-like provider roots
- cell-like provider roots
- future additional mounted roots if needed

In other words: discover capabilities from mounted providers, not from filenames, but do not collapse all sources into one anonymous bag of IDs.

### There Is No Real `ClientBuilder` Type Yet
Despite the architecture docs using the term `ClientBuilder`, the current code uses constructor functions on `Client` in [crates/holtburger-core/src/client/builder.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/builder.rs), not an actual builder struct. Any plan step that says "teach the builder" really means one of two concrete options:

- refactor the current constructor path into a real builder type first, or
- extend `Client::new`, `Client::new_replay`, and `create_with_session_and_dats` directly

This is now resolved: introduce a real builder type and migrate the current constructor path onto it.

### Replay Consumption Still Exists In A Few Concrete Seams
Replay-based session construction still exists in:

- [crates/holtburger-core/src/client/builder.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/builder.rs) via `Client::new_replay`
- [crates/holtburger-session/src/lib.rs](/home/me/code/holtburger/crates/holtburger-session/src/lib.rs) via `Session::new_replay`
- [crates/holtburger-debug-harness/src/bin/extractor.rs](/home/me/code/holtburger/crates/holtburger-debug-harness/src/bin/extractor.rs)

If replay support is truly dead, the plan should remove these paths deliberately rather than leaving them to rot behind a new builder abstraction.

### Collision Removal Has Little Existing Test Coverage
`holtburger-world` has many `tick()` tests, but none currently assert geometry-backed collision behavior or `is_colliding()` semantics directly. That means Phase 1 is unlikely to break existing tests, but it also means we need to add explicit regression coverage for the intended post-collision behavior rather than relying on the current suite to catch mistakes.

## Recommended Architecture

### Core Principle
Treat micro bundles as a reduced-capability asset profile, not as a more aggressively pruned version of the current logic bundle.

`Pruned` means "same shared semantics, lower fidelity." `Micro` means "smaller semantic surface suitable for a TUI that does not consume geometry-driven world simulation."

### Proposed Runtime Split

#### 1. Remove Automatic Local Collision From Shared World Tick
`holtburger-world` should stop attempting local collision checks in `tick()`. Until a future 3D client defines what client-side movement prediction and collision ought to mean, the shared world layer should only:

- advance housekeeping such as retention/pruning timers
- mirror authoritative movement/velocity state from the server

Preferred direction for this task: remove geometry-backed collision handling entirely and simplify `tick()` so it no longer requires portal or cell geometry to be meaningful and does not perform local velocity integration at all.

#### 2. Introduce A Real Client Builder And Simplify Construction
Before broader startup validation changes, `holtburger-core` should grow a real `ClientBuilder` abstraction so runtime assembly, mounted dataset discovery, and required-asset validation have one coherent home.

That builder should:

- assemble the mounted dataset roots/providers
- validate hard requirements for the current runtime
- construct `Client` without special-casing filenames as the semantic contract
- intentionally omit replay-based construction paths if we are removing them

This is the right place to centralize the distinction between dataset discovery and asset validation.

#### 3. Make Asset Validation Explicit And Table-Centric
The client bootstrap path should stop inferring runtime requirements from legacy file names. Instead, the assembled runtime should validate explicit hard requirements imposed by core/world bootstrap.

The current explicit hard requirements should be the portal gameplay tables the shared world/TUI path always needs:

- skill table
- spell table
- XP table

For the current TUI, the target runtime shape is:

- hard-require the above portal tables
- do not require cell data
- use no client-side physics system at all in the first cut

Mounted provider discovery should still preserve dataset namespaces or roles instead of flattening everything into one anonymous provider bag. The key change is that validation should probe for required assets through the mounted providers rather than treating filenames themselves as the requirement contract.

#### Deferred Follow-Up: Optional Client-Side Physics System
If a future non-TUI client needs client-side local physics or prediction, that seam should be introduced in `holtburger-core` and invoked from the core runtime loop rather than from `WorldState::tick()`. That work is intentionally deferred out of this plan so shared world can first become fully dumb and server-authoritative.


#### 4. Add ID-Level Bundle Selection
Extend the stripping manifest model so it can express both:

- broad type-based inclusion for pruned/full-style archives
- exact file-ID inclusion for micro archives

This keeps the HBA/archive container generic while letting the tool emit semantically distinct bundle profiles.

#### 5. Keep HBA Provider Semantics Generic
No HBA format change is required for micro support. The archive already supports generic storage plus quality-aware fallback in [crates/holtburger-dat/src/lib.rs](/home/me/code/holtburger/crates/holtburger-dat/src/lib.rs). The work belongs in manifest selection, tooling, and runtime capability checks.

## Phased Implementation

### Phase 1: Remove Shared Geometry-Backed Collision

#### Deliverables
- Update [crates/holtburger-world/src/state/physics.rs](/home/me/code/holtburger/crates/holtburger-world/src/state/physics.rs) to remove `is_colliding()` and any automatic `GfxObj`-backed collision use from `tick()`.
- Remove local velocity integration from `tick()` so world housekeeping stays server-authoritative and dumb.
- Remove or simplify any now-dead geometry-cache access paths that only existed to serve automatic collision. Prefer removing dead code in this phase rather than deferring it.
- Update related tests in `holtburger-world` to reflect the new non-colliding tick behavior.
- Document the decision that shared world no longer pretends to provide meaningful local collision before a 3D client exists.

#### Acceptance Criteria
- `world.tick()` no longer fetches geometry from portal resources.
- `world.tick()` no longer performs local velocity integration.
- The TUI/shared client loop no longer depends on geometry-backed portal content for local motion updates.
- Tests covering the old collision path are removed or rewritten to assert the new semantics explicitly.

### Phase 2: Introduce A Real Client Builder And Remove Replay Construction

#### Deliverables
- Add a real `ClientBuilder` to `holtburger-core` and migrate existing `Client::new` construction logic onto it.
- Remove `Client::new_replay` from [crates/holtburger-core/src/client/builder.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/builder.rs).
- Remove `Session::new_replay` and replay transport consumption from [crates/holtburger-session/src/lib.rs](/home/me/code/holtburger/crates/holtburger-session/src/lib.rs) and related replay-specific helpers if they are no longer used.
- Update [crates/holtburger-debug-harness/src/bin/extractor.rs](/home/me/code/holtburger/crates/holtburger-debug-harness/src/bin/extractor.rs) to stop depending on replay mode.
- Keep live packet-capture writing support intact.
- Audit and migrate all `holtburger-core` test helpers that currently construct `Client` or `MovementSystem` directly so the new builder path is the only supported construction surface.

#### Acceptance Criteria
- Core construction flows through a real builder abstraction.
- Replay-based client construction paths are removed cleanly rather than left as dead APIs.
- The TUI and any remaining harnesses still construct clients through the new builder path.

### Phase 3: Add Exact-ID Micro Bundle Selection

#### Deliverables
- Refactor [crates/holtburger-dat/src/manifest.rs](/home/me/code/holtburger/crates/holtburger-dat/src/manifest.rs) so manifests can express exact file IDs in addition to `DatFileType` inclusion.
- Add a dedicated micro manifest containing the currently required portal table IDs.
- Update [apps/holtburger-tools/src/lib.rs](/home/me/code/holtburger/apps/holtburger-tools/src/lib.rs) to select manifests by bundle mode rather than assuming only `full` versus `logic_only`.
- Keep the current pruned bundle behavior intact for non-micro use cases.

#### Acceptance Criteria
- The tool can emit a micro archive without including geometry-bearing records.
- The pruned bundle output remains unchanged unless the caller explicitly selects micro mode.
- Manifest logic is testable without requiring a full retail DAT fixture.

### Phase 4: Make Asset Validation Explicit And Portal-Table-Centric

#### Deliverables
- Refactor startup validation in [crates/holtburger-core/src/client/builder.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/builder.rs) so hard requirements are expressed in terms of required assets rather than `portal` plus `cell` file presence.
- Keep mounted dataset roles explicit during discovery instead of relying on filenames or flattening all providers together.
- Make the always-needed skill, spell, and XP tables explicit hard requirements for the shared world/TUI path.
- Treat cell data and geometry-bearing portal assets as optional for the TUI path.
- Update startup diagnostics so failures name the actual missing required asset or table.
- Validate portal-only startup against a micro-style fixture produced through the manifest path from Phase 3 rather than relying on a one-off hand-built test fixture.

#### Acceptance Criteria
- The TUI can start with portal-only data that contains the required tables.
- Startup errors distinguish between missing hard gameplay tables and optional missing geometry/cell assets.
- Validation logic is centered on mounted dataset discovery plus required table probes.

### Phase 5: Add Tooling Surface For Micro Bundle Generation

#### Deliverables
- Extend [apps/holtburger-tools/src/bin/dat2hba.rs](/home/me/code/holtburger/apps/holtburger-tools/src/bin/dat2hba.rs) command-line surface with an explicit bundle mode for micro output.
- Remove the extra `--profile` and legacy `--full` toggles so bundle choice is the only user-facing archive-shaping input.
- Add tool-level tests or focused assertions for the new mode.
- Ensure the output archive can be opened through existing provider code without any format changes.

#### Acceptance Criteria
- A user can intentionally generate a micro portal archive from the CLI.
- The resulting archive contains the expected exact table IDs and no geometry assets.
- The CLI help text clearly differentiates `full`, `pruned`, and `micro` style outputs without also exposing redundant profile toggles.

### Phase 6: Wire Micro Support Through TUI Docs And Verification

#### Deliverables
- Update [README.md](/home/me/code/holtburger/README.md), [dats/README.md](/home/me/code/holtburger/dats/README.md), and any release/packaging notes to describe micro-bundle support and the now-optional nature of `cell` data for the TUI.
- Update release packaging/docs so the distributed TUI artifact includes the micro bundle rather than publishing a separate standalone asset-bundle artifact.
- Update concrete packaging targets including [dist-manifest.json](/home/me/code/holtburger/dist-manifest.json) and [apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.yaml](/home/me/code/holtburger/apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.yaml) so shipped artifacts and Flatpak packaging both reflect the bundled micro archive.
- Add focused integration coverage proving that portal-only micro data is enough for skill, spell, and level-info behavior.
- Record any remaining gaps where the TUI still implicitly assumes richer portal content than the current micro set.

#### Acceptance Criteria
- Documentation accurately describes the supported DAT/HBA layouts.
- Automated coverage proves the TUI/runtime path can resolve skill costs, spell names/details, and level info from the micro bundle.
- There is a clear follow-up list for any future tables that the TUI starts depending on.
- Earlier phases are allowed to leave user-facing docs temporarily stale; user-facing packaging/docs are intentionally batched into this phase.

## Risks And Mitigations

### Risk 1: The Micro Bundle Omits A Table The TUI Indirectly Uses
The obvious set is skill, spell, and XP, but the TUI may gain new dependencies over time.

Mitigation:
- build the micro manifest from exact IDs
- add focused runtime/integration tests around TUI-visible derived behavior
- treat newly discovered table dependencies as explicit manifest additions, not reasons to reintroduce broad `DatFileType::Table`

### Risk 2: Removing Collision Changes TUI Feel In Ways Hidden By Existing Tests
Local movement may currently stop on nearby objects because of the shared collision hack, even if that behavior is not actually authoritative.

Mitigation:
- make the change explicit in tests and docs
- preserve authoritative server reconciliation paths
- treat any newly exposed movement issues as a separate locomotion/prediction problem, not a reason to keep fake shared collision

### Risk 3: Capability Logic Turns Into File-Name Conditionals
If the builder simply special-cases `portal-micro.hba`, the architecture will get patchy fast.

Mitigation:
- introduce an explicit system seam plus system-declared asset requirements
- keep bundle naming and runtime requirements decoupled
- preserve mounted dataset namespaces so discovery does not confuse portal-like and cell-like sources

### Risk 4: The Physics Seam Recreates Hidden Engine Policy
If the physics system abstraction swallows too much generic movement behavior, it could turn into a vague service object that obscures which behavior is authoritative versus optional.

Mitigation:
- keep authoritative world state in `holtburger-world`
- keep the new seam narrowly focused on optional client-side local physics/prediction behavior
- keep asset requirements declarative and small

### Risk 5: The Physics Seam Touches More Test Scaffolding Than Expected
`MovementSystem::new()` is currently hardcoded in multiple core test helper constructors. Even a clean runtime seam will require coordinated updates across test scaffolding in `commands.rs`, `messages.rs`, and `mod.rs`.

Mitigation:
- treat test helper migration as an explicit Phase 2 deliverable
- keep the first seam narrow so helper updates stay mechanical

### Risk 6: Replay Removal Touches Debugging Workflows We Still Care About
Even if replayed sessions are unused, replay code still exists in session/core/debug-harness and may be implicitly depended on by local debugging habits.

Mitigation:
- remove replay construction deliberately and update the debug harness in the same phase
- preserve live packet-capture writing support
- update any docs or harness usage notes that still mention replay mode

### Risk 7: The Micro Concept Gets Blurred With Pruned Quality Fallback
If `micro` is modeled as just another pruned asset, future layering rules will become confusing.

Mitigation:
- keep `pruned` as entry-level fidelity metadata
- keep `micro` as a manifest/runtime profile choice
- avoid changing `CompositeProvider` semantics unless a concrete need appears

## Definition Of Done

- Shared world tick no longer performs geometry-backed automatic collision.
- Shared world tick no longer performs local velocity integration.
- Core construction uses a real `ClientBuilder`.
- Replay-based client construction paths are removed.
- The TUI can boot and function with portal-only micro data.
- The DAT tool can intentionally generate a micro archive from exact portal table IDs via an explicit bundle mode.
- Current pruned/full workflows continue to work unchanged.
- Documentation explains when `cell` is required and when it is not, and how mounted dataset roots are discovered.
- The distributed TUI release artifact includes the micro bundle rather than requiring a separate asset-bundle download.
- Tests cover collision removal, portal-only startup, and micro-bundle table availability.

## Living Worksheet

### Task Checklist
- [x] Phase 1: Remove geometry-backed collision from shared world tick
- [x] Phase 2: Introduce a real client builder and remove replay construction
- [x] Phase 3: Add exact-ID manifest support and micro manifest
- [x] Phase 4: Make startup asset validation explicit and table-centric
- [x] Phase 5: Add CLI mode for micro bundle generation
- [x] Phase 6: Update docs and add portal-only verification coverage

### Decisions Log
- [x] Treat `micro` as reduced capability, not just stronger pruning.
- [x] Drop automatic world collision for now instead of preserving a fake TUI-era shared-physics system.
- [x] Keep the HBA format unchanged; solve this in manifests, tooling, and runtime capability checks.
- [x] Confirm the minimum current micro payload as skill, spell, and XP tables unless later tests reveal additional hard dependencies.
- [x] Introduce a real `ClientBuilder` rather than continuing to extend ad hoc constructor functions.
- [x] Treat skill, spell, and XP tables as explicit hard requirements for the current shared world/TUI path.
- [x] Preserve mounted dataset namespacing during discovery instead of relying on raw asset IDs alone.
- [x] Keep shared world tick dumb: no local velocity integration.
- [x] Do not rely on HBA profile metadata to identify bundle capabilities; infer support from actual mounted assets.
- [x] Remove replay-based client construction paths.
- [x] Ship the TUI release artifact with the micro bundle instead of publishing a separate asset-bundle artifact.
- [x] Phase 1 keeps `WorldState::tick()` housekeeping-only; local movement changes now only come from explicit client movement commands or authoritative server updates.
- [x] Phase 2 introduces a real `ClientBuilder`; production callers and core test helpers now construct clients through the builder rather than hand-assembling `Client` internals.
- [x] Phase 3 adds exact-ID manifest support and an internal micro bundle mode while keeping the existing pruned/full CLI behavior unchanged until the dedicated Phase 5 CLI/profile work.
- [x] Phase 4 keeps mounted dataset roles explicit in `ClientBuilder`, treats cell data as optional for the TUI path, and validates required portal tables by asset ID instead of by legacy `portal` plus `cell` file presence.
- [x] Phase 5 exposes bundle selection as the only user-facing `dat2hba` shaping knob; profile metadata is no longer treated as the bundle contract.

### Verification Log
- [x] Confirm which existing `holtburger-world` tests cover the current collision path and need rewriting.
- [x] Confirm all replay-based construction and debug-harness entry points are removed or migrated cleanly.
- [x] Confirm portal-only startup through a focused integration or client-construction test.
- [x] Confirm micro-archive contents against expected file IDs without relying on profile metadata.
- [x] Identify all `holtburger-core` test helpers that need migration to the new builder construction path.
- [x] Confirm release packaging outputs include the micro bundle in both dist artifacts and Flatpak packaging.

### Progress Notes
- Phase 1 completed: `WorldState::tick()` now only performs eviction and visibility-retention housekeeping.
- Removed the portal geometry cache path that only existed for automatic collision, so shared world no longer reaches into portal BSP data during tick.
- Added explicit regression coverage that tick neither integrates player velocity nor reads portal geometry.
- Phase 2 completed: added a real `ClientBuilder`, routed live client construction through it, and removed replay-based construction from core/session/debug-harness surfaces.
- Migrated the remaining `holtburger-core` test helpers away from direct `Client`/`MovementSystem` struct assembly onto a shared builder-backed helper.
- Phase 3 completed: `StripperManifest` can now combine broad type rules with exact file IDs, and the DAT tool has an internal `BundleMode::Micro` path that selects only the required portal table IDs.
- Kept the external CLI/profile surface stable for now; dedicated public micro CLI/profile wiring remains intentionally deferred to Phase 5.
- Phase 4 completed: startup validation is now expressed in terms of required portal assets, cell data is optional for the TUI path, and builder diagnostics name the missing required table instead of complaining generically about `portal` plus `cell` files.
- Added a focused builder test that boots successfully from a portal-only HBA fixture containing the required micro-table IDs.
- Phase 5 completed: `dat2hba` now exposes `--profile {pruned,full,micro}` as its archive-shaping input, and tool tests cover both CLI parsing and the expected content-selection behavior.
- Phase 6 completed: user-facing docs now describe `portal` as required and `cell` as optional for the TUI, release packaging only stages `portal.hba`, and world-level runtime coverage proves a portal-only micro archive is enough for level info, spell lookup/details, and skill-cost derivation.

### Open Questions
None at the moment. If a future non-TUI client needs client-side local physics or prediction, we should open a follow-up plan for that seam rather than re-expanding this one.