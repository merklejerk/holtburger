# Holtburger 3D Precise Jump Plan

Status: **Active — Phase 16 implemented and live-proven; expanded mixed-cell/performance evidence remains open.**

Created: 2026-08-30
Branch: `holtburger-3d-precise-jump`
Origin: Client-mode precise-jump targeting vision; shortcut revised to `Shift+J`

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
  exists between samples. Sampled collision exhaustion therefore cannot honestly produce red under
  the current contract. Per the execution stop rule, Phases 4+ did not begin pending user direction
  on red semantics/search completeness.
- 2026-08-30 — Validation surprise after adding the diagnostic harness: core clippy, harness clippy,
  formatting, and all 11 focused predictor tests pass. The full core suite now fails only
  `vector_demand_promotes_and_demotes_with_no_content_reload` because its asynchronous preparation
  call count is 2 instead of 1. The test passes three consecutive isolated runs but fails in the
  full suite even with one test thread, proving suite-context/timing dependence rather than a
  precise-jump assertion failure. It remains unmodified and needs a separate reliability
  investigation before the final gate.
- 2026-08-30 — Resteer A resumed by user decision. The first slice uses a fixed six-candidate
  adaptive search: exact minimum, maximum, midpoint, then repeated widest-interval subdivision with
  lower-extent tie preference. Any successful candidate proves blue; exhausting the search is
  neutral/unproven and retains the last sampled failure for diagnostics. Red remains limited to
  analytic impossibility and a non-walkable selected surface.
- 2026-08-30 — Resteer A complete. The adaptive cutover added a low-wall fixture proving that a
  blocked minimum arc can discover a higher success and that the six-candidate budget returns the
  lowest successful sampled extent. Updated optimized measurements are 0.838 ms for the 52-tick
  outdoor minimum-arc success and 1.259 ms for the six-candidate/20-tick EnvCell exhaustion over
  10,000 evaluations. Selected policy: at most one evaluation submitted per 30 Hz authority epoch,
  one off-authority worker, one in-flight plus one latest replacement, six candidates, and 160 ticks
  per candidate. The last complete marker remains visible while replacement work is pending.
- 2026-08-30 — Phases 4-7 complete. Core owns bounded replaceable evaluation and fresh commit
  transactions; the Electron boundary remains strict and authority-minimal; app-local input owns
  the latched mode and inert invalid activation; the renderer owns one fixed ring pass.
  Local Rust, host, TypeScript, Svelte, formatting, lint, and clippy gates pass. SwiftShader flat
  and portal marker schedules and a real-GPU flat schedule on an AMD Radeon RX 7900 XT pass.
- 2026-08-30 — Phase 8 complete against local ACE at the default address. The opt-in probe exposed
  and resolved two integration defects: its own outdoor-cell selector was incorrectly submitted as
  an EnvCell, and a one-shot launch did not wake an otherwise settled local physics body. The final
  run authenticated, entered world, proved the standing target reachable, committed exactly once,
  observed grounded-airborne-grounded contact, and measured 0.00500035 m predicted-to-observed
  first-landing error. The adaptive search generated six candidates but evaluated one candidate for
  19 solver ticks; the existing ordinary charged jump also committed in the same run.
- 2026-08-30 — Post-completion latency investigation found that Phase 6 did not implement Resteer
  A's selected aim cadence. `ClientWorldView` forwards every raw `pointermove`, the session advances
  its latest sequence before a sample is submitted, and both the frontend and core discard a
  completion unless it still equals the absolute latest sequence/generation. Sustained pointer
  input can therefore invalidate every completed solve and delay marker movement until input goes
  quiet. This is request starvation, not evidence that inverse launch math is intrinsically slow:
  the recorded optimized representative solves remain below 1.3 ms and core polls completions on
  its 30 ms authority tick. Phase 10 scopes the clean app-local scheduling cutover and runtime
  latency proof; no solver or host contract change is currently justified.
- 2026-08-30 — Phase 10 complete. The app-local session now coalesces raw rays behind one submitted
  evaluation at a named 30 Hz cadence, accepts that completion while newer input is merely pending,
  and allocates correlation sequences only when work is actually submitted. A release Electron
  sweep dispatched 120 pointer samples over 832.8 ms, published 29 evaluations during/after the
  sweep, observed a 64 ms maximum evaluation gap, and published the first post-stop result after
  26.5 ms with no WebGL context loss. The live outdoor commit probe still committed one reachable
  precise jump and the ordinary charged jump; predicted-to-observed first support differed by
  0.0809 m. Core now terminally publishes neutral authority-change completions and fences
  replacement preview work when committing the displayed evaluation.
- 2026-08-30 — Phase 11 scoped after user review. Precise jump will replace its heading-relative
  forward/backward/sidestep component envelope with one heading-independent planar-speed disk.
  The bound remains the actor's authoritative maximum run speed rather than a literal constant;
  heading remains only the coordinate transform between a selected world trajectory and the
  body-local `JumpPack` vector. This is a deliberate precise-jump policy rather than a claim that
  retail keyboard input can produce full-speed sideways or backward launches. Search completeness
  and gray-target reduction remain a separate design decision after this subtractive cutover.
- 2026-08-30 — Phase 11 complete. `PreciseJumpCapabilityEnvelope` now contains only the
  actor-resolved maximum planar speed and body-derived landing tolerance; precise jump no longer
  imports or retains forward, backward, or lateral component limits. Minimum planar time is planar
  distance divided by that magnitude, and heading is used only once to convert the selected world
  velocity into body-local wire velocity. The precise-only directional helpers disappeared entirely
  from `character_axes`; ordinary jump's independent retail differential matrix remains unchanged.
  Rotational-invariance tests prove equal-distance forward, backward, lateral, diagonal, and
  rotated-heading targets produce the same five-candidate extent sequence, and explicit tests prove
  actor Run-rate scaling, magnitude rejection, invalid-capability rejection, and local/world
  transform agreement.
- 2026-08-30 — Phase 11 live verification kept the established zero-offset transaction green:
  preview generated six candidates, accepted the first after 19 solver ticks, committed through
  local physics and ACE, traversed airborne back to grounded, and differed from predicted first
  support by 0.0825 m with no discontinuities. A new harness-only body-local target offset sampled
  the fixture honestly. Its 4 m forward point was analytically admitted but exhausted all six
  collision candidates as unproven; its 3 m right point selected a non-walkable surface with normal
  Z 0.529 and was red before candidate generation. A repeated teleport also reproduced the probe's
  existing destination-placement timeout. These are fixture/search evidence, not isotropic-cap
  failures, so no gray-search or terrain-specific workaround entered Phase 11.
- 2026-08-31 — Phase 12 complete. A high-skill flat census exposed that valid continuous arcs
  struck the selected floor before retail's 5% elasticity briefly separated the actor from support;
  prediction had incorrectly waited for the later grounded state. World physics now projects its
  already-derived static-contact normal through `PhysicalBodyTickResult`, and precise jump accepts
  the first descending walkable strike only when its support-sphere contact and committed cell match
  the selected target. An exhaustive half-meter census is reachable from 0.5m through 50.5m; the
  original 15m, 20m, 30m, and 50m gray fixtures now succeed on the first minimum-extent candidate,
  while 51m remains outside the envelope. No tolerance, candidate, tick, or collision-query budget
  increased. Validation: 25 focused precise-jump tests, all 318 core tests, all 536 world tests, all
  250 host tests, Rust formatting, and world/core/host clippy with warnings denied.
- 2026-08-31 — Phase 13 scoped, then revised after ownership review. A reachable evaluation will
  carry a compact semantic ballistic curve plus its authoritative placement-time intervals, not
  fixed-tick points. Core owns the validated motion and cell transitions; the renderer owns curve
  tessellation, dash density, and line geometry. Implementation begins by proving that successful
  candidates have no pre-landing collision response that would invalidate a ballistic curve and by
  measuring placement-transition counts. There is no point-per-tick fallback.
- 2026-08-31 — Phase 13 implementation landed as a vertical slice. Core now attaches one compact
  analytic launch curve and the successful collision solve's committed-cell intervals to only the
  reachable result. Host projection exposes that composite as an outward-only discriminated wire
  shape; commit still accepts only the opaque evaluation identity and freshly resolves authority.
  The frontend publishes marker plus trajectory through one imperative runtime snapshot, outside
  Svelte reactivity. A dedicated WebGL2 pass eagerly compiles flat and portal programs, tessellates
  by renderer-owned curve error, uploads only on evaluation revision changes, expands portable
  camera-facing triangle ribbons, and keeps world-distance dashes continuous across scope groups.
  The guessed 256-interval decoder cap was removed: no traversal-derived limit supports it, while
  the existing 16 MiB protocol frame limit remains the honest hard wire bound. The observed live
  ACE reachable event was 547 bytes with one interval; commit succeeded and observed first landing
  was 0.189 m from prediction. SwiftShader and RX 7900 XT flat captures rendered the line with no
  browser/WebGL diagnostics. An archive-backed `0xec0e010b` EnvCell capture exercised the production
  portal program across 10 selected scopes, 148 crossings, and 16 propagation draws with no browser
  diagnostics. Full verification passed 318 core tests, 250 host tests, 1,706
  frontend tests, TypeScript/Svelte checks, ESLint, dead-code analysis, Rust formatting, and
  core/host clippy with warnings denied. A real successful multi-interval jump capture and sustained
  replacement performance matrix remain evidence work, not hidden implementation fallbacks.
- 2026-08-31 — `Shift+Space` was restored to the ordinary charged-jump controller, where Shift
  snapshots Walk gait into both
  charge edges. No new launch multiplier was added: retail jumps package the motion interpreter's
  current local physics velocity (`acclient.c:390559-390604`), and Walk versus Run is already
  resolved by `CMotionInterp::get_state_velocity` (`acclient.c:329860-329903`). Holtburger's shared
  resolver already differentiates actor-authored walk speed from run speed, so the shortcut cutover
  exposes the existing retail-compatible path rather than duplicating physics policy in the app.
- 2026-08-31 — Phase 14 scoped after live GNOME testing proved that IBus consumes the prior
  modifier-plus-Space gestures before Electron receives them. Precise-mode entry
  moves to `Shift+J`. The ordinary charge popup also gains a `Precise` action that transitions
  through the same arbiter edge: it resets ordinary input ownership, cancels the active charge, and
  suppresses the physically held Space release so the mode cannot launch accidentally.
- 2026-08-31 — Phase 14 implementation complete. Keyboard and popup entry now converge on the
  arbiter's idempotent `enterPrecise` transition; the Ctrl-specific key-edge contract was deleted.
  Focused arbitration and ordinary Walk-jump coverage passed with the complete 1,709-test frontend
  suite, Svelte/TypeScript checks, ESLint, and dead-code analysis. A real-browser charged-HUD capture
  verified the popup layout. Two live probe attempts reached `in-world` but never received the
  initial destination camera frame, including one 90-second window, so they failed before shortcut
  dispatch and are not counted as live `Shift+J` evidence.
- 2026-08-31 — Phase 15 scoped after UI review. The horizontal charge popup and embedded persistent
  rejection paragraph will be replaced by a compact vertical charge meter, a precise-jump icon
  action, and one app-local ephemeral toast overlay. The notification census found no reusable
  toast owner: fatal client/presentation failures, chat form errors, and Explorer panel statuses
  have distinct lifetimes. The only mechanism to promote is the jump rejection paragraph, so the
  toast center remains a bounded latest-wins cold-UI owner rather than a general event bus or queue.
- 2026-08-31 — Phase 15 implementation complete. `ClientToastCenter` owns one injected 2.5-second
  timer and a monotonic toast identity; replacement cancels the prior timer and obsolete callbacks
  cannot clear the newer notice. The client publishes precise-mode confirmation as status and jump
  rejection as warning, while fatal and panel-local statuses remain in their existing owners. The
  charge popup is now a 38-pixel vertical control with bottom-up fill and a labeled crosshair icon
  action. Real-browser 1280×720 captures verified both charging and precise-enabled states. The full
  frontend suite passed 1,712 tests with zero Svelte/TypeScript warnings, plus ESLint, dead-code,
  formatting, and diff checks.
- 2026-08-31 — Phase 16 implementation complete. World now seals one immutable entity-target body
  population and broad-phase index per evaluation; combined picking chooses the nearest environment
  or eligible entity surface, while a single speculative mover reuses ordinary directional dynamic
  response without advancing peers. Only settled, solid, non-missile `Other` entities are selectable;
  all retained solid bodies, including creatures, still obstruct arcs. Entity collision proof and
  the server instance sequence remain core authority and never cross the renderer contract.
- 2026-08-31 — Phase 16 live release proof selected DA55 Sliding Door `0x7DA55017` through its
  Physics BSP, evaluated six candidates/393 ordinary ticks, published reachable, and committed once.
  The observed first grounded sample was 0.256 m from the selected surface and the closest 50 ms
  sample was 0.116 m away, with no presentation discontinuity. The environment standing-target
  baseline with 39 resident entities published in 27.83 ms for one candidate/18 ticks. A repeatable
  51-target microbenchmark and the remaining expanded fixture matrix stay open evidence work.

## Context and Boundaries

### Goal

Add a client-mode precise-jump targeting gesture that lets the player point at a collision-backed
environment or stable solid-entity surface, see whether their current authoritative body can first land there with a
capability-bounded AC jump, and commit the exact predicted launch by clicking a reachable target.

### In Scope

- Enter a client-local precise-jump targeting mode with `Shift+J` without beginning the ordinary
  charged-jump lifecycle or displaying its power bar.
- Convert the current cursor and the latest coherent client camera into a bounded world-space aim
  ray.
- Resolve the nearest collision-backed eligible surface under that ray, including outdoor terrain,
  static setup collision, EnvCell geometry, and settled solid non-creature entities.
- Classify the surface and requested landing through current host-owned player position, body
  definition, contact state, Jump skill, Run skill/rate, burden, stamina exhaustion state, motion
  table speeds, gravity, collision residency, and walkability.
- Search the legal jump extent and heading-independent planar-speed envelope for a launch whose **first
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

- Targeting players, creatures, active/suspended objects, elevators, or other moving collision.
  Settled solid non-creature entities are Phase 16 landing surfaces; all solid dynamic bodies remain
  predictive obstructions and may invalidate a launch at commit time.
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

### D5. Search a Capability-Bounded Isotropic Planar Envelope

Precise jump is a new control policy, so it is not restricted to the finite set of keyboard-axis
combinations or their heading-relative forward/backward/sidestep component limits. It may select
any continuous planar direction whose magnitude does not exceed the actor's authoritative maximum
run speed. That value is resolved from current motion-table and Run-rate facts—normally retail's
`4 * run_rate` value—and is never a frontend-supplied or literal `4.0` fallback. Vertical velocity
remains exactly extent-derived.

Heading does not affect how much planar capability is available. It remains necessary only to
convert the chosen world-space launch into the body-local XYZ vector carried by `JumpPack`; precise
jump does not turn the character before launch. ACE and the inspected GDLE revision apply the
client-provided local velocity without validating that its planar components came from a current
retail movement-axis combination. The isotropic disk is therefore a deliberate capability-bounded
precise-jump policy, not a statement that retail keyboard control naturally produces full-speed
sideways or backward jumps.

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

### D10. A Trajectory Visualizes the Accepted Solve; It Does Not Become Authority

Only a reachable evaluation has one canonical accepted curve, so the first trajectory is blue-only.
Red and unproven evaluations retain the target ring without inventing a representative failed arc.
The predictor projects the selected launch into a compact immutable curve and attaches the
authoritative time intervals during which it belongs to each normalized anchor/cell placement. It
does not export fixed-tick samples. The host performs no resampling, and the commit transaction
continues to carry only the opaque evaluation identity and freshly re-solves at the simulation
boundary.

The trajectory and marker are one atomic presentation snapshot. While a replacement evaluation is
pending, both remain from the last complete evaluation; cancellation, hard invalidation, or leaving
precise mode clears both. Each placement interval names its normalized outdoor anchor, committed
cell, and curve-time bounds so the frontend can resolve the same exterior/portal render scopes as
world geometry. A dedicated trajectory pass owns tessellation, line geometry, and dash presentation;
the static target-ring pass does not become a generic polyline renderer.

Read-only curve coefficients crossing the renderer boundary are presentation evidence, not an
authority leak: renderer input still cannot be submitted as a launch, and commit never reads it.
Concealing those coefficients behind a point array would increase coupling without improving the
authority boundary.

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
8. Physics describes the accepted motion; presentation decides how densely to draw it. Neither
   layer exports its internal resolution to the other.

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
- `PreciseJumpTrajectory`
  - Presentation evidence required by a reachable result and absent from every other result. It
    contains one compact time-parameterized ballistic curve plus ordered anchor/cell placement
    intervals. It contains no fixed-tick samples, skills, capability envelope, or commit authority.
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
- One independent renderer trajectory input containing a time-parameterized curve and already-
  resolved render-scope intervals. The renderer selects its own geometric approximation when an
  evaluation is accepted; no frame-hot Svelte state participates.

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
- Candidate ordering is deterministic: exact lowest extent first, maximum second, then dyadic
  subdivision of the widest unsampled extent interval.
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
  caller-supplied candidate budget adds maximum extent, then adaptively subdivides the widest
  remaining extent interval. Resteer A selected six candidates for the first slice.
- Staleness is not an analytic input property and therefore was not added to this solver. Phase 4's
  authority snapshot/commit transaction owns stale-generation rejection as already planned.
- No stamina-cost field was added. Exhaustion remains represented by the authority-resolved
  full-extent jump height, and overburden/readiness remain explicit pre-prediction rejections.
- No Phase 2 implementation debt was accepted. Candidate ordering and the first-slice budget were
  finalized at Resteer A after real-content measurement and user review.

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
- No Phase 3 implementation debt was accepted. Tick budget and evaluation cadence remain Resteer A
  measurement decisions.

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
  Cadence and the per-candidate tick limit remain to be selected.
- Resolved the continuous-envelope blocker with asymmetric certainty and fixed-budget adaptive
  discovery. The search evaluates exact minimum and maximum extent before subdividing the widest
  remaining interval. It stops immediately only for an exact-minimum success; otherwise it spends
  the budget and retains the lowest successful sampled extent. Six exhausted candidates produce
  `CandidateSearchExhausted` as neutral/unproven, never red. The last sampled failure remains
  diagnostic context rather than being promoted into an impossibility claim.
- When the exact minimum succeeds, stop immediately because no lower legal launch exists. After a
  higher success, spend the remaining fixed budget and return the lowest successful sampled extent;
  this avoids choosing the maximum arc merely because it brackets the search early.
- Cap aim submission at the existing 30 Hz authority cadence. Faster pointer samples cannot observe
  newer authoritative body/collision state and only create replaceable work. Prediction runs on one
  blocking worker so the six-by-160 hard ceiling cannot delay network or fixed-tick authority.
- Keep the measured six-candidate and 160-tick limits explicit in the Phase 4 coordinator. Timeout or
  complete search exhaustion is neutral, so bounding work never weakens blue or invents red.
- Marker trailing and boundary-chatter measurement requires the Phase 6/7 aim scheduler and marker;
  it moves to that browser-harness acceptance pass rather than manufacturing a UI timing conclusion
  from the headless solver.
- The Phase 4-8 dry-run found no further contract blocker. Core owns immutable authority snapshots,
  off-thread prediction, opaque commit identity, and fresh commit re-resolution; the client host
  projects typed commands/events; app-local code owns input arbitration, aim cadence, and marker
  retention. Existing `Arc<CollisionScene>`, cloneable `SpatialScene`, collision-worker completion
  pattern, and imperative camera snapshots support those boundaries without a new shared service.

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

- [x] Keep hover aim replaceable; never queue every pointer sample.
- [x] Keep commit non-coalescible and monotonically ordered.
- [x] Compute each stale/fresh decision once and put it in the outcome contract.

#### Decisions and Course Corrections

- Added one core-owned blocking preview worker with exactly one replaceable latest sample. Solver
  completions carry the captured authority composite and are discarded unless world, player,
  camera, collision, body, capability, contact, heading, and movement-tolerance facts remain fresh.
- Kept launch velocity private to core. Renderer-visible evaluations contain only an opaque identity,
  target presentation facts, semantic status, and bounded-work diagnostics.
- Commit is queued as an ordered edge and freshly re-solved on the next fixed simulation tick. The
  winning candidate is adapted into the existing `ResolvedJump`/`GroundedLaunch` transaction, so
  local physics and the existing Jump packet continue to consume one computed launch.
- A later hover sample is ignored while commit is pending, and a second commit is explicitly
  rejected rather than replacing the first. Cancellation clears pending work and retained authority.
- Camera replacement/reset, world-generation changes, forced reposition, portal/reset lifecycle,
  collision revision, capability/body changes, and movement beyond the support-sphere tolerance all
  retire commit authority. Preview remains read-only and never mutates the canonical scene.
- Validation: `cargo check -p holtburger-core`, `cargo clippy -p holtburger-core --all-targets --
-D warnings`, and the full 315-test core library suite pass.

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

- Confirmed the live desktop stack is Electron plus the Rust sidecar (not Tauri) and kept all new
  inventory entries client-only. The private `start_client` credential path remains unchanged and
  Explorer inventories gain no precise-jump capability.
- Added strict app-local Rust request DTOs for aim/commit/cancel instead of deriving serde on core
  authority types. Aim carries only camera identity, an anchored finite ray, and correlation
  sequence; commit returns only the opaque evaluation identity.
- Projected evaluations to status, anchored target placement, and bounded-work diagnostics. Launch
  velocity, extent, skills, burden, body support, and collision proof remain inside core.
- Added strict Zod decoders and branded retained landblock-local target positions at the renderer
  boundary. `ClientLifecycleSession` now owns the three commands and two correlated event streams.
- Validation: all 250 host library tests, 18 focused renderer contract/session/inventory tests,
  full app type-check, and host clippy with warnings denied pass.

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
- `Shift+J` emits no ordinary jump lifecycle edge; `Shift+Space` emits the ordinary Walk-gait
  charged-jump lifecycle.
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

- Kept browser gesture policy in one `ClientInputArbiter` composed over the ordinary character
  controller. Entering targeting publishes an ordinary ownership reset, swallows the initiating
  Space release, and restores only physically held non-Space keys after a normal exit. Focus and
  lifecycle loss use a hard reset that restores nothing.
- Added one session-lifetime precise-jump owner with monotonic aim/action sequences, one in-flight
  aim plus one replaceable latest request, camera/sequence stale-result rejection, and one pending
  commit gate. Red, neutral, and absent evaluations leave targeting active and issue no commit.
- The aim ray is sampled imperatively from the exact `PrimaryCameraView` last handed to the runtime;
  CSS pointer coordinates are mapped through that view's drawing aspect and the active camera
  identity. Pointer movement retains the previous complete evaluation until its replacement lands.
- Lifecycle, portal, visibility, focus, and exit edges hard-cancel before UI state reduction so held
  translation cannot be replayed into a retiring world generation.
- Validation: full app type-check, TypeScript lint, seven focused arbitration/session tests, and all
  14 presentation-session tests pass.

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

- Added one renderer-owned static ring pass: no marker registry, retained scene node, or per-update
  GPU allocation. A 784-byte static vertex buffer avoids a context-losing Electron ANGLE compiler
  path, and its flat and portal programs compile with the renderer's other fixed programs.
- Client presentation performs the only semantic mapping: blue reachable, red proven unreachable,
  neutral otherwise. It converts the retained collision point/normal from AC axes, derives the
  exact outdoor/EnvCell render scope, and hands the renderer only position, direction, RGBA, radius,
  and scope.
- The flat path uses ordinary scene depth. The portal path reuses the existing deferred scope
  envelope and refuses to draw when the returned scope is not selected. A bounded distance scale
  keeps the world-space ring legible without making it a screen-space overlay.
- Added an opt-in `--world-marker` browser-harness fixture. SwiftShader flat and portal runs, plus a
  real Vulkan run on the AMD Radeon RX 7900 XT, completed without browser errors. The first portal
  run caught a GLSL uniform/block-field name collision; the renamed private uniform passed on the
  rerun. A focused presentation test proves anchor conversion and exact EnvCell scope projection.

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

- Extended the existing non-interactive live client probe behind
  `HOLTBURGER_PROBE_PRECISE_JUMP=1`. It aims a bounded downward ray at the player's current static
  support, waits for a correlated blue evaluation, commits its opaque identity, records the
  trajectory/contact states, and reports predicted-to-observed landing error alongside the ordinary
  jump evidence.
- The probe now waits for the local body to publish grounded collision readiness and distinguishes
  outdoor cells `0x0000-0x003f` from EnvCells `0x0100+`; this avoids manufacturing a false
  `UnknownMotionCell` failure at startup.
- The first live commit found that settled-body scheduling omitted fresh launch work. Core now wakes
  the local dynamic body through the existing scene-owned wake seam before the collection scheduler
  snapshots active movers. The final run committed, traversed grounded-airborne-grounded, and landed
  0.00500035 m from the predicted first support.
- The final live evaluation generated six legal candidate extents, evaluated only the first viable
  candidate, and spent 19 solver ticks. Candidate extent and velocity intentionally remain private
  core authority rather than being added to the renderer/probe wire contract; their equality with
  committed launch facts is covered at the core transaction boundary.

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

- Local final gates pass: 536 world tests, 315 core tests, 250 host tests, 1,701 TypeScript tests,
  app/Svelte/Node type-checks, TypeScript lint, and combined Rust clippy with warnings denied.
- Browser marker runs pass in flat, portal, and real-GPU flat schedules. The only unrun final gate is
  now closed: one credentialed live run committed both precise and ordinary jumps, with no drive,
  camera, lifecycle, or presentation discontinuity error.

### Phase 10: Bounded Aim Cadence and Non-Starving Publication

#### Goal

Restore responsive marker tracking by separating raw cursor sampling from submitted evaluation
identity. A newer unsent cursor sample must not retroactively make useful completed work
unpublishable.

#### Ground Truth and Ownership

- `ClientWorldView.svelte` is allowed to observe raw pointer events, but it must only hand the latest
  ray to an imperative app-local owner; it does not own IPC cadence or evaluation correlation.
- `ClientPreciseJumpSession` owns aim scheduling, submitted-sequence correlation, retained marker
  identity, and commit/display agreement. These cursor-rate and evaluation payloads remain plain
  class fields under the app's `$state` hygiene rule.
- `ClientLifecycleSession` and the Electron/core command contracts remain transport boundaries. An
  aim command already enqueues without waiting for prediction, so transport redesign is out of
  scope.
- `PreciseJumpRuntime` remains the authority-side overload guard: one blocking worker plus one
  replaceable latest sample. Phase 10 changes it only if new timing evidence proves an independent
  core defect.

#### Deliverables

- Replace the current IPC-completion gate with one evaluation-aware scheduler in
  `client-precise-jump-session.ts`:
  - raw `aim()` calls replace one unsent pending ray without allocating/submitting pointer history;
  - submit at most one sample per named 30 Hz cadence;
  - retain at most one submitted evaluation awaiting a terminal evaluation event and one latest
    pending ray;
  - accept a correlated completion even when a newer ray is pending but not submitted;
  - reject duplicate, foreign-camera, cancelled-session, and older-than-displayed completions;
  - after completion, schedule the newest pending ray at the next eligible cadence boundary.
- Keep the last complete marker visible while a newer ray is pending or evaluated. Marker placement,
  status, and opaque commit identity continue to replace atomically.
- Make activation commit exactly the displayed evaluation. Pending cursor position never changes
  what click or Space will commit.
- Inject the narrow monotonic clock/scheduling dependency needed for deterministic session tests;
  do not introduce Svelte timers, reactive aim payloads, a general scheduler abstraction, or
  production performance telemetry.
- Extend the focused UI/live diagnostic to timestamp aim submission and correlated evaluation
  publication, exercise a sustained rapid sweep followed by a stop, and report submission count,
  accepted evaluation count, and post-stop marker latency. Diagnostic timestamps stay in harness
  output rather than operational contracts.
- Prove at the focused core/session boundary that every accepted aim for the current camera reaches
  either a terminal evaluation event or an existing lifecycle/camera cancellation edge. If that
  invariant is false, add an explicit typed rejection event; do not hide the gap with an arbitrary
  frontend timeout or retry loop.

#### Acceptance Criteria

- A deterministic 1,000 Hz synthetic pointer stream for one second submits no more than 31 aim
  commands and publishes correlated evaluations throughout the stream; it cannot require pointer
  silence before the first marker update.
- If several pointer samples arrive during one evaluation, only the latest pending ray is submitted
  next and no pointer-history backlog is replayed.
- A completion for the sole submitted sequence is publishable while a newer unsent ray exists. A
  completion older than an already displayed evaluation, from another camera generation, or after
  cancellation is inert.
- Pending work never clears or recolors the retained marker, and click/Space commits the exact
  evaluation identity currently displayed.
- Blur, visibility loss, lifecycle loss, portal transition, commit-pending, and destroy cancel both
  the cadence timer and all pending/submitted aim ownership without a late resubmission.
- A valid submitted aim cannot leave the evaluation-aware scheduler permanently occupied. Invalid
  authority is completed by a typed rejection or by the already-owning lifecycle cancellation.
- The release-like live sweep produces repeated marker evaluations during motion and records
  post-stop latency without the observed one-to-two-second starvation. Use the trace to select and
  record a defensible latency bound; do not tune a timer from a single desktop sample.
- Ordinary jump input, camera gestures, marker portal scope, and core preview/commit transaction
  tests remain unchanged and passing.

#### Task Checklist

- [x] Add fake-clock session tests that reproduce the current starvation before changing production
      scheduling.
- [x] Cut over `ClientPreciseJumpSession` to pending-ray/submitted-evaluation ownership at 30 Hz.
- [x] Delete `#aimInFlight` and any exact-latest-pointer rejection vocabulary made obsolete by the
      cutover; do not retain parallel scheduling paths.
- [x] Add cancellation, camera replacement, commit/display agreement, and timer teardown tests.
- [x] Add sustained-sweep and stop-latency evidence to the existing precise-jump UI probe or a
      smaller focused browser harness.
- [x] Run focused TypeScript tests, full app checks/lint/format, browser marker scenarios, and the
      credentialed live precise-jump probe.
- [x] Resteer only if release-like evidence attributes material latency to core solving, scene
      cloning, collision traversal, or the 30 ms completion poll after frontend starvation is gone.

#### Explicitly Out of Scope

- Changing the six-candidate adaptive search, 160-tick hard ceiling, blue/red semantics, collision
  coverage policy, marker shader, or jump authority contract.
- Parallel solver workers, speculative cancellation inside `spawn_blocking`, renderer-side
  prediction, or accepting cursor/target/velocity authority from the frontend.
- Hiding latency by moving the marker speculatively before an authoritative evaluation completes.

#### Decisions and Course Corrections

- Planned clean cutover: “latest wins” applies independently to the one unsent cursor sample and to
  monotonically completed submitted evaluations. An unsent sample is not an evaluation generation
  and cannot invalidate the marker.
- The 30 Hz limit is an app-local input/work cadence, not Svelte state and not a claim that simulated
  solver ticks consume wall-clock time. Core's 30 ms poll remains the publication boundary.
- Current evidence does not justify core changes: recorded optimized representative predictions are
  0.838-1.259 ms. Phase 10 begins by reproducing starvation with a deterministic fake transport,
  then verifies the cutover in a release-like live sweep.
- The current-camera terminal invariant was false for authority changes that occurred after an aim
  was accepted. Core now publishes that still-latest sequence as neutral/unproven with no target or
  retained commit authority. World/camera invalidation continues to abort work and reaches the app
  through its existing cancellation edges; no timeout or retry loop was added.
- Retaining the visible marker while replacement work runs exposed a commit race: accepting the
  displayed evaluation must prevent a newer completion from replacing its core-retained authority
  before the simulation tick consumes it. A valid commit now fences and aborts replacement preview
  work while preserving the selected retained evaluation.
- Deterministic 1,000 Hz input tests prove the one-second command count stays at or below 31 while
  evaluations continue publishing. The release Electron sweep produced 29 evaluations from 120
  input samples over 832.8 ms, with a 64 ms largest gap and 26.5 ms post-stop latency. This removes
  the observed seconds-long starvation without speculative marker motion or solver changes.
- Validation: 1,704 TypeScript tests, 250 host tests, focused precise-jump core tests, app/Svelte/Node
  checks, full lint/dead-code/clippy, formatting, the SwiftShader world-marker browser scenario,
  the release Electron sweep, and the credentialed outdoor precise/ordinary jump probe pass. The
  full 316-test core suite again hit its already-recorded unrelated
  `vector_demand_promotes_and_demotes_with_no_content_reload` timing failure; that test passes in
  isolation.

### Phase 11: Heading-Independent Planar Capability

#### Goal

Give precise jump the actor's full resolved planar-speed magnitude in every direction while
deleting heading-relative component policy that the jump wire and supported server families do not
enforce.

#### Ground Truth and Ownership

- Retail `CMotionInterp::get_max_speed` establishes the actor-resolved planar magnitude cap,
  normally `4 * run_rate`; `get_state_velocity` proves ordinary keyboard input applies asymmetric
  forward/backward/sidestep composition before that combined cap.
- Retail `JumpPack` carries body-local XYZ velocity. ACE `HandleActionJump` and the inspected GDLE
  handler apply that supplied local velocity without validating it against the actor's facing or a
  producible keyboard-axis combination. ACE explicitly retains a velocity-magnitude validation
  TODO, so server permissiveness cannot authorize an unbounded launch.
- `SelfMovementCapabilities` remains the authority source for motion-table speed and Run rate.
  Precise jump owns its distinct targeting policy in core; the renderer still supplies only an aim
  ray and never supplies capability, heading, target position, extent, or velocity.
- Heading remains part of launch representation: core converts the selected world trajectory into
  body-local wire velocity and retains the corresponding world velocity for local physics. Removing
  heading from capability admission must not remove or duplicate that coordinate conversion.

#### Deliverables

- Collapse `PreciseJumpCapabilityEnvelope` to the independently consumed facts:
  `maximum_planar_speed` and body-derived landing tolerance. Delete precise-jump
  `maximum_forward_speed`, `maximum_backward_speed`, `maximum_lateral_speed`, their accessors, and
  their imports from `character_axes`.
- Replace heading-relative minimum-time admission with planar distance divided by authoritative
  maximum planar speed. Reject invalid or non-positive capability data explicitly; do not add a
  literal `4.0` fallback.
- Continue deriving each candidate's world planar velocity from target displacement and flight
  duration. Convert that vector once through the current body heading to produce the body-local
  `JumpPack` vector; validate only the planar magnitude against the isotropic envelope.
- Keep vertical extent, Jump skill, burden, exhaustion, support/readiness, gravity, first-landing
  collision simulation, freshness checks, and opaque preview/commit identity unchanged.
- Sweep obsolete directional-envelope vocabulary from code, tests, architecture text, risks, and
  current plan decisions. Historical execution records may retain the terminology describing what
  was implemented at that time.
- Add focused tests proving equal reach and equal maximum speed for forward, backward, lateral, and
  diagonal targets after heading conversion; actor Run-rate changes must scale the disk and no
  candidate may exceed it.
- Extend the live precise-jump probe with representative forward, lateral, and backward static
  targets at comparable displacement when the fixture permits. Record candidate diagnostics and
  predicted-to-observed first-landing error for every committed direction; do not turn missing
  fixture geometry into a permanent runtime test dependency.

#### Acceptance Criteria

- Rotating either the actor heading or target direction while preserving relative displacement
  length and elevation does not change analytic reachability or available maximum planar speed.
- A lateral or backward target that requires more than the old component limit but no more than the
  actor's maximum run speed generates a legal candidate; a target requiring more than the magnitude
  cap remains analytically unreachable.
- Local and world candidate velocities represent the same trajectory under the sampled body
  heading, and preview, committed local physics, and serialized `JumpPack` reuse that one resolved
  candidate without re-deriving velocity.
- Ordinary charged-jump axis composition remains retail-faithful and unchanged. The isotropic policy
  exists only in precise jump and does not weaken general character-motion semantics.
- Focused predictor/runtime tests, full core and host checks, formatting, clippy with warnings
  denied, TypeScript checks, and the credentialed live precise-jump probe pass.

#### Task Checklist

- [x] Replace the directional component envelope with one authoritative planar magnitude cap.
- [x] Simplify minimum planar flight-time calculation and preserve typed local/world conversion.
- [x] Delete obsolete precise-jump directional helpers, fields, accessors, imports, and vocabulary.
- [x] Replace directional-envelope tests with rotational-invariance and magnitude-bound tests.
- [x] Verify ordinary charged-jump behavior remains unchanged with its existing differential matrix.
- [x] Run focused/full static validation and a credentialed multidirectional live probe.
- [x] Record measured behavior, any fixture limitations, and validation results in execution progress.

#### Explicitly Out of Scope

- Auto-facing, changing rendered character heading, mid-air steering, or applying movement after the
  atomic launch.
- Hardcoding a universal 4 m/s cap, trusting arbitrary server-accepted magnitude, or moving
  capability authority into the frontend.
- Increasing the six-candidate extent budget, searching neighboring planar velocities, changing
  landing tolerance, or changing gray/red classification. Those gray-target concerns require a
  separate search-completeness decision after this phase.

#### Decisions and Course Corrections

- Selected policy: precise jump treats total planar speed as the capability and heading only as a
  coordinate basis. The resulting full-speed sideways/backward launch is intentional for this
  non-retail targeting feature.
- Clean cutover: do not retain a directional-envelope mode, compatibility switch, or duplicated
  old/new solver path.
- Validation passes: all 24 focused precise-jump tests, all 10 ordinary retail differential tests,
  the full 317-test core suite, all 250 host tests, all 1,704 TypeScript tests, Svelte/TypeScript
  checks with zero warnings, ESLint, dead-code analysis, Prettier, Rust formatting, and core/host
  clippy with warnings denied. The established credentialed precise-jump commit passes; attempted
  directional samples record the terrain and probe limitations above rather than claiming three
  comparable committed landings.

### Phase 12: Fixed-Tick First-Contact Prediction

#### Goal

Eliminate false-gray first-landing misses caused by ignoring a valid first static strike while
retail elasticity briefly keeps the actor airborne.

#### Evidence

- A flat synthetic Run/Jump 999-equivalent actor has an algebraic 50.6m range, but the current
  predictor becomes intermittently gray after 14.5m and almost entirely gray after 19m.
- The affected evaluations exhaust all six candidates with `FirstLandingMissedTarget`; targets at
  51m correctly remain outside the capability envelope.
- At 15m, 20m, 30m, and 50m, retaining the same extent and vertical impulse while rescaling planar
  velocity to the fixed-tick first-contact time changed every gray result to a first-contact hit
  within 1mm. The uncorrected overshoots were 0.52-1.84m.

#### Task Checklist

- [x] Add a half-meter high-skill flat-terrain census from near range through the envelope edge.
- [x] Project the world solver's accepted static-contact normal through the physical-tick result so
      precise jump can classify the collision fact at the layer that owns it.
- [x] Accept a descending first strike on walkable target contact before restitution bounce, while
      retaining grounded support acquisition for contacts produced by the landing probe.
- [x] Preserve the six-candidate and 160-tick hard ceilings, strict first-contact target predicate,
      isotropic planar cap, and collision-backed blue meaning.
- [x] Sweep obsolete post-bounce-grounding assumptions from precise-jump tests and vocabulary.
- [x] Run focused core tests, full core tests, formatting, and clippy with warnings denied.

#### Acceptance Criteria

- Flat same-height targets through the measured admin envelope are continuously reachable rather
  than alternating blue and gray; the first target outside the envelope remains red.
- Elevated, lowered, obstructed, mixed-cell, and first-landing-miss coverage retains its existing
  semantics.
- The correction does not add an unbounded search, loosen landing tolerance, or increase configured
  prediction work limits.

#### Decisions and Course Corrections

- First-contact locality remains the product rule. This phase classifies the first accepted static
  strike rather than accepting a later or settled position.
- Initial measurement attributed the overshoot to continuous-versus-fixed arrival timing. A
  vertical tick trace showed that the continuous candidate actually strikes the selected floor on
  time, but the actor's 5% retail elasticity separates it from support and the predictor waits for
  a later grounded state. The fix therefore consumes the solver-owned first static-contact normal
  instead of changing valid launch math or searching neighboring velocities.

### Phase 13: Collision-Validated Trajectory Presentation

#### Goal

Render the accepted reachable jump as a stable blue dashed world-space trajectory from the player
to the selected body-reference target whose first contact was accepted within landing tolerance.
Core must describe the accepted motion as a compact semantic
curve with placement-time intervals; the renderer must independently choose the geometry needed to
draw it. The result must remain correct across outdoor/EnvCell transitions, add no authority surface,
and perform no trajectory construction on unchanged render frames.

#### Scope Decisions

- The first version is blue-only. Reachable has one selected successful candidate; red and gray do
  not have a canonical failed candidate and therefore continue to show only the target ring.
- The line depicts the predicted body-reference path to accepted first contact. It is not a promise
  that the body capsule occupies only the line, nor a post-contact settling path.
- The target ring remains the precise landing affordance. The dashed line supplements it and uses
  the same blue semantic color; it does not replace status color or click/Space behavior.
- After this phase, a reachable result contains a trajectory and every other result does not. Keep
  that dependent shape in the result variant rather than an independently optional field.
- Fixed-tick points, pre-tessellated vertices, and renderer-selected sample counts do not cross the
  core/host boundary. There is no point-array compatibility path.
- This phase introduces no new dependency, generic debug-drawing framework, animation trail, or
  setting panel.

#### Evidence and Existing Seams

- `PhysicalBodyTickResult.motion.path` already returns `PlacedMotionPath`: a non-empty accepted path
  with one normalized outdoor anchor, exact leg boundaries, and complete spatial membership at each
  point. It remains ground truth for validating the compact curve and extracting placement changes,
  not a presentation DTO.
- The accepted candidate already owns the launch and duration needed to define a ballistic curve.
  Fixed-tick integration is the collision validator's resolution, not the curve's presentation
  resolution.
- A fixed prediction tick can contain several accepted legs, including placement-only portal splits.
  Those cell transitions are semantic and must survive as time intervals even though ordinary tick
  endpoints do not cross the boundary.
- Existing failure modes suggest that obstruction or sliding response rejects a candidate before it
  can become reachable. That would make every successful pre-contact route one ballistic curve, but
  this must be proved from code and fixtures before the contract is implemented.
- `PreciseJumpPredictedLanding` and `PreciseJumpEvaluation` are currently `Copy`. Owned placement
  intervals make that contract dishonest. Prefer moving one compact winning result over introducing
  reference counting without a measured repeated owner.
- The host projection is deliberately renderer-safe and currently excludes launch and capability
  facts. Read-only curve coefficients may extend that projection without creating an ingress path or
  changing commit authority.
- The existing world-marker pass is static ring geometry with one render scope. A trajectory has
  dynamic geometry and can cross several scopes, so forcing it through that pass would couple two
  unrelated lifecycles.
- WebGL line width is not a portable thickness mechanism. A dedicated triangle-ribbon pass is the
  default direction; its exact CPU- versus shader-expanded construction remains evidence-gated.
- The existing portal deferred-routing seam and scope-grouped particle submission are the local
  precedents for drawing one dynamic input across exterior and EnvCell render domains.

#### Slice A: Successful-Curve Proof and Semantic Contract

- [x] Inspect the candidate-success branches and add focused fixtures proving that a reachable
      candidate has no pre-landing collision impulse, slide, reflection, or other response that
      changes its ballistic curve. Portal/landblock placement changes are allowed because they do
      not alter motion.
- [ ] Compare the candidate-derived curve with the accepted body-reference path at solver tick
      boundaries and at first contact for low-, representative-, and admin-capability jumps across
      flat, elevated, lowered, ceiling, EnvCell, landblock-edge, and mixed outdoor/indoor fixtures.
- [x] If any successful path contains a motion-changing collision, stop at this slice and record the
      counterexample. Choose an explicit piecewise-kinematic product contract or exclude that success
      class; do not fall back to exporting solver ticks.
- [ ] Census only semantic placement changes: distinct anchors, committed cells, transition times,
      and serialized curve/interval bytes. Derive and name a placement-interval bound from the world
      traversal's actual hard limits and representative distribution.
- [x] Define a core-owned `PreciseJumpTrajectory` with a finite time domain ending at the inverse
      candidate's selected body-reference target, position-curve coefficients, and a non-empty ordered partition of that domain into
      anchor/cell placement intervals. The exact coordinate framing is selected at Resteer B.
- [x] Make the type enforce continuous, gap-free, non-overlapping intervals with normalized zero and
      one represented exactly. Do not export complete `SpatialMembership` when
      anchor/cell and interval bounds are the only presentation consumers.
- [x] Build the semantic trajectory only for the selected winner. Failed candidates must not retain
      placement histories or presentation objects.

##### Resteer Checkpoint B

Before changing the host contract or renderer, record the census and select:

1. the exact curve coefficient/coordinate-frame representation;
2. the placement-interval distribution and the existing protocol-frame hard bound, without
   inventing a narrower limit unsupported by traversal;
3. CPU curve sampling plus ribbon construction versus shader curve/segment expansion; and
4. measured renderer-owned curve error, dash period, duty cycle, width policy, and landing-point
   depth bias.

The renderer choices must be demonstrated in the existing flat and portal WebGL harnesses at near
and far camera distances. Constants become named client tuning only after that comparison. If Slice
A cannot prove the single-curve invariant, this checkpoint must resolve that architecture before any
wire or renderer work begins.

#### Slice B: Core, Host, and Frontend Contract

- [x] Attach the semantic trajectory as a required field of
      `Reachable(PreciseJumpPredictedLanding)` and carry that composite result into presentation.
      Remove invalid `Copy` derives and prefer ownership/moves over adding `Arc` by default.
- [x] Keep retained commit authority unchanged: commit receives the opaque evaluation identity and
      freshly resolves the target/capability/scene. The trajectory is never read to launch.
- [x] Represent the wire evaluation as a status-discriminated shape: reachable contains the compact
      curve and placement intervals; all other statuses cannot contain them. Keep skills, capability
      limits, candidate-search history, and solver ticks out of the trajectory contract.
- [x] Extend the strict TypeScript schema to reject non-finite
      coefficients, invalid duration, empty/gapped/overlapping intervals, mismatched final time, and
      impossible cell identifiers.
- [x] Convert the curve's position coefficient and direction coefficients through the existing
      landblock-origin and AC-to-render-axis adapters exactly once. Resolve each placement interval's
      committed cell to the same render-scope vocabulary as the target marker.
- [x] Publish marker plus trajectory as one imperative presentation snapshot. Retain both while a
      replacement evaluation is pending and clear both on the existing cancel, hard-invalidation,
      commit-success, and precise-mode-exit edges.
- [x] Keep curve/interval objects and generated geometry out of Svelte `$state`, `$derived`, and
      `$effect`. Svelte may display scalar status only; accepted-evaluation edges update the
      imperative presentation runtime directly.

#### Slice C: Dedicated Dashed-Ribbon Pass

- [x] Add one focused `WebGL2WorldTrajectoryPass` with eagerly compiled flat and portal shader
      programs, reusable geometry storage, explicit destruction, and no lazy shader compilation on
      first activation.
- [x] Tessellate/evaluate the semantic curve according to the renderer-owned error policy selected
      at Resteer B. Sample count must depend on visual curve complexity, not directly on solver tick
      count or a skill value.
- [x] Rebuild/upload only when the accepted trajectory revision changes. An unchanged frame must
      allocate no trajectory objects, rebuild no geometry, and perform no trajectory upload.
- [x] Produce portable thickness from triangles rather than `gl.LINE_STRIP`/`lineWidth`. Compute the
      dash mask from cumulative world-space arc length so dash spacing does not restart at
      tessellation or portal boundaries.
- [x] Keep depth testing enabled, depth writes disabled, and ordinary alpha blending explicit. Add
      only the measured bias needed to prevent first-contact z-fighting, without making the airborne
      path draw through intervening geometry.
- [x] Split curve evaluation at exact placement-interval times and group the resulting draw ranges
      by resolved render scope. Exterior geometry uses the ordinary path; every EnvCell group routes
      through the existing portal deferred-visibility interface, with boundary positions represented
      in both adjacent scopes where continuity requires it.
- [x] Draw the trajectory in the same late world-indicator portion of the frame as the ring and
      restore all mutated WebGL state. Keep trajectory and marker passes separate even if they share
      tiny shader/state helpers.

#### Slice D: Verification and Cleanup

- [ ] Unit-test successful curve construction through first contact, curve/solver boundary parity,
      failed-candidate disposal, exact endpoint retention, anchor normalization, and
      outdoor/EnvCell/outdoor interval transitions.
- [ ] Test Rust-to-wire projection and strict TypeScript parsing at ordinary, maximum, and malformed
      interval counts. The discriminated schema must reject reachable-without-trajectory and
      non-reachable-with-trajectory shapes.
- [ ] Add renderer schedule/geometry tests for renderer-owned tessellation, cumulative dash distance,
      nondegenerate ribbon segments, unchanged-frame upload suppression, exact interval splitting,
      scope grouping, state restoration, and resource disposal.
- [ ] Compile and render both shader programs in SwiftShader flat/portal fixtures and on the existing
      real-GPU browser harness. Exercise a mixed-cell trajectory, not only an indoor endpoint.
- [ ] Measure serialized curve/interval bytes, projection time, renderer tessellation/upload time,
      CPU/GPU frame delta, allocation count, and draw calls during stationary display and sustained
      30 Hz evaluation replacement. Record hardware, scene, sample count, and release/debug mode
      here.
- [x] Run focused and full core/host/frontend tests, Rust and frontend formatting, TypeScript/Svelte
      checks, ESLint, dead-code analysis, clippy with warnings denied, browser harnesses, and the live
      ACE precise-jump commit probe.
- [x] Remove all temporary proof/census instrumentation and sweep point-per-tick, sampled-path, and
      physics-owned tessellation vocabulary in the same change.

#### Acceptance Criteria

- A blue outdoor, indoor, and mixed-cell target displays the accepted analytic candidate from the
  actor's solved start through its selected body-reference target. The collision solve separately
  proves that first contact is within the body-derived landing tolerance; intervening geometry
  occludes the line.
- Crossing a portal neither leaks the complete line into an unrelated room nor creates a segment
  joining coordinates expressed in different anchor frames.
- Marker, trajectory, color, target, and opaque commit identity change atomically. Pointer motion
  causes bounded evaluated trailing, not flicker or line/ring disagreement.
- Red, gray, pending, and missing-authority states draw no trajectory. They preserve their existing
  ring and activation semantics.
- The wire payload is curve coefficients plus placement intervals and does not scale with flight
  tick count. No production DTO or frontend state contains a fixed-tick point array.
- Unchanged frames perform zero trajectory uploads and zero trajectory-shape allocations. A changed
  evaluation performs at most one contiguous geometry upload; physical draws are bounded by the
  represented render scopes rather than by solver ticks or individual dashes.
- Dash appearance is stable across tessellation and portal boundaries and remains readable at the
  measured near/far camera and device-pixel-ratio cases.
- The wire is protocol-frame-bounded and renderer-safe, commit authority is byte-for-byte free of trajectory input,
  and the ordinary jump path remains unchanged.
- If production source growth exceeds approximately 700 lines excluding tests and generated schema
  artifacts, pause for an addition-through-subtraction review before continuing. The likely smell
  would be duplicated placement conversion or an accidental generic debug renderer.

#### Explicitly Out of Scope

- Rendering attempted paths for red or unproven evaluations.
- Swept body/capsule volume, clearance heatmaps, impact-normal arrows, time labels, or landing-settle
  animation.
- Moving-platform/dynamic-body prediction or visualization.
- User-configurable dash appearance, trajectory history, generic polylines, and editor/debug-draw
  registries.
- Using the rendered line, its coefficients, generated samples, or frontend transforms to authorize
  or reconstruct a jump.

### Phase 14: Conflict-Free Entry and Charge Handoff

#### Goal

Replace the desktop-reserved modifier-plus-Space gesture with `Shift+J`, and let an active ordinary
jump charge transition directly into precise targeting without releasing a manual jump.

#### Deliverables

- [x] Give the client input arbiter one idempotent `enterPrecise` transition shared by keyboard and
      UI entry; remove Ctrl-specific key-edge state.
- [x] Bind a fresh `Shift+J` keydown to that transition while preserving `Shift+Space` as the
      ordinary Walk-gait jump.
- [x] Add a `Precise` action to the active jump-charge popup. It must cancel ordinary ownership and
      swallow the already-held Space release before entering precise mode.
- [x] Update the live client probe and focused arbitration tests for both entry paths.

#### Acceptance Criteria

- `Shift+J` enters precise mode once; repeat does not re-enter or activate a jump.
- Clicking `Precise` during a charge removes the power bar, sends an ordinary reset, and enters
  precise mode. Releasing the charge key afterward does not activate or commit.
- The popup action does not steal canvas focus on pointer down, preserving the existing focus-loss
  safety cancellation semantics.
- `Shift+Space` remains an ordinary charged jump using Walk gait.

### Phase 15: Compact Jump HUD and Ephemeral Toasts

#### Goal

Reduce the ordinary jump popup's footprint while giving precise-mode entry and jump rejection
feedback an explicit, reusable, ephemeral presentation lifetime.

#### Deliverables

- [x] Replace the horizontal charge track with a compact bottom-up vertical meter and preserve its
      imperative animation-frame sampling, charge semantics, and progressbar accessibility.
- [x] Replace the text `Precise` action with one labeled icon button drawn through the existing
      client HUD icon vocabulary.
- [x] Add an app-local latest-wins toast center with injected scheduling, explicit destruction, and
      focused timing/replacement tests. Toast publication is cold UI state and must not become an
      application event bus.
- [x] Add one toast overlay with polite status and assertive warning tones; remove the jump bar's
      embedded rejection presentation and its prop plumbing.
- [x] Publish `Precise jump enabled` on the successful inactive-to-targeting edge and route ordinary
      jump rejection text through the warning toast path.
- [x] Update the HUD fixture and capture the charging popup and toast states in a real browser.

#### Acceptance Criteria

- The charged popup is visibly narrower and vertically oriented; charge fills from bottom to top.
- The precise action remains keyboard/screen-reader labeled and does not steal canvas focus during
  pointer activation.
- Re-enter attempts do not restart the enabled toast because only the successful arbiter transition
  publishes it.
- A newer toast replaces the current toast and owns a fresh expiry; an obsolete timer cannot clear
  its replacement.
- Jump rejection no longer remains indefinitely under the inactive charge bar.

### Phase 16: Stable Solid-Entity Landing Targets

#### Goal

Allow precise jump to select and land on the already-prepared solid entity bodies common in live
DA55 without pretending that current zero velocity is an authoritative `PhysicsState::STATIC`
classification.

#### Evidence and Boundary

- A live DA55 client-interest census on 2026-08-31 retained 51 resident entities: all 51 projected
  `physical`, none carried `PhysicsState::STATIC`, and none carried `PhysicsState::FROZEN`.
- Eighteen carried `HasPhysicsBSP|ReportCollisions` without gravity; the other 33 carried gravity
  and become stationary through solver-owned settling. The useful domain is therefore stable solid
  entity collision snapshots, not the protocol `Static` bit.
- This phase freezes every eligible entity target at the evaluation snapshot. A target generation,
  pose, selected geometry branch, collision participation, or spatial placement change invalidates
  the preview and forces replacement/fresh resolution. Time-dependent platform interception remains
  out of scope.

#### Deliverables

- [x] Add one immutable world-owned entity-collision snapshot compiled once per aim evaluation. It
      must retain only eligible solid target bodies plus their broad-phase index and collision proof;
      candidate ticks must not rebuild or clone the complete dynamic collection.
- [x] Add one nearest-surface query across installed environment and eligible entity target geometry.
      Reuse the authored BSP/ball/cylinder ray implementation, preserve collision coverage and
      outdoor/EnvCell traversal, and choose deterministically at equal distances.
- [x] Replace the static-only precise-jump target with one discriminated environment/entity target.
      Keep renderer projection source-neutral: point, normal, placement, and opaque evaluation ID;
      entity identity and proof remain host authority.
- [x] Add a bounded single-mover solve against the sealed entity-target snapshot. Reuse ordinary
      directional peer filtering and response, but do not integrate or mutate peer bodies during a
      speculative arc.
- [x] Publish the accepted blocking peer and contact normal as solver-owned tick output rather than
      deriving landing truth from optional collision-report events. Environment and entity contacts
      must feed one first-descending-contact classifier.
- [x] Make completion publication, retained-preview polling, and commit-time re-resolution reject a
      changed or missing entity proof. A fresh commit must solve against the current entity snapshot,
      never the stale preview geometry.
- [ ] Add focused world/core/runtime fixtures covering fallback and Physics BSP targets, entity in
      front of terrain, terrain in front of entity, solid/suppressed filtering, entity obstruction
      before an environment landing, first landing on the selected entity, landing on the wrong
      entity, outdoor/EnvCell placement, target removal/replacement/pose change, and unchanged-target
      commit.
- [ ] Benchmark the existing static target and a representative 51-target DA55-shaped snapshot.
      Record evaluated candidates, solver ticks, broad-phase candidates, and wall time; pause if the
      entity-aware path materially restores cursor starvation.

#### Acceptance Criteria

- A solid DA55 entity under the cursor can become blue and commit a jump whose first descending
  walkable contact is that exact entity within the existing body-derived tolerance.
- A nearer eligible entity wins over terrain; nearer terrain wins over an entity. Suppressed,
  ethereal-only, missile, suspended, attached, and pose-only entities cannot become targets.
- Other solid entity bodies obstruct the speculative arc and can cause red/missed-target results;
  the predictor never tunnels through them merely because they were not selected.
- Entity targets are frozen only within one replaceable evaluation. Any proof-relevant live change
  removes the retained blue result, and commit performs a fresh current-snapshot solve.
- Candidate ticks allocate no complete peer collection and never mutate peer pose, velocity,
  activity, reconciliation, or collision-report lifetime.
- Environment-only behavior, trajectory rendering, input, and wire DTOs remain unchanged except for
  source-neutral vocabulary replacing static-only names.

#### Explicitly Out of Scope

- Preparing entities that actually carry unsupported `PhysicsState::STATIC`; no live DA55 entity
  currently exercises that path.
- Predicting a moving platform or extrapolating remote entity motion through the flight duration.
- Jumping onto creatures or other intentionally mobile actors merely because their instantaneous
  velocity happens to be zero. Initial eligibility is limited to bodies whose current producer
  demand excludes integration or whose solver-owned activity is settled; the evidence gathered in
  focused fixtures must settle the final predicate before implementation is called complete.

## Risks and Mitigations

| Risk                                                        | Consequence                                                       | Mitigation                                                                                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACE accepts arbitrary velocity                              | Precise mode accidentally becomes a movement exploit              | Bound planar magnitude to actor-resolved maximum run speed, retain authoritative vertical rules, never accept renderer velocity, and test independently of server acceptance |
| Preview work is invalidated faster than it can publish      | Marker freezes or trails by seconds during pointer motion         | App-local 30 Hz evaluation-aware scheduler; one unsent latest ray; publish submitted completions despite newer unsent input; sustained-sweep timing proof                    |
| Preview solver cost scales with candidate count             | Network/fixed-tick starvation and visible input lag               | Fixed candidate/tick budget, early analytic rejection, measured blocking worker, and resteer only if post-cadence timing attributes material cost to core                    |
| Analytic arc disagrees with collision response              | Blue target misses, clips a ceiling, or lands early               | Analytic math proposes only; ordinary cloned solver authorizes first landing                                                                                                 |
| Preview becomes stale before click                          | Launch uses obsolete contact, position, capability, or scene      | Opaque generation-bound identity plus fresh simulation-boundary re-resolution                                                                                                |
| Rendered surface and collision surface differ               | Marker appears offset or on invisible collision                   | Marker uses collision hit and explicit unproven state; verify known visual/collision divergences and report them rather than substituting render depth                       |
| EnvCell/portal ray crosses unrelated geometry               | Target selects through walls or wrong room                        | Start from camera placement, reuse placement traversal, return hit cell/scope, and add sealed-cell/portal fixtures                                                           |
| Dynamic object crosses the arc after preview                | Legal preview is obstructed at launch time                        | Revalidate on commit and allow safe rejection; moving-surface targeting stays out of scope                                                                                   |
| World marker becomes a generic renderer subsystem           | Large unrelated API and maintenance surface                       | One minimal marker contract with one consumer and no registry/debug/editor features                                                                                          |
| Popup transition races the held Space release               | Ghost release launches or activates precise mode                  | One explicit arbiter transition resets ordinary ownership and suppresses Space until its physical release                                                                    |
| Replaced toast's timer clears newer feedback                | Current status disappears early                                   | Monotonic toast identity plus cancellation; expiry verifies it still owns the displayed toast                                                                                |
| Collision coverage ends before a high/long jump             | False clear ray or partially simulated arc                        | Authority-derived maximum aim range, explicit required-coverage policy, neutral unproven state                                                                               |
| Async aim responses flicker or mismatch the clicked target  | Unstable colors and a jump different from the visible marker      | Retain one complete atomic marker, separate submitted identity from the unsent latest ray, reject only obsolete completions, and commit the displayed ID                     |
| Fixed-tick samples cross the presentation boundary          | Physics chooses visual resolution and payload scales with airtime | Export a semantic curve plus placement intervals only; make renderer tessellation independent of solver ticks                                                                |
| A successful path contains a pre-landing collision response | One ballistic curve misrepresents the validated route             | Prove the success invariant before contract work; stop at Resteer B for an explicit piecewise semantic design if any counterexample exists                                   |
| Placement extraction drops a portal transition              | Line leaks into a room or joins incompatible anchor frames        | Preserve exact transition times from accepted placed motion and verify an outdoor/EnvCell/outdoor fixture                                                                    |
| Dynamic line geometry enters the frame hot path             | Pointer targeting adds allocations, uploads, or shader stalls     | Tessellate/upload only on accepted-evaluation revision, eagerly compile both programs, and measure stationary plus 30 Hz replacement                                         |
| Placement intervals exceed the derived wire bound           | A valid evaluation cannot be represented honestly                 | Derive the bound from traversal hard limits, enforce it in the core type and strict schema, and fail loudly rather than truncate or downgrade reachability                   |
| Marker pass grows into a generic polyline abstraction       | Two lifecycles become coupled and maintenance cost balloons       | Keep a dedicated narrow trajectory pass; share only proven low-level shader/state helpers                                                                                    |

## Definition of Done

- [x] `Shift+J` enters precise-jump mode without starting ordinary charge; `Shift+Space` remains
      an ordinary Walk-gait jump.
- [x] The ordinary jump popup can cancel its active charge and enter precise mode without a ghost
      release or focus-loss cancellation.
- [x] The compact vertical charge meter exposes a labeled precise-mode icon action; mode entry and
      jump rejection use one latest-wins ephemeral toast owner.
- [x] While targeting, left-click and a fresh Space press share one blue-target commit path; invalid
      targets are inert and preserve the mode.
- [x] Cursor aim resolves a collision-backed static target from the coherent client camera.
- [x] Blue means a bounded speculative run of the ordinary body solver first lands within the
      body-derived target tolerance.
- [x] Red is reserved for proven unreachable/unwalkable outcomes; pending/missing authority is
      visually distinct.
- [x] Capability includes current Jump skill, Run capability, burden, exhaustion, body support,
      retail vertical rules, and the precise-jump-specific isotropic planar magnitude cap.
- [x] Activating the latest blue evaluation by click or Space triggers fresh host-side re-resolution
      and exactly one local/wire jump transaction.
- [x] Renderer cannot submit a target position, skill, extent, or velocity as authority.
- [x] Static outdoor and EnvCell targets, intervening collisions, ceilings, slopes, stale previews,
      and missing collision coverage have automated tests.
- [x] Marker is stable, depth-tested, portal-correct, and absent outside precise mode.
- [x] Pointer movement retains one complete atomic marker until its newest replacement is ready;
      ordinary in-flight evaluation never flashes the marker back to pending.
- [x] Ordinary jump/input/camera behavior regresses neither in focused tests nor live probe.
- [x] Prediction cost is measured and bounded under representative scenes.
- [x] Full Rust/TypeScript/Svelte formatting, lint, checks, tests, browser harness, and live ACE probe
      pass.
- [x] Architecture docs and this plan record final ownership decisions, course corrections, and any
      consciously retained debt.
- [x] Raw cursor input is coalesced by an imperative 30 Hz evaluation-aware scheduler; completed
      submitted work continues publishing during sustained pointer motion, and live sweep evidence
      shows no one-to-two-second starvation.
- [ ] A reachable evaluation carries one compact validated curve plus placement-time intervals
      through first contact, with no fixed-tick samples and no trajectory input to commit authority.
- [ ] The blue dashed trajectory is depth-tested, stable, bounded, and portal-correct across mixed
      outdoor/EnvCell paths; other statuses continue to render only their existing marker.
- [ ] The renderer owns tessellation and dash geometry independently of solver ticks; geometry is
      rebuilt/uploaded only when the accepted evaluation changes, stays out of Svelte reactive hot
      paths, and passes recorded flat/portal real-GPU performance gates.

## Resolved User Decisions

1. **Activation and lifetime:** `Shift+J` latches precise mode. Once active, either left-click or
   a fresh Space press attempts the latest blue evaluation. The mode exits only after confirmed jump
   commit or cancellation; a rejected commit returns to targeting.
2. **Invalid targets:** activating a red, pending, unproven, or absent target does nothing and leaves
   precise mode active. No host commit command is sent.

## Resolved Implementation Decisions

1. **Explicit cancellation gesture — recommended:** `Escape` or right-click cancels. Focus,
   visibility, lifecycle, and portal loss remain mandatory safety cancellation even though they are
   not user gestures. `Shift+J` is idempotent once targeting is active; Space continues to follow
   the normal activation rule.
2. **Movement while targeting — recommended:** entering precise mode publishes idle planar drive and
   reserves left-click for commit; camera orbit is suspended, wheel zoom remains available. Exiting
   recomputes drive from keys still physically held rather than inventing releases.
3. **Directional capability:** allow any planar direction up to the actor-resolved maximum run-speed
   magnitude (D5), without auto-turning the character before launch. Heading only converts the
   selected world trajectory into `JumpPack`'s body-local vector. This deliberately permits
   full-speed sideways/backward precise launches while keeping ordinary charged-jump input retail
   faithful.
4. **Unproven visual — recommended:** use neutral gray before the first complete evaluation or after
   hard invalidation, and amber for missing collision/authority. Ordinary replacement evaluation
   retains the last complete marker instead of flashing gray. Red should mean the client actually
   proved “cannot land there,” not “doesn't know.”
5. **First-slice target classes — recommended:** terrain and static environment collision only.
   Dynamic targets should wait for a separate time-dependent interception design.
