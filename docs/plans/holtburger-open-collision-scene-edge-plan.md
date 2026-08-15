# Holtburger Open Collision Scene-Edge Plan

Status: Ready for execution — architecture and scene-edge concessions ratified
Created: 2026-08-15
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Supersedes the missing-coverage hold policy recorded by:

- `docs/plans/holtburger-3d-host-physics-recovery-plan.md`
- `docs/plans/holtburger-3d-spawned-entity-explorer-runtime-plan.md`
- `docs/plans/holtburger-character-motion-jump-controller-plan.md`

## Context and Boundaries

### Goal

Make collision simulation total over the currently installed scene: absent collision products behave
as open space, bodies continue simulating across application-interest edges, and scene incompleteness
is surfaced as non-gating consumer status rather than solver control flow.

### Ratified Direction

1. Application policy remains the sole owner of simulation interest, loading, retention, and
   eviction.
2. Bodies never request, enlarge, or retain collision interest.
3. Collision queries examine the immutable geometry currently installed in `CollisionScene`.
4. A missing landblock contributes no terrain, static collider, EnvCell, portal, or shadow geometry.
5. Missing source-owned overlap geometry is an accepted scene-edge completeness concession; the
   simulator does not prove a complete neighbor-source halo.
6. Bodies do not freeze, defer gravity, hold motion, or enter an awaiting-coverage activity when
   collision products are absent.
7. The solver may produce geometrically incorrect motion at incomplete scene edges. That motion is
   still a valid solve against the installed snapshot, not a failed transaction.
8. Scene incompleteness is reported lazily from the body's final primary-sphere owner. It is
   diagnostic/consumer policy and does not gate subsequent simulation.
9. A consumer may ignore the status, expand interest, remove the local physical body, or tear down
   the represented entity. Automatic restoration is not a solver responsibility.
10. When collision products are resident, existing retail-derived terrain, BSP, grounded response,
    portal traversal, placement, water restriction, and collision-filter behavior remains intact.
11. Leaving retail's finite outdoor landscape lattice has the same simulation semantics as missing
    interest: no geometry participates and motion continues in open space.
12. Outside the landscape lattice, retain an anchor-relative noncanonical pose. Do not clamp, wrap,
    synthesize a landblock, clear the body, or invent a physical boundary. Recanonicalize if motion
    later returns to the lattice.
13. Registration inside an installed forbidden-water region is allowed. The ordinary bounded solver
    owns any subsequent barrier correction; registration does not create an inactive body state.

### In Scope

- Remove per-query collision-coverage gating from static collision and placement queries.
- Remove `MissingCoverage` from physical-fly, grounded, placed-motion, and generic body outcomes.
- Remove coverage-driven body suspension, restoration revalidation, and hidden-gravity holds.
- Continue physical simulation against partial or empty collision scenes.
- Degrade missing EnvCell topology to the installed topology's best-effort outdoor/loaded-cell
  result without holding the body.
- Add one non-gating, lazily computed scene-residency status with an explicit consumer.
- Update Explorer physical-camera contracts, jump readiness, status UI, tests, and diagnostics.
- Sweep obsolete coverage vocabulary from live symbols, metrics, comments, and UI labels.
- Update active roadmap contracts and annotate historical plans with the superseding decision.

### Out of Scope

- Dynamic body-to-body broadphase or contacts.
- Automatic interest expansion driven by bodies.
- Per-body interest radii or body-retained collision assets.
- Seamless restoration after a body has crossed missing geometry.
- Correct collision with absent neighbor-owned geometry that overlaps a resident owner.
- Reconstructing motion that occurred while topology was absent.
- A new unbounded/global position representation. Existing `WorldPosition` retains the last valid
  outdoor anchor while its local coordinates are noncanonical beyond the landscape lattice.
- Changing Explorer's current radius-two simulation-interest policy unless acceptance data proves it
  insufficient for ordinary camera use.
- Consumer teardown policy for future server-spawned entities; this plan exposes the status and
  leaves lifecycle policy to that concrete consumer.
- Treating malformed resident assets as empty. Decode, validation, and scene-update failures remain
  loud and atomic.

## Ground Truth and Existing Patterns

### Current Implementation Sources

- `crates/holtburger-world/src/spatial/collision.rs`
  - `MissingCoverage`, `CollisionQuery<T>`, `CoverageRequest`, `CollisionScene::coverage`, static
    query families, transit, placed-motion paths, and source-shadow indexing.
- `crates/holtburger-world/src/spatial/physical_fly.rs`
  - Full-sweep coverage preflight and coverage propagation through movement and placement passes.
- `crates/holtburger-world/src/spatial/grounded.rs`
  - Pair coverage, coverage-bearing helper results, support/step/slide transactions, and grounded
    hold outcomes.
- `crates/holtburger-world/src/spatial/physical_body.rs`
  - Gating `PhysicalBodyActivity`, inactive tick outcomes, missing-coverage holds, initial activity,
    and restored-placement revalidation.
- `crates/holtburger-world/src/spatial/scene.rs`
  - Physical attachment, scene-replacement reevaluation, transactional tick commit, and activity
    events.
- `apps/holtburger-3d/src-tauri/src/host_simulation_runtime.rs`
  - Frontend-owned explicit interest, atomic scene replacement, generic body-activity transport,
    and current reevaluation under the scene commit lock.
- `apps/holtburger-3d/src-tauri/src/host_camera_runtime/`
  - Missing-coverage camera holds, viewer-path coverage, jump gating, and serialized status.
- `apps/holtburger-3d/src/explorer/simulation-interest.ts`
  - Existing consumer-owned radius-two collision-interest policy.

### Behavioral References

- `acclient-eor-source/acclient.c`
  - Remains the oracle for collision and placement behavior when required cells are present.
  - `CObjCell::find_cell_list`, `CEnvCell::find_env_collisions`, and
    `CLandCell::find_env_collisions` define installed-topology behavior, not Holtburger's external
    streaming policy.
- The open-space behavior for missing products is a deliberate local architecture concession, not a
  claimed retail behavior match. It is outside the shipped-content compatibility surface and does
  not require a `RETAIL QUIRK` or `RETAIL DIVERGENCE` marker.

## North Stars

1. Interest is external policy; collision is a pure read of the installed snapshot.
2. Missing data is absence of geometry, not an exceptional query result.
3. Solvers describe physical outcomes, not streaming lifecycle.
4. Diagnostics observe state but never determine motion.
5. Preserve strict errors for malformed inputs and internally inconsistent resident topology.
6. Prefer deleting propagation and state machinery over replacing it with prepared-coverage types.
7. Compute scene-residency status once from the final primary body position.
8. Keep installed-scene collision behavior retail-grounded and differential-tested.

## Guarantee Replacement Ledger

Before deleting the existing mechanism, preserve or explicitly replace every guarantee it supplied.

| Deleted guarantee | Existing mechanism | Replacement or accepted concession |
| --- | --- | --- |
| Missing terrain is never treated as empty | `CollisionScene::coverage` before every query | Deliberately removed; absent terrain is open space |
| Missing neighbor-source overlaps block a solve | `collision_source_landblocks` halo proof | Deliberately removed; partial overlap geometry is accepted at scene edges |
| A body never commits motion into missing collision | `MissingCoverage` solver outcomes | Deliberately removed; solve commits against installed geometry |
| Gravity does not accumulate during a residency gap | `PhysicalBodyActivity::AwaitingCoverage` | Deliberately removed; gravity continues normally |
| Retained EnvCell placement survives eviction exactly | Frozen pose/cell plus restoration validation | Deliberately removed; missing topology degrades to best-effort placement |
| Restored content cannot overlap a silently retained body | `evaluate_physical_body_activity` on scene replacement | Deliberately removed; later contact response is best effort |
| Missing coverage is visible to consumers | Body activity event and camera hold payload | Replaced by non-gating final-owner scene-residency status |
| Scene replacement and body availability change atomically | Reevaluation under host state lock | Scene replacement remains atomic; body status updates lazily on its next tick |
| Invalid numeric query shapes fail loudly | `CollisionQueryError` validation | Preserved |
| Malformed resident topology fails atomically | `CollisionSceneUpdateError` and path validation | Preserved |
| Finite solver budgets prevent runaway work | Physical-fly/grounded budget outcomes | Preserved |
| Installed portal history selects overlapping EnvCells | `CollisionPlacement` and placed-motion traversal | Preserved when topology is installed; absent topology has no reconstruction promise |
| Leaving retail's outdoor landscape lattice is observable | `MissingCoverage::outside_world` | Non-gating outside-scene status; keep simulating in the last valid anchor frame and recanonicalize on return |

## Phased Implementation

### Phase 0: Baseline and Contract Census

#### Deliverables

- Preserve the current water-barrier/collision-filter slice as a reviewable baseline before the
  residency cutover; do not mix unrelated behavior changes into this plan.
- Produce a complete live-code census of `CollisionQuery`, `MissingCoverage`, `CoverageRequest`,
  `AwaitingCoverage`, `InvalidPhysicalBodyPlacement`, activity events, camera missing fields, and
  jump missing-coverage readiness.
- Record the selected replacement names in this plan before editing live contracts.

#### Acceptance Criteria

- Every live coverage consumer is assigned to a later phase.
- No consumer is retained merely because a test encodes the old architecture.
- The current dirty collision-filter work is either committed by explicit user request or otherwise
  identified as the immutable implementation baseline.

#### Task Checklist

- [ ] Census shared world symbols and callers.
- [ ] Census host/camera serialized contracts and frontend consumers.
- [ ] Confirm anchor-relative open-space motion can recanonicalize after leaving either landscape axis.
- [ ] Confirm initial forbidden-water placement reaches the ordinary barrier solver without activity gating.
- [ ] Update this plan's open decisions and course-correction log.

#### Decisions and Course Corrections

- Pending execution.

### Phase 1: Total Installed-Scene Collision Queries

#### Deliverables

- Rename `CoverageRequest` to an honest geometric name such as `SphereSweep`; retain its validated
  start, end, anchor, and radius facts without residency semantics.
- Delete `MissingCoverage`, `CollisionQuery<T>`, `CollisionScene::coverage`, and the
  source-neighbor completeness calculation used only by coverage proof.
- Make movement, grounded obstruction, placement, support, cell transit, and placed-motion queries
  return their domain result directly inside `Result<_, CollisionQueryError>`.
- Have every query iterate only installed touched owners. Missing owners contribute no facts.
- Preserve atomic scene update validation and static-shadow compilation for installed sources.
- Make a missing prior EnvCell fall through the existing loaded-topology/outdoor recovery path rather
  than produce a residency result.
- Keep optional restrictions body-primary and evaluate them only from installed terrain facts.
- Replace clamped owner derivation with a signed candidate-owner calculation. When no canonical
  owner exists, query no terrain/topology and preserve the last valid anchor-relative frame.

#### Acceptance Criteria

- An empty `CollisionScene` returns no contacts or supports for valid geometry requests.
- Transit and placed-motion requests over absent topology produce deterministic best-effort
  placement rather than `MissingCoverage`.
- A sweep beyond `0x00..0xFE` sees open space, preserves finite motion, and does not clamp or wrap.
- Installed terrain, BSP, portal, water-barrier, and two-sphere differential tests retain their
  behavior.
- Invalid radius, non-finite geometry, malformed timing, and inconsistent resident topology still
  fail loudly.
- No generic wrapper remains whose only possible success variant is `Complete`.

#### Task Checklist

- [ ] Cut query request vocabulary from coverage to geometry.
- [ ] Remove coverage proof and missing-owner propagation.
- [ ] Totalize contact and support queries over partial scenes.
- [ ] Totalize cell transit and placed-motion traversal over partial scenes.
- [ ] Rewrite focused query tests around installed-scene semantics.
- [ ] Delete tests whose only purpose was preserving coverage suspension.

#### Decisions and Course Corrections

- Pending execution.

### Phase 2: Flatten Physical Solvers

#### Deliverables

- Delete physical-fly full-sweep coverage preflight and `PhysicalFlyOutcome::MissingCoverage`.
- Delete grounded `pair_coverage`, missing-result merging, `GroundedOutcome::MissingCoverage`, and
  every coverage branch threaded through step, settle, slide, support, and placement helpers.
- Return ordinary internal values from solver helpers instead of `CollisionQuery<T>`.
- Preserve substep/contact budgets, exact rollback rules for real contacts, and atomic body-tick
  transactions.
- Continue gravity, velocity, impulses, character drive, and portal-aware movement when the scene is
  partial or empty.
- Continue the same integration outside the outdoor landscape lattice and recanonicalize without a
  snap when motion returns to a representable owner.
- Preserve the primary-sphere selection of filtered whole-water restrictions.

#### Acceptance Criteria

- A physical-fly body crosses an unloaded landblock seam without holding its prior pose.
- An unsupported grounded body falls through an empty scene while retaining bounded integration.
- A driven grounded body continues planar and vertical response against whatever installed geometry
  remains.
- Bodies crossing the landscape lattice edge continue instead of returning a terminal outcome.
- Loaded-scene retail differential suites remain green.
- Missing geometry cannot produce a solver-inactive outcome.

#### Task Checklist

- [ ] Flatten physical-fly results and helper contracts.
- [ ] Flatten grounded results and helper contracts.
- [ ] Flatten generic physical-body tick translation.
- [ ] Add focused open-scene motion tests for free and grounded bodies.
- [ ] Re-run stair, wall-slide, cliff, mound, water, and portal differential matrices.

#### Decisions and Course Corrections

- Pending execution.

### Phase 3: Remove Coverage-Gated Body Lifecycle

#### Deliverables

- Remove `PhysicalBodyActivity::AwaitingCoverage` and every tick gate derived from it.
- Collapse `PhysicalBodyActivity` and `InvalidPhysicalBodyPlacement`; initial forbidden-water
  placement proceeds to the ordinary solver instead of creating registration activity.
- Remove `initial_physical_body_activity`, `physical_body_missing_coverage`, coverage restoration,
  `evaluate_physical_body_activity`, and scene-replacement body reevaluation.
- Define one non-gating scene-residency value derived from the final primary-sphere owner, for
  example `PhysicalBodySceneResidency::{Resident, MissingOwner, OutsideLandscape}`. These variants
  differ diagnostically, never physically.
- Put that derived fact in the generic tick result so consumers never rederive owner residency.
- Do not persist or refresh residency solely to drive diagnostics unless a named current consumer
  requires transition deduplication.

#### Acceptance Criteria

- Every registered body ticks regardless of installed collision owners.
- Replacing interest does not iterate or mutate registered bodies.
- Scene-residency status differs between an installed final owner and a missing final owner while
  both solves still commit.
- No activity field, event, or UI label implies that missing collision makes a body inactive.
- Registration failures remain typed and limited to definition/input invariants, not installed
  collision policy.

#### Task Checklist

- [ ] Remove missing-coverage activity state and gates.
- [ ] Resolve or delete invalid-placement activity.
- [ ] Remove scene-replacement body reevaluation.
- [ ] Add final-owner residency derivation to the tick contract.
- [ ] Delete dead activity event plumbing and tests.

#### Decisions and Course Corrections

- Pending execution.

### Phase 4: Host, Camera, and Character-Control Cutover

#### Deliverables

- Keep `SimulationInterestController` and revisioned host scene replacement wholly consumer-owned.
- Remove body reevaluation and body-activity event production from
  `HostSimulationRuntime::replace_interest`.
- Replace camera `MissingCoverage`, `missingLandblocks`, and hold-path behavior with a successful
  solved path plus orthogonal scene-residency status.
- Let presented-viewer portal traversal consume installed topology and publish its best-effort path;
  it must not veto an already committed physical-body tick because topology is absent.
- Remove `CharacterJumpReadiness::MissingCoverage`, `CharacterJumpRejection::MissingCoverage`, and
  camera control gates on physical activity. Missing support naturally yields unsupported/airborne
  behavior.
- Update Explorer status text to distinguish `Solved` from collision scene residency. Do not call an
  outside-interest body stalled, frozen, or awaiting coverage.
- Preserve consumer access to the missing final owner so future spawned-entity policy can tear down
  its local representation.

#### Acceptance Criteria

- The physical camera continues moving when it outruns collision interest.
- Camera motion paths no longer hard-snap to a hold solely because collision data is absent.
- Grounded jump eligibility depends on actual contact/controller state, not collision residency.
- Interest replacement remains revisioned, atomic, and independent from body registration/ticks.
- Frontend TypeScript types contain no stale missing-coverage vocabulary.

#### Task Checklist

- [ ] Simplify host interest replacement and event queues.
- [ ] Simplify camera registration and tick presentation.
- [ ] Replace camera status transport and frontend evaluation.
- [ ] Remove jump missing-coverage contracts.
- [ ] Rewrite app-local tests around open scene edges.

#### Decisions and Course Corrections

- Pending execution.

### Phase 5: Resteer and Dry-Run the Remaining Cutover

#### Deliverables

- Review actual deletion count, remaining wrapper types, runtime allocations, and cyclomatic
  complexity after the behavior cutover.
- Dry-run camera registration, stationary ticks, landblock seams, EnvCell entry/exit, interest
  eviction under a body, re-entry into loaded geometry, and outdoor landscape exit/re-entry.
- Decide whether scene-residency transition events have a proven current consumer or should remain
  per-tick result data only.
- Reorder cleanup work if stale lifecycle concepts still dominate the architecture.

#### Acceptance Criteria

- No remaining phase depends on an unspecified coverage or restoration behavior.
- Every surviving residency field and event has a named consumer and distinct scenario.
- Any newly discovered compatibility regression inside fully installed collision scenes is fixed
  before cleanup.

#### Task Checklist

- [ ] Review diff and complexity changes with the user.
- [ ] Dry-run loaded and partial-scene scenarios.
- [ ] Record course corrections in this plan.
- [ ] Confirm the final diagnostic contract.

#### Decisions and Course Corrections

- Pending execution.

### Phase 6: Cleanup, Documentation, and Acceptance

#### Deliverables

- Sweep `MissingCoverage`, `AwaitingCoverage`, coverage-hold, dormant-body, restoration, and related
  dead vocabulary from live code, serialized contracts, metrics, comments, and UI.
- Add supersession notes to historical execution plans without rewriting their incident record.
- Update active dynamic-entity and spawned-entity roadmap contracts to the installed-scene model.
- Remove obsolete tests instead of preserving dead architecture through renamed assertions.
- Run a focused code-quality pass over every touched module, especially `grounded.rs`,
  `physical_body.rs`, `scene.rs`, host simulation composition, and camera presentation.
- Perform Explorer acceptance at an ordinary loaded landblock, an EnvCell portal, a landblock seam,
  and an intentionally under-provisioned interest edge.

#### Acceptance Criteria

- `rg` finds no live missing-coverage lifecycle vocabulary outside superseded historical docs.
- Fully resident Explorer collision behavior remains consistent with the pre-cutover baseline.
- Under-provisioned collision interest produces continued motion plus explicit non-gating status.
- No body or collision query loads, requests, retains, or evicts content.
- All Rust and TypeScript quality gates pass.

#### Task Checklist

- [ ] Delete dead symbols, exports, tests, and diagnostics.
- [ ] Update active plans and annotate historical plans.
- [ ] Run formatter, clippy with warnings denied, and affected Rust suites.
- [ ] Run Svelte/TypeScript checks, Vitest, and Prettier.
- [ ] Run Explorer acceptance and record results.
- [ ] Complete a final code-quality review before commit.

#### Decisions and Course Corrections

- Pending execution.

## Verification Matrix

| Scenario | Required result |
| --- | --- |
| Empty scene, physical fly | Full bounded requested motion; missing-owner status |
| Empty scene, grounded body | Gravity and drive continue; no coverage hold |
| Loaded flat terrain | Existing support and grounded motion unchanged |
| Loaded wall/stair/mound | Existing retail differential outcomes unchanged |
| Loaded whole-water neighbor | Ordinary body blocked; excluded viewer body crosses |
| Missing whole-water neighbor | Both bodies see open space; missing-owner status after crossing |
| Interest eviction under stationary body | Next tick continues; no body reevaluation during replacement |
| Missing retained EnvCell | Best-effort installed-topology/outdoor placement; no hold |
| Re-entry into loaded geometry | Best-effort ordinary separation; no seamless-recovery guarantee |
| Missing neighbor-owned overlap | Collision may be absent by explicit concession |
| Camera interest edge | Motion path continues and reports scene residency separately from solve status |
| Outdoor landscape edge | Motion continues anchor-relative through open space, reports outside-scene status, and can recanonicalize on return |
| Initial body inside installed whole-water block | Registration succeeds; ordinary bounded barrier response owns any correction |

## Risks and Mitigations

### Partial topology can relabel a body outdoors

This is an accepted concession. Surface missing-owner residency and do not claim that placement
recovered authoritatively. Consumers requiring exact placement must maintain interest or recreate the
body from authoritative state.

### A body can re-enter loaded geometry while deeply overlapping it

Keep bounded separation and contact budgets. Do not add unbounded recovery. A consumer that allowed
the body to simulate outside interest owns authoritative reset/teardown policy.

### Camera presentation can observe different partial topology than its prior viewer path

Body tick and viewer derivation continue to share one immutable host scene snapshot. Best-effort
placement may change, but it cannot result from two scene revisions inside one transaction.

### Removing coverage wrappers can accidentally weaken real input validation

Retain `CollisionQueryError` (or an honestly renamed successor) for non-finite geometry, invalid
radius/distance, invalid motion timing, and malformed resident topology. Tests must exercise each
surviving error clause.

### Diagnostic status can regrow into solver policy

Name it scene residency, keep it orthogonal to solve status, and prohibit collision/contact code from
branching on it. Any future gating behavior requires a separate consumer-policy plan.

### Historical plans contradict the new policy

Preserve their execution record but add concise supersession notes. Update active roadmap contracts
so future work does not rebuild coverage suspension from stale guidance.

## Definition of Done

- [ ] Missing collision products behave as absent geometry in every collision query family.
- [ ] Physical-fly and grounded bodies continue simulating outside collision interest.
- [ ] No shared or app-local body freezes because collision coverage is absent.
- [ ] Missing neighbor-owned overlap geometry is explicitly accepted and not recomputed as a hidden
      completeness requirement.
- [ ] Scene-residency status is computed once by its owning layer and surfaced without gating motion.
- [ ] EnvCell and viewer placement use installed topology without coverage holds.
- [ ] Interest replacement does not inspect or mutate bodies.
- [ ] Fully loaded retail differential behavior remains green.
- [ ] Dead coverage lifecycle code and vocabulary are removed in the same cutover.
- [ ] Active architectural docs reflect the new contract; historical plans identify supersession.
- [ ] Rust formatting, clippy with warnings denied, and affected tests pass.
- [ ] Svelte/TypeScript checks, Vitest, and Prettier pass.
- [ ] Explorer acceptance covers loaded behavior and an intentionally incomplete scene edge.

## Open Questions

None. New questions discovered during execution must be recorded before broadening scope.

## Execution Log

- 2026-08-15: User ratified external-only interest, absent collision as open space, continued body
  simulation outside interest, lazy non-gating status, and the missing neighbor-overlap concession.
- 2026-08-15: Evidence review corrected the presumed `0x00..0xFF` outdoor range: retail's 2,040-cell
  landscape accepts landblock indices `0x00..0xFE` and nulls outdoor placement beyond it. Whether a
  local body may continue in a non-canonical frame remained a policy decision.
- 2026-08-15: User ratified identical open-space simulation semantics outside interest and outside
  the landscape lattice. Bodies retain an unclamped anchor-relative pose and may recanonicalize on
  return. User also ratified registration inside forbidden water, leaving correction to the ordinary
  solver and eliminating the remaining activity-lifecycle justification.
