# Holtburger 3D Host Physics and Physical Camera Recovery Plan

Status: In progress — world-owned placement-aware motion-path cutover approved; implementation pending
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
existing frontend free-fly camera as the nonphysical escape path and establishing placement-aware
motion mechanics suitable for future players, creatures, missiles, spells, and other physical
dynamic entities.

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
7. Landblock `0xda55ffff` is the primary maintainer verification environment. Phase 6 selects an
   exact outdoor-to-interior route within `da55` from product-path traces and adds another landblock
   only when `da55` cannot exercise a named mechanism.

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
- A camera-agnostic world motion-path contract that preserves ordered position and placement changes
  within one fixed solve tick.
- An app-local host camera driver, collision residency policy, typed intent commands, and physical-
  camera events adapting that shared path for frontend presentation.
- Explorer controls for physical fly and grounded walk alongside the existing frontend free-fly
  controller.
- Synthetic scenario fixtures derived from retail behavior and product-path diagnostic probes over
  real content.
- Clean convergence with the current `3d-next` Explorer and SAO controls.

### Out of Scope

- Dynamic body-versus-body collision, restitution, projectiles, ragdolls, or a general rigid-body
  engine.
- Spawned-entity lifecycle, appearance, motion tables, or frontend entity mirroring.
- A generic entity event stream, replication policy, or missile/creature/player controller built in
  anticipation of future consumers; this recovery lands only the shared placed-motion primitive.
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

| Concern                           | Authority                                                          | Acceptance role                                                      |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Collision file interpretation     | ACE DatLoader, ACViewer, shipped content census                    | Defines decoded geometry and authored placement                      |
| BSP and polygon contact semantics | Retail decompile, then ACE/ACViewer as navigation aids             | Defines what static geometry blocks or supports                      |
| Grounded movement                 | Retail decompile                                                   | Defines observable outcomes and invariants                           |
| Physical-fly response             | Explorer product policy                                            | Defines no-penetration, sliding, reach, and control behavior         |
| Host/frontend motion boundary     | Measured donor Gate A evidence plus canonical runtime verification | Defines tick, solved-path playback, starvation, and handoff behavior |
| Crate and app ownership           | Canonical project architecture                                     | Defines where mechanics, content, composition, and UX live           |

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
Solved placed-motion path + contact + achieved motion
  holtburger-world camera-agnostic result
            |
            v
Physical-camera fixed-tick event
  app-local host adapter -> frontend presentation
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
- the committed support contact needed by the next step; and
- explicit missing-coverage state.

When a consumer must reproduce motion within that step, the reusable world representation is a
non-empty placed-motion path: one initial placed point plus ordered legs whose endpoints and
monotonic tick fractions are authoritative. Its constructor accepts the ordered accepted geometric
legs rather than assuming all motion is one endpoint chord, then adds placement-only splits. Thus it
can preserve a solver bend and a thin-cell entry/exit even when the tick begins and ends in the same
cell. The current viewer supplies one sought leg; a future physical-entity solver can supply its
accepted collision-response legs without changing the path contract. Runtime adapters may attach
cadence or serialization details, but they do not reclassify points or flatten intermediate
placement changes. Consumers do not re-derive these facts.

## North Stars

1. Physical fly and grounded walk share geometry and bounded motion mechanics, not response policy.
2. Retail is an executable specification for grounded outcomes, not a source-language template.
3. A two-sphere grounded body has authored roles, not two interchangeable colliders.
4. Invalid solver modes are unrepresentable; a step-down query cannot execute step-up routing.
5. Every retained state value has one owner, one reader, and one expiry.
6. Missing collision coverage is observable and conservative; it never becomes empty space.
7. Pose, contact, and cell membership commit atomically.
8. Synthetic scenarios diagnose mechanisms; real-content aggregates detect regressions.
9. Shared motion and placement contracts land with a concrete physical-camera consumer and remain
   reusable by future dynamic entities; camera offsets, cadence, transport, and UX remain app-local.
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

| Check                                                   | Result                    | Evidence or baseline debt                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo fmt --all --check`                               | Pass                      | No Rust formatting drift.                                                                                                                                                          |
| `cargo clippy --workspace --all-targets -- -D warnings` | Pass                      | No warnings.                                                                                                                                                                       |
| `cargo test --workspace`                                | Pass after test isolation | The sandbox initially denied the scripting tests' local listener; the unrestricted rerun passed. The intermittent CLI failure described below was separately reproduced and fixed. |
| `npm run format:check` in `apps/holtburger-3d`          | Pass after cleanup        | The initial check reported 30 files; `npm run format` corrected them and the exact check then passed.                                                                              |
| `npm run check`                                         | Pass                      | Zero errors and zero warnings.                                                                                                                                                     |
| `npm run lint`                                          | Pass                      | TypeScript lint, `knip`, and Rust clippy passed.                                                                                                                                   |
| `npm run test:ts`                                       | Pass                      | 150 files and 1,022 tests passed.                                                                                                                                                  |
| `npm run build`                                         | Pass                      | Build passed; the existing greater-than-500-kB chunk advisory remains.                                                                                                             |
| Browser harness over landblock `0xda55ffff`             | Pass                      | Product content reached `ready: true`, loaded all nine requested source batches, matched 299 expected/299 loaded EnvCells, and emitted no console messages.                        |

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

| Run | Delivery          | Host rate | Segments | Dropped/starved | Latency p50/p95/max | Correction p50/p95 |
| --- | ----------------- | --------: | -------: | --------------- | ------------------- | ------------------ |
| A   | Predicted segment |     60 Hz |      601 | 0/0             | 9/18/19 ms          | 0.3/6.7 cm         |
| B   | Per-frame pose    |     20 Hz |      201 | 0/0             | 25/50/51 ms         | 20.0/20.0 cm       |
| C   | Predicted segment |     20 Hz |      201 | 0/0             | 24/47/50 ms         | 4.4/25.4 cm        |
| D   | Predicted segment |     30 Hz |      301 | 0/0             | 18/31/34 ms         | 4.9/16.2 cm        |

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

| Role             | Local center      |  Radius | Vertical extent   |
| ---------------- | ----------------- | ------: | ----------------- |
| Lower/support    | `(0, 0, 0.475)` m | 0.480 m | -0.005 to 0.955 m |
| Upper/constraint | `(0, 0, 1.350)` m | 0.480 m | 0.870 to 1.830 m  |

This independently confirms the retail cap and asymmetry while sizing Explorer's fixed grounded body.
The authored step reaches remain inputs to the Phase 2 behavior audit rather than being inferred as
camera collision geometry.

##### Representative collision distributions

The donor diagnostic assembly was temporarily instrumented and run against four deliberately
different landblocks from `dats/assets.hba`. It decodes the same terrain, outdoor, generated, and
interior records but does not establish product-path parity; that remains a Phase 1/6 requirement.
BSP values are min/p50/p95/max per placed shape. Broad-phase rejection is the fraction of
placement/probe pairs rejected by the existing placed-shape bounding sphere before BSP traversal.

| Landblock | Placements (distinct shapes) | Buildings | Cell volumes | BSP nodes     | BSP depth  | Scale       | Bounds radius               | Broad rejection |
| --------- | ---------------------------: | --------: | -----------: | ------------- | ---------- | ----------- | --------------------------- | --------------: |
| `da55`    |                    575 (208) |        42 |          236 | 11/13/137/695 | 6/7/19/30  | 1/1/1/1     | 0.375/1.438/12.117/18.655 m |          99.14% |
| `7d64`    |                    293 (103) |         8 |          116 | 11/19/83/527  | 6/10/13/63 | 1/1/1/1.065 | 0.508/1.446/7.675/13.826 m  |          98.45% |
| `1a73`    |                     649 (72) |         1 |          518 | 9/13/25/133   | 5/7/13/18  | 1/1/1/1     | 0.535/4.863/9.654/11.782 m  |          99.56% |
| `3f32`    |                     147 (73) |         2 |           52 | 13/13/39/695  | 7/7/19/27  | 1/1/1/1     | 0.508/1.660/8.304/18.566 m  |          95.21% |

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

| Planned fact                                                                              | First phase | First production consumer                                                                                   |
| ----------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| Landblock owner key and completeness                                                      | 1a          | `ContentAssetService::resolve_collision` atomically assembles one residency unit.                           |
| Terrain collision triangles with authored diagonal and bounds                             | 1a/1b       | Physical-fly obstruction query blocks floor, wall, and terrain crossings.                                   |
| Placed shape transform and authored scale                                                 | 1a/1b       | Physical-fly query transforms a candidate sphere into BSP object space.                                     |
| Shape BSP and polygon geometry                                                            | 1a/1b       | Physical-fly obstruction and separation return the first usable static contact.                             |
| Shape bounding sphere                                                                     | 1a/1b       | Linear broad phase rejects placements before BSP traversal.                                                 |
| Building-shell classification                                                             | 1a/1b       | Candidate-cell context controls shell suppression without carrying dormant source provenance into contacts. |
| Cell selector, containment planes, placement, and portal-neighbor selectors               | 1a/1b       | Prior-cell-aware transit selects the cell committed with the physical-fly pose.                             |
| Explicit coverage result                                                                  | 1b          | Physical-fly solve and Phase 1c residency hold the last safe pose on a gap.                                 |
| Obstruction contact normal and separation                                                 | 1b          | Bounded physical-fly separation and multi-plane slide compute one solved result.                            |
| Placement result                                                                          | 1b          | Physical-fly registration/handoff rejects an embedded starting pose without inventing support.              |
| Candidate interior cell                                                                   | 1b          | Atomic physical-fly pose/cell commit and building-shell decision.                                           |
| Solved pose, achieved motion, cell, coverage, and finite-budget outcome                   | 1b/1c       | Host predicted segment and Explorer diagnostics/presentation.                                               |
| Physical-fly sphere radius and body-reference offset                                      | 1c          | App-local registration configures the Explorer camera body consumed by the host solver.                     |
| Registered body id, last safe pose, intent sequence, validity horizon, and tick timestamp | 1c          | Host camera driver and frontend predicted-segment session.                                                  |

Phase 2 specifies grounded facts; Phase 3 is the first production consumer for support sphere roles,
gravity, walkability, committed support state, and the authored lower/upper pair. Phase 4 first consumes
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

| Rejected or reshaped guarantee       | Replacement owner and phase                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage hold and gravity suspension | Phase 1b returns explicit `MissingCoverage`; physical fly holds the last safe pose. Phase 3 applies the same gate before grounded integration, so gravity and requested motion do not accumulate through a gap. Phase 1c/5 expose the state.                        |
| Landblock crossing                   | Existing `Position` crossing primitives plus Phase 1c collision residency load every landblock touched by the swept body bounds before Phase 1b solves. Incomplete coverage takes the hold path. Phase 4 extends the swept set to both grounded spheres.            |
| Collision isolation and eviction     | Phase 1a makes one complete landblock artifact the insertion/removal unit. Phase 1c owns collision residency separately from render interest and evicts terrain, shapes, and volumes together by owner key.                                                         |
| Building-shell suppression           | Phase 1b derives suppression from the interior candidate reached by transit, never the previously committed camera cell alone, and atomically commits the candidate pose and cell.                                                                                  |
| Support selection                    | Explicitly out of the physical-fly response. Phase 2 attributes the rule; Phase 3 chooses reachable lower-sphere support relative to the prior solved pose from lossless contacts. Upper-sphere contacts may constrain but never provide support.                   |
| Cell transit                         | Phase 1b checks the prior cell and portal neighbors first, then the explicitly bounded outdoor-entry path, over the full physical body coverage. Pose and cell commit together. Phase 4 adds the grounded pair scenarios.                                           |
| Bounded sliding                      | Phase 1b owns finite substep/contact budgets and iterative multi-plane physical-fly sliding. Phase 3 composes grounded wall/upper-sphere response into the same bounded driver. No operation re-enters the top-level solver.                                        |
| Free-fly mode handoff                | Phase 1c's app coordinator seeds the registered physical body from the presented free-fly pose; exit seeds frontend free fly from the presented solved pose and clears incompatible physical state. Phase 5 applies the same explicit reseat among all three modes. |

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

- [x] Terrain collision triangulation matches the renderer's authored diagonal rule on exhaustive
      synthetic cells and representative content.
- [x] Every authored collision record in the selected representative landblocks is consumed or
      reported with a measured reason it is inert.
- [x] App and diagnostic callers cannot merge terrain, colliders, or cell volumes independently.

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

- [x] Physical fly never invokes support, step, slope, or edge-protection queries.
- [x] A body can retreat immediately from every blocking contact used in the fixtures.
- [x] Missing coverage holds the body, reports the gap, and accumulates no hidden gravity or motion.
- [x] Physical fly enters, traverses, and leaves linked interior cells without cell flicker or a
      second placement model.
- [x] Building shells concede only from the cell context committed with the candidate pose.
- [x] Attempt and substep budgets are finite and fixture-observable.
- [x] No solver recursion exists.

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
- [x] Pitch-relative flight remains Explorer policy; `holtburger-world` receives world-space intent.
- [x] Collision coverage follows the camera independently of render scene interest.
- [x] Host/frontend transport retains the donor Gate A validity-horizon and bounded-extrapolation
      guarantees. Historical Phase 1c checkpoint; superseded by the placement-coherent path reopen.
- [x] Current SAO controls and Explorer panels remain functional.

#### Decisions and Course Corrections

Phase 1a completed on 2026-08-11 with the following implementation record:

- `holtburger-content` computes retail's 64 terrain-cell diagonal bits once. The canonical terrain
  asset retains them, obstruction assembly emits the corresponding 128 upward-facing triangles,
  and the Tauri terrain record transports the same bits to both the frontend sampler and mesh
  generator. The duplicate TypeScript hash was deleted. Synthetic tests prove that changing only a
  transported bit changes both interpolation and indices.
- The content architecture was clarified rather than bypassed: authored collision polygons,
  obstruction triangles, cell volumes, and conservative collision bounds are source-domain facts;
  renderer coordinates, presentation triangulation, acceleration, and response policy remain out.
- The donor's scalar placed-shape scale was rejected. ACE and retail both apply per-part
  component-wise `SetupModel.default_scale`, composed with whole-object scale. Collision placement
  now prefers the retail resting frame and then the default frame, validates part/frame/scale
  cardinality, preserves non-uniform scale, applies inverse-transpose normal transforms, and uses the
  maximum component only for a conservative broad-phase sphere.
- The donor's `CellVolume::contains_within` and doorway slack were removed from Phase 1a. Content
  publishes only positive-spine planes and portal neighbors; Phase 1b owns containment tolerance and
  prior-cell-aware transit as world queries.
- Outdoor and interior assemblers became private implementation details of one complete content
  assembly call. `ContentAssetService::resolve_collision` returns a composite
  `LandblockCollisionAsset`, so product and diagnostic callers cannot construct category-by-category
  partial artifacts.
- The retained `collision_scene_probe` invokes the canonical product path and independently audits
  source disposition without assembling a second artifact. On `0xDA55FFFF`, 648 placement records
  yielded 245 consumed placements and 403 inert records with no physics geometry; 655 referenced
  setup parts contained 239 collidable and 416 no-physics parts. All 236 CellStructs supplied both a
  bounded physics shape and a containment volume. The independently expected total exactly matched
  the product's 575 placed colliders; unsupported DID families and missing CellStruct root bounds
  were both zero.

Deferred debt is explicit:

- Placed-shape broad phase remains the measured linear scan with conservative spheres. No
  acceleration structure is added before Phase R1 measurement justifies it.
- A CellStruct physics BSP without root bounds remains inert as a shape but still contributes its
  authored cell volume; the probe reports this category and measured zero instances on `da55`.
- Collision products are not separately cached and do not enter the generic asynchronous asset
  request enum yet. Phase 1c collision residency is the first named consumer that can justify cache
  ownership and eviction policy.
- Coarser frontend terrain LoDs remain presentation approximations. Collision and the stride-one
  rendered surface share the exact authored topology contract.

Verification at the checkpoint: 25 `holtburger-common`, 47 `holtburger-content`, and 160
`holtburger-core` tests passed after the scope cleanup; the complete frontend suite passed 1,024
tests; TypeScript checks, ESLint, Knip, Rust clippy with warnings denied, the Tauri terrain binary
contract test, the `da55` collision probe, and the browser runtime harness all passed.

Phase 1b completed on 2026-08-11 with these decisions and corrections:

- `LandblockCollisionAsset` moved from `holtburger-core` to `holtburger-content` as the shared parsed
  artifact contract. Core remains its canonical composition root, while world consumes the complete
  artifact without a dependency cycle or separate terrain/solid insertion APIs.
- `CollisionScene` owns artifacts by normalized landblock and exposes four separate request types:
  swept coverage, directional movement obstruction, directionless placement confirmation, and
  prior-cell-aware transit. Missing coverage is distinct from an empty contact result, and invalid
  centers/radii produce typed errors.
- BSP planes and polygons transform into landblock-local space while the body sphere remains in that
  space. This is required for the 308 setup models with non-unit component-wise part scale: mapping
  the sphere into object space would turn it into an ellipsoid. Sorting spheres transform
  conservatively only for rejection.
- The solver integrates in its starting landblock's local frame and permits local coordinates to
  cross the 0..192 m extent. An initial absolute-world `f32` implementation drifted by about 2 cm on
  a 2 m open move at `da55`; anchor-local integration removed that error while retaining exact
  neighbor-landblock commit.
- Solid-region and polygon-shell contacts remain distinct query mechanisms because real EnvCell
  shells can have no solid leaves. Nearly parallel duplicate contacts collapse to the deepest
  constraint before separation, avoiding double correction where authored geometry exposes the same
  face through both mechanisms.
- Each substep resolves the candidate cell before obstruction, so a building shell concedes only
  with that candidate context. Pose and cell commit together after directionless placement
  confirmation. The solver has explicit substep/contact budgets and contains no recursive entry.
- Synthetic public-entry scenarios cover open 3D motion, head-on wall impact, oblique slide, corner
  constraints, terrain floor, ceiling, polygon-only interior shell, immediate retreat, non-uniform
  scale, high-speed budget refusal, impossible-placement contact exhaustion, landblock crossing,
  building-shell entry, neighbor-cell transit, interior exit, and missing coverage.
- The `da55` product probe now inserts the canonical 575-collider artifact into `CollisionScene` and
  completes a real placement query with resident coverage; its high-altitude verification pose has
  zero contacts.

Phase 1b debt retained deliberately:

- Motion uses bounded discrete substeps and endpoint separation, not continuous time-of-impact.
  The maximum substep distance is therefore a correctness control, and requests exceeding the
  configured anti-tunneling budget hold rather than silently clamp or tunnel.
- Outdoor-to-interior entry uses the Phase 0-ratified linear cell-volume scan. Prior-cell steady
  state tests only that cell and its portal neighbors.
- Placed polygons and BSP planes transform during queries. Cached transformed geometry or another
  acceleration structure waits for Phase R1 tick-cost evidence.
- Phase 1b is an explicit world operation, not wired into the existing implicit spatial `tick()`.
  Phase 1c owns camera registration, collision residency, fixed ticking, intent, and presentation.

Phase 1c implementation completed on 2026-08-11 with maintainer verification still pending:

- `apps/holtburger-3d/src-tauri` owns one `HostCameraRuntime`; shared crates gained no camera mode,
  input, presentation, or tuning policy. The runtime registers a fixed 0.25 m sphere centered on the
  presented camera pose and drives the Phase 1b solver at the ratified 30 Hz cadence. The donor's
  aperture census established 0.25 m as the point below which `da55` doorway access stopped
  materially improving; physical fly has no separate body-reference offset.
- Collision residency was initially a host-owned 3x3 landblock ring around the physical body and
  does not read frontend scene-interest radii. The later placement-scoping census expanded that ring
  to 5x5: a sweep may touch the first neighbor while a cross-owner static shadow requires a source
  one owner beyond it. Complete `LandblockCollisionAsset` products insert and evict atomically.
  Assembly runs on blocking workers; a missing owner remains absent so the world query takes its
  explicit conservative hold path.
- Explorer resolves its pitched camera basis and W/S, Z/C, Space/PageUp/PageDown input into one
  normalized AC-world velocity. The host receives only that velocity. Session and intent sequence
  ids prevent late async commands or segments from an older handoff from moving a newer body.
- Residency load/insert/evict transactions serialize independently from the camera state lock.
  Tick generation is rechecked after acquiring that state lock, and stop uses compare-and-swap, so
  a delayed old tick, residency load, intent, or stop cannot mutate a newly registered body.
- Each host tick publishes the solved landblock-local origin, achieved velocity, a 33.3 ms validity
  horizon, bounded-work counters, and solve duration. Frontend presentation converts AC axes to
  canonical scene space and extrapolates at most two validity horizons before visibly holding.
- Frontend free fly remains the default. Entering physical fly seeds the sphere from the exact
  presented free-fly pose after directionless placement confirmation. Leaving physical fly seeds
  free fly from the last presented predicted pose and detaches the event session before stopping the
  host. Requesting automatic scene focus first returns to free fly because focus is an explicit
  teleport, not collision motion.
- The existing free-fly controller still owns orientation and all nonphysical controls. While the
  host owns position it exposes local held input, suppresses frontend translation and pan/wheel
  movement, and applies solved positions without feeding them back as new user motion.

Phase 1c automated verification at this checkpoint:

- All 73 `holtburger-3d` Rust tests passed, including da55-centered residency, fixed-tick movement,
  coordinate-frame conversion, generation invalidation, stale-intent rejection, stale-stop
  rejection, and exact missing-owner reporting.
- The complete frontend suite passed 1,037 tests across 153 files. TypeScript and Svelte checks,
  ESLint, Knip, and Rust clippy with warnings denied passed.
- The browser harness over `0xda55ffff` reached `ready: true` with near-field ambient occlusion and
  every existing panel path intact. The canonical product collision probe again assembled 575
  placed colliders and 236 cell volumes and completed its world placement query with resident
  coverage.

Phase 1c debt and remaining acceptance:

- The first physical-camera activation now assembles up to 25 collision products before
  registration. The resident ring is the collision-product cache and crossing loads only newly
  entering owners; no broader cache is introduced before the exposed per-tick timing demonstrates a
  need. This registration/owner-change cost is the explicit concession for complete cross-owner
  static membership; stable ticks neither assemble products nor rebuild the scene shadow index.
- The browser harness cannot exercise Tauri event transport or host collision because its content
  adapter runs in a browser. The remaining Phase 1c acceptance item is therefore an actual Explorer
  flight in `da55`: enter physical fly outdoors, collide and slide, pass through an interior route,
  and return to free fly without a visible jump. The World panel exposes tick status, solve time,
  substeps, contact passes, and dropped segments for that check.

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
- [x] Every shared contract has a current product consumer.
- [x] The grounded plan can be expressed as an additional response policy over the landed kernel.
- [x] No public world-state or query contract assumes that every future physical body has exactly
      one sphere.

#### Decisions and Course Corrections

The 2026-08-11 landed-contract audit removed facts and methods that had only test or hypothetical
readers:

- `CollisionShapeSource` and `StaticContactSource` were deleted. Building-shell classification is
  the only source-family fact consumed by current collision behavior; contact provenance can return
  later only with a named diagnostic or grounded scenario that reads it.
- Terrain collision cells no longer duplicate row/column fields or expose a test-only `cell()`
  lookup. Their row-major position is already their identity in the canonical 8x8 artifact.
- `CollisionScene::covers` and three inverse/direction placement transforms were removed because no
  product path called them. The placed-point and inverse-transpose normal transforms consumed by BSP
  queries remain.
- `CollisionPolygon::d` is now consumed directly by plane transformation instead of being stored and
  then re-derived from a vertex.
- Exact missing landblock owners and the outside-world bit now cross the host segment contract and
  appear in the Explorer World panel. Missing coverage is therefore actionable product state rather
  than test-only detail.

The grounded dry run found no one-sphere body assumption in the shared collision kernel. Coverage,
movement obstruction, placement confirmation, and cell transit each accept one sphere as a query
primitive. A grounded response can issue those primitives for tagged lower/support and
upper/constraint spheres, union their coverage requirements, reconcile one candidate cell, and
commit the pair atomically. `PhysicalFlyBody` remains intentionally single-sphere because it is a
mode-specific operation, not the general body contract. Grounded support/step facts need separate
queries and result types in Phases 3-4; they do not require replacing the landed obstruction
contract.

No second spatial index is justified yet. The broad-phase census still rejects 95.21-99.56% of
placements, but browser timing does not measure the Tauri collision tick. The host already publishes
`solveDurationMs`; the remaining `da55` maintainer flight must establish whether collision solve time
is a real 30 Hz bottleneck before acceleration work is admitted.

R1 automated verification after the cleanup passed 73 `holtburger-3d`, 47 `holtburger-content`, 188
`holtburger-world`, and 1,037 frontend tests. Type/Svelte checks, ESLint, Knip, clippy with warnings
denied, the canonical `da55` 575-collider/236-cell product probe, and the supported browser harness
command (`--brief --landblock 0xda55ffff`) all passed. The browser harness reached `ready: true` with
no console messages; it still cannot exercise Tauri event transport or host collision.

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

- [x] Derive each expectation from retail rather than current donor output.
- [x] Identify which sequence dependencies are observable and which retail structure is irrelevant.
- [x] Cite every branch where sphere count changes step, slide, negative-polygon, coverage, or cell
      transit behavior; do not generalize from the single-sphere path.
- [x] Define the smallest synthetic geometry that isolates each rung.
- [x] Name the local mechanism suppression that must make each fixture fail.
- [x] During Phases 3-4, observe each fixture fail under its named local suppression before
      accepting the implementation; do not retain mutation-only machinery.

#### Acceptance Criteria

- [x] No scenario uses a doorway aggregate as its expected result.
- [x] Each implemented fixture's failure messages name exactly one failure mode.
- [x] No test requires untracked runtime assets.
- [x] The implementation can proceed one rung at a time without inventing an uncited behavior.
- [x] Pair scenarios separately prove lower/support and upper/constraint behavior; no expectation
      treats the spheres as interchangeable.

#### Decisions and Course Corrections

Phase 2 was specified from a fresh line-by-line read of the retail decompile on 2026-08-11. The
discarded donor plan was used only as an index of functions worth rereading; none of its solver
output or aggregate doorway scores define an expected result.

##### Observable retail control flow

```text
update_object
  -> split elapsed time into bounded quanta
  -> UpdateObjectInternal
       -> UpdatePositionInternal
            -> animation/drive offset
            -> gravity/velocity integration
       -> transition(old pose, candidate pose)
            -> retain at most spheres 0 and 1; sphere 0 defines the low point
            -> find_transitional_position
                 -> radius-bounded translation substeps
                 -> redirect intent through current contact/sliding constraints
                 -> discover cells touched by the retained sphere set
                 -> transitional_insert
                      -> obstruction or support query
                      -> settle/step-down
                      -> edge protection, or lower-sphere step-up / upper-sphere slide
                      -> directionless placement confirmation
                 -> validate and atomically commit pose, contact, and cell
       -> derive achieved velocity from committed displacement, or hold with zero achieved velocity
```

The behavior-bearing evidence is:

- `update_object` divides elapsed time into `MAX_QUANTUM_97` calls and discards intervals over two
  seconds (`acclient.c:311180-311212`). `UpdatePhysicsInternal` advances position by
  `v*dt + 0.5*a*dt^2` and then velocity by `a*dt` (`:306145-306165`); `calc_acceleration` selects
  gravity only for gravity-enabled bodies (`:306184-306211`). A body starting at zero vertical
  velocity therefore acquires velocity on its first quantum and begins displacing on the next.
- `UpdateObjectInternal` runs transition only for a body with authored spheres, computes achieved
  velocity from the transition's committed displacement, and otherwise restores the old position
  and zeroes cached velocity (`:310861-310950`). Pose and achieved velocity are one result.
- Transition setup reads the authored sphere array (`:308350-308370`), while `init_sphere` retains
  no more than two and derives the low point exclusively from sphere zero (`:302260-302291`). Both
  centers are transformed on every candidate (`:302368-302438`).
- `find_transitional_position` computes bounded substeps, redirects each through retained contact,
  performs at most three insertion attempts, validates, and commits only successful substeps
  (`:301820-301950`). The exact class layout, numeric transition values, and recursion are not
  observable requirements; finite work, substep ordering, and last-safe commit are.
- `adjust_offset` drops a sliding constraint as soon as intent points away, projects motion into a
  contact plane when intent points into it, and snaps an outward horizontal step back to the plane
  (`:300623-300705`). That expiry is required for immediate retreat and stable ramp following.
- A support candidate becomes grounded only when `normal.z >= PhysicsGlobals::floor_z`
  (`:304992-304995`, initialized at `:765983-765986`). `validate_walkable` distinguishes clear,
  touching, standability-probe collision, and penetration adjustment and refuses a steep face as a
  new support plane for an already grounded body (`:302792-302845`).
- Settling lowers the body, requires a qualifying contact, then confirms the adjusted pose through
  placement insertion (`:301308-301350`). Step-up is an explicit raised settle using the authored
  step-up height, with exact restoration on failure (`:301457-301484`); it is not recursive license
  to tunnel through an obstruction.
- Edge protection is reached only after settling fails. With the `EdgeSlide` physics bit mapped to
  object-info `0x200` (`:307400-307429`), it restores the saved pose before cliff or precipice
  response; without the bit it restores and accepts walking off (`:301371-301451`). Precipice
  response derives a crossed polygon-edge normal and slides along it (`:302569-302608`).
- Placement/solid checks test both retained spheres (`:346393-346403`). During grounded movement,
  the lower sphere reaches ordinary step-up first; an upper-sphere front-face hit slides, while an
  upper-sphere back-face hit records `neg_step_up = false` (`:346471-346505`). The later negative-hit
  branch therefore slides it (`:301600-301612`). Only the lower-sphere back-face producer records
  `neg_step_up = true` and may attempt step-up (`:346507-346510`, `:301613-301616`).
- `pos_hits_sphere` reports an intersecting polygon through its out parameter even when motion is
  away from the polygon normal (`:345563-345582`); that is the exact front/back distinction the
  grounded polygon query must preserve. A directionless overlap result cannot substitute for it.
- Outdoor candidate discovery iterates every retained sphere and its radius across cell boundaries
  (`:340704-340780`). EnvCell portal discovery likewise adds a neighbor when any sphere reaches its
  volume (`:334182-334297`). The committed current cell is then selected from containment of sphere
  zero's center (`:333035-333069`). Thus the pair unions coverage and candidate cells, but the upper
  sphere can never become authoritative support or independently choose the committed cell.
- A committed contact is retained only while velocity does not point away from it
  (`:305016-305028`), reseeded into the next transition (`:307405-307422`), and recomputed on
  validation (`:301017-301043`). We retain that observable lifetime, not retail's flags.

Retail's three-frame stationary-fall escape (`:300976-301015`, seeded across ticks at
`:308372-308384`) is not copied as a counter. Its observable purpose is escape from a wedged falling
body. The bounded multi-plane constraint solve and immediate-retreat scenarios below require that
outcome directly; no fabricated floor/contact state lands unless a focused fixture proves it is
independently observable. Likewise, retail's retry counts, numeric states, recursive call topology,
and dormant object-info bit `0x4` are implementation structure rather than acceptance contracts.

##### Attributed synthetic scenario ladder

All fixtures use checked-in synthetic terrain/BSP/polygon builders and runtime body constants. Flat
support is `z=0`; a shallow ramp uses a normal above the shipped floor threshold and a steep face one
below it. The production pair uses the censused human offsets/radii; the boundary-union fixture uses
an intentionally offset upper sphere because that is the smallest geometry where the all-sphere
cell-discovery branch differs from sphere zero. Each assertion gets a failure message naming the
single result in its row.

| Rung | Minimal fixture and expected outcome                                                                                                                                                                                                                                    | Retail attribution                                                                                                                           | Local suppression that must fail it                                                               |
| ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
|    1 | Empty resident scene; zero initial velocity. Covered ticks accumulate downward velocity using the retail integration order and move only after velocity exists.                                                                                                         | `:306145-306165`, `:306184-306211`                                                                                                           | Disable gravity integration; velocity remains zero.                                               |
|    2 | One horizontal polygon under the lower sphere. A fall seats the lower sphere, reports support, and commits achieved rather than requested vertical velocity.                                                                                                            | `:302792-302845`, `:310693-310727`                                                                                                           | Disable support acquisition; the body passes through or keeps falling.                            |
|    3 | The same plane for many zero-intent ticks. Pose and grounded state remain exact within the collision epsilon, with no alternating fall/snap.                                                                                                                            | `:305016-305028`, `:307405-307422`, `:301017-301043`                                                                                         | Disable same-tick support reseed/settle; support clears and fall velocity accumulates.            |
|    4 | Flat support plus horizontal intent. Full tangent distance is achieved while the support sphere remains seated.                                                                                                                                                         | `:300632-300705`, `:301550-301596`                                                                                                           | Disable drive integration; the body remains seated without achieving horizontal intent.           |
|    5 | Flat support plus one finite vertical wall. Head-on intent stops, oblique intent preserves its tangent component, and the next away-facing intent retreats immediately.                                                                                                 | `:300623-300683`, `:343825-343931`                                                                                                           | Keep the sliding constraint after away intent; retreat remains blocked.                           |
|    6 | A shallow finite ramp whose normal clears `floor_z`. Uphill and downhill motion follows the plane without hover or penetration.                                                                                                                                         | `:300670-300705`, `:304992-304995`                                                                                                           | Disable snap/plane projection; height diverges from the ramp.                                     |
|    7 | Flat ground terminating at a finite face whose normal is below `floor_z`. It is obstruction, never support; tangent intent slides and direct intent cannot descend glued to it.                                                                                         | `:302801-302845`, `:301371-301382`                                                                                                           | Treat every upward normal as walkable; the body acquires support on the steep face.               |
|    8 | A finite wall begins above the lower sphere's reach but intersects the upper sphere. The pair is constrained/slides; a one-sphere baseline passes; immediate retreat succeeds; support remains lower-owned.                                                             | `:346483-346497`, `:346533-346545`                                                                                                           | Omit the upper query; the pair incorrectly passes through.                                        |
|    9 | Finite floor ending at a straight ledge. With edge protection, the last supported pose is restored and tangent motion may slide along the edge; without it the body leaves support and gravity resumes.                                                                 | `:301371-301451`, `:302569-302608`                                                                                                           | Skip saved-pose restoration; the protected body crosses the ledge.                                |
|   10 | Flat support plus a solid box below `step_up_height`. Lower-sphere obstruction triggers a raised settle, confirms placement, and ends supported on the top.                                                                                                             | `:346471-346480`, `:301457-301484`, `:301337-301350`                                                                                         | Disable lower step-up routing; the body stops at the vertical face.                               |
|   11 | Identical box above `step_up_height`. The pose remains on the original footing, reports blocked achieved motion, and away intent retreats on the next tick.                                                                                                             | `:301457-301484`, and the height gate exemplified for sphere obstacles at `:344201-344239`                                                   | Retain the failed raised candidate; the body lifts or cannot retreat.                             |
|   12 | An upper-only one-sided polygon is intersected while moving with its normal (back face). The upper hit routes to slide, never lower-owned step-up; reversing intent clears it.                                                                                          | `:345563-345582`, `:346498-346505`, `:301600-301612`                                                                                         | Collapse front/back or sphere roles; the body attempts a step or ignores the upper face.          |
|   13 | Flat support plus two perpendicular walls. Diagonal intent converges to the intersection without penetration or unbounded retries; intent away from either constraint releases that constraint.                                                                         | `:300638-300668`, `:344082-344140`                                                                                                           | Apply only the deepest contact; the body penetrates the other wall.                               |
|   14 | Cross an outdoor boundary while supported and while falling. A second variant offsets only the upper sphere across the boundary: coverage includes that owner before commit, while the lower sphere still owns support/cell.                                            | `:332969-333069`, `:340704-340780`                                                                                                           | Compute coverage from sphere zero alone; the upper-only owner is absent from the request.         |
|   15 | Two linked convex EnvCells with a portal and an upper-only ceiling/wall constraint. Lower-only traversal commits through the portal; the pair includes both cells but is vetoed by the upper constraint; exit returns outdoors through the same atomic pose/cell solve. | `:334182-334297`, `:333035-333069`, `:346393-346403`                                                                                         | Use lower-only placement confirmation; the pair enters an invalid pose or commits the wrong cell. |
|   16 | Remove one required resident owner, then restore it. While absent, pose, velocity, support memory, and cell all hold without hidden gravity accumulation; after restoration the next tick resumes from that exact state.                                                | Recovery invariant replacing retail's synchronous cell access; explicit coverage is required by the all-sphere discovery at `:332969-333069` | Convert missing coverage to an empty query; the body falls or moves into unloaded space.          |

Rungs 8, 12, 14, and 15 are the biting two-sphere set: upper obstruction, upper back-face routing,
upper-only coverage, and pair-aware interior placement differ from the one-sphere baseline. Rungs 2,
3, 4, 6, 9, 10, and 11 separately prove that only the lower sphere produces support and step
relationships. A doorway aggregate is deliberately absent.

##### Guarantee and suppression ledger

| Mechanism                                      | Observable guarantee                                                             | If suppressed                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Preflight union coverage                       | Neither requested motion nor gravity advances through unloaded geometry.         | Rungs 14/16 enter absent space or resume with accumulated fall speed. |
| Bounded substeps and attempts                  | High speed and intersecting constraints cannot tunnel or recurse without limit.  | Rungs 5/13 penetrate or fail to terminate.                            |
| Contact-plane retention with exact away expiry | Rest and ramp following are stable; retreat is immediate.                        | Rungs 3/5/6 drift or wedge.                                           |
| Walkability classification                     | Support and steep obstruction are distinct once, at the grounded response layer. | Rungs 6/7 become indistinguishable.                                   |
| Lower/support role                             | Only sphere zero can ground, settle, or step the body.                           | Rungs 8/12 fabricate support or step from an upper hit.               |
| Upper/constraint role                          | Head/torso geometry can veto or redirect a candidate without becoming footing.   | Rungs 8/15 pass through the upper obstruction.                        |
| Two-sided polygon admission                    | A back-face approach produces an approach-side contact instead of disappearing.  | Rung 12 passes through the upper obstruction.                         |
| Saved-pose restoration                         | A failed settle/step/edge attempt preserves valid footing.                       | Rungs 9/11 drift across the ledge or retain a raised invalid pose.    |
| Placement confirmation                         | An adjusted pose is collision-free for both spheres before commit.               | Rungs 10/15 tunnel through a top, wall, or ceiling.                   |
| Atomic pose/contact/cell commit                | Every published field describes the same candidate.                              | Rungs 14/15 expose a new cell with an old pose or vice versa.         |

Implementation proceeds in rung order. During development each fixture will first be run with its
named mechanism locally suppressed and observed red, then with the mechanism restored and observed
green. Those temporary mutations are not retained. Real `da55` doorway and collision probes remain
aggregate regression detectors only; they cannot establish a grounded behavior.

### Phase 3: Grounded Controller Core

#### Deliverables

- A `Grounded` response variant carrying only grounded policy.
- Gravity and per-tick integration matching the censused observable contract.
- Support acquisition, stable rest, ground following, walkability classification, wall obstruction,
  wall slide, and contact transitions.
- A bounded `GroundedBodySpheres` implementation with lower/support and optional upper/constraint
  roles; upper-sphere obstruction and sliding participate in the same finite attempt budget.
- Committed support contact; one collision-derived sliding normal may redirect only the next
  substep, while solve-local encountered planes are diagnostic history only.
- Scenario ladder rungs 1-8 passing through the public solver entry point for both the one-sphere
  baseline and the two-sphere production shape where applicable.

#### Acceptance Criteria

- [x] Physical-fly fixtures remain unchanged and green.
- [x] Grounded state is computed once by the grounded response and returned in the solved contract.
- [x] A blocked body reports achieved rather than requested velocity.
- [x] Retreat from a wall cannot be blocked by stale contact state.
- [x] Contact memory clears on the exact step its validity expires.
- [x] No physical-fly body can acquire support or report grounded contact.
- [x] Upper-sphere contact cannot replace or fabricate lower-sphere support.
- [x] A two-sphere body can retreat from an upper-only obstruction without stale contact blocking it.

#### Decisions and Course Corrections

Phase 3 landed as a separate `solve_grounded` entry point rather than a mode flag on physical fly.
Its public body shape makes the retail asymmetry structural: one required lower/support sphere and
one optional upper/constraint sphere. Movement and placement queries retain the originating sphere
role until grounded policy classifies the contact; only lower-sphere walkable normals are excluded
from obstruction memory. This prevents an upper hit from fabricating footing while still allowing
the upper sphere to veto and slide a candidate.

The support query reports authored polygon normals and bounded vertical drop only. Walkability,
support selection, gravity reset, and contact lifetime remain in grounded response. Pair coverage
unions both rotated authored spheres before integration. Every later query stage also preserves an
explicit `MissingCoverage` result because contact separation can extend a candidate slightly beyond
the original preflight envelope; treating that rare boundary case as an internal error would break
the recovery invariant.

Seven public-entry tests implement ladder rungs 1-8: gravity ordering; lower-sphere landing and
achieved velocity; exact retained rest; flat drive; wall block/slide/retreat; shallow-ramp following
and steep-face rejection; and an upper-only wall against one- and two-sphere bodies. The named
gravity, support, drive, stale-contact, ramp projection, walkability, and upper-query mechanisms
were each locally suppressed, observed red, restored, and observed green. No mutation switch or
test-only solver branch remains.

Two draft suppression claims were corrected during execution. Exact flat rest does not uniquely
prove retained-contact seeding because a same-tick support requery can also restore the pose, so the
rung now suppresses support reseed/settle and observes accumulated fall state. Flat walking cannot
exercise plane projection because projection onto a horizontal plane is an identity, so its focused
suppression is drive integration; uphill and downhill ramp assertions own plane-redirection proof.

Verification after restoration: all 195 `holtburger-world` tests pass, including the unchanged
physical-fly suite, and `cargo clippy -p holtburger-world --all-targets -- -D warnings` plus
`git diff --check` are clean.

### Phase 4: Steps, Edges, and Grounded Cell Transit

#### Deliverables

- Explicit, non-recursive step-up and step-down operations.
- Second-sphere back-face admission and approach-side response only where a cited grounded scenario
  consumes them; no dormant retail transition flag.
- Placement confirmation after successful step resolution.
- Cliff and precipice behavior required by grounded scenarios.
- Grounded composition with the landed atomic pose/contact/cell commit and building-shell
  suppression contract.
- Scenario ladder rungs 9-16 passing.

#### Acceptance Criteria

- [x] A step-down query cannot route to step-up by construction.
- [x] Failed step-up preserves valid footing and permits immediate retreat.
- [x] Successful step-up cannot tunnel through the obstructing face.
- [x] Protected and unprotected ledge behavior differ only in the scenario that consumes the policy.
- [x] Interior cell membership changes only through the previous cell or its portal neighbors,
      except for the explicitly measured outdoor-entry path.
- [x] The committed pose, contact, and cell always describe the same solved candidate.
- [x] Missing coverage during a boundary crossing cannot move the body into unloaded space.
- [x] Coverage and candidate cell traversal include cells reached by either sphere, while the
      previous-cell/portal-neighbor rule remains authoritative.
- [x] The upper sphere can veto a step or placement without becoming the body's support sphere.

#### Decisions and Course Corrections

Phase 4 adds explicitly named `step_up_candidate` and `step_down_candidate` operations over one
shared vertical-settle primitive. Neither operation can call the other, and successful raised
candidates are confirmed against both authored spheres before commit. Failed raised candidates are
discarded wholesale. Finite polygon collision was corrected to separate from the closest face,
edge, or corner instead of applying plane depth to an edge hit; without that correction a valid low
step could be rejected by a fabricated face penetration.

Finite support now reports an optional inward boundary normal when the lower sphere reaches a
polygon edge. Creature protection consumes that fact to retain elevation and project only the
outward component, preserving tangent motion; unprotected response accepts the same edge departure
and becomes airborne. This is the observable cliff/precipice result without copying retail's retry
state machine.

Grounded transit queries both transformed spheres through the prior-cell/portal-neighbor contract.
Only the lower result selects the committed cell; either result may provide the landblock-level
interior context that suppresses a building shell. Pair coverage likewise unions both spheres, and
all post-separation query stages preserve explicit missing coverage rather than assuming preflight
cannot change.

Retail's explicit negative-polygon flag was removed during execution. It had no distinct reader in
the equivalent solver: a two-sided polygon contact whose normal faces the sphere's approach side,
combined with the already-required lower/upper role, produces the cited lower-step versus
upper-slide outcomes directly. The rung-12 suppression proves that discarding back faces fails; no
public enum is retained merely to mirror retail topology.

Rungs 9-16 were each observed red under the named local suppression and green after restoration.
The simultaneous-corner fixture was tightened to contact both planes in one substep; the earlier
version allowed small substeps to serialize the planes and therefore did not actually prove
multi-plane iteration. No suppression switch remains. Verification after restoration is 202
`holtburger-world` tests plus warning-free clippy and clean `git diff --check`.

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

- [x] The grounded controller passes the complete synthetic ladder.
- [x] No donor `TransitionModes`, numeric transition enum, or recursive query structure survives.
- [x] Physical fly and grounded walk share only demonstrably common mechanics.
- [x] One- and two-sphere grounded bodies pass the complete ladder through the same public grounded
      entry point.

#### Decisions and Course Corrections

The audit retained only collision artifacts, typed query families, explicit coverage, cell transit,
and the small parallel-contact separation helper as shared mechanics. Physical fly still has no
grounded fields or paths. Grounded policy fields all have runtime readers; query results all differ
in at least one ladder scenario; and the only sphere-role branch is the lower-support versus
upper-constraint decision proven by rungs 8, 12, 14, and 15.

Host integration dry-runs against a compact `GroundedSolveContext` containing scene, policy,
anchor, pose, and authored pair. The host needs to own only mode-specific body state and map the
existing planar intent into `GroundedRequest`; it does not need a retail transition object or a
second collision cache.

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

- [x] Physical fly and grounded walk can be switched repeatedly without stale gravity, support, or
      sliding state crossing the boundary.
- [x] The frontend camera presentation applies the intended eye offset instead of treating the
      support-sphere center as an undocumented eye position.
- [x] Frontend code never solves collision or re-derives grounded state.
- [x] Existing frontend free fly remains the default and can recover from any physical placement.
- [x] The host remains the sole authority for physical-camera motion.
- [x] Grounded walk exercises `upper: Some(_)` through the real host/product path; two-sphere support
      is not test-only infrastructure.

#### Decisions and Course Corrections

The existing physical-camera session now registers an explicit `physical-fly` or `grounded-walk`
mode. The host stores the incompatible bodies in a private sum type and maps both solver outcomes to
one predicted-segment contract; the world crate remains unaware of camera modes, eye placement,
input, and transport. Starting any physical mode creates a fresh generation and body. Stopping or
switching detaches frontend presentation before invalidating the old generation, and every aborted
handoff explicitly restores frontend free-fly authority.

Explorer grounded walk uses the app-owned human pair `(center_z=0.475, radius=0.480)` and
`(center_z=1.350, radius=0.480)`, presents the camera at the evidenced 1.500 m eye offset, and maps
camera yaw to an app-owned horizontal intent. Pitch and vertical input never enter the grounded
request.
The segment reports mode, committed lower-sphere cell, grounded state, latest-solve constraint count,
coverage, budgets, and timing without letting the frontend infer collision state.

Host tests prove grounded registration, eye presentation, support, horizontal achieved velocity,
and incompatible-state replacement. Frontend tests prove mode forwarding, yaw-only grounded intent,
vertical-input rejection by construction, bounded presentation, ordering, and session cleanup.
Verification at the Phase 5 boundary: 75 app-host Rust tests and 1,039 frontend tests pass; app clippy
with warnings denied, TypeScript/Svelte checks, ESLint, dead-export analysis, Prettier, and the da55
browser/content harness are clean. Maintainer interaction in the Tauri Explorer remains a Phase 6
acceptance item.

### Phase 6: Product-Path Content Verification and Tuning

#### Deliverables

- Focused probes that call the same `ContentAssetService::resolve_collision` path as the host.
- Named real-content scenarios for outdoor walls, buildings, door thresholds, interior floors,
  corners, ledges, low ceilings, landblock boundaries, and portal-linked cell transit.
- Aggregate doorway and wedge surveys retained only as regression detectors.
- Tick CPU attribution under representative collision residency.
- A maintainer-driven Explorer verification protocol with exact scenes and expected observations.
- A primary outdoor-to-interior verification route in landblock `0xda55ffff`; supplemental
  landblocks require a named behavior that `da55` cannot exercise.

#### Acceptance Criteria

- [x] Every real-content failure is reproduced by a focused trace before implementation changes.
- [x] A harness/app disagreement is treated as an assembly defect until disproven.
- [x] Physical fly reaches valid authored spaces without grounded policy interfering.
- [x] Grounded walk handles the focused outdoor and interior scenarios without wall tunneling,
      support lift, permanent wedge, or cell flicker.
- [x] At least one doorway or overhang probe distinguishes the grounded pair from its lower sphere
      alone and matches the cited retail outcome.
- [x] Aggregate probes do not regress from their recorded recovery baseline without an attributable
      scenario.
- [ ] The maintainer confirms both physical modes in the real Explorer.

#### Decisions and Course Corrections

`collision_scene_probe` loads the host's 5x5 collision ring through the same
`ContentAssetService::resolve_collision` product path and one transactional resident-scene update,
derives outside-aperture waypoints from the authored EnvCell portal polygons, and drives both the
lower-only body and the production pair through the public grounded solver. The aggregate is a
detector, not an expected behavior oracle.

The 2026-08-11 da55 baseline contains 36 authored outside apertures. Across both directions, 29
lower-only traces enter a cell, 20 pair traces enter and finish in a cell, and four traces reach the
contact budget. The first named product route is EnvCell `0xDA550100`, portal 1, centered at
`(129.000, 180.355, 21.600)`, traveling approximately `(-1.000, -0.002)`. The production pair enters
`0xDA550100`, traverses to linked cell `0xDA550103`, and finishes grounded at
`(126.250, 180.350, 21.605)` with no solve-local constraints. A straight reverse trace remains grounded
at the portal sill in `0xDA550100`; it is not claimed as an outdoor exit because the aggregate probe
does not model the building's approach path.

EnvCell `0xDA550186`, portal 0, centered at `(166.890, 149.360, 25.540)` traveling `(-1, 0)` is the
named pair discriminator. The lower sphere enters transiently; the production pair remains outdoor
with one solve-local upper constraint. This exercises the cited retail upper/constraint veto through
the real assembled product rather than a synthetic fixture.

The decision gate was focused to two apertures. `0xDA55013E` portal 0 at
`(138.060, 34.080, 20.000)` reaches the contact budget on drive tick 11 at
`(137.939, 34.080, 20.005)`; `0xDA55014E` portal 0 at `(19.620, 132.480, 20.000)` does so on drive
tick 10 at `(19.585, 132.480, 20.005)`. Both fail only in the `(-X)` direction, both reproduce for
lower-only and pair bodies, both have just entered their named cell, and both are unsupported when
eight separation passes expire. The last safe state is preserved.

The maintainer selected the focused retail/content trace on 2026-08-11. Phase 6 resumed as an
evidence-only attribution pass: identify every authored contact participating in the failed
separation, determine its polygon side and sphere role, and follow the corresponding retail branch.
Do not change solver policy until that trace either proves the seams intentionally block or names
the minimal discarded behavior fact.

The trace resolved both failures without adding solver policy. The seams are rotated copies of the
same authored topology: the `0xDA55013E` shell meets the first ramp object in linked cell
`0xDA55014D`; `0xDA55014E` meets the same source in linked cell `0xDA55015D`. In the first copy,
collider 231 contributes the upward shell-floor polygon and collider 262 is static GfxObj
`0x01000ACD`; the second copy uses colliders 265 and 297. The ramp ends 0.010 m below the shell
floor. Raising the contact budget from eight to nine still failed; ten passes merely pinned the
body while hidden fall velocity reached `-11.107 m/s`, proving that a larger budget was not a fix.

The impossible opposing contact came from `placed_solid_contacts`, not an authored ramp polygon.
Its BSP walk treated every radius-reached solid leaf as center penetration. Retail instead carries
`center_check` only into the branch containing the sphere center and makes radius-only branches test
their finite polygons (`acclient.c:348462-348490`, leaf handling at `:349055`). Preserving that
discriminator removes the phantom diagonal contact while retaining actual center-solid recovery.
A focused synthetic test now distinguishes radius-only leaf reach from center penetration. The
physical-fly half-space fixtures were also corrected to contain real boundary polygons; their old
polygonless solid leaves encoded a collision retail would not report.

After the BSP correction both bodies traversed the linked cells, exposing a second independent
precision defect: support probing found the correct terrain on every tick, but placement
confirmation interpreted float roundoff below 0.0002 m as penetration. Terrain now uses the same
contact tolerance as polygon queries, with a focused discriminator proving that sub-tolerance drift
is ignored while a 0.001 m penetration remains observable. Both named routes now enter their linked
cells, finish grounded with zero constraints, and reverse to outdoors without a budget refusal or
hidden fall velocity.

The full da55 aggregate improves from 29 lower-only entries, 20 grounded pair completions, and four
rejected traces to 31 lower-only entries, 31 grounded pair completions, and zero rejected traces.
The canonical `0xDA550100` route and `0xDA550186` pair discriminator remain intact. Retail's
three-frame stationary-fall state was traced through `validate_transition` and
`handle_all_collisions`, but no counter is added: once the two underlying query defects are fixed,
the focused product routes acquire real support and have no stationary fall to mask.

Focused collider provenance, BSP description, portal selection, and unsettled-route output remain
opt-in `collision_scene_probe` diagnostics because they provide a continuing reverse-engineering
consumer. Temporary per-contact and per-support environment logging was removed.

### Phase 6 Acceptance Reopen: Portal Exit, Short Drops, and Grounded Input

Maintainer Explorer acceptance on 2026-08-11 found three concrete gaps after the automated gates
passed:

- grounded walk can enter authored doors but is held at a portal when attempting to leave;
- a body can step onto a slightly raised sharp-edged object but cannot step down from it; and
- the app-owned grounded speed is too slow for ordinary exploration, while Shift should retain a
  slower precision walk.

The first two observations share a proved ordering defect. Retail attempts `step_down` before
calling `edge_slide` (`acclient.c:301550-301599`); a successful lower walkable placement returns
without precipice response (`:301308-301351`). Our solver instead projects intent away from every
finite support boundary before evaluating the candidate, and suppresses the vertical settle when
the newly selected support also reports a boundary. That eagerly turns ordinary sills and short
drops into protected precipices. Correct this by removing those pre-emptive boundary responses,
while retaining creature protection only for the existing no-support-after-step-down branch.

The speed change is Explorer policy, not shared solver behavior. Keep the current normalized
grounded intent and Shift precision mapping; raise only the app-owned full-speed grounded rate and
give grounded precision its own named rate/multiplier rather than inheriting physical fly's very
small `0.05` inspection multiplier.

#### Acceptance Criteria

- [x] A focused grounded fixture steps from a raised finite support onto a lower walkable support
      within `step_down_height`, with creature protection enabled.
- [x] A focused grounded fixture still preserves the last supported pose when no lower support is
      found within `step_down_height` and creature protection is enabled.
- [x] The canonical `0xDA550100` product route exits to outdoors in reverse, not merely the two
      previously focused seam routes.
- [x] Grounded walk has a faster ordinary Explorer rate below physical fly, and Shift selects an
      explicit slower grounded walk rate.
- [x] Existing stair, obstruction, two-sphere, and no-support edge-protection scenarios remain
      green.
- [ ] The maintainer rechecks door exit, stair traversal, raised-object descent, and both grounded
      speeds in the real Explorer.

#### Decisions and Course Corrections

The correction deletes both eager boundary responses. Candidate motion now attempts ordinary
support settlement first. Only a failed step-down enters a small edge-slide helper, which projects
the current substep tangentially against the retained boundary and confirms that placement through
the same support path. If neither the requested candidate nor the tangent candidate finds support,
creature protection holds the last committed footing. This preserves true-cliff protection and its
tangent motion without inventing a height threshold; the existing `step_down_height` is the retail-
ordered distinction between a short drop and a precipice.

A new finite-top fixture walks from a 0.15 m raised surface onto the lower floor with creature
protection enabled. The pre-existing no-lower-support fixture still holds at the edge and preserves
tangent travel. All 205 world tests pass.

The canonical `0xDA550100` portal 1 reverse trace now commits `outdoor` and continues from the
portal center at `x=129.000` to `x=134.250`, grounded, with no solve-local constraints. The full da55
aggregate remains 31 lower and 31 pair traversals with zero rejected traces. This also disproves
building-shell suppression as the observed blocker: the body was previously held inside the cell
with no obstruction constraint. After the ordering correction, owner-level shell suppression
remains active while either sphere reaches the EnvCell, then cell state commits outdoors and the
authored aperture admits the body when the shell becomes collidable again.

Explorer ordinary grounded travel is now 12 m/s and Shift selects an explicit 4 m/s precision walk.
Both remain app policy; physical fly remains 150 m/s and retains its separate `0.05` precision
multiplier.

### Phase 6 Acceptance Reopen: Wall Slide and Contact Lifetime

Maintainer Explorer acceptance then found two related contact-transition failures:

- angled wall contact does not consistently preserve tangent travel; and
- after some collisions, a non-authored obstruction persists until intent first points backward.

The retained-constraint contract is the named suspect and must be removed if the focused fixtures
confirm it. Our grounded body carries an arbitrary vector of obstruction normals across host ticks
and retains a normal for tangent intent because `dot == 0` passes its `<= 0` test. Retail creates
fresh collision info for each transition (`acclient.c:300330-300346`), seeds at most one current
sliding normal from object contact state (`:307400-307423`), and invalidates that normal unless the
new offset points strictly into it (`:300589-300627`). Multiple solver-local planes may still be
required to converge one substep, but they are not durable world state.

Correct this as a clean contract cutover: support remains committed body state; obstruction planes
cannot survive the current bounded solve; the solve outcome reports the current tick's derived
constraint count for diagnostics. The later per-substep acceptance reopen tightens this lifetime
further. Do not add spatial timeouts, retreat heuristics, or approximate constraint expiry.

#### Acceptance Criteria

- [x] Repeated angled intent along a wall preserves its tangent component on every tick.
- [x] A finite wall releases motion after the body passes its authored end without requiring a
      retreat tick.
- [x] Two simultaneous planes still converge within the contact budget during one solve.
- [x] No obstruction normal survives in `GroundedBody` or another durable world-state contract.
- [x] Host and harness diagnostics consume the derived per-solve constraint count without
      re-deriving it.
- [x] The prior portal, short-drop, stair, two-sphere, and true-cliff scenarios remain green.
- [ ] The maintainer rechecks bidirectional wall sliding and the disappearing-wall sequence in the
      real Explorer.

#### Decisions and Course Corrections

The focused fixtures confirmed both failure modes without a timeout or content-specific trace.
Repeated identical angled input against one wall previously depended on normals committed by the
prior tick; a finite wall could leave those normals behind after its polygon ended. The replacement
starts each solve with an empty plane set, accumulates distinct obstruction normals only while its
substeps converge, and discards the set at return. The next tick's sweep therefore reacquires only
geometry that still intersects the requested path.

Removing durable obstruction state left `GroundedContacts` as a one-field wrapper, so the wrapper
was deleted as part of the same clean cutover. `GroundedBody` now commits `support` directly.
`GroundedOutcome` owns the derived `constraint_count`; the Tauri segment and product probe consume
that value instead of inspecting or re-deriving solver internals. The Explorer label now says
`solve constraints` so the metric does not imply persistence.

The wall fixture now applies the same angled intent for two consecutive solves and observes the
full tangent velocity both times. A new finite-wall fixture keeps pressing inward while moving past
the authored end, observes a constrained solve followed by an unconstrained solve, and clears the
wall without reverse input. The existing perpendicular-wall fixture still reports two planes and
converges in one solve; its following retreat solve correctly reports zero new constraints rather
than preserving a tangent stale plane. All 206 world tests, 75 Tauri host tests, and the full da55
31/31 traversal aggregate pass with zero rejected traces.

### Phase 6 Acceptance Reopen: Per-Substep Slide State and Stair Crests

Maintainer Explorer acceptance narrowed the remaining defect further: nearly tangent wall travel
can still lose a whole tick, and some stair crests behave like a temporary non-authored wall that
retreat can clear. The prior correction made obstruction planes solve-local, but still accumulated
an arbitrary set across every substep in that solve. That contract remains broader and longer-lived
than retail.

Retail carries one horizontal sliding normal into `adjust_offset`, uses it only when the next
substep points strictly into the plane, and invalidates it otherwise (`acclient.c:300589-300630`).
`find_transitional_position` then clears the per-attempt sliding/contact state before each
`transitional_insert`, which derives the next collision normal (`:301897-301919`); validation copies
that single collision normal into the next sliding normal (`:300963-300975`). Successful step-up
also clears the contact plane and either commits the lowered walkable placement or restores the
saved pose (`:301457-301484`). Therefore a riser or slightly divergent wall polygon cannot remain an
active plane for every later substep in the tick.

Replace the solve-wide active plane vector with one next-substep sliding normal. Keep a separate
solve-local set only to count distinct encountered planes for diagnostics; it must never influence
motion. Contact separation may still resolve several simultaneous overlaps within one bounded
substep.

#### Acceptance Criteria

- [x] A single multi-substep solve clears a finite wall end while intent remains angled inward;
      retreat and a second host tick are not required.
- [x] Near-parallel motion across slightly divergent adjacent wall polygons retains meaningful
      tangent travel instead of accumulating a wedge.
- [x] A successful sequence of low steps reaches and crosses its top support in one multi-substep
      solve without retaining a riser normal.
- [x] Two simultaneous contact planes still separate and report both encountered constraints.
- [x] Active slide state is one optional next-substep normal; diagnostic plane history cannot feed
      motion.
- [x] Existing portal, short-drop, two-sphere, true-cliff, wall, and failed-step fixtures remain
      green.
- [ ] The maintainer rechecks near-parallel wall travel and the observed stair crest in the real
      Explorer.

#### Decisions and Course Corrections

The same-tick finite-wall fixture reproduced the lifecycle defect directly before the cutover: the
body advanced from `y=20.5` to `y=24.5` but remained pinned at `x=9.4995` after the finite polygon
ended. The earlier multi-tick fixture could not see this because every new host tick discarded the
solve-local vector. A divergent two-polygon wall seam and a three-level low staircase provide the
near-tangent and stair-crest acceptance shapes.

The motion-active vector is deleted. Each substep consumes at most one optional sliding normal and
clears it before querying contacts. The aggregate contact query selects the most opposing
non-walkable normal as the deterministic next-substep equivalent of retail's single collision
normal. All contacts still participate in separation, and a separate distinct-plane set owns the
diagnostic count; that set has no motion consumer.

The synthetic staircase was already green before this cutover, so it does not reproduce the exact
authored crest reported by the maintainer and is retained as a regression guard, not presented as
proof of that content-specific symptom. The finite-wall failure proves the shared stale-substep
mechanism; real Explorer acceptance remains necessary to determine whether the observed stair uses
that mechanism or exposes another edge case.

All 209 world tests and the full workspace suite pass. The da55 product probe remains 31 lower and
31 pair traversals across 36 authored apertures with zero rejected traces; the canonical portal 1
route still enters, crosses linked cells, and reverses outdoors grounded.

### Phase 6 Acceptance Reopen: Placement-Scoped Static Collision

Maintainer Explorer acceptance exposed a broader placement defect: after entering a building with a
recessed floor, grounded walk can remain supported by the outdoor terrain instead of dropping to the
interior floor. The host is not missing body placement. `GroundedBody` commits its EnvCell with the
pose, and `HostCameraRuntime` publishes that cell in each predicted segment. The collision scene
currently discards the distinction at query time:

- `PlacedCollider` distinguishes only building shells from every other placed shape;
- terrain participates unconditionally in obstruction, placement, and support queries;
- every placed collider in a resident landblock participates in every query; and
- `candidate_cell` suppresses the landblock's building shells but does not select terrain, outdoor
  objects, EnvCell shells, or indoor static objects.

That flat landblock-wide collision domain is structurally incapable of retail placement behavior.
Fix it at content/query ownership rather than teaching the frontend to toggle collision categories.
The frontend continues to apply the solved pose only; host/world placement remains authoritative.

Retail supplies the behavior and the important limit on what may be inferred.
`CEnvCell::init_static_objects` places each indoor static through `CPhysicsObj::add_obj_to_cell`
(`acclient.c:333820-333872`); `add_obj_to_cell` then calls `calc_cross_cells_static`
(`:310977-310990`). The latter traverses the object bounds, removes old shadows, and installs the
object into every reached cell (`:310527-310564`, `add_shadows_to_cells` at `:310125-310196`). EnvCell
traversal follows portals and tests the sphere or part bounds against candidate cells
(`:334136-334355`). This proves that the retail engine supports cross-cell static membership. It
does **not** prove that shipped indoor props actually exercise that facility, so engine capability
alone must not force a multi-cell product contract.

#### Deliverables

- Preserve collision provenance during `holtburger-content` assembly: outdoor objects, building
  shells, EnvCell shells, and indoor static objects must remain distinguishable. Every EnvCell shell
  and indoor static retains its authored source EnvCell.
- Replace the separate candidate-cell/building-suppression facts with one world-owned candidate
  placement contract. It carries the body's authoritative committed placement and the interior
  cells reached by every retained sphere; query consumers do not reconstruct either fact.
- Select collision participants once from that placement contract, then share the selection across
  movement obstruction, grounded obstruction, support, and placement confirmation:
  - outdoor placement admits terrain, outdoor objects, and building shells;
  - interior placement excludes outdoor terrain and ordinary outdoor objects, suppresses the
    containing building shell, and admits the reached EnvCell shells and indoor statics; an outdoor
    static participates indoors only if the same evidence gate below proves derived EnvCell
    membership is observable; and
  - portal-straddling candidates include the domains reached by the retained sphere pair until the
    lower sphere's center atomically commits the next placement.
- Add a temporary shipped-content census that mirrors retail's static bound traversal closely
  enough to classify collidable indoor prop placements as source-cell-only, valid cross-cell, or
  unresolved, and separately checks outdoor statics near EnvCell portals. Report total placements,
  each disposition, maximum reached-cell count, and named cross-cell examples with source/target
  cells and object DIDs.
- Keep indoor prop membership scalar when the census finds no valid cross-cell placement. If valid
  examples exist, add a focused adjacent-cell collision trace; introduce derived bounded membership
  only when that trace proves source-cell-only selection changes an observable collision result.
- Add focused product-path traces for a recessed interior floor, outdoor geometry beneath an
  occupied EnvCell, sibling-cell statics, portal straddling, and bidirectional exterior transit.
- Audit support carry-over at every placement change. A contact from a domain that is no longer
  selected must be reacquired from the new candidate placement or expire in the same solve.

The census is diagnostic evidence, not permanent runtime policy. Remove it after recording its
method, aggregate results, named discriminators, and resulting representation decision here; retain
only a generally useful probe when it has a continuing reverse-engineering consumer.

#### Acceptance Criteria

- [x] A named product route into a recessed EnvCell drops from outdoor terrain to authored interior
      support and reports the correct committed EnvCell.
- [x] Terrain and ordinary outdoor-object contacts cannot support or obstruct a body whose candidate
      placement is wholly inside an EnvCell; the same geometry remains active outdoors unless a
      censused, behavior-proven cross-cell membership explicitly selects it indoors.
- [x] An EnvCell shell and source-cell indoor static are active in their authored cell and inactive
      in an unrelated sibling cell.
- [x] Portal entry, internal transit, and exit remain atomic for both one- and two-sphere bodies;
      neither a collision hole nor a one-tick mixture of stale placement domains is observable.
- [x] The building shell blocks exterior walls, concedes at valid interior candidates, and resumes
      outdoors without regressing the canonical `0xDA550100` reverse route.
- [x] The shipped-content census records whether any valid indoor static needs cross-cell
      membership, and the landed collider contract matches that evidence without an unused field.
- [x] Physical fly and grounded walk consume the same placement-scoped static query selection; no
      category switch or collision decision is added to the frontend.
- [x] Existing wall-slide, stair-crest, short-drop, cliff, missing-coverage, and 31/31 da55 portal
      regressions remain green.
- [ ] The maintainer verifies the recessed-floor route and outdoor/interior collision separation in
      the real Explorer.

#### Decisions and Course Corrections

Implementation paused at the membership decision gate. The first structural cutover is present but
not accepted: `PlacedCollider` now retains outdoor, building-shell, EnvCell-shell, or indoor-static
provenance; `CellVolume` retains authored collision portal planes and targets; and world queries
consume one `CollisionPlacement` containing the center-committed EnvCell, every sphere-reached
EnvCell, and outdoor reach. The old `GroundedCellContext` and per-query `candidate_cell` building
flag are deleted. Both physical fly and grounded walk therefore use the same placement selection,
and support is invalidated when the committed placement changes instead of carrying an outdoor
floor contact indoors.

A focused synthetic recessed-floor trace now commits the EnvCell, expires outdoor support, resumes
gravity under the existing retail integration order, and settles one meter lower on the EnvCell
floor. A domain-selection fixture proves that outdoor statics, building shells, source-cell shells,
source-cell props, unrelated sibling props, and outdoor/interior straddling select differently. The
canonical `0xDA550100` product route still enters, crosses linked cells, and reverses outdoors.

The 2026-08-12 archive census invalidated the source-cell-only assumption. It inspected 3,405
populated interior landblocks and 92,969 collidable indoor static placements using each part's
authored vertex bounds, placed part frame and scale, source portal side/plane, and target CellStruct
box intersection. It found:

- 68,278 source-cell-only placements;
- 24,691 cross-cell placements;
- zero unresolved placements;
- a maximum of 177 reached EnvCells for one placement; and
- 595 outdoor collider parts whose conservative bounds reach an outside-entry EnvCell.

Named cross-cell discriminators include EnvCell `0x00030153`, static 0, object `0x020004BF`, which
reaches `0x00030153` and `0x00030156`; and EnvCell `0x0003019D`, static 0, object `0x010007CD`, which
reaches four cells. The high fanout is not a diagnostic flood error: retail
`CPhysicsObj::find_bbox_cell_list` iterates the growing `CELLARRAY` and invokes
`CPartArray::calc_cross_cells_static` for every newly reached cell (`acclient.c:306606-306628`), and
each call evaluates that cell's portals (`:313260-313267`, `:334302-334620`).

This is a major plan gap rather than a small implementation detail. A scalar source EnvCell is
provably too conservative, while a per-collider “small membership” assumption is contradicted by
the measured 177-cell maximum. Outdoor-to-interior static membership also needs an exact behavior
gate rather than the current blanket exclusion. No runtime multi-cell representation is selected
and no acceptance box depending on it is checked until the maintainer chooses whether to:

1. store precomputed compact membership shared by every part of one authored static object;
2. group static colliders under a placement-level record that owns membership and parts; or
3. derive membership at collision-product insertion and build cell-indexed collider buckets.

The third shape best matches retail's per-cell shadow lists and makes query selection cheap, but it
changes `LandblockColliders` from a flat placement list into an indexed collision product. That is
the recommended clean cutover; accepting it is a spicy architecture decision outside the ratified
plan.

The DA55 aggregate was intentionally red at this checkpoint: the canonical route passed, but the
broader exact placement contract exposed 30 zero-motion setup failures in the aggregate's synthetic
bidirectional portal starts. The old radius-based scalar transit silently classified several starts
as interior and suppressed their building shells; the center-committed placement does not. These
must be reclassified or replaced with valid outdoor starts after the membership representation is
chosen, not hidden by weakening building-shell selection.

The maintainer approved option 3 on 2026-08-12. The implementation now preserves one stable
authored placement identity across every collidable part, retains each part's authored vertex box,
and compiles indoor static membership into per-EnvCell collider buckets when a collision asset
becomes resident. A focused multipart fixture proves that when either part reaches an adjacent
cell, every part of the authored placement is installed there. Query families consume the compiled
buckets and deduplicate portal-straddling cells; the scalar source-cell selector and flat per-query
collider scan are gone. Collision insertion now fails with a typed error when a source or target
EnvCell required by the index is absent. The cutover compiles across the workspace and all 212
`holtburger-world` tests pass, but it is not behavior-complete because the outdoor-static gate below
found a second architecture boundary.

Retail does not admit an outdoor static merely because its sphere approaches any outside portal.
`CLandCell::add_all_outside_cells` first installs its transformed part boxes into every overlapped
24-meter land cell (`acclient.c:340554-340703`). Each `CSortCell` only asks the building registered
there for transit (`:340798-340805`, `:341433-341443`); a building is registered in the land cell
containing its authored origin (`:337723-337742`). The building then runs the target EnvCell's
reverse portal-side and CellStruct box tests (`:683479-683492`, `:334034-334133`).

An exact archive census of that chain found:

- 7,882 collidable outdoor static placements in the 3,405 populated interior landblocks;
- 595 parts conservatively near an outside-entry EnvCell, confirming the old proximity count was
  intentionally loose;
- 256 same-owner outdoor placements with valid derived interior membership;
- 416 outdoor placements whose transformed bounds leave their owning landblock;
- 11 cross-owner placement/building-entry candidates after joining by the registered 24-meter land
  cell; and
- five valid cross-owner portal memberships, exercised by two generated placements.

The cross-owner discriminators are generated placement 1 owned by `0xBD9FFFFF`, which enters
neighbor `0xBC9FFFFF` through EnvCells `0xBC9F0112`, `0xBC9F0114`, `0xBC9F0115`, and `0xBC9F0116`;
and generated placement 56 owned by `0xF731FFFF`, which enters neighbor EnvCell `0xF7300127`.
This proves that a collision product whose buckets and collider indices are strictly local to one
landblock cannot represent shipped retail membership.

The viable choices at the newly discovered decision gate were:

1. **Scene-global resident shadow index (recommended):** retain authored colliders under their
   source landblock, compile cell buckets as cross-owner collider references over the small resident
   set, and rebuild the derived index on insertion/removal. Require a one-landblock collision halo
   in coverage so an absent neighbor cannot masquerade as a complete interior query. This keeps
   content artifacts independently assembled and mirrors retail's scene-owned shadow lists, but
   changes the approved index from one local product per owner to one derived product for the
   resident scene.
2. **Neighbor-enriched collision assets:** make content/core assembly load adjacent landblocks and
   bake their shadows into each target asset. This preserves local query buckets but duplicates
   collider ownership, couples content products to residency policy, and makes replacement/eviction
   semantics substantially less honest.
3. **Deliberate retail divergence:** support the 256 same-owner memberships and omit the five
   cross-owner memberships. This is the smallest implementation, but shipped content can observe
   it and it requires a `RETAIL DIVERGENCE` marker plus acceptance of missing collision at the named
   locations.

The maintainer approved option 1 on 2026-08-12. `CollisionScene` now owns one derived resident
shadow index. Source landblock artifacts remain the sole owners of collider geometry; outdoor-cell,
building-shell, and EnvCell buckets store sorted, deduplicated references to those source colliders.
Insertion, replacement, and eviction compile the index transactionally, so an invalid cross-cell
membership restores both the previous source assets and previous shadow index. Host residency
applies its entire load/evict delta as one batch, avoiding one rebuild per asset; an empty delta
returns without compiling, because a no-op camera tick is a hot path rather than a scene mutation.

Outdoor membership follows the evidenced retail chain rather than portal proximity. Content
assembly preserves each outside portal's building index and building-origin frame. Index compilation
first installs each multipart outdoor placement into every overlapped 24-meter outdoor cell, then
tests only buildings registered in those cells using the target EnvCell's reverse portal side and
CellStruct bounds. Collider queries transform the candidate body into the referenced collider's
source-owner frame. A focused cross-owner lifecycle fixture exercises generated placement 1 from
`0xBD9FFFFF` in neighbor-owned `0xBC9F0112` and proves that the reference disappears when its source
owner is evicted. A separate failure fixture proves that a bad residency batch cannot partially
replace the old source or index.

Coverage now requires the one-landblock source halo around every landblock touched by the swept
body. The archive census was extended before removal to measure this assumption over all 7,882
collidable outdoor placements: 416 cross an owner boundary and the maximum source-to-reached-owner
offset is exactly one landblock. The host collision ring consequently expands from 3x3 to 5x5. A
sweep may touch the first neighboring owner and require a source one owner beyond it; keeping only a
3x3 ring would produce a non-committable boundary tick that could never recenter residency. The
5x5 ring loads 25 collision artifacts instead of nine, while render interest remains independent.
This is the principal runtime cost concession; the derived index is still rebuilt only when that
resident set changes.

The completed shipped-content census is therefore: 3,405 populated interior landblocks, 92,969
collidable indoor placements (68,278 source-cell-only, 24,691 cross-cell, zero unresolved, maximum
177 reached EnvCells), 7,882 outdoor placements, 416 owner-boundary crossings, 256 valid same-owner
outdoor-to-interior placements, 11 cross-owner candidates, and five valid cross-owner memberships
from two generated placements. The representation matches all observed membership rather than
special-casing the five rare records. The temporary census was removed after these aggregate results,
its exact retail-derived method, the two named cross-owner placements, and the one-owner maximum were
recorded here; no archive-only diagnostic or runtime-asset test remains.

The DA55 aggregate's 30 prior contact-budget failures were a probe setup defect, not a solver
allowance to restore. Each outside aperture was seeded 1.25 meters on both sides even when one seed
overshot a shallow entry cell into authored solid. The probe now placement-confirms both retained
sphere roles before solving, classifies 51 embedded role/start combinations as invalid setup, and
fails loudly only when a trace rejects after a valid start. The repaired aggregate records 32 valid
lower-sphere traversals, 31 full-pair traversals, and zero valid-start rejections across 36 outside
apertures. The pair baseline remains 31; the extra lower-only route is an attributable improvement
from exact placement selection rather than a weakened shell.

The named recessed-floor product discriminator is EnvCell `0xDA5501E9`, portal 1, from threshold
center `(107.525, 127.035, 22.000)` toward `(-0.696, 0.718)`. The production two-sphere trace commits
`0xDA5501E8`, settles on authored interior support at `z=20.152` — a 1.853-meter drop — and reverses
outdoors to grounded `z=20.005`. The canonical `0xDA550100` route still commits linked EnvCell
`0xDA550103` and reverses outdoors. This product-path contrast, plus the focused domain-selection
fixtures, proves outdoor terrain and ordinary outdoor colliders do not remain active as support or
obstruction after the atomic interior commit.

The same retained probe now drives the production 0.25-meter `PhysicalFlyBody` and
`PhysicalFlyConfig` through those authored portals using the same 5x5 product assembly and public
placement-scoped solver as the host. Across all 36 DA55 outside apertures it records 36 valid entry
traversals, classifies 20 embedded synthetic seeds before solving, and has zero failures after valid
setup. The canonical `0xDA550100` portal 1 trace enters that cell, finishes in linked EnvCell
`0xDA550103` at `z=22.850` with zero vertical drift, and reverses outdoors. The focused recessed
`0xDA5501E9` portal 1 trace enters at `z=23.950`, remains aloft at `z=23.522`, and reverses outdoors,
while the grounded pair on the identical aperture settles at `z=20.152`. Its 0.428-meter downward
deflection can only come from three-dimensional contact separation: the physical-fly request has no
vertical intent and its typed solver contains no gravity, support, step, slope, or edge-protection
path.

This trace closes the automated real-content physical-fly gate, not the Explorer usability gate. It
uses a conservative 4 m/s diagnostic drive to make the aperture path reproducible; it does not
exercise pitched frontend intent, Tauri event transport, live collision timing, or the free-fly
handoff. Those remain part of maintainer verification rather than being inferred from a harness.
The placement-scoping reopen also exercised the harness/app disagreement rule directly: the earlier
focused fixtures did not overrule the maintainer's recessed-floor observation. The discrepancy was
treated as a product-assembly defect, traced to placement-domain selection and cross-owner static
membership, and corrected before the aggregate's invalid synthetic seeds were reclassified.

All 214 `holtburger-world` tests, all nine focused host-runtime tests, the default DA55 aggregate,
and the focused `0xDA5501E9` trace pass after this cutover. Real Explorer verification remains the
only open placement-scoped acceptance criterion; archive and harness evidence do not substitute for
that maintainer-facing check. After the probe was aligned from its old minimal 3x3 source halo to the
host's exact 5x5 residency, the full DA55 debug run completed in 7.17 seconds and produced identical
route counts and elevations. This measures the larger ring as a bounded registration/owner-change
cost; stable ticks still perform no assembly or shadow-index rebuild.

### Phase 6 Acceptance Reopen: Authoritative Render-Camera Placement

Maintainer Explorer acceptance on 2026-08-12 found that host collision placement and frontend render
placement disagree in geometrically overlapping EnvCells. In grounded-walk mode the World panel
reports the host's committed `0xCE940109`, while the camera coordinator reports containment
ambiguity between `0xCE940102` and `0xCE940109`; the last rendered viewport can remain labeled
`0xCE94010A` while rendering is held.

The CE94 topology proves that containment is not a valid tie-break. Authored reciprocal portals form
the route `0xCE94010A -> 0xCE940108 -> 0xCE940109`. Cell `0xCE940102` instead links only to
`0xCE940104`; its overlapping volume does not make it reachable from the traversed route. The host
grounded solver already supplies `body.cell` as `previous_cell` for both production spheres and
correctly commits `0xCE940109` through that portal-seeded search.

The disagreement is frontend re-derivation, not a world-solver traversal defect.
The original `PhysicalCameraMotionSegment.cellId` carried the host-owned answer, but
`ExplorerCameraCoordinator.syncCameraResidency` ignored it and called the scene's all-cell point
containment query every frame. The field's only frontend consumer was World-panel diagnostics. When
containment was ambiguous the coordinator could retain its previous frontend residency solely to
keep rendering; that explains the stale `0xCE94010A` viewport label but did not make it an
authoritative placement.

#### Required Cutover

- Make one accepted host segment expose a composite presented placement containing both canonical
  scene position and authoritative `SceneResidency`; do not let the coordinator re-derive either
  member while host position authority is active.
- Make the camera coordinator accept that exact residency for render-camera and HUD placement after
  confirming the named scope is resident. Missing topology must hold visibly rather than silently
  falling back to containment or outdoor placement.
- Keep point-containment ambiguity as Explorer free-fly policy, which has no host-owned portal
  history. Do not run a second frontend portal traversal for physical modes.
- On physical-to-free-fly handoff, seed the existing presented position and explicitly seed the last
  host residency into the frontend coordinator so the first free-fly frame cannot snap to an
  overlapping volume before manual movement establishes a new route.

#### Acceptance Criteria

- [x] Host physical-fly and grounded-walk segments have one typed frontend consumer for their
      composite position/residency placement; committed EnvCell identity is not diagnostics-only.
- [ ] In the CE94 route, the host, renderer, HUD, and scene-interest status all report
      `0xCE940109`; unrelated overlapping `0xCE940102` does not cause ambiguity or a held stale frame.
- [x] Missing or evicted topology for the host-selected EnvCell produces a visible hold and cannot
      fall back to another containing cell or outdoors.
- [x] Frontend free fly retains explicit ambiguity reporting when no authoritative physical-camera
      placement exists.
- [x] Physical-mode switching and return to free fly preserve both presented position and the last
      committed residency without a one-frame render or camera snap.
- [x] Existing portal rendering, physical-camera transport, browser, frontend, and host collision
      regressions remain green.

This was a major gap in the ratified plan rather than tuning debt. The maintainer approved the
recommended cutover on 2026-08-12. Re-running portal traversal independently in the renderer would
create two authorities and remains rejected.

The host event contract now transports one nested residency record containing normalized landblock
owner and optional committed EnvCell instead of two sibling fields. Frontend evaluation pairs that
same immutable residency with the bounded predicted `SceneVec3` position in one
`PhysicalCameraPlacement`; the renderer, HUD, and World diagnostics all read the accepted segment
rather than reconstructing placement from point containment. This also computes the interdependent
fact once and avoids allocating a new residency object on every presentation frame.

The coordinator exposes separate physical and free-fly synchronization entry points, so a caller
cannot omit an authority flag by accident. Physical synchronization performs one exact resident-scope
map lookup and never calls the all-cell containment query. A missing first segment or absent exact
EnvCell scope visibly holds rendering with a named status; it cannot fall back outdoors or into an
overlap. This O(1) lookup on each physical presentation frame is the deliberate runtime concession
for detecting render/collision residency disagreement immediately.

Free fly retains its existing overlap ambiguity policy. A normal physical-to-free-fly handoff seeds
exactly one frame from the final host residency before returning to point classification; an explicit
scene-focus teleport opts out of that seed. Physical-to-physical replacement holds while the new
session lacks a segment, and a failed replacement carries the prior residency into its free-fly
recovery. A resolved host placement replaces the prior ambiguity/wait status so the panel cannot
continue reporting an issue after rendering has recovered. The panel also reports the first accepted
host placement and each actual residency change, but suppresses identical per-frame updates; the
authored CE94 `0xCE94010A -> 0xCE940108 -> 0xCE940109` sequence is covered directly.

Focused coverage includes the exact CE94 `0xCE940102`/`0xCE940109` overlap, proof that point
containment is never queried under host authority, missing-scope and first-segment holds, one-frame
handoff seeding, later free-fly ambiguity, exact scope identity, nested host serialization, and the
existing transport ordering and body-mode replacement scenarios. The complete frontend suite passes
1,043 tests across 153 files; Svelte/TypeScript checks, ESLint, Knip, Prettier, app Rust clippy with
warnings denied, production build, nine focused host-runtime tests, and the CE94 browser renderer
check are green. The browser run on isolated port 14839 loaded 135 EnvCells, executed an authoritative
`0xCE940109` portal view, reached `ready: true`, and emitted no page-console messages. The existing
large-chunk advisory and Chrome GCM/zygote diagnostics remain non-failing external noise.

The only open criterion in this reopen is the actual Tauri Explorer observation at CE94. Automated
tests prove the authority contract and renderer selection but cannot establish that the running app
window presents no stale frame during the real host event sequence.

### Phase 6 Acceptance Reopen: Collision-Body and First-Person Viewer Placement

Maintainer Explorer acceptance on 2026-08-12 exposed a second CE94 placement distinction after the
frontend re-derivation was removed. Grounded walk rendered almost entirely clipped from
`0xCE94010A`, while physical fly and frontend free fly rendered the same doorway correctly. The
grounded frame ran near 500 FPS instead of roughly 90–110 FPS, proving that exterior portal planning
was absent rather than merely drawn incorrectly. Switching modes without movement could also flip
the published placement between `0xCE94010A` and `0xCE94010B`.

A focused production-content trace through the slim outside-entry cell `0xCE94010B` proved the
cause. On entry tick 8 the support body committed `0xCE94010B` while the eye point remained outdoors;
on ticks 9 and 10 the body had committed `0xCE94010A` while the eye point remained in
`0xCE94010B`. Only later did both occupy `0xCE94010A`. Publishing the support sphere's committed cell
as the render camera's residency therefore seeded portal clipping from a cell that did not contain
the camera. Physical fly did not expose the bug because its sole collision sphere is centered on the
presented camera point. Mode registration independently discarded the prior presented residency and
reclassified the point from an outdoor seed, explaining the no-motion `0xCE94010A`/`0xCE94010B`
flip in overlapping geometry.

Retail treats first-person placement separately from player placement. `CameraSet::SetInHead` uses
an eye-relative `(0, 0.18, 0)` viewer offset (`acclient.c:142853-142880`), the player pivot is offset
1.5 meters upward (`acclient.c:138168-138196`), and every normal draw still executes
`SmartBox::update_viewer`. That path places and transitions an independent 0.3-meter
`viewer_sphere`, then stores its resulting `viewer_cell` (`acclient.c:138800-138918`; sphere setup at
`acclient.c:139301-139305`). There is no first-person shortcut that copies the player's cell.

#### Required Cutover

- Retain collision-body placement and presented-viewer placement as distinct host facts. The world
  solvers continue to commit only the support/upper or physical-fly body; render residency comes from
  a separately portal-seeded viewer-sphere transit.
- Match retail first-person geometry for grounded presentation: a 1.5-meter eye pivot, a 0.18-meter
  offset along the full pitched view direction, and a 0.3-meter viewer sphere. Keep the Explorer's
  independently invented 0.25-meter physical-fly collision sphere unchanged.
- Carry the exact currently rendered residency into physical-mode registration. A mode handoff may
  not reclassify an overlapping point from an outdoor seed.
- Carry frontend-owned view direction with each physical-camera intent. The host owns viewer
  position and residency; the frontend continues to own input/orientation policy.
- Commit body state and viewer state together. Missing viewer coverage holds the prior composite
  state visibly rather than publishing a body pose with an unknown or guessed render scope.

#### Acceptance Criteria

- [x] Grounded support/body cell and first-person viewer cell can differ for multiple ticks without
      corrupting either collision-domain selection or portal rendering.
- [x] The focused `0xCE94010B -> 0xCE94010A` trace reproduces the outdoor/`0xCE94010B` viewer lag and
      publishes the viewer cell for presentation throughout the route.
- [x] Switching among grounded walk, physical fly, and frontend free fly without moving preserves
      the exact presented residency in overlapping EnvCells.
- [x] Grounded camera presentation uses the cited retail 1.5-meter pivot, 0.18-meter view offset,
      and 0.3-meter viewer sphere; physical-fly collision remains 0.25 meters.
- [x] Missing viewer coverage cannot partially commit a new body pose or fall back to containment.
- [x] Real CE94 Explorer acceptance renders the exterior domain continuously through the slim cells
      without the clipped-frame FPS spike.

#### Decisions and Course Corrections

The host now retains one `ActiveCamera` composite containing collision-body state and independently
portal-seeded presented-viewer state. Grounded presentation uses the cited retail constants directly:
a 1.5-meter eye pivot, 0.18-meter offset along the complete pitched view direction, and a 0.3-meter
viewer sphere. The Explorer's 0.25-meter physical-fly collision radius remains separate policy. Each
fixed tick solves the body, transits the viewer from its previous viewer cell, and publishes the
viewer owner, origin, and EnvCell as one segment. Missing viewer coverage restores both members of
the prior composite. Collision content residency still recenters from the body owner rather than the
nearby viewer owner; render and collision residency therefore cannot accidentally exchange jobs at
a landblock boundary.

Physical-camera registration is now one typed payload containing the exact currently presented
scene position, residency, view direction, and target response mode. The frontend camera coordinator
retains the exact placement it applied to the renderer, and both physical-to-physical replacement and
physical-to-free-fly recovery prefer that placement over a newly extrapolated position. Registration
seeds host portal traversal from the supplied EnvCell instead of reclassifying an overlapping point.
Distinct view-direction changes are transported even when movement velocity is unchanged; camera
orientation remains frontend policy while viewer position and placement remain host authority.

The retained production-content probe now evaluates travel, opposite, left, and right first-person
headings independently. On the focused CE94 `0xCE94010B -> 0xCE94010A` route, the opposite-facing
viewer differs from the support body's committed cell for four fixed ticks. The default DA55
`0xDA550100 -> 0xDA550103` route independently records three mismatch ticks. A synthetic overlapping
thin-cell fixture proves that the host publishes the viewer cell while preserving the body's own
collision placement, and registration coverage proves a supplied overlap cell survives a no-motion
mode handoff.

Automated verification after this cutover is green: 77 app Rust tests including 11 focused camera
runtime tests; 1,044 frontend tests across 153 files; Svelte/TypeScript checks; ESLint; Knip; Rust
clippy with warnings denied for the app and debug harness; and the DA55 and focused CE94 product
probes. An isolated CE94 browser run on port 14841 loaded 135 EnvCells, executed four portal scopes
and four crossings from authoritative `0xCE94010A`, and emitted no page-console errors. That browser
harness does not execute the Tauri host event stream, so it verifies the renderer still accepts the
correct scope but cannot check the final live criterion.

This cutover does not claim the rest of retail `SmartBox::update_viewer`. Retail also asks
`CTransition::find_valid_position` to pull an obstructed viewer sphere short of its sought camera
point and has an `AdjustPosition` fallback (`acclient.c:138862-138916`). The current host uses the
0.3-meter sphere for coverage and portal placement, while the grounded body pair remains the
movement collider. That unimplemented camera pull-in was not implicated by the slim-cell evidence;
pitching near tight ceilings is the discriminator to audit before promoting it into this plan.

Maintainer acceptance on 2026-08-12 confirmed that this cutover removed the clipped exterior frame
and incorrect placement in the slim CE94 cells. It then exposed the presentation-boundary defect
below as a shorter flash during otherwise successful portal crossings in both physical modes.

### Phase 6 Acceptance Reopen: Placement-Coherent Host Presentation Paths

Maintainer Explorer acceptance on 2026-08-12 found a brief compositing flash whenever either
physical camera mode crosses a portal. Static inspection proves that the current presentation
contract can manufacture exactly that frame. Each host segment carries one authoritative viewer
origin and the residency committed at that origin. The frontend then advances the origin with
achieved velocity for up to two 33.3-millisecond validity horizons while returning the segment's
residency unchanged. At the current tuning limits this may move grounded presentation roughly 27 cm
and physical-fly presentation as much as 10 meters without a matching placement transition. The
next host event restores a coherent position/residency pair, producing the observed flash and a
possible correction snap.

This is not a renderer-compositor traversal defect. The renderer still needs authored portal
topology to answer which scopes are visible from a supplied camera placement. It must not also
decide which placement contains a physically controlled mover. `holtburger-world` already owns
prior-cell history, coverage, and authoritative placement semantics. The placed-motion primitive
belongs there and must be camera-agnostic; the current host viewer sphere is merely its first
presentation consumer.

Retail supports this ownership boundary behaviorally. `SmartBox::update_viewer` constructs one
`CTransition` from the prior viewer position to the newly sought viewer position, attaches the
0.3-meter viewer sphere, calls `find_valid_position`, and commits the resulting position and
`viewer_cell` together (`acclient.c:138800-138918`). The recovery should match that observable
continuous placement path without copying retail's 1999 object topology.

#### Required Cutover

- Add one camera-agnostic placed-motion path to `holtburger-world`. Its normalized representation
  owns one initial placed point followed by one or more legs containing a monotonic end fraction and
  an ending placed point; each leg's start is the previous endpoint rather than a duplicated field.
  A runtime adapter supplies the fixed-tick duration. Path construction preserves every accepted
  solver bend and splits a leg at every placement transition. The starting placement applies on the
  half-open leg interval and the ending placement applies at its exact boundary, so position and
  placement cannot be sampled independently. A zero-motion tick remains one full-tick hold leg.
- Add a path-producing placement-transit operation to `CollisionScene`. It accepts an explicit prior
  placement, mover geometry, and ordered sought geometric legs rather than a viewer or camera type.
  It returns both the ordered placed legs and final committed placement. The current host passes the
  0.3-meter viewer sphere and one leg; future entity solvers can pass their accepted
  collision-response legs. Retain endpoint `transit_cell` only where candidate solving needs an
  endpoint placement; it must no longer serve as the viewer's presentation authority. Internal,
  exterior, overlapping-cell, cross-landblock, and view-offset-only transitions consume the same
  placement semantics. Derive crossing fractions from the existing cell-containment planes, portal
  graph, and prior-cell history; do not add a fixed-distance sampler whose answer changes with
  cadence.
- Make that shared path result the sole host viewer-transition authority. Delete the separate
  endpoint-only viewer transit; `ActiveCamera.viewer` must commit from the final path placement, so
  path playback and the next tick's prior cell cannot disagree. Camera eye offsets, viewer-sphere
  dimensions, fixed-tick scheduling, and Tauri serialization remain in the app-local host adapter.
- Keep frontend playback deliberately small: one active fixed-tick path and at most one immediately
  following path. Interpolate only within each host-supplied placement-stable leg and switch
  placement atomically at its supplied boundary. Early delivery fills the one pending slot; late
  delivery holds the active path's exact endpoint. A missing sequence never synthesizes a bridge.
  If a suspended renderer produces a third queued event, discard stale playback and atomically
  resume from an explicit placed point in the newest received event. Do not create a general queue,
  correction blender, or independently timed streaming subsystem for a 30 Hz producer.
- Keep the path contract representation-complete rather than diagnostic-heavy. Remove achieved
  velocity and validity horizon from the event when no surviving consumer needs them; retain solve
  status and bounded-work metrics because the World panel distinguishes behavior and failure modes.
- Remove frontend actor/camera placement traversal and its tests after a consumer census. In
  particular, the browser harness cannot keep `SceneGraph.tracePortalSegment` or equivalent product
  machinery alive as its sole consumer. Preserve the compositor's separate visibility traversal and
  directed-aperture topology; it consumes a known placement and performs a different job.
- Keep the maintainer-approved 30 Hz host cadence and treat one fixed tick of solved-path
  presentation as the accepted latency baseline. The active-plus-one-pending bound cannot accumulate
  trailing latency. Do not reintroduce speculative placement, correction blending, a frontend
  portal predictor, or opportunistic cadence work in this cutover.
- Keep retail viewer pull-in outside this cutover. The path ends at the viewer point selected by the
  current host policy; tight-ceiling evidence remains the gate for adding obstruction-aware camera
  pull-in.

#### Acceptance Criteria

- [ ] One synthetic multi-portal route proves that every evaluated point is paired with the leg
      placement valid at that point, including the exact shared boundary between adjacent legs and a
      tick whose initial and final cells match but whose path enters and exits a thin intermediate
      cell.
- [ ] The world path types and transit API contain no camera/viewer vocabulary. A focused non-camera
      sphere-mover test consumes the same primitive used by the host viewer adapter.
- [ ] Outdoor entry/exit, internal transit, overlapping EnvCells, cross-landblock transit, and a
      stationary body whose 0.18-meter view offset crosses a portal all produce deterministic paths
      from prior-cell history without point-containment fallback.
- [ ] The path's final viewer placement is exactly the `ActiveCamera.viewer` committed for the next
      tick; no second endpoint traversal or frontend reconciliation exists.
- [ ] Missing coverage holds the prior composite camera and emits no partial path. Missing or
      out-of-order event sequences cannot bridge motion with guessed position or placement. A third
      queued event after renderer suspension discards stale playback and resumes only from an
      explicit placed point in the newest received path.
- [ ] Frontend presentation consumes the ordered host legs with one active path and at most one
      pending path, holds the final endpoint on starvation, and contains no physical-camera
      extrapolation factor, achieved-velocity evaluator, or portal-placement traversal.
- [ ] A consumer and vocabulary sweep removes obsolete validity-horizon, extrapolation, correction,
      and frontend camera-trace symbols from runtime code, tests, metrics, UI, and current plan
      language while preserving explicitly historical donor measurements in this execution record.
- [ ] Focused CE94 and DA55 product traces record placement-leg transitions for both grounded and
      physical-fly viewers through the existing named portals without changing collision outcomes.
- [ ] Rust and frontend unit suites, formatting, clippy with warnings denied, type checks, lint,
      production build, DA55 aggregate probes, and the isolated CE94 browser compositor run pass.
- [ ] Live Explorer acceptance crosses CE94 and DA55 portals repeatedly in both physical modes with
      no flash, wrong-domain frame, correction snap, cell flicker, or latency beyond the accepted
      30 Hz solved-path baseline and one pending successor.

#### Task Checklist

- [ ] Add the world placement-path result and prove exact boundary ordering with synthetic cells.
- [ ] Replace the host viewer's endpoint-only transit use with the camera-agnostic path operation,
      then adapt its result into viewer state and the Tauri event contract; retain endpoint transit
      only for named candidate-solve consumers.
- [ ] Replace arrival-relative frontend extrapolation with active-plus-one-pending path playback.
- [ ] Census and delete frontend actor-placement traversal, stale transport fields, and vocabulary.
- [ ] Extend CE94/DA55 probes, run all repository gates, and record queue/timing evidence.
- [ ] Hand the named live portal and latency routes back to the maintainer for final acceptance.

#### Decisions and Course Corrections

The maintainer selected a single host placement authority over a frontend portal predictor. The
existing frontend `tracePortalSegment` path is not adopted for physical-camera presentation. The
approved transport shape is a solved placement timeline, not speculative velocity plus predicted
portal metadata: the latter could pair a coherent guessed cell with a path later rejected by the
next collision solve and would preserve correction snaps.

The current two-horizon extrapolation was evidence-based when pose continuity was the only output,
but it became structurally invalid once residency became an equally authoritative member of the
presented placement. This reopen supersedes the Phase 1c extrapolation acceptance criterion and
implementation narrative without rewriting those historical checkpoints. Starvation now holds a
known endpoint; smoothing or cadence work requires new measured evidence after the clean cutover.

The maintainer accepted 30 Hz as the cadence for this cutover on 2026-08-12. Cadence is no longer an
open design question. The frontend buffer is fixed at one active path plus one pending successor;
normal playback therefore adds no open-ended queue policy or latency-tuning question. A 60 Hz
experiment would be separate future work.

The placed-motion path is a shared world primitive, not a physical-camera base class. This recovery
does not pre-build a generic dynamic-entity runtime, transport, or controller. It proves the shape
through the camera's independently transited viewer sphere and one non-camera sphere-mover fixture;
future players, creatures, missiles, and spells can consume the same ordered position/placement
contract without inheriting Explorer eye offsets, viewer constants, Tauri cadence, or frontend UX.

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
- [ ] No frontend actor-placement transition machinery survives solely for a harness or diagnostic
      consumer.
- [x] No test depends on ignored runtime assets.
- [ ] Rust formatting, clippy with warnings denied, workspace tests, frontend formatting, lint,
      type checks, unit tests, and required browser/Tauri harnesses pass.
- [x] The final diff contains no unrelated dependency refresh or generated-schema churn.
- [ ] The parent roadmap honestly records the placement-aware path cutover and remaining live
      acceptance.

#### Decisions and Course Corrections

The retained donor vocabulary is confined to this recovery record where it identifies provenance and
rejected mechanisms. No donor-named symbol or transition type survives in product code. The only
lockfile additions are the deliberate `holtburger-world` edges consumed by the Tauri host and debug
harness; no package versions or generated Tauri schemas changed.

The dynamic-entity roadmap now records the shared static-query/body-response topology as implemented
with maintainer acceptance pending. The spawned-entity plan may reuse the world placed-motion
contract when a concrete spawned prediction scenario requires it; the Explorer camera session,
dimensions, input mapping, cadence, and transport remain app-local and are not promoted into a
speculative entity base.

Final automated verification is green after the placement-scoped reopen: Rust formatting; workspace
clippy with warnings denied; the full workspace tests (with the socket-bound seven-test scripting
library rerun outside the sandbox); 75 Tauri host tests; 214 world tests; 1,043 frontend tests;
Svelte/TypeScript, ESLint, dead-export, Prettier, and production-build checks; the repaired grounded
and physical-fly 36-aperture DA55 aggregates; and the focused `0xDA5501E9` recessed-floor route. A
lifecycle DA55 browser harness on isolated port 14837 reached `ready: true`, loaded 299 expected
EnvCells, and reported no page-console messages. Its Chrome GCM deprecation line and the existing

> 500-kB build advisory are external/non-failing diagnostics. The browser harness does not exercise
> Tauri physical-camera transport, so maintainer Explorer acceptance was the only open gate at that
> checkpoint. The later placement-coherent presentation-path reopen supersedes that completion claim.

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

### Landblock residency is mistaken for collision placement

Mitigation: retain authored collision provenance, derive one candidate placement per solve stage,
and select terrain, outdoor statics, building shells, EnvCell shells, and indoor statics from that
placement. Landblock residency proves availability only; it never makes every resident collider
active.

### Missing coverage causes falling or tunneling

Mitigation: `MissingCoverage` is a first-class solve result with dedicated synthetic and boundary
crossing scenarios; the host exposes it and retains the last safe pose.

### A placed-motion path becomes a second speculative solver

Mitigation: the world path records only accepted motion and placement transitions for one committed
fixed tick; it does not predict the next solve. The camera host adapter publishes that result without
reclassification. Frontend playback consumes ordered placement legs and cannot extend, retrace,
correct, or classify them. A later smoothing or forward-prediction proposal requires separate
evidence and may not weaken the composite position/placement invariant.

### Event arrival jitter becomes visible path correction

Mitigation: sequence solved paths on one session timeline rather than restarting playback from each
event's arrival timestamp. One pending successor absorbs normal early delivery, starvation holds the
last exact endpoint, and a gap resumes from an explicit authoritative start instead of inventing a
bridge. A third queued event is exceptional renderer suspension, not another buffering tier: stale
playback is discarded and presentation resumes from the newest event's explicit placed point.

### Shared motion contracts absorb camera policy

Mitigation: `holtburger-world` owns only placed points, ordered legs, tick fractions, mover geometry,
coverage, and prior-placement semantics. Viewer offsets, camera dimensions, input modes, event
cadence, serialization, interpolation session state, and handoff UX remain app-local. Require one
non-camera sphere-mover test, but do not invent a generic entity transport or lifecycle without a
production consumer.

### Visibility traversal is confused with camera placement traversal

Mitigation: retain renderer portal traversal only for selecting visible scopes from a known camera
placement. The host collision scene alone determines physical viewer placement; frontend and harness
consumers cannot keep an actor-placement traversal API alive.

### Camera tuning is mistaken for player-body semantics

Mitigation: camera dimensions and step reach remain app policy, even though the grounded camera uses
the same bounded lower/upper topology as authored creature motion. A future player body derives its
exact dimensions and movement allowances from gameplay/setup data through a separate consumer.

### Canonical frontend changes conflict with donor-era Explorer wiring

Mitigation: reimplement against current `3d-next`; do not transplant the four overlapping Explorer
and tuning files wholesale.

## Definition of Done

- [x] Physical fly and grounded walk are distinct typed response policies over one shared static
      sphere-body motion kernel.
- [x] Existing frontend free fly remains available, default, and independent.
- [x] Collision content includes terrain, authored and generated objects, buildings, interiors, and
      cell volumes through one product assembly path.
- [x] Missing coverage is conservative, observable, and cannot accumulate hidden motion.
- [x] Physical fly collides and slides in three dimensions without grounded behavior.
- [x] Grounded walk passes every cited synthetic scenario, including failed-step retreat and
      interior cell transit.
- [x] The grounded production path supports one required lower/support sphere and one optional
      upper/constraint sphere, and the Explorer grounded camera exercises the two-sphere case.
- [x] Two-sphere obstruction, retreat, stepping, coverage, and cell transit pass focused scenarios;
      the upper sphere never becomes support.
- [x] Pose, contact, and cell commit atomically.
- [x] Terrain, outdoor objects, building shells, EnvCell shells, and indoor statics participate only
      in the placement domains selected by the same atomic candidate used for collision solving.
- [x] Indoor prop membership is no broader than a shipped-content census and focused behavior trace
      justify.
- [x] Real-content probes consume the product assembly path and remain regression detectors rather
      than design drivers.
- [ ] Host physical-camera events describe non-empty solved placement legs whose position and
      residency are evaluated together across every portal boundary.
- [ ] The placed-motion path is camera-agnostic in `holtburger-world`; the app-local adapter is the
      only layer that introduces viewer geometry, camera cadence, or Tauri transport.
- [ ] Frontend physical-camera presentation contains no forward extrapolation or independent portal
      placement traversal and holds the last authoritative endpoint on starvation.
- [ ] The real Explorer passes maintainer verification in both physical modes within the accepted
      motion-boundary envelope.
- [x] Shared crates contain no camera UX policy and the frontend contains no collision solving.
- [x] No dormant fields, unused public transition types, accidental dependency upgrades, or
      permanent runtime-asset tests remain.
- [ ] All repository-required static, unit, browser, Tauri, formatting, and lint checks pass after
      the placement-aware presentation-path cutover.
- [x] The dynamic-entity roadmap and spawned plan consume the landed topology honestly.

## Open Questions

None. The remaining work has named structural and live-acceptance gates.

## Remaining Acceptance

The earlier 2026-08-12 audit concluded that every remaining unchecked criterion required only a live
Tauri Explorer session. The portal-flash report supersedes that conclusion: one implementation
contract remains open. The world must produce an ordered camera-agnostic placed-motion path, the host
must use it to commit and serialize the viewer's exact path, and the frontend must play it without
extrapolation or independent placement traversal. Focused world/host/frontend tests and the
repository gates can close those structural criteria; they may not be deferred to manual
acceptance.

After that cutover, the retained content/browser harness still cannot invoke
`tauriPhysicalCameraTransport`, receive the host's real event stream, judge control latency, or
observe a one-frame flash in the interactive Explorer authority handoff. Product-path collision
probes likewise cannot establish visible pose continuity. Those final perceptual boxes require the
maintainer's live session and must not be checked from synthetic, host-only, or browser-only evidence.

The maintainer must verify both physical modes in the real Explorer. The primary grounded route is
EnvCell `0xDA550100`, portal 1, from landblock-local `(129.000, 180.355, 21.600)` toward
`(-1.000, -0.002)`; the focused seam regressions are `0xDA55013E` portal 0 and `0xDA55014E` portal 0
toward `-X`. Confirm physical-fly collision/slide and recovery to frontend free fly, then grounded
entry, linked-cell transit, reverse outdoor exit, stair traversal, short-drop descent, ordinary and
Shift precision speeds, stable support, and mode handoff without camera snap, wall tunneling,
support lift, wedge, or cell flicker. Recheck repeated bidirectional sliding while pressing into a
wall at an angle, then continue past a finite wall end without first backing away; neither route
should stick or leave a non-authored obstruction behind. Finally, enter recessed-floor EnvCell
`0xDA5501E9`, portal 1, near threshold center `(107.525, 127.035, 22.000)` toward
`(-0.696, 0.718)`. Confirm that the body drops about 1.85 meters onto the `0xDA5501E8` interior
floor, and that outdoor terrain or objects neither hold it above that floor nor obstruct movement
while the committed placement remains indoors. Then repeat the overlapping CE94 route
`0xCE94010A -> 0xCE940108 -> 0xCE940109`: while grounded walk remains active, confirm the host,
viewport HUD, renderer, and scene-interest status all stay on `0xCE940109` without reporting
unrelated overlapping cell `0xCE940102` as ambiguous or retaining a stale `0xCE94010A` frame. Also
walk through the slim exterior-entry route `0xCE94010B -> 0xCE94010A` while looking toward and away
from the travel direction. The viewport must continue compositing the exterior domain without the
near-empty-frame FPS spike, and switching grounded walk, physical fly, and frontend free fly without
moving must preserve the same displayed EnvCell.

After the placement-path cutover, repeat both named portal routes in grounded walk and physical fly
at ordinary speed and physical-fly maximum speed. Watch for a single-frame scope flash at entry,
internal crossings, and exit; continue holding movement after each crossing to expose any correction
snap. Verify that starvation or a deliberately paused host stream holds the last coherent frame and
that solved-path playback adds no trailing latency beyond the accepted 30 Hz tick and one pending
successor. Cadence changes are out of scope for this recovery.
