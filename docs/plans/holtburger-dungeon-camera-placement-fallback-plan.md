# Holtburger Dungeon Camera Placement and Fallback Plan

Status: **Complete (2026-08-28); Phases 0–5 verified.**

Origin: live Electron reproduction of client mode remaining on `Loading the authoritative scene…`
after `@teledungeon 0288` from `@tele 22s 2w`.

## Context and Boundaries

### Goal

Preserve authored EnvCell portal placement during camera-target reconciliation and always present the
best generation-current camera placement, even when projection-clearance solving cannot yet prove a
collision-safe boom.

### Why this cutover is deserved

The observed failure combines two independent structural defects.

First, `CollisionScene::placement_for_committed_cell` treats every change from a prior committed
EnvCell as evidence that the placement escaped its retained topology. That assumption is false for
an ordinary portal crossing. At the Royal Hive destination, the local player is authoritatively in
`0x0288027A`, while the selected upper camera target sphere is centered in adjacent authored EnvCell
`0x0288027B`. Prior-cell-seeded portal traversal correctly reaches and selects `0x0288027B`; the
subsequent recovery pass discards that result, finds no coordinate-wide interior candidate, and
reclassifies the target outdoors. Outdoor normalization then changes dungeon-local `(90, -20)` into
`0x02870020 (90, 172)`.

Second, the kinematic boom already retains its target placement and emits a stationary held path
when its first clearance solve fails, but the wire and frontend contracts encode proof as nullable
clearance. Both TypeScript playback adapters reject a tick whose clearance is null. Client portal
presentation consequently withholds the destination frame and reveal acknowledgement even though
the destination scene and local player are ready. The same nullable shape permits an unproven first
placement and a proven held placement to share one variant despite requiring opposite presentation
policy.

The fix must correct both layers. Presenting a fallback alone would expose the currently corrupted
target placement. Correcting topology alone would fix 0288 but retain a frozen loading screen for
the next genuine first-clearance failure.

### In scope

- Distinguish valid portal-derived cell changes from unresolved prior-cell placement.
- Retain coordinate-wide placement recovery for genuinely escaped, stale, or ambiguous placement.
- Add an explicit unproven camera fallback outcome at the shared boom and both desktop transport
  boundaries.
- Make proven camera outcomes carry non-null projection clearance by type.
- Collapse the boom's interdependent placement, clearance, and rendered-reach fields into one
  invariant-bearing state.
- While unproven, adopt the latest target sample and present a collapsed camera at that exact target
  placement rather than remaining at the generation's original seed.
- Continue retrying ordinary clearance initialization and transition cleanly from fallback to a
  proven reseed.
- Preserve last-proven-placement hold behavior after a generation has initialized.
- Allow a rendered unproven destination frame to satisfy portal reveal without claiming projection
  clearance.
- Keep client and Explorer camera contracts isomorphic.
- Retain and refine the non-interactive host and real-Electron live probes needed for acceptance.
- Remove all temporary production tracing and investigation-only globals before completion.

### Out of scope

- Making camera fallback itself change ACE teleport commands, server portal lifecycle, or
  `LoginComplete` sequencing. A separately proven broken-content completion policy is recorded
  under adjacent hardening below.
- Weakening destination scene, local-player realization, camera registration, or generation checks.
- Treating an unproven fallback as collision-safe or acknowledging a projection revision for it.
- Adding an arbitrary timeout that reveals the old scene, inventing a frontend-only eye position, or
  bypassing the host-authored target placement.
- Increasing free-sphere contact/substep budgets to hide malformed placement.
- Changing the authored geometry, portals, or coordinates for landblock `0x0288`.
- Generalizing the live probe into a recorder/replay framework beyond the observed acceptance flow.
- Retaining permanent 0288-specific branches, metrics, logs, environment variables, or UI warnings.

## Ground Truth

### Retail and reference behavior

- `acclient-eor-source/acclient.c:332969`, `CObjCell::find_cell_list`, seeds the cell array with the
  current EnvCell, expands transit, and selects the cell containing sphere zero from the reached
  cells.
- `acclient-eor-source/acclient.c:334136`, `CEnvCell::find_transit_cells`, adds adjacent EnvCells
  through authored portals and only asks land cells to add outdoor cells after reaching an authored
  outside portal.
- `ACViewer/ACViewer/Physics/Common/ObjCell.cs::find_cell_list` and
  `ACViewer/ACViewer/Physics/Common/EnvCell.cs::find_transit_cells` preserve the same division between
  EnvCell topology and outdoor reach.
- ACE's `@teledungeon` implementation resolves an authored dungeon destination, applies
  `AdjustDungeon`, and teleports the player. The live destination selected for 0288 is
  `0x0288027A (90, -20, -11.995)`.

### Current runtime contracts

- `crates/holtburger-world/src/spatial/child_body.rs::ChildSpatialBody` seeds child topology from the
  parent's authoritative residency and reconciles the child over accepted parent paths.
- `crates/holtburger-world/src/spatial/collision.rs::transit_cell_installed` already produces the
  correct complete portal-derived `SpatialMembership`.
- `crates/holtburger-world/src/spatial/collision.rs::placement_for_committed_cell` currently invokes
  recovery whenever the selected committed cell differs from the previous cell.
- `crates/holtburger-world/src/spatial/collision.rs::recover_placement` scans coordinate-touched
  landblock volumes and does not consume the already-derived portal membership.
- `crates/holtburger-core/src/client/camera.rs::initialize_if_ready` derives the camera target from a
  child body attached to the local player's selected physical sphere.
- `crates/holtburger-core/src/kinematic_boom.rs::KinematicBoomController` starts its camera at the
  target seed, but stores placement, optional committed clearance, and rendered reach as separate
  fields.
- Both `ClientCameraTick` and Explorer's `HostKinematicBoomTick` use nullable clearance on every
  output variant.
- `client-camera-session.ts` and `host-kinematic-boom-session.ts` refuse to activate any playback
  path without clearance. Client mode additionally withdraws the active path on an uninitialized
  held tick.
- `client-presentation-session.ts` requires one destination camera presentation before rendering
  and acknowledging portal reveal. This gate is correct; the absence of a presentable fallback is
  not.

### Investigation evidence

The production code was temporarily instrumented and exercised through a real Electron/CDP client.
The instrumentation was removed after capture.

- `@tele 22s 2w` completed and rendered normally in approximately four seconds.
- `@teledungeon 0288` remained in portal presentation for at least thirty seconds.
- At the stall, authoritative residency was `0x0288027A`; scene activation and local-player
  realization were both ready; reveal acknowledgement was false.
- Prior-cell transit for the camera target returned committed cell `0x0288027B`, no outdoor reach,
  and reached EnvCells `[0x0288027A, 0x0288027B]`.
- The generic recovery pass then returned no candidate, retransited with no previous cell, and
  produced outdoor placement.
- The boom received seed `0x02870020 (90, 172, -10.645)`, exhausted all eight contact passes, and
  returned a held tick with no committed clearance.
- The frontend received that held tick but retained no active playback path, so rendered frame count
  remained at the outgoing outdoor frame.
- A host-only probe entered and left 0288 repeatedly because it acknowledged world reveal directly
  and did not require a renderer-visible camera presentation. This establishes why both harness
  layers are necessary.

## North Stars

1. Authored portal topology outranks coordinate heuristics when it resolves placement.
2. A placement changing cells is ordinary motion; unresolved topology is the recovery condition.
3. Collision proof and presentation availability are separate facts.
4. Never label an unproven camera collision-safe, but never freeze presentation merely because proof
   is temporarily unavailable.
5. Before proof exists, the character's current target placement is the only deserved fallback.
6. After proof exists, hold the last proven camera rather than regressing to an unproven placement.
7. Encode placement, proof, and reach invariants in types instead of nullable field combinations.
8. Keep one shared boom behavior and isomorphic Explorer/client adapters.
9. Fix the causal contracts; do not tune budgets or add dungeon-specific exceptions.

## Settled Direction Decisions

### D1. Recovery begins only when topology is unresolved

`placement_for_committed_cell` will accept a prior-cell transit result when it identifies a
containing EnvCell, even when that cell differs from the prior cell. It will also accept an outdoor
result when authored traversal reached outdoors. Recovery remains reserved for the state in which
the prior cell no longer contains the center and traversal establishes neither another containing
EnvCell nor outdoor reach.

The condition will be represented by a focused predicate or private `SpatialMembership` query with
an honest topology-oriented name. It will not special-case negative coordinates, child bodies,
cameras, or landblock 0288.

### D2. Boom placement state becomes an explicit two-state invariant

Replace the independent `camera`, `committed_clearance`, and `rendered_reach` fields with one private
state equivalent to:

```text
Unproven { placement }
Proven { placement, clearance, rendered_reach }
```

The requested clearance remains separate because it is an input that may be newer or larger than
the currently proven envelope. Accessors may expose placement, optional acknowledged clearance, and
rendered reach, but mutation must go through the composite state.

This prevents a held camera without proof, a proven camera without reach, or an unproven camera with
an asserted projection revision from being constructed accidentally.

### D3. Fallback is a distinct outcome, not a nullable held tick

Add a shared `Fallback` outcome carrying the current target placement, failure reason, and bounded
diagnostics. It has no projection-clearance field and always reports zero rendered boom reach.

`Advanced`, `Reseeded`, and `Held` become proven outcomes with non-optional clearance. Their existing
semantics remain:

- `Advanced`: connected collision-safe path;
- `Reseeded`: proven discontinuity near the target;
- `Held`: stationary last-proven placement after a recoverable failure;
- `Fallback`: stationary current target placement before any proof exists.

Rename hold-only reason types where needed so the shared reason vocabulary honestly applies to both
held and fallback failures. Wire reason strings need not change.

### D4. Unproven initialization consumes the latest target

The initialization branch will adopt the final validated target sample from the current tick before
settling. On failure it commits and publishes that target as fallback. On the next tick it repeats
with the then-latest target. Intermediate target samples do not need interpolation while unproven
because fallback is explicitly a discontinuous collapsed presentation; only the final current
placement is authoritative for the frame.

Successful settlement transitions the composite state to `Proven` and emits the ordinary initial
reseed. Once proven, existing continuous control, recovery reseeds, and last-safe holds resume.

### D5. Frontends present fallback but do not acknowledge projection proof

Both playback adapters will accept `Fallback` as an active stationary path. Their
`acknowledgedProjection` result remains null while fallback is active. The renderer therefore uses
its normal projection defaults for presentation but cannot confuse them with host-acknowledged
clearance.

Client portal presentation will render the fallback destination frame and acknowledge reveal using
the existing destination-frame gate. It will not add a timeout or special portal bypass. A later
proven reseed replaces fallback through the normal latest-wins playback contract.

## Phased Implementation

### Phase 0 — Complete: Freeze the reproducer and focused counterexample

**Deliverables**

- Refine `apps/holtburger-3d/scripts/live-client-ui-probe.mjs` and its package script so the exact
  outdoor/dungeon ping-pong is a credential-redacted, non-interactive acceptance command.
- Retain pipe-separated teleport sequences in `live-client-probe.mjs` for host-only lifecycle
  corroboration and account recovery.
- Add a minimal synthetic collision fixture reproducing prior EnvCell `A`, portal-reached containing
  EnvCell `B`, and a stationary child center outside `A`.

**Acceptance criteria**

- The focused fixture fails under the current recovery condition by attaching a recovery marker or
  losing `B`.
- The real UI probe fails specifically because no destination camera presentation becomes active.
- The probe accepts credentials through environment variables and redacts captured reports.

**Implemented result (2026-08-28)**

- Added the real Electron/CDP client probe with the exact default 22s/0288 round trip and retained
  the host-only pipe-separated command sequence for lifecycle corroboration and account recovery.
- Added a synthetic, asset-independent stationary child fixture with negative dungeon-local
  coordinates. Before the fix it reproduced the live failure: traversal found the adjacent EnvCell
  and generic recovery replaced it with outdoor placement.
- The harness accepts credentials only through environment variables and redacts both credentials
  from its complete serialized report. The existing Electron client launch contract forwards them
  as `--account`/`--password`; the user explicitly accepted that for these non-sensitive local test
  credentials rather than expanding scope into a second credential-delivery mechanism.

**Concession:** Test credentials may appear in the spawned Electron command line. They remain
environment-only at the probe interface and redacted from persisted/output evidence.

### Phase 1 — Complete: Correct placement recovery ownership

**Production touch points**

- `crates/holtburger-world/src/spatial/collision.rs`
- Colocated collision/child placement tests; change `child_body.rs` only if a clearer private
  topology contract belongs there.

**Tasks**

- Introduce the focused unresolved-topology decision.
- Accept portal-selected cell changes and authored outdoor transitions without recovery.
- Preserve recovery and its diagnostics for genuinely escaped placement.
- Add the negative dungeon-local coordinate regression without embedding production 0288 constants.
- Run the existing coincident-junction, portal-transition, transformed-boundary, and recovery suites.

**Acceptance criteria**

- `027A`-equivalent prior placement resolves to portal-connected `027B` with no recovery.
- No resolved indoor placement is normalized into an adjacent outdoor landblock.
- Existing unique, outdoor, and ambiguous escaped-placement recoveries retain their behavior.
- No camera-specific policy enters `holtburger-world`.

**Implemented result (2026-08-28)**

- Added `SpatialMembership::center_domain_is_unresolved`; a different portal-selected EnvCell and
  authored outdoor reach are now resolved topology rather than recovery triggers.
- Split prior-cell inference from exact transition commitment. The dry run exposed that the old
  helper used one `committed_cell` argument both to seed traversal and to overwrite its result.
  Initial/endpoint inference now preserves a valid portal-selected cell, while exact motion
  boundaries still commit their explicit indoor/outdoor target and outdoor history alone never
  invents an untraversed building entry.
- The new stationary child fixture commits its adjacent EnvCell with no recovery. All 444
  `holtburger-world` tests pass, including escaped-placement, thin-cell, coincident-junction,
  transformed-portal, and outdoor-transition coverage.

**Course correction:** The planned recovery predicate was necessary but not sufficient because the
same helper also restored the prior cell after successful traversal. Rather than add a conditional
overwrite, Phase 1 separated inference from explicit commitment so each call site states which fact
it owns. This is a generic placed-motion correction; no camera or 0288 policy entered the world
layer.

### Phase 2 — Complete: Replace nullable boom initialization with explicit fallback

**Production touch points**

- `crates/holtburger-core/src/kinematic_boom.rs`
- `crates/holtburger-core/src/lib.rs`
- Colocated boom tests.

**Tasks**

- Replace independent committed placement/proof/reach fields with the composite unproven/proven
  state.
- Add the explicit fallback outcome and honest shared failure-reason vocabulary.
- Make every proven outcome carry concrete clearance.
- Adopt the latest target sample before each unproven settlement attempt.
- Emit fallback at the latest target when settlement errors or exhausts its finite budget.
- Preserve the last proven state on all later failures.
- Delete superseded nullable branches and comments in the same cutover.

**Acceptance criteria**

- The type system prevents construction of a proven output without clearance.
- Initial failure publishes the latest target placement with zero rendered reach.
- A moving target updates repeated fallback placements.
- A later successful attempt emits a proven initial reseed.
- Failure after initialization emits a held last-proven placement, never fallback.

**Implemented result (2026-08-28)**

- Replaced the controller's independent camera, optional clearance, and rendered-reach fields with
  `Unproven` and `Proven` placement states. Unproven state cannot carry projection proof; proven
  state cannot omit it.
- Added a distinct fallback outcome and renamed the shared reason vocabulary from hold reasons to
  failure reasons. Advanced and held outcomes now carry concrete clearance.
- Initial settlement now consumes and retains the final validated target sample on every attempt.
  Failure publishes that exact generation-current target with zero boom reach; a later successful
  attempt emits the ordinary proven initial reseed.
- Reworked clearance growth to return either a concrete still-proven clearance or a complete
  published outcome. This removed the nullable compatibility branches that remained after the
  initial state refactor instead of asserting through the new invariant.
- Added deterministic, asset-independent coverage for repeated moving fallback, later convergence,
  and last-proven hold when an established placement becomes unavailable. All 291
  `holtburger-core` tests pass.

**Scope clarification:** The Phase 1 regression now explicitly describes and asserts a mixed
indoor/outdoor landblock. Placement remains seeded from the authoritative EnvCell and changes to
outdoor only through authored topology; landblock composition is not a classifier.

### Phase 3 — Complete: Cut both desktop contracts over atomically

**Production touch points**

- `crates/holtburger-core/src/client/camera.rs`
- `apps/holtburger-3d/host/src/host_kinematic_boom_runtime.rs`
- `apps/holtburger-3d/src/client/client-host-contract.ts`
- `apps/holtburger-3d/src/lib/game/motion/host-kinematic-boom-path.ts`
- `apps/holtburger-3d/src/lib/game/camera/client-camera-session.ts`
- `apps/holtburger-3d/src/lib/game/camera/host-kinematic-boom-session.ts`
- Camera status/debug consumers and colocated tests.

**Tasks**

- Add client and Explorer fallback wire variants with stationary target paths and no clearance.
- Make clearance required on advanced, reseeded, and held wire variants.
- Project adapter-level failures to held when proof exists and fallback when it does not.
- Accept fallback into playback without resolving an acknowledged projection revision.
- Extend status placement outcomes to identify fallback explicitly.
- Update exhaustive matches, schemas, fixtures, comments, and UI labels in one vocabulary sweep.
- Keep the two frontend adapters behaviorally isomorphic without introducing a transport-obscuring
  abstraction solely to share a small conditional.

**Acceptance criteria**

- Both schemas reject nullable clearance on proven variants.
- Both playback sessions return a presentation for fallback and null acknowledged projection.
- Proven output immediately supersedes fallback.
- Held output continues to retain its proven projection and placement.
- Explorer and client builds have no compatibility shim or legacy nullable branch.

**Implemented result (2026-08-28)**

- Cut shared client, Explorer host, and both Zod contracts to the same discriminated shape:
  advanced/reseeded/held ticks require clearance and rendered reach; fallback carries neither.
- Adapter failures now inspect the controller's proof state. Before first proof they publish the
  current target as fallback; afterward they publish a held last-proven placement. Explorer covers
  both branches in its possession runtime test; client mode uses the same explicit projection
  helper for target-contract and controller-input failures.
- Both playback sessions accept fallback as a stationary active path, report null acknowledged
  projection, expose fallback in status, and replace fallback immediately when any proven tick
  arrives. No transport compatibility shim was retained.
- Updated schemas, status consumers, harness summaries, serialization tests, and failure vocabulary
  together. The schemas explicitly reject null clearance on proven variants and accept fallback
  only without proof fields.
- All 291 `holtburger-core` tests, all 245 host tests, all 1,598 TypeScript tests, and the complete
  Svelte/TypeScript check pass.

**Decision:** Status remains a presentation-friendly projection with `clearance: null` and
`renderedReach: 0` during fallback, while the wire variants remain structurally disjoint. This is
not a nullable proof contract: the status is a UI summary with named fallback outcome, and proof is
never reconstructed from those summary fields.

### Resteer checkpoint — Re-evaluate the complete causal chain

- Confirm the Phase 1 topology fix makes normal 0288 entry produce a proven initial reseed rather
  than relying on fallback.
- Confirm fallback tests exercise an independently forced solver failure.
- Review whether the composite state removed all impossible nullable combinations or merely moved
  them into adapter fields.
- Re-census all camera outcome matches before proceeding to portal acceptance.
- Split any newly discovered generic placement defect into its owning layer rather than broadening
  frontend fallback policy.

**Checkpoint result (2026-08-28)**

- The refined real-Electron probe completed the full four-hop outdoor/0288 ping-pong. Every
  destination published a generation-new first camera tick that was a proven `initial-placement`
  reseed; neither 0288 entry relied on fallback. Both 0288 camera placements were `0x0288027B`, the
  portal-connected target EnvCell observed during investigation.
- Fallback remains covered independently by the deterministic impossible-settlement fixture and
  both playback adapters. It is not part of the normal 0288 golden path.
- The placement-state census found no optional clearance in proven controller or wire variants.
  Optionality remains only in the controller's read-only proof query and UI status summaries that
  explicitly name fallback; consumers do not derive proof from those summary fields.
- The probe previously assumed its first command must cause loading. When the account was already
  at `22s 2w`, that produced a false timeout. It now chooses the first destination from the visible
  starting location and listens through the existing Electron event bridge for first-tick camera
  evidence. No production diagnostic global or trace was reintroduced.
- No new generic placement defect, scope expansion, concession, or implementation debt was found.
  Phase 4 remains correctly limited to generation-current presentation and reveal semantics.

### Phase 4 — Complete portal presentation semantics

**Production touch points**

- `apps/holtburger-3d/src/client/client-presentation-session.ts`
- `apps/holtburger-3d/src/client/client-presentation-session.test.ts`
- Relevant camera session and portal-transition tests.

**Tasks**

- Remove the policy/comment that makes portal reveal depend exclusively on a proven camera path.
- Keep the requirement for one generation-current host-authored camera presentation.
- Render fallback with default projection parameters while acknowledged projection remains absent.
- Allow that rendered destination frame to drive the existing reveal acknowledgement.
- Ensure stale/outgoing-generation fallback cannot reveal a newer destination.

**Acceptance criteria**

- A generation-current fallback renders and completes reveal.
- No camera output still prevents reveal; there is no timeout bypass.
- Wrong-generation output remains ignored.
- A normal proven 0288 entry follows the same destination-frame gate as every other portal.

**Implemented result (2026-08-28)**

- Portal activation now states its actual contract: one generation-current host-authored camera
  placement. A proven path and the controller's explicit fallback both satisfy it; absence and
  stale-generation output do not.
- No fallback-specific reveal branch or timeout was added. Phase 3 made fallback a normal
  presentable path, so the existing destination-frame gate, transition, and acknowledgement flow
  remain the single mechanism. Default renderer projection is used while
  `acknowledgedProjection()` stays null, preserving the distinction between presentation and proof.
- Focused presentation tests prove that current fallback renders and acknowledges generation 4,
  while both no output and a generation-mismatched fallback remain on `loading-activation` and
  never acknowledge reveal. The targeted suite passes all 13 tests.

**Decision:** The clean implementation was addition through subtraction: remove the obsolete
proof-only policy from the portal gate and let the discriminated camera contract established in
Phase 3 carry the decision. Adding a second fallback reveal path would have duplicated lifecycle
authority and created the stale-frame hazard this phase is meant to prevent.

**Debt:** None introduced. The fallback diagnostic's null clearance and zero rendered reach remain
intentional UI projections, not nullable wire proof.

### Phase 5 — Complete: Cleanup and full verification

**Tasks**

- Remove investigation traces, debug globals, temporary fixtures requiring runtime DAT assets, and
  obsolete nullable-clearance vocabulary.
- Run focused Rust tests, workspace-relevant tests, strict clippy, TypeScript/Svelte checks, ESLint,
  dead-code analysis, and formatting.
- Run the host-only sequence to corroborate lifecycle and return the account to a usable location.
- Respect the ACE successful-login cooldown before the real Electron run.
- Run the real Electron sequence:
  `@tele 22s 2w | @teledungeon 0288 | @tele 22s 2w | @teledungeon 0288`.
- Inspect repository diff and status; preserve unrelated ACE/ACViewer submodule dirt.

**Acceptance criteria**

- Every ping-pong destination renders and reaches `in-world` without manual assistance.
- Normal 0288 entries report camera residency in the correct 0288 EnvCell topology.
- The first destination frame is not an outgoing stale frame.
- A controlled fallback scenario renders instead of freezing and later converges when proof becomes
  available.
- No permanent dungeon-specific diagnostic or tuning remains.

**Verification progress (2026-08-28)**

- The final quality pass collapsed the tick path anchor and reanchored start into one private
  `KinematicBoomTickFrame`, removing an over-wide commit signature without suppressing strict
  clippy. It also unified duplicated client fallback projection behind one helper and corrected the
  mixed-landblock regression to use the stable scene-residency API.
- All 444 `holtburger-world`, 293 `holtburger-core`, 245 host, and 1,602 TypeScript tests pass.
  Svelte/TypeScript checks, ESLint, dead-code analysis, strict clippy across all three touched Rust
  packages, Rustfmt, Prettier, and the default browser harness also pass.
- The host-only live probe completed outdoor -> 0288 -> outdoor, with a fresh portal generation and
  `in-world` lifecycle edge for every destination, 510 camera events, no presentation
  discontinuities, and an orderly disconnect. The first sandboxed attempt was refused before ACE
  authentication; the unrestricted localhost rerun passed and left the account outdoors.
- After a host-only parking hop and the required cooldown, the post-cleanup real-Electron probe ran
  the plan's literal `@tele 22s 2w | @teledungeon 0288 | @tele 22s 2w | @teledungeon 0288`
  sequence. Every destination removed the portal overlay and rendered from a new camera generation
  in 2.1–3.8 seconds. Both 0288 entries began at sequence 1 with a proven `initial-placement` reseed
  in `0x0288027B`; neither used fallback or an outgoing stale frame. The account ended in 0288.
- A report audit exposed that whole-JSON credential redaction could rewrite a field named `latest`
  when the account was a substring. Redaction now applies only to string values, removes a password
  before a possibly overlapping account, and has focused regression coverage. The current harness
  was rerun successfully after that correction.

**Decision:** Repeated renderer warnings are aggregated with counts in the real-Electron report,
and hop evidence omits the duplicated generation census. This keeps the retained acceptance harness
compact and reviewable without changing what it observes.

**Unrelated observation:** The live renderer continues to report existing motion-table
part-coverage and blocking-hook warnings. They neither blocked presentation nor changed across the
teleports; this plan did not alter motion playback compatibility.

**Debt:** None introduced or retained for this plan. No temporary production trace, diagnostic
global, runtime-asset test, nullable proof shim, or dungeon-specific production exception remains.
The retained probe evidence collector exists only in the CDP-injected page runtime and does not add
a production application global.

## Adjacent Hardening: Broken Authoritative Destinations

The completed camera work exposed a separate failure at Town Network landblock `0x0007`. ACE sends
and Holtburger accepts destination `0x00070219`, but the shipped scene cannot construct the local
player's runtime presentation. Retail also fails to render this destination, yet exits portal-space
to a black scene instead of waiting forever.

Core now keeps the normal collision/body/camera/reveal conjunction as the golden path, but bounds it
after an authoritative destination has been accepted. The seven-second bound follows retail's
maximum tunnel continuation and fades (`acclient.c:252754-252799`); retail independently marks the
received position complete without scene rendering (`acclient.c:140024-140027`). At the bound,
core sends `LoginComplete` and enters `in-world` while the frontend continues to report the absent
presentation. A teleport that has not received a destination never uses this policy.

The final Electron sequence verified outdoor 22S, 2W and dungeon 0288 still converge through proven
camera reseeds before the bound. Dungeon 0007 transitions to `in-world` with no fabricated camera,
scene, collision proof, or renderer acknowledgement. The host and frontend each emit one warning at
their ownership boundary, and the UI retains its explicit unavailable-presentation status.

## Risks and Mitigations

### Valid outdoor exits could be mistaken for unresolved placement

Use the complete `SpatialMembership` result: authored outdoor reach is a resolved topology outcome,
not absence of an EnvCell. Preserve focused outdoor and coincident-junction tests.

### Fallback could hide a topology regression

Normal 0288 acceptance must assert a proven reseed and correct camera residency, not merely a
rendered frame. Exercise fallback through an independent deterministic solver-failure fixture.

### Fallback could drift behind a moving player

Commit the latest target sample while unproven and test multiple failed ticks with changing target
placements before successful initialization.

### Nullable proof could survive in one adapter

Cut shared, client, Explorer, and TypeScript discriminated unions over together. Use exhaustive
matches and a repository-wide vocabulary census before cleanup.

### Default projection could be mistaken for acknowledged clearance

Keep `acknowledgedProjection()` null during fallback. Default projection parameters are renderer
inputs only; they do not enter the host-proof contract or diagnostics as accepted clearance.

### Revealing fallback could expose clipping

This is the intended degradation: a generation-current camera inside or near the character is
preferable to a frozen outgoing scene. The explicit fallback variant makes that state observable and
replaceable without claiming safety.

### The real harness could be fooled by protocol completion

Require the Electron probe to observe disappearance of the portal overlay and a newly rendered
destination frame. Keep the host-only probe separate because it intentionally bypasses that
renderer boundary.

## Definition of Done

- [x] Portal-connected cell changes never enter generic placement recovery.
- [x] Genuine escaped placements retain deterministic recovery behavior.
- [x] Boom placement/proof/reach state is represented by one invariant-bearing type.
- [x] Proven camera outcomes cannot carry null clearance.
- [x] An unproven first placement has one explicit fallback variant.
- [x] Fallback follows the latest target and reports zero rendered boom reach.
- [x] Later solver failure holds the last proven placement.
- [x] Client and Explorer wire/playback contracts are isomorphic.
- [x] Portal reveal accepts a rendered generation-current fallback but no absent or stale camera.
- [x] Focused tests, checks, lint, clippy, dead-code analysis, and formatting pass.
- [x] The real 22s/0288 ping-pong completes twice with correct 0288 camera residency.
- [x] No temporary profiling, tracing, unredacted credential output, asset-dependent committed
      test, legacy nullable branch, or dungeon-specific production exception remains.

## Open Questions

None. The implementation and live acceptance evidence resolved the planned topology, camera-proof,
playback, and reveal decisions without a remaining concession beyond the approved test-credential
command-line transport.
