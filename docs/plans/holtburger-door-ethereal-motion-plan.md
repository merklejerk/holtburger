# Holtburger Door Ethereal Motion Plan

Status: **Implementation complete (2026-09-01).**

## Context and Boundaries

### Goal

Render doors from their authoritative motion clip while executing authored `Ethereal` hooks in the
host at the same frame retail changes collision, with timestamped server `SetState` retained as the
final authority.

### In scope

- Preserve the hooks already emitted by the world-owned motion cursor instead of consuming only
  its root offset or current clip.
- Execute table-reachable `Ethereal` hooks in host simulation before the tick's collision queries.
- Match retail's obstructed solidification behavior: retain ethereal participation and retry while
  the door overlaps another collider.
- Keep authoritative create/`SetState` physics separate from the host's temporary authored-motion
  prediction, and reconcile the prediction on an admitted `SetState`.
- Let the 3D frontend play motion clips that contain host-owned collision hooks without executing
  those hooks itself.
- Cover forward opening, backward closing, terminal open/closed poses, obstruction, retry, and
  server reconciliation with focused tests and a live two-door verification.

### Out of scope

- General execution of `Attack`, `ReplaceObject`, or other currently unconsumed motion hooks.
- New door interaction, locking, auto-close, or gameplay policy.
- Frontend-owned collision or a second animation cursor.
- Changes to ACE, ACViewer, or the retail client decompile.

## Ground Truth

- Retail fires `EtherealHook` through `CPhysicsObj::set_ethereal`:
  `acclient-eor-source/acclient.c:307367-307389,328623-328626`.
- Retail retries a collision-blocked solidification from transient physics state:
  `acclient-eor-source/acclient.c:310850-310855`.
- Retail independently accepts timestamped server physics state:
  `acclient-eor-source/acclient.c:137255-137279,138243-138274`.
- ACE broadcasts ethereal state on open and after authoritative close completion:
  `ACE/Source/ACE.Server/WorldObjects/Door.cs:119-143,147-207`.
- `MotionSequenceRuntime` already owns fractional frame timing and emits ordered
  `SequenceTick::hooks`: `crates/holtburger-world/src/motion/sequence.rs`.
- Client bulk motion advancement currently discards those hooks:
  `crates/holtburger-world/src/state/motion_resolution.rs::advance_authored_motion_except`.
- The frontend currently refuses the complete door animation when it sees the two `Ethereal`
  hooks: `apps/holtburger-3d/src/lib/game/animation/prepared-motion-playback.ts`.
- Live evidence: motion table `0x09000016` selects animation `0x03000559`; closed holds frame `0`,
  open holds frame `31`, but the frontend skips the clip as `blocking-hooks`.

## North Stars

1. One host cursor decides root motion, hook timing, action completion, and the clip projected to
   presentation.
2. Local hook execution predicts retail physics timing; admitted server state remains authoritative.
3. Collision and visual ownership stay separate: the host executes `Ethereal`, while the renderer
   only samples part transforms.
4. Becoming solid is a collision transaction, not a bit flip.
5. Scope the implementation to the proven `Ethereal` producer before generalizing hook dispatch.

## Phased Implementation

### Phase 0: Prove the collision transition — complete

- Trace `CObjCell::check_collisions` far enough to identify whether retail's solidification check
  includes dynamic peers, static geometry, or both.
- Census table-reachable `Ethereal` hooks, their direction, and their carrier animations.
- Record the resulting query and retry semantics in tests or durable architecture comments.

Acceptance: the production collision query is selected from cited retail behavior rather than from
the current solver's most convenient API.

Progress and decisions:

- `CPhysicsObj::ethereal_check_for_collisions` walks the object's shadow cells and delegates to
  `CObjCell::check_collisions`; that routine considers other unparented objects from each cell's
  dynamic `shadow_object_list`, skips self, and does not query static cell/BSP geometry
  (`acclient-eor-source/acclient.c:307351-307366,333172-333187`).
- The peer/object test is a directionless overlap at their current placements. The implementation
  must therefore query eligible dynamic peers only; using the movement solver, static-world sweep,
  or depenetration would add behavior retail does not perform.
- A blocked `Ethereal(false)` remains ethereal and retries on later physics updates. A successful
  retry clears the pending transition (`acclient-eor-source/acclient.c:307367-307389,310850-310855`).
- The archive census found 86 table-reachable `Ethereal` hooks across 47 carrier animations:
  direction/payload totals are 39 backward/false, 39 forward/true, four forward/false, and four
  forward/true in paired one-way carrier clips. Both payload values occur 43 times. The door clip
  `0x03000559` is the common forward-true/backward-false shape and is selected by motion table
  `0x09000016`. The durable carrier list now comes from `motion_contract_census`.

Concessions and debt: none. The census diagnostic is retained because it guards the content-data
distribution that scopes this implementation.

### Phase 1: Preserve the complete authored-motion tick — complete

- Replace offset-only motion advancement results with one composite tick product carrying the
  existing offset, ordered hooks, and completion facts.
- Thread that product through client bulk advancement, locally driven playback, and the Explorer
  runtime paths that advance the same shared motion machinery.
- Keep cursor advancement singular; consumers must not calculate hook frames independently.

Acceptance: forward and backward hooks fire once in authored order, while existing root-motion and
clip-publication tests remain unchanged in behavior.

Progress and decisions:

- `SequenceTick` was already the deserved composite product, so no parallel tick abstraction was
  introduced. Named-body advancement now returns it intact, and bulk advancement returns
  body-tagged `AuthoredBodyMotionTick` values.
- Client simulation combines the bulk and locally driven products before consuming either root
  offset or hooks. The existing shared sequence tests remain the authority for forward/backward
  departure order and one-shot completion.
- Explorer-only authoring playback was reviewed but not given client network-physics semantics:
  that composition has neither an admitted server physics state nor a door interaction producer.
  Adding a second prediction/reconciliation owner there would violate this fix's source-of-truth
  boundary. If Explorer later gains interactive door motion, it should consume the same hook
  executor through an explicit Explorer adapter.

Concessions and debt: Explorer interactive-door support remains future adapter work, not a hidden
partial implementation in its possession loop.

### Phase 2: Apply host-owned ethereal prediction — complete

- Add a composite runtime physics state that distinguishes the reconciled source state from a
  temporary authored `Ethereal` prediction or pending solidification.
- On `Ethereal(true)`, reconfigure collision immediately and cancel pending solidification.
- On `Ethereal(false)`, run the proven overlap query; become solid when clear or retain ethereal
  state and retry on later fixed ticks when obstructed.
- Reuse prepared body geometry and existing dynamic-body reconfiguration; do not reload content or
  replace pose identity.
- Apply the transition before collision consumers sample the tick's body set.

Acceptance: an unobstructed closing door becomes a blocker at the authored frame, while an occupied
doorway remains passable until a retry succeeds.

Progress and decisions:

- `EntityPhysicsRuntimeState` now owns latest admitted authority, one derived effective state, and
  the mutually exclusive reconciled/predicted/pending transition.
- Host simulation executes the tick's ordered `Ethereal` hooks before dynamic collision consumers.
  Activation reuses the body's prepared geometry; solidification queries current peer spheres
  against the object's target geometry only when their dynamic shadow memberships intersect.
- Pending solidification is retried once on each later world tick before new hook edges are applied.
  Tests cover the overlapping local-player-shaped peer and the later clear retry.

Concessions and debt:

- The rare query scans the current dynamic body population and rejects unrelated shadow
  memberships before narrow phase. A dedicated second index is not justified by 43 authored
  solidification hooks; profile before adding one.
- If async preparation has not installed physical geometry when a close hook fires, semantic state
  still advances and the future body is prepared from that effective state, but overlap cannot be
  observed. This is a host-readiness limitation, not claimed retail behavior.

### Phase 3: Reconcile authoritative `SetState` — complete

- Make admitted create/`SetState` physics replace the reconciled state and retire obsolete local
  prediction/pending state.
- Reconfigure the canonical runtime body and publish one effective physics result to presentation.
- Preserve existing object-instance and object-state timestamp admission; stale packets cannot
  overwrite newer server authority.

Acceptance: prediction covers packet latency, matching server state is idempotent, disagreement is
corrected, and stale state remains rejected.

Progress and decisions:

- An admitted create/`SetState` replaces the authoritative and effective state together and clears
  any prediction or pending solidification.
- Compatible prepared bodies are reconfigured synchronously without replacing pose, geometry, or
  response identity. The existing timestamp admission remains upstream and unchanged.
- Focused tests prove disagreement correction in both the semantic state and canonical dynamic
  collision policy.

Concessions and debt: unsupported whole-state transitions still fall through to the existing client
body-demand coordinator; the synchronous path intentionally handles only compatible state-only
reconfiguration.

### Phase 4: Unblock frontend playback — complete

- Classify `Ethereal` as a host-owned, presentation-safe unimplemented hook.
- Retain animation `0x03000559` in `PreparedMotionPlayback.clips` and ensure the frontend behavior
  dispatcher never executes its collision hooks.
- Keep genuinely visual unimplemented hooks blocking.
- Replace the false zero-blocking-hook census/comment with ownership-aware wording.

Acceptance: closed holds frame `0`, open holds frame `31`, transitions animate in both directions,
and the `blocking-hooks` warning disappears.

Progress and decisions:

- Hook type 6 decodes losslessly as an inert frontend command with
  `blocksActivation: false`; the behavior router continues not to execute it.
- `PreparedMotionPlayback` retains `0x03000559`, while genuinely visual unsupported hooks and
  unbounded root rotation retain their refusal behavior.
- Focused decoder and clip-admission tests cover the ownership boundary and exact door clip.
- Live verification exposed a missing contract fact: both open `0x70134007` and closed
  `0x70134008` publish animation `0x03000559` as the same `[0,31] @ 0` clip. Host
  `PlayingMotionClip` deliberately carries no cursor frame, while frontend `clipEntryFrame` enters
  every zero-rate clip at `lowFrame`. The host can therefore hold frame 31 while a late or replaced
  frontend playback renders frame 0. Clip admission removed `blocking-hooks`, but terminal door
  presentation is still wrong.

Decision and completion:

- The user selected the narrow settled-pose contract, refined to a discriminated
  `Playing`/`Settled { animation_id, frame }` level rather than a magic zero-rate clip window.
- Moving clips remain phase-free and frontend-owned. A zero-rate host cursor projects its exact
  integral frame, so snapshots and late realization distinguish closed frame 0 from open frame 31.
- The frontend installs a one-frame hold clip for an initial or corrective settled pose. When a
  settled pose matches the terminal frame of an already-installed hold transition, it records the
  confirmation and lets local playback finish instead of re-anchoring early and popping.
- The typed cutover replaced `playingClip` with `motion` through the Rust projection, host delivery,
  frontend schema, fixtures, browser harness, and passive live-probe report.
- A real table `0x09000016` diagnostic proved the authored `Off -> On` traversal reaches frame 31
  and the zero-rate `On` cycle retains frame 31. Asset-free unit tests retain the generic cursor
  invariant without depending on runtime archives.

Concessions and debt: none. General moving-cursor synchronization remains intentionally absent;
there is no observed requirement for frame-hot traffic or drift correction.

### Phase 5: Verification and cleanup — complete

- Add lightweight Rust unit tests for hook timing, prediction, obstruction/retry, and `SetState`
  reconciliation.
- Add TypeScript unit tests for clip admission, terminal pose sampling, and frontend non-dispatch.
- Run the relevant Rust tests and clippy plus the app's TypeScript tests, checks, and lint.
- Use the passive live client/UI probe beside the prepared open and closed doors; capture projected
  clips, effective collision participation, terminal part poses, and browser errors.
- Sweep obsolete `blocking-hooks` vocabulary and temporary diagnostics from surviving code.

Acceptance: automated checks pass, current live doors render their exact settled state, and the
real door-table lifecycle plus focused tests prove the unavailable opposite terminal pose.

Progress and decisions:

- Rust world/core/3D-host tests, workspace all-target checking, and clippy with warnings denied pass.
- All 1,821 frontend tests pass; Svelte/TypeScript checks, ESLint, Knip, and host clippy pass.
- The passive local-ACE contract probe completes without errors. The user clarified that both
  prepared doors are currently closed; GUIDs `0x70134007` and `0x70134008` now both honestly
  project `settled` animation `0x03000559` at frame 0 instead of the ambiguous `[0,31] @ 0` level.
- The self-terminating Electron UI probe reaches `in-world`, renders 449 animation frames, reports
  no page error or runtime exception, and records only Vite connection debug messages.
- A live open/closed visual comparison could not be repeated because the current server state no
  longer contains an open member of the prepared pair. The open frame-31 path is instead proven by
  the real door-table cursor diagnostic plus focused host/frontend tests; no server state was
  mutated merely to manufacture a screenshot.

Concessions and debt: the unavailable live-open control is an evidence limitation, not retained
implementation debt.

## Risks and Mitigations

- **Two physics authorities:** keep reconciled state and temporary authored prediction in one type;
  `SetState` performs an explicit reconciliation rather than racing an unrelated field.
- **Double advancement:** carry hooks in the existing tick product; never add a hook-only cursor.
- **Solidifying through an actor:** require a directionless overlap query and retry state matching
  retail's `CheckEthereal` behavior.
- **Over-generalization:** implement only `Ethereal`; census data must justify any later hook family.
- **Frontend regression:** retain refusal tests for hooks that actually alter unsupported visual
  presentation.
- **Completion popping:** treat a matching settled successor as confirmation of local hold
  playback; install it only for initialization or authoritative correction.

## Definition of Done

- Host hook execution and server reconciliation match the cited retail/ACE behavior.
- Presentation plays the door clip without owning collision semantics.
- Obstructed and unobstructed closing are covered by unit tests.
- Current live doors render and collide as their authoritative state declares; both terminal poses
  are covered by the real door-table lifecycle diagnostic and focused tests.
- Rust and TypeScript test, check, lint, and clippy commands pass without warnings.

## Open Questions

None currently.
