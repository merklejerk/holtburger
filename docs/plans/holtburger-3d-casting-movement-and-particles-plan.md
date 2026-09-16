# Casting movement and animation particles

Status: phases 1–6 are the implemented, automatically verified baseline. The layered gesture/movement extension in phases 7–10 is implemented. Live feedback exposed a packet-admission regression despite the earlier automated checks; the follow-up below fixes the proven playback reset and records its verification limits. User-owned visual/live acceptance remains separate. The current direction below supersedes the manual-interruption and protected-release policies of phases 3–5. Particle preparation, distance emission, and finite-emitter lifetime decisions remain applicable. User-owned visual/live acceptance remains unchecked. The user has requested a final code-quality review and commit.

## Follow-up: movement reset at casting packet boundaries

- User observation: movement interrupts at spell release and at the second windup.
- Proven defect: `MotionRuntimeRegistry::accept_remote` called ordinary `drive` at zero duration, which discarded retained manual locomotion. Preserving held input in core did not preserve the physical playback cursor; the next manual tick created a new sequence.
- Fix: packet admission advances only ordinary playback. Core retains responsibility for clearing manual locomotion on a genuine movement-source takeover; remote physical advancement still uses ordinary drive.
- Regression evidence: a new synthetic animated test failed before the fix because packet admission removed the walking occurrence. It now preserves that occurrence and continuous displacement across two queued windups, a later windup packet, and release. The core packet test additionally checks retained manual ownership before and after gesture arbitration, plus retirement on server takeover.
- Verification: all 825 world library tests and 59 core movement-system tests pass. These cover client playback and input ownership, not live server correction timing. ACE can batch windups in FastTick mode or send them separately otherwise (`Player_Magic.cs:605`, `WorldObject_Networking.cs:1078,1231`). A live retry is still needed to determine whether this fix accounts for both reported interruptions.

## Final accumulated code-quality review

Scope: accumulated feature changes against the pre-feature Git HEAD, including new files, tests, host and diagnostic adapters, and this plan. The pre-existing ACE submodule change is excluded. Historical checkpoints below remain history; the layered direction and this audit describe the final product.

### Findings and disposition

- **Fixed, P2 — hidden hooks replayed on simultaneous reveal and retiming.** `AnimationSystem.applyMotion` classified fractional-time dispatch using the incoming activity. When a rate update also revealed locomotion, `#retime` dispatched hooks accumulated while hidden before the later silent reveal step could consume them. The new combined-transition test reproduced two unwanted dispatches. Retiming now uses the previous selected track, preserving time provenance without another flag or retained state. Acceptance: hidden retiming and retiming during reveal both produce no deferred hooks and preserve the current pose.
- **Verified prior fix — packet admission versus physical ownership.** `accept_remote` updates ordinary playback without clearing manual locomotion; core source transitions and ordinary remote advancement still retire manual ownership. Animated registry and core packet regressions cover batched/separate windups, release, idle return, and actual server takeover.
- **Cleaned up — stale contract comments.** Removed presentation-only wording from the physical locomotion owner, a duplicate motion-state comment, and a test helper's obsolete claim to be the sole playback installation path.

### Contract coverage

| Boundary inspected | Owner, consumer, and lifecycle evidence |
| --- | --- |
| Network admission → world playback → core movement | Inspected movement handler, remote admission, gesture eligibility, held/pulse lifetime, source takeover, reset, fixed-tick exclusion, contact correction, and sticky reference selection. One selected offset and one body-hook stream reach the solver. |
| World playback → core view → client/Explorer host → frontend | Inspected both projection producers, serialized clip/activity/decimal occurrence identity, feed validation, accepted-level classification, and animation installation. Repeated clips, retiming, settled confirmation, missing tracks, death/contact, snapshots, and teardown use the new contract; old selected-clip APIs are removed. |
| Frontend layer updates → visual clock → behavior dispatch | Inspected final-gesture successor handling, partial-part inheritance, hidden traversal, reveal, replacement, and owner removal. The review fix covers visibility and retiming in the same update. No frontend cursor controls physics. |
| Animation/script dependencies → emitter handles → drawable readiness | Inspected animation and script discovery, dynamic staging, live script cues, sky scripts, shared mesh installation, and release paths. Failure/supersession releases acquired handles; concurrent mesh callers await GPU installation, not just decode. |
| Placement/attachment → distance emission | Inspected canonical scene origins, attached offsets, immediate snap placement before re-anchoring, descendant traversal, time-trigger precedence, caps, finite lifetime, and teardown. Existing particles keep their authored lifecycle independently of gesture replacement. |

### Design judgment and limits

- The second playback is justified: manual start/stop displacement and visual locomotion must advance independently of gesture sequencing. The retained input lifetime is also distinct from the temporarily selected movement source. Collapsing either pair would restore the original coupling.
- Subtraction is complete at the replaced boundaries: no protected-release/selective-windup interruption path, selected-clip compatibility API, or separate decoded particle-mesh map remains. The small emitter-discovery helper has two real producers. Diagnostic migrations remain in harnesses rather than adding production inspection contracts.
- Maintenance dry runs covered a fresh gesture packet during walking, a rate change at visual handoff, stop/contact/death, and shared asset failure during replacement. A new gesture family belongs in the world command classifier; frontend consumers use activity rather than repeat the allowlist. A future physical hook requires an explicit body-semantic ownership decision, not automatic merging of both streams.
- Accepted costs remain two frontend clocks and local final-one-shot retirement. Accepted limits remain missed intermediate clips, receiver-owned phase, suppressed hidden footsteps, instant full-body pose changes, finite interrupted emitters, and approximate distance spacing. This review does not establish exact retail spacing, live ACE correction timing, or user visual acceptance; no new broad refactor is required before committing.
- Fresh validation: 825 world, 458 core (including socket tests), 309 host, and 2,421 TypeScript tests pass; app checks, ESLint, Knip, world/core/host/debug-harness all-target Clippy, Rust/changed-frontend formatting, and diff whitespace pass. Browser WCID 192 simulated spawn, animated selection, and exact despawn pass with SwiftShader at render scale 1 and one-block content radii. These prove rendering/lifecycle, not live casting UX.
- A fresh close-up candle run also passes with seed 7, SwiftShader, render scale 1, and one-block content radii; the captured flame was inspected. Review artifacts are `/tmp/holtburger-final-review-{rust,ts,check,eslint,knip,clippy,browser,candle}.log` and the corresponding browser/candle PNGs.

## Goal and boundaries

Allow normal manual movement during spell windup, release, and pickup/drop while their gesture animations continue. Advance locomotion independently underneath the visible gesture, then reveal its current pose when the gesture finishes. Keep animation-authored particles reliable.

In scope:

- Complete animation dependencies through particle emitter definitions and drawable meshes.
- Restore distance-based particle emission using the user-approved, visually tunable approximation below.
- Classify motion commands by their actual meaning; separate local gesture presentation from manual locomotion displacement, including spell release. Preserve meaningful sequencing within the gesture playback.
- Allow already-created emitters and particles to finish under their authored budgets and durations after interruption.
- Preserve mid-cast jumping, server-owned operation outcomes, and existing selection semantics.

Out of scope: host-synchronized visual frame positions, exact replay of clips missed between host updates, porting motion-table selection to the frontend, upper/lower-body blending, cross-fades, a separate hidden effects-only timeline, faster spell execution, auto-targeting, repeat casting, spell bars, a general combat controller, global cancellation of action animations, and new inventory transaction semantics.

User preferences:

- Windup, release, and pickup/drop keep their full-body pose priority while ordinary manual movement supplies displacement and turning. Manual movement alone does not interrupt these gestures.
- Locomotion advances underneath the gesture. At the authored gesture boundary, reveal the current locomotion cursor immediately; do not restart it or replay deferred movement.
- When manual movement owns displacement, select its normal movement contribution rather than summing gesture root motion. Without a manual override, retain ordinary authored motion.
- Gesture hooks continue as their frames play. On a genuine interruption, existing particles surviving is sufficient; do not execute skipped future hooks.
- First-pass hidden locomotion presentation hooks, including footsteps, are suppressed without later catch-up. Physical hook ownership must be audited separately in phase 7.
- The user likes jumping mid-cast. Do not add retail pending-motion jump restrictions.
- The user owns all visual and interactive acceptance gates. The agent owns implementation, automated verification, review, and a focused handoff. User gates do not block completing that handoff.

## Ground truth and evidence

The following evidence records the baseline investigation; descriptions of missing particle support refer to the pre-phase-1 implementation. Paths are repository-relative. Retail citations refer to `acclient-eor-source/acclient.c`.

| Source | Established behavior / relevance |
| --- | --- |
| `ACE/Source/ACE.Server/Entity/SpellFormula.cs:245` | Windup gestures come from scarab component gestures; release comes from the talisman. Command names alone are insufficient evidence for the complete mapping. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Magic.cs:605` | Windup and release are distinct server phases. FastTick stops physics at phase boundaries; some spells omit windup. |
| Same file `:870`, `:1336` | Six-unit displacement checks exempt NPK players. Facing and release remain server-controlled. |
| `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMoveToState.cs:14` and `WorldObjects/Player_Tick.cs:176` | Movement is processed during casting; manual input cancels active approach chains. Absence of a blanket busy rejection does not prove arbitrary movement is correction-free. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs:1007` | Ordinary pickup approaches, starts a reach gesture, waits, then transfers. The inspected completion callback has no distance recheck; do not generalize this to every inventory operation. |
| Same file `:1371`, `:1472` | Drop waits before placing the item relative to the player's position at completion. Moving can change where the item lands. |
| `crates/holtburger-core/src/client/movement/system.rs:802` | Local physical actuation consumes the world animation tick's root offset. Changing only the visible pose cannot restore movement. |
| `crates/holtburger-world/src/motion/registry.rs:350`, `:450` | Actions take presentation priority; steady movement retargets the return suffix while an action retains its noncyclic prefix. |
| `apps/holtburger-3d/src/lib/game/animation/animation-asset-repository.ts` | All animations reachable from a motion table are prepared before activation. Their particle dependencies are not currently included. |
| `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts:1263` | Emitter preparation reads script dependencies only. Existing entity ownership already releases emitter handles. |
| `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts:819`, `:4201` | Mesh preparation also discovers emitters by walking scripts. Dynamic activation awaits it despite a stale helper comment claiming fire-and-forget behavior. Both discovery paths need the cutover. |
| `apps/holtburger-3d/src/lib/game/systems/particle-system.ts:545`, `:1032` | Missing prepared emitters produce an unprepared result; ongoing distance-only emission is skipped. |
| `apps/holtburger-3d/src/lib/game/systems/animation-system.ts:143` | Clip replacement replaces frontend hook traversal; it does not inherently stop emitters started by the previous clip. |
| Retail `:306805`, `:330655`, `:330680`, `:317294` | Contact edges retire unfinished animation work. The previous change implements this without executing skipped hooks or clearing spell busy state. Preserve that behavior. |

### Local DAT evidence

A temporary read-only exporter inspected player motion table `0x09000001`, its ordinary and purple power-up links, and their animation hooks. It found forward CreateParticle hooks at frame zero and later frames, part attachments 12/15, and backward StopParticle hooks. Table links can reference subranges of a larger animation: only hooks actually traversed by that clip are relevant.

Sample ordinary windup emitters:

| Emitter | Authored behavior |
| --- | --- |
| `0x3200011e`, `0x32000128` | Time-based, ten-particle budgets, one-second particle lifetimes; particles do not follow the parent after birth. |
| `0x32000109` | Distance-based, ten-second emitter duration, two-second particle lifetimes; attached emission with particles left behind after birth. |

This proves missing dependency edges and unsupported emission behavior, not a live reproduction of every reported visual failure. Prior asset residency could explain intermittent visibility; that remains a hypothesis. Temporary outputs under `/tmp` are disposable, not required test assets.

## Ownership and contracts

- Frontend asset preparation owns animation/script dependency discovery, emitter readiness, GPU mesh readiness, and resource release. No combat-specific asset loader or host graph service.
- Shared world/content semantics classify source-backed motion commands. Compute classification once at its owner; consumers must not duplicate command-number predicates.
- Core owns current manual intent and its physical arbitration. World owns independent motion playback, authored boundaries, and the selected physical contribution. The 3D app owns presentation priority and hook dispatch using that shared motion state. Do not put explorer-specific UX in shared crates. Remote characters retain server-authored behavior.
- Host projection exposes both resolved gesture/ordinary and locomotion clip descriptions, plus the semantic state needed to distinguish their ownership and genuine replacement. Motion-table selection stays shared; the host does not choose the visible layer or synchronize visual frame positions. Frontend playback owns both visual clocks, presentation priority, and handoff to its already-running locomotion cursor. Frontend animation/particle presentation executes hooks from visible playback. Interrupted playback skips future hooks; already-created emitters retain their existing authored lifetime. No gesture retirement history crosses the host boundary.
- Core operation tracking remains independent. Moving, replacing a clip, or stopping an emitter neither completes nor cancels a cast/pickup/drop transaction.

North stars:

1. Complete existing asset preparation rather than adding lazy loads inside hooks.
2. Choose displacement separately from the visible pose. Manual locomotion can move a character whose gesture remains visible; never sum the two root contributions.
3. Keep host simulation playback and frontend visual playback explicitly separate. Advance each gesture/locomotion playback once in its owning clock domain; frontend reveal preserves its existing local cursor. Never replay hidden locomotion hooks or genuinely interrupted gestures.
4. Preserve authored particle lifetimes across clip boundaries and interruption; normal stop hooks still apply when their frames play.
5. Preserve held input and pulse expiry independently of gesture playback; stopping during release must stop manual drive without ending the gesture.
6. Preserve server authority over timing, facing, corrections, and operation completion.
7. Keep every new field tied to a named consumer. Prefer reusing existing admission stamps, action identity, prepared handles, and lifecycle paths.

## Completed baseline: phases 1–6

The checked tasks and their acceptance statements below describe the previous implementation. Phases 3–5 are historical policy, replaced by the extension below; they are not requirements to preserve.

## Phase 1: Complete animation particle dependencies

- [x] Extract direct emitter references from prepared animation hooks, sharing the relevant hook-reference extraction with physics scripts where their decoded contracts permit it.
- [x] Combine references from default animations, motion-table animations, and script closures before emitter acquisition. Deduplicate per owner; repositories continue sharing immutable assets across owners.
- [x] Make mesh preparation consume the prepared emitter set instead of independently reconstructing it from scripts. Include dynamic server script cues and other callers in the contract migration.
- [x] Stage definitions and drawable meshes before activation; preserve generation checks and release every acquired handle on failure, supersession, replacement, and teardown.
- [x] Cover both default-animation and motion-table entities. Avoid introducing a general dependency-graph framework for these concrete edges.
- [x] Measure unique additional emitters/meshes and preparation impact for the player motion table. Record results before considering narrower loading.
- [x] Correct stale staging comments and remove the script-only dependency assumptions from surviving symbols/contracts.

Acceptance: a synthetic animation-only CreateParticle hook reaches an actually prepared emitter and mesh through production preparation; shared references do not duplicate acquisition per owner; failure and supersession release resources. Tests must exercise preparation-to-consumer composition, not manually prewarm the missing assets.

## Phase 2: Implement the approved distance-emission approximation

Decision: the user approved treating each emitter's authored birthrate as minimum spacing in world-distance units, with one shared positive spacing multiplier initially set to 1. This is a deliberate approximation; the exact retail threshold and units are not recovered. Further reverse engineering is not an implementation gate.

- [x] Trace the attached emitter frame, displacement baseline, cadence, and trigger precedence; census shipped trigger types. Evidence below distinguishes established behavior from the missing threshold.
- [x] Implement the threshold as `spacing = authoredBirthrate * spacingMultiplier`; emit when squared displacement from the last emission exceeds `spacing * spacing`. Use the live attached emitter origin, including its authored offset, so both hand articulation and character travel contribute.
- [x] Put the single multiplier in existing frontend tuning, with the particle runtime as its named consumer. Preserve relative authored spacing across emitters; do not add per-spell overrides or a new settings UI. Require a finite positive multiplier. Zero authored spacing means any nonzero displacement qualifies, subject to the existing budgets.
- [x] Preserve initial emission, capacity, total-particle budgets, duration, particle lifetimes, and at most one ongoing emission per update. Preserve time-trigger precedence and existing time-based behavior. Update the distance baseline only on actual emission; do not accumulate path length or generate catch-up bursts.
- [x] Define initialization and discontinuity handling explicitly: initialize the baseline from the resolved attached origin before first emission; re-anchor on known teleports/resets rather than treating them as a traveled trail. Integrate with existing discontinuity/lifecycle signals rather than adding a guessed distance cutoff.
- [x] Add deterministic fixtures for stationary, below/above threshold, attached-part movement, stopped emitters, budget limits, and discontinuous origins. Use explicit test-owned multiplier inputs or runtime tuning imports; changing the production multiplier alone must not break tests.
- [x] Document the approximation beside the predicate, citing retail `:312447`, the unresolved comparison, the 202-emitter census, and user authorization. Do not describe it as a proven retail correction. Sweep obsolete comments that say distance emission is always skipped or blocked on recovery.

Acceptance: the approved distance rule passes focused tests, including hand movement with a stationary character; existing time-based emission remains unchanged. The user calibrates visible trail density using the one multiplier. Runtime-asset-dependent diagnostic tests stay temporary. Accurate retail threshold recovery remains optional follow-up, not a prerequisite for completing this phase.

## Phase 3: Establish action interruption semantics

- [x] Census shipped spell-component gestures and identify pickup/drop command families and the caster-item override path; results below.
- [x] Add narrow semantic classification for both transient actions and forward substates. Retain existing behavior for unclassified commands; custom item override values are not exhaustively enumerated by the local catalog.
- [x] Trace action admission stamps through playback and identify where projection loses them; results below.
- [x] Define local movement arbitration for both queued windup actions and reach/release substates. Preserve release entry and return transitions until their authored boundary; an action-only check cannot cover these substates.
- [x] Resolve emitter retirement policy from the content census: allow existing emitters to finish under their authored limits, retain ordinary stop hooks when played, and skip future hooks when playback is interrupted. No emitter ownership stamp or retirement history is required.
- [x] Verify that interrupted playback cannot replay skipped hooks or resurrect stale gestures. Preserve unrelated actions and script effects.

Acceptance: local movement interrupts eligible windup/reach playback without executing skipped hooks. Existing effects finish normally, and release retains authored movement through its return transition. Tests exercise world playback and core arbitration together.

### Steering checkpoint

Review measured asset cost, recovered emission semantics, and the action-to-frontend contract before implementing movement. Update the remaining phases with concrete symbols discovered above. Routine refinements need no new approval; a materially different visual policy or unsupported source behavior must be surfaced. Do not silently broaden this into a universal animation/event framework.

## Phase 4: Free movement during spell windup

- [x] Let current manual movement intent interrupt eligible local windup playback, including when input was already held before windup arrived. While movement remains held, later windup actions must not repeatedly seize control.
- [x] Retire only obsolete eligible windup actions while preserving the authoritative release substate and its entry/return transitions. Ordinary release is not a queued action. Do not let manual-order application overwrite release, or an old windup completion restore a stale return state.
- [x] Drive ordinary collision-aware locomotion after override, using its normal speed and root-motion policy. Do not create a second position integrator or bypass collision.
- [x] On key release, return to the appropriate stance/current accepted playback without resurrecting interrupted windup. New eligible gestures may play while idle. Never repeatedly reapply an interrupted pickup substate merely because it remains in the last network snapshot.
- [x] During release, preserve authored movement ownership while retaining the latest input. Resume only still-held input after the release boundary. No automatic recast or stance changes.
- [x] Preserve current jump admission and contact interruption. Do not interpret release ownership as a new prohibition on mid-cast jumping.
- [x] Preserve manual takeover of server-directed turning and normal movement publication. ACE may issue further authoritative motion or reject the cast.

Acceptance: synthetic tests cover idle windup, input before/during windup, subsequent windup actions, release substate arrival behind pending windup, release with held/released input, jump/contact edges, and authoritative replacement. Captured commands contain normal movement and no client-generated spell cancellation; spell busy remains until its existing terminal path.

## Phase 5: Extend the policy to pickup/drop

- [x] Apply the same semantic eligibility to pickup/drop reach substates and their transition prefixes without introducing inventory-specific movement state. The transient action queue is not their owner.
- [x] Preserve cancellation of automatic approach by manual input. Distinguish approach cancellation from overriding a reach that has already begun.
- [x] Preserve authoritative inventory success/failure handling and pending transaction ownership. Local animation interruption never moves an item optimistically.
- [x] Cover item disappearance, operation failure, held movement at gesture arrival, and drop completion after player movement.

Acceptance: movement can replace eligible reach playback; pending inventory operations still resolve through their existing server events. Tests verify no fabricated success, duplicate request, or stale operation ownership. Live ACE behavior remains a user acceptance gate, not a claim established by these tests.

## Phase 6: Cleanup, review, and handoff

- [x] Sweep replaced dependency discovery, stale comments, duplicated command classifiers, and unused ownership fields. Review the accumulated diff across shared motion, core movement, host projection, and frontend asset/effect lifetimes.
- [x] Run scoped Rust tests and Clippy with warnings denied, formatting, and relevant app manifest scripts for TypeScript tests, type checks, lint, and dead code.
- [x] Reuse synthetic regression evidence; do not run the interactive TUI. No committed tests requiring untracked DATs.
- [x] Provide the user the checklist below and distinguish automated results from visual/live results. Complete implementation and automated work without waiting for user-run gates.

## Extension investigation: frontend-owned visual playback

The initial read-only investigation established the following implementation boundaries. This table describes the starting architecture; execution checkpoints below track the cutover:

| Source | Finding / consequence |
| --- | --- |
| `crates/holtburger-world/src/motion/registry.rs::presentation_sequence` | World already retains ordinary and locomotion playback, but selects only one for projection. Expose both descriptions instead of selecting the displayed pose here. |
| Same file `::present_locomotion` | Existing locomotion strips transition prefixes and advances without physical contributions after the solve. Reuse requires preserving normal start/stop motion and a deliberate simulation advancement point. |
| `crates/holtburger-core/src/dynamic_entity_view.rs::DynamicEntityMotion` | Clip descriptions carry bounds, rate, and completion; advancing visual phase is already receiver-owned. No new host frame-position contract is required for continuous frontend handoff. |
| `apps/holtburger-3d/src/lib/game/systems/animation-system.ts::AnimationSystem` | One record per scene node owns a visual cursor; `playClip` replaces it. Retain two playback records within one entity owner and sample the frontend-selected one. |
| `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts::#applyDynamicEntityMotion` | One accepted motion level drives one installed clip. Migrate this consumer and its update classification to independent clip descriptions. |
| `apps/holtburger-3d/src/lib/game/animation/prepared-motion-playback.ts::PreparedMotionPlayback` | Frontend preparation supplies playable animation assets and bounds, not a motion-table selector. Keep clip selection in shared code rather than duplicating it in TypeScript. |
| `crates/holtburger-world/src/state/motion_resolution.rs::apply_authored_motion_physics` | The inspected world hook consumer applies ethereal/solid state. Physical and visual hook ownership are already separated; preserve that boundary while auditing concurrent playback. |

Decision: host resolves clips and simulates movement; frontend advances both visual clocks and chooses the displayed pose. “Current locomotion cursor” means the retained frontend cursor, not exact agreement with the host simulation frame. Continuous residency supports seamless cursor retention; late realization or entirely missed clips retain the existing reconstruction limits.

### Scope of the change: presentation policy plus independent physical playback

The host does not need to know which animation the frontend is displaying. It needs to retain accepted gesture timing, resolve motion-table clips, and calculate the correct physical movement. The frontend receives both resolved tracks and decides which pose to display.

- **Shared world/core:** keep gesture sequencing independent of manual locomotion; select one physical displacement contribution and preserve collision, contact, input, and authoritative outcome handling.
- **Host boundary:** publish both clip descriptions, occurrence identity, and semantic activity. Clip identity distinguishes a genuinely new instance of an identical clip from a restated snapshot; it is not a frame position or retirement log.
- **Frontend:** advance both visual tracks, display the gesture while eligible, then reveal locomotion at its existing local cursor. Visibility does not pause locomotion or queue movement for later. Hidden locomotion visual hooks are discarded rather than replayed on reveal.

This is a bounded cross-layer change, not just a pose override. The existing locomotion track is useful groundwork, but its old presentation-only advancement cannot supply normal physical start/stop movement unchanged. Keeping visual priority in the frontend avoids adding host-selected visibility, synchronized visual frames, or a second motion-table implementation.

Natural completion may finish the resident frontend gesture's final one-shot before revealing locomotion. Genuine replacement/contact interruption still takes precedence. Exact recovery of unseen intermediate clips is outside scope; finite emitters already created continue under their authored limits.

## Phase 7: Resolve playback and hook ownership

- [x] Trace `BodyMotionRuntime`, `MotionSequenceRuntime`, core fixed-tick movement, host projection, and frontend animation traversal. Record a concrete owner/consumer table for clocks, selected root offset, facing, visible pose, physics hooks, presentation hooks, and attachment/collision poses before changing contracts; execution findings below.
- [x] Reuse or replace the existing `LocomotionPlayback` deliberately. Today `present_locomotion` strips transition prefixes and advances presentation only, after physical movement; it cannot simply become the physical producer or be advanced a second time. Define one advancement point that preserves ordinary start/stop transitions and collision-aware displacement.
- [x] Specify priority: existing contact/jump/death and authoritative replacement rules remain above ordinary gesture presentation; eligible windup/release/reach outrank locomotion visually. Manual movement overrides gesture displacement and manual turning follows the normal movement path, subject to server correction. Gesture sequencing remains intact, including queued windups and release/reach substates with entry/return links.
- [x] Separate manual displacement ownership from nonzero input: ordinary stop-transition displacement must finish exactly once. Idle gestures retain authored movement when no manual locomotion contribution owns that tick. Preserve held-input lifetime, pulse deadlines, approach cancellation, and movement republication after ACE phase boundaries.
- [x] Census the actual hook consumers. Continue visible gesture presentation hooks; suppress hidden locomotion presentation hooks without catch-up. Assign movement-affecting hooks to the selected physical playback and explicitly resolve any gesture hook that also changes physics. Do not blindly combine both hook streams or discard every hidden hook.
- [x] Resolve articulated collision/attachment sampling explicitly: current `collision_pose()` uses the ordinary sequence, while visual locomotion has a separate cursor. Keep host collision sampling based on simulation state and frontend attachments based on the displayed pose. Audit any requirement for closer agreement explicitly; do not feed frontend visual selection back into host simulation or add another clock to hide a mismatch.

Dry run / acceptance: walk held movement → windup → release → return, reach while moving, stop/reverse during gesture, and jump/contact through the ownership table. Each tick has one physical result and each playback advances once. Unknown/custom motions keep existing behavior. Surface a source-backed conflict before implementation rather than inventing a generic mixer.

### Phase 7 execution findings: ownership and advancement

| Responsibility | Owner and concrete consumer | Cutover requirement |
| --- | --- | --- |
| Accepted gesture order, queue, and authored boundaries | `BodyMotionRuntime::accept_order`, `drive`, and `start_next_action` | Manual selection must stop rewriting `steady_order` and the gesture sequence. Preserve action completion and return transitions. |
| Manual input and movement publication | Core `MovementSystem` | Retain held/pulse lifetimes, stop/reset behavior, and fresh publication after server gesture admission. |
| Physical locomotion selection and clock | World motion runtime, advanced by `MovementSystem::advance_local_authored_motion` before the solve | Preserve entry/stop transitions and yield one selected root offset. Do not reuse post-solve presentation advancement unchanged. |
| Root displacement and turn application | Core `tick_with_precise_jump` and the existing physical collection solve | Consume the selected contribution once; exclude local playback from the ordinary world sweep when this adapter advances it. |
| Explicit target facing | World sticky target state, consumed by `prepare_sticky_body_targets` | Preserve authoritative target intent and existing manual turning arbitration; pose visibility is not its owner. |
| Collision-part pose | `BodyMotionRuntime::collision_pose`, consumed by `publish_authored_collision_poses` before the solve | Remains simulation-owned. Audit the physical sequence chosen when locomotion and gesture coexist; do not depend on a frontend frame. |
| Physical hooks | `MotionSequenceRuntime::advance` → `WorldState::apply_authored_motion_physics` | Current applied effect is ethereal/solid state. `Attack` and `ReplaceObject` are also projected by content but are not applied by this consumer. Decide concurrent-stream ownership explicitly; visual hiding cannot disable physical semantics. |
| Visual clip clocks and priority | Frontend `AnimationSystem`, fed through `#applyDynamicEntityMotion` | Retain two independent records under one entity generation; select which record to sample locally. |
| Visual hooks and attachments | Frontend animation dispatcher and existing behavior/particle consumers | Visible gesture hooks continue; hidden locomotion traversal updates its cursor without dispatch. Attachments use the sampled visual pose and accepted world placement. |

Additional concrete integration constraints found during execution:

- `client/simulation.rs::advance_physical_scene` clears local locomotion whenever `client_directed_locomotion_order` is absent. Today manual, server-directed, and idle local playback deliberately use the ordinary cursor. A manual second playback would therefore be deleted every solve unless its ownership/lifetime rule changes. Distinguish physical manual playback from observed/client-directed presentation instead of merely stopping all cleanup.
- `MovementSystem::pending_manual_playback_stop` is consumed for one tick. A separate physical locomotion sequence must remain advanced through the full stop transition, including when a gesture remains active; one final tick is not proof that the authored transition has finished.
- `BodyMotionRuntime::drive` both selects the steady order and advances actions. Separate those responsibilities enough that manual locomotion cannot retarget gesture playback accidentally. Completion must still start queued actions and preserve the currently accepted return order.
- `present_locomotion` currently removes transition prefixes on every selection and invokes `advance_presentation`, which intentionally generates no root offset or hooks. The physical cutover must change both selection and advancement, not merely substitute its offset at the solver boundary.
- Host `explorer_entity_runtime.rs` also compares and publishes `motion_presentation`; the dual-description contract must migrate that producer alongside the client projection. Debug harnesses and existing selected-pose tests are additional consumers to review.

Decisions implemented in phase 8:

- Reuse the independent locomotion sequence with an explicit manual-versus-presentation owner. Manual advancement occurs before the solve and preserves transitions; observed/client-directed presentation retains post-solve advancement. Source takeover retires the previous independent owner.
- Keep manual playback resident through idle and stop transitions. Core includes that ownership in its exactly-once advancement decision. Displacement ownership covers held axes and the complete noncyclic stop transition, including its final interval; empty animation sequences do not invent a transition.
- Gesture/explicit ordinary playback owns body-semantic hooks and collision-part sampling while active. Otherwise manual locomotion owns those consumers. Current simulation hooks describe body semantics, not an additional velocity integrator: only Ethereal is applied today. Never union the two hook streams. Root displacement can independently come from locomotion.
- Manual displacement bypasses the sticky physical reference for that interval without erasing newly admitted target intent. A completed older windup cannot clear a newer release/reach target lease. Jump/contact/death and authoritative control retain their separate retirement rules.

No major blocker was established at the phase-8 checkpoint. Phase 9 exposes both tracks, and phase 10 removes the old selected-clip APIs and migrates their diagnostic/test consumers.

## Phase 8: Separate gesture playback from local locomotion

- [x] Implement the phase-7 ownership decision in world playback and core movement. Keep authoritative gesture state and its queue separate from manual locomotion selection; neither manual orders nor completion of an older gesture may overwrite a newer accepted gesture.
- [x] Continue gesture timing and hooks while locomotion changes forward/backward/strafe/turn state. Include release, pickup/drop, and their authored return transitions. Movement does not shorten server timing or clear busy state.
- [x] Choose the normal manual movement contribution through the existing collision solver. Never sum gesture and locomotion root offsets, add a second integrator, or advance local playback again through the ordinary world sweep.
- [x] Preserve jump/contact interruption, server corrections, approach takeover, input expiry/reset, placement epochs, and authoritative inventory outcomes. Gesture completion is not transaction completion. Remote characters and unclassified commands retain existing behavior.
- [x] Replace baseline interruption/protected-release tests with sequence and fixed-tick tests for concurrent gesture timing and movement, held input at arrival, later gestures, stop transitions, direction changes, and exactly one collision-applied displacement. Retain meaningful publication, busy, inventory, and jump regressions.

Dry run / acceptance: a multi-clip gesture reaches its authored boundaries at the same simulated times with and without manual movement. Movement displacement matches ordinary locomotion for the same inputs and support conditions, including its stop transition. Release never temporarily freezes held movement under this policy. Releasing input does not stop the gesture or cause delayed movement to resume.

### Phase 8 implementation checkpoint

- `drive_manual` now advances accepted ordinary playback and independent locomotion, composing one root contribution and one body-semantic hook stream. Release/reach retain their authored timing while held movement proceeds.
- Deleted `interrupt_windup`, reach snapshot suppression, selective action/substate clip-removal helpers, and their obsolete interruption tests. Retained action boundary metadata and the repeated-substate collapse fix. Renamed release-specific continuation queries to pending-gesture queries; their remaining consumer is idle physical advancement, not movement protection.
- Core preserves manual playback across solves and stop transitions, retires it on server/client-directed source takeover, and reconciles jump/contact without double advancement. Renamed locomotion lifetime helpers to cover both physical and observed ownership, including the Explorer caller.
- Synthetic world checks compare moving and idle gesture timing, queued windups followed by release, body hooks, start/stop displacement, a multi-tick stop under release, strafe/turn input, and a newer target lease. Core fixed-tick checks preserve busy state, apply exactly one collision-solved displacement, retain a visible windup, and commit mid-cast jumps. Inventory tests now retain reach while validating authoritative outcomes.
- Verification checkpoint: 456 core tests passed with the two socket-dependent tests excluded after sandbox permission failures; the mid-cast jump regression was also rerun after its old single-state assertions were migrated. All 822 world tests pass; world/core all-target Clippy passes with warnings denied; formatting and diff whitespace checks pass. Frontend handoff, host dual-clip contract, browser verification, and final accumulated review remain open; this is not extension completion.

## Phase 9: Frontend visual clocks, priority, and handoff

- [x] Extend the world → core dynamic view → host → frontend contract to expose both resolved ordinary/gesture and locomotion clip descriptions, including when locomotion is hidden. Carry source-owned semantic eligibility/boundary facts for the frontend priority policy; do not infer gesture meaning from animation IDs or duplicate command classification.
- [x] Migrate `DynamicEntityMotion`, host serialization/feed decoding, `#applyDynamicEntityMotion`, and motion-update classification together. Give every field a named consumer. Distinguish real playback replacement from unchanged descriptions and rate changes, including repeated identical clips where admission identity matters. Reuse existing identity when justified; no visual frame-position synchronization or retirement history.
- [x] Change `AnimationSystem` from one replaceable record per node to gesture/ordinary and locomotion records under the same entity lifetime. Advance both visual cursors; sample the selected record. Preserve independent retained-part poses, generation guards, rate-change behavior, release, and teardown. Switching visibility must not reinstall an unchanged clip or reset its clock.
- [x] Keep visible-layer priority in the frontend using the phase-7 semantic facts. Retain existing hold/settled confirmation behavior and specify how an ordinary gesture retirement allows its frontend terminal traversal to finish; genuine authoritative replacement/contact interruption still takes effect. A looping gesture hold is not retired merely because a local cycle wraps.
- [x] Suppress hidden locomotion presentation hooks while continuing its cursor, including on installation and retiming; never replay suppressed hooks on reveal. Dispatch visible gesture hooks normally, including particle stops. Resolve hand attachments from that displayed pose and current world transform; preserve particle discontinuity re-anchoring.
- [x] Exercise coalesced updates and snapshot resynchronization: preserve compatible resident visual cursors, apply changed descriptions independently, and initialize newly realized records using existing entry/settled semantics. Do not claim to reconstruct clips that were never received or an exact host phase. No replay/history machinery is required for these accepted limits.
- [x] Add synthetic projection-to-animation tests for hidden locomotion start/stop/reverse, frontend-current-phase reveal, unchanged versus genuinely repeated identical clips, retiming, teardown, and snapshots with retained or newly created records. Verify no hidden footstep/particle catch-up and exercise a gesture emitter attached to a moving character through real dispatch.

Dry run / acceptance: the frontend gesture reaches its retirement boundary while its locomotion record is midway through a cycle; the next visible pose samples that existing record without reinstalling it. Hidden input changes update the locomotion clip independently. Host updates do not carry visual frame positions or decide visibility. Missing intermediate clips do not produce fabricated hook replay. Existing finite emitters retain their lifetime policy. The switch is immediate and full-body, without blending.

### Phase 9 implementation and verification checkpoint

Implementation exists for the dual-track world/core/host contract, frontend feed decoding, independent update classification, and two visual playback records per entity. The contract carries ordinary and locomotion clips, occurrence IDs, and ordinary activity (`locomotion`, `gesture`, or `explicit`). The frontend uses activity for priority and occurrence IDs for replacement; the host supplies no visible-layer selection or visual cursor.

The frontend implementation retains hidden locomotion through snapshots and rate changes, suppresses its hooks, and can finish a naturally retiring gesture's final one-shot locally. Explicit replacement interrupts that finish. Focused and full-suite coverage now establish the handoff behavior, including snapshots, replacement, hidden reversal/stop, and partial-part pose inheritance.

Recorded focused verification: 11 manual-gesture world tests, 43 Explorer runtime host tests, 23 animation-system tests, and 57 presentation-runtime tests passed. The runtime handoff test uses full sampling cadence because the test renderer reports every entity offscreen; it verifies retained-cursor reveal, retiming, snapshots, and fresh realization. These scoped results do not replace final full-suite, lint, browser, or live visual checks.

Resolved review targets:

- A matching settled successor confirms the installed one-shot even when it has a new occurrence ID; a fresh advancing occurrence still restarts. Synthetic classification tests cover both.
- Runtime snapshot tests cover hidden start, retiming, reversal, stop completion, reveal, restated snapshots, teardown, and fresh realization. Animation-system tests additionally prove hidden fractional traversal cannot replay hooks.
- The real preparation → animation-hook dispatch → emitter → renderer-record path births particles from a moving character while retaining earlier world-space particles. The fixture reports the owner visible, matching the production particle suspension contract.
- A finishing gesture's partial-part successor now inherits untouched parts from the pose at the actual switch, including explicit replacement during retirement. Two regression tests reproduced and then verified this correction.
- Deleted host-selected `presentation_sequence`, `motion_presentation`, and `playing_clip`; migrated tests, Explorer projections, and diagnostic probes to explicit tracks. Removed frontend single-clip convenience methods whose only remaining consumers were tests.

## Phase 10: Clean cutover, verification, and handoff

- [x] Delete manual windup interruption, stale reach-suppression state, and release-specific manual movement protection where the new composition makes them unnecessary. Audit `interrupt_windup`, `suppressed_reach`, `pending_gesture`, `release_pending`, manual-drive wrappers, and their consumers; retain only state still required for real authored boundaries or genuine interruption.
- [x] Remove the old host-visible selection path (`presentation_sequence`, `motion_presentation`, and `playing_clip`) or replace remaining legitimate consumers with explicitly owned track access. Migrate diagnostic harnesses and tests without recreating frontend visibility policy in a shared test helper.
- [x] Preserve source-backed command classification, meaningful gesture queues, action completion boundaries, and the repeated-substate collapse fix. Delete obsolete helpers/tests rather than keeping a parallel compatibility path. Sweep comments, symbols, and active documentation for superseded policy.
- [x] Review shared versus app-local ownership, clock advancement, hook dispatch, root contribution selection, and contract field consumers. Assess whether the deletion offsets the new independent-playback and dual-clip projection machinery; do not promise a net line-count reduction.
- [x] Run relevant world/core tests and Clippy with warnings denied; run affected host checks and app manifest scripts for TypeScript tests, type checks, lint, and dead code. Verify formatting and diff whitespace. No interactive TUI or retained tests requiring untracked DAT assets.
- [x] Hand off the current visual/live checklist with automated evidence and remaining limitations. Previous phase-6 results are baseline evidence, not validation of this extension.

Acceptance: a single composition path implements the new behavior; no manual interruption/protected-release compatibility path remains. Automated checks pass and review finds no double advancement, duplicate physics/hooks, stale pose replay, or fabricated operation completion. User visual acceptance remains a separate milestone.

## User-owned visual and interactive acceptance

- [ ] Cold start: stationary windup bursts and attached trails appear without another effect warming their assets. Repeat across spell levels and gesture variants.
- [ ] Calibrate distance-trail density with the shared spacing multiplier, sampling stationary and moving attached effects.
- [ ] Move before/during windup, release, and pickup/drop: normal movement and turning continue while the full gesture remains visible. Inspect full-body gliding and accept or revisit that concession.
- [ ] Stop, reverse, strafe, and turn during gestures. At each gesture's authored end, inspect the immediate switch to the current locomotion pose, including idle after stopping; no restart or backlog.
- [ ] Inspect hand trails while moving and verify ordinary gesture stop hooks still act. Hidden locomotion should not produce footsteps or catch-up bursts when revealed.
- [ ] Test a target ahead/behind, jump mid-cast, and exercise landing/contact transitions. ACE still controls authoritative facing, corrections, and casting outcomes.
- [ ] Pickup/drop: interrupt approach, move during reach, inspect final item location/result, and test failures and repeated input.
- [ ] Reconnect/change character: no stale particles, held movement, playback ownership, or pending operation UI.
- [ ] If relevant to the server, compare NPK and PK displacement restrictions. No promise to bypass server rules.

## Risks and concessions

- Full-body windup/release/reach over free movement can look like gliding; the immediate pose handoff can pop. Upper/lower blending and cross-fades are explicitly deferred.
- Independent playback removes manual-interruption bookkeeping but adds clock/composition and dual-clip projection responsibilities. Existing visual locomotion is useful groundwork, not proof that this is a small implementation.
- Frontend clocks are not synchronized to host frames. Compatible resident playback survives snapshot updates, but late realization and entirely missed clips cannot recover unseen visual history. Exact recovery is outside this extension.
- Hidden locomotion presentation hooks are suppressed, so walking during a gesture can be silent. Body-semantic hooks follow the phase-7 owner decision independently of displacement; future physical hook variants must preserve that distinction.
- Server timing, facing, cast restrictions, and corrections may conflict with the desired local UX. Preserve visible authoritative outcomes; do not compensate by falsifying completion or position.
- Continuing gestures preserves normally traversed stop hooks. Genuine interruptions can still leave finite hand trails emitting until their authored timeout. The shipped player census found no unlimited emitters; custom effects are outside that finding.
- The distance approximation affects 202 shipped emitters. Its shared multiplier needs visual calibration; exact retail threshold recovery remains optional. Existing dependency preparation costs and sharing evidence remain applicable.
- This requested UX deliberately departs from retail action priority. Preserve source citations and the affected command/content census; do not label it an unobservable retail defect correction.

## Definition of done

- [x] Baseline animation particle dependencies reach drawable mesh readiness.
- [x] Approved distance emission, shared tuning, and finite-emitter lifetime policy are implemented and tested.
- [x] Windup, release, and reach continue while normal local movement independently supplies displacement and turning.
- [x] Frontend locomotion advances underneath gestures and is revealed at its retained local cursor without reinstalling playback or replaying hidden hooks. Snapshot/late-realization tests reflect the documented recovery limits.
- [x] Host supplies both resolved clip descriptions and semantic ownership facts; frontend owns visual clocks and priority. No host visual-frame synchronization or duplicated frontend motion-table selector is introduced.
- [x] One physical contribution, one advancement per playback, and one owner per hook keep collisions, attachments, particles, and jump/contact behavior coherent.
- [x] Casting/inventory outcomes, input lifetime, publication, corrections, and remote behavior remain correct.
- [x] Superseded interruption/protected-release machinery is removed; extension checks and quality review pass; current visual checklist is handed off.

Agent handoff and user acceptance are separate milestones. No claim that individual user gates passed without results. No commit unless separately requested.

## Open implementation questions

No unresolved implementation decision remains. Frontend visual priority, independent physical locomotion, settled confirmation, replacement/contact handling, and partial-part handoff are implemented and tested. Visual density, full-body gliding, pose popping, and live ACE behavior remain user-owned acceptance.

## Extension completion audit

| Requirement | Current evidence |
| --- | --- |
| Gesture sequencing survives manual displacement and turning | Synthetic world tests compare moving/idle windup and release/reach timing, queued gestures, return links, stop transitions, body hooks, and target leases. Core fixed ticks verify one collision-applied contribution, input expiry, publication, and mid-cast jumps. |
| Server-owned outcomes remain independent | Core casting/busy and inventory tests cover failure, held input at gesture arrival, authoritative completion, item disappearance, and drop after movement. No new transaction ownership is inferred from motion commands. |
| Host resolves tracks; frontend owns visual priority and phase | World `MotionPlayback` → core `DynamicEntityMotion` → Explorer/client serialization → feed schema → runtime classification → `AnimationSystem` inspected together. Each layer carries occurrence identity and resolved clip; ordinary activity is the priority input. No advancing frame cursor, retirement history, or frontend motion-table selector was added. |
| Natural completion and genuine replacement | Final one-shot retirement keeps traversing locally; explicit replacement interrupts it. Settled successors confirm terminal poses across occurrence IDs. Partial-part successors inherit the pose at the switch. |
| Particle readiness and lifetime | Full preparation/mesh-install failure, sharing, supersession, and real-dispatch tests pass. Moving-gesture integration checks attachment-origin births and preserved existing particles. Distance-emitter tests retain time precedence, one birth per update, budgets, attached offsets, and re-anchoring. Finite-emitter census and authored timeout policy remain applicable. |
| Clean cutover and ownership review | Removed selective manual interruption, reach suppression, protected release, host visible-clip selection, and frontend test-only clip APIs. Kept action boundaries, the meaningful gesture queue, repeated-substate reduction protection, and manual input lifetime. Reviewed new/untracked files and callers; the pre-existing ACE submodule change is outside this feature. |
| Automated checks | 458 core, 824 world, 309 host, and 2,420 TypeScript tests pass. The complete core run includes the two loopback socket tests. App type checks, ESLint, Knip, and world/core/host/debug-harness all-target Clippy with warnings denied pass. Rust and changed frontend-file formatting, plus diff whitespace, pass. |
| Browser evidence | Grounded WCID 192 animation selection reaches exact geometry and mask rendering, and exact despawn restores shared-runtime counts. Close-up candle fixture passes with 57 emitters / 32 particles at capture and a visibly rendered flame. The final post-review animation browser rerun also passes. Screenshots were inspected; they establish rendering, not live casting UX acceptance. |

Review conclusion: the extra independent playback and dual-description contract are justified by the requested behavior. Visibility stays in the frontend; collision/root contribution and body hooks stay in simulation. The remaining complexity is the local final-one-shot handoff, not a general mixer or history service. Future physical hook kinds must preserve the documented body-semantic owner; this change does not implement hypothetical hook consumers. Late realization, missed intermediate clips, gliding, instant pose switches, and finite interrupted trails remain explicit concessions.

Validation commands: `cargo test -p holtburger-core --lib`, `cargo test -p holtburger-world --lib`, `cargo test -p holtburger-3d-host --lib`, `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-3d-host -p holtburger-debug-harness --all-targets -- -D warnings`, app `npm run test:ts -- --maxWorkers=4`, `npm run check`, `npm run lint:ts`, and `npm run lint:dead`. Browser harness commands use `--spawn-wcid 192 --spawn-simulated --spawned-selection-probe` and the documented seeded close-up candle camera, both in landblock `0xda55ffff`.

## Historical baseline evidence and checkpoints

The remaining sections record phases 1–6. Their interruption and protected-release decisions describe the previous implementation; phases 7–10 supersede those requirements. Test counts and completion claims below do not validate the extension.

## Prerequisite investigation results

### Particle dependency size

A fresh read-only DAT census of player motion table `0x09000001` found 321 unique reachable animations; 31 contain CreateParticle hooks, naming 27 unique emitter definitions and 11 nonzero hardware meshes. These are total closure references, not measured incremental loads or a startup benchmark; scripts may already share some assets. Expanding the existing closure is bounded enough to implement directly before optimizing.

### Distance emission: established frame, approved threshold approximation

- Retail `ParticleEmitter::SetParenting` (`acclient.c:317404`) parents the emitter physics object to the named part and authored offset. `CPhysicsObj::UpdateChild` (`:308302`) composes that part's frame (or object frame for the sentinel) with the offset. Thus emitter travel includes both articulated part motion and object motion; a stationary character's moving hands can supply travel.
- `ParticleEmitter::ShouldEmitParticle` (`:317715`) subtracts the last emitted position from the emitter physics object's current position. `RecordParticleEmission` (`:317703`) and `EmitParticle` (`:318087`) update that baseline after emission. This is endpoint displacement since the last emission, not an established accumulated path-length counter.
- `ParticleEmitter::UpdateParticles` (`:318307`) attempts at most one emission per update. `ParticleEmitterInfo::ShouldEmitParticle` (`:312447`) gives time-trigger bits precedence over distance-trigger bits. This does not establish the missing distance comparison.
- The decompile loses that comparison into undefined x87 condition flags (`v9`, `v10`, address `0x00517FBA`). Both `ACE/Source/ACE.Server/Physics/Particles/ParticleEmitterInfo.cs:155` and `ACViewer/ACViewer/Physics/Particles/ParticleEmitterInfo.cs:155` compare absolute last-emission time with squared displacement and mark the expression `// verify`. That is not independent confirmation and cannot justify a production rule. Do not copy it or claim birthrate-based spacing is proven retail behavior. The user subsequently approved birthrate-based spacing as an explicit approximation.
- Fresh archive census: 2,051 emitter records; 1,849 time-only and 202 distance-only, with no combined-trigger records. Windup hand-trail emitter `0x32000109` has zero initial particles, birthrate 0.05, and a ten-second duration. The unsupported ongoing trigger therefore explains why this trail stays absent even if its assets are prepared.
- No retail binary/disassembly was found among the workspace's tracked/searchable files. Resolving the exact comparison requires stronger evidence, such as the original instructions around `0x00517F50`, or a controlled retail observation that distinguishes candidate rules. DAT values and the two derivative implementations do not suffice.

Decision updated after user approval: implement phase 2 using authored birthrate as spacing, multiplied by one shared tuning value. Exact retail recovery remains unresolved but no longer blocks implementation. Describe restored trails as using the approved approximation; visual calibration belongs to the user.

### Gesture classification and representation

The component table has ten scarab entries. Lead uses `Invalid` (`0x80000000`); the other entries name six distinct windup commands: `0x10000070`, `72`, `74`, `76`, `78`, and `0x10000132`. Diamond shares `72`; Platinum/Dark/Mana share purple command `132`. The named power-up families contain additional variants; the player table also contains these variants, but that is not proof every one is emitted by current spell formulas.

Non-Invalid talisman gestures name 14 distinct release commands in `0x4000002b..=0x40000039`, excluding `0x40000032`. There is no overlap with scarab windup commands. Talisman peas use Invalid and must not be classified as release. ACE maps an invalid chosen release to Ready and permits `casterItem.UseUserAnimation` overrides (`Player_Magic.cs:648`); arbitrary server-custom overrides cannot be safely classified from command names alone. Ordinary spellbook casting has a clear mapping; preserve existing policy for unclassified item commands.

Pickup/reach uses `0x40000018` and height variants `0x40000136..=0x40000139` (`Player_Inventory.cs:661`). Drop uses `MotionPickup`, whose player-inherited default is Pickup (`Container.cs:981`). These identify reach motions, not proof of an inventory transaction; the same motion could be used elsewhere. Local motion policy must not fabricate transaction ownership from this classification.

**Important correction to the original plan:** windup commands have the action bit (`0x10000000`); release and pickup commands have the substate bit (`0x40000000`). `world/src/motion/state.rs:94` distinguishes these classes. `entity.rs:1389` queues command-list and action-class forward commands; snapshot reduction (`:439`) removes only action-class forward commands. Therefore release/pickup remain forward substates, not FIFO entries. ACE FastTick batches windup actions (`WorldObject_Networking.cs:1231`) and later sends release as a forward command (`:1096`). Older ACE mode sends windup as action-class forward commands (`:1078`), which our reducer also converts into action edges.

Decision: classify motion semantics independently of storage. Windup interruption must drain eligible queued work; pickup interruption must replace the eligible substate/transition; release protection must preserve the authoritative substate through manual input. The release-to-Ready return link also belongs to the release behavior. Resume movement on its authored retirement boundary, not on a guessed timer or UseDone.

### Playback contract decision

The host projects current clip/pose values rather than a retained history of gesture retirements. Strict interruption-specific emitter cleanup would require additional ownership and retirement information to survive coalesced updates. The finite-emitter census below and user steering removed that requirement: already-created emitters finish under their authored limits. No host/frontend gesture-history contract was added.

## Implementation checkpoint — phase 1

- Shared command dependency extraction now feeds prepared animations and scripts. Default animations and motion-table closures join script references before per-resident emitter acquisition.
- Mesh staging consumes prepared emitters directly, including server cues and sky scripts. Activation awaits mesh installation; existing generation and release paths retain ownership.
- Synthetic runtime integration covers both animation lanes through successful, failed, and superseded mesh staging, with real hook dispatch creating emitters after readiness. The 54 runtime tests and 41 focused repository/entity tests pass. App type checks, ESLint, and Knip passed before the final lifecycle test extension; test type checking passed afterward.
- Browser harness: WCID 192, landblock `0xda55ffff`, building/object/generated radii 1, default render scale and SwiftShader, normal 10-second settle: passed with no browser errors. A first run using a shortened 1-second settle failed the entity-count lifecycle assertion; the normal-settle run passed. This verifies loading/lifecycle, not casting visuals or performance.
- Player table `0x09000001`: five isolated runs with cold frontend repositories, warm local debug content host, sequential animation/emitter acquisition and batched mesh preparation measured 321 animations, 27 additional emitter definitions, 11 additional meshes, and 11 texture dependencies. Emitter+mesh transfer/decode/preparation added median 63.4 ms (48.9–75.4 ms); animation preparation median 1341.3 ms (1124.1–1472.9 ms). This measures the isolated no-script/no-residency baseline, excludes texture/GPU upload, and is not a full startup benchmark. Runtime sharing can reduce incremental work. Temporary DAT-dependent test was removed. No user visual acceptance is claimed.

## Implementation checkpoint — phase 2 and lifecycle steering

Implemented:

- Distance-only emitters use squared endpoint displacement from the last actual birth, with authored birthrate times `SHARED_FRONTEND_TUNING.particles.distanceSpacingMultiplier` (initially 1). The constructor rejects nonpositive/nonfinite multipliers. Time triggers retain precedence.
- The baseline includes the live attached part and rotated hook offset. Explicit placement advances other than integration, and snapshot/upsert placement replacements, re-anchor the owner and attached descendants. Existing particle records do not move.
- Initial bursts, capacity, finite budgets/duration, particle lifespans, stop-with-drain, and at most one ongoing birth per update remain intact. No hidden gesture timeline or catch-up trail was added.
- The app-local host/decoder contract now calls the authored field `birthrate`, removing the incorrect assumption that its unit is always seconds. The approximation is documented beside the predicate; no exact-retail claim is made.
- Quality review found a pre-existing shared-mesh readiness race exposed by this work: a second owner could finish waiting for decode before the first owner's GPU upload finished. `ParticleMeshCache` now owns the installation promise, so all waiters share complete drawable readiness and failure. The redundant retained decoded-mesh map/read accessor was removed; the cache retains resident IDs.
- Final phase 1–2 verification: all 2,408 TypeScript tests across 297 files passed; full app checks, ESLint, Knip, Rust formatting, and diff whitespace checks passed. The focused particle suite has 61 tests; mesh cache tests cover shared installation readiness and failure/retry.
- Scoped host Clippy passed with warnings denied after replacing two pre-existing constant-size chunk loops in the icon compositor with fixed-size array iteration. All 10 particle-emitter host tests and 4 compositor tests passed.
- The canonical candle browser scene passed with no browser errors; the screenshot visibly retains its flame. The final WCID 192 spawn/despawn browser run also passed after the mesh readiness change. These checks verify loading and the existing time-emission path; distance density and casting/movement remain user-owned visual gates.

## Follow-up: can interrupted gesture emitters simply finish?

User steering: investigate whether omitting interruption-specific emitter cleanup could leave permanent effects. This is a read-only content investigation; no production behavior changed in this follow-up.

### Census and source checks

- Loaded shipped player motion table `0x09000001`, all 321 unique referenced animations, and all 27 emitter definitions named by their CreateParticle hooks. **All 27 have a positive particle budget or duration; none is persistent/unlimited.** This broad check includes hooks outside the particular gesture clip windows, so it provides a conservative upper bound for the whole player table.
- Narrowed to the six scarab windup commands, 14 non-Invalid talisman release commands, and five pickup/reach commands recorded above. Inspected cycles and incoming/outgoing links, resolved clip bounds using the production clamping convention, and separated forward/backward hook directions. No CallPES hooks occur in these inspected gesture windows.
- Windup uses **15 unique definitions**: 14 immediate-burst definitions, each with `initial_particles = total_particles = max_particles = 10`, and distance trail `0x32000109`. The bursts have no remaining emission budget after creation; their particles live at most 1.5 or 2.5 seconds, depending on the definition.
- Release uses only trail definition `0x32000109` in the inspected windows. Pickup/drop reach cycles and transitions contain **no particle creation, stop, destroy, or CallPES hooks** (180 table entries, 35 distinct clip windows inspected).
- Trail `0x32000109`: `total_seconds = 10`, `total_particles = 0`, `initial_particles = 0`, `max_particles = 40`, particle lifespan 2 seconds with zero variance. Thus a skipped stop hook permits emission only until ten seconds after emitter creation, followed by at most two seconds of remaining particle life under ordinary advancement. This is not ten seconds added at interruption.
- Ordinary windup `0x030005a0` creates the trail in slots 19–22, attached to parts 12/15; backward frame-1 hooks normally stop those slots. Release hooks address slots 1–4. Skipping a stop extends a bounded effect rather than making it permanent. Recreating a nonzero slot replaces its existing emitter in the current runtime.
- Cross-checked `ACE/Source/ACE.Server/Physics/Particles/ParticleEmitter.cs::StopEmitter` and frontend `ParticleSystem.#applyAutoStop`: duration or exhausted particle budget stops further births. The frontend reaps remaining particles by lifespan; hidden finite effects are reconciled on visibility rather than spawning a catch-up trail.

### Consequence for the plan

The earlier history-versus-natural-completion blocker overstated the need for strict interruption cleanup. For these shipped player gestures, **letting already-created emitters finish under their authored limits is a bounded visual concession**: moving after interruption can keep drawing hand trails for the remaining ten-second emitter duration, with a two-second particle tail. Burst effects already behave like particles fading out. Pickup/drop has no particle cleanup requirement in the inspected content.

This supports a third, simpler policy: retain normal authored stop hooks when played, skip future hooks when playback is interrupted, and allow existing emitters to reach their own budgets/durations. It avoids both retirement-history machinery and a new natural-completion cutoff. The continued implementation adopts this simpler policy in phase 3. Earlier ownership/history proposals above are historical investigation, not implementation requirements.

Scope: shipped player table and the identified commands. This does not establish limits for arbitrary custom motion tables or script-owned effects. No live visual acceptance was run. The temporary DAT-dependent Rust probe was removed from the repository; raw evidence is disposable under `/tmp/casting-emitter-lifetimes.txt` and `/tmp/casting-emitter-summary.json`.


## Movement implementation trace after policy simplification

- `MovementSystem::drive_local_authored_motion` currently applies manual orders through `WorldState::drive_authored_motion_for_body`. `BodyMotionRuntime::drive` deliberately retains the active action prefix and starts pending actions. Therefore replacing the steady order alone does not interrupt windup.
- `BodyMotionRuntime::interrupt_transitions` clears every queued action and transition. Manual override needs narrower eligibility so unrelated actions and release transitions survive. Reusing that broad contact/death operation without qualification would violate the plan.
- Fresh network state enters through `WorldState::accept_entity_motion` and `MotionRuntimeRegistry::accept_remote`, then `BodyMotionRuntime::accept_order`. This admission boundary is distinct from continuous manual selection and can retain release ownership without polling a stale entity snapshot to restart it.
- Release/reach selection updates `MotionState::substate` immediately while the sequence retains authored entry/return links. `MotionSequenceRuntime::is_cyclic` exposes whether transitions have retired. Release protection must account for the return link after the selected substate has already changed to Ready, and for contact interruption.
- Next implementation step: introduce narrow command semantics and local arbitration in the existing world playback owner, exercised by synthetic sequence tests, then connect core manual intent. No additional host/frontend emitter contract is planned.


### Phase 3 implementation checkpoint: selective windup retirement

- `MotionCommand::movement_override_gesture` now classifies the six proven windups, fourteen releases, and five reach commands. Unknown/custom commands remain unclassified.
- Sequence nodes now retain their position within the active action instead of only a final-clip boolean. `BodyMotionRuntime::interrupt_windup` filters queued windups and removes only the active windup's clips, preserving unrelated actions and transitions admitted before/after it. Skipped hooks and completion are not emitted.
- Repeated-substate collapse now respects intervening action clips, preventing a repeated destination from deleting an active action's completion boundary.
- This is playback groundwork. Core manual intent is not connected yet; release protection, reach suppression across stale snapshots, movement integration, and end-to-end tests remain incomplete.

- Verification for this checkpoint: all 817 world library tests pass (81 motion tests), scoped world Clippy passes with warnings denied, Rust formatting and diff whitespace checks pass. New cases cover unknown command exclusion, queued/active action selectivity, preservation of preceding cursor and following transition, skipped hooks/completion, and repeated-substate collapse across an action. These do not establish core input integration or live casting acceptance.


### Movement implementation checkpoint: world/core arbitration

- `BodyMotionRuntime::drive_manual` now applies manual eligibility before advancing the sole authored cursor. Windups retire selectively; reach entry/hold/return yields; release entry/hold/return preserves its authored motion until its actual sequence boundary. Contact/jump presentation retains its priority.
- One `pending_gesture` command tracks recognized release/reach substate lifetime through return links. `suppressed_reach` prevents the last accepted snapshot from replaying a manually interrupted reach; fresh admission permits a new reach. Existing script/emitter lifetimes remain unchanged.
- Core manual drive calls this world arbitration path. Pending release also keeps the local physical adapter active after input stops, so release root motion is not lost or double-advanced.
- Packet-level inspection found that the prior server-control adapter discarded manual ownership on every gesture packet. Recognized gestures and their idle return now retain current manual input; actual approach directives and unclassified playback keep the previous server-control path.
- Manual input lifetime is now independent of selected movement ownership. Held input can resume after temporary server control; finite pulses retain their original deadline and cannot become indefinite holds. Stop and placement-epoch retirement clear that lifetime.
- Synthetic sequence tests cover release entry/hold/return with held/released input, windups queued ahead of release, later windups while held, new windups while idle, reach return interruption, stale reach suppression, and airborne presentation. A core packet test routes actual movement messages through world admission and server-control handling, checking release root movement and continued manual drive through idle/reach. A separate test rejects expired-pulse resurrection.
- Still required: broader packet/simulation tests for physical collisions, jump/contact boundaries and authoritative replacement; explicit busy/inventory outcome coverage; final quality review, full app/host checks as appropriate, and honest visual acceptance handoff. The new packet fixture has no animated transition clips, so only the world sequence fixtures currently prove exact entry/return timing.

- Latest shared verification: all 457 core and 824 world library tests pass; world/core all-target Clippy passes with warnings denied, formatting and diff whitespace checks pass. Core required socket-enabled execution for two existing network tests that the sandbox rejected; both pass with that access.


### Verification and review checkpoint

- Physical simulation regression now admits a real windup packet, interrupts it through manual input, and checks that the flat collision solve applies exactly one authored locomotion/stop displacement. Spell busy remains active throughout.
- The grounded-jump regression now admits a spell release packet before charging and launching. Launch commits once from the expected origin, enters Falling, and preserves spell busy. Existing support-edge tests cover contact interruption and skipped hooks.
- Inventory tests exercise production reach override while a drop or pack exchange is pending: no optimistic removal, duplicate request, premature continuation, or loss of pending ownership. Server confirmation/rejection still controls the outcome; item disappearance follows the existing timeout policy after pack-slot compaction. These are client contract checks, not evidence of live ACE drop coordinates.
- Review fixed a release-facing edge: retiring an older windup now preserves the sticky target renewed by a newer release packet. A focused registry test verifies it. Unrelated authoritative substate replacement retires release protection.
- Manual Reset now clears input lifetime as well as controller state, preventing later gesture packets from reviving reset input.
- All 458 core and 826 world library tests pass; all-target Clippy passes for core/world/3D host with warnings denied. App checks are being re-run for the final gate. Earlier browser checks and preparation measurements remain the applicable evidence; no live casting visual acceptance is claimed.


## Baseline completion audit and handoff

| Requirement | Current evidence |
| --- | --- |
| Animation-only particle readiness, sharing, failure and supersession | Runtime preparation tests exercise real hook dispatch after definition/mesh readiness; shared mesh installation tests cover concurrent owners and retry. Player closure census and timing measurements are recorded above. |
| Approved distance spacing and discontinuities | 61 particle tests cover stationary/attached motion, thresholds, tuning, re-anchor, time precedence, caps, budgets and lifetime behavior. No exact-retail threshold claim. |
| Windup/reach interruption with release preserved | World sequence tests cover selective clip removal, unknown commands, held/released input, release entry/hold/return, reach return and stale snapshot suppression. Core packet tests cover admission and exactly one movement republication per gesture boundary. |
| Normal physical movement and mid-cast jump | Fixed-tick tests verify exactly one authored displacement through the flat collision solve, stop transition motion, a committed mid-cast jump, Falling presentation and unchanged spell busy ownership. Existing contact/approach tests remain passing. |
| Server-owned inventory and casting outcomes | Packet capture tests permit only normal movement publications during casting. Reach-override inventory tests preserve pending work and equipped membership until authoritative confirmation; rejection/disappearance do not emit an extra continuation. Live server placement remains a user gate. |
| Quality and validation | Accumulated production diff reviewed across world/core and frontend dependency/emitter ownership. Final 458 core, 826 world, and 2,408 TypeScript tests pass; full app checks, ESLint, Knip, scoped host tests, core/world/host Clippy, Rust formatting and diff whitespace checks pass. |

Final TypeScript run used `npm run test:ts -- --maxWorkers=4`. An earlier concurrent run hit five-second timeouts in two unchanged renderer property tests; both passed with the full suite at four workers. No timeout settings or renderer tests were changed. Core's socket tests required socket-enabled execution and passed there.

Final review also requires one fresh movement publication after a recognized server gesture even when held axes match the previous publication; subsequent ordinary ticks remain deduplicated. This preserves movement after ACE's phase-boundary physics stops. Reset/stop/placement retirement clear retained manual-input lifetime; pulses retain their original expiry across temporary server ownership.

The browser spawn/despawn and canonical candle checks recorded above passed. They do not establish live casting visuals, density calibration, or ACE inventory outcomes. The unchecked user-owned acceptance list is the handoff, not an automated success claim. No interactive TUI was run, no DAT-dependent tests were retained, no commit was made, and the pre-existing ACE submodule change was left untouched.
