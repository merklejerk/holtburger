# Derived Motion Kinematics Asset Plan

## Context And Boundaries

### Goal
Replace `holtburger-world`'s runtime dependency on raw motion-table animation assets for grounded movement timing with a compact derived HBA asset that contains the resolved motion kinematics needed for self movement and future observer projection.

### In Scope
- Define a compact derived asset that captures the motion kinematics the runtime actually needs instead of shipping full raw animation assets in the micro archive.
- Generate that asset during `dat2hba` from portal DAT content using motion tables, referenced animations, and setup-model fallback data.
- Update `holtburger-world` to resolve movement kinematics exclusively from the derived asset, with explicit startup or lookup failures when the required asset is missing.
- Remove raw DAT loading from client/runtime library startup paths so client libs consume packaged HBA namespaces rather than mixing runtime asset derivation with asset-build concerns.
- Reshape the micro archive profile so it keeps the derived asset instead of bundling all portal animations for movement timing.
- Add tests that prove parity with the current ACE-shaped runtime derivation, including the odd animation-pos-frame formula we already rely on.
- Document the intended seam for future remote-entity grounded motion projection so the asset format does not underfit current self-only needs.

### Out Of Scope
- Full skeletal animation playback, animation blending, or general render-time animation metadata.
- Replacing all current movement/projection logic for remote entities in the same pass.
- Reworking unrelated HBA packaging or archive-format concerns that are already solved by namespaced custom assets.
- Adding a broad asset compiler framework beyond the narrow seams needed for this derived artifact.
- Perfectly modeling every future motion command in the first pass if there is no current or near-term consumer.

## Problem Statement

Today `holtburger-world` resolves grounded movement kinematics by loading a motion table and, when forward velocity is absent, walking the referenced animation `pos_frames` at runtime. That is implemented in [crates/holtburger-world/src/state/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/motion_table.rs#L131) and [crates/holtburger-world/src/state/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/motion_table.rs#L161).

That runtime approach creates an asset-shape problem:
- the micro HBA profile must currently keep all portal motion tables and all portal animations, even though runtime only needs a tiny set of resolved kinematic values
- this inflates the micro bundle by tens of megabytes for a feature that conceptually wants a small lookup table
- the dependency will get worse once observer-side grounded motion projection lands, because ACE does not send world-space velocity for ordinary grounded locomotion

ACE confirms the grounded-observer constraint:
- position updates only include velocity when `PhysicsObj.Velocity != Vector3.Zero`, while grounded state is a separate flag in [ACE/Source/ACE.Server/Network/Structure/PositionPack.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Structure/PositionPack.cs#L57)
- observer motion packets carry commands and speed scalars, not resolved world velocity, in [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Motion/MovementData.cs#L84)
- Holtburger already mirrors this by clearing grounded velocity on position sync when no velocity is supplied in [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs#L510)

That means the project needs local grounded motion kinematics for all motion-table-driven actors, not just the self player. The right fix is to precompute the narrow semantic data we need and ship that derived data directly.

## Ground Truth And Existing Patterns

### Reference Sources
- [ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs)
- [ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs)
- [ACE/Source/ACE.Server/Network/Structure/PositionPack.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Structure/PositionPack.cs)
- [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Motion/MovementData.cs)
- [crates/holtburger-world/src/state/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/motion_table.rs)
- [crates/holtburger-world/src/state/self_movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/self_movement.rs)
- [crates/holtburger-dat/src/file_type/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/motion_table.rs)
- [crates/holtburger-dat/src/manifest.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/manifest.rs)
- [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs)
- [docs/plans/hba-v2-namespace-archive-plan.md](/home/cluracan/code/holtburger/docs/plans/hba-v2-namespace-archive-plan.md)
- [docs/plans/motion-table-speed-model-plan.md](/home/cluracan/code/holtburger/docs/plans/motion-table-speed-model-plan.md)
- [docs/plans/entity-motion-projection-spec-plan.md](/home/cluracan/code/holtburger/docs/plans/entity-motion-projection-spec-plan.md)

### Existing Patterns To Preserve
- `holtburger-dat` owns raw file parsing and archive/type abstractions.
- `apps/holtburger-tools` owns DAT-to-HBA derivation and packaging workflows.
- `holtburger-world` owns authoritative movement semantics and resource-backed lookup, but should not have to parse heavyweight raw assets on hot paths if a narrower shared asset exists.
- This asset family should use a dedicated HBA type id, `DatFileType::MotionKinematics`, rather than the generic custom bucket because it is a first-class runtime dependency.
- The asset should live under the reserved namespace `holtburger/core`.
- Required derived assets may be treated as first-class runtime dependencies in the same spirit as gameplay tables such as XP, skills, and spells.
- Raw DAT ingestion should remain a tooling concern; client/runtime libraries should prefer packaged HBA inputs only.
- Shared crates should expose lossless movement semantics that are plausible for both the current TUI and a future 3D client.

## Design Conclusion

### Asset Shape
Introduce one compact derived asset that stores resolved motion kinematics keyed by motion-table context instead of raw animation IDs.

Recommended minimum contents:
- motion-table id
- stance/style id
- command id
- resolved linear velocity, when known
- resolved angular velocity, when known

The asset should cover full motion-table cycle coverage immediately rather than only the commands consumed by current self movement. That avoids having to revise the format as soon as observer projection begins consuming the same data for arbitrary actors and motion states.

If a command is absent in a given motion table, the asset should preserve that absence rather than silently inventing a value.

### Setup-Model Fallback
The derived asset should include setup-model fallback in the same file. It should carry both:
- the resolved motion-table cycle kinematics keyed by motion-table context
- the setup-model default motion-table mapping keyed by `setup_model_id`

World should not need raw setup-model payloads in the micro archive once this asset exists.

### Runtime Lookup Priority
World lookup should require the derived motion-kinematics asset outright. This asset should be treated like other mandatory runtime data tables rather than an optional optimization layer.

That means:
- runtime bootstrap should fail clearly when the asset is missing
- world should not fall back to raw retail motion/setup/animation assets
- the micro archive should be shaped around this required asset rather than carrying raw animation payloads for runtime synthesis

### Why The Asset Should Be General Rather Than Self-Only
The current self-movement path only needs a few commands today, but grounded observer projection will require the same local kinematic reconstruction for arbitrary actors. The derived asset should therefore be keyed by motion tables and commands generally, not by a self-player-only API or a bundle of already-scaled run-rate answers.

## Dry-Run Findings

### Validated Couplings
- [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) already treats XP, skill, and spell tables as required assets via `validate_required_assets()`. That is the natural place to add motion-kinematics asset validation; it should not be introduced as a world-only ad hoc check.
- [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs) eagerly parses the current required tables during `WorldState::new_with_spatial_physics()`. That means the motion-kinematics asset should likely follow the same pattern and become typed world-owned state, not a repeatedly parsed blob hidden behind `resources` lookups.
- [crates/holtburger-world/src/state/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/motion_table.rs) currently mixes three responsibilities: resolving the actor's motion-table source, reading raw setup-model fallback, and synthesizing missing kinematics from raw motion/animation assets. The asset plan cleanly removes the latter two, but it should preserve the direct-property-versus-setup-default source distinction because downstream diagnostics already rely on it.
- [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) still supports raw `.dat` files and DAT-directory discovery. Once `holtburger/core` is a hard requirement, those startup paths will no longer be sufficient on their own unless an HBA or mounted provider also supplies the required namespace.
- [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) currently mixes HBA mounting and raw DAT discovery. If client libs stop loading raw DAT entirely, the migration gets cleaner: runtime bootstrap becomes “mount required namespaces from HBA/providers or fail” rather than trying to preserve mixed-source startup compatibility.
- [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs) and [crates/holtburger-world/src/state/tests.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/tests.rs) show heavy use of `WorldState::synthetic()`. The plan needs a synthetic/test seam for the required motion-kinematics asset so movement tests do not become awkward resource-bootstrap exercises.
- [crates/holtburger-dat/src/file_type/skill_table.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/skill_table.rs) shows the existing `StaticResourceKey` pattern for required typed assets. The new motion-kinematics asset should fit that same typed lookup pattern rather than introducing a parallel bespoke access style.
- [crates/holtburger-dat/src/manifest.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/manifest.rs) and [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs) show that the current micro profile only preserves portal motion tables and animations plus gameplay tables. Recutting micro is not just content removal; existing manifest tests explicitly encode the current animation-heavy behavior and must be rewritten.
- [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs) currently processes only retail DAT entries as streamed archive output. Emitting the derived motion-kinematics asset will require an explicit synthetic-entry generation step after the source DATs are loaded, not merely an additional manifest rule.

### Consequences For Implementation
- Phase 1 should include a typed asset struct with `StaticResourceKey` plus a world-owned parsed field, so the runtime consumes motion kinematics the same way it already consumes required gameplay tables.
- Phase 3 should explicitly update `WorldState::new_with_spatial_physics()` and related state constructors, not just `state/motion_table.rs`, because the current world bootstrap path is where required assets become parsed runtime state.
- The plan should explicitly remove raw DAT loading from client/runtime library bootstrap rather than trying to preserve bare DAT startup compatibility.
- Tests should get a dedicated injection seam for parsed motion-kinematics data in synthetic worlds, similar in spirit to the existing self-movement capability override, so unit tests can stay focused on movement semantics.
- Phase 2 should call out that `dat2hba` needs a second write path for synthetic archive entries under `holtburger/core`, because the current process loop only rewrites entries that already exist in the source DAT.

### No Major Plan Breakers Found
- The existing required-asset pattern in builder and world is a good fit for this feature rather than a mismatch.
- The namespace-aware HBA loader already mounts arbitrary namespaces, so adding `holtburger/core` does not fight the archive/runtime design.
- Removing raw DAT loading from client libs actually reduces migration surface area rather than increasing it; the main cost is test/bootstrap churn, not an architectural contradiction.

## Phased Implementation

### Phase 1: Define The Derived Asset Contract And Encoding

#### Status
Completed on 2026-04-02.

#### Deliverables
- Add a new derived motion-kinematics asset type in `holtburger-dat` under the existing HBA custom-asset model.
- Define the binary encoding, versioning, file-id constant, and `holtburger/core` namespace placement for the derived asset.
- Add read/write helpers and typed lookup APIs for full motion-table cycle kinematics and setup-model fallback data.
- Encode setup-model defaults in the same file as the motion-kinematics table.
- Add a typed `StaticResourceKey` path for the asset so builder/world can validate and load it like other required tables.
- Define the runtime-loading rule explicitly: client libs load required namespaces from HBA/providers only; raw DAT support remains tooling-only.

#### Completed Work
- Added [crates/holtburger-dat/src/file_type/motion_kinematics.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/motion_kinematics.rs) with the new `MotionKinematics` asset codec, `MotionKinematicsTable`, typed lookup helpers, and `StaticResourceKey` support.
- Reserved `MotionKinematics::FILE_ID = 0x4D4F544B` and `MotionKinematics::VERSION = 1` for the required asset in `holtburger/core`.
- Stored setup-model default motion-table mappings and motion-table cycle kinematics in the same asset file.
- Included `default_style` per motion table after implementation exposed that world cannot resolve default-stance movement from the derived asset without it.
- Added dat-layer round-trip and typed-resource-key tests for the new asset.

#### Files To Touch
- [crates/holtburger-dat/src/file_type/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/mod.rs)
- new derived asset codec files under [crates/holtburger-dat/src/file_type](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type)
- [crates/holtburger-dat/src/lib.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/lib.rs)
- [docs/hba_format.md](/home/cluracan/code/holtburger/docs/hba_format.md) if the derived-asset conventions need an explicit section

#### Acceptance Criteria
- The derived asset has an explicit, versioned binary shape.
- There is one typed API that can answer “what are the resolved kinematics for motion table X, stance Y, command Z?” without exposing raw archive details.
- The same file can answer “what is the default motion table for setup model X?” without a sibling asset lookup.
- Unit tests cover encode/decode round trips and absent-value cases.

#### Validation
- `cargo test -p holtburger-dat motion_kinematics -- --nocapture` passed.

### Phase 2: Build The Asset In `dat2hba`

#### Status
Completed on 2026-04-02.

#### Deliverables
- Teach `dat2hba` to derive motion kinematics from portal DAT inputs by reading motion tables and referenced animations.
- Reuse the current ACE-parity formula for animation-derived forward speed so the runtime and builder do not diverge.
- Derive setup-model default motion-table mappings into the same derived file as the motion-cycle kinematics.
- Emit the derived artifact into `holtburger/core` as `DatFileType::MotionKinematics` alongside the stripped retail content.
- Add the synthetic archive-entry emission path required to write `holtburger/core` content that does not come from a source DAT record verbatim.
- Add focused tool tests using reduced fixtures that prove the derived asset reproduces the current runtime answers.

#### Completed Work
- Updated [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs) to parse portal motion tables, setup models, and animations, derive the `MotionKinematics` asset, and emit it into `holtburger/core` as a synthetic HBA entry.
- Kept the ACE-shaped animation displacement formula aligned with the current world-side derivation: sum `pos_frames`, divide by total frame count, and scale by the first animation entry's framerate.
- Emission is now output-level rather than manifest-level: `dat2hba` writes the required `holtburger/core` asset after processing retail entries, so the asset is emitted for all archive profiles when portal input is present.
- Added focused tests for parsed-asset derivation, missing-animation failure reporting, and synthetic HBA entry emission.
- Added `holtburger-common` plus `tempfile` support to the tools crate where needed for derivation math and archive round-trip tests.

#### Acceptance Criteria
- `dat2hba` emits an HBA that contains all required runtime namespaces, including `holtburger/core`, without requiring client libraries to read raw DATs.
- The derived values match the current world-side derivation logic for representative motion tables and setup-model fallback cases.
- Build-time failures report the offending resource id clearly when an input record is malformed or missing.
- The implementation does not require keeping the raw animation payload solely so the derived asset can be emitted into the same output archive.

#### Validation
- `cargo test -p holtburger-tools -- --nocapture` passed.

#### Files To Touch
- [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs)
- tool test files under [apps/holtburger-tools/src](/home/cluracan/code/holtburger/apps/holtburger-tools/src)
- [crates/holtburger-dat/src/file_type/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/motion_table.rs) if shared helpers are needed for derivation
- [crates/holtburger-dat/src/file_type/setup_model.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/setup_model.rs) if shared helpers are needed for fallback extraction

### Phase 3: Migrate `holtburger-world` To The Derived Lookup Seam

#### Status
Completed on 2026-04-02.

#### Deliverables
- Update builder required-asset validation so missing `holtburger/core` motion kinematics fails alongside XP/skill/spell table validation.
- Remove raw DAT file and DAT-directory discovery from client/runtime library bootstrap so required runtime assets come from HBA/providers only.
- Parse the required motion-kinematics asset during `WorldState` construction and store the parsed representation in world-owned state.
- Refactor world-side motion-table resolution to load resolved kinematics exclusively from the derived asset.
- Preserve current explicit error reporting for missing motion-table sources, missing setup-model defaults, and missing required run/turn kinematics.
- Add tests proving the derived asset path reproduces the current `MotionTableMovementProfile` answers and setup-model fallback behavior.
- Update startup or resource validation so missing motion-kinematics assets fail as clearly as missing required gameplay tables.
- Add a synthetic/test injection seam so unit tests can supply parsed motion-kinematics data without mounting a full HBA.

#### Completed Work
- Updated [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) so runtime validation hard-requires `holtburger/core:MotionKinematics` alongside XP, skill, and spell tables.
- Removed raw `.dat` file and DAT-directory discovery from `ClientBuilder`; runtime bootstrap now mounts HBA/provider namespaces only.
- Updated [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs) to parse `MotionKinematics` during `WorldState::new_with_spatial_physics()` and store it as world-owned typed state.
- Replaced raw motion/setup/animation reads in [crates/holtburger-world/src/state/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/motion_table.rs) with derived-asset lookups while preserving explicit errors for missing motion-table sources, missing setup defaults, and missing required self-movement kinematics.
- Added a synthetic motion-kinematics injection seam for tests and rewrote world/bootstrap tests to use derived-asset fixtures instead of runtime raw DAT synthesis.

#### Files To Touch
- [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs)
- [crates/holtburger-world/src/state/motion_table.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/motion_table.rs)
- [crates/holtburger-world/src/state/self_movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/self_movement.rs)
- [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs)
- [crates/holtburger-world/src/state/tests.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/tests.rs)
- [crates/holtburger-world/src/lib.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/lib.rs) or adjacent exports if new lookup types need to be exposed

#### Acceptance Criteria
- World no longer requires raw animation files or raw setup-model payloads for movement lookup.
- Derived-asset lookup reproduces the current motion-table-derived answers under test.
- Error paths stay explicit and debuggable; missing derived data does not silently degrade into guessed speeds.
- Existing self-movement capability tests continue to pass with the derived path enabled.
- Synthetic-world tests have a supported path to inject or stub the required motion-kinematics data.
- Client/runtime libraries no longer discover or mount raw `.dat` archives during normal bootstrap.

#### Validation
- `cargo test -p holtburger-world -- --nocapture` passed.
- `cargo test -p holtburger-core -- --nocapture` passed.

### Phase 4: Recut The Micro Profile Around The Derived Asset

#### Status
Completed on 2026-04-02.

#### Deliverables
- Change the micro manifest/profile so it keeps the derived motion kinematics asset and no longer keeps all portal animations just for movement timing.
- Remove any now-unnecessary raw motion/setup assets from micro once runtime no longer depends on them for movement semantics.
- Add archive-selection tests that prove the micro profile keeps the new custom asset and omits the heavy raw animation payload.
- Update startup/package docs to state clearly that normal client runtime now expects an HBA carrying `holtburger/core`, not bare DAT discovery alone.

Phase 2 showed that this phase must verify final archive outputs, not just manifest inclusion rules, because the required motion-kinematics asset is emitted as a synthetic post-processing entry rather than selected through `StripperManifest`.

#### Completed Work
- Updated [crates/holtburger-dat/src/manifest.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/manifest.rs) so the micro profile no longer retains raw `MotionTable` or `Animation` entries.
- Updated [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs) micro-profile tests to assert the raw motion assets are excluded while the synthetic `holtburger/core:MotionKinematics` asset is still emitted.
- Regenerated [dats/assets.hba](/home/cluracan/code/holtburger/dats/assets.hba) with the micro profile and verified the final archive contains exactly the three required portal tables plus `holtburger/core:MotionKinematics`.
- Updated [README.md](/home/cluracan/code/holtburger/README.md) and [dats/README.md](/home/cluracan/code/holtburger/dats/README.md) so the runtime contract is explicit: normal client startup expects a namespaced HBA that includes `holtburger/core`, and raw DAT handling is tooling-only.

#### Files To Touch
- [crates/holtburger-dat/src/manifest.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/manifest.rs)
- [apps/holtburger-tools/src/dat2hba.rs](/home/cluracan/code/holtburger/apps/holtburger-tools/src/dat2hba.rs)
- profile/tool tests under [apps/holtburger-tools/src](/home/cluracan/code/holtburger/apps/holtburger-tools/src)
- [README.md](/home/cluracan/code/holtburger/README.md)
- [dats/README.md](/home/cluracan/code/holtburger/dats/README.md) if the recommended archive contents change materially

#### Acceptance Criteria
- The micro archive contains the derived asset and the minimum remaining retail data the runtime still needs.
- Portal animation bulk is no longer part of the micro profile solely for movement timing.
- Raw setup-model retention is no longer required for motion-table fallback in micro.
- Tool tests prove the expected inclusion/exclusion behavior.

#### Validation
- `cargo run -p holtburger-tools --bin dat2hba -- --profile micro ace-root/dats/client_portal.dat ace-root/dats/client_cell_1.dat dats/assets.hba` passed.
- `cargo run -p holtburger-tools --bin dat-tool -- list dats/assets.hba` verified the final micro archive contains:
	- `eor/portal:0E000004` (`SkillTable`)
	- `eor/portal:0E00000E` (`SpellTable`)
	- `eor/portal:0E000018` (`XpTable`)
	- `holtburger/core:4D4F544B` (`MotionKinematics`)
- `cargo test -p holtburger-tools -- --nocapture` passed.
- `cargo test -p holtburger-world test_micro_portal_bundle_supports_runtime_table_lookups -- --nocapture` passed.
- `cargo test -p holtburger-core portal_only_startup_succeeds_when_required_tables_are_present -- --nocapture` passed.

### Phase 5: Prepare The Asset For Observer Projection Consumers

#### Status
Completed on 2026-04-02.

#### Deliverables
- Audit the observer/projection design against the derived asset to confirm the initial command set is sufficient for grounded remote simulation.
- Add any missing command coverage required by near-term projection work before the asset format becomes sticky.
- Document the runtime contract for future projection code: when to use retained server velocity, when to use motion commands plus derived kinematics, and when to suspend projection.

#### Completed Work
- Audited [docs/plans/entity-motion-projection-spec-plan.md](/home/cluracan/code/holtburger/docs/plans/entity-motion-projection-spec-plan.md), [docs/autonomous_movement.md](/home/cluracan/code/holtburger/docs/autonomous_movement.md), and the current retained motion-state/code paths in world/core against the derived asset contract.
- Confirmed the derived asset is already broad enough for near-term observer projection because it stores full motion-table cycle coverage keyed by motion table, stance, and command rather than a self-only subset.
- Confirmed current world-retained motion inputs already include the interpreted commands, ordered speeds, directives, and vector updates that projection consumers need to select between authoritative correction, grounded command simulation, and velocity-based dead reckoning.
- Documented the runtime projection contract explicitly: authoritative pose from position updates, sticky motion intent from `UpdateMotion`, retained velocity/omega from `VectorUpdate`, grounded rates from `holtburger/core:MotionKinematics`, and conservative suspend boundaries for teleport / force-position / missing required kinematics.

#### Files To Touch
- [docs/plans/entity-motion-projection-spec-plan.md](/home/cluracan/code/holtburger/docs/plans/entity-motion-projection-spec-plan.md)
- [docs/autonomous_movement.md](/home/cluracan/code/holtburger/docs/autonomous_movement.md)
- projection-side implementation files when that work begins

#### Acceptance Criteria
- The derived asset is not self-only by accident.
- The motion-command coverage is sufficient for the next observer-projection milestone.
- Docs state clearly which movement data comes from the server and which comes from local derived kinematics.

#### Validation
- Read-only audit confirmed [crates/holtburger-dat/src/file_type/motion_kinematics.rs](/home/cluracan/code/holtburger/crates/holtburger-dat/src/file_type/motion_kinematics.rs) already exposes full motion-table cycle coverage keyed by motion table, stance, and command.
- Read-only audit confirmed [crates/holtburger-world/src/entity.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/entity.rs), [crates/holtburger-world/src/handlers/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/movement.rs), [crates/holtburger-world/src/events.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/events.rs), and [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs) already retain and forward the motion, directive, and kinematics inputs needed by the projection design.
- No asset-schema or runtime-code changes were required for phase 5; the closeout was documentation and contract confirmation only.

## Risks And Mitigations

### Risk: The Derived Asset Underfits Future Projection Needs
Mitigation:
- Key the asset by motion table, stance, and command rather than by current self-movement helpers.
- Audit near-term observer command coverage before locking the format.
- Preserve absence explicitly instead of collapsing unknowns into guessed defaults.

### Risk: Build-Time Derivation Diverges From ACE-Oriented Runtime Behavior
Mitigation:
- Move the derivation logic behind shared helpers where possible.
- Preserve the current animation-pos-frame formula exactly and anchor it with tests that compare build-time and runtime results.
- Use reduced fixtures that encode the weird cases directly.

### Risk: Setup-Model Fallback Is Left Half-Migrated
Mitigation:
- Keep setup-model fallback in the same derived file from day one.
- Do not treat same-file fallback coverage as optional follow-up work.

### Risk: The Migration Leaves Two Permanent Lookup Systems
Mitigation:
- Remove raw retail lookup from the target architecture entirely.
- Make runtime validation fail fast when the derived asset is missing so incorrect packaging is caught immediately.

### Risk: Custom-Asset Discovery Becomes Ad Hoc
Mitigation:
- Reserve one documented namespace and constant file id for this asset family.
- Expose a typed lookup helper in `holtburger-dat` so runtime code does not hand-roll archive probing.

## Definition Of Done

- `holtburger-world` resolves grounded movement kinematics exclusively from a required derived asset without requiring raw animation or raw setup-model payloads.
- The derived asset reproduces the current ACE-shaped walk/run/turn kinematics under test.
- Micro HBA size drops materially because portal animations are no longer bundled solely for movement timing.
- Setup-model fallback is preserved through the new seam.
- The asset contract covers full motion-table cycle coverage and is broad enough for upcoming grounded observer projection work.
- Tooling, docs, and tests all describe the derived asset as the canonical source for precomputed grounded motion kinematics.

## Living Worksheet

### Task Checklist
- [x] Phase 1: Define derived asset schema, constants, and typed lookup API.
- [x] Phase 2: Emit derived motion kinematics and setup defaults from `dat2hba`.
- [x] Phase 3: Switch world lookup to required derived-asset resolution and validation.
- [x] Phase 4: Recut the micro profile and verify archive contents.
- [x] Phase 5: Audit and document observer-projection readiness.

### Decisions Log
- Decided: setup defaults live in the same derived file as command kinematics.
- Decided: the asset namespace is `holtburger/core`.
- Decided: the asset uses the dedicated HBA type id `DatFileType::MotionKinematics` (`0xFFFF_FF01`).
- Decided: the asset file id is `MotionKinematics::FILE_ID = 0x4D4F544B`.
- Decided: the asset will cover full motion-table cycle coverage immediately.
- Decided: provenance metadata is not part of the production asset contract.
- Decided: runtime consumers hard-require this asset rather than falling back to raw DAT-derived lookup.
- Decided: raw DAT loading is removed from client/runtime libraries; DAT access remains tooling-only.
- Decided: `default_style` must be carried per motion table in the derived asset so world can resolve default-stance movement without raw motion-table payloads.
- Refined: builder/world required-asset validation hookup belongs in Phase 3, not Phase 1, to avoid breaking runtime before `dat2hba` emits the new asset.
- Decided: `dat2hba` emits the required `holtburger/core` motion-kinematics asset for all archive profiles when a portal namespace input is present.
- Refined: because the asset is synthetic rather than manifest-selected, Phase 4 verification must assert final HBA contents and size, not only manifest rules.
- Decided: phase 4 is complete once final archive contents are verified; we do not need to preserve a plan-level bundle-size metric if the archive contract is already proven.
- Decided: the regenerated checked-in [dats/assets.hba](/home/cluracan/code/holtburger/dats/assets.hba) is now the authoritative micro fixture and already includes the derived `holtburger/core` asset.
- Decided: no phase-5 asset-format expansion is required before the next observer-projection milestone; full cycle coverage in `MotionKinematics` is already sufficient for grounded remote simulation.
- Decided: projection consumers should treat `MotionKinematics` as the canonical grounded-rate source and use retained packet velocity only for bounded dead reckoning or unsupported grounded cases.
- Decided: missing required kinematics is a suspend boundary for projection, not a license to guess movement rates.

### Verification Log
- 2026-04-02: `cargo test -p holtburger-dat motion_kinematics -- --nocapture` passed.
- 2026-04-02: `cargo test -p holtburger-tools -- --nocapture` passed.
- 2026-04-02: `cargo test -p holtburger-world -- --nocapture` passed.
- 2026-04-02: `cargo test -p holtburger-core -- --nocapture` passed.
- 2026-04-02: `cargo run -p holtburger-tools --bin dat2hba -- --profile micro ace-root/dats/client_portal.dat ace-root/dats/client_cell_1.dat dats/assets.hba` passed.
- 2026-04-02: `cargo run -p holtburger-tools --bin dat-tool -- list dats/assets.hba` confirmed the micro archive contains only the three required portal tables plus `holtburger/core:MotionKinematics`.
- 2026-04-02: `cargo test -p holtburger-world test_micro_portal_bundle_supports_runtime_table_lookups -- --nocapture` passed.
- 2026-04-02: `cargo test -p holtburger-core portal_only_startup_succeeds_when_required_tables_are_present -- --nocapture` passed.
- 2026-04-02: phase-5 read-only audit confirmed the current derived asset and retained motion-state/event seams already satisfy near-term observer-projection needs without further schema changes.

### Open Questions
- None for the current projection milestone. A later fidelity pass can still revisit whether retaining `MoveToPosition` or `MoveToObject` directives materially improves remote observers enough to justify extra world-state complexity.