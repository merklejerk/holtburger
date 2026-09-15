# Casting movement and animation particles

Status: implementation plan, refined by source and local DAT investigation; no implementation or commit authorized by this document alone.

## Goal and boundaries

Allow normal manual movement during spell windup and pickup/drop gestures, retain authored movement during spell release, and restore animation-authored particles reliably.

In scope:

- Complete animation dependencies through particle emitter definitions and drawable meshes.
- Restore distance-based particle emission using the user-approved, visually tunable approximation below.
- Classify action commands by their actual meaning; permit manual movement to interrupt windup and pickup/drop playback.
- Preserve already-emitted particles while stopping further emission owned by the interrupted gesture.
- Preserve mid-cast jumping, server-owned operation outcomes, and existing selection semantics.

Out of scope: upper/lower-body blending, a hidden windup effect timeline, faster spell execution, auto-targeting, repeat casting, spell bars, a general combat controller, global cancellation of action animations, and new inventory transaction semantics.

User preferences:

- Windup should play while idle. Movement may replace it with normal locomotion.
- Spell release may temporarily retain authored movement; held input resumes afterward if still held.
- Existing particles surviving interruption is sufficient. Do not keep executing the interrupted gesture's future hooks.
- The user likes jumping mid-cast. Do not add retail pending-motion jump restrictions.
- The user owns all visual and interactive acceptance gates. The agent owns implementation, automated verification, review, and a focused handoff. User gates do not block completing that handoff.

## Ground truth and evidence

Paths are repository-relative. Retail citations refer to `acclient-eor-source/acclient.c`.

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
- Core local movement arbitration decides whether current manual intent may interrupt a classified action. World motion playback performs the interruption and yields the accepted movement/presentation result. Remote characters retain server-authored behavior.
- Frontend animation/particle presentation owns which emitters a played action started and stopping their future emission when that action is interrupted. Entity/script effects unrelated to that action remain intact.
- Core operation tracking remains independent. Moving, replacing a clip, or stopping an emitter neither completes nor cancels a cast/pickup/drop transaction.

North stars:

1. Complete existing asset preparation rather than adding lazy loads inside hooks.
2. Normal locomotion supplies movement and pose after an allowed override; do not sum locomotion with windup root displacement.
3. Never replay skipped gestures or execute their skipped hooks on interruption.
4. Distinguish an ordinary clip boundary from an action interruption. Forward/reverse clips within one gesture must not accidentally stop each other's emitters.
5. Preserve held input separately from temporary action ownership; releasing a key during release must prevent later movement.
6. Preserve server authority over timing, facing, corrections, and operation completion.
7. Keep every new field tied to a named consumer. Prefer reusing existing admission stamps, action identity, prepared handles, and lifecycle paths.

## Phase 1: Complete animation particle dependencies

- [ ] Extract direct emitter references from prepared animation hooks, sharing the relevant hook-reference extraction with physics scripts where their decoded contracts permit it.
- [ ] Combine references from default animations, motion-table animations, and script closures before emitter acquisition. Deduplicate per owner; repositories continue sharing immutable assets across owners.
- [ ] Make mesh preparation consume the prepared emitter set instead of independently reconstructing it from scripts. Include dynamic server script cues and other callers in the contract migration.
- [ ] Stage definitions and drawable meshes before activation; preserve generation checks and release every acquired handle on failure, supersession, replacement, and teardown.
- [ ] Cover both default-animation and motion-table entities. Avoid introducing a general dependency-graph framework for these concrete edges.
- [ ] Measure unique additional emitters/meshes and preparation impact for the player motion table. Record results before considering narrower loading.
- [ ] Correct stale staging comments and remove the script-only dependency assumptions from surviving symbols/contracts.

Acceptance: a synthetic animation-only CreateParticle hook reaches an actually prepared emitter and mesh through production preparation; shared references do not duplicate acquisition per owner; failure and supersession release resources. Tests must exercise preparation-to-consumer composition, not manually prewarm the missing assets.

## Phase 2: Implement the approved distance-emission approximation

Decision: the user approved treating each emitter's authored birthrate as minimum spacing in world-distance units, with one shared positive spacing multiplier initially set to 1. This is a deliberate approximation; the exact retail threshold and units are not recovered. Further reverse engineering is not an implementation gate.

- [x] Trace the attached emitter frame, displacement baseline, cadence, and trigger precedence; census shipped trigger types. Evidence below distinguishes established behavior from the missing threshold.
- [ ] Implement the threshold as `spacing = authoredBirthrate * spacingMultiplier`; emit when squared displacement from the last emission exceeds `spacing * spacing`. Use the live attached emitter origin, including its authored offset, so both hand articulation and character travel contribute.
- [ ] Put the single multiplier in existing frontend tuning, with the particle runtime as its named consumer. Preserve relative authored spacing across emitters; do not add per-spell overrides or a new settings UI. Require a finite positive multiplier. Zero authored spacing means any nonzero displacement qualifies, subject to the existing budgets.
- [ ] Preserve initial emission, capacity, total-particle budgets, duration, particle lifetimes, and at most one ongoing emission per update. Preserve time-trigger precedence and existing time-based behavior. Update the distance baseline only on actual emission; do not accumulate path length or generate catch-up bursts.
- [ ] Define initialization and discontinuity handling explicitly: initialize the baseline from the resolved attached origin before first emission; re-anchor on known teleports/resets rather than treating them as a traveled trail. Integrate with existing discontinuity/lifecycle signals rather than adding a guessed distance cutoff.
- [ ] Add deterministic fixtures for stationary, below/above threshold, attached-part movement, stopped emitters, budget limits, and discontinuous origins. Use explicit test-owned multiplier inputs or runtime tuning imports; changing the production multiplier alone must not break tests.
- [ ] Document the approximation beside the predicate, citing retail `:312447`, the unresolved comparison, the 202-emitter census, and user authorization. Do not describe it as a proven retail correction. Sweep obsolete comments that say distance emission is always skipped or blocked on recovery.

Acceptance: the approved distance rule passes focused tests, including hand movement with a stationary character; existing time-based emission remains unchanged. The user calibrates visible trail density using the one multiplier. Runtime-asset-dependent diagnostic tests stay temporary. Accurate retail threshold recovery remains optional follow-up, not a prerequisite for completing this phase.

## Phase 3: Establish action interruption semantics

- [x] Census shipped spell-component gestures and identify pickup/drop command families and the caster-item override path; results below.
- [ ] Add narrow semantic classification for both transient actions and forward substates. Retain existing behavior for unclassified commands; custom item override values are not exhaustively enumerated by the local catalog.
- [x] Trace action admission stamps through playback and identify where projection loses them; results below.
- [ ] Define playback ownership for both action and substate gestures, including interruption, natural completion, and ordinary clip transitions. An action-only stamp cannot cover pickup/release substates.
- [ ] Use existing identity where sufficient; if the projection loses required identity/outcomes, add the smallest lossless contract and update its producer, adapter, and consumer together. Do not infer interruption from animation-ID changes.
- [ ] Associate animation-created emitters with the action playback that created them. Stop only that playback's emitters on interruption, including contact interruption; allow already-emitted particles to expire. Guard against reused emitter IDs stopping a successor's effect.
- [ ] Preserve script-owned effects and ordinary forward/reverse hook execution. Clear ownership on natural retirement, entity replacement, teardown, and emitter replacement without a second unsynchronized emitter lifetime.

Acceptance: a multi-clip gesture preserves effects across ordinary clip changes; interruption stops further births without destroying existing particles or firing skipped hooks; unrelated/script emitters and a successor reusing an emitter ID survive. Host-to-frontend tests exercise the real interruption contract.

### Steering checkpoint

Review measured asset cost, recovered emission semantics, and the action-to-frontend contract before implementing movement. Update the remaining phases with concrete symbols discovered above. Routine refinements need no new approval; a materially different visual policy or unsupported source behavior must be surfaced. Do not silently broaden this into a universal animation/event framework.

## Phase 4: Free movement during spell windup

- [ ] Let current manual movement intent interrupt eligible local windup playback, including when input was already held before windup arrived. While movement remains held, later windup actions must not repeatedly seize control.
- [ ] Retire only obsolete eligible windup actions while preserving the authoritative release substate and its entry/return transitions. Ordinary release is not a queued action. Do not let manual-order application overwrite release, or an old windup completion restore a stale return state.
- [ ] Drive ordinary collision-aware locomotion after override, using its normal speed and root-motion policy. Do not create a second position integrator or bypass collision.
- [ ] On key release, return to the appropriate stance/current accepted playback without resurrecting interrupted windup. New eligible gestures may play while idle. Never repeatedly reapply an interrupted pickup substate merely because it remains in the last network snapshot.
- [ ] During release, preserve authored movement ownership while retaining the latest input. Resume only still-held input after the release boundary. No automatic recast or stance changes.
- [ ] Preserve current jump admission and contact interruption. Do not interpret release ownership as a new prohibition on mid-cast jumping.
- [ ] Preserve manual takeover of server-directed turning and normal movement publication. ACE may issue further authoritative motion or reject the cast.

Acceptance: synthetic tests cover idle windup, input before/during windup, subsequent windup actions, release substate arrival behind pending windup, release with held/released input, jump/contact edges, and authoritative replacement. Captured commands contain normal movement and no client-generated spell cancellation; spell busy remains until its existing terminal path.

## Phase 5: Extend the policy to pickup/drop

- [ ] Apply the same semantic eligibility to pickup/drop reach substates and their transition prefixes without introducing inventory-specific movement state. The transient action queue is not their owner.
- [ ] Preserve cancellation of automatic approach by manual input. Distinguish approach cancellation from overriding a reach that has already begun.
- [ ] Preserve authoritative inventory success/failure handling and pending transaction ownership. Local animation interruption never moves an item optimistically.
- [ ] Cover item disappearance, operation failure, held movement at gesture arrival, and drop completion after player movement.

Acceptance: movement can replace eligible reach playback; pending inventory operations still resolve through their existing server events. Tests verify no fabricated success, duplicate request, or stale operation ownership. Live ACE behavior remains a user acceptance gate, not a claim established by these tests.

## Phase 6: Cleanup, review, and handoff

- [ ] Sweep replaced dependency discovery, stale comments, duplicated command classifiers, and unused ownership fields. Review the accumulated diff across shared motion, core movement, host projection, and frontend asset/effect lifetimes.
- [ ] Run scoped Rust tests and Clippy with warnings denied, formatting, and relevant app manifest scripts for TypeScript tests, type checks, lint, and dead code.
- [ ] Reuse synthetic regression evidence; do not run the interactive TUI. No committed tests requiring untracked DATs.
- [ ] Provide the user the checklist below and distinguish automated results from visual/live results. Complete implementation and automated work without waiting for user-run gates.

## User-owned visual and interactive acceptance

- [ ] Cold start: stationary windup bursts and attached trails appear without another effect warming their assets. Repeat across spell levels and gesture variants.
- [ ] Calibrate distance-trail density with the shared spacing multiplier: inspect stationary casting hand trails and moving emitters across representative effects. Accept the visual approximation without claiming exact retail matching.
- [ ] Move before/during windup: normal movement speed and locomotion, no deferred gesture replay. Existing particles fade naturally and interrupted emitters stop producing particles.
- [ ] Stop, reverse direction, strafe, and turn during windup. Test a target ahead/behind; ACE controls release/facing outcomes.
- [ ] Hold movement through release, then repeat while releasing the key during release. Verify temporary authored release movement and correct resumption.
- [ ] Jump mid-cast: preserve the accepted behavior without obsolete animation backlog or lingering emitters.
- [ ] Pickup/drop: interrupt approach, move during reach, and inspect the final item location/result. Check failures and repeated input.
- [ ] Reconnect/change character: no stale particles, held movement, action ownership, or pending operation UI.
- [ ] If relevant to the user's server, compare NPK and PK casting displacement behavior. No promise to bypass server restrictions.

## Risks and concessions

- Added dependencies increase cold preparation work. Measure first; keep repositories shared and acquisition bounded to actual references.
- The distance threshold is an approved approximation affecting 202 shipped emitters, not just windup. A single multiplier preserves relative authored values but cannot guarantee every effect matches retail; user visual calibration should sample more than one effect. Exact recovery is optional follow-up.
- Current host projection describes clips, while cleanup needs action lifecycle meaning. Strengthen only that seam; a generic event bus or hidden effect timeline is not required.
- Skipped reverse stop hooks can strand emitters. Explicit interruption cleanup must precede freer movement.
- Full-speed movement may expose ACE corrections or cast failures. Keep server outcomes visible; do not compensate by falsifying motion or completion.
- New windup actions and a release substate can arrive while movement is held. Arbitration across both representations must avoid stuttering movement, overwritten release, or resurrected pickup playback.
- Visual behavior deliberately departs from retail action priority at user request. Document source citations and the measured affected command/content set; do not claim this is an unobservable retail defect fix.

## Definition of done

- [ ] Animation particle dependencies are complete through drawable mesh readiness.
- [ ] The approved distance-emission approximation and shared tuning multiplier are implemented and tested; its limits and user-owned calibration are documented.
- [ ] Eligible local actions yield to manual movement; release retains authored movement; mid-cast jumping remains available.
- [ ] Existing particles survive interruption, further action-owned emission stops, and no skipped hooks or obsolete actions replay.
- [ ] Casting and inventory outcomes remain server-owned; no duplicate stance, selection, busy, or movement state.
- [ ] Automated checks and final quality review pass; user acceptance checklist is handed off with honest coverage.

Agent handoff and user acceptance are separate milestones. Do not claim the individual user gates passed without results. No commit unless separately requested.

## Open questions

No user preference is needed to begin the planned work. The distance threshold policy is settled by user approval of the approximation in phase 2. Remaining technical design includes discontinuity integration and the smallest playback-interruption projection contract covering actions and substates. Shipped component classification and the current projection gap are now established below. If those findings require changing the agreed behavior, surface that decision before implementing the changed policy.


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

### Playback identity and interruption projection

`EntityMotionAction` retains command, speed, action sequence, outer admission identity, and source. The action sequence alone is insufficient: command-list and forward-action paths use different sequence domains, and sequences wrap. The world runtime retains this composite identity while it owns the action.

`MotionPresentation` / `PlayingMotionClip` omit that identity. `core/src/dynamic_entity_view.rs:370` projects only animation ID, bounds, rate, completion, or settled frame. Frontend `dynamic-entity-motion.ts` compares those values; equal clip values are unchanged, and rate-only changes retime the current clip. This cannot distinguish repeated identical gestures, an interruption, or ordinary clip changes within one gesture. An adapter cannot reconstruct the omitted proof.

Decision: extend the owner-produced playback contract to carry gesture lifetime meaning across the existing projection path. Cover substates as well as actions; do not simply expose `active_action` as the sole owner. Preserve ordinary forward/reverse transitions under one lifetime. Interruption cleanup needs to survive coalesced host updates and a late frontend realization; a transient notification alone is insufficient. The implementation must define a snapshot-compatible retirement/ownership rule before choosing fields. Keep this bounded to actual effect cleanup and movement consumers.

ParticleSystem already offers stop-with-drain (`particle-system.ts:642`), which preserves existing particles. Its current stop operation matches entity/emitter ID, not the creating playback. Reuse the stop behavior with exact instance/owner matching so a late interruption cannot stop a newer emitter or script effect that reused the ID. Do not introduce a second particle collection merely to track ownership.

Automated source/data investigation only: no live client or server acceptance was run. No production files changed during this investigation.
