# Holtburger Grounded Landing Threshold and Contact-Slide Plan

Status: Final — evidence-grounded, awaiting execution
Created: 2026-08-15
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Ground-truth predecessor: `docs/plans/holtburger-setup-volume-colliders-and-cell-shadow-index-plan.md`
(its "documented gap" decision entry records the discovery evidence)

## Context and Boundaries

### Goal

Give the grounded solver retail's two-threshold walkable model — land leniently, walk strictly —
so bodies on too-steep surfaces are classified as grounded contact-slide instead of airborne,
reproducing retail's landing classification, contact-plane retention, and (eventually)
broadcastable sliding motion state.

### Motivating Evidence

- Retail selects `SPHEREPATH::walkable_allowance` per transition by the body's `OnWalkable`
  state (`acclient.c:301469-301474`, `:301563-301569`; `OBJECTINFO` state bit 2): airborne bodies
  use **0.0871557** (cos 85°) with a 0.04m step-down (`:302009`); walking bodies use
  `OBJECTINFO::get_walkable_z()` (the standard 0.667 floor threshold) with authored step heights.
  A falling body therefore accepts nearly any upward-tilted surface as a landing contact; the
  next walking transition strict-checks a too-steep surface and the body stays in contact-slide.
- **The retail slide is classification, not dynamics.** `CPhysicsObj::calc_acceleration`
  (`acclient.c:306176`) zeroes acceleration only when `Contact && OnWalkable`; a sliding body
  keeps full gravity. `CPhysicsObj::calc_friction` (`acclient.c:304541`) runs only when
  `OnWalkable`; the slide is frictionless. Velocity response during slide is the ordinary
  `(1 + elasticity)` collision-normal clip (`handle_all_collisions`, `acclient.c:310019-310042`)
  our restitution response already models. Our airborne-with-contact body therefore already
  traces nearly the retail trajectory; what differs is the **state and its consumers**:
  - contact-plane and landing classification (`Contact` set, environment-collision reporting,
    `MovementManager::LeaveGround` on contact loss);
  - the lenient landing gate that produces that contact plane at all;
  - the 0.04m airborne step-down that snags landings slightly below a falling body;
  - the greppable `Sliding` state a future broadcast/animation consumer needs.
- State derivation, pinned at `CPhysicsObj::SetPositionInternal` (`acclient.c:310624-310760`):
  `Contact` (0x1) = `collision_info.contact_plane_valid`; `OnWalkable` (0x2) = Contact and
  `contact_plane.N.z >= PhysicsGlobals::floor_z`; `Sliding` (0x4) = `sliding_normal_valid`,
  where the sliding normal is copied from the transition's final collision normal
  (`acclient.c:300975`) — Sliding is collision bookkeeping, **not** simply
  `Contact && !OnWalkable`. Contact loss clears OnWalkable and fires `LeaveGround`.
- Jump availability is **not** affected: `CMotionInterp::jump_is_allowed` requires transient
  `Contact | OnWalkable` (`acclient.c:330197-330202`), so a sliding retail body is denied
  exactly as our airborne-with-contact body is.
- Retail's `Sliding` transient (ACE `PhysicsEngine.cs:8-20`) is derived from collision results
  each transition, while our `PhysicalSurfaceMotion::Sledding` mirrors an authored physics-state
  policy set by the server. They are different mechanisms and stay separate.

### In Scope

- A landing/walking walkable-threshold pair in the grounded configuration, retail-selected by
  the body's current ground state, plus the 0.04m airborne step-down distance.
- A contact-slide ground state between grounded and airborne: contact plane retained,
  gravity retained, no friction, ordinary restitution response — classification and reporting,
  not new dynamics.
- State transitions: airborne → slide (lenient landing), slide → grounded (contact normal
  reaches the walking threshold), slide → airborne (contact lost, with the LeaveGround-style
  consequence), walkable → slide (walking off a crest re-lands leniently within the same tick's
  solve rather than popping through a reported airborne state).
- Retail-differential coverage transliterated independently of production: landing acceptance
  thresholds, state derivation (`Contact`/`OnWalkable` from the contact plane), slide gravity
  and frictionlessness, crest walk-off continuity, and the ball-flank descent inherited from
  the volume plan.
- Contract propagation: `ContactState`/tick-status consumers (jump readiness mapping, host
  camera contracts, Explorer status surfaces, motion snapshot) carry the new state losslessly.
- Probe runtime evidence on real steep-terrain content.

### Out of Scope

- Fall damage, stamina, and server interop consuming the new state — future consumers; this
  plan only makes the state exist and be correct.
- Motion-state broadcast/animation selection (dynamic-entity roadmap owns that); this plan
  delivers the lossless state it will read.
- Water contact and the stationary-fall/stop/stuck transients (`handle_all_collisions`
  `frames_stationary_fall` machinery), and the rest of `TransientStateFlags`.
- `calc_friction`'s walking-mode gates (the 0.25 normal-velocity, 1.5625/6.25 magnitude, and
  cos 10° slope special cases) — existing walking-friction behavior, audited separately if the
  current `surface_friction` is found to diverge.
- Any change to the volume or BSP narrow phases, the collision scene, or the spatial index.
- Retail `Sledding` policy behavior (already implemented as authored surface motion).

## Ground Truth

| Question | Source |
| --- | --- |
| Two-threshold selection and 0.04m airborne step-down | `acclient.c:301469-301474`, `:301563-301569`, `:302009` |
| Standard walking threshold | `OBJECTINFO::get_walkable_z` (`acclient.c:6001`), `RETAIL_WALKABLE_NORMAL_Z` |
| Transient-state derivation after a transition | `CPhysicsObj::SetPositionInternal` (`acclient.c:310624-310760`) |
| Slide gravity | `CPhysicsObj::calc_acceleration` (`acclient.c:306176`): zeroed only for `Contact && OnWalkable` |
| Slide frictionlessness | `CPhysicsObj::calc_friction` (`acclient.c:304541`): gated on `OnWalkable` |
| Slide velocity response | `CPhysicsObj::handle_all_collisions` (`acclient.c:310019-310042`), already mirrored by the restitution response |
| Sliding-normal bookkeeping | `COLLISIONINFO::set_sliding_normal` (`acclient.c:300478`), copy site `:300975` |
| Landing bookkeeping | `SPHEREPATH::set_collide` (`acclient.c:344183`), volume landing allowance writes (`:344263`, `:347092`, `:346530`) |
| Walkable acceptance sites consuming the allowance | `acclient.c:343578`, `:343803`, `:345609` |
| Jump gating parity | `CMotionInterp::jump_is_allowed` (`acclient.c:330177-330230`) |
| Existing solver structure | `crates/holtburger-world/src/spatial/grounded.rs` (`solve_grounded`, `has_walkable_support_contact`, `EdgeProtection`), `physical_body.rs` (`ContactState`, `PhysicalSurfaceMotion`, `surface_friction`) |
| Existing differential pattern | `grounded_retail_differential.rs`, `restitution_retail_differential.rs`, `volume_retail_differential.rs` |
| Jump consumer | `crates/holtburger-core/src/client/character_jump.rs` (`CharacterJumpReadiness`) |

## North Stars

1. Land leniently, walk strictly — the asymmetry is the feature; never collapse it back to one
   threshold "for simplicity."
2. The slide is a **derived ground state**, not dynamics and not a policy: no new friction or
   velocity math, orthogonal to authored `Sledding` surface motion.
3. Observable parity over structural mimicry: same landing classification moments, same contact
   retention, same jump denials — not retail's transition machine.
4. Differential-first: the oracle for landing acceptance and state derivation exists before the
   production routing changes, because this touches the most oracle-guarded code in the repo.
5. Lossless state for future consumers: animation, fall classification, and broadcast read the
   slide state later; nothing in this plan may flatten it into a boolean.
6. Contracts stay honest at every boundary: a consumer that cannot represent the new state
   fails loudly rather than mapping it to `Airborne` silently.

## Phased Implementation

### Phase 1: Transliterated oracle

The retail mechanics are already pinned (see Motivating Evidence and Resolved Questions); what
remains is encoding them as an independent oracle before production changes.

Deliverables:

- An oracle module in the differential pattern (independent of production helpers) answering:
  does this landing accept at this normal and threshold state; what `Contact`/`OnWalkable`
  classification results from this contact plane; does gravity/friction apply in this state.
- Oracle unit tests: flat landing, steep landing (between thresholds), near-vertical rejection
  (below 0.087), classification for each state combination, slide-state gravity retention and
  frictionlessness.

Acceptance criteria: oracle tests pass with citations on every expectation.

### Phase 2: Threshold pair and contact-slide state in `holtburger-world`

Deliverables:

- `GroundedConfig` carries the walking threshold, the landing threshold (retail 0.0871557 as
  the authored default), and the airborne step-down distance (retail 0.04m); the
  single-threshold field's vocabulary is swept.
- Ground-state shape extended to express contact-slide with its contact-plane normal; producers
  derive it from collision results per retail's `SetPositionInternal` rules, consumers read it —
  no consumer re-derives.
- `solve_grounded` routing: threshold and step-down selection by current state; lenient landing
  produces the slide state with the contact plane retained; gravity retained and no friction in
  slide (assert structurally that the friction path cannot run for the slide state); the four
  In-Scope transitions implemented and unit-tested.
- Retail-differential scenarios against the Phase 1 oracle: landing acceptance sweep across
  normals, steep-face landing classification and next-tick continuation, crest walk-off
  continuity, slide-to-walkable settle, ball-flank descent.

Acceptance criteria:

- `cargo test -p holtburger-world` passes including the new differentials.
- The existing grounded and restitution differential suites pass unchanged wherever their
  scenarios stay above the walking threshold; below-threshold expectation changes are each
  justified against the oracle in this doc — never adjusted to make production pass.

### Phase 3: Contract propagation

Deliverables:

- `ContactState`/tick-result consumers updated: jump readiness maps slide to its
  contact-without-walkable rejection (retail parity per `jump_is_allowed`); host camera
  contracts and Explorer status surfaces represent the state explicitly.
- Motion-snapshot shape carries the slide state losslessly for the future broadcast consumer.
- Probe grounded routes report the new state.

Acceptance criteria:

- Workspace tests pass; no consumer maps slide to grounded or airborne silently.
- Probe route over a steep real landblock shows land → slide → settle with plausible descent.

### Phase 4: Resteering checkpoint

- Re-run the crest/steep-face probe routes; compare landing classification points and descent
  traces against the oracle; decide whether any remaining divergence warrants substep-level
  work.
- Audit whether the existing `surface_friction` walking behavior needs the `calc_friction`
  gate special cases (out of scope here; spin out if divergent).
- Dry-run Phase 5 against accumulated debt.

### Phase 5: Runtime verification and cleanup

- Probe evidence on real mountainous content (Direlands-class landblock) recorded in this doc:
  landing classification point, slide descent trace, walk-off continuity.
- Sweep stale single-threshold vocabulary from symbols, comments, docs, and any UI labels.
- Update `crates/holtburger-world/ARCHITECTURE.md` ground-state and threshold description.
- Mark the predecessor plan's documented-gap entry as superseded by this plan's outcome.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing differential suites encode single-threshold behavior below the walking threshold | Audit in Phase 2; every changed expectation justified against the oracle, never adjusted to make production pass |
| The slide state leaks into consumers as a silent boolean | North star 6; Phase 3 acceptance forbids silent mapping; type the state so exhaustive matches break loudly |
| Someone "improves" the slide with friction or damping | North star 2 with the `calc_friction` citation: retail's slide is frictionless; a damped slide is a divergence needing a marker and census |
| `Sledding` and slide-state routing get entangled | Proven distinct in Motivating Evidence; share nothing but the ground-state read |
| Crest walk-off implemented as a special path instead of falling out of the landing gate | Retail has no crest mechanism — the gate itself re-lands the body (Resolved Questions 3); differential asserts continuity without a bespoke branch |
| Scope creep into fall damage / broadcast / stationary transients | Out of Scope is explicit; the state is the deliverable, its consumers are not |

## Definition of Done

- [ ] `cargo clippy --workspace` clean; `cargo test --workspace` passes
- [ ] Landing/walking threshold pair and airborne step-down authored-defaulted to retail
      constants with citations
- [ ] Contact-slide state derived per `SetPositionInternal` rules, transitioned, and consumed
      losslessly end to end
- [ ] Differentials: landing acceptance sweep, state derivation, slide gravity and
      frictionlessness, crest continuity, ball-flank descent — all against the independent
      oracle
- [ ] Existing grounded/restitution differentials pass or have oracle-justified updates
- [ ] Probe evidence on real steep content recorded in this doc
- [ ] Vocabulary swept; architecture docs updated; predecessor gap entry closed
- [ ] Any deliberate departure carries a `RETAIL QUIRK`/`RETAIL DIVERGENCE` marker

## Open Questions

None. All four draft questions were resolved with evidence — see Resolved Questions.

## Resolved Questions

1. **Transient derivation** — `CPhysicsObj::SetPositionInternal` (`acclient.c:310624-310760`):
   `Contact` = contact-plane validity; `OnWalkable` = Contact and plane normal z ≥ `floor_z`;
   `Sliding` = sliding-normal validity, copied from the transition's final collision normal
   (`:300975`) — collision bookkeeping, not `Contact && !OnWalkable`. Contact loss clears
   OnWalkable and fires `MovementManager::LeaveGround`.
2. **Slide velocity pipeline** — there is none. `calc_acceleration` (`:306176`) keeps gravity
   for any state other than `Contact && OnWalkable`; `calc_friction` (`:304541`) is gated on
   `OnWalkable`, so slides are frictionless; the only velocity change is the ordinary
   `(1 + elasticity)` normal clip in `handle_all_collisions` (`:310019-310042`), which our
   restitution response already models. This collapsed the plan's dynamics scope to zero: the
   slide is classification and reporting.
3. **EdgeProtection interplay** — structurally nil. Both threshold-selection sites branch on
   `OnWalkable` (`:301469-301474`, `:301563-301569`); an edge-protected creature holding at a
   crest remains OnWalkable, so its protected-step evaluation keeps using `get_walkable_z` and
   the landing threshold cannot reach it. Crest walk-off for unprotected bodies works through
   the landing gate itself — a brief contact-invalid segment re-lands leniently — with no
   special crest mechanism in retail to mirror.
4. **Physical-fly scope** — `walkable_normal_z` is consumed only by `grounded.rs` and validated
   in `physical_body.rs`; the physical-fly solver has no walkable concept. Grounded-only scope
   confirmed.

## Decisions and Course Corrections

- (2026-08-15) Plan created from the walkable-allowance gap discovered and sharpened during the
  setup-volume-colliders plan; see that plan's decision entry for the discovery evidence.
- (2026-08-15) Finalized after resolving all four draft questions from the decompile. The
  largest correction: the draft assumed retail's slide was friction-damped and budgeted a slide
  velocity/friction port; `calc_friction`'s `OnWalkable` gate proves the slide is frictionless
  and gravity-driven, so our current airborne-with-contact trajectory is already dynamically
  close and the plan narrowed to state classification, the landing gate, the 0.04m airborne
  step-down, and lossless contract propagation. Phase count shrank accordingly.
