# Holtburger 3D Precise Jump Plan

Status: **Paused at Resteer A — sampled collision failures cannot yet prove red.**

Created: 2026-08-30  
Branch: `holtburger-3d-precise-jump`  
Origin: Client-mode `Shift+Space` precise-jump targeting vision

## Execution Progress

- 2026-08-30 — Phase 1 complete. Added the collision-backed finite static-surface ray, exact hit
  placement, collision-owner proof, explicit coverage policy, and nine focused tests. Validation:
  `cargo test -p holtburger-world` (536 passed) and
  `cargo clippy -p holtburger-world --all-targets -- -D warnings`.
- 2026-08-30 — Phase 2 complete. Added the continuous retail-bounded capability envelope,
  body-derived landing tolerance, exact lowest-extent inverse solve, caller-budgeted higher-arc
  candidates, and eight focused tests. Validation: `cargo test -p holtburger-core` (301 passed) and
  `cargo clippy -p holtburger-core --all-targets -- -D warnings`.
- 2026-08-30 — Phase 3 paused before implementation. Read-only inspection proved that
  `SpatialScene::tick_physical_body` runs the ordinary static-environment solver without dynamic
  contacts, while `prepare_dynamic_entity_collection` plus prepared commits adds immutable
  tick-start peer trajectories and directional dynamic response. Choosing between static-only
  preview and frozen-snapshot peer obstruction changes the meaning of blue/red and requires user
  confirmation.
- 2026-08-30 — Phase 3 resumed after user decision: preview prediction excludes dynamic bodies.
  Dynamic bodies remain ordinary commit-time obstructions and may reject or alter a launch after a
  preview; they are neither target surfaces nor frozen predictive obstacles.
- 2026-08-30 — Phase 3 complete. Added a bounded, pure first-landing predictor over cloned
  `SpatialScene` state and the ordinary 30 Hz static-environment body solver. Eleven focused
  fixtures cover prediction/actual-solve parity, terrain, raised and lowered ledges, wall, ceiling,
  first-landing interception, steep sliding contact, dual-sphere clearance, EnvCell placement,
  stale proofs, missing coverage, exhausted work, and explicit dynamic-peer exclusion. Validation:
  `cargo test -p holtburger-core` (312 passed),
  `cargo clippy -p holtburger-core --all-targets -- -D warnings`, and
  `cargo fmt --all -- --check`.
- 2026-08-30 — Resteer A measured canonical `dats/assets.hba` collision in an optimized build on
  an AMD Ryzen 9 5900X. The selected 0xDA55 scene contains 834 placed colliders and 236 EnvCells.
  A reachable outdoor target took 52 solver ticks and averaged 0.854 ms over 10,000 evaluations;
  a six-candidate obstructed EnvCell target took 20 total solver ticks and averaged 1.327 ms.
  Analytic generation averaged 0.17-0.20 microseconds. The existing collision probe measured
  deterministic scattered grounded-obstruction and support queries at 0.27 and 0.31 microseconds
  per query over 1,000 queries.
- 2026-08-30 — Resteer A paused on a semantic blocker. A successful sampled candidate proves blue,
  but failure of a finite sample of continuous legal jump extents does not prove that no valid arc
  exists between samples. `AllCandidatesFailed` therefore cannot honestly produce red under the
  current contract. Per the execution stop rule, Phases 4+ have not begun pending user direction on
  red semantics/search completeness.
- 2026-08-30 — Validation surprise after adding the diagnostic harness: core clippy, harness clippy,
  formatting, and all 11 focused predictor tests pass. The full core suite now fails only
  `vector_demand_promotes_and_demotes_with_no_content_reload` because its asynchronous preparation
  call count is 2 instead of 1. The test passes three consecutive isolated runs but fails in the
  full suite even with one test thread, proving suite-context/timing dependence rather than a
  precise-jump assertion failure. It remains unmodified while execution is paused and needs a
  separate reliability investigation before the final gate.

## Context and Boundaries

### Goal

Add a client-mode precise-jump targeting gesture that lets the player point at a static world
surface, see whether their current authoritative body can first land there with a legal AC jump,
and commit the exact predicted launch by clicking a reachable target.

### In Scope

- Enter a client-local precise-jump targeting mode with `Shift+Space` without beginning the ordinary
  charged-jump lifecycle or displaying its power bar.
- Convert the current cursor and the latest coherent client camera into a bounded world-space aim
  ray.
- Resolve the first collision-backed static surface under that ray, including outdoor terrain,
  static setup collision, and EnvCell geometry.
- Classify the surface and requested landing through current host-owned player position, body
  definition, contact state, Jump skill, Run skill/rate, burden, stamina exhaustion state, motion
  table speeds, gravity, collision residency, and walkability.
- Search the legal jump extent and directional planar-speed envelope for a launch whose **first
  acquired walkable support** lies within a body-derived tolerance of the selected surface point.
- Predict the result through the same grounded-body solver and collision scene used by committed
  local motion; analytic ballistics may generate candidates but may not authorize the indicator.
- Display a depth-tested world-space target marker: blue for a proven reachable landing, red for a
  proven unreachable target, and a distinct unproven state before the first complete evaluation or
  while collision coverage is unavailable. An in-flight replacement does not clear the last complete
  marker.
- Attempt the latest blue evaluation with either left-click or a fresh Space press while targeting.
  Red, pending, and unproven targets consume neither gesture and leave precise mode active.
- Commit by opaque evaluation identity. The frontend never supplies skills, body facts, target
  collision identity, jump extent, or velocity.
- Re-resolve mutable capability and body facts on the simulation tick that commits the jump, then
  use one resolved launch for both local physics and the retail `JumpPack` wire path.
- Cancel targeting on explicit cancellation, client lifecycle loss, portal-space transitions,
  visibility loss, focus loss, or loss of a valid local-player/camera generation.
- Add focused Rust and TypeScript tests, a browser-harness visual/input fixture, and a live ACE probe
  comparing predicted and observed first landing.

### Out of Scope

- Targeting dynamic entities, players, creatures, doors, elevators, or other moving collision.
  Current dynamic bodies may invalidate or obstruct a launch at commit time, but they are not valid
  landing surfaces in the first slice.
- Predicting a final resting position after the first walkable contact, including subsequent slide,
  bounce, step-down, or fall.
- Air steering, mid-flight correction, teleporting, server-assisted path following, or modifying the
  launch after it commits.
- Trusting the ACE server's currently unvalidated velocity magnitude. Every submitted vector must be
  derived from the actor's retail-backed movement and jump capabilities.
- Locally deducting stamina or predicting a server vital transaction. The current retail client
  computes a jump cost during admission, while ACE owns deduction; no distinct client-owned resource
  transaction is proven.
- Supporting absent collision content by raycasting rendered triangles or treating visual depth as
  physical truth.
- Pixel-identical retail UI. Precise jump is a deliberate Holtburger client feature, not a reproduced
  retail interaction.
- General-purpose editor picking, decals, navmeshes, route planning, or a generic debug-drawing
  framework.
- Adding precise-jump policy to the Explorer or TUI.

## Ground Truth and Evidence

### Reference Sources

- `acclient-eor-source/acclient.c:329643-330100`
  - `CMotionInterp::get_jump_v_z`, `get_state_velocity`, and `get_leave_ground_velocity` prove the
    actor-local launch axes, vertical velocity source, and the `4 * run_rate` planar magnitude cap.
- `acclient-eor-source/acclient.c:330177-330477`
  - `jump_is_allowed` and `jump` prove support/admission ordering and show that the qualities-owned
    stamina cost is an admission output rather than an alternate launch vector.
- `acclient-eor-source/acclient.c:390559-390615`
  - `ClientCombatSystem::DoJump` performs the local jump, reads the resulting local physics velocity,
    and builds the one autonomous `JumpPack` from that exact vector.
- `acclient-eor-source/acclient.c:423428-423466` and `:678672-678716`
  - `CanJump`, `JumpStaminaCost`, `GetJumpHeight`, and burden rules prove the existing capability
    inputs and formulas.
- `ACE/Source/ACE.Server/WorldObjects/Player.cs:866-945`
  - ACE clamps extent, computes and deducts stamina cost, and applies the client-provided local
    velocity. Its explicit magnitude-validation TODO is evidence that acceptance is not capability
    proof.
- `ACE/Source/ACE.Server/Physics/Animation/MovementSystem.cs`
  - Independent server-side statement of Jump height, Run rate, stamina cost, and burden formulas.

### Existing Holtburger Patterns

- `crates/holtburger-world/src/state/self_movement.rs`
  - `resolve_self_jump_capabilities` already owns authoritative Jump skill, burden, zero-stamina
    exhaustion, motion-table movement facts, and full-extent jump height.
- `crates/holtburger-core/src/client/character_axes.rs`
  - One retail-differential implementation owns signed forward/back/strafe resolution and planar
    speed capping.
- `crates/holtburger-core/src/client/character_jump.rs`
  - `resolve_character_jump` already creates one `ResolvedJump` with paired local/wire and
    world/physics velocities.
- `crates/holtburger-core/src/client/simulation.rs`
  - `prepare_player_jump` samples capabilities, support, body definition, position, and heading at
    commit time; `tick_physical_entities` owns the transactional launch.
- `crates/holtburger-world/src/spatial/scene.rs`
  - `SpatialScene` is cloneable and its prepared physical-body collection commits only after complete
    collision queries succeed.
- `crates/holtburger-world/src/spatial/physical_body.rs` and `grounded.rs`
  - The authoritative body solver owns gravity, dual-sphere response, walkable support acquisition,
    sliding, collision placement, and first-contact state.
- `crates/holtburger-world/src/spatial/collision/static_sphere_sweep.rs`
  - Continuous static collision queries already cover terrain, BSP polygons, balls, cylinders,
    water boundaries, EnvCell traversal, and explicit missing-coverage policy.
- `apps/holtburger-3d/src/client/client-presentation-session.ts`
  - Owns the coherent client camera/viewport used to derive the aim ray without routing frame-hot
    camera state through Svelte.
- `apps/holtburger-3d/src/client/client-lifecycle-session.ts` and
  `apps/holtburger-3d/host/src/client_runtime.rs`
  - Establish the narrow semantic command/event route between app-local UX and core authority.
- `apps/holtburger-3d/src/lib/game/controls/character-input-controller.ts`
  - Owns browser-key arbitration today and must cleanly distinguish an intercepted precise-jump chord
    from an ordinary Space charge.

### Evidence Gathered During Planning

1. **The wire can express the feature.** Retail `JumpPack` and Holtburger's `JumpActionData` carry a
   complete body-local XYZ velocity, extent, release position, and movement epochs. No target
   coordinate exists or is needed on the game-server wire.
2. **The server must not define legality.** ACE currently applies the submitted vector directly and
   carries a TODO to validate/scale magnitude. Precise jump must use a client-owned capability
   envelope rather than probing what ACE accepts.
3. **The vertical capability is already authoritative.** Jump skill, burden, zero-stamina exhaustion,
   and the retail minimum-height floor are already resolved by `WorldState` and used by ordinary
   client jumps.
4. **The horizontal capability is already evidenced.** Retail composes local sidestep and
   forward/back speeds and caps their combined magnitude to `4 * run_rate`; production resolution
   is checked against an independent oracle matrix.
5. **Analytic reachability is insufficient.** A real first landing depends on ceilings, walls,
   intervening ledges, slope walkability, dual-sphere clearance, EnvCell traversal, and collision
   coverage. These are already owned by the grounded solver.
6. **Prediction can be non-mutating.** `SpatialScene` is cloneable, collision snapshots are immutable,
   and physical-body solves are transactional. A speculative clone can replay the actual 30 Hz
   solver without changing authoritative state.
7. **Picking is genuinely absent.** The presentation runtime exposes no world raycast, depth pick,
   target marker, or debug-line primitive. Surface targeting and indicator rendering are explicit
   deliverables rather than assumed wiring.
8. **Relevant baselines are green.** On 2026-08-30,
   `cargo test -p holtburger-core character_jump --lib` passed 8/8 selected tests and
   `cargo test -p holtburger-world static_sphere_sweep --lib` passed 5/5 selected tests.

## Direction Decisions

### D1. Blue Means Solver-Proven First Landing

The analytic projectile equation only rejects impossible candidates and proposes legal launch
vectors. Blue requires speculative execution through the ordinary player body solver until the body
first reacquires `ContactState::Grounded`. `Sliding`, obstruction, timeout, target miss, or an
incomplete collision query is not blue.

### D2. Authority Receives an Aim Ray and Returns an Opaque Evaluation

The browser produces only a camera-derived ray plus a monotonically increasing request sequence and
current world/camera generation. Core resolves the collision target and launch. The accepted target,
collision identity, candidate solution, scene revision, and sampled authority epochs remain on the
host side. Click sends only the evaluation identity.

This prevents a modified renderer from turning the feature into an arbitrary velocity or hidden
surface command.

### D3. Commit Re-solves; It Does Not Replay Preview State

A preview is advisory. Left-click or a fresh Space press on blue schedules an ordered commit intent.
At the next client simulation boundary, core checks that the evaluation still belongs to the current
world generation, samples fresh capabilities/contact/body/scene facts, re-runs the bounded solve to
the retained static target, and commits the newly resolved launch or emits a precise rejection. One
accepted `ResolvedJump` continues to feed local physics and packet construction.

Targeting remains active while commit is pending and exits only after `jump-committed` feedback. A
stale or otherwise rejected commit returns to ordinary targeting with the latest aim; duplicate
activation gestures are ignored while that commit is pending.

### D4. Surface Truth Comes From Collision, Not Render Depth

The frontend derives the camera ray because it owns viewport/camera presentation. The host resolves
the earliest collision surface using resident static collision and the camera's starting placement.
The response returns enough placement/scope information to render the marker at the proven physical
surface. Missing collision coverage is an explicit unproven state, never a red “unreachable” claim.

### D5. Search a Retail-Bounded Continuous Directional Envelope

Precise jump is a new control policy, so it need not be restricted to the finite set of keyboard
axis combinations. It may select a continuous local planar vector, but each component is bounded by
the actor's resolved forward/backward/sidestep capability and the combined vector remains capped by
retail's `4 * run_rate` rule. Vertical velocity remains exactly extent-derived.

The initial search selects the lowest legal extent that produces an accepted first landing. This is
deterministic, minimizes ACE's extent-based stamina cost without locally transacting it, and avoids
gratuitously tall arcs. A higher arc is considered when a lower legal arc is obstructed.

### D6. Prediction Uses a Named Work Budget

Hover evaluation is replaceable and supersedable, unlike click commit. Candidate count, maximum
flight duration, solver tick count, and evaluation cadence must be explicit named limits with
diagnostics. They will be selected from measured representative scenes in Resteer A, not guessed into
the permanent contract.

### D7. Presentation Policy Stays in Client Mode

The chord, mode lifetime, cursor, cancellation, colors, status text, and click behavior remain under
`apps/holtburger-3d/src/client`. Shared crates own only collision queries, actor capability,
prediction semantics, and reusable launch resolution. The renderer receives one minimal
world-indicator draw contract; it does not learn precise-jump state or gameplay reasons.

### D8. Invalid Activation Is Deliberately Inert

Left-click and Space share one app-local activation function. It submits only the latest blue
evaluation. Red, pending, unproven, or absent targets send no host command, produce no input edge,
and do not exit precise mode. The existing marker is the feedback; an invalid activation does not
manufacture a second status message or rejection lifecycle.

### D9. The Marker Is One Atomic Evaluated Snapshot

Pointer movement never independently updates marker position, color, and commit identity. The
frontend retains the last complete evaluation while a newer aim is in flight and atomically swaps all
three facts only when the newest completed sequence arrives. Stale responses are discarded. A gray
pending marker is used only before the first complete evaluation or after a hard world/camera
invalidation, not between ordinary pointer samples.

Aim traffic retains at most one in-flight evaluation and one latest unsent sample. This trades a
small, bounded amount of cursor trailing for a marker that neither flickers nor visually promises a
different landing from the opaque identity click/Space will commit. Activation always commits the
marker actually being displayed, never a newer raw cursor coordinate that has not been evaluated.

A real blue/red boundary may still change color as the evaluated target crosses it. Resteer A will
measure that behavior before adding hysteresis. If stabilization is needed, its spatial margin must
be derived from the existing body/landing tolerance and applied by the evaluation owner; no arbitrary
frontend timer or color debounce may blur reachability truth.

## North Stars

1. A blue target should be trustworthy enough that a miss is a diagnosed race or server correction,
   not ordinary approximation error.
2. The preview and committed jump must use the same capability and physics vocabulary.
3. No renderer-provided numeric fact may become player authority merely because ACE accepts it.
4. Missing evidence should look unproven, not confidently unreachable.
5. Pointer-rate work must remain bounded and replaceable so targeting cannot starve networking or
   the 30 Hz simulation.
6. The target marker should feel embedded in the world—stable, depth-tested, portal-correct, and
   readable—without growing a general editor framework.
7. Ordinary Space jumping and existing client camera controls must remain behaviorally unchanged
   outside precise mode.

## Planned Contracts

Names are provisional but responsibilities are not.

### World Collision

- `StaticSurfaceRayRequest`
  - Starting `WorldPosition`, finite normalized direction, authority-selected maximum reach,
    previous EnvCell, collision filter, and explicit coverage policy.
- `StaticSurfaceRayHit`
  - Earliest hit point, unit normal, hit placement/EnvCell, normalized distance, and walkability
    input facts. It does not classify jump reachability.
- `CollisionScene::cast_static_surface_ray`
  - Uses the same installed terrain/setup/EnvCell collision and placement traversal as body motion.

### Core Prediction

- `PreciseJumpTarget`
  - Host-retained collision-backed target point, normal, placement, scene revision, and body
    acceptance tolerance derived from the current physical definition.
- `PreciseJumpEvaluation`
  - Opaque identity plus one result: reachable with predicted first landing/flight duration, proven
    unreachable with one specific reason, or unproven due to unavailable authority/collision.
- `PreciseJumpSolution`
  - Target, resolved extent, local/world launch velocity, predicted first landing, flight duration,
    and the exact authority epochs required to reject stale commits. Every field has a commit,
    presentation, or diagnostic consumer.
- `evaluate_precise_jump`
  - Pure candidate generation plus bounded speculative solve over an immutable capability/body/
    collision snapshot.
- `commit_precise_jump`
  - Simulation-boundary revalidation that returns the same `CommittedPlayerJump` transaction used by
    ordinary jumps.

### Client Host Boundary

- Replaceable `set_client_precise_jump_aim` command with request sequence and camera/world generation.
- Ordered `commit_client_precise_jump` command carrying only an opaque evaluation identity.
- Explicit `cancel_client_precise_jump` command or lifecycle edge when authority-retained preview
  state needs teardown; do not infer cancellation from an absent future pointer event.
- `client-precise-jump-evaluation` event correlated by sequence and evaluation identity.
- `client-precise-jump-feedback` event for commit/rejection outcome.

### Frontend Presentation

- One app-local precise-jump input state machine composed with `CharacterInputController`.
- One imperative camera-ray sampler on `ClientPresentationSession`; no frame-hot Svelte camera state.
- One latest-request-wins evaluation session that retains the last atomic evaluated marker, ignores
  stale events by sequence/generation, and bounds work to one in-flight plus one latest sample.
- One minimal renderer marker input containing retained scene placement/scope, normal, semantic visual
  state, and marker size. No skills, velocities, or rejection policy reach the renderer.

## Phased Implementation

### Phase 0: Evidence Lock — Complete

#### Deliverables

- Record retail and ACE evidence above.
- Verify existing jump resolver and static sweep baselines.
- Settle authority, solver reuse, collision-backed picking, and server-trust direction decisions.

#### Acceptance Criteria

- [x] Retail source proves how autonomous JumpPack velocity is produced.
- [x] ACE source proves server acceptance is not a legal-capability oracle.
- [x] Existing authoritative capability and transactional solver paths are identified.
- [x] Relevant focused tests pass before implementation.

#### Decisions and Course Corrections

- Do not create a second ballistic collision engine.
- Do not read WebGL depth as collision truth.
- Do not add a local stamina transaction without new server/retail evidence.

### Phase 1: Collision-Backed Surface Ray

#### Deliverables

- Add the smallest source-neutral static surface-ray request/hit types beside existing collision
  queries in `holtburger-world`.
- Implement terrain, triangle/BSP, ball, cylinder, water-boundary, EnvCell-placement, filter, and
  coverage behavior using existing collision asset ownership.
- Add synthetic tests for nearest-hit ordering, starting EnvCell traversal, portal openings,
  landblock crossings, non-walkable normals, exclusions, and missing coverage.

#### Acceptance Criteria

- A ray returns the earliest collidable static surface and exact placement without consulting render
  geometry.
- Missing required owner/cell coverage is distinguishable from a clear ray.
- Invalid or non-finite rays fail loudly.
- `cargo test -p holtburger-world` and clippy pass.

#### Task Checklist

- [x] Reuse collision shape iteration and landblock-touch calculations rather than duplicate scene
      ownership logic.
- [x] Preserve one explicit query policy; no implicit “best effort” fallback.
- [x] Prove that an indoor ray cannot select geometry through a sealed wall or unrelated EnvCell.

#### Decisions and Course Corrections

- Keep the public request in the established collision-query coordinate contract (`anchor` plus
  anchor-local origin) instead of introducing `WorldPosition` only for this query. The direction is
  required to be finite and normalized, so hit distance remains meters without an ambiguous scale.
- Reuse the placed-motion portal traversal through a private zero-radius path. Public body placement
  and sweep APIs continue to reject zero-radius bodies; the ray does not manufacture an epsilon
  radius that could change portal selection.
- Clip required collision coverage to the earliest installed hit. An unavailable owner before that
  hit keeps the result unproven, while unavailable geometry strictly behind a proven nearer surface
  cannot invalidate the hit.
- Return the exact hit `SpatialMembership` and `CollisionOwnerProof`. Consumers can retain the
  collision-backed target and later reject it if its supplying owner product changes.
- No Phase 1 debt was accepted. The static shape-family tests cover terrain, BSP polygons, balls,
  cylinders, water boundaries, cross-landblock frames, EnvCell portal traversal, sealed cells,
  exclusions, invalid geometry, and missing coverage.

### Phase 2: Inverse Launch Candidate Solver

#### Deliverables

- Add precise-jump capability-envelope types in `holtburger-core` using current
  `SelfJumpCapabilities`, `CharacterMovementKinematics`, and physical body definition.
- Factor shared extent-to-vertical-velocity computation so ordinary and precise resolution cannot
  drift.
- Generate candidate extent/planar-vector pairs from target displacement under gravity.
- Reject vertically impossible, directionally over-capability, overburdened, unsupported, stale, or
  invalid inputs before collision simulation.
- Add a retail-differential matrix covering forward, backward, lateral, diagonal, low/high targets,
  minimum-height floor, burden, Jump skill, Run rate, and zero stamina.

#### Acceptance Criteria

- Every analytic candidate is within the actor's directional component limits and combined retail
  speed cap.
- The solver returns no arbitrary velocity accepted only because the packet can encode it.
- Candidate ordering is deterministic and lowest-extent-first.
- Ordinary charged-jump output remains byte-for-byte/numerically unchanged in its existing tests.

#### Task Checklist

- [x] Name the target tolerance from body support geometry; do not add a naked meter constant.
- [x] Keep target position, launch velocity, and displacement coordinate frames typed at their
      producing boundary.
- [x] Avoid adding stamina cost to a contract unless a named commit or UI consumer emerges.

#### Decisions and Course Corrections

- Factor ordinary and precise vertical launch through one extent-to-velocity function. Existing
  ordinary charged-jump and independent retail-oracle tests remain numerically unchanged.
- Derive the continuous envelope from the same character-axis owner as ordinary control: signed
  forward/backward limits, the authored sidestep cap, and the combined run-speed cap are computed
  once and consumed by both paths.
- Treat the analytic input as a typed displacement between launch and desired landing
  **body-reference** positions. Phase 3 owns converting a collision surface point/normal through the
  support-sphere center and radius; using the raw surface point here would be a coordinate-category
  error.
- Name landing tolerance as the current support-sphere radius. This is the body-owned planar contact
  neighborhood; no unrelated meter constant was introduced.
- Solve the exact lowest capability-legal extent from the descending ballistic root. A named
  caller-supplied candidate budget deterministically samples additional extents through full charge,
  leaving the production count for Resteer A measurement rather than baking in a guess.
- Staleness is not an analytic input property and therefore was not added to this solver. Phase 4's
  authority snapshot/commit transaction owns stale-generation rejection as already planned.
- No stamina-cost field was added. Exhaustion remains represented by the authority-resolved
  full-extent jump height, and overburden/readiness remain explicit pre-prediction rejections.
- No Phase 2 implementation debt was accepted. The eventual production candidate count remains an
  intentionally unresolved measurement output of Resteer A, not code debt.

### Phase 3: Solver-Proven First-Landing Prediction

#### Deliverables

- Build a pure speculative predictor over a cloned `SpatialScene`, immutable collision snapshot,
  current player body, and one candidate launch.
- Replay the ordinary 30 Hz grounded-body solver until first post-launch walkable support,
  obstruction/slide, target miss, explicit query failure, or bounded timeout.
- Return only the first landing and duration needed by commit/presentation. Tests and the live probe
  may collect a diagnostic trace around the same predictor; no production path array is retained
  without a named UI consumer.
- Search higher legal extents only when lower candidates fail and the work budget permits.
- Add fixtures for open flat terrain, elevated ledge, lower ledge, wall, low ceiling, intervening
  platform, steep face, narrow clearance, EnvCell floor, and missing owner.

#### Acceptance Criteria

- A reachable evaluation's reported landing is the first acquired walkable support.
- An intervening walkable surface prevents a farther surface from being marked blue.
- Sliding/non-walkable contact is distinct from walkable landing.
- Prediction mutates neither authoritative scene/body state nor collision residency.
- Tests compare predicted landing against an actual solve from the same initial fixture.

#### Task Checklist

- [x] Prove launch-tick and first-airborne-tick semantics match ordinary client simulation.
- [x] Decide whether snapshot dynamic bodies are conservative obstructions or explicitly excluded;
      document and test the selected first-slice rule.
- [x] Expose one failure reason per reachable input path; do not collapse missing collision into
      unreachable.

#### Decisions and Course Corrections

- Prediction excludes dynamic bodies and uses the ordinary single-body static-environment solver.
  The commit transaction still includes the live tick-start dynamic population, so an actor that
  occupies or enters the path is an explicit commit-time invalidation rather than a speculative red
  preview. This preserves static-target scope and avoids inventing frozen-actor motion semantics.
- Accept a walkable first contact only when both its support-sphere contact point falls within the
  body-derived tolerance and its committed EnvCell/outdoor domain matches the ray-selected target.
  Point proximity alone is ambiguous where authored interior domains overlap.
- Keep red reserved for proven outcomes. Stale target proofs, missing landblock or EnvCell coverage,
  solver-budget exhaustion, and replaceable-work exhaustion remain explicit unproven results.
- Retain no speculative path. The production result contains only the winning launch, first contact,
  normal, quantized duration, and tick count needed by later commit and diagnostics.
- No Phase 3 implementation debt was accepted. Candidate count, tick budget, and evaluation cadence
  intentionally remain Resteer A measurement decisions.

### Resteer A: Fidelity and Work Budget

#### Deliverables

- Benchmark candidate generation and speculative solves against representative outdoor terrain,
  dense static setup collision, and EnvCell scenes using release-like builds.
- Measure candidate count, simulated ticks, collision queries, elapsed time, and latest-request
  supersession behavior.
- Measure marker trailing and blue/red boundary stability under slow aim, rapid sweeps, and camera
  movement; add body-derived spatial hysteresis only if completed evaluations visibly chatter.
- Compare predicted versus actual landing across the fixture matrix.
- Dry-run Phases 4-8 against the concrete evaluation/result types that survived measurement.

#### Acceptance Criteria

- Select and record an evaluation cadence and work budget that cannot starve the client fixed tick or
  network event loop.
- If cloned full solves are too expensive, revise candidate scheduling or execute immutable
  predictions off the authority task; do not silently weaken blue's meaning.
- Remove fields and abstractions that acquired no consumer during the predictor slice.
- User review confirms mode lifetime and directional-envelope decisions before host/UI expansion.

#### Decisions and Course Corrections

- Added `diagnose_precise_jump`, which returns only generated/evaluated candidate counts and total
  solver ticks beside the ordinary outcome. The production prediction API still returns no path or
  benchmark-only timing data.
- Added the reproducible `precise_jump_benchmark` debug-harness binary over canonical collision
  assembly. It accepts explicit outdoor/EnvCell start and target fixtures and runs optimized repeated
  evaluations without the interactive client.
- End-to-end cost is dominated by speculative body solving, not inverse launch math. Even the
  measured 1.33 ms case is material authority-loop work, while the configured hard ceiling is six
  candidates times 160 ticks. The dry-run therefore favors one off-authority blocking worker, one
  in-flight evaluation plus one latest replacement, and retention of the last complete marker.
  Cadence and final work limits remain unselected until red semantics determine how much search is
  required.
- **Blocking gap:** the legal extent domain is continuous. Six deterministic samples are adequate
  for finding and proving some reachable arcs, but their collective failure is not an exhaustive
  collision proof. The current `Unreachable::AllCandidatesFailed` classification must not cross the
  host/UI boundary unchanged.
- Resolution choices requiring user review:
  1. First slice uses asymmetric certainty: sampled success is blue; analytic impossibility and a
     non-walkable selected surface are red; exhausted collision samples are neutral/unproven.
  2. Red behind obstructions remains a requirement, expanding scope to an adaptive interval search
     with a defensible completeness criterion over extent.
  3. Product language treats sampled failure as red despite possible false negatives. This conflicts
     with the plan's proven-red invariant and is not recommended.

### Phase 4: Core Preview and Commit Transactions

#### Deliverables

- Add replaceable precise-aim and ordered commit/cancel commands to `holtburger-core::ClientCommand`.
- Retain at most one current evaluation per active world/player/camera generation.
- Publish correlated evaluation and commit feedback through `ClientViewEvent`.
- Integrate commit into `client::simulation` so fresh re-resolution produces the existing
  `CommittedPlayerJump` and packet path.
- Invalidate retained evaluations on movement beyond tolerance, body/capability epoch change,
  collision scene revision, forced reposition, portal transition, lifecycle reset, or cancellation.

#### Acceptance Criteria

- Preview never launches or mutates the player.
- A valid commit produces exactly one local launch and one Jump action from one fresh resolution.
- Duplicate, stale, foreign-generation, or unreachable evaluation identities cannot launch.
- Ordinary jump lifecycle sequencing remains independent and unchanged.
- Commit rejection is explicit and leaves the player authoritative state unchanged.

#### Task Checklist

- [ ] Keep hover aim replaceable; never queue every pointer sample.
- [ ] Keep commit non-coalescible and monotonically ordered.
- [ ] Compute each stale/fresh decision once and put it in the outcome contract.

#### Decisions and Course Corrections

- _Fill during execution._

### Phase 5: Electron Host and Typed Renderer Boundary

#### Deliverables

- Extend client-only host command/event inventories, serde requests, projection types, Electron
  allowlists, TypeScript payload maps, and strict Zod decoders.
- Add `ClientLifecycleSession` methods/events for aim, commit, cancel, evaluation, and feedback.
- Preserve client/explorer mode isolation and keep startup credentials/private commands unchanged.
- Add Rust/TypeScript contract tests for strict fields, finite coordinates, sequence/generation
  correlation, stale events, and mode inventories.

#### Acceptance Criteria

- Renderer requests contain no extent, velocity, skill, burden, support, or collision identity.
- Evaluation responses contain only presentation-needed placement/state plus opaque commit identity;
  internal capability inputs stay in core.
- Unknown fields and non-finite coordinates are rejected at both typed boundaries.
- Explorer command/event inventory is unchanged.

#### Decisions and Course Corrections

- _Fill during execution._

### Phase 6: App-Local Input and Aim Session

#### Deliverables

- Replace ad hoc chord interception with one testable client input arbitration state machine composed
  with the existing ordinary character controller.
- Enter precise mode without emitting `begin-jump`; pair the intercepted Space release so it cannot
  later emit `release-jump`.
- Route every subsequent fresh Space press and left-click through one precise activation function;
  swallow key repeat and the matching Space release.
- Suspend ordinary character translation while targeting and define how held keys are restored on
  exit.
- Add an imperative `ClientPresentationSession` camera-ray sampler based on the exact camera and
  viewport used by the latest presented frame.
- Add latest-request-wins aim scheduling, pending state, stale-response rejection, cancellation,
  retained atomic evaluation state, click/Space commit, and one pending-commit gate.

#### Acceptance Criteria

- Ordinary Space, Shift walk/run behavior, blur reset, pointer-orbit, and wheel zoom are unchanged
  outside precise mode.
- `Shift+Space` emits no ordinary jump lifecycle edge.
- Focus/lifecycle/portal loss cannot leave a retained aim or click handler active.
- Left-click and a fresh Space press can commit only the latest blue evaluation.
- Red, pending, unproven, and absent-target activation sends no command and preserves precise mode.
- A newer pointer sample does not clear or recolor the last complete marker; the next newest
  evaluation replaces placement, color, and commit identity atomically.
- Click/Space commits the displayed evaluation even when a newer pointer sample is waiting, so the
  action cannot disagree with the marker the user saw.
- A submitted commit preserves precise mode until confirmed; success exits, while rejection resumes
  targeting without a stuck pending state or duplicate launch.
- Camera-ray tests cover viewport scaling, CSS versus drawing-buffer coordinates, yaw/pitch, and
  landblock anchor changes.

#### Decisions and Course Corrections

- _Fill during execution._

### Phase 7: World-Space Target Marker

#### Deliverables

- Add one minimal renderer-owned world marker draw contract with exactly one client consumer.
- Render a compact ring/reticle aligned to the collision normal at the returned physical surface.
- Resolve its scene/portal scope from host-returned placement, depth-test it against the scene, and
  keep its apparent size readable without turning it into a screen-space HUD element.
- Map client policy to blue/reachable, red/proven-unreachable, and neutral/unproven visuals.
- Add teardown and resource-lifetime handling to client presentation ownership.

#### Acceptance Criteria

- Marker position remains stable through camera movement and landblock anchor changes.
- Indoor markers appear only in the correct portal scope and do not render through sealed geometry.
- Depth occlusion behaves correctly outdoors and indoors.
- Marker allocation/update work is bounded and absent outside precise mode.
- Continuous pointer motion produces bounded marker trailing rather than pending/color flicker; no
  stale evaluation can replace a newer displayed snapshot.
- Browser-harness screenshots prove reachable, unreachable, pending/unproven, sloped, and indoor
  states.

#### Task Checklist

- [ ] Prefer a small analytic/ring mesh and one draw path over a generic debug primitive registry.
- [ ] Keep color and mode semantics in client code; renderer consumes resolved visual values.
- [ ] Verify the marker in the real GPU harness, not only SwiftShader.

#### Decisions and Course Corrections

- _Fill during execution._

### Phase 8: End-to-End Commit and Observed-Landing Probe

#### Deliverables

- Extend the non-interactive client probe to request representative precise targets, capture the
  evaluation, commit blue targets, and sample the resulting body trajectory/contact lifecycle.
- Compare predicted first landing, extent, local velocity, maximum height, flight duration, and
  observed first support within named tolerances.
- Verify ACE receives one retail-shaped Jump action and observer presentation sees the corresponding
  jump.
- Cover rejection races: walk after preview, stamina reaches zero, collision revision changes,
  portal begins, target becomes stale, and duplicate click/Space activation.

#### Acceptance Criteria

- On representative flat/elevated/lowered/static-obstruction scenarios, a blue commit reaches the
  predicted first support within body/tick-derived tolerance.
- No red or unproven target launches.
- Prediction/commit disagreement produces a named diagnostic and safe rejection, not a fallback
  launch.
- The existing ordinary live jump probe still passes.

#### Decisions and Course Corrections

- _Fill during execution._

### Phase 9: Cleanup and Final Verification

#### Deliverables

- Remove temporary probes, duplicate formulas, unused diagnostic fields, stale vocabulary, and any
  superseded ordinary-input branches.
- Update relevant architecture docs only where durable ownership changed; keep transient execution
  notes in this plan.
- Run formatting, TypeScript/Svelte checks, Rust checks, clippy with warnings denied, focused/full
  tests, browser harness, and live client probe.
- Review the diff for crate-boundary leaks, implicit fallbacks, unbounded queues, and frame-hot Svelte
  state.

#### Acceptance Criteria

- `cargo test -p holtburger-world`
- `cargo test -p holtburger-core`
- `npm run test:ts`
- `npm run check`
- `npm run check:rust`
- `npm run lint`
- `npm run format:check`
- Browser-harness visual/input scenarios pass without browser errors.
- Live ACE ordinary and precise jump probes pass.
- No warnings, inline lint suppressions, abandoned compatibility shims, or undocumented capability
  fallbacks remain.

#### Decisions and Course Corrections

- _Fill during execution._

## Risks and Mitigations

| Risk                                                             | Consequence                                                  | Mitigation                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACE accepts arbitrary velocity                                   | Precise mode accidentally becomes a movement exploit         | Derive every candidate from current authoritative capability; never accept renderer velocity; test envelope invariants independently of server acceptance  |
| Preview solver cost scales with pointer rate and candidate count | Network/fixed-tick starvation and visible input lag          | Replaceable latest aim, explicit cadence/work budget, early analytic rejection, measurement at Resteer A, off-authority execution only if proven necessary |
| Analytic arc disagrees with collision response                   | Blue target misses, clips a ceiling, or lands early          | Analytic math proposes only; ordinary cloned solver authorizes first landing                                                                               |
| Preview becomes stale before click                               | Launch uses obsolete contact, position, capability, or scene | Opaque generation-bound identity plus fresh simulation-boundary re-resolution                                                                              |
| Rendered surface and collision surface differ                    | Marker appears offset or on invisible collision              | Marker uses collision hit and explicit unproven state; verify known visual/collision divergences and report them rather than substituting render depth     |
| EnvCell/portal ray crosses unrelated geometry                    | Target selects through walls or wrong room                   | Start from camera placement, reuse placement traversal, return hit cell/scope, and add sealed-cell/portal fixtures                                         |
| Dynamic object crosses the arc after preview                     | Legal preview is obstructed at launch time                   | Revalidate on commit and allow safe rejection; moving-surface targeting stays out of scope                                                                 |
| Continuous directional vector exceeds retail input semantics     | Server-valid but capability-dishonest launch                 | Bound signed components and combined speed from retail movement facts; retain independent envelope tests; user reviews D5 before execution                 |
| World marker becomes a generic renderer subsystem                | Large unrelated API and maintenance surface                  | One minimal marker contract with one consumer and no registry/debug/editor features                                                                        |
| Shift+Space conflicts with walk gait and current Space charge    | Ghost charge/release edges or stuck held input               | One explicit chord/input state machine with paired press/release ownership and blur/lifecycle teardown tests                                               |
| Collision coverage ends before a high/long jump                  | False clear ray or partially simulated arc                   | Authority-derived maximum aim range, explicit required-coverage policy, neutral unproven state                                                             |
| Async aim responses flicker or mismatch the clicked target       | Unstable colors and a jump different from the visible marker | Retain one complete atomic marker, coalesce to one in-flight plus one latest sample, discard stale responses, and commit only the displayed evaluation     |

## Definition of Done

- [ ] `Shift+Space` enters the agreed precise-jump mode without starting ordinary charge.
- [ ] While targeting, left-click and a fresh Space press share one blue-target commit path; invalid
      targets are inert and preserve the mode.
- [ ] Cursor aim resolves a collision-backed static target from the coherent client camera.
- [ ] Blue means a bounded speculative run of the ordinary body solver first lands within the
      body-derived target tolerance.
- [ ] Red is reserved for proven unreachable/unwalkable outcomes; pending/missing authority is
      visually distinct.
- [ ] Capability includes current Jump skill, Run capability, burden, exhaustion, body support, and
      retail vertical/horizontal limits.
- [ ] Activating the latest blue evaluation by click or Space triggers fresh host-side re-resolution
      and exactly one local/wire jump transaction.
- [ ] Renderer cannot submit a target position, skill, extent, or velocity as authority.
- [ ] Static outdoor and EnvCell targets, intervening collisions, ceilings, slopes, stale previews,
      and missing collision coverage have automated tests.
- [ ] Marker is stable, depth-tested, portal-correct, and absent outside precise mode.
- [ ] Pointer movement retains one complete atomic marker until its newest replacement is ready;
      ordinary in-flight evaluation never flashes the marker back to pending.
- [ ] Ordinary jump/input/camera behavior regresses neither in focused tests nor live probe.
- [ ] Prediction cost is measured and bounded under representative scenes.
- [ ] Full Rust/TypeScript/Svelte formatting, lint, checks, tests, browser harness, and live ACE probe
      pass.
- [ ] Architecture docs and this plan record final ownership decisions, course corrections, and any
      consciously retained debt.

## Resolved User Decisions

1. **Activation and lifetime:** `Shift+Space` latches precise mode. Once active, either left-click or
   a fresh Space press attempts the latest blue evaluation. The mode exits only after confirmed jump
   commit or cancellation; a rejected commit returns to targeting.
2. **Invalid targets:** activating a red, pending, unproven, or absent target does nothing and leaves
   precise mode active. No host commit command is sent.

## Remaining Open Questions for User Review

1. **Explicit cancellation gesture — recommended:** `Escape` or right-click cancels. Focus,
   visibility, lifecycle, and portal loss remain mandatory safety cancellation even though they are
   not user gestures. `Shift+Space` is not a toggle once targeting is active: its Space press follows
   the normal activation rule.
2. **Movement while targeting — recommended:** entering precise mode publishes idle planar drive and
   reserves left-click for commit; camera orbit is suspended, wheel zoom remains available. Exiting
   recomputes drive from keys still physically held rather than inventing releases.
3. **Directional capability — recommended:** allow continuous local direction within the proven
   signed forward/back/strafe component limits and combined run cap (D5), without auto-turning the
   character before launch. The alternative is forward-only auto-facing, which adds a heading
   synchronization round trip and more commit races.
4. **Unproven visual — recommended:** use neutral gray before the first complete evaluation or after
   hard invalidation, and amber for missing collision/authority. Ordinary replacement evaluation
   retains the last complete marker instead of flashing gray. Red should mean the client actually
   proved “cannot land there,” not “doesn't know.”
5. **First-slice target classes — recommended:** terrain and static environment collision only.
   Dynamic targets should wait for a separate time-dependent interception design.
