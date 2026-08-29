# Holtburger Authored Root Motion and Physics Integration Plan

Status: **Complete (2026-08-20).** Phases 0-7 and Resteer A delivered, with Phase 5's clip swap and
Phase 6b's collision sweep both measured in the browser harness. Surviving debt is recorded below
with its rationale; the `HostCameraRuntime` dissolution that D13 scoped here has moved to
`holtburger-possessed-entity-controller-surface-plan.md`, which is the sequence that earns it.

Scope: a shared `MotionSequence` contract built from the complete raw representation in every
profile, Explorer-led design, and an explicitly deferred solver unification.
Created: 2026-08-17
Reframed: 2026-08-19 — see "Design Journey" for how this plan's direction changed and why
Origin: Phase R3/6 evidence from the Explorer weenie dynamic-runtime plan

## Context and Decision

Holtburger currently represents character locomotion primarily as velocity even when the source
content represents it as ordered animation root transforms. That reduction is adequate for simple
uniform cycles but cannot serve as the canonical contract for retail-compatible animation, physical
response, body-to-body collision, and presentation.

The Explorer weenie dynamic-runtime milestone discovered this gap while attempting to add semantic
stand/walk/turn execution. It shipped physics-driven body motion and setup-default visual
animation, exposed no semantic command capable of selecting authored root motion, and recorded that
boundary explicitly. This plan removes the boundary.

Eleven directional decisions govern the work, argued in "Direction Decisions" below.

1. **Raw motion tables and animations are the canonical source.** The full-profile archive ships
   them and `holtburger-dat` decodes them. The reduced `MotionKinematics` asset is deleted.
2. **`MotionSequence` is the canonical runtime contract.** Both hosts consume one simulation-grade
   projection of that raw content, built in memory. It is never serialized as an asset.
3. **The Explorer leads the design; the TUI adapts.** Motion semantics are designed against the
   client that needs full fidelity.
4. **Solver unification is out of scope,** with a recorded tripwire for when to revisit.
5. **The tick's authored contribution is one exactly-composed rigid offset,** matching retail's own
   composition. No approximation, no fixture, no divergence marker.
6. **Every profile carries the complete representation.** Content tiering is rejected: it cost
   2.3 MB to avoid and bought four open questions, a coverage gap, and profile-dependent behavior.

What this plan does not permit is a second motion model. Solver fidelity may diverge by client;
what a motion table *means* may not.

## Goal

Make one shared resolution of authored motion content, plus each client's own physical solver,
produce a root path and animation cursor that agree — without double-applying root motion or
confusing authored drive with physical momentum.

## Design Journey

Recorded so later readers can tell settled decisions from revisited ones. All findings dated
2026-08-19 unless noted.

### Where the plan started (2026-08-17)

The original draft proposed replacing `MotionKinematics` with "the smallest lossless content-owned
representation," integrating ordered per-boundary authored legs into the solver, and migrating both
clients onto one unified motion *and* solver path, treating the TUI and Explorer as symmetric
consumers of one converged runtime.

### What measurement changed

**Raw content already ships, and it is small.** The full-profile archive carries 436 raw motion
tables (1.84 MB) and 2,066 raw animations (53.55 MB) with working decoders. The proposed new
lossless representation was unnecessary: the DAT format is the lossless representation.

**`MotionKinematics` is a derived index, not a source.** It holds a setup-to-table map rebuildable
from raw `SetupModel` — already present in pruned profiles — and per-cycle velocities rebuildable
from tables plus animations. `dat2hba` already stores every cycle key, not just movement commands.

**Its consumer set is narrow, and the TUI is not in it directly.** Eight consumers, of which exactly
one is semantic. The TUI reaches motion facts only through `WorldState`.

**Almost all motion is authored, not explicit.** Of 18,451 cycles, only 1,064 carry explicit
velocity or omega; 17,387 are movable only by reading animation position frames. Restricted to the
four commands resolution consumes today, 2,200 of 3,256 need position frames. Authored root motion
is how AC content expresses motion; the velocity reduction is the anomaly.

**Presentation dominates animation bytes.** Roughly 99% of reachable animation bytes are part frames
and hooks. The simulation-relevant part — position frames, counts, flags — is under 1 MB.

### Corrections made along the way

Each reversed a conclusion this plan had already written down.

- **"+2.32 MB is cheap" was measured against no denominator.** The micro bundle is ~0.34 MB total.
  Archive profiles map to client capabilities — the TUI ships no textures or meshes — so bundle size
  is a design constraint, not an afterthought.
- **Scoping the TUI's tier to controller-issued commands was wrong.** Clients interpolate motion for
  every entity from server-reported commands. It was also a regression, since `MotionKinematics`
  already stores all cycles.
- **`LocalDriveControl` is not frontend-authored, and not the manual input path.** It is produced by
  `holtburger-core`'s movement system and fires only for autonomous drive and server-controlled
  projection; manual drive returns `None`. It is target-seeking, not locomotion command execution.
  An earlier draft called it frontend movement authority. That was false.
- **The Explorer never implemented `SpatialPhysics`.** `SpatialScene` calls
  `solve_physical_body_tick` directly (`scene.rs:369`, `:909`) alongside the injected
  `Arc<dyn SpatialPhysics>`. An intermediate draft recommended forcing the collision solver behind
  the trait; that recommendation was withdrawn — see D4.
- **A tier without animations is impossible.** It would break 68% of the TUI's own movement cycles.
  Position frames are mandatory at every tier.
- **Animation hooks are not all presentation, and filtered-record sizing assumed they were.** Hooks
  live inside `part_frames`, so "drop part frames" and "drop hooks" are the same wire operation.
  Re-measured with the simulation subset retained: the cost is under 2 KB at every tier, so sizing
  was never the issue.
- **Three of the six simulation hook types are unreachable through motion tables.** `Scale` and
  `AnimationDone` occur zero times anywhere in the archive; `SetOmega` occurs 8 times but only in
  animations no motion table references, so the contract correctly never sees it. An intermediate
  draft said `SetOmega` occurs zero times, which was true only of referenced content.
- **The no-part-frames rule has a proven exception.** An earlier draft asserted that collision
  geometry never comes from animated part poses. That holds for sphere and cylsphere objects but not
  for physics-BSP parts, which the client collides per part against poses `UpdateParts` writes from
  the current animation frame. The first draft of this finding cited ACE, which is the wrong
  authority for client behavior; it was re-verified in `acclient.c` and holds. Holtburger already
  diverges by placing BSP parts from the setup transform; that divergence is now recorded rather than
  assumed away.
- **Hook preservation was a tier property, not a contract property.** `Attack` lives in modifiers and
  links — 25 of 1,047 are cycle-reachable — and every proposed tier dropped modifiers and links, so a
  draft promise to "preserve `Attack` and `Ethereal`" was true of the contract and false of every
  small profile. Superseded by D6: with tiering gone, the promise holds unqualified. This finding is
  part of why tiering was abandoned.

### Questions closed by measurement

- **The flattening fixture was deleted rather than built.** Several drafts treated per-tick
  flattening as an approximation of ordered per-boundary legs, and budgeted a fixture, a tolerance,
  and a `RETAIL DIVERGENCE` marker for rotating sequences. Tracing `Frame::combine` showed retail
  composes ordered frames into a single rigid offset before applying it, so there is no error to
  bound. The residual defect was writing `AuthoredDrive` as a velocity pair; it is a rigid transform.
  See D5.
- **An `Interpolated` basis variant was proposed and withdrawn.** A design tour proposed a third
  `SolveProjectionBasis` variant for server interpolation. Tracing `MoveOrTeleport` confirmed
  interpolation is genuinely the primary correction path — and that the Explorer, having no server,
  can never produce it. The variant would have been a field with no consumer. Recorded as client-mode
  debt instead.
- **Content tiering was deleted outright.** Several drafts sized which cycles a small profile should
  carry. Measuring links ended it: all 42,537 carry transition animations, none carry explicit
  kinematics, and 1,174 animations are reachable only through them, so every tier was deleting
  authored content rather than trimming fat. The complete representation is 2.45 MB — roughly +2.3 MB
  on the TUI bundle and nothing on the 3D client — which bought back three open questions, the tier
  metadata mechanism, the `Attack` coverage gap, and all profile-dependent resolution. See D6.

- **The animated physics-BSP divergence is 7 catalog templates.** An intermediate draft framed it as
  a potentially broad gap in the no-part-frames rule. Measured: 530 setups carry a BSP part, 506 have
  no animation source, 255 are single-part and therefore root-equivalent, and only 10 are multi-part
  with parts that move. Of the 28 templates using those ten, 21 ignore collisions outright, leaving 7
  solid templates on 4 setups. It ships as a marked divergence, not a contract change.

### The reversal that rescoped the ending (2026-08-20)

This plan carried "route the Explorer camera walk controller through the shared command surface" from
its first draft, on the argument that the camera was the closest thing to a client-mode player the
Explorer had. Looking at the camera ended it: it is a grounded sphere pair with no setup, no motion
table, and no rendered parts, so it has no articulated animation to play and no visual whose
agreement with placement could be checked. All it can consume from a motion table is a scalar.

The replacement — possess any spawned entity — is better on the axis that matters. It exercises the
whole loop at once and makes the result *visible*, and because every entity models a different
command set, it exercises far more of selection than one nominated character would. See D7.

Two things fell out of the investigation that are worth keeping separately: retail's hardcoded
locomotion speeds are jump-launch constants rather than evidence against authored root motion, and
the local frame's axes were confirmed from a second, independent place in the decompile. Both are
recorded under D7 and in the Phase 3 findings.

### Two concessions that made the ending smaller (2026-08-20)

Reviewing Phase 5 before building its frontend half retired complexity rather than adding it.

The **authoritative cursor** went. It promised to keep the frontend's frame number synchronised with
the host's, but host and frontend advance at the same rate so a phase offset never accumulates, clip
changes re-anchor it anyway, and the plan already tolerated a larger error at clip boundaries than
the cursor removed. See D8, which also deletes `completed_clips` for want of a consumer.

The **asset question turned out to be about the host**, not the frontend. Warming a whole motion
table at spawn is affordable once sharing is keyed per animation rather than per table — tables
overlap 9.2x — but the host was decoding every animation's part frames at startup only to discard
them, then re-decoding the same records one at a time on request. See D9 and the Phase 5 findings.

### The reframe that settled it

Two insights closed the design.

**The solver split is acceptable; the motion split is not.** The Explorer is explorer-only: no
session, no server projection, no remote entities, no local prediction. It never needed
`SpatialPhysics` because its requirements barely intersected the TUI's, so a shared trait today
would be an abstraction with one real consumer — and the contract it would be made of is TUI-shaped.
Solver fidelity varies by client, which is what injection is for and what deferral is safe for. What
a motion table means varies by nothing. A solver split is recoverable by extracting a trait from two
working implementations; a motion-semantics split is two reverse-engineerings of the same DAT that
drift in behavior.

**The host wants a projection, not the raw content.** What a host simulation needs is command→motion
mapping, animation identity with ranges and rates, root transforms, links and cycles, explicit
velocity/omega, and the simulation-relevant hooks. Making that projection the runtime contract
enforces the simulation/presentation boundary structurally, and retires an earlier proposal to ship
`Animation` records with `num_parts = 0`, which would have meant one file ID carrying different
content per profile.

The boundary has one exception, proven in the retail client rather than inferred from the server.
Sphere and cylsphere objects collide from setup geometry placed by the object's own position and
scale, untouched by animation. Objects whose parts carry a `physics_bsp` collide **per part**:
`CPartArray::FindObjCollisions` walks `parts[i]` and `CPhysicsPart::find_obj_collisions` tests
against that part's own `pos` (`acclient.c:313270-313287`, `:303185-303200`). Those poses are
animation-driven — `CPartArray::UpdateParts` combines the current animframe's per-part frame into
`parts[i]->pos.frame` (`acclient.c:314107-314132`), reached whenever the object's world frame is set
via `CPhysicsObj::set_frame` (`acclient.c:309528-309560`). ACE matches because its physics is a port
of this code, not because the server needs something the client does not.

Holtburger already diverges: `PreparedEntityBspPart` places each shape from the setup's authored
transform and never animates it. The divergence is recorded rather than closed — see "Known Debt" —
and it is the one case where the contract's no-part-frames rule is a simplification rather than a
fact.

The consequence differs by role. On a server the pose is authoritative and a mismatch changes what
actually happened. On a client it affects local prediction and feel — a door that blocks or admits
passage before the server corrects it — so the cost is transient desync rather than wrong world
state.

The population is measured and small enough to enumerate. Of 530 setups carrying a physics-BSP part,
255 are single-part, where the part pose *is* the root pose and the accepted path already carries it;
506 have no animation source at all. Only 24 are animated, 13 of those are multi-part, and **10 have
parts that actually move relative to each other**: setups `0x02000F30`, `0x02001091`, `0x02001215`,
`0x0200161D`, `0x020018F7`, `0x02001905`, `0x02001940`, `0x02001A97`, `0x02001B92`, `0x02001BF2`.

Solidity narrows it further. A physics BSP in the parts only produces per-part collision if some
object using the setup is actually collidable: `HasPhysicsBSP` is derived from the parts and follows
automatically, but `Ethereal` and `IgnoreCollisions` short-circuit collision before the BSP path is
reached. Across the catalog, 28 templates use those ten setups — **21 ignore collisions, none are
ethereal-without-ignoring, and 7 are solid**:

| WCID | Setup | Parts |
| --- | --- | --- |
| 27303 | `0x02001091` | 3 |
| 33894 | `0x0200161D` | 19 |
| 44063 | `0x02001A97` | 3 |
| 52250 | `0x02001091` | 3 |
| 72157 | `0x02001BF2` | 9 |
| 87618 | `0x0200161D` | 19 |
| 87625 | `0x0200161D` | 19 |

So the divergence is reachable by 7 catalog templates across 4 setups. Six of the seven carry base
mask `0x408` — gravity plus report-collisions — so they are genuine physical objects rather than
decor. Solidity is derived the way ACE derives it: a base-mask bit applies only when the matching
property-bool override is null (`WorldObject_Networking.cs:523-570`).

Four setups do not justify part frames in the contract. The rule stands, the exception becomes a
`RETAIL DIVERGENCE` marker carrying this census, and the single-part majority closes on its own once
Phase 3 applies root motion.

## Current Model

### Source reduction

`apps/holtburger-tools/src/dat2hba.rs` writes the reduced `MotionKinematics` asset. For walk/run
cycles lacking explicit motion-data velocity, `derive_animation_forward_speed` sums every animation
position-frame translation, reduces it to a magnitude, divides by frame count, multiplies by the
first animation's framerate, and stores one forward vector. It drops animation identity and frame
range, per-frame translation and rotation, transform order, link and cycle sequencing, nonuniform
timing and negative-rate traversal, and the distinction between authored drive and retained physical
velocity.

`crates/holtburger-world/src/state/motion_resolution.rs` resolves semantic motion snapshots to
`desired_local_velocity`/`desired_local_omega`, consumed through `SolveProjectionBasis`.

### MotionKinematics consumers

The complete set the deletion must cut over:

- `apps/holtburger-tools/src/dat2hba.rs` — derivation and synthetic-asset write.
- `apps/holtburger-tools/src/weenie_catalog_survey.rs` — census consumption.
- `crates/holtburger-dat/src/file_type/motion_kinematics.rs` — type and codec.
- `crates/holtburger-content/src/repository.rs` — repository read.
- `crates/holtburger-world/src/bootstrap.rs` — bootstrap slot.
- `crates/holtburger-world/src/state/types.rs` — `WorldState.motion_kinematics` and its setter.
- `crates/holtburger-world/src/state/motion_resolution.rs` — the sole semantic consumer.
- `crates/holtburger-core/src/client/builder.rs` — required asset load at client construction.

### Two solver stacks

`SpatialPhysics` is an injected trait whose `BasicSpatialPhysics` implementation performs kinematic
advancement and honors `SpatialSolveRequest::local_drive`. It is deliberately hacky and TUI-only.

The Explorer path does not implement it. `SpatialScene` calls `solve_physical_body_tick` directly,
producing collision-corrected `PhysicalBodyTickCommit` values with `PlacedMotionPath`. That path is
collision-aware and is where real fidelity lives.

Both are legitimate and unreconciled. See D4.

### Motion contract seams

`SolveProjectionBasis` already distinguishes physical momentum from command drive:

```rust
enum SolveProjectionBasis {
    Velocity       { velocity, omega },
    GroundedMotion { desired_local_velocity, desired_local_omega },
}
```

The split is the right shape; the payload is the problem. `GroundedMotion` is velocity-shaped, so
authored root motion cannot reach a solver through it.

`SpatialSolveRequest::local_drive` is a sibling field carrying pre-integrated world displacement for
autonomous and server-projected movement, so two bodies in one request describe intent in
incompatible shapes. Recorded as known debt; not this plan's scope.

### Presentation boundary

The frontend animation system samples articulated part frames. Animation position frames do not
write the dynamic entity root; the placement system applies solver-produced placement. Root motion
therefore disappears unless the host reduces it to velocity.

## Evidence

### Retail composition

Retail advances one `CSequence` by elapsed quantum, composing every departed animation position
frame into one ordered local offset plus the matching motion-data velocity/omega contribution
(`acclient.c:326355-326383`, `:327127-327216`). Finite links carry proportional leftover time into
the next clip (`acclient.c:326952-327033`). `CPhysicsObj::UpdatePositionInternal` admits sequence
translation while on walkable support, lets physical response contribute, and combines the result
with the current world frame once (`acclient.c:308262-308298`). Airborne movement suppresses
sequence translation and uses physical velocity while retaining sequence rotation.

### Canonical content census

The offline `survey-weenie-catalog` census measured 436 motion tables, 62,210 motion-data records,
79,162 animation entries, and 1,938 distinct referenced animations; 353 animations with position
frames, 341 with non-identity translation, 20 with non-identity rotation; selected root transforms
in 205 motion tables (translation in 203, rotation in 48); 7,903 catalog templates reaching position
frames (7,901 translation, 1,497 rotation); 4,854 selected root-transform entries able to cross more
than one authored boundary per 30 Hz tick at stored rate, maximum eight; WCID 46320 Security Station
combining physics-BSP target geometry with table-reachable root translation; and two setup-default
animations with zero root translation but non-identity root rotation, one catalog-reachable through
WCID 36449 Bats.

The 3× stress case reaches at most 24 authored boundaries per tick. Ordered legs are therefore
cheap — and Phase 0 later showed retail composes them into a single rigid offset anyway, so the
per-boundary bound is a decode-cost figure rather than a solver-input one.

### Cycle kinematics distribution

Measured by `crates/holtburger-debug-harness/src/bin/motion_content_sizing.rs`:

| Cycles | Count |
| --- | --- |
| All cycles across 436 tables | 18,451 |
| — with explicit velocity or omega | 1,064 |
| — movable only via animation position frames | 17,387 |
| — with neither anims nor kinematics | 0 |
| Restricted to the four commands resolution consumes today | 3,256 |
| — with explicit velocity or omega | 1,056 |
| — movable only via position frames | 2,200 |

Two consequences. Animations are mandatory content, not an optimization: a build carrying tables but
no animations would break 68% of the TUI's own movement cycles. And 1,056 of the 1,064 explicit-kinematics cycles in the entire archive
are the four movement commands, so explicit velocity/omega is almost exclusively a movement-command
feature. No cycle has neither anims nor kinematics, so absence is never ambiguous.

### Animation hooks

Hooks are stored inside `part_frames`, so a record that drops part frames drops hooks too. Across the
764 cycle-reachable animations there are 113 simulation-relevant hooks against 1,957 presentation
hooks, in 73 animations. Everything not listed below — sound, sound-table, particles, translucency,
luminosity, diffuse, texture velocity, PES calls, lights, no-draw, default scripts — is presentation.

Simulation-relevant hook types, verified against ACE, which walks `PartFrames[].Hooks` server-side:

| Type | Hook | In referenced animations | Unreferenced only |
| --- | --- | --- | --- |
| 3 | `Attack` (AttackCone) | 1,047 | 6 |
| 6 | `Ethereal` | 86 | 0 |
| 5 | `ReplaceObject` | 2 | 0 |
| 22 | `SetOmega` | 0 | 8 |
| 12 | `Scale` | 0 | 0 |
| 4 | `AnimationDone` | 0 | 0 |

`Scale` and `AnimationDone` never occur anywhere in the archive, and `SetOmega` occurs only in
animations no motion table references. `Scale` had been assumed to feed the composition-order
question; it has no content behind it, so the scale term there comes from object scale generally,
not from a scale hook. `SetOmega` is real but unreachable through motion tables, so the contract
correctly never sees it — a future consumer would reach it through setup defaults or physics scripts.
The contract models the three types its source can reach and does not carry fields nothing produces.

`Attack` concentrates in modifiers and links rather than cycles: only 25 of 1,047 are cycle-reachable,
because attacks are motion modifiers, not looping cycles. That is why the contract carries the whole
table rather than a cycle subset — see D6.

Retaining simulation hooks costs under 2 KB across the entire referenced set.

### Modifiers and links

A motion table holds three maps of the same `MotionData` type. Cycles are keyed by
`(stance, command)` and hold the looping motion. Modifiers layer additively. **Links are
transitions**, keyed `[(style, from-state)][to-motion)`, and in reverse playback the two keys swap
(`ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs:395-425`).

| | Count |
| --- | --- |
| Modifier records | 1,222 |
| Link records | 42,537 |
| — carrying transition animations | 42,537 |
| — carrying explicit velocity or omega | 0 |
| Distinct animations reachable only through links | 1,174 |

Every link is an animation reference and none carries explicit kinematics, so all transition motion
is authored in position frames. Dropping links would not perturb timing — it would delete the
transition clips and the root displacement inside them, and orphan 1,174 animations reachable no
other way. This is the measurement that ended tiering; see D6.

### Content sizing

Superseded in part by "Phase 1 findings: what the emitted bundle actually costs". The figures below
are **uncompressed source bytes**; the emitted archive is zstd-compressed and costs far less.

They are also **not** the host's memory footprint, which an earlier reading of this section conflated
them with. Measured 2026-08-20 over the cycle-reachable slice of the projected contract: 18,451
motion sequences (1.13 MB of headers), 18,457 clip entries (0.56 MB), 5,996 root transforms
(0.16 MB), and 113 simulation hooks — 1.85 MB before hash-map overhead. Modifiers and links hold
43,759 further motion-data records against 18,451 cycles, so the whole-catalog figure is several
times that.

The shape matters more than the total: the *motion data* is tiny, and what costs is the **structure**
— one hash-map entry and a clip vector per motion-data record. Startup is where the real cost is; see
"Phase 5 findings: the host decodes what it throws away".

| Motion content | Size |
| --- | --- |
| All 436 tables, complete | 1.84 MB |
| All 1,938 referenced animations, filtered to position frames, counts, and simulation hooks | 0.61 MB |
| **Complete representation** | **2.45 MB** |
| The same animations unfiltered | 52.10 MB |
| `MotionKinematics` today | 0.13 MB |

Filtering drops part frames and presentation hooks, which are roughly 99% of animation bytes and are
read only by the frontend. Zero referenced animations are absent from the archive.

The micro bundle is roughly 0.34 MB today and becomes roughly 2.66 MB. The 3D client pays nothing:
it already ships the full profile.

These figures are exact, not estimates. The byte model was validated by predicting each record's
complete wire size from its decoded contents and comparing against the archive's own record size:
**436 of 436 motion tables and 609 of 609 animations match exactly** (animations whose hook payloads
this census models). A model that reproduces every real record byte-for-byte is arithmetic on the
wire format, not an approximation of it, so the filtered figures derived from it need no separate
emission to confirm.

Building the contract by decoding all 436 tables and all 1,938 animations takes 400 ms in a release
build with a warm cache. That measurement decodes animations *unfiltered*, so it is an upper bound —
the TUI reading 0.61 MB of filtered animation data is a small fraction of it, while the 3D client on
the full profile is close to it. Eager table indexing with lazy per-table animation resolution is the
obvious mitigation if 400 ms proves unwelcome at startup.

### Phase 0 findings: the retail update order

Traced 2026-08-19 from the client decompile. `CPhysicsObj::UpdatePositionInternal`
(`acclient.c:308262-308298`) is the whole composition, and the caller at `:310862-310905` supplies
collision. In order:

1. `offset := identity`.
2. `CPartArray::Update` → `CSequence::update` → `update_internal` (`:327102-327215`) advances the
   cursor by `framerate * quantum` and, **for each departed frame in order**, composes that frame's
   position frame onto the offset (`Frame::combine`) and then calls `apply_physics`.
3. `CSequence::apply_physics` (`:326355-326382`) adds `motion_data.velocity * dt` directly to the
   offset origin and applies `motion_data.omega * dt` with `Frame::rotate` — a **local** rotation.
   `CSequence::velocity`/`omega` are a running sum over active clips, maintained by
   `subtract_physics` (`:326239-326247`) as clips leave.
4. **Support gate**, evaluated once on the accumulated offset: if `transient_state & 2` — confirmed
   as on-walkable by `prev_on_walkable` at `:310648` — the offset origin is multiplied by the
   object's scale; otherwise it is multiplied by **zero**. Rotation is untouched either way.
5. `PositionManager::adjust_offset` may further modify the offset.
6. `Frame::combine(o_newFrame, m_position.frame, offset)` — the offset is applied in local space,
   exactly once.
7. `CPhysicsObj::UpdatePhysicsInternal` (`:306094-306172`) then works on the **already-composed world
   frame**: it clamps speed to 50 m/s, applies friction, zeroes velocity below 0.25, adds
   `v*dt + ½a*dt²` to the world origin, integrates `v += a*dt`, and applies physical omega with
   `Frame::grotate` — a **global** rotation.
8. The caller runs `CPhysicsObj::transition` against the proposed frame, then sets
   `cached_velocity = (accepted_position - previous_position) / quantum`. On a failed transition the
   origin reverts to the previous position while the new rotation is kept.

This settles four questions.

**Support gating is once per update, and gates translation only** (step 4). A support change during
the physics step does not retroactively re-gate this tick's sequence translation, and authored
rotation survives an airborne tick. Object scale multiplies authored translation and never rotation.

**Rotation composition is two different operations**, verified rather than inferred from the names:
`Frame::grotate` (`:342628-342659`) builds a quaternion from the axis-angle vector and
left-multiplies the frame's rotation, while `Frame::rotate` (`:137544-137557`) first maps its axis
from local to global through the frame's own matrix and then delegates to `grotate`. So sequence
rotation turns about a local axis and physical omega about a global one: authored and motion-data omega rotate the
offset locally, physical omega rotates the world frame globally. Any implementation that treats them
as one accumulator is wrong.

**The cursor advances by full quantum regardless of collision** (steps 2 and 8). Collision clips the
displacement, never sequence time, and blocked displacement is never retried — the next tick resumes
from the accepted position with the cursor already moved. `cached_velocity` being accepted
displacement over dt is retail reducing its own accepted path to a velocity for the next tick's
physics — precedent for a solver doing the same, though the authored input itself stays rigid (D5).

**Sequence rotation is not angular momentum.** `CSequence::omega` and `CPhysicsObj::m_omegaVector` are
separate; interrupting a rotating clip subtracts its contribution from the sequence accumulator and
transfers nothing to physical state.

### Phase 0 findings: link boundaries and leftover time

`update_internal` (`:327134-327149`, `:327209-327213`) computes, when the step crosses the clip's high
frame, `leftover = (frame_number - high_frame - 1) / framerate`, clamps the animation to its high
frame, emits an `AnimationDone` hook when the list head is not the cyclic head, calls
`advance_to_next_animation` (`:326940-327033`), and re-enters the loop with `quantum = leftover`.

So retail **does** carry proportional leftover time across a clip boundary into the next clip. An
earlier draft asserted this citing only `:326952-327033`, then a later draft retracted it as
unproven because that region only performs the clip switch. Both were imprecise: the switch happens
there, the leftover is computed and re-fed in `update_internal`, and the claim is correct.

The reverse-rate path is symmetric: it walks frames downward, uses `Frame::subtract1` instead of
`combine`, and takes the link keyed the opposite way
(`ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs:395-425`).

**Hooks are frame-indexed, not phase-carrying.** `execute_hooks(part_frame, direction)` fires once
per departed frame with `+1` forward and `-1` reverse, so the contract needs a frame index and a
direction, not a phase or duration. `CPhysicsObj::process_hooks` runs once per update after position
is composed.

### Phase 0 findings: server correction and teleport

Two mechanisms exist and they behave completely differently.

**Hard correction snaps and leaves the sequence alone.** `CPhysicsObj::SetPosition`
(`acclient.c:311339-311381`) → `SetPositionInternal(sps, transit)` (`:311316-311336`) →
`SetPositionInternal(p, sps, transit)` (`:311096-311141`) commits through the same
`SetPositionInternal(transit)` (`:310624-310758`) the normal tick uses.

That commit path resolves the cell, calls `set_frame`, records the contact plane, recomputes the
contact, walkable, water, and sliding bits of `transient_state`, calls `calc_acceleration`, and runs
`handle_all_collisions`. Its only motion-system interaction is `MovementManager::LeaveGround` when
walkable support is lost.

**Nothing on the path touches the sequence.** The cursor, `frame_number`, and the animation list are
untouched by a correction, so:

- the cursor keeps advancing from where it was, and does not reset or replay;
- pending links survive, because they live in the anim list the correction never reads;
- root displacement missed because the correction moved the body is discarded, never retried — the
  next tick composes a fresh offset from the unchanged cursor and applies it to the corrected
  position.

`set_frame` reaches `CPartArray::UpdateParts`, which re-poses parts from the *current* animation
frame, so a corrected object keeps its animation pose rather than snapping to a rest pose.

This matches the model the plan already assumed: authored drive is per-tick and never persistent, so
there is no missed-displacement debt for a correction to reconcile.

**Interpolated correction overrides the authored offset entirely.** It is chosen by
`CPhysicsObj::MoveOrTeleport` (`:311475-311523`), which the network position handler (`:139043`)
calls for each updated object, and by a parallel local-player branch (`:139029-139041`). The ladder
is: a newer teleport timestamp or a missing cell takes a hard `SetPosition`; **no contact means the
update is ignored entirely**; beyond 96 m from the player it stops interpolating and snaps; otherwise
it interpolates with `keep_heading` set from `IsMovingTo`.

`PositionManager::InterpolateTo` (`:371314-371320`) installs an `InterpolationManager`, whose
`adjust_offset` (`:372004-372094`) runs at step 5 of the composition. Despite the name it does not
adjust: on its success path it ends with `Frame::operator=(offset, &result)` (`:372089`) — a **full
assignment** that discards whatever the sequence composed for that tick and replaces it with a
capped step toward the queued target.

The details matter for the contract:

- It runs only when the object has contact (`transient_state & 1`); airborne objects never
  interpolate.
- `result = target - m_position`, magnitude-capped to `2 × max_speed × quantum` from `CMotionInterp`,
  defaulting to `7.5` when no motion interpolator exists. With `keep_heading`, the heading term is
  zeroed; otherwise the assignment carries the rotation delta too.
- Below `0.05` distance the node completes and the offset is left untouched.
- A watchdog abandons a node that achieves under 30% of expected progress over five frames.

So server interpolation and authored drive do **not** compose. An earlier draft of this question
assumed they summed into one offset; they do not — interpolation is a distinct authority that
preempts authored motion for the ticks it is active. The contract must express "this tick's offset is
authoritative interpolation" as an alternative to authored drive, not as an addend.

**A second modifier damps the offset on the same path.** Every server position update also calls
`ConstrainTo`, and `ConstraintManager::adjust_offset` (`:372268-372296`) runs after interpolation in
`PositionManager::adjust_offset` (`:371277-371292`). It is a dead-reckoning leash: it accumulates
`|offset.origin|` since the last confirmed position, scales the offset origin by
`(max - accumulated) / (max - start)` once drift passes the start distance, and **zeroes translation
entirely** past the max distance. Rotation is untouched, consistent with every other gate. So an
entity that has drifted too far from its last server-confirmed position stops translating while
continuing to rotate and animate.

An earlier draft dismissed `ConstraintManager` as MoveTo behavior. That was wrong: `ConstrainTo`
fires on every server position update. `StickyManager`, the third contributor, is stick-to-object
behavior and does remain out of scope.

Step 5 is therefore three ordered stages — interpolation may **assign**, sticky may act, constraint
**scales** — and a constraint damps an interpolation offset just as it damps an authored one.

**Neither reaches this plan's scope.** The Explorer has no server, so it produces neither an
interpolation nor a constraint offset. Adding a basis variant for them now would ship a field with no
producer. Both are recorded as client-mode obligations in "Known Debt" so that work inherits a traced
specification rather than rediscovering it.

### Standard character walk

Motion table `0x09000001`, default style `0x8000003D`, resolves walk-forward `0x45000005` to
animation `0x03000003`. The motion-data record has neither velocity nor omega. The animation has 36
position frames, each translating approximately `0.0388889 m` along local Y, for approximately
`1.4 m` per cycle at `66.9 fps`, with no root rotation. The reduced asset turns that into
approximately `2.60 m/s`.

This explains why the current model appears correct for this clip. It does not generalize to nonuniform, rotating, linked, reversed, or
collision-sensitive root motion.

## First-Principles Model

1. A body snapshot describes state at one instant; it is not the path traveled during an interval.
2. Authored sequence drive, controller intent, retained momentum, acceleration, impulses, and server
   correction are distinct inputs. None independently owns world placement.
3. A physical solver is the sole authority that turns requested motion into an accepted world path
   and next physical state. Which solver may vary by client; that authority may not move.
4. Authored root motion is an ordered local rigid-transform program. It is not persistent momentum,
   and blocked displacement is not retried. Its per-tick form is one exactly-composed rigid offset,
   which preserves ordering rather than approximating it.
5. Physical velocity is persistent state. Forces and collision response change it across ticks.
6. Support and contact state decide which contributions apply, inside the solver step where support
   can change.
7. The semantic sequence cursor advances by effective time even when collision clips root movement.
8. Simulation reads root transforms and simulation hooks; presentation reads part frames and
   presentation hooks. One projection owns the first; raw animations own the second.
9. The frontend receives the cursor, never the root track. Applying root frames in presentation
   would disagree with collision, because the solver may have clipped that displacement.
10. Inputs, commands, motions, and body adjustments are distinct layers with one shared vocabulary.
11. There is exactly one canonical source — parsed raw motion tables and animations — and exactly one
    canonical runtime contract projected from it. Every derived value is computed at a named layer,
    never stored as a competing authority.

## Direction Decisions

### D1. Raw content is canonical; `MotionKinematics` is deleted

The lossless representation already ships in the full profile with working decoders. A baked
intermediate would add a codec, a derivation, and a second place for motion facts to drift.
`MotionKinematics` is a derived index that became a bootstrap-required authority and then became the
reason small profiles stopped shipping real content.

Both clients cut over together. Running one on raw and the other on the reduced asset would be the
two-motion-model outcome this plan exists to prevent, even temporarily.

### D2. `MotionSequence` is the canonical runtime contract, built in memory

Both hosts consume one simulation-grade projection of raw content. The projection exists because the
host's appetite is a strict subset of what an animation carries, and expressing that subset as a
type enforces the simulation/presentation boundary structurally rather than by convention.

| Type | Carries |
| --- | --- |
| `MotionSequenceTable` | one motion table's projection: styles, cycles, modifiers, links |
| `MotionSequence` | one stance and command: ordered animation refs with frame ranges and rates, plus its tracks |
| `RootMotionTrack` | ordered per-frame rigid transforms — position and orientation |
| `MotionHookTrack` | timed simulation-relevant hooks |
| `AuthoredDrive` | the displacement and rotation one tick consumes |

`MotionSequence` deliberately matches retail's `CSequence` and ACE's `Sequence`, so anyone
cross-reading the references lands in the same concept. The name `MotionKinematics` is not reused:
in this codebase it means "reduced to a mean velocity," and a name that survives a semantic
inversion invites the question of whether the reduction came back.

**The contract is never serialized.** Building it in memory from ~0.75 MB of raw content costs
nothing measurable at startup, and committing to a wire format would mean a codec, a version, and
migration obligations for an unmeasured benefit. If a baked form is ever justified, the baked
producer must be the same code as the runtime producer, run at build time — a cache with one
implementation, not a second producer that can drift.

**Hook policy.** `MotionHookTrack` carries the simulation-relevant hooks of whatever animations the
contract was built from, so a future combat or collision-state system needs no re-plumbing.
Presentation hooks stay with the raw animations the frontend already reads.

One limit is deliberate. `Scale`, `SetOmega`, and `AnimationDone` occur zero times in referenced
content, so the track models the three types that exist — `Attack`, `Ethereal`, `ReplaceObject` — and
treats the rest as unreachable rather than carrying fields nothing produces.

Preservation is otherwise unqualified. Under D6 every profile carries every table, so every `Attack`
and `Ethereal` hook is reachable from every build. An earlier draft had to qualify this because
content tiering dropped the modifiers and links where `Attack` lives; that qualification is gone with
the tiering.

### D3. The Explorer leads the design; the TUI adapts

The TUI's motion path is the compromised one — velocity reduction as canonical, `local_drive`
smuggled past the basis. Letting it define the shared contract is how `holtburger-core` acquired its
current shape. The Explorer needs full fidelity, so it is the honest design target, consistent with
the repository direction to judge shared APIs against the future 3D client rather than today's TUI.

Under D6 both clients now carry identical motion content, so this decision governs design authority
rather than packaging: where the TUI's existing shape and the Explorer's needs disagree, the
Explorer's win.

### D4. Solver unification is out of scope

The Explorer never implemented `SpatialPhysics` because it never had a client: no session, no server
projection, no remote entities, no local prediction. Its requirements barely intersect the TUI's, so
a shared trait today would be an abstraction with one real consumer.

Worse, the contract it would be made of is TUI-shaped. Forcing the collision solver behind
`SpatialPhysics` now would contort it to fit a velocity-only basis and a `local_drive` sibling field,
making those assumptions load-bearing exactly when they are hardest to remove. Two honest
implementations are better input for a later trait extraction than one imagined second consumer.

**Tripwire.** Revisit when either occurs: the Explorer needs a server-driven remote entity, or client
mode begins and needs collision. At that point extract the trait from the two working
implementations. Until then `LocalDriveControl` and the `SpatialSolveRequest` shape stay as they are.

### D5. The tick's authored contribution is one exactly-composed rigid offset

Earlier drafts framed this as a choice between ordered per-boundary legs and a per-tick flattened
approximation, and budgeted a fixture, a tolerance, and a `RETAIL DIVERGENCE` marker to bound the
error. Phase 0 showed the dichotomy is false: retail is neither.

`CSequence::update_internal` composes each departed position frame onto an accumulating offset with
`Frame::combine`, and `apply_physics` folds each clip's motion-data velocity and omega into that same
offset. `Frame::combine` is ordinary rigid composition — `origin = f1.origin + f1.rot × f2.origin`,
`rot = f1.rot × f2.rot` (`acclient.c:307767-307793`) — so the ordered composition **collapses into
one rigid `Frame` before it reaches the world frame or collision**, and is applied exactly once by
`Frame::combine(o_newFrame, m_position.frame, offset)`.

So the authored contribution for a tick is one rigid transform: a translation and a rotation.
Composing it is exact, not approximate. `AuthoredDrive` is therefore a rigid transform, **not** a
velocity/omega pair — the velocity shape was the actual defect in the earlier draft, discarding the
rigid structure for no benefit.

Rotation deserves saying plainly, because two sources land in the same place. Position-frame rotation
composes locally per departed frame; motion-data omega is applied as `Frame::rotate(offset, ω·dt)`,
a rotation composed *into* the offset. Neither survives as an angular velocity. Authored rotation is
rotation in a rigid transform, consistent with `CSequence::omega` being a per-tick accumulator over
active clips rather than momentum.

Physical omega is the opposite case: applied with `Frame::grotate` on the already-composed world
frame, in world space, from persistent state. Local versus global rotation is a real distinction the
implementation must keep.

The one approximation in the tick is retail's own: `transition` collides a straight sphere path from
the old origin to the new one, so a rotating walk's curved path is not swept exactly. Matching that
is correctness, not divergence.

### D6. Every profile carries the complete representation; tiering is rejected

Earlier drafts of this plan tiered motion content by archive profile, so a small build would carry
only the cycles a velocity-grade client could act on. Measurement killed it.

The complete representation is 2.45 MB: all 436 tables plus all 1,938 referenced animations filtered
to position frames, counts, and simulation hooks. That takes the micro bundle from roughly 0.34 MB to
2.66 MB and costs the 3D client nothing, since it already ships the full profile. Every tier
considered saved between 1.7 MB and 2.2 MB against that.

What the tiering was costing was out of proportion to the saving:

- Links are transition *clips*, not timing metadata. All 42,537 carry animations, none carry explicit
  kinematics, and 1,174 animations are reachable no other way. Every tier dropped all of them.
- `Attack` hooks live in modifiers and links, so every tier dropped roughly 98% of attack timing while
  the plan claimed to preserve them.
- A tier boundary needed to be *declared* in archive metadata, because a resolver cannot otherwise
  distinguish "this tier legitimately omits this" from "this archive is corrupt."
- Two open questions existed only to service the tier choice, and a third existed to decide whether
  shipping unreachable attack timing was acceptable.
- The same WCID could resolve differently per profile, which is the ambient-capability failure this
  plan exists to prevent.

Carrying everything deletes all of it. Absence always means corrupt, which is the loud simple case.
`dat2hba` filters animations to simulation facts and keeps every table whole — no command sets, no
reachability walk, no per-profile manifests. Both clients resolve identical motion facts.

Confirmed 2026-08-19: nothing depends on TUI bundle size, so ~2.66 MB is accepted. If a packaging,
download, or embedded constraint ever appears, tiering returns as a packaging concern — and this
section records what it would cost to reintroduce.

### D7. The consumer is a possessed entity, not the camera walk controller

**Ratified 2026-08-20.** Raised by the tech lead; the reasoning is recorded because it reverses a
deliverable this plan carried from the start.

Phase 6 as written routed the Explorer camera walk controller through the shared command surface, on
the argument that it is the closest thing to a client-mode player controller the Explorer has. That
argument does not survive looking at the camera.

**The camera is a bodyless observer.** `PhysicalCameraControlRequest::GroundedCharacter` registers a
grounded sphere pair and nothing else: no setup, no motion table, no rendered parts. It therefore has
no articulated animation to play and no visual whose agreement with placement could be checked. All
it can consume from a motion table is *timing* — how fast walking is — and even that it can only use
as a scalar.

**Retail agrees, in the place it matters.** The Explorer's speeds come from
`CMotionInterp::get_state_velocity`, whose `3.12` walk, `4.0` run, and `1.25` sidestep scalars are
retail's own literals, faithfully reproduced in `frontend-tuning.ts`. But that function is reached
only from `get_leave_ground_velocity` (`acclient.c:330078`): those constants are what retail carries
into a jump, not how it moves while grounded. Retail's grounded movement is authored root motion
through `CSequence`. So the camera path is using real retail numbers from the wrong retail function —
acceptable for a bodyless observer that has no root motion to author, and unacceptable for anything
rendered.

**A controllable entity is the real consumer.** Possessing a spawned weenie exercises the whole loop
in one step — command, selection, cursor, authored offset, solver, accepted path, placement, and
articulated animation — and makes the result *visible*: whether the feet slide is the entire question
authored root motion exists to answer. It is also the honest bridge to client mode, being a
client-mode player minus the network, which is what this repository's stated direction asks shared
APIs to be judged against.

**Possession and the follow camera are separable, and should be separated.** The motion system needs
a controllable entity; a third-person follow camera is a later presentation concern (boom arm,
occlusion). *Written here as "with its own subsystem"; D13 later established it needs no subsystem
at all — it is velocity policy over the camera body that already exists.* The Explorer already has
entity selection, spawn commands, and
camera framing, so "drive the selected entity, watched from the camera you already have" is a much
smaller step than "third-person mode" and is already a complete consumer. The follow camera lands
afterwards, incrementally.

**The shape: possess any entity, not a designated one.** Spawn anything, then flip a single
**possess** toggle. Commands flow to whatever is possessed and the camera follows it. This is
strictly better than nominating a player-like entity, for a reason specific to this plan: different
entities model different command sets, and `MotionSelectionOutcome::Unmodelled` already reports
which ones per command. So the UX can show what the possessed entity's table actually models and
refuse the rest, which turns the Explorer into a motion-table browser rather than a single-character
demo — and exercises far more of `select_motion`'s branches than one hand-picked weenie would.

Attachment and control are logically separable but ship as one toggle. Two states would be more
flexible and are not worth reasoning about until something needs detached observation.

**Consequences.** The camera walk controller leaves this plan's scope entirely and keeps its current
physics-derived path, with the leave-ground-formula debt recorded rather than fixed here. Phase 6
becomes possession plus the entity command surface, including a stance selector so style changes —
the least-covered branch of selection, and the one that makes idle interesting — have a producer.
Phase 5 then projects the clip that possession already produces, which resolves the 5-before-6
ordering gap on its own. A boom-arm follow camera lands afterwards as Phase 6b.

### Why retail's hardcoded launch speeds are not a counter-argument

Worth settling in the plan, because the snippet reads like evidence that retail drives locomotion
from velocity after all.

`CMotionInterp::get_state_velocity` hardcodes `3.12 * forward_speed` for walk, `4.0` for run, and
`1.25 * sidestep_speed` for sidestep (`acclient.c:329852-329871`), where `forward_speed` is a
*multiplier* defaulting to `1.0` (`:319450`, `:319510`, `:319583`; overwritten from movement params
at `:319706`). Its only caller is `get_leave_ground_velocity` (`:330078`).

So retail uses both, at different moments:

- **Grounded**: authored root motion composed through `CSequence`. Displacement, not velocity.
- **Leaving the ground**: an actual velocity is required, because an airborne body is ballistic and
  integrates `v·dt + ½a·dt²`. A per-tick rigid offset is not a velocity, so retail synthesises one
  from a per-command lookup.

The fallback proves the intent. When the command-derived velocity is near zero,
`get_leave_ground_velocity` falls back to the object's real `m_velocityVector` transformed from local
to global (`:330083-330096`). Retail therefore *has* a real velocity and deliberately prefers the
hardcoded one whenever a movement command is held — because the real one is `cached_velocity`,
accepted displacement over `dt`, collision clipping included. Jumping while scraping a wall would
launch at nearly nothing; the constants give the velocity that was *intended*.

This confirms D5 rather than contradicting it. Authored drive is per-tick and never persistent
momentum, and the jump is precisely the boundary where a client must convert it into momentum —
which retail does with a lookup table rather than by differentiating the offset.

### D8. The frontend is told which clip is playing, not where the cursor is

**Ratified 2026-08-20.** This reverses a Phase 5 deliverable, so the reasoning is recorded rather
than the change alone.

Phase 5 originally projected an *authoritative* cursor: clip identity plus the host's own
`frame_number`, so a frontend advancing at render rate could be re-anchored every host tick. That
guarantee is not worth what it claims, for three reasons.

**A phase offset does not cause foot sliding; a rate mismatch does.** Host and frontend both advance
by `framerate × dt`, so over any interval they cover the same number of frames. A constant offset
means the feet are at a different point in the stride while still covering the authored distance per
cycle. Nothing slides.

**Clip changes are resync points.** Entering a clip anchors the frontend at the clip's entry frame,
which is where the host started it too. Offset cannot accumulate across a transition, and
transitions are frequent.

**The plan already accepted a larger error than the cursor removes.** Phase 5 tolerates the frontend
holding at `high_frame` for up to one host tick — 33 ms at 30 Hz. Carrying a per-tick frame number to
eliminate a *sub*-33 ms error while accepting a 33 ms one is incoherent.

So the projection carries clip identity, the traversal window, the rate, and host-derived completion
behavior — and not the frame number. Those facts are not optional: 17,242 authored windows have a
negative rate and must be entered at the **high** frame and played backwards, 11,182 have a zero rate
and must hold, and 833 are narrower than their animation. The completion behavior distinguishes a
one-shot link from the looping tail. "Just the animation id" would play all of those wrong, visibly.

**What this collapses.** The projection can be published on *change* rather than every tick, since
the playing clip and its completion behavior change only at a sequence boundary — which is simpler
on the frontend too, because a swap happens on receipt rather than by diffing. And
`SequenceTick::completed_clips` loses its last
hypothetical consumer: it was justified as something the Phase 6 command surface would need, Phase 6
shipped without it, and "the transition finished" is now observable as the clip changing. It is
deleted under the plan's own rule that every field needs a named consumer.

**What this does not collapse.** The projection is still sampled after the advance, because the clip
can change during it. And the frontend still has to swap the playing clip at runtime, which is the
actual cost of Phase 5 and is unchanged. Dropping the frame number buys honesty, not effort.

### D9. Motion assets are warmed per table and shared per animation

**Ratified 2026-08-20.** Warming an entity's whole motion table at spawn, rather than acquiring
clips as they are first played, avoids a hitch every time a body transitions into a clip it has not
used. Whether that is affordable is entirely a question of how the sharing is keyed.

Measured per-table reach, with a frontend animation costing `frames x parts x 64` bytes as
frame-major transforms:

| | animations | prepared |
| --- | --- | --- |
| p50 — doors, chests, decor | 5 | 0.01 MB |
| p90 | 153 | 10.95 MB |
| standard character `0x09000001` | 321 | 27.83 MB |
| max | 324 | 27.88 MB |

Warming is free for the median entity and 27.8 MB for a character. **Share per animation, not per
table.** Tables overlap 9.2x: holding every table's reach independently would cost 1,085 MB, while
every distinct table-reachable animation prepared once is **117.39 MB** — the ceiling for a session
that spawns everything. The second character family therefore costs a small fraction of 27.8 MB
marginal. `AnimationAssetRepository` already refcounts through `PreparedAssetRepository`, so the
primitive exists; warming acquires the set on spawn and releases it on despawn.

**Staging is a closure, awaited before activation — not an asynchronous warm.** An earlier draft of
this decision had the entity appear and idle from whatever was ready while the rest arrived. That
invents a second asset lifecycle beside one that already exists, and a weaker one: the codebase
stages transitive dependencies before activation precisely so that a miss at frame time is a
*defect* rather than a state.

The rule is stated in three places and enforced by the machinery that implements it:

- `physics-script-repository.ts:38` — "reached mid-playback must not trigger a load at frame time".
- `dynamic-entity-system.ts:281` — "Transitive `CallPES` and emitter staging happens here, before
  activation, so nothing reached mid-playback can trigger a load at frame time".
- `physics-script-system.ts:346` — "The closure is staged transitively before activation, so a miss
  is a staging defect".

And `PhysicsScriptRepository::acquireClosure` states the invariant that makes it hold: "Acquisition
is all-or-nothing: a failure anywhere releases every handle taken so far, so a partially staged
closure can never reach activation."

Motion animations therefore join that closure rather than opening a new one.
`AnimationAssetRepository` gains an `acquireClosure(motion_table)` mirroring the physics-script one —
an acyclic traversal over the table's cycles, modifiers, and links, terminating on a visited set,
all-or-nothing — awaited in the same preparation that already stages script closures and emitters.
An entity activates when its motion closure is complete, like every other dependency it has.

The consequence is named rather than hidden: a character's 321-animation closure becomes **spawn
latency**, not a partial state. If that latency matters, the fix is to make the closure cheaper —
the host already holds those records decoded and re-decodes them per request, see the Phase 5
findings — not to let entities activate half-staged. The resident set size is reported rather than
silently grown.

**The closure is the whole table, not the reachable set from the current style.** A style-scoped
closure would be far smaller, but stance changes are exactly what the Phase 6 selector added, and
links reach 1,174 animations reachable no other way — so scoping by style would require re-staging on
every stance change, which is a load at command time: the same defect in a different costume.

### D10. The host holds motion ambiently; only the frontend warms

**Ratified 2026-08-20.** D9 is a frontend decision. The host's answer is the opposite, and the
asymmetry is not an inconsistency — the two need different halves of the same animations.

| | needs | cost for everything |
| --- | --- | --- |
| Host | root tracks and simulation hooks | **6.51 MB** |
| Frontend | articulated part frames | **117.39 MB** |

Measured 2026-08-20 across the whole catalog: 62,210 motion-data records, 79,162 clip entries, 1,938
distinct animations, 9,675 root transforms (0.26 MB), and 1,135 simulation hooks — 6.51 MB before
hash-map overhead, call it 10-12 MB with it. The frontend's share of the same animations is 450x
larger, which is why "load everything" is right for one and wrong for the other.

Memory is the weaker argument. The stronger one is that **the contract's core invariant depends on
eager loading**. D1 and D6 made absence mean *corruption*: the projection resolves every reference
once at build time and hands out `Arc<MotionAnimation>`, so a runtime clip cannot hold an
unresolvable animation. Lazy or on-demand host loading reintroduces absence as a runtime state, and
the resolver would have to distinguish "this archive is corrupt" from "not loaded yet" — the exact
ambiguity D6 exists to eliminate. It also has no good mid-tick branch: a body transitioning into a
stance whose link references an unloaded clip could block the tick, skip the motion, or stall the
transition, and all three are worse than 6.51 MB.

On-demand per spawn fails for a second reason as well: links reach 1,174 animations reachable no
other way, so "load what this entity needs" is very nearly the whole table anyway.

So the host's problem was never *what it holds* — it is *how it builds it*. See "Phase 5 findings:
the host decodes what it throws away".

### D11. One conservative bound covers every clip an entity can play

**Ratified 2026-08-20.** `prepareDynamicAnimation` computes animated bounds by sweeping frames and
parts, and those bounds feed culling. A body driven by a motion table changes clip constantly, so
per-clip bounds would churn the culling volume on every transition.

The union is computed once across the closure and never changes. It is conservative rather than
tight, which is the correct direction for a culling bound: looser, never wrong.

**It costs less than per-clip bounds would**, which was not obvious until the sweep was read.
`sweepPartBounds` boxes a sphere of each part's own radius around that part's pose translation, and
`AABB3.union` is associative — so the union across a closure is the same pass with the accumulator
never reset, with no per-clip intermediate. Each part's radius depends only on template geometry and
scale, so it is hoisted out of the clip loop rather than recomputed 321 times.

The sweep is deliberately rotation-independent, with the reason already recorded in the code:
"Translation interpolates linearly and rigid rotation preserves this radius, so the endpoint sphere
AABBs cover every slerped pose between authored frames."

**An unplayable clip is skipped and complained about, not fatal.** Three conditions make a clip
unplayable: a hook that would misrender the object, a `SetOmega` hook whose continuous root rotation
has no bounded sweep, and an appearance requiring a part the clip does not have. Any of them skips
that clip and warns; the entity still animates from the rest of its table, because refusing to spawn
over one bad clip is worse than playing the others. A skipped clip is absent from the playable set,
so a projection naming one holds the current pose.

The complaint is deduplicated per motion table and clip rather than per entity: a defect in a
commonly reached clip would otherwise log on every spawn, and a console nobody reads is the same as
no console at all.

All three are unreachable in shipped content — the census found no table-reachable clip carrying a
blocking hook or `SetOmega`, the eight `SetOmega` hooks in the archive living only in animations no
table references — so a complaint is a tripwire rather than an expected event.

### D12. A projected clip carries host-owned completion behavior

**Corrected 2026-08-21 after runtime observation.** The 2026-08-20 decision made every projected
clip lap because a looping idle is published once and must not freeze. That generalized a true fact
about the cyclic tail into a false fact about one-shot transitions.

`MotionSequenceRuntime::advance_to_next_clip` moves the cursor to `current + 1`, or to `first_cyclic`
when it is already last. For a lone cyclic idle those are the same node, so the host resets
`frame_number` to that node's starting frame and keeps playing it. `current_clip()` is unchanged, and
`take_changed_clips` publishes only on change — so **a looping idle is projected exactly once and
never again**. A frontend that held at the far bound would play each idle through once and then
render a statue, which fails "a possessed entity's rendered idle comes from its motion table" in this
phase's own acceptance criteria.

The sequence already owns the missing distinction through `first_cyclic`. It now projects that fact
as `completion: loop | hold`: nodes in the looping tail re-enter their window, while transition
nodes retain their terminal pose until the successor projection arrives. The frontend neither
derives cyclicity nor chooses the successor.

**Evidence that overturned the old decision.** Clay in Magic and Hand Combat lands through reversed
animation `0x030004A6`, window `[0, 15]` at `-30` fps. Lapping it jumps from the idle-side low frame
back to the falling-side high frame for the projection gap, producing a visible one-frame stance
flash that retail does not show. Non-Combat uses the shorter forward `0x030004AA` window `[0, 5]` at
`+30` fps, whose equivalent wrap is less conspicuous. Holding the appropriate terminal pose removes
the observable error without adding a shared cursor or predicting the next clip.

**Entry frames are retail's, not ours.** `clipEntryFrame` returns `lowFrame` forward and
`highFrame + 1 - 0.0002` reversed, mirroring `AnimSequenceNode::get_starting_frame`
(`acclient.c:327012-327021`) exactly as the host sequence does. The epsilon matters: entering a
reversed clip *on* the high frame would skip its departure, and departures are what fire hooks.

### D13. The follow camera is spherical state about an anchor, clamped by a sweep

**Ratified 2026-08-20**, after two revisions recorded here because both wrong turns are instructive.

**First proposal: a stateless per-frame sweep**, explicitly "rather than integrating the camera as a
body". It cannot wedge and is always in line of sight, but it snaps: clamping a scalar with no
dynamics has no settle, no zoom, and no pan.

**Second proposal: a world-space body chasing `head - view * length`**, driven by velocity policy
over the existing free-flight solve. This has dynamics but the wrong *state*. A chasing body gets
blocked **wherever it happens to be** — it does not hold station behind the entity at a reduced
distance, it simply stops, and the entity walks past it. That is why an earlier draft of Phase 6b
listed three distinct collision "shapes" with three different outcomes. They are not three cases;
they are one model failing at three magnitudes.

**Ratified: spherical state about the anchor.** The camera keeps `(yaw, pitch, desiredDistance)` and
their velocities, and its world position is *derived* every frame:

```
renderedDistance = smoothAsymmetric(min(desiredDistance, sweepResult))
position         = anchor + rotate(yaw, pitch) * (-renderedDistance)
```

Every requirement lands in exactly one place:

| Requirement | Where it lives |
| --- | --- |
| Pan / orbit | Angular velocity on `yaw` and `pitch` |
| Zoom | Velocity on `desiredDistance` |
| Settle for less when blocked | `min(desiredDistance, sweepResult)` |
| Smooth recovery when the obstruction clears | Spring on `desiredDistance`; the clamp relaxes with it |
| Cannot wedge | Position is derived from the anchor, never accumulated |
| Never ends up in front of the entity | The clamp is along the boom direction by construction |

**Asymmetric smoothing is required, not decorative.** Clamping alone snaps: rounding a pillar drops
the clamp several metres in one frame. Pull in immediately or the camera clips through the wall;
ease out damped or it jitters. This is the one place the original plan's instinct was exactly right.

**The host's role is one question, not a constraint and not a body**: *sweep from this anchor along
this direction for this distance — how far did you get?* `solve_physical_fly` already answers it as
a pure function over `&CollisionScene`. Everything else is three scalars and their velocities, which
is frontend policy under the app boundary rule.

**A general solver constraint system remains deferred.** The census found one candidate consumer and
this design removes it: the viewer sphere is a rigid offset, attached entities are `pose-only` and
never solved, and the boom is now scalars plus a clamp. Nothing in the repository needs a leash.

**The camera is not a physical body in third person.** That removes the last structural reason for a
camera-shaped body session and strengthens the dissolution, now Phase 4 of the controller-surface
plan. `PhysicalFly` keeps its body
because a free camera attached to nothing genuinely is one.

#### Known cost

The clamp is computed once per host tick against an anchor and direction up to one tick stale, so
fast movement or fast mouse-look lags the clamp by under 33 ms. Static geometry does not move, so
the error is only in where the *viewer* is, never in where the wall is. Bounded by entity speed and
look rate over one tick; revisit only if it is visible.

### Rejected alternatives

- **Mean cycle velocity as the canonical contract** — loses ordered transforms, boundaries, links,
  nonuniform timing, and rotation composition, and obscures authored drive versus momentum. Distinct
  from D5: the authored offset is composed exactly each tick from ordered frames and never stored.
- **Two motion backings, reduced for the TUI and raw for the Explorer** — they produce different
  *grades* of fact, so a shared resolver would have to degrade raw to velocity, synthesize fake
  transform programs, or return a capability-typed union that pushes the fork into every consumer.
  Capability becomes ambient: the same WCID behaves differently per profile with no way to explain
  it. D2 replaces this with one contract whose producer varies only in how much content it was given.
- **Shipping `Animation` records with `num_parts = 0` for small profiles** — one file ID carrying
  different content per profile, an invariant expressible only in documentation. D2 makes it
  unnecessary; the host consumes a type with no part frames to leak.
- **Serializing `MotionSequence` as a baked asset** — deferred, not refused. No measured startup cost
  justifies a wire format today.
- **Content tiering by archive profile** — see D6. Saved 1.7–2.2 MB and cost transition clips,
  attack timing, tier metadata, three open questions, and profile-dependent resolution.
- **Frontend-only root motion** — rendered placement would disagree with collision.
- **Injecting the movement system alongside the solver** — motion fidelity varies by content depth,
  not by client. Two injection points that must agree in grade are inter-dependent knobs that should
  be one composite.

## Scope

### In Scope

- Runtime consumption of parsed raw motion tables and animations through `holtburger-content`, and
  deletion of `MotionKinematics` across the measured consumer set.
- The `MotionSequence` contract and its in-memory construction from raw content, shared by both
  hosts.
- Preservation of the six simulation-relevant hook types through `MotionHookTrack`, including
  `Attack` and `Ethereal`, whose consumers are future work.
- Small-profile manifest changes and `dat2hba` content filtering, gated on the Phase 1 sizing call.
- Sequence resolution over the contract: command and style changes, links, cycles, rates, cursor
  advancement, and one-tick authored contributions.
- Widening `SolveProjectionBasis` so authored drive is expressible rather than reduced to velocity.
- Authored drive reaching the Explorer's collision solver, and the accepted rigid path that results.
- One animation cursor shared semantically by solver root drive and frontend articulated playback.
- Explorer consumers: possession of a spawned entity, its motion-command UX, and a follow camera.
  The camera walk controller is explicitly **not** a consumer — see D7.
- Removal of the Explorer semantic-motion capability boundary and the Bats root-rotation divergence.

### Out of Scope

- Unifying the two solver stacks, implementing `SpatialPhysics` for the Explorer, or migrating
  `LocalDriveControl`. See D4 and its tripwire.
- Acting on `Attack` or `Ethereal` hooks. They are carried, not consumed: combat, damage, and
  collision-state changes remain future work.
- Serializing the `MotionSequence` contract as an asset.
- Server AI, navigation, move-to-object policy, combat decisions, or pathfinding.
- Persistent motion history, replay logs, timeline recorders, spline services, or animation graphs.
- Frontend collision, frontend motion-table decoding, or per-render-frame host transform streams.
- Replacing physical velocity for projectiles, knockback, falling, impulses, or authoritative vector
  updates.
- Client-mode UX beyond the command surface.

## Ground Truth and Existing Seams

### Authoritative references

- Retail sequence selection and composition: `acclient-eor-source/acclient.c:323900-324060`,
  `:326255-327216`, `:327394-327685`.
- Retail physics and root application: `acclient-eor-source/acclient.c:306106-306153`,
  `:308262-308298`.
- Retail scale hook: `acclient-eor-source/acclient.c:328805-328816`.
- ACE motion selection and rate changes:
  `ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs:76-185`, `:358-393`.
- ACE attack-frame extraction from animation hooks:
  `ACE/Source/ACE.DatLoader/FileTypes/MotionTable.cs:87-120`,
  `ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs:462-468`.
- ACE ethereal-hook consequence: `ACE/Source/ACE.Server/WorldObjects/Door.cs:187-200`.
- ACE sequence stepping: `ACE/Source/ACE.Server/Physics/Animation/Sequence.cs:337-429`.
- DAT formats: `crates/holtburger-dat/src/file_type/motion_table.rs`,
  `crates/holtburger-dat/src/file_type/animation.rs`,
  `crates/holtburger-dat/src/file_type/setup_model.rs` (`AnimationHook`).

### Existing Holtburger seams

- Reduced asset derivation: `apps/holtburger-tools/src/dat2hba.rs`.
- Reduced asset model: `crates/holtburger-dat/src/file_type/motion_kinematics.rs`.
- Archive profile manifests: `crates/holtburger-dat/src/manifest.rs`.
- Semantic resolution: `crates/holtburger-world/src/state/motion_resolution.rs`.
- Solver contract types: `crates/holtburger-world/src/spatial/types.rs`.
- Collision-aware solver: `crates/holtburger-world/src/spatial/physical_body.rs`,
  `crates/holtburger-world/src/spatial/collision.rs`.
- Scene tick: `crates/holtburger-world/src/spatial/scene.rs`.
- Locomotion command vocabulary: `crates/holtburger-protocol/src/messages/movement/types.rs`.
- Explorer host composition: `apps/holtburger-3d/src-tauri/src/host_simulation_runtime.rs`.
- Frontend placement and animation:
  `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`,
  `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`.
- Archive sizing census: `crates/holtburger-debug-harness/src/bin/motion_content_sizing.rs`.

## Phased Implementation

### Phase 0: Close Remaining Retail Semantics

Progress: **complete 2026-08-19.** Support gating, composition order, cursor-under-collision,
angular-momentum ownership, link boundaries, leftover time, hook indexing, and both server-correction
paths are traced and recorded in the "Phase 0 findings" sections. Pause and resume are Explorer
runtime concerns rather than retail semantics — the client has `StopCompletely`, not a paused
sequence — and are covered by Phase 2 and Phase 5 acceptance instead. The flattening fixture this
phase originally budgeted was deleted rather than built: D5 showed there is no approximation to
measure. The flattening fixture this phase originally
budgeted was deleted rather than built: D5 showed there is no approximation to measure.

#### Acceptance Criteria

- Every solver policy has a retail or ACE citation. Met — the findings sections carry citations for
  composition, gating, collision, link boundaries, hooks, and both correction paths.
- Remaining unknowns are explicit user decisions, not guessed implementation details. Met.
- No runtime trace recorder or diagnostic history was introduced. Met.

### Phase 1: The `MotionSequence` Contract and Raw Cutover

Progress: **complete 2026-08-20.** The contract lives in `crates/holtburger-content/src/motion_sequence.rs`
and is projected by `ContentRepository::read_motion_sequence_catalog`. `MotionKinematics` is deleted
outright — module, type id, `DatFileType` variant, `dat2hba` derivation, bootstrap slot, and every
consumer. `grep -rn MotionKinematics crates apps` returns nothing.

#### Deliverables

- Define `MotionSequenceTable`, `MotionSequence`, `RootMotionTrack`, and `MotionHookTrack` in a
  shared crate, carrying per-frame root transforms, frame ranges, rates, cycles, modifiers, links,
  explicit velocity/omega, and the three simulation hook types that occur.
- Build the contract in memory from parsed raw `MotionTable` and `Animation` records supplied
  through `holtburger-content`; consumers receive the contract, never archive paths or raw records.
- Rework `holtburger-world` bootstrap and `WorldState` so motion resolution owns contract access.
  Both clients cut over together, with no reduced fallback.
- Extend every archive profile to carry the complete representation: all motion tables whole, and
  animations filtered to position frames, counts, and simulation hooks. No per-profile motion
  manifest, no command sets, no reachability walk.
- Measure the emitted bundle rather than trusting the analytical estimate, and record the real size.
- Delete `MotionKinematics` across the measured consumer set, including the survey, which re-derives
  its census facts from the contract.

#### Acceptance Criteria

- Standard walk reconstructs the measured 36-frame, 1.4 m sequence through the contract rather than
  as `2.60 m/s`. **Met** — `motion_contract_acceptance` reports animation `0x03000003`, frames
  `0..=35` of 36 at 66.9 fps, composed translation `1.4000 m`. It also prints what the old reduction
  would have produced from that same track, `2.6017 m/s`, which matches the deleted asset: the
  contract reproduces the source, and the reduction is derivable from it rather than the reverse.
- The contract exposes no part frames and no presentation hooks to any host consumer. **Met** —
  `MotionAnimation` carries only `RootMotionTrack` and `MotionHookTrack`, and `MotionHookEffect`
  models three simulation types.
- Filtered animations round-trip through the existing decoder with position frames and simulation
  hooks intact, verified on an `Attack` carrier and an `Ethereal` carrier. **Met** — round-tripped
  for all 1,938 referenced animations by `motion_profile_sizing`, and unit-covered by
  `animation_pruning_keeps_simulation_facts_and_drops_presentation`.
- Every profile resolves every cycle, modifier, and link; absence of any referenced record is an
  error, never a tier-shaped fallback. **Met** — `MotionContractError::MissingAnimation`, covered by
  `a_referenced_animation_that_is_absent_is_an_integrity_failure`.
- The emitted bundle size is recorded and is within reach of the 2.45 MB estimate. **Met, with the
  estimate corrected** — see "Phase 1 findings: what the emitted bundle actually costs".
- The TUI runs from a small profile containing no `MotionKinematics` asset. **Met structurally** —
  the asset no longer exists in any profile, and the micro manifest carries the complete motion
  representation instead. Not verified by running the TUI, which this workflow does not do.
- `grep -rn MotionKinematics` over crates and apps returns nothing. **Met.**

#### Phase 1 findings: what the emitted bundle actually costs

The plan's 2.45 MB figure was **uncompressed source bytes**. HBA records are zstd-compressed, so the
emitted cost is much lower. Measured 2026-08-20 by `motion_profile_sizing`, which composes a
candidate archive from the shipped micro bundle plus real motion content, using the same writer and
compression settings `dat2hba` uses:

| Micro bundle | Emitted | Delta |
| --- | --- | --- |
| Baseline as shipped | 0.34 MB | — |
| Plus motion tables and pruned animations | 0.89 MB | +0.56 MB |
| Plus setup models (the shipped choice) | **2.58 MB** | +2.25 MB |
| Plus *unpruned* animations, for contrast | 41.87 MB | +41.53 MB |

Two things this changed.

**Pruning is what makes the representation affordable, not compression alone.** 1,938 referenced
animations are 52.10 MB raw and 0.65 MB pruned. Shipping them unpruned would be a 41 MB bundle, so
`Animation::prune_to_simulation_facts` is load-bearing rather than an optimisation.

**Setup models are three quarters of the growth, and they are in the bundle for one fact.** Motion
resolution falls back from an object's own motion-table property to the default its setup declares —
real client behavior, `CPhysicsObj::InitDefaults` (`acclient.c:309089-309103`) reads the setup's
field and calls `SetMotionTableID`. Measured across the catalog: 5,935 setups exist, **57 declare a
default motion table**, and **12 of 43,913 templates** actually reach the fallback, across 8 setups.
Five templates carry both a property and a disagreeing setup default, confirming the property wins.

So three options existed, and the cheap ones were rejected:

- *Ship all setups* (chosen): +1.69 MB, one simple rule, no partial types.
- *Ship only the 57 setups that declare a motion default*: ~+0.01 MB, but micro would carry a
  partially populated `SetupModel` type whose completeness rule lives only in documentation.
- *Ship none*: cheapest, but those 12 templates would resolve motion in `full` and `pruned` and not
  in `micro` — the profile-dependent resolution D6 exists to prevent.

2.58 MB is inside the ~2.66 MB already accepted for micro, so the simplest rule fits the budget. The
numeric coincidence is exactly that: the accepted figure was an uncompressed estimate of different
content. If bundle size ever becomes a real constraint, the 57-setup rule is the first lever and it
recovers 1.69 MB.

**Caveat on the measurement.** The repository carries no raw retail DATs, so `dat2hba` could not be
run end to end. The candidate archives are composed from the shipped full-profile `assets.hba` with
the same pruning and writer the tool uses, which reproduces the emitted content but not necessarily
the tool's exact entry ordering. Re-measure from raw DATs when they are available.

#### Phase 1 findings: what the projection had to normalise

Three facts the census surfaced, each now computed once at projection rather than by every consumer.

**Clip windows carry a sentinel.** 71,158 of 79,162 authored windows have `high_frame < low_frame`,
almost all of them `-1`. Retail resolves this when it installs an animation into a sequence node:
`-1` becomes the last frame, both bounds clamp into range, and a low frame above the high frame
raises the high frame rather than inverting the window (`acclient.c:327498-327532`, mirrored by ACE
`AnimSequenceNode.set_animation_id`). `MotionClip` stores the resolved window, so no consumer knows
the sentinel exists. 833 windows also point past the end and are clamped.

**The motion-data bitfield is two selection rules, not opaque flags.** Bit 0 clears active modifiers
when the motion starts; bit 1 restricts the motion to the style's default substate
(`CMotionTable::is_allowed`, `acclient.c:324103-324129`). They project as `clears_modifiers` and
`requires_default_substate` — named because Phase 2's selection needs both.

**Our cycle-key mask was wrong.** `MOTION_KEY_MASK` was `0x000FFFFF`; retail composes
`motion & 0xFFFFFF | (style << 16)` (`acclient.c:324297-324305`). No shipped command sets bits 20-23,
so no lookup changed, but the duplicated private helper is now one `MotionTable::cycle_key` matching
retail — closing the debt row this plan carried for it.

Two smaller shapes were settled the same way. Hook directions in real content are exactly `0`, `1`,
and `-1`, so `MotionHookDirection` has three variants and anything else is a projection error rather
than a silent default. Ethereal payloads are exactly `0` or `1` across all 86 hooks, so the decoded
form is a `bool`.

#### Phase 1 concessions

- **The velocity reduction survives, in `holtburger-world` rather than in an asset.**
  `MotionTableMovementProfile` and `MotionCommandKinematics` moved out of `holtburger-dat` — a
  reduction had no business in the decoding crate — and are now computed from the contract.
  `reduced_forward_speed` composes each clip's window into one rigid transform and divides distance
  by frames traversed, which is the same reduction `dat2hba` used to bake, now derived on demand from
  the canonical source. It stays because the client's movement system, dead reckoning, and
  command-capability checks are velocity-shaped; Phase 3 removes only its use as a *solver basis*.
- **The projection is eager.** `read_motion_sequence_catalog` decodes every motion table, animation,
  and setup model at bootstrap: 222 ms on the full profile, better than the 400 ms upper bound this
  plan recorded. Lazy per-table animation resolution stays the mitigation if that ever hurts.
- **Three hook payloads became typed in `holtburger-dat`.** `Attack`, `Ethereal`, and
  `ReplaceObject` were `Raw` byte blobs. The contract could not carry a blob and stay type-safe, so
  they decode into named payloads with a symmetric encoder, including the known-type packed data-id
  encoding `ReplaceObject` uses. The Explorer's behavior transport followed: it now sends typed
  fields instead of raw byte ranges for all three, with `Attack` and `Ethereal` documented as
  simulation facts the frontend deliberately does not execute.
- **Two tests that depended on uncheckable runtime assets are gone.** The world-side motion-table
  integration probe read `dats/assets.hba` and silently skipped when absent; the core builder
  fixture asserted an asset id. Both are replaced: the builder fixture now bundles a synthetic motion
  table and animation and asserts the projected walk cycle, and real-content coverage lives in
  `motion_contract_acceptance`, which asserts against the archive rather than skipping.
- **`ContentRepository::from_mounts` cannot enumerate.** `ResourceSource` has no listing API, so a
  repository built that way has an empty resource index and projects an empty motion contract. It is
  a test-only constructor today; the limitation is now documented on it rather than latent.

### Phase 2: Resolve One Semantic Sequence

Progress: **complete 2026-08-20.** `crates/holtburger-world/src/motion/` holds the runtime: `state.rs`
(retail `MotionState`), `sequence.rs` (retail `CSequence`), and `selection.rs` (retail
`CMotionTable`). 21 focused tests cover it. Nothing consumes it yet — Phase 3 is where it reaches a
solver — so it is deliberately unwired rather than accidentally dead.

#### Deliverables

- Implement focused stateless resolution over the contract and an injected effective clock.
- Resolve command and style changes, links, cycles, rates, cursor advancement, and one-tick authored
  contributions once, producing the tick's authored rigid offset from ordered composition.
- Keep client `WorldState` and Explorer registries as separate semantic authorities.
- Distinguish the two absence cases rather than collapsing them. An archive that references a table
  or animation it does not contain is an integrity failure and must be loud. An entity performing a
  command the resolver or the loaded tier does not model is not a failure: resolution yields no
  authored basis and the body falls through to authoritative server vectors, which is what
  `resolve_guid_projection_basis` already does today. Preserve that distinction; the player path's
  existing hard error and the entity path's fallthrough are both deliberate.

#### Acceptance Criteria

- Stand, walk, run, turn, stop, reversal, interruption, pause/resume, and deterministic step select
  the expected sequences, ranges, rates, and root contributions. **Met** — one test each, plus
  `identical_inputs_produce_identical_ticks` stepping two bodies through the same quanta.
- Late asset readiness starts at the current cursor rather than replaying elapsed motion. **Met** —
  `late_installation_starts_at_the_clips_entry_frame`: ticks before installation contribute nothing
  and leave no cursor debt.
- Repeated resolution creates no service cache, event history, or timeline recorder. **Met** —
  selection is free functions over caller-owned state; the runtime holds only the installed clips
  and the cursor.

#### Phase 2 findings: what the port had to settle

**The injected clock turned out to be a parameter.** This phase budgeted "an injected effective
clock". `advance(quantum)` takes elapsed time as an argument, so the caller already owns the clock
and a clock type would be a wrapper with one method. Deleted rather than built.

**Corrected 2026-08-21: every root frame contributes exactly once.** Retail composes a successor's
entry frame at the boundary (`acclient.c:327012-327021`) and again when that frame departs
(`:327150-327160`), while ordinary forward playback never composes the leaving clip's terminal
frame. The original port preserved that as a `RETAIL QUIRK`. We later chose the cleaner authored
invariant: completing a clip departs its terminal frame, including its hooks and physics slice,
exactly once; entering the successor only positions the cursor. The retained
`root_boundary_divergence_census` measured 26,421 directly-authored internal and cyclic boundaries:
half had no translation difference, p95 was 1.54 cm, p99 was 5.10 cm, and the maximum was 2.01 m;
77 changed rotation, with a 3.90-degree maximum. The large changes are authored terminal strides
that retail substitutes with the next entry frame, not numerical instability. This is an explicit
aesthetic and structural divergence, not a claim of retail parity.

**Corrected 2026-08-21: `re_modify` installs every active modifier once.** Retail iterates a snapshot
of the modifier list while repeatedly popping the live list's head, and re-selecting a modifier
pushes it back onto that head (`acclient.c:323847-323874`). With N modifiers the head is installed N
times and the rest are omitted; ACE matches. The original port reproduced that loop. The corrected
implementation no longer mutates or re-selects semantic state: it looks up each active modifier and
combines its physics once. This makes simultaneous sidestep and turn independent of list ordering.
The archive contains 1,222 turn/sidestep modifier records, and the normal interpreted movement
surface can activate both together, so the divergence is observable and intentional.

**`Frame::subtract1` and ACE's `AFrame.Subtract` are not the same operation.** Retail computes the
new rotation first and subtracts the translation through *that* rotation
(`acclient.c:342540-342579`), making it the exact inverse of `combine`. ACE uses the operand's own
orientation and is not an inverse. `RigidTransform::subtract` follows retail, with a round-trip test
under rotation.

**`Frame::rotate` needs no matrix.** Retail maps the axis into global space through the frame's
cached matrix and then left-multiplies. Because that matrix *is* the frame's rotation,
`R(M·w) * q` and `q * R(w)` are the same rotation, so the implementation is a local right-multiply.
The equivalence is recorded on the method with both citations.

**`add_motion` assigns the explicit vectors rather than accumulating them.** Installing a motion
overwrites whatever the previous one contributed; only modifiers combine and subtract. An
accumulating port would have doubled velocity on every transition.

#### Phase 2 concessions

- **Actions are not modelled.** Retail's `MotionState` queues one-shot actions alongside modifiers,
  and `GetObjectSequence` has an action branch. Nothing in this codebase issues an action, so the
  queue and the branch would be a field and a code path with no producer. `MotionCommand::is_action`
  exists so the classification is complete; selecting one reports `Unmodelled`.
- **`stop_completely` guards against a modifier it cannot stop.** Retail re-reads the list head each
  iteration and would spin forever on a modifier with no table entry. That state is reachable,
  because a displaced substate is promoted to a modifier whether or not the table defines one as a
  modifier, so the port drops such an entry instead of looping. This is a deliberate departure from a
  hang, not from a behavior.
- **`completed_clips` is carried and unconsumed.** Retail synthesises an `AnimDone` hook when a
  one-shot clip finishes. The tick reports the count so Phase 6 does not have to re-derive it;
  nothing reads it today.
- **The boundary loop is bounded at 64 crossings per tick.** Retail recurses instead. The canonical
  census measured at most 8 authored boundaries per 30 Hz tick at stored rate and 24 at 3x, so the
  bound is three times the measured worst case and exists only so a zero-length window at a nonzero
  rate cannot carry leftover time forever.

### Resteer A: Dry-Run the Authored-Drive Contract

Progress: **complete 2026-08-20. The rigid-offset shape fits; no resteer needed.** Two measurements
decided it, and the dry-run surfaced one plan sequencing gap and one bug, both recorded below.

**Authored root rotation is yaw-only in all of referenced content — 19 of 19 animations, with a
maximum tilt axis component of exactly zero.** The Explorer's grounded actuation takes an absolute
world heading (`GroundedBodyActuation::with_control_heading`), which can express a yaw delta
exactly and could not express a tilt at all. So the authored rotation reaches the solver as
`heading(pose.rotation * authored.rotation)` with no approximation. Had a single animation tilted,
the actuation would have needed a full rotation delta.

**Authored vertical translation exists but the solver already removes it.** Eight referenced
animations author a Z component, at most 0.018 m per frame. `GroundedBodyActuation::drive` rejects
any vertical drive by contract, so the boundary must drop it — and that is not a divergence:
`solve_grounded` projects the whole displacement into the support plane whenever the body has
walkable support (`grounded.rs:331-333`), and retail's support gate zeroes authored translation
entirely when it does not. Either way the vertical term is unobservable, so dropping it at the
boundary is an identity rather than a loss.

**Reducing the offset to a velocity at the solver boundary is not the reduction this plan rejects.**
The offset is the tick's exact displacement, composed from ordered frames; dividing it by `dt` to
meet a velocity-shaped actuation is arithmetic on an exact quantity, performed once, at the layer
that owns the solver contract. The rejected reduction was a *content-pipeline* one that discarded
ordering, ranges, and rotation before any solver saw them. Retail itself reduces its own accepted
path to observational `cached_velocity`. **Superseding correction (2026-08-28):** the shared-pose
reconciliation investigation proved that retail does not feed `cached_velocity` into the following
physics tick; `m_velocityVector` remains the independent physical integration input
(`acclient.c:306094-306172, 310862-310927`).

**Scenario dry-run.** Supported-to-airborne and airborne-to-supported are the support gate, which
applies once per update to translation only and leaves rotation intact, so a rotating clip keeps
turning through a ledge fall. Wall clipping is unchanged: the offset becomes a displacement and the
existing subdivision clips it, with no retry of the blocked part. Moving platform, projectile, and
free-sphere bodies never take a grounded authored basis. Server correction cannot arise in the
Explorer and is recorded as client-mode debt. Rotating offset spheres and physics-BSP targets are
Phase 4's sampling change and are unaffected by the input shape.

**Gap found: Phase 3 has no Explorer-side producer.** The Explorer's only actuation source is
`dynamic_entity_coasting_actuation`, which coasts every dynamic body; the entity motion-command UX
that would issue a command arrives in Phase 6. So Phase 3 builds the authored-offset-to-actuation
conversion and its coverage, and Phase 6 supplies the first production caller — the same shape as
Phase 2's runtime, which Phase 3 is the first to call. Recorded rather than resequenced.

**Bug found and fixed: the attack-cone part index is signed.** Phase 1 typed the `Attack` payload
with a `u32` part index and the Explorer transport validated it against the setup's part count. The
census shows `-1` — the whole-object sentinel — is the *most common* value, 675 of 1,047 hooks, so
that validation would have rejected them and failed their animations outright. Retail passes the
field straight to `AttackManager::NewAttack` (`acclient.c:308215`) and ACE types it `int`. Now `i32`
with the sentinel handled the same way `CreateParticle` already handled it.

**Field audit.** `AuthoredDrive` carries one field, the offset. Every derived fact is computed at one
layer: the clip window is resolved at projection, the tick offset is composed in the sequence
runtime, the support gate and object scale are applied at the solver boundary, and the heading is
derived there too. Nothing downstream re-derives any of them.

### Phase 3: Integrate Authored Drive with the Explorer's Solver

Progress: **complete 2026-08-20.** `SolveProjectionBasis::AuthoredDrive` replaces `GroundedMotion`,
`WorldState` owns a `MotionRuntimeRegistry` advanced once per tick, and
`motion::authored_grounded_actuation` converts an authored offset into the collision solver's
actuation. Per Resteer A, that converter's first production caller is Phase 6.

#### Deliverables

- Widen `SolveProjectionBasis` so `AuthoredDrive` is expressible without reduction to velocity,
  replacing the velocity-shaped `GroundedMotion`. The enum stays at two variants: server
  interpolation and constraint damping are client-mode obligations with no Explorer producer, so no
  variant is added for them yet.
- Consume the authored rigid offset in the collision-aware solver, composing support-admitted
  sequence drive and physical dynamics in the proven order within existing collision subdivision; no
  second collision algorithm.
- Return an accepted rigid path whose points keep pose and collision placement inseparable.
- Derive final pose, achieved physical velocity, support and contact state, and response exactly
  once.
- Apply the support gate to translation only, scaled by object scale, leaving rotation intact —
  retail's rule, not an approximation of it.
- Keep `BasicSpatialPhysics` working against the widened basis at its existing fidelity. It is not
  required to honor the authored offset exactly; reducing it to a velocity itself is an acceptable
  and in-character interpretation, and is what retail does for its own `cached_velocity`. What it
  must not do is silently ignore it.
- Remove the wildcard arm in `grounded_kinematics_for_input` (`spatial/physics.rs:22-30`), which
  today would absorb a new basis variant as `None` and leave the body motionless with no diagnostic.
  `velocity_kinematics_for_input` is already exhaustive and will fail to compile, forcing a decision;
  both sites should behave that way so the compiler enforces the policy.

#### Acceptance Criteria

- Uniform walking remains numerically equivalent within the proven tolerance. **Met** —
  `a_walk_cycle_travels_the_same_distance_the_reduced_asset_claimed` reproduces the measured
  standard walk (36 frames of 0.0388889 m at 66.9 fps) and accumulates one second of 30 Hz ticks to
  within 2% of the deleted asset's 2.60 m/s, without storing a velocity anywhere.
- A rotating authored sequence composes translation and rotation in retail's order, with authored
  rotation applied locally and physical omega globally. **Partially met.** Authored rotation is
  local, proven by `rigid_rotate_is_a_local_composition` and by the sequence runtime applying
  motion-data omega through `RigidTransform::rotate`. The global counterpart is not demonstrated:
  neither solver represents physical omega as a quaternion — `BasicSpatialPhysics` carries a heading
  scalar and the collision solver takes an absolute heading — so there is no place where a global
  rotation is applied and could be shown to differ. Recorded as debt rather than claimed.
- Walking off a ledge changes translation authority at the proven boundary without retrying blocked
  authored displacement. **Met** —
  `an_unsupported_body_keeps_authored_rotation_and_loses_authored_translation` and
  `an_unsupported_body_contributes_no_translation_but_still_turns`. Nothing accumulates the offset:
  the registry overwrites it each tick.
- Existing bounded residual-contact behavior and failure atomicity remain intact. **Met** — the
  collision path is untouched; authored drive enters through the existing grounded actuation.
- TUI motion behavior is unchanged except where contract resolution corrects a measured defect.
  **Four measured defects corrected**, listed below.

#### Phase 3 findings: four defects the cutover corrected

**Ordered speeds were being read as metres per second; they are multipliers.** `scale_motion_vector`
normalised the command's vector and rescaled it to `forward_speed`. ACE passes
`InterpretedState.ForwardSpeed` straight into `movementParams.Speed`, which becomes the motion
table's `speedMod` (`MotionInterp.cs:460`, `MotionTable.add_motion`). A speed of 3.5 meant "3.5x",
not "3.5 m/s". `MotionOrder::from_snapshot` now passes it as the multiplier retail applies.

**The local frame is confirmed independently: local +Y is forward, local X is sidestep.**
`CMotionInterp::get_state_velocity` (`acclient.c:329852-329871`) writes sidestep into `v->x` and
forward locomotion into `v->y`. That explains the census exactly: all 441 explicit motion-data
velocities are X-dominant because explicit velocity is overwhelmingly a *sidestep* feature, while
authored root translation is Y-dominant in 297 of 341 animations because forward locomotion is
authored as root motion. The two were never in conflict; they describe different axes of the same
frame, which is why the eight records carrying both agree 8 of 8.

**The local motion frame was an artefact of the deleted derivation.**
`world_velocity_from_local_basis` treated local X as forward, because `derive_animation_forward_speed`
stored a *magnitude* in X. Explicit motion-data velocity is a real local vector: 441 records carry
one and every one of them is X-dominant, while authored root translation is Y-dominant in 297 of 341
animations. The eight records that carry both agree on the axis, 8 of 8, which proves they share one
frame and that content simply authors different motions along different axes. Authored offsets are
now placed by `pose.rotation.rotate_vector`, which is retail's own
`Frame::combine(newFrame, m_position.frame, offset)`.

**Turn commands are dual-class and were being resolved as cycles only.** `0x6500000D` carries both
the substate and modifier class bits, and retail tries the substate branch first
(`acclient.c:324230-324400`). Real content uses both maps: 284 tables define turn-right in `Cycles`
and 300 in `Modifiers`. The old reduction only ever looked in `Cycles`, so a table that defines
turning as a modifier resolved to no turn at all. Selection now follows retail's branch order and
falls through.

**Sidestep was decoded and discarded.** `sidestep_command` and `sidestep_speed` had no consumer.
They are now part of `MotionOrder` and reach selection alongside forward and turn, closing that debt
row.

#### Phase 3 findings: tracking cannot depend on playback

A body is tracked for simulation the moment it arrives, before any tick has run. The old basis was
derivable statelessly from the motion snapshot; the authored one is not, because playback has to
have advanced at least once to produce an offset. `body_has_simulatable_projection_basis` therefore
falls back to a stateless question — has this body been ordered to perform a motion, and does it
have a table that could model it — rather than requiring a body to be simulated once to discover
whether it is worth simulating. This surfaced as a test failure, not by inspection.

#### Phase 3 concessions

- **The Explorer's converter has no production caller yet**, by design: its only actuation source
  coasts every body until Phase 6 ships the entity motion-command UX. It is covered by three focused
  tests instead.
- **Object scale is threaded but not sourced.** `authored_grounded_actuation` takes it as a
  parameter and `gate_authored_offset` applies it to translation only; `BasicSpatialPhysics` passes
  `1.0` because it has no entity access at that layer. The Explorer caller in Phase 6 supplies the
  real `obj_scale`.
- **The registry forgets bodies that stop being driven.** Each tick's collection is authoritative:
  an entity that dies, acquires a directive, or loses its motion table drops out and its cursor with
  it. That matches the plan's "authored drive is per-tick and never persistent", but it does mean a
  body that briefly stops being driven restarts its cursor rather than resuming.

### Phase 4: Make Dynamic Contact Consume Rigid Paths

Progress: **complete 2026-08-20.** The tick's end orientation is now produced once, by the solver,
and both the scene commit and dynamic contact read it.

#### Deliverables

- Sample mover and target position and orientation from their planned rigid paths.
- Remove synthetic endpoint rotation reconstruction from retained omega.
- Keep deterministic directional response, bounded adaptive slicing, reporting, settled-state, and
  spatial-index rules unchanged unless evidence requires revision.
- Re-solve accepted prefixes without advancing or replaying the cursor twice.

#### Acceptance Criteria

- Rotating offset spheres and physics-BSP targets collide against the same trajectory presented to
  downstream consumers. **Met by construction** — one `commit.pose.rotation` now feeds both the
  dynamic narrow phase and the scene commit, so they cannot disagree.
- Dynamic clipping updates the accepted path and physical response without mutating sequence time.
  **Met structurally** — `solve_physical_body_tick` takes a collision scene and a spatial body and
  has no access to the motion registry, so a partial re-solve is incapable of advancing the cursor.
  The compiler enforces this rather than a convention.
- Existing 50/300-body convergence and budget gates remain within the recorded envelope or trigger a
  documented resteer. **Met** — unchanged and passing; the change is a de-duplication, not a
  behavioral one.

#### Phase 4 findings

**The tick's end orientation was computed in three places.** The solver produced a pose whose
rotation carried the facing decision; then `SpatialScene` integrated retained omega onto it, and
`dynamic_contact::planned_rotation` independently integrated the same omega onto the same rotation to
predict the endpoint. All three agreed only because they ran identical arithmetic on identical
inputs — the definition of a fact derived more than once.

`solve_physical_body_tick` now applies physical omega to the accepted pose after the response has
chosen the body's facing, which is retail's order: authored rotation is composed locally into the
offset first, then physical omega rotates the already-composed world frame globally
(`acclient.c:306106-306153`). The other two derivations are deleted. `planned_rotation` and the
`delta_seconds` that only existed to feed it are gone from the dynamic-contact pair.

**One behavior did change, in the correct direction.** `physical_body_scene_residency` is evaluated
on `commit.pose`, which now carries the tick's rotation instead of the pre-rotation facing. For a
body with offset spheres that is the pose it actually ends the tick in, so residency now reflects
where the body is rather than where it was mid-derivation.

**Nothing broke, and that is the evidence.** The change is arithmetically identity-preserving: the
value dynamic contact used to compute is exactly the value it now reads. A new test asserts the
solver produces it, so a future edit that stops integrating omega in the solver fails loudly instead
of silently freezing every rotating body.

### Phase 5: Unify Root Presentation and the Playing Clip

Progress: **complete 2026-08-20. Rescoped by D8, D9, D11, and D12.**

**Done.** The projection exists, is sampled after each host advance, rides the per-tick
`DynamicEntityAdvance` alongside the accepted path, and is validated by the frontend feed schema.
Four host tests cover it, including that a body with no clips projects nothing rather than letting a
frontend invent a pose.

**Rescoped.** D8 drops the frame number and the authoritative framing; D9 settles how the animation
assets are warmed and shared. Both change what remains, not what is built.

**Also done 2026-08-20**, in dependency order:

1. `PlayingMotionClip` replaces the cursor projection, published on **change** rather than every
   tick. `SequenceTick::completed_clips` deleted.
2. `Animation::read_simulation_facts` seeks past part transforms instead of materialising them.
   **Contract build: 260 ms to 158 ms**, and 52.10 MB of transient allocation gone. Contract facts
   unchanged.
3. `Animation` joined the host decode cache at 2,048 records — sized to hold every table-reachable
   animation, so eviction cannot happen *inside* a closure being staged. `ContentAsset::Animation`
   is now shared rather than owned.
4. `AnimationAssetRepository::acquireMotionClosure` mirrors the physics-script closure: the host
   resolves the reachable set from the contract, acquisition is all-or-nothing, and it is awaited in
   the existing preparation as a fourth lane with its own release path.
5. `prepareMotionPlayback` computes the **union bound** across the closure and the playable clip set
   — see D11.
6. The runtime clip swap, which turned out to be a collapse rather than an addition — see below.

**The clip swap subtracted more than it added.** `AnimationRecord` held a bare `PreparedAnimation`
and traversed it whole, forward, at a fixed rate; a motion clip needs a window and a signed rate.
Rather than branch on which kind of playback a record holds, the three inter-dependent facts became
one type — `PlayingClip { animation, lowFrame, highFrame, framesPerSecond, completion }` — and a
setup-default resident is now the `wholeAnimationClip` case of it. `advancePlayingFrame` and
`sampleAnimationPose` take the clip instead of loose parameters, so a window can no longer be paired
with the wrong animation, and terminal behavior cannot contradict the host sequence that owns it.

`AnimationSystem.install` was deleted in the same change: `stageOwner` is the only path production
ever used, and the tests that called it now stage and commit like production does.
`playClip(ownerId, target, clip)` replaced it as the single-record install-or-replace, guarded by the
same target generation and invalidating `#latestAdvancedFrame` exactly as staging does. Phase is now
the caller's policy rather than the record's: a staged resident replays an identity-derived offset so
neighbours desync, and a host-projected clip replays nothing because it must start where the host
started it.

Routing needed one new fact. `SpawnedDynamicPresentationRecord` carried only the host's *semantic*
generation, while behavior targets carry the *dynamics owner* generation; the two are different
counters. It now carries `behaviorGeneration`, so a projection in flight when an entity was replaced
cannot install onto its successor.

**D12** records why cyclic tails lap while one-shot transitions hold at their far bound.

#### Phase 5 findings: the browser harness could not stage motion at all

Running the end-to-end scenario found that `HttpLandblockContentSource.loadMotionTableClosure` was a
deliberate throw — the dev content host served no motion contract — so **every** motion-table entity
failed activation under the harness, which is the only runtime surface an agent can drive. The dev
host already builds the same `MotionSequenceCatalog` the Tauri app does and simply kept no handle to
it. `load_motion_table_closure_ids` is now shared by the Tauri command and a new
`/motion-table-closure` endpoint, so the harness stages exactly what the app stages.

#### Phase 5 evidence: the swap observed end to end

`npm run harness:browser -- --landblock 0xda55ffff --building-radius 0 --explicit-object-radius 0
--generated-object-radius 0 --spawn-wcid 7 --spawn-simulated --entity-ticks 40`, against production
dats, spawning a Drudge Skulker (motion table `0x09000008`):

| stage | `activePlaybackCount` | `animationResources` |
| --- | --- | --- |
| after activation | **0** | 42 assets, 42 references |
| after 40 ticks | **1**, 1 sampled, 1 semantic step | 42 assets, 42 references |
| after despawn | 0 | 0 assets, 0 references |

The entity activates with its whole 42-animation closure staged and no playback — holding its
authored static pose, exactly as an entity with no playback already does — and gains playback only
when the host names a clip.

**Exactly one of the forty advances carried a clip.** Advance 0 named `0x0300057D` over window
`[0, 29]` at rate `+30` — a one-second forward idle loop. Advances 1-39 carried `null`, because the
host publishes on change and a looping idle never changes. Playback was still live and still
stepping at advance 40.

That is the looping half of D12 measured rather than argued. The clip laps roughly 1.3 times across
those 40 ticks; its projected `loop` completion prevents a receiver from rendering a statue when no
further projection arrives.

#### Phase 5 findings: the host decodes what it throws away

`read_motion_sequence_catalog` decodes every animation with `Animation::read`, which materialises
`part_frames` as a `Vec<Frame>` of `num_parts` per frame — **52.10 MB of articulated part data on the
full profile** — and the projection then keeps the root track and the hooks and drops all of it.
Later, when the frontend asks for one of those same animations, `ContentAssetRequest::Animation`
reads and decodes it again from the archive, uncached and unshared.

So the host allocates and frees 52 MB it never wanted at startup, and re-decodes the same records one
at a time afterwards. Measured build time is 260 ms, most of it this.

It cannot skip *parsing* part frames — simulation hooks live inside them — but it does not have to
materialise the transforms. A hooks-only decode that walks the frames and seeks past the transforms
removes both the startup cost and the transient allocation, and it targets exactly the profile with
the problem: on micro and pruned `num_parts` is already zero, so the path is free there.

#### Phase 5 findings: staging motion is an existing pattern, not a new one

An earlier draft of this phase proposed warming animations asynchronously after spawn. The codebase
already stages transitive dependencies *before* activation — physics-script closures and their
emitters — specifically so a miss at frame time is a staging defect rather than a runtime state. The
async proposal would have made a mid-playback miss legitimate, and silently: nothing would fail, an
entity would occasionally play the wrong clip through a transition, and the cause would be invisible.
D9 follows the existing pattern instead.

#### Phase 5 findings: the host had no asset lifecycle for motion

The Explorer holds an `Arc<MotionSequenceCatalog>` for the process lifetime: every table and every
animation, decoded at startup, never refcounted and never evicted. Entity spawns load nothing because
nothing is left to load. That was an accident of how startup was wired rather than a decision; D10
ratifies it, with the 6.51 MB measurement and the invariant argument behind it.

The rest of the host content pipeline does have a cache — `ContentDecodeCache`, per-type LRUs for
cell landblocks, env cells, environments, scenes, setup models, gfx objs, and palettes. Animations
and motion tables are in none of them, which was harmless while nothing host-side wanted them and is
a gap now that warming will request 321 of them per character spawn.

Capacity is counted in **records, not bytes**. Ratified as acceptable for now (2026-08-20): the
motion footprint is small and the failure mode is a re-decode, not a leak. Recorded as debt so the
choice is visible if a byte budget is ever needed.

#### Deliverables

- Rename the projection to what it is — the clip that is playing — and drop `frame_number` per D8.
  It carries clip identity, the resolved traversal window, and the rate. Publish it on **change**
  rather than every tick.
- Delete `SequenceTick::completed_clips`, which D8 leaves with no consumer.
- Add a hooks-only animation decode and use it for the projection, so startup does not materialise
  52 MB of part frames it discards.
- Add `Animation` to the host decode cache so warming shares one decode across every entity on a
  table, rather than re-reading the archive per request.
- Give `AnimationAssetRepository` an `acquireClosure(motion_table)` mirroring
  `PhysicsScriptRepository::acquireClosure`: an acyclic traversal over cycles, modifiers, and links,
  all-or-nothing, refcounted per animation. Await it in the existing preparation before activation,
  per D9. Report the resident set size.
- Let the frontend swap the playing clip when a new projection names a different one, entering at
  the low or high frame according to the rate's sign.
- Let the frontend advance within the current clip's window at render rate, lapping cyclic tails and
  holding one-shot transitions at their terminal pose per **D12**. It never selects the next clip:
  which clip follows is link resolution against host state it does not have.
- Accept only terminal-pose hold during the sub-33 ms projection gap at a 30 Hz host. Prediction is
  an eventual option for reducing that hold, never a shared mutable cursor.
- Keep the placement subsystem as the sole scene-root writer.
- Let animation sample articulated parts and presentation hooks from the playing clip while dropping
  root position frames from visual application.
- Preserve generation-safe late readiness, replacement, pause/resume, and timeline reset.

#### Acceptance Criteria

- Root contribution is applied exactly once.
- Solver pose, body-to-body sampling, and rendered root agree at named tick fractions.
- No frontend contract carries the root track, and none carries a host-authoritative cursor.
- Frontend clip advancement cannot affect placement, because placement comes from the accepted path
  regardless — verified by advancing the frontend clip without a host tick and observing no
  positional change.
- The frontend never advances past the clip's far bound on its own, and never selects the next clip.
- A reversed clip is entered at its high frame and a zero-rate clip holds, so the 17,242 negative and
  11,182 zero-rate authored windows play as authored.
- A possessed entity's rendered idle comes from its motion table, and static scenery still animates
  from `SetupModel::default_animation`.
- An entity activates only once its whole motion closure is staged, so a clip reached mid-playback
  can never trigger a load at frame time — the rule `physics-script-system.ts:346` already relies on.
- A failure anywhere in the closure releases every handle taken so far, so a partially staged entity
  cannot activate.
- The resident animation set is reported rather than silently grown.
- Startup no longer materialises part frames the projection discards, measured against the 260 ms
  baseline.
- Late or superseded asset work cannot move a replacement entity.

### Phase 6: Possession and the Explorer Command Surface

Progress: **complete 2026-08-20.** `ExplorerEntityRegistry` owns a `MotionRuntimeRegistry`, every
spawned entity plays its motion table's idle, and a single **possess** toggle routes commands and
drive keys to one entity. Three host tests cover it, plus nine frontend tests over the command
translation and three over the session boundary.

#### Deliverables

- Give Explorer dynamic entities a `MotionRuntimeRegistry`, advanced once per host tick alongside the
  existing dynamic collection, exactly as `WorldState::advance_authored_motion` does for the client.
- Replace `dynamic_entity_coasting_actuation` for possessed entities with
  `motion::authored_grounded_actuation`, supplying the real `obj_scale` the client path passes as
  `1.0`.
- Ship a single **possess** toggle on a spawned entity. Possession routes commands to that entity and
  attaches the camera to it; attachment and control are logically separable but ship as one state
  until something needs detached observation.
- Route input to the possessed entity as a `MotionOrder`. The Explorer's existing
  `GroundedCharacterDrive` already carries the same four axes and its newest-first key arbitration is
  retail-cited; reuse the arbitration, retarget the destination.
- Add a stance selector, so style changes have a producer. Style is the least-covered branch of
  `select_motion` and the one that makes idle interesting: a stance change plays a transition and
  lands on a different idle cycle.
- Surface which commands the possessed entity's table actually models.
  `MotionSelectionOutcome::Unmodelled` already reports this per command, so the UX reads it rather
  than re-deriving it.
- Remove the Explorer semantic-motion capability boundary and the WCID 36449 Bats root-rotation
  divergence.

#### Acceptance Criteria

- A possessed entity's idle comes from its motion table's default style and substate, not from
  `SetupModel::default_animation`. **Met host-side, not yet visible.** Every spawned entity is driven
  from its table's default style and substate, and the clip it is on reaches the frontend as a cursor
  projection. The renderer still selects its animation at preparation time from the setup default, so
  the *rendered* idle does not change until Phase 5's frontend half lands.
- Possessing an entity whose table does not model a command reports it rather than silently doing
  nothing, and the UX reflects it before the command is issued. **Met** — `possess` returns the
  modelled locomotion set read from the contract, `restrictToModelled` drops the rest before an
  order is sent, and the panel renders what the entity can do.
- A stance change plays its transition clip and lands on the new style's idle. **Met host-side** —
  the stance selector issues a style command through `MotionOrder`, and `select_style` plays the
  transition. Visible with Phase 5's frontend half.
- Static scenery still animates from `default_animation` and is unaffected. **Met** — an entity with
  no motion table, its own or its setup's, gets no playback and no cursor.
- No composition owns a second sequence resolver, and the Explorer reads motion facts only through
  the shared contract. **Met** — the Explorer holds a `MotionRuntimeRegistry` and a
  `MotionSequenceCatalog` and calls the shared selection; it decodes no motion content itself.

#### Phase 6 findings

**The motion table was the one content identity the entity definition did not carry.**
`DynamicEntityContent` had `setup_did`, `sound_table_did`, and `physics_effect_table_did` but no
`motion_table_did`, so an entity could not name the table it animates from. Added, populated from the
weenie template on the Explorer path and from `MotionTableDID` on the client path, with the setup
default as the fallback retail uses.

**A possessed body has to be woken, and the reason generalises.** A body that proves stable support
drops out of the collection scan. Authored drive arrives through the actuation closure that scan
invokes, so a settled body can never be driven by it — the drive would need the body to already be
awake. Waking is decided by `MotionSequenceRuntime::contributes_motion`, a property of what the
playback installed rather than of how large a tick's offset came out. That is the same distinction
Phase 3 settled for the client basis, arrived at independently.

**Authored drive leaked into retained momentum at exactly one boundary.** The grounded solver stores
achieved velocity as the body's velocity, which is right while driving and right at a ledge — retail
synthesises launch momentum from the command too. But on *release*, coasting inherited it and the
entity slid on after the command that produced it. `release_possession` now clears planar velocity
and leaves vertical alone, because falling is real physical momentum the authored path never wrote.
Found by a test asserting the plan's own rule that authored drive is never persistent.

**Every entity plays, not only the possessed one.** Retail installs the setup's motion table for any
non-static object, so an unpossessed entity idles from its table rather than standing inert. Driving
all of them costs almost nothing: 1,585 of 1,938 referenced animations author no root motion at all,
so their playback reports no motion and they stay settled.

#### Phase 6 concessions

- **Possession takes the drive keys from the grounded-walk camera while held.** They are never both
  driven, so possession simply wins. A dedicated input owner is created on possess rather than
  reusing the camera's, so driving an entity does not depend on which camera is running.
- **Jump and reset edges have no possessed-entity consumer.** The entity command surface carries
  locomotion only; a launch is already a separate host operation.
- **The stance list is a fixed set of seven styles.** Which stances an entity can actually enter is a
  property of its table's links, and reporting that needs a second contract query. Listing the
  common ones and letting an unmodelled style resolve to nothing is honest for a first pass.

### Phase 6b: Boom-Arm Follow Camera

Progress: **complete 2026-08-20.** Rescoped by D13, then built. Split out by D7 so camera work
cannot swallow motion work.

The camera keeps `(yaw, pitch, desiredDistance)` about the possessed entity's head and derives its
world position every frame. It is not a physical body in this mode. The host answers one question,
once per tick, and knows nothing about booms.

#### Deliverables

- A frontend boom controller holding `yaw`, `pitch`, `desiredDistance` and their velocities, deriving
  position as `anchor + rotate(yaw, pitch) * (-renderedDistance)`.
- Pan and zoom as velocity on those scalars, so both are smooth by construction rather than by a
  post-hoc filter.
- One host sweep query per tick — anchor, direction, maximum distance, returning the achievable
  distance. `solve_physical_fly` already computes it as a pure function; this exposes it, and must
  not grow camera vocabulary on the way out.
- `renderedDistance = smoothAsymmetric(min(desiredDistance, sweepResult))`: pull in immediately,
  ease out damped. Required, not decorative — the clamp alone snaps several metres in one frame when
  rounding a corner.
- A minimum boom distance, so a fully pinned camera stops at the entity's back rather than inside it.
- Keep every scalar, rate, and damping constant in `apps/holtburger-3d` under the app boundary rule,
  and somewhere findable rather than buried — these are exactly the numbers that get tuned.
- Make the tick ordering intentional. `explorer_entity_tick_slot` is reserved before the camera's
  slot and participants iterate a `BTreeMap` in slot order, so the entity already solves first every
  tick — but that is a property of construction order in `lib.rs` with nothing recording it. Name and
  comment the dependency.

#### Known limits

- `solve_physical_fly` sees **static collision only**. Convenient — the possessed entity cannot
  occlude its own camera — but the boom will not be pushed by other creatures. Acceptable for an
  explorer; recorded so it is not rediscovered as a bug.
- The clamp is one tick stale against a moving anchor and a turning view. See D13's known cost.
- **Occlusion is still not detected, and the frontend must not pretend to detect it.** The clamp
  answers "how far back can I go along the boom", which keeps the camera *out of* geometry. It does
  not answer "is something between me and the entity" — a pillar the boom passes beside rather than
  into still occludes. `PhysicalCameraMotionPath` carries no line-of-sight fact and collision
  geometry is host-only, so this is invisible to frontend policy; rendered geometry is a different
  set and would answer a different question.

  First implementation accepts transient occlusion. The escape hatch is a second sweep, head toward
  camera, reported alongside the first. Deliberately not taken now: the failure that would justify it
  does not exist yet.

#### Risks

- **Coordinate frames.** The anchor is entity-derived and scene/landblock-anchored while the camera
  works in world space. The frontend already converts for free fly, but the boom is a new contract
  joining two frames, which is exactly where an unbranded `Vec3` slips through. Brand the anchor at
  the producer that knows its frame.
- **Two sources of yaw/pitch.** Free fly already owns a view direction. Possession must hand
  authority over cleanly rather than letting both write, or release will pop.

#### Acceptance Criteria

- [x] The host gains exactly one query and no camera vocabulary.
- [x] The camera never ends up in front of the entity — true by construction, since position is
      derived along the boom direction from the anchor, and covered by a test at four orbits.
- [x] Backing hard into a corner settles at the minimum distance rather than inside the entity.
- [x] Releasing possession returns the camera to free fly without a discontinuity, because
      `applyPresentedPosition` has been writing the boom's position to the look controller all
      along; only translation authority changes hands.
- [~] The camera follows with visible lag and settle; pull-in and ease-out behave. *Unit-covered at
      the state level and the sweep is measured against real collision, but the composed visual
      result has not been watched. Possession is not yet drivable from the browser harness, and the
      Tauri client is the user's to run.*
- [~] Pan and zoom are smooth while the entity is moving and while the clamp is active. *Same gap:
      the rates are frame-rate independent by construction and covered, but unwatched.*

#### Phase 6b progress

**Host: one query and no camera vocabulary**, as the acceptance criterion required.
`HostSimulationRuntime::sweep_sphere_distance` names a sphere, a start, a direction, and a budget,
and answers a distance; `solve_physical_fly` already computed it, so no solver code was written. It
registers nothing and retains nothing, so a caller may ask every tick. An over-budget request is
**refused rather than truncated** — a silently shortened sweep reads as "geometry is here" and would
pull a boom in for nothing. Four tests cover the wrapper's own contract; collision behaviour stays
`physical_fly`'s to prove.

**`scene_point_to_pose` came out of the camera module** rather than being copied. It was generic
scene-to-world conversion wearing camera error messages, and both the new command and the existing
camera now share it from `placed_motion_presentation`. That is dissolution work done early because the
alternative was a second copy.

**Frontend: the boom owns length, and nothing else.** An earlier draft had it integrating its own
yaw and pitch, which would have created the second orientation source this phase's own risk list
warned about. Deleted: pointer look already produces orientation, and the physical-camera path
already overrides only *position* while leaving orientation to the same controller. The boom follows
that established pattern exactly — `applyPresentedPosition` every frame — which is also why release
needs no handoff logic. `setLocalTranslationEnabled(false)` transfers drive keys to the entity, the
same way a physical camera claims them.

**The sweep is asynchronous and the camera never waits.** At most one request is in flight, its
answer applies whenever it lands, and a generation guard stops a superseded session's answer from
clamping a later one. A failing sweep reports through the existing camera-error channel rather than
throwing into the render loop.

23 frontend tests plus the 4 host tests. `httpBoomSweepSource` gives the browser harness the same
query the app uses.

#### Phase 6b evidence: the sweep measured against real collision

A camera-level assertion cannot distinguish a working sweep from one returning a constant, so the
harness asks the boom's own question directly in two directions from a settled entity
(`sweepSphereDistance` on the harness API, reported as `boomSweepProbe`).

`npm run harness:browser -- --landblock 0xda55ffff --building-radius 1 --explicit-object-radius 1
--generated-object-radius 1 --camera-position 42087,37.9,-16638.4 --spawn-wcid 7 --spawn-simulated
--spawn-distance 3 --entity-ticks 60`, probing from 1 m above the settled entity with a 0.3 m sphere
over a 6 m budget:

| direction | travelled |
| --- | --- |
| down | **0.703 m** |
| up | 1.696 m |

`0.703 + 0.3 = 1.003`: the sphere's surface reaches the terrain the entity is standing on, which is
exactly the metre the probe started above it. Two directions, two different answers, one shortened
from the 6 m requested — the sweep is measuring geometry rather than reporting a budget.

**The probe found its own defect first.** An initial run answered 6 m in *both* directions because it
used the entity's spawn pose; a simulated body falls to terrain over its first ticks, so it was
measuring empty air several metres up. It now probes the latest accepted pose.

#### Phase 6b findings

The evidence behind D13, gathered 2026-08-20 before writing any code. Retained because each fact
was load-bearing for the rescope and none of it is obvious from reading the modules.

**The sweep primitive was never the hard part.** `solve_physical_fly` is a pure function over
`&CollisionScene` that does not touch registered body state and already returns
`achieved_displacement` and `collision_normal`. Every design considered here — stateless sweep,
chasing body, and the ratified spherical state — needed no new world-crate solver code. What varied
was only where the *dynamics* live, and two of the three put them in the wrong place.

**There is no positional constraint system in `holtburger-world`.** The two things named
"constraint" are something else. `PhysicalBodyTick::constraint_count` is a *diagnostic* counting
distinct non-walkable surfaces a grounded solve hit, and `upper_constraint` is the second sphere of
retail's grounded body pair. No leash, spring, or attachment exists anywhere.

**The constraint census found no surviving consumer.** The one candidate was designed away:

| Candidate | What it actually is |
| --- | --- |
| Viewer sphere | Rigid offset from the body plus one cell-transit query |
| Attached entities (held items) | Rigid, `pose-only` participation; never solved |
| Boom camera | Resolved by D13 into three scalars and a clamp; no leash needed |

**The viewer sphere has zero degrees of freedom.** `transit_presented_viewer_path` takes the body
solve's own motion waypoints, adds a fixed offset to each centre — interpolating only between the
tick's initial and final view direction, so a turn spreads across the tick instead of concentrating
in the first substep — and calls `CollisionScene::transit_motion_path`, which resolves *cell
membership*. There is no collision response, and a `debug_assert` requires viewer and body **not**
to diverge. Its "independent resolution" is portal placement, not physics.

**`HostSimulationRuntime` is already the generic body service.** It registers bodies, owns the
scene, and ticks them. `HostCameraRuntime` and `ExplorerEntityRuntime` are both thin policy adapters
above it, differing mainly in single-body-transaction versus collection tick.

### Phase 7: Cleanup and Architecture Audit

Progress: **complete 2026-08-20.**

The `HostCameraRuntime` dissolution was scoped here mid-flight by D13 and has **moved** to
`holtburger-possessed-entity-controller-surface-plan.md` as its Phase 4. It belongs there: it is
camera architecture rather than authored root motion, it depends on that plan retiring
`GroundedWalk` first, and keeping it here left this plan reading "incomplete" when its actual scope
was finished. The ten-row guarantee census moved with it intact.

**The vocabulary was mostly already swept.** `MotionKinematics` and synthetic rotation sampling had
no code references left — only stale prose. What remained:

- **`MotionState` renamed to `CharacterDrive`** in `holtburger-core`, with its builder and the
  builder's own `state` field. `holtburger_world::motion::MotionState` keeps the name: it *is*
  retail's motion state machine, and anyone cross-reading the decompile should land there. The core
  type was the misnomer, and its parameters were already named `drive` everywhere — only the type
  lied.
- **`MotionOrder` does not absorb it.** The plan left this open. An order names concrete
  motion-table commands and speed multipliers; a drive names intent with no table vocabulary at all.
  Collapsing them would push table knowledge into the controller layer, and the mapping between them
  is exactly what the resolvers exist to perform. Recorded on the type itself so the question is not
  reopened blind.
- **`GroundedCameraDriveRequest` no longer survives** just because it was an independently
  versioned serde boundary. **Closed 2026-08-21:** the possessed controller cutover retired the
  entire synthetic grounded-camera route, so this wire type was deleted rather than renamed.
- The one surviving `reduced asset` reference was a test constant. The assertion is real — authored
  root motion reproduces content's measured 2.6017 m/s walk — so the constant became
  `MEASURED_WALK_SPEED` with the deleted mechanism's provenance kept as a comment.

**Documentation caught up with two genuine gaps.** Neither `holtburger-world` nor
`holtburger-content` had any architecture entry for the motion work: the `motion/` module and the
`MotionSequence` contract were substantial new code documented nowhere. Both now have sections,
including the `MotionState`/`CharacterDrive` collision stated explicitly so the next reader does not
rediscover it. `docs/hba_format.md` was already current.

**Roadmaps: one corrected, two left alone.** `holtburger-3d-dynamic-entity-runtime-plan.md` is a live
roadmap that claimed the Explorer milestone "leaves existing `MotionKinematics` unchanged" — now
false and actively misleading, so it is struck through with what superseded it. The spawned-entity
and convergence plans are marked Preempted and Complete; those are history and stay as written.

#### Deliverables

- Delete reduced-authority vocabulary, synthetic rotation sampling, and obsolete tests and comments;
  sweep renamed vocabulary through crates, apps, docs, UI labels, and harness output.
- Update crate architecture docs, `docs/hba_format.md` profile documentation, and the
  dynamic-entity roadmaps.
- Sweep the `MotionState` name collision: `holtburger_core::client::movement_types::MotionState` is a
  drive intent, not a motion state, and now shares its name with retail's actual one in
  `holtburger_world::motion`. Rename the core type, and decide whether `MotionOrder` absorbs it
  rather than becoming a fourth spelling of the same four locomotion axes.
- Record surviving debt explicitly: the two solver stacks and their tripwire,
  `SpatialSolveRequest::local_drive`, the carried-but-unconsumed `Attack` and `Ethereal` hooks, and
  the unimplemented global physical omega. The camera's leave-ground drive formula is no longer on
  this list — it is *closed* by the dissolution below rather than carried.
- Run workspace Rust and 3D frontend gates plus focused retail fixtures and browser scenarios.

#### Acceptance Criteria

- Motion selection, authored integration, accepted placement, and frontend articulation each have
  one named owner and no competing path.
- Every remaining velocity is explicitly physical, authoritative, controller-capability data, or a
  documented derived optimization.
- No compatibility alias or dead reduced asset survives, and surviving debt is named rather than
  implied.

## Known Debt Carried Forward

Recorded so it is chosen rather than forgotten. None of these are fixed by this plan.

| Debt | Why deferred |
| --- | --- |
| Two solver stacks; Explorer bypasses `SpatialPhysics`. **Concretely**: authored offset to actuation is converted twice — `resolve_body_projection_input` to `SolveProjectionBasis::AuthoredDrive` to `spatial/physics.rs` for the client, and `ExplorerEntityRuntime::actuation` to `authored_grounded_actuation` for the Explorer. Both are live and both call `gate_authored_offset`, so the *support rule* is single-sourced; the conversion around it is not | D4, re-read 2026-08-20 and **still correct**. Its tripwire — a server-driven remote entity, or client mode needing collision — has not fired. The reasoning is now better supported than when written: D4 argued two honest implementations beat one imagined consumer, and we have exactly that. The shared shape (`gate_authored_offset`, the offset contract) is visible, and the unshared shape is the velocity-only basis and `local_drive` D4 predicted would contort a premature trait. **When the tripwire fires, the duplicate conversion above is the named starting point for the extraction** |
| `SpatialSolveRequest::local_drive` as a sibling intent channel | Belongs to TUI adaptation after the Explorer-led design settles |
| `Attack` and `Ethereal` hooks carried but unconsumed | Combat and collision-state systems are future work; the contract preserves them everywhere so that work needs no re-plumbing |
| ~~Two public types named `MotionState`~~ **Closed 2026-08-20**: the core type is now `CharacterDrive`. Original entry retained for the reasoning: | `holtburger_core::client::movement_types::MotionState` is controller intent (`gait`, `longitudinal`, `lateral`, `turning`), while `holtburger_world::motion::MotionState` is retail's motion-table state machine (`style`, `substate`, `substate_mod`, modifiers) | Different crates, so nothing collides at compile time — which is exactly why it will go unnoticed. The world type is named after retail deliberately, so anyone cross-reading the decompile lands there; the core one is the misnomer, being a drive intent rather than a motion state. Rename during the Phase 7 vocabulary sweep |
| ~~The same four locomotion axes are spelled three times~~ **Closed 2026-08-21:** the frontend spelling is now the shared `CharacterDrive`; the grounded-camera Tauri wire type was deleted; core `CharacterDrive` remains intentionally distinct from authored `MotionOrder` | The removed wire type earned an independent boundary only while its camera consumer existed. Possession now carries one semantic wire DTO and resolves that intent to authored orders at the host-owned policy boundary |
| ~~`resolve_character_drive` computes continuous grounded movement with retail's leave-ground formula~~ **Closed 2026-08-21** by `holtburger-possessed-entity-controller-surface-plan.md` Phase 4: the synthetic grounded camera, resolver, export, and continuous-drive tests were deleted | `CMotionInterp::get_state_velocity` (`acclient.c:329840-329875`) is reached only from `get_leave_ground_velocity` (`:330078`), so its hardcoded `3.12` walk, `4.0` run, and `1.25` sidestep scalars remain used only to resolve jump launch velocity. Ordinary possessed locomotion is authored root motion through `CSequence` |
| The motion contract is held for the process lifetime: every table and animation, decoded at startup, never refcounted or evicted | Ratified 2026-08-20. The footprint is small — 1.85 MB over the cycle-reachable slice before hash-map overhead — and the alternative is a lifecycle for a contract that every entity may reach at any moment. Recorded so the permanence is a decision rather than an accident of startup wiring |
| `ContentDecodeCache` bounds each type by **record count, not bytes**, so 8,192 gfx objs could be 5 MB or 500 MB | Ratified as acceptable 2026-08-20: the failure mode is a re-decode rather than a leak, and byte budgeting is its own investigation rather than a drive-by capacity change. Revisit if host memory ever becomes a real constraint |
| ~~Physical omega is never represented as a global rotation~~ **Split 2026-08-20 into the three situations it was conflating.** As one row it misled repeatedly: retail has *two* omegas on two objects, and this row named neither precisely | Superseded by the three rows below |
| **1. Sequence omega — not debt.** `MotionData.omega`, applied by `CSequence::apply_physics` through `Frame::rotate` (`acclient.c:326382`), which is a **local** rotation about the offset's own axis | We match exactly: `MotionSequenceRuntime::apply_physics` calls `RigidTransform::rotate`. Census 2026-08-20: 1,843 of 19,673 cycle and modifier entries across all 436 tables author non-zero omega, every one about vertical. Retail is local here regardless of axis, so we would match a tilted spin too. Nothing outstanding |
| **2. `SetOmega` hook applies to the visual root, not the body** — a deliberate `RETAIL DIVERGENCE`, marked on `EffectSystem.applySetOmega` | **Not capability-limited.** `SpatialBody.omega` exists and `integrate_angular_velocity` applies it in retail's `delta * rotation` order, so a body *could* carry this. It stays visual because of the carriers: census 2026-08-20 found 8 hooks in 8 animations across 8 setups, of which **5 are scenery-only** and own no spatial body, and the 3 spawnable ones (WCIDs 3654, 10698, 10699) are all `ethereal + ignore_collisions` and resolve to `Suppressed`. Routing to body omega would be impossible for five and observationally identical for three — two mechanisms for one hook, buying nothing. Closed as a decision, not carried as debt |
| **3. Body angular velocity is implemented; its producer awaits a server.** Corrected 2026-08-20 — an earlier reading of this row claimed no solver could represent a global rotation, which was simply untrue | `SpatialBody.omega` -> `integrate_angular_velocity` -> `commit.pose.rotation`, in retail's `grotate` order. Its live producer is `handlers/movement.rs:114`, the server-sent velocity/omega update (retail `acclient.c:137336`), which is dormant only because the Explorer has no server. Retail's other writer reads `PhysicsDesc.omega`, a **server description** field that the weenie catalog does not carry and that would arrive with the same client mode. Belongs with the client-mode rows below, not as an architectural gap |
| Setup models ship whole in every profile for one fact: 5,935 records so that 12 catalog templates can reach the 57 setups declaring a default motion table | Keeping only the 57 would save 1.69 MB but leave `SetupModel` partially populated in `micro`, with the completeness rule expressible only in documentation. Revisit if bundle size becomes a real constraint |
| The motion contract is projected eagerly at bootstrap, decoding every animation unfiltered on the full profile | 222 ms measured, below the recorded budget. Lazy per-table resolution is the mitigation if startup cost ever matters |
| Server interpolation offsets, which **assign** the tick's offset rather than composing with it (`acclient.c:372004-372094`) | Client-mode only; the Explorer has no server, so a basis variant would have no producer. Traced in "Phase 0 findings" for whoever builds client mode |
| Dead-reckoning constraint damping, which scales and eventually zeroes offset translation as drift accumulates (`acclient.c:372268-372296`) | Same — arrives with client mode, specified now so it is not rediscovered |
| ~~The Bats root-rotation divergence~~ **Closed 2026-08-20 by applying the frames.** Census over all 5,935 archive setups: 129 declare a bare default animation, exactly one authors root motion (setup 0x02001752 / WCID 36449, zero translation, 0.44 degrees of yaw per frame), and **zero carriers are collidable** — that one resolves to `EntityCollisionParticipation::Suppressed`. The old marker justified itself with "correcting this would route frontend animation back into collision authority", which was true of nothing in the archive. Turning root frames now drive the **visual root only**, guarded by `authoredRootTranslates` so a translating carrier is refused rather than applied, and the culling bound goes rotation-invariant when they are used | Closed, not deferred. The entry survives because the divergence was re-diagnosed wrongly three times from its own stated reason rather than from content |
| ~~The third-person boom has not been exercised while driving possession~~ **Closed 2026-08-21:** the browser harness now possesses spawned WCIDs and drives the complete control scheme through the real host boundary | WCID 1, 3, and 14 scenarios verify keyboard/entity and pointer/camera isolation, backward/turn/combined motion, jump release and landing, fallback sidestep where required, wheel-owned boom distance, and the composed boom state. Pixel inspection is not retained as separate debt because these are controller, host-pose, playback, and boom-state guarantees rather than image-quality claims |
| `apps/holtburger-3d` `check:trace` fails on `scripts/portal-work-trace.ts` | Pre-existing at HEAD and unrelated to motion: the trace script calls `ParticleSystem.collectCohorts` and passes `renderAnchorOrigin`, neither of which the current particle API has. Agent-owned diagnostic tooling, so fixing it is its own task rather than a drive-by in a motion change |
| Animated physics-BSP collision: the retail client poses BSP parts from the current animation frame, `PreparedEntityBspPart` uses the static setup transform | Measured at 10 setups, of which 4 are reachable by 7 solid catalog templates; the rest ignore collisions. Closing it would require part frames host-side, contradicting D2 for a population that does not justify it. Ships as a `RETAIL DIVERGENCE` marker with the enumerated census |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Sequence resolution becomes a stateful god service | Prefer contract values and small pure cursor and step functions; producer registries retain semantic state |
| The contract quietly becomes a second reduction | It carries per-frame root transforms, links, ranges, and rates; the standard-walk acceptance criterion fails if it reduces |
| Solver learns animation or content concepts | The contract converts motion facts into source-neutral timed rigid contributions before the spatial boundary |
| The authored offset quietly becomes retained momentum | Per-tick input is consumed, never stored on the body; blocked displacement is never retried |
| Authored rotation is treated as an angular velocity | D5 records that authored rotation is rotation in a rigid transform; only physical omega is a velocity, and it rotates globally |
| Simulation hooks lost to content filtering | Phase 1 verifies an `Attack` carrier and an `Ethereal` carrier survive filtering intact |
| The TUI bundle grows beyond what packaging tolerates | D6 is conditional on ~2.66 MB being unremarkable; Phase 1 measures the real emitted size, and D6 records what reintroducing tiering would cost |
| A baked contract asset reintroduces drift | Deferred entirely; if ever added, the baked producer must be the runtime producer run at build time |
| Deferred solver unification becomes permanent divergence | D4 tripwire names the two conditions that force revisiting |
| The Explorer grows its own motion-table reading | One shared contract is a hard rule; solver fidelity may diverge, motion semantics may not |
| Animation clock and physics step diverge | Inject one effective host clock and resolve each tick interval once |
| Frontend double-applies root frames | Placement owns root; the frontend receives the cursor, never the root track |
| The no-part-frames rule is applied where it does not hold | Multi-part animated physics-BSP setups are the named exception, measured at 10 and enumerated; the rule holds everywhere else |
| Diagnostics drive the design | Keep evidence in offline surveys, fixtures, and harness output; ship no history or trace model |

## Open Questions

**None.** Phase 0 is closed and both remaining items were answered 2026-08-19.

Sizing was verified by validating the byte model rather than by emitting a profile: predicting each
record's complete wire size from its decoded contents reproduces the archive's own size for 436 of
436 motion tables and 609 of 609 modelled animations, so the 2.45 MB figure is exact. Recorded in
"Content sizing".

The interpolated server-correction path was traced and turned out to contradict the assumption
behind the question: `InterpolationManager::adjust_offset` overwrites the authored offset rather than
composing with it. Recorded in "Phase 0 findings: server correction and teleport".

Phase 1 remains gated only on ordinary implementation review, not on unanswered questions.

## Definition of Done

- [x] Parsed raw motion tables and animations are the canonical source in both compositions.
- [x] `MotionSequence` and its tracks are the canonical runtime contract, built in memory, exposing
      no part frames or presentation hooks to host consumers.
- [x] `MotionKinematics` and all its plumbing are deleted, and every profile carries the complete
      representation at a recorded, measured size.
- [x] Simulation hooks survive content filtering everywhere, verified on an `Attack` carrier and an
      `Ethereal` carrier.
- [x] One shared resolver produces sequence selection, cursor, visual animation facts, and
      `AuthoredDrive` from one resolution.
- [x] `SolveProjectionBasis` expresses authored drive without reducing it to velocity.
- [x] The Explorer's collision solver composes authored drive and physical dynamics under proven
      support rules and returns one accepted rigid path plus next state. *Verified 2026-08-20:
      `ExplorerEntityRuntime::actuation` calls `authored_grounded_actuation` for grounded bodies,
      the support gate runs first, and `solve_grounded` returns the accepted path. Satisfied through
      the Explorer's own actuation path rather than through `SolveProjectionBasis::AuthoredDrive`,
      which is the two-solver-stacks debt showing up concretely — see that row.*
- [x] The authored contribution is one exactly-composed rigid offset, with authored rotation applied
      locally and physical omega globally. *Corrected 2026-08-20 after reading the decompile, which
      reversed the earlier reading twice. Retail applies **sequence** omega locally
      (`CSequence::apply_physics` calls `Frame::rotate`, `acclient.c:326382`) and we match it. The
      global `grotate` case is a different field, `CPhysicsObj::m_omegaVector`, and we implement
      that too: `SpatialBody.omega` integrates through `integrate_angular_velocity` in retail's
      `delta * rotation` order. Both halves exist. This criterion was written as though one omega
      existed; the debt table carries the three situations separately.*
- [x] Dynamic contact, body state, and frontend placement agree on the accepted path, and animation
      position frames affect the root exactly once.
- [x] The frontend is told which clip is playing and never receives the root track. *Projected,
      transported, validated, and now followed — see the Phase 5 harness evidence.*
- [x] A possessed Explorer entity consumes the shared command surface, including stance changes.
- [x] Standard walk, nonuniform translation, root rotation, links, reversal, support transitions,
      clipping, pause/resume, and late readiness have reference-backed coverage.
- [x] The Explorer capability boundary and the Bats root-rotation divergence are removed. *Both
      2026-08-20. The Bats divergence closed by applying turning root frames to the visual root,
      guarded by `authoredRootTranslates`; see the debt table for the archive-wide census that
      showed its stated justification applied to nothing.*
- [x] A possessed entity idles from its motion table rather than from `SetupModel::default_animation`.
      *Measured: a simulated entity installs its projected clip and keeps playing it across ticks
      that carry no further projection.*
- [x] Surviving debt is recorded with its rationale, including the solver-unification tripwire.
- [x] Formatting, Clippy with warnings denied, workspace tests, and frontend gates pass. *Phase 5's
      browser scenario is recorded above. `check:trace` fails at HEAD on unrelated particle-system
      API drift in `scripts/portal-work-trace.ts`; untouched and recorded as debt.*
