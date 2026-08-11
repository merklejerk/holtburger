# Holtburger 3D Host Physics and Physical Camera Recovery Plan

Status: In progress — Phase 0 complete; Phase 1 not started
Created: 2026-08-11
Canonical implementation base: `3d-next` at `41b164ab`
Recovery branch: `fix/host-physics-recovery`
Donor commits: `2b00a694`, `94286ab2` on `claude`
Superseded donor execution record:
`.worktrees/claude/docs/plans/holtburger-3d-host-physics-runtime-physical-camera-plan.md`
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`

## Context and Boundaries

### Goal

Build one host-owned static-body motion system that supports an Explorer camera in two physical
regimes — collision-aware free flight and retail-compatible grounded walking — while preserving the
existing frontend free-fly camera as the nonphysical escape path and establishing shared mechanics
suitable for future client-authoritative player movement.

### Recovery Decision

The `claude` branch is a donor, not an integration base. Its first physics commit proved valuable
content ingestion, collision geometry, host pacing, and frontend presentation mechanisms. Its second
commit replaced the solver with a partial structural translation of retail's transition pipeline,
but omitted the mode-specific query dispatch that gives the pipeline its behavior. The result is
green under its retained tests while carrying known and newly audited regressions.

This plan therefore:

- starts from current `3d-next`, including the completed near-field SAO work;
- selectively reimplements donor-proven mechanisms behind canonical contracts;
- does not cherry-pick either donor commit wholesale;
- treats the donor plan as an incident log and evidence archive, not an executable plan;
- builds physical fly before grounded walk, because it proves the shared collision kernel without
  contaminating it with support, step, slope, or ledge policy; and
- uses retail as the grounded controller's behavioral oracle, not as the architecture blueprint.

### Ratified Recovery Decisions

1. The host exposes two physical responses: physical fly and grounded walk. The existing frontend
   free-fly controller remains the nonphysical default and recovery path.
2. Physical fly maps the camera's full view-relative basis, including pitch and explicit vertical
   input, into world-space intent. Grounded walk derives planar intent from the camera heading and
   leaves vertical motion to the grounded controller.
3. The Explorer physical-fly camera uses one fixed app-owned sphere. Grounded walk uses the authored
   human pair: a lower/support sphere centered 0.475 m above the body reference with radius 0.480 m,
   and an upper/constraint sphere centered 1.350 m above the body reference with radius 0.480 m.
   Selectable body dimensions are deferred until a concrete inspection workflow requires them.
4. Creature-protection variation remains a harness control. Explorer grounded walk enables
   creature-style ledge protection by default and does not expose the variation as ordinary UX.
5. Missing coverage holds the last safe physical pose in both modes.
6. Explorer grounded walk presents the camera 1.500 m above the grounded body reference. This is
   retail's first-person human pivot height and lies inside the authored 1.835 m human body extent;
   it is not the support-sphere center or the top of the authored body.

### Problem Statement

The donor implementation mixed three distinct concerns:

1. Static collision content and geometry queries.
2. General kinematic one-or-two-sphere body movement against static geometry.
3. Grounded character-controller policy.

It represented the distinction as booleans on one retail-shaped mutable transition object. Physical
fly and grounded walk then entered the same support, step-up, step-down, and creature-protection
pipeline. Several retail fields had no consumer, while a behavior-bearing distinction — the BSP
dispatch between ordinary movement, walkability, step-down, and placement queries — was collapsed.

The architectural recovery is addition through subtraction: one small shared motion kernel, two
explicit response policies, and no field or transition state that exists only because retail has it.

### In Scope

- Parsed terrain, authored-object, generated-scenery, building-shell, EnvCell, and indoor-object
  collision assembly in `holtburger-content`.
- Typed static collision queries in `holtburger-world`, including explicit missing-coverage results,
  per-sphere obstruction, support probing, placement confirmation, and cell transit.
- A bounded, iterative static sphere-body motion kernel shared by physical fly and grounded walk.
- A grounded body contract containing one required lower/support sphere and one optional
  upper/constraint sphere; the Explorer grounded camera exercises the two-sphere case in production.
- A physical-fly response that collides and slides in three dimensions without gravity, support,
  ground snapping, steps, or creature protections.
- A grounded response that owns gravity, support, walkability, wall sliding, step up/down, cliff and
  precipice protection, contact transitions, and achieved velocity.
- Atomic pose, contact, and interior-cell commit.
- An app-local host camera driver, collision residency policy, typed intent commands, and predicted
  solved-path events.
- Explorer controls for physical fly and grounded walk alongside the existing frontend free-fly
  controller.
- Synthetic scenario fixtures derived from retail behavior and product-path diagnostic probes over
  real content.
- Clean convergence with the current `3d-next` Explorer and SAO controls.

### Out of Scope

- Dynamic body-versus-body collision, restitution, projectiles, ragdolls, or a general rigid-body
  engine.
- Spawned-entity lifecycle, appearance, motion tables, or frontend entity mirroring.
- Network transport, login, or protocol changes.
- Runtime player-body sizing from setup models; the Explorer camera keeps app-owned dimensions
  measured against authored human geometry.
- Jumping, swimming, or animation-root motion.
- Cylsphere collision, arbitrary compound bodies, and support for more than retail's first two
  authored motion spheres.
- Reproducing retail class topology, state-bit layout, numeric transition enums, or retry structure.
- Making physical fly retail-compatible; it is Explorer product behavior.
- Replacing or relocating the existing frontend free-fly controller.
- Permanent tests that require untracked runtime DAT assets.
- Opportunistic dependency upgrades, generated Tauri schema churn, or unrelated frontend refactors.

## Ground Truth

### Behavioral Authorities

| Concern | Authority | Acceptance role |
| --- | --- | --- |
| Collision file interpretation | ACE DatLoader, ACViewer, shipped content census | Defines decoded geometry and authored placement |
| BSP and polygon contact semantics | Retail decompile, then ACE/ACViewer as navigation aids | Defines what static geometry blocks or supports |
| Grounded movement | Retail decompile | Defines observable outcomes and invariants |
| Physical-fly response | Explorer product policy | Defines no-penetration, sliding, reach, and control behavior |
| Host/frontend motion boundary | Measured donor Gate A evidence plus canonical runtime verification | Defines tick, prediction, starvation, and correction behavior |
| Crate and app ownership | Canonical project architecture | Defines where mechanics, content, composition, and UX live |

Retail sequence is implementation evidence only when changing the order changes an observable
outcome. Class layout, dormant flags, and numeric enum values are not acceptance requirements.

The shipped `eor/portal` archive currently contains 5,935 decodable setup models: 2,325 author no
ordinary spheres, 3,000 author one, 579 author two, and 31 author three to five. Thus 610 setups
author at least two spheres — 10.3% of all setups and 16.9% of sphere-bearing setups. Retail caps
`SPHEREPATH` motion to the first two spheres. This census sizes the shared motion contract at one
required sphere plus one optional sphere; it does not justify a generic compound-collider API.

### Authoritative References

- `acclient-eor-source/acclient.c`
  - `CPhysicsObj::UpdateObjectInternal` and `update_object`: per-tick integration and transition
    invocation.
  - `CTransition::find_transitional_position`, `transitional_insert`, `validate_transition`,
    `step_down`, `step_up`, `edge_slide`, `cliff_slide`, and `precipice_slide`: grounded behavioral
    outcomes and behavior-bearing ordering.
  - `SPHEREPATH::init_sphere`, `cache_global_sphere`, and `set_neg_poly_hit`: the two-sphere cap,
    lower-sphere low point, transformed centers, and second-sphere back-face state.
  - `BSPTREE::find_collisions`, `step_sphere_down`, `step_sphere_up`, and the sphere slide family:
    distinct collision-query roles and asymmetric lower/upper-sphere responses.
  - `CObjCell::find_cell_list`, `CEnvCell::find_visible_child_cell`, `check_other_cells`, and
    building-check handling: cell membership and building-shell suppression.
- `ACE/Source/ACE.Server/Physics/`
  - Navigation and terminology aid for the retail transition system, including the explicit player
    two-sphere observation in `PhysicsObj.cs`; not an expected-outcome oracle.
- `ACE/Source/ACE.DatLoader/`
  - Parsed physics BSP, polygon, environment, building, placement, and terrain formats.
- `crates/holtburger-dat/src/file_type/setup_model.rs`
  - Lossless authored `spheres` and `cyl_spheres` used for the shipped-content body-shape census.
- `ACViewer/ACViewer/Physics/`
  - Supporting evidence for physics-tree traversal and content interpretation.

The retail decompile is read-only. ACE and ACViewer may receive temporary diagnostics if necessary,
but no diagnostic change lands without an explicit production purpose.

### Canonical Patterns to Preserve

- `crates/holtburger-world/src/spatial/physics.rs`
  - Existing `SpatialPhysics` injection boundary and deterministic solve request/result contracts.
- `crates/holtburger-world/src/spatial/scene.rs`
  - Authoritative runtime-body storage and solve orchestration.
- `crates/holtburger-core/src/client/builder.rs`
  - Physics dependency injection for reusable client orchestration.
- `apps/holtburger-3d/src/explorer/free-fly-camera-controller.ts`
  - Existing frontend-owned nonphysical camera control.
- `apps/holtburger-3d/src/explorer/explorer-camera-coordinator.ts`
  - Explorer camera and scene-interest coordination.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
  - Primary-camera presentation consumer.
- `apps/holtburger-3d/src-tauri/src/lib.rs`
  - Narrow app-local Tauri command boundary.
- `docs/plans/holtburger-3d-dynamic-entity-architecture-convergence-plan.md`
  - Canonical-base and selective-donor recovery precedent.

### Donor Provenance and Disposition

#### Reimplement selectively

- `crates/holtburger-content/src/terrain_topology.rs`
- `crates/holtburger-content/src/terrain_collision.rs`
- `crates/holtburger-content/src/object_collision.rs`
- Relevant assembly changes in `crates/holtburger-content/src/landblock.rs`, `interior.rs`, and
  `lib.rs`.
- `crates/holtburger-world/src/spatial/bsp_query.rs`
- `crates/holtburger-world/src/spatial/collision.rs`
- Relevant position-crossing primitives in `crates/holtburger-common/src/position.rs`.
- The complete collision merge owned by `LandblockColliders::absorb` and product assembly through
  `ContentAssetService::resolve_collision`.
- Host tick, collision residency, predicted segment, frontend session, and physical-camera transport
  concepts from `apps/holtburger-3d`.
- `collision_scene_probe` and the useful focused portions of `interior_walk_probe`.

Every donor mechanism is re-read against the canonical code and its authoritative reference before
adaptation. Donor tests are evidence to rewrite, not implementation credit.

#### Retain as evidence only

- Donor Gate A latency measurements and pacing decision.
- Collision-content censuses and aperture measurements.
- Named defect traces, attempted fixes, and aggregate probe baselines.
- The grounded transition census, after each cited conclusion is checked against the decompile.
- `transition.rs` pure state-lifetime observations and geometry calculations, where a current
  recovery contract consumes them.

#### Reject

- Whole-commit cherry-picks of `2b00a694` or `94286ab2`.
- The donor `motion_solver.rs`, `body_transition.rs`, and retail-shaped `TransitionModes` API.
- Numeric retail enum parity without a consumer.
- Interdependent mode booleans that permit invalid query combinations.
- Recursive step-up/step-down solving.
- A retained contact plane that is not explicitly cleared when its validity expires.
- Treating `NoCoverage` as empty space.
- Product probes that assemble a different collision scene from the app.
- Incidental Cargo/npm dependency refreshes and generated Tauri schema changes.

## Target Architecture

### Ownership

```text
Explorer input and camera UX policy
  apps/holtburger-3d
            |
            v
Physical camera intent + mode
  app-local src-tauri host driver
            |
            v
Static body motion
  holtburger-world
    |- shared bounded sphere-body motion kernel
    |- physical-fly response
    `- grounded response
            |
            v
Static collision world
  holtburger-world queries over parsed holtburger-content artifacts
            |
            v
Solved pose + contact + cell + achieved motion
  host predicted segment -> frontend presentation
```

### Body and Response Shape

The final names are selected during implementation, but the types must enforce the body roles and
response separation. The pair is not a generic compound collider: sphere zero owns the low point,
support, and step relationship; sphere one is an optional upper constraint with distinct retail
collision routing.

```rust
enum StaticMotionBody {
    PhysicalFly {
        sphere: SphereShape,
    },
    Grounded {
        spheres: GroundedBodySpheres,
        policy: GroundedMotionPolicy,
    },
}

struct GroundedBodySpheres {
    support: SphereShape,
    upper: Option<SphereShape>,
}

struct GroundedMotionPolicy {
    step_up_height: f32,
    step_down_height: f32,
    walkable_floor_z: f32,
    edge_protection: EdgeProtection,
}
```

Physical-fly bodies cannot carry grounded-only fields or an upper sphere. A grounded body can use
one sphere, but the Explorer grounded camera is the production consumer for `upper: Some(_)`. The
existing frontend free-fly mode bypasses this physical body entirely and remains the recovery path
from bad placement.

### Query Shape

Collision operations are explicit composite requests rather than combinations of flags. At minimum,
the design must distinguish:

- coverage lookup;
- movement obstruction;
- support or step-down probing;
- placement confirmation; and
- cell transit from the prior cell through reachable portals.

Results distinguish `MissingCoverage`, `Clear`, `Contact`, `Adjusted`, and `Blocked` where those
outcomes are meaningful. Contacts identify the body-sphere role that produced them when that fact
changes grounded response. A query returns lossless geometry facts; the response policy computes
walkability or movement decisions once and carries the derived result through validation.

### Solver Shape

The motion driver is iterative and bounded. Grounded solving may move through explicit phases such
as advance, retry-after-adjustment, step-up probe, step-down probe, placement confirmation, and
validation, but those phases are our types and are introduced only when a scenario consumes them.
The driver evaluates at most two explicitly named sphere roles. It does not treat the pair as
interchangeable probes or collapse their contacts by blindly choosing one earliest hit.

Recursion between step-up and step-down is structurally impossible. Attempt budgets belong to the
driver and every exhausted budget has one named outcome.

### Authoritative Result

Each solved step produces one composite result containing:

- committed pose and interior cell;
- achieved linear motion;
- contact classification;
- the minimal contact memory needed by the next step; and
- explicit missing-coverage state.

The host and frontend consume these facts; they do not re-derive them.

## North Stars

1. Physical fly and grounded walk share geometry and bounded motion mechanics, not response policy.
2. Retail is an executable specification for grounded outcomes, not a source-language template.
3. A two-sphere grounded body has authored roles, not two interchangeable colliders.
4. Invalid solver modes are unrepresentable; a step-down query cannot execute step-up routing.
5. Every retained state value has one owner, one reader, and one expiry.
6. Missing collision coverage is observable and conservative; it never becomes empty space.
7. Pose, contact, and cell membership commit atomically.
8. Synthetic scenarios diagnose mechanisms; real-content aggregates detect regressions.
9. Shared contracts land with a concrete physical-camera consumer and remain camera-agnostic.
10. The existing frontend free-fly controller remains an independent, reliable escape path.

## Phased Implementation

### Phase 0: Canonical Baseline and Evidence Ledger

#### Deliverables

- Record the canonical baseline checks and current physical-camera absence in this plan.
- Re-read every donor artifact selected for the first vertical slice against current `3d-next`.
- Build a guarantee ledger for each donor mechanism removed or reshaped:
  - coverage hold and gravity suspension;
  - landblock crossing;
  - collision isolation and eviction;
  - building-shell suppression;
  - support selection;
  - cell transit;
  - bounded sliding;
  - free-fly mode handoff.
- Complete a targeted census of retail's collision-query dispatcher and the per-tick movement driver.
- Record data distributions that affect algorithm choice: collider counts per landblock, BSP shapes,
  authored scales and sphere counts, cell-volume counts, and broad-phase rejection rates on
  representative content.
- Record the retail evidence that assigns low-point/support semantics to sphere zero, upper-body
  constraint semantics to sphere one, and caps motion at two spheres.

#### Task Checklist

- [x] Run canonical Rust, frontend, and browser-harness baselines without running the TUI.
- [x] Clear the canonical frontend Prettier debt before Phase 1 implementation.
- [x] Reproduce and isolate the donor-recorded parallel CLI test failure before Phase 1.
- [x] Verify donor reference citations used by the first two implementation phases.
- [x] Enumerate every production field planned for the collision artifact and name its consumer.
- [x] Decide the simplest adequate broad phase from measured content rather than donor structure.
- [x] Verify the recorded 5,935-setup sphere-count census and human body dimensions against the
      assets used for implementation.
- [x] Update the donor disposition table when any artifact changes category.

#### Acceptance Criteria

- [x] Every planned shared field and query names the phase and production path that first consume it;
      Phase 1 lands no dormant two-sphere fields ahead of the grounded implementation.
- [x] Every guarantee of the rejected donor solvers has a replacement phase or an explicit
      out-of-scope decision.
- [x] The one-or-two-sphere limit and asymmetric sphere roles have attributable retail and content
      evidence.
- [x] No implementation code has been transplanted before the evidence and consumer audit closes.

#### Decisions and Course Corrections

##### Canonical baseline

The baseline was run from recovery commit `11115558` over canonical `3d-next` commit `41b164ab`.
The only recovery-branch source change before these checks was this plan; the existing `ACE`
submodule worktree drift was not touched. The interactive TUI was not run.

| Check | Result | Evidence or baseline debt |
| --- | --- | --- |
| `cargo fmt --all --check` | Pass | No Rust formatting drift. |
| `cargo clippy --workspace --all-targets -- -D warnings` | Pass | No warnings. |
| `cargo test --workspace` | Pass after test isolation | The sandbox initially denied the scripting tests' local listener; the unrestricted rerun passed. The intermittent CLI failure described below was separately reproduced and fixed. |
| `npm run format:check` in `apps/holtburger-3d` | Pass after cleanup | The initial check reported 30 files; `npm run format` corrected them and the exact check then passed. |
| `npm run check` | Pass | Zero errors and zero warnings. |
| `npm run lint` | Pass | TypeScript lint, `knip`, and Rust clippy passed. |
| `npm run test:ts` | Pass | 150 files and 1,022 tests passed. |
| `npm run build` | Pass | Build passed; the existing greater-than-500-kB chunk advisory remains. |
| Browser harness over landblock `0xda55ffff` | Pass | Product content reached `ready: true`, loaded all nine requested source batches, matched 299 expected/299 loaded EnvCells, and emitted no console messages. |

The browser harness used one-block content radii, a 3-second settle, a 1-second measurement window,
and deterministic Vite port 14831. The sandbox denied its local HTTP listener, so the same command
was rerun unrestricted. The measured tick mean was 10.74 ms and the render-frame mean was 6.03 ms
under SwiftShader; these are environment baselines, not physics budgets. A canonical symbol census
found no physical-fly controller, grounded-walk controller, host camera body, or retained collision
probe path in `apps` or `crates`.

The initial frontend format failure was promoted to a Phase 0 prerequisite before implementation.
The app-owned formatter changed exactly the 30 reported files: 135 inserted and 60 removed lines of
wrapping and indentation. Diff review found no import reordering, value changes, generated files, or
files outside `apps/holtburger-3d/src`. The post-format `format:check`, Svelte/TypeScript checks,
ESLint/`knip`/Rust clippy lint chain, 1,022 TypeScript tests, and production build all passed. The
existing greater-than-500-kB build advisory remains non-blocking and unchanged.

The donor also recorded an unrelated pre-existing `holtburger-cli` test flake in commit `2b00a694`.
Canonical reproduced it on the fifth run of a planned 12-run CLI-library stress check: the
`rust_log_messages_do_not_re_echo_into_debug_log` assertion observed `"[INFO] chat 3"` from another
parallel test, then its panic poisoned the process-global capture mutex and produced 43 collateral
`PoisonError` failures. The production logger was not at fault; the test harness incorrectly used one
process-global `Mutex<Vec<String>>` both as the facade's capture sink and as each test's private
assertion state.

The isolated donor correction was adapted in
`apps/holtburger-cli/src/pages/game/panels/chat.rs`: the `log` facade still owns one process-wide
logger, while captured records are now thread-local to the emitting test. No production chat path or
TUI binary behavior changed. The 18 focused chat tests passed, followed by 12 consecutive full
358-test CLI-library runs, workspace clippy with warnings denied, and the full workspace test suite.
The donor's unrelated `tui.rs` physics rename, dependency updates, and lockfile churn were not taken.

##### Donor pacing evidence

Gate A evidence from the synchronized `claude` donor was rechecked. Predicted solved segments are
the retained transport shape and 30 Hz is the host target; 20 Hz remains an acceptable measured
floor, not the default.

| Run | Delivery | Host rate | Segments | Dropped/starved | Latency p50/p95/max | Correction p50/p95 |
| --- | --- | ---: | ---: | --- | --- | --- |
| A | Predicted segment | 60 Hz | 601 | 0/0 | 9/18/19 ms | 0.3/6.7 cm |
| B | Per-frame pose | 20 Hz | 201 | 0/0 | 25/50/51 ms | 20.0/20.0 cm |
| C | Predicted segment | 20 Hz | 201 | 0/0 | 24/47/50 ms | 4.4/25.4 cm |
| D | Predicted segment | 30 Hz | 301 | 0/0 | 18/31/34 ms | 4.9/16.2 cm |

All 1,505 segments across the four recorded runs arrived without a drop or starvation event; measured
transport overhead stayed below 1.02 ms. Phase 1c retains the diagnostic sequence/gap counters but
does not add protocol ordering machinery. Corrections snap for the first slice; visual blending stays
deferred until a product trace shows snap artifacts. These figures exclude the recovered solver cost,
so Phase R1 must decide acceleration from the real host tick attribution rather than these numbers.

##### Retail movement and query census

The following conclusions were checked directly against `acclient.c`:

- `CPhysicsObj::update_object` at `acclient.c:311146` partitions elapsed time into bounded quanta and
  invokes `UpdateObjectInternal`; `UpdateObjectInternal` at `acclient.c:310815` integrates the
  requested pose, runs transition when a sphere body moved, computes achieved velocity from the
  solved displacement, and commits only the successful pose.
- `CTransition::find_transitional_position` at `acclient.c:301820` owns bounded substeps and resets
  per-substep collision state. `transitional_insert` at `acclient.c:301488` distinguishes ordinary
  collision, step-down/support, edge slide, negative-polygon/step-up, placement confirmation, and
  other-cell checks. The recovery retains the observable ordering as explicit finite phases, not the
  donor's flags or retail's recursive retry topology.
- `BSPTREE::find_collisions` at `acclient.c:346347` dispatches placement, walkability, step-down,
  grounded lower-sphere step-up, grounded upper-sphere slide/back-face, and ordinary movement through
  distinct paths. `step_sphere_up` at `acclient.c:346113` and `step_sphere_down` at
  `acclient.c:346231` are not interchangeable generic sphere casts.
- `SPHEREPATH::init_sphere` at `acclient.c:302241` caps motion at the first two authored spheres and
  derives the body low point from sphere zero. `cache_global_sphere` at `acclient.c:302345` transforms
  both retained centers. The upper-sphere negative-polygon producers are confined to the two-sphere
  branches at `acclient.c:346504` and `acclient.c:346510`.
- `CObjCell::find_cell_list` at `acclient.c:332969` tests the full retained sphere set and preserves
  previous-cell context. `CEnvCell::find_visible_child_cell` at `acclient.c:335547` prefers the
  current cell and then bounded child/portal traversal. Candidate cell selection and pose therefore
  form one commit.
- `SmartBox::set_viewer_home` at `acclient.c:138168` gives the player pivot a 1.500 m vertical offset;
  `CameraManager::QueryPivotPosition` at `acclient.c:141105` transforms that offset from the player
  pose. `CameraSet::SetInHead` at `acclient.c:142853` also authors a separate 0.180 m forward viewer
  offset. Explorer adopts the evidenced 1.500 m human eye height only; forward framing remains a
  separate app-camera concern with no current requirement.

##### Authored body census

The census decoded all 5,935 setup models in `dats/assets.hba` without failure. Ordinary sphere counts
are `{0: 2325, 1: 3000, 2: 579, 3: 11, 4: 14, 5: 6}`; cylsphere counts are
`{0: 5257, 1: 547, 2: 105, 3: 12, 4: 10, 5: 1, 7: 3}`. Three hundred eight setups have at least one
non-unit default-part scale, so placed collision transforms must retain authored scale even though the
representative landblocks below are overwhelmingly unit scale.

ACE identifies human male `0x02000001` and human female `0x0200004e`; both assets author the same
motion body: height 1.835 m, radius 0.679 m, step-up 0.600 m, step-down 1.500 m, no cylspheres, and the
following two ordinary spheres:

| Role | Local center | Radius | Vertical extent |
| --- | --- | ---: | --- |
| Lower/support | `(0, 0, 0.475)` m | 0.480 m | -0.005 to 0.955 m |
| Upper/constraint | `(0, 0, 1.350)` m | 0.480 m | 0.870 to 1.830 m |

This independently confirms the retail cap and asymmetry while sizing Explorer's fixed grounded body.
The authored step reaches remain inputs to the Phase 2 behavior audit rather than being inferred as
camera collision geometry.

##### Representative collision distributions

The donor diagnostic assembly was temporarily instrumented and run against four deliberately
different landblocks from `dats/assets.hba`. It decodes the same terrain, outdoor, generated, and
interior records but does not establish product-path parity; that remains a Phase 1/6 requirement.
BSP values are min/p50/p95/max per placed shape. Broad-phase rejection is the fraction of
placement/probe pairs rejected by the existing placed-shape bounding sphere before BSP traversal.

| Landblock | Placements (distinct shapes) | Buildings | Cell volumes | BSP nodes | BSP depth | Scale | Bounds radius | Broad rejection |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | ---: |
| `da55` | 575 (208) | 42 | 236 | 11/13/137/695 | 6/7/19/30 | 1/1/1/1 | 0.375/1.438/12.117/18.655 m | 99.14% |
| `7d64` | 293 (103) | 8 | 116 | 11/19/83/527 | 6/10/13/63 | 1/1/1/1.065 | 0.508/1.446/7.675/13.826 m | 98.45% |
| `1a73` | 649 (72) | 1 | 518 | 9/13/25/133 | 5/7/13/18 | 1/1/1/1 | 0.535/4.863/9.654/11.782 m | 99.56% |
| `3f32` | 147 (73) | 2 | 52 | 13/13/39/695 | 7/7/19/27 | 1/1/1/1 | 0.508/1.660/8.304/18.566 m | 95.21% |

The corresponding BSP leaf maxima were 348, 264, 67, and 348; resolved-polygon maxima were 309,
262, 51, and 310. No sampled cell volume had a degenerate portal spine. This is enough structure to
justify BSP traversal after broad-phase admission, but only 147-649 placed colliders per sampled
landblock and 95.21-99.56% rejection from the existing bounds test. Phase 1 therefore starts with a
linear placement scan plus per-collider bounding spheres. No second spatial index lands until Phase R1
host tick attribution demonstrates a product bottleneck.

##### Phase 1 field and query consumer ledger

The public Phase 1 artifact is deliberately narrower than the donor artifact. Grounded-only support,
walkability, water, edge, step, sphere-role, and retained-contact facts do not land in Phase 1 merely
because decoded content can provide them.

| Planned fact | First phase | First production consumer |
| --- | --- | --- |
| Landblock owner key and completeness | 1a | `ContentAssetService::resolve_collision` atomically assembles one residency unit. |
| Terrain collision triangles with authored diagonal and bounds | 1a/1b | Physical-fly obstruction query blocks floor, wall, and terrain crossings. |
| Placed shape transform and authored scale | 1a/1b | Physical-fly query transforms a candidate sphere into BSP object space. |
| Shape BSP and polygon geometry | 1a/1b | Physical-fly obstruction and separation return the first usable static contact. |
| Shape bounding sphere | 1a/1b | Linear broad phase rejects placements before BSP traversal. |
| Shape source identity and building-shell classification | 1a/1b | Contact diagnostics attribute a hit; candidate-cell context controls shell suppression. |
| Cell selector, containment planes, placement, and portal-neighbor selectors | 1a/1b | Prior-cell-aware transit selects the cell committed with the physical-fly pose. |
| Explicit coverage result | 1b | Physical-fly solve and Phase 1c residency hold the last safe pose on a gap. |
| Obstruction contact normal, separation, source, and travel fraction | 1b | Bounded physical-fly separation and multi-plane slide compute one solved result. |
| Placement result | 1b | Physical-fly registration/handoff rejects an embedded starting pose without inventing support. |
| Candidate interior cell | 1b | Atomic physical-fly pose/cell commit and building-shell decision. |
| Solved pose, achieved motion, contacts, cell, coverage, and finite-budget outcome | 1b/1c | Host predicted segment and Explorer diagnostics/presentation. |
| Physical-fly sphere radius and body-reference offset | 1c | App-local registration configures the Explorer camera body consumed by the host solver. |
| Registered body id, last safe pose, intent sequence, validity horizon, and tick timestamp | 1c | Host camera driver and frontend predicted-segment session. |

Phase 2 specifies grounded facts; Phase 3 is the first production consumer for support sphere roles,
gravity, walkability, support/contact memory, and the authored lower/upper pair. Phase 4 first consumes
step, negative-polygon, edge-protection, and pair-aware grounded transit facts. These fields must be
added with those consumers, not preloaded into the Phase 1 public contract. Decoded source records may
remain lossless inside `holtburger-content`; lossless parsing is not permission to expose dormant
world-motion fields.

The required Phase 1 query families and their consumers are coverage lookup (1b physical-fly hold),
movement obstruction (1b physical-fly slide), placement confirmation (1b registration/handoff), and
prior-cell-aware transit (1b atomic pose/cell commit). Support/step-down is specified in Phase 2 and
first becomes public with the Phase 3 implementation. Query roles remain separate composite request
types; there is no boolean mode product.

##### Guarantee replacement ledger

| Rejected or reshaped guarantee | Replacement owner and phase |
| --- | --- |
| Coverage hold and gravity suspension | Phase 1b returns explicit `MissingCoverage`; physical fly holds the last safe pose. Phase 3 applies the same gate before grounded integration, so gravity and requested motion do not accumulate through a gap. Phase 1c/5 expose the state. |
| Landblock crossing | Existing `Position` crossing primitives plus Phase 1c collision residency load every landblock touched by the swept body bounds before Phase 1b solves. Incomplete coverage takes the hold path. Phase 4 extends the swept set to both grounded spheres. |
| Collision isolation and eviction | Phase 1a makes one complete landblock artifact the insertion/removal unit. Phase 1c owns collision residency separately from render interest and evicts terrain, shapes, and volumes together by owner key. |
| Building-shell suppression | Phase 1b derives suppression from the interior candidate reached by transit, never the previously committed camera cell alone, and atomically commits the candidate pose and cell. |
| Support selection | Explicitly out of the physical-fly response. Phase 2 attributes the rule; Phase 3 chooses reachable lower-sphere support relative to the prior solved pose from lossless contacts. Upper-sphere contacts may constrain but never provide support. |
| Cell transit | Phase 1b checks the prior cell and portal neighbors first, then the explicitly bounded outdoor-entry path, over the full physical body coverage. Pose and cell commit together. Phase 4 adds the grounded pair scenarios. |
| Bounded sliding | Phase 1b owns finite substep/contact budgets and iterative multi-plane physical-fly sliding. Phase 3 composes grounded wall/upper-sphere response into the same bounded driver. No operation re-enters the top-level solver. |
| Free-fly mode handoff | Phase 1c's app coordinator seeds the registered physical body from the presented free-fly pose; exit seeds frontend free fly from the presented solved pose and clears incompatible physical state. Phase 5 applies the same explicit reseat among all three modes. |

Dynamic body collision, restitution, jumping, swimming, and animation-root motion remain explicitly out
of scope; no rejected donor guarantee for those mechanisms is replaced here.

##### Donor disposition after audit

No selected file changed its top-level category, but the adaptation boundary narrowed:

- `terrain_topology.rs`, `object_collision.rs`, landblock/interior assembly, and
  `LandblockColliders::absorb` remain selective reimplementations against current content types.
- `terrain_collision.rs` contributes Phase 1 obstruction geometry only. Water/support/edge-facing
  public fields wait for an attributed grounded consumer.
- `bsp_query.rs` and `collision.rs` remain selective reimplementations, but the donor's combined
  query flags, singleton sphere assumptions, independent partial merges, and current-cell building
  suppression are rejected. Linear placed-shape broad phase is retained until measured otherwise.
- Host pacing and predicted-segment concepts remain selective; donor Explorer files are not
  transplanted over the canonical SAO-era coordinator and runtime.
- `collision_scene_probe` remains useful evidence to adapt to the product assembly path. The temporary
  Phase 0 setup and distribution instrumentation has no continuing production consumer and is removed
  after this ledger is recorded.
- The donor's `chat.rs` captured-log isolation fix was independently reproduced and selectively
  adapted as Phase 0 test-harness maintenance. Its neighboring TUI rename and dependency churn remain
  rejected.

Phase 0 transplanted no physics or product implementation code; the only adapted donor code is the
independently reproduced test-harness isolation fix above. Phase 1 may now begin at 1a without a
blocking design decision; the final maintainer-selected outdoor/interior verification route remains a
Phase 6 product verification input, not an implementation blocker.

### Phase 1: Physical-Fly End-to-End Vertical Slice

This phase is one landing gate with three internal checkpoints. Collision ingestion and queries may
compile during 1a/1b, but the phase does not close or merge as dormant infrastructure until the
physical camera consumes them through the product path in 1c.

#### Phase 1a: Collision Content Assembly

##### Deliverables

- Typed terrain topology and obstruction triangles in `holtburger-content`; grounded support facts
  are added only with their Phase 3 consumer.
- Typed placed collision shapes for explicit objects, generated scenery, buildings, EnvCell shells,
  and indoor statics.
- Cell volumes and portal-neighbor facts required for later atomic cell transit.
- One complete `LandblockColliders` merge operation that cannot silently drop a field.
- `ContentAssetService::resolve_collision` as the canonical product assembly path.

##### Acceptance Criteria

- [ ] Terrain collision triangulation matches the renderer's authored diagonal rule on exhaustive
      synthetic cells and representative content.
- [ ] Every authored collision record in the selected representative landblocks is consumed or
      reported with a measured reason it is inert.
- [ ] App and diagnostic callers cannot merge terrain, colliders, or cell volumes independently.

#### Phase 1b: Static Collision World and Physical-Fly Kernel

##### Deliverables

- A collision scene in `holtburger-world` consuming parsed artifacts without DAT paths.
- Explicit coverage, movement-obstruction, placement, and prior-cell-aware transit queries.
- A bounded single-sphere physical-fly kernel implementing collision separation and multi-plane
  sliding through query primitives that do not bake a single sphere into collision-world state.
- A physical-fly response with no grounded state or grounded code path.
- Atomic pose and interior-cell commit, including building-shell suppression driven by the candidate
  cell context.
- Synthetic scenarios for open movement, wall impact, oblique slide, corner contact, ceiling/floor
  contact, retreat, high-speed tunneling bounds, landblock crossing, interior entry/exit, and missing
  coverage.

##### Acceptance Criteria

- [ ] Physical fly never invokes support, step, slope, or edge-protection queries.
- [ ] A body can retreat immediately from every blocking contact used in the fixtures.
- [ ] Missing coverage holds the body, reports the gap, and accumulates no hidden gravity or motion.
- [ ] Physical fly enters, traverses, and leaves linked interior cells without cell flicker or a
      second placement model.
- [ ] Building shells concede only from the cell context committed with the candidate pose.
- [ ] Attempt and substep budgets are finite and fixture-observable.
- [ ] No solver recursion exists.

#### Phase 1c: Host and Explorer Physical Fly

##### Deliverables

- App-local host runtime with fixed tick, camera body registration, collision residency, and typed
  physical-fly intent.
- Predicted motion segments evaluated by the frontend per render frame.
- Physical-fly mode integrated beside the existing frontend free-fly controller.
- Explicit handoff that seeds the physical body from the presented camera pose and returns cleanly to
  frontend free fly.
- Tuning UI limited to concrete Explorer consumers.

##### Acceptance Criteria

- [ ] The real Explorer can enter physical fly, collide and slide against outdoor and interior
      geometry, and return to frontend free fly without a pose jump.
- [ ] Pitch-relative flight remains Explorer policy; `holtburger-world` receives world-space intent.
- [ ] Collision coverage follows the camera independently of render scene interest.
- [ ] Host/frontend transport retains the donor Gate A validity-horizon and bounded-extrapolation
      guarantees.
- [ ] Current SAO controls and Explorer panels remain functional.

#### Decisions and Course Corrections

To be filled during execution.

### Phase R1: Physical-Fly Resteer

#### Review

- Inspect the landed API for camera-shaped leakage and unused collision facts.
- Verify that adding the grounded body's upper sphere requires composition of the landed explicit
  query primitives, not replacement of a single-sphere collision-world contract.
- Compare the measured physical-fly behavior with the intended UX, not retail walking behavior.
- Re-run the remaining phases as a dry run against the actual query/result types.
- Reassess whether the collision scene needs additional acceleration based on measured tick cost.
- Stop for review if grounded behavior would require weakening or bypassing physical-fly invariants.

#### Acceptance Criteria

- [ ] Physical fly is a complete, usable vertical slice rather than scaffolding for walk mode.
- [ ] Every shared contract has a current product consumer.
- [ ] The grounded plan can be expressed as an additional response policy over the landed kernel.
- [ ] No public world-state or query contract assumes that every future physical body has exactly
      one sphere.

### Phase 2: Grounded Behavioral Specification and Scenario Ladder

No grounded implementation begins until its expected outcomes are attributable.

#### Deliverables

- A control-flow map of the retail per-tick driver and each collision-query family the grounded
  scenarios reach.
- A scenario ladder ordered by dependency, with expected outcomes and `acclient.c` citations:
  1. free fall with coverage;
  2. fall onto flat ground;
  3. remain at rest without drift or jitter;
  4. walk on flat ground;
  5. walk into a wall, slide, stop, and retreat;
  6. walk up and down a shallow ramp;
  7. meet a face too steep to stand on;
  8. constrain and slide a two-sphere body when only its upper sphere contacts a wall or overhang,
     then retreat immediately;
  9. walk off or be held at a ledge, with and without creature protection;
  10. step onto a low obstruction;
  11. fail to step onto a high obstruction and retreat;
  12. route a second-sphere back-face contact through the cited negative-polygon step behavior;
  13. meet a corner where constraints intersect;
  14. cross a landblock boundary while walking and falling, including coverage touched only by the
      upper sphere;
  15. enter, traverse, and leave linked interior cells through a doorway or ceiling constraint that
      distinguishes one sphere from two;
  16. lose and regain collision coverage.
- A guarantee table describing the observable effect of suppressing each mechanism.

#### Task Checklist

- [ ] Derive each expectation from retail rather than current donor output.
- [ ] Identify which sequence dependencies are observable and which retail structure is irrelevant.
- [ ] Cite every branch where sphere count changes step, slide, negative-polygon, coverage, or cell
      transit behavior; do not generalize from the single-sphere path.
- [ ] Define the smallest synthetic geometry that isolates each rung.
- [ ] Prove each fixture would fail when its named mechanism is locally suppressed during
      development; do not retain mutation-only machinery.

#### Acceptance Criteria

- [ ] No scenario uses a doorway aggregate as its expected result.
- [ ] Each failure message names exactly one failure mode.
- [ ] No test requires untracked runtime assets.
- [ ] The implementation can proceed one rung at a time without inventing an uncited behavior.
- [ ] Pair scenarios separately prove lower/support and upper/constraint behavior; no expectation
      treats the spheres as interchangeable.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 3: Grounded Controller Core

#### Deliverables

- A `Grounded` response variant carrying only grounded policy.
- Gravity and per-tick integration matching the censused observable contract.
- Support acquisition, stable rest, ground following, walkability classification, wall obstruction,
  wall slide, and contact transitions.
- A bounded `GroundedBodySpheres` implementation with lower/support and optional upper/constraint
  roles; upper-sphere obstruction and sliding participate in the same finite attempt budget.
- Minimal retained contact memory with explicit expiry.
- Scenario ladder rungs 1-8 passing through the public solver entry point for both the one-sphere
  baseline and the two-sphere production shape where applicable.

#### Acceptance Criteria

- [ ] Physical-fly fixtures remain unchanged and green.
- [ ] Grounded state is computed once by the grounded response and returned in the solved contract.
- [ ] A blocked body reports achieved rather than requested velocity.
- [ ] Retreat from a wall cannot be blocked by stale contact state.
- [ ] Contact memory clears on the exact step its validity expires.
- [ ] No physical-fly body can acquire support or report grounded contact.
- [ ] Upper-sphere contact cannot replace or fabricate lower-sphere support.
- [ ] A two-sphere body can retreat from an upper-only obstruction without stale contact blocking it.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 4: Steps, Edges, and Grounded Cell Transit

#### Deliverables

- Explicit, non-recursive step-up and step-down operations.
- Second-sphere back-face reporting and negative-polygon routing only where a cited grounded
  scenario consumes them.
- Placement confirmation after successful step resolution.
- Cliff and precipice behavior required by grounded scenarios.
- Grounded composition with the landed atomic pose/contact/cell commit and building-shell
  suppression contract.
- Scenario ladder rungs 9-16 passing.

#### Acceptance Criteria

- [ ] A step-down query cannot route to step-up by construction.
- [ ] Failed step-up preserves valid footing and permits immediate retreat.
- [ ] Successful step-up cannot tunnel through the obstructing face.
- [ ] Protected and unprotected ledge behavior differ only in the scenario that consumes the policy.
- [ ] Interior cell membership changes only through the previous cell or its portal neighbors,
      except for the explicitly measured outdoor-entry path.
- [ ] The committed pose, contact, and cell always describe the same solved candidate.
- [ ] Missing coverage during a boundary crossing cannot move the body into unloaded space.
- [ ] Coverage and candidate cell traversal include cells reached by either sphere, while the
      previous-cell/portal-neighbor rule remains authoritative.
- [ ] The upper sphere can veto a step or placement without becoming the body's support sphere.

#### Decisions and Course Corrections

To be filled during execution.

### Phase R2: Grounded Resteer and Architecture Audit

#### Review

- Audit every response-policy field for a current reader.
- Audit every query-result field for a scenario where it differs from another field.
- Audit every sphere-role branch against the scenario that requires it; reject generic
  compound-collider machinery and duplicated one-sphere solve loops.
- Compare the grounded implementation with retail outcomes and remove structural mimicry that has
  no observable consumer.
- Dry-run host integration and real-content verification using the completed scenario ladder.
- Stop if any aggregate regression cannot be reduced to a focused scenario before changing design.

#### Acceptance Criteria

- [ ] The grounded controller passes the complete synthetic ladder.
- [ ] No donor `TransitionModes`, numeric transition enum, or recursive query structure survives.
- [ ] Physical fly and grounded walk share only demonstrably common mechanics.
- [ ] One- and two-sphere grounded bodies pass the complete ladder through the same public grounded
      entry point.

### Phase 5: Explorer Grounded-Walk Integration

#### Deliverables

- Grounded-walk host mode using the same registered camera body and transport as physical fly.
- App-owned mode mapping and fixed body dimensions: one physical-fly sphere and a grounded
  lower/upper pair, plus walk speed, step reach, and presentation height.
- Mode handoff among frontend free fly, physical fly, and grounded walk.
- Clean reseating that clears incompatible velocity and contact state.
- Explorer diagnostics exposing mode, contact, cell, coverage, and solved pose without steering the
  solver.

#### Acceptance Criteria

- [ ] Physical fly and grounded walk can be switched repeatedly without stale gravity, support, or
      sliding state crossing the boundary.
- [ ] The frontend camera presentation applies the intended eye offset instead of treating the
      support-sphere center as an undocumented eye position.
- [ ] Frontend code never solves collision or re-derives grounded state.
- [ ] Existing frontend free fly remains the default and can recover from any physical placement.
- [ ] The host remains the sole authority for physical-camera motion.
- [ ] Grounded walk exercises `upper: Some(_)` through the real host/product path; two-sphere support
      is not test-only infrastructure.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 6: Product-Path Content Verification and Tuning

#### Deliverables

- Focused probes that call the same `ContentAssetService::resolve_collision` path as the host.
- Named real-content scenarios for outdoor walls, buildings, door thresholds, interior floors,
  corners, ledges, low ceilings, landblock boundaries, and portal-linked cell transit.
- Aggregate doorway and wedge surveys retained only as regression detectors.
- Tick CPU attribution under representative collision residency.
- A maintainer-driven Explorer verification protocol with exact scenes and expected observations.

#### Acceptance Criteria

- [ ] Every real-content failure is reproduced by a focused trace before implementation changes.
- [ ] A harness/app disagreement is treated as an assembly defect until disproven.
- [ ] Physical fly reaches valid authored spaces without grounded policy interfering.
- [ ] Grounded walk handles the focused outdoor and interior scenarios without wall tunneling,
      support lift, permanent wedge, or cell flicker.
- [ ] At least one doorway or overhang probe distinguishes the grounded pair from its lower sphere
      alone and matches the cited retail outcome.
- [ ] Aggregate probes do not regress from their recorded recovery baseline without an attributable
      scenario.
- [ ] The maintainer confirms both physical modes in the real Explorer.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 7: Cleanup, Cutover, and Roadmap Reconciliation

#### Deliverables

- Remove obsolete names, dead tests, donor vocabulary, temporary diagnostics, and unused exports.
- Keep focused debug harnesses only where they have a continuing reverse-engineering consumer.
- Revert incidental donor lockfile and generated-schema changes unless a deliberate dependency
  change was separately authorized.
- Rename the existing unconstrained `BasicSpatialPhysics` only if the final peer naming makes the
  current name misleading; perform a complete vocabulary sweep if renamed.
- Update the dynamic-entity roadmap and spawned-entity plan to consume the landed host topology,
  without pre-building spawned behavior.
- Record every deliberate retail quirk or divergence using the repository marker convention.

#### Acceptance Criteria

- [ ] No rejected donor mechanism or stale vocabulary survives in code, tests, UI, metrics, or
      current documentation.
- [ ] No public transition machinery exists without a consumer outside its defining module.
- [ ] No test depends on ignored runtime assets.
- [ ] Rust formatting, clippy with warnings denied, workspace tests, frontend formatting, lint,
      type checks, unit tests, and required browser/Tauri harnesses pass.
- [ ] The final diff contains no unrelated dependency refresh or generated-schema churn.
- [ ] The parent roadmap honestly records what landed and what remains queued.

#### Decisions and Course Corrections

To be filled during execution.

## Risks and Mitigations

### Retail evidence becomes architecture by osmosis

Mitigation: record expected outcomes before types; require a current consumer for every field; retain
retail ordering only when a focused scenario proves it changes behavior.

### Physical fly becomes grounded walk with gravity disabled

Mitigation: separate response variants and test that physical fly cannot invoke support, step, slope,
or edge paths.

### A generic query erases behavior-bearing distinctions

Mitigation: use explicit composite query types for movement, support/step-down, placement, coverage,
and cell transit. Exhaustive dispatch makes an omitted role a compile error.

### The sphere pair becomes a generic compound collider

Mitigation: model one required lower/support sphere and one optional upper/constraint sphere. Keep
support, low-point, step, upper obstruction, and negative-polygon consumers explicit. Do not expose
`Vec<Sphere>`, arbitrary collider counts, or a symmetric "earliest contact wins" abstraction.

### Solver recursion or retry explosion returns

Mitigation: one iterative driver owns finite substep and contact budgets; no operation calls the
top-level solver recursively.

### Synthetic fixtures pass while the app is broken

Mitigation: all real-content probes consume the same product collision assembly path; app/harness
disagreement is itself a failing integration scenario.

### Real-content aggregates drive patchwork

Mitigation: aggregates detect regressions only. Every fix requires a minimal attributed scenario and
a measured before/after outcome for that scenario.

### Collision content broadens the shared API prematurely

Mitigation: Phase 1 is one end-to-end landing gate. Shared types are not considered landed until the
physical-fly product path consumes them.

### Missing coverage causes falling or tunneling

Mitigation: `MissingCoverage` is a first-class solve result with dedicated synthetic and boundary
crossing scenarios; the host exposes it and retains the last safe pose.

### Camera tuning is mistaken for player-body semantics

Mitigation: camera dimensions and step reach remain app policy, even though the grounded camera uses
the same bounded lower/upper topology as authored creature motion. A future player body derives its
exact dimensions and movement allowances from gameplay/setup data through a separate consumer.

### Canonical frontend changes conflict with donor-era Explorer wiring

Mitigation: reimplement against current `3d-next`; do not transplant the four overlapping Explorer
and tuning files wholesale.

## Definition of Done

- [ ] Physical fly and grounded walk are distinct typed response policies over one shared static
      sphere-body motion kernel.
- [ ] Existing frontend free fly remains available, default, and independent.
- [ ] Collision content includes terrain, authored and generated objects, buildings, interiors, and
      cell volumes through one product assembly path.
- [ ] Missing coverage is conservative, observable, and cannot accumulate hidden motion.
- [ ] Physical fly collides and slides in three dimensions without grounded behavior.
- [ ] Grounded walk passes every cited synthetic scenario, including failed-step retreat and
      interior cell transit.
- [ ] The grounded production path supports one required lower/support sphere and one optional
      upper/constraint sphere, and the Explorer grounded camera exercises the two-sphere case.
- [ ] Two-sphere obstruction, retreat, stepping, coverage, and cell transit pass focused scenarios;
      the upper sphere never becomes support.
- [ ] Pose, contact, and cell commit atomically.
- [ ] Real-content probes consume the product assembly path and remain regression detectors rather
      than design drivers.
- [ ] The real Explorer passes maintainer verification in both physical modes within the accepted
      motion-boundary envelope.
- [ ] Shared crates contain no camera UX policy and the frontend contains no collision solving.
- [ ] No dormant fields, unused public transition types, accidental dependency upgrades, or
      permanent runtime-asset tests remain.
- [ ] All repository-required static, unit, browser, Tauri, formatting, and lint checks pass.
- [ ] The dynamic-entity roadmap and spawned plan consume the landed topology honestly.

## Open Questions

1. Which representative outdoor and interior locations should form the maintainer's final Explorer
   verification route?
