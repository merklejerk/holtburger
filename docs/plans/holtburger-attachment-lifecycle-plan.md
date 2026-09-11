# Attachment lifecycle and resolved scene placement

Status: complete; implementation, consumer audit and final verification passed.
Updated: 2026-09-10.

## Goal and boundaries

Prevent missing-parent crashes by retaining entity data while world owns whether its scene
placement is resolved and usable.

Keep one entity store. Ordinary updates apply to retained entities even when they cannot enter the
scene. Route child descriptions, parent child-lists and ParentEvent through one attachment owner.
Body creation, selection and presentation consume its resolved placement contract.

In scope: attachment ordering; retained off-scene entities; placement resolution; parent
arrival/removal/replacement; position and pickup transitions; bounded unresolved lifetimes;
world/core publication and cue integration; focused verification.

Out of scope: ordinary-message buffering, general network replay, a second entity store,
transport changes, visibility-distance tuning, projectile simulation, renderer attachment
transforms, and Electron error suppression. Do not combine inventory ownership, camera visibility,
asset readiness and attachment resolution into one universal lifecycle enum.

## Evidence and reference sources

The original error originates in world selection's ancestor lookup. A temporary Rust test
reproduced it by attaching a child, removing its parent, then delivering a late ParentEvent.
Removal cleared the attachment; the late event restored an invalid reference. This proves a
failure path, not the packet history of the user's session or a full application reproduction.

A second investigation proved retained data can receive vector and stack updates without a scene
body. It also proved that preserving a nonzero position allows a later vector update to recreate
that body through today's recovery path. Both observations came from a passing temporary world
test; diagnostics were removed afterward. Subsequent implementation adds publication and cue
coverage; final expiry and playback verification remains incomplete (see completion audit).

Inventory/container retention already separates data existence from world presence.
`clear_entity_world_presence` retains data but erases the landblock and retires the body. Distant
entities survive a visibility grace period; actual entity pruning removes them. Collision-content
residency is another lifetime. None is a complete scene-admission contract today.

| Reference | Verified relevance |
| --- | --- |
| `acclient-eor-source/acclient.c:138345`, HandleParentEvent | Wait for missing endpoints/future parent incarnation; reject obsolete parent incarnation. |
| `acclient-eor-source/acclient.c:137361`, DoParentEvent | Require and advance a newer child position timestamp when attaching. |
| `acclient-eor-source/acclient.c:139601`, especially 139658–139667 | Retail defers attached creation when the parent is absent. Match observable readiness, without requiring the same storage architecture. |
| `acclient-eor-source/acclient.c:299661` and 299488 | Missing-object queues use destruction scheduling with a 25-second deadline; inspect refresh/removal details before implementing expiry. |
| `acclient-eor-source/acclient.c:137339` and 138985–139014 | Pickup and accepted position transitions unparent under position sequencing. |
| `acclient-eor-source/acclient.c:298795` | Destruction unparents the object and its children. |
| `ACE/Source/ACE.Server/WorldObjects/Creature_Missile.cs:44` and `Player_Tracking.cs:116` | Reload sends equipment creation and attachment messages. Flying projectiles are separately created objects. |

Use ACE for message production and retail for client behavior. Do not modify the retail decompile
or the user's existing ACE changes. No live traffic census establishes frequency, typical chain
depth or performance needs; do not invent limits or indexes from assumptions.

## Constraints and north stars

- Retain authoritative entity data and valid updates independently of scene participation. Inventory
  queries must not lose access merely because scene placement is unresolved.
- Preserve wire placement facts; do not null a valid received position just to suppress a body.
  A detached child does not automatically acquire an independent usable world placement.
- Distinguish received attachment intent from a resolved scene attachment. World computes each
  derived placement fact once; consumers and validators do not independently walk ancestry.
- Resolve parent placement before child placement. An unresolved parent leaves descendants
  unresolved; cycles are explicit errors rather than recursion or fabricated roots.
- Use existing wrap-aware sequence helpers. Parent incarnation and child position are different
  domains; ParentEvent has no child incarnation, so do not invent that guarantee.
- Preserve each input's authority. Parent child-lists lack the complete placement/sequence facts
  available in other messages; unification must not flatten those distinctions away.
- Missing prerequisites may delay scene admission; proven stale input may be discarded. Bound
  unresolved work without defeating legitimate inventory/container retention.
- Preserve local-player authority and existing instance-scoped delete/visual-description rules.
- Replace scattered participation decisions rather than adding a parallel policy layer. Prefer a
  narrow typed placement result over independent flags, visibility fallbacks or a generic framework.
- Every new field needs a named consumer and every transition needs an executable example.

## Architectural decision: retained data, conditional scene participation

Use the existing entity store as the off-scene holding area. An entity does not need to move to a
second collection when its parent disappears. Ordinary property, stack and vector messages keep
updating its retained data through their existing handlers.

Existing inventory retention and visibility grace periods establish the useful precedent: data can
outlive scene presence. They are not interchangeable with attachment readiness. An evicted
landblock concerns residency; it does not by itself say that an entity's parent relationship is
usable. Reuse retention, but make usable placement an explicit world-owned decision.

The minimum additional machinery is:

1. Placement intent on the entity: independent, attached, or withdrawn. Withdrawal is necessary
   because removing a parent link must not turn an old retained position into a fresh world pose.
2. One world resolver and reconciliation owner, shared by body admission, selection and publication.
   The current resolver walks ancestry without a dependency index or cached graph.
3. Bounded pending placement transitions for prerequisites that have not arrived. Retaining an entity
   cannot apply a message to an unknown child or to a future incarnation. Ordinary updates to known
   entities do not need a replay queue.
4. Scene admission/withdrawal events separate from data creation/deletion, plus reuse of the existing
   cue inbox while scene placement is unavailable.

The trade-off is a small placement lifecycle rather than a generic message replay system. Retention
alone cannot prevent vector recovery, selection or publication from interpreting stale coordinates
as usable placement. Those consumers must honor the shared decision. Do not add a general
“purgatory” service, a second entity lifetime, or a universal visibility state.

## Intended contract and transitions

World owns a typed result distinguishing usable independent placement, resolved attached placement,
and no usable scene placement with a specific reason. `EntityPlacementIntent` lives on `Entity`;
`ResolvedScenePlacement` is derived by `WorldState::resolve_scene_placement`.
A missing entity remains distinct from a retained entity whose placement is unresolved.

Do not automatically equate a camera-offscreen entity with an unresolved entity. The former can
still have valid placement. Also distinguish parent placement readiness from downstream asset or
collision-content loading, to avoid circular admission prerequisites.

| Trigger | Retained data | Required scene outcome |
| --- | --- | --- |
| Child description names unavailable parent | Store description; accept valid ordinary updates | No independent body, selection candidate or dynamic visual until resolved. |
| Parent becomes usable | Keep child identity and latest state | Resolve chain; establish dependent bodies/placements and publish coherent admission. |
| Parent loses usable placement | Keep child data subject to lifecycle retention | Withdraw dependent scene participation; never fall back to old child position. |
| Newer independent position or pickup | Apply verified sequence/transition rules | Supersede obsolete attachment intent; independent position may admit, pickup may remain off-scene. |
| Parent or child replaced | Apply incarnation rules to data and pending relationships | No stale relationship may bind to an incompatible incarnation. |
| Entity deleted or unresolved deadline expires | Apply explicit-delete and retention rules | Retire scene state and pending dependencies; discard entity data only when its retention ends. |
| Ordinary property/vector update while unresolved | Update stored facts normally | Must not independently create a body or emit an unusable dynamic entity. |

These are required outcomes, not a substitute for the sequence/deadline disposition table below.
Attachment-specific pending input is still needed when the child itself is unknown, an event names
a future parent incarnation, or a parent announces an unknown child. This does not require
buffering all ordinary updates to already-described entities.

## Phase 1 — Settle placement and lifecycle contracts

Deliverable: exact types, transition dispositions and consumer responsibilities recorded here
and checked against the implementation. Resolve technical questions from references and tests; stop for
user review only on a major gap or material scope change.

- [x] Specify where authoritative placement intent and the resolved result live. Reuse existing
  placement/body/lifecycle types where possible; avoid copying entity data or storing redundant
  booleans. Name consumers of ancestor/body identity if included in the result.
- [x] Define missing/current/future/old parent-instance and old/equal/new child-position outcomes,
  including wraparound, both arrival orders, and child-list precedence. Specify when sequence
  advancement occurs versus when scene admission occurs.
- [x] Define readiness propagation for chains without making parent readiness depend on a child
  body or frontend asset loading. Resolve once in world; choose simple traversal before indexing.
- [x] Specify removal, replacement, reset, expiry and deadline refresh rules for both retained
  unresolved entities and attachment-specific pending input. Preserve valid future work; stale
  nonzero positions and unresolved owners must not confer accidental perpetual retention.
- [x] Audit accepted position/pickup detachment, including the current sequence-only position early
  return. Specify supersession of pending relationships before a parent later appears.
- [x] Define data-created versus scene-admitted/withdrawn event semantics. Existing inventory and
  TUI data events remain meaningful; visual admission must not fabricate entity recreation.
- [x] Trace sound/script timing, dynamic-scale effects and authored motion/hooks for a retained
  off-scene entity. Decide which state may advance and which effects must wait; verify observable
  equivalence against retail. Reuse core's cue inbox where appropriate without replaying state twice.

Acceptance: each transition has a disposition and test input; types have clear ownership;
expiry, body readiness and cue timing have no unresolved implementation assumptions.

## Phase 2 — Cut over world placement ownership

Implementation decisions and evidence so far:

- `resolve_scene_placement` is world-owned and returns independent, attached (immediate link plus
  independent root), or unresolved (missing, deleted, or unplaced endpoint). Cycles are typed errors.
  Readiness uses authoritative placement facts rather than body existence, avoiding circular body
  admission. The current implementation is an uncached ancestor walk; consumers do not rederive it.
- Selection consumes this result, and body initialization/recovery rejects unresolved attachment
  intent. The complete world suite passed (743 tests), including a full selection-query regression
  and retained-data/vector-recovery coverage. This is not full lifecycle completion.
- Dynamic projection now returns `Result<Option<View>>`: unresolved placement is an ordinary absence,
  while malformed admitted data remains an error. Snapshot and incremental paths consume it.
- `EntityPlacementIntent::{Independent, Attached, Withdrawn}` now distinguishes received placement
  authority from scene readiness. Withdrawal preserves coordinates without authorizing body recovery.
  Explicit inventory/pickup transitions may still clear world location under their existing semantics;
  unresolved attachment alone must not erase received coordinates.
- `AttachmentLifecycle` owns parent announcements, deferred placement transitions and the previous
  reconciled placement used to emit transitions. The latter is an event comparison baseline, not a
  second entity store. Reconciliation runs after message handling and during world ticks.
- ParentEvent waits for missing endpoints or a future parent instance, discards old parent instances,
  and applies only a newer child position timestamp. It carries no child instance guarantee.
  Pickup and independent position use their own object's instance and position timestamps. Sequence
  checks run again when deferred input becomes eligible; accepting intent need not admit a scene body.
- Deferred placement input waits on a named endpoint. Missing endpoints have a 25-second deadline;
  another placement message queued for that endpoint refreshes the waiting group's deadline. A tick
  does not refresh it, and expired work is not revived. Future incarnations of retained endpoints
  share the endpoint's lifetime rather than acquiring an arbitrary missing-object timeout.
  Parent announcements share an existing missing-child deadline. Repeating the child list does not
  refresh it; queuing an endpoint message does. Expired dependencies are removed before handling new
  messages so a fresh announcement cannot inherit an expired placeholder lifetime.
- Endpoint removal drops pending input for the removed incarnation, preserving explicitly future
  instances where the wire identifies them. Parent removal withdraws children; simply recreating the
  parent does not authorize an old withdrawn relationship. A fresh accepted relationship can readmit
  the retained child without changing the child's incarnation.
- Replacement parent child-lists withdraw omitted old children. Listed children preserve their own
  authored placement; first parent arrival must not be treated as replacement of a previous parent.
- Retail position admission unparents before its contact/teleport effect, including the sequence-only
  early return (`acclient.c:138985–139048`). Missing-cell recovery is also relevant without contact
  (`acclient.c:311475`). Position routing now shares the deferred placement owner for remote entities;
  local-player authority remains separate.
- ACE's `Network/GameMessages/Messages/GameMessagePickupEvent.cs` writes object instance and position
  as two u16 timestamps. The protocol decoder previously read those four bytes as a success boolean.
  The implementation corrects that contract and its documentation; literal-byte tests cover decoding.
- `EntityScenePlacementChanged` reports admission/withdrawal independently of creation. Core projects
  unresolved entities as no dynamic view and uses placement changes for removal/readmission.
- Sound/script dispatch queues when the physics object is missing (`acclient.c:137206–137255`). Core
  reuses its cue inbox and replays after admission. Initial default scale setup waits for participation;
  bulk authored motion/hooks pause while unresolved, but incoming motion state remains accepted.
  Scale commands and active ramp sampling now wait while placement is unresolved. Script timestamps
  remain absolute: overdue hooks execute on readmission, and new ramps begin at execution time.
  Existing ramps catch up against their original start time. References: `update_object` at 311146,
  `ScriptManager::UpdateScripts` at 316431, and `SetScale` at 308862. A focused coordinator test verifies
  withdrawal, retained scale, catch-up and a newly started ramp without backdating it.

The final acceptance evidence is recorded below. Earlier partial test runs are historical evidence,
not substitutes for the final suite and consumer checks.

Primary files under `crates/holtburger-world/src/`: `attachment.rs`, `entity.rs`,
`handlers/inventory.rs`, `state/mutations.rs`, `state/types.rs`, `state/liveness.rs`, and a focused
state module if warranted. Inspect movement routing and all body creation/recovery callers.

- [x] Keep described children in the entity store and apply ordinary updates through existing
  handlers. Preserve create/delete reconciliation, appearance updates and inventory semantics.
- [x] Converge the three attachment inputs on one owner. Replace existing pending-child machinery
  rather than keeping two authorities. Retain only required attachment-specific pending inputs.
- [x] Reconcile resolved placement on the transitions above, including descendants. Preserve
  authoritative intent while unresolved and reject obsolete relationships at the owning boundary.
- [x] Make `add_entity`, replacement, `apply_authoritative_pose_effect`, `ensure_runtime_body`,
  vector recovery and other body creation paths honor that decision. No stale pose may revive a
  body for an unresolved attachment. Preserve resolved attachments' delegated pose behavior.
- [x] Integrate expiry with retention; withdrawing from the scene does not itself delete data.
- [x] Emit coherent placement transitions after reconciliation. Intermediate events must not expose
  a child with a missing ancestor. Comment types and unintuitive reference-derived rules.
- [x] Replace tests that depend on unconditional zero-sequence attachment admission with meaningful
  ordering scenarios; do not just adjust fixture numbers until tests pass.

Acceptance: ordinary updates remain lossless for retained children; unresolved entities have no
participating body; every attachment path and lifecycle transition uses the same placement owner.

## Phase 3 — Integrate consumers and verify behavior

Primary files: world's `spatial/collision/selection_ray.rs`; core's `client/dynamic_entity_view.rs`,
`client/mod.rs`, `client/messages.rs`, `client/entity_cues.rs`, `client/dynamic_scale.rs`,
`client/collision.rs` and `client/simulation.rs`. Frontend changes only where evidence requires them.

- [x] Selection consumes resolved scene participants. Missing prerequisites are normal unresolved
  state; contradictions in an admitted relationship remain explicit failures.
- [x] Dynamic snapshots and upserts consume the same result. Publish withdrawal on loss and fresh
  admission on resolution, without changing entity incarnation or losing updates received meanwhile.
- [x] Physical simulation, pose projection and authored motion/hooks respect participation; avoid
  implementing another ancestry walk in core.
- [x] Integrate the Phase 1 cue decision. Entity existence alone must not trigger unusable visual
  or sound delivery; avoid delaying or applying stateful script effects twice.
- [x] Verify retained entity access still serves inventory/container and TUI consumers correctly.
- [x] Reproduce the original message sequence through production handlers and a full collision-backed
  selection query. Check valid candidates alongside the unresolved child, then parent arrival/loss.
- [x] Test stale/duplicate events, wraparound, GUID recreation, newer detach before resolution,
  deletion while unresolved, bounded expiry, multilevel chains, cycles and local-player behavior.
- [x] Test retained nonzero positions plus vector/body recovery, and updates throughout the waiting
  interval. Assert both the retained values and absence of scene participation.
- [x] Exercise publication, selection and cue behavior with a noninteractive synthetic harness.
  Use the browser harness for the changed presentation boundary; do not launch the TUI. A live
  ranged-mob run is supplementary and must not be claimed from synthetic evidence.

Acceptance: valid attachments still appear and follow their parent; unresolved children neither
crash selection nor leak into presentation; retained state survives and admission is coherent.

## Phase 4 — Cleanup and completion audit

- [x] Remove superseded attachment paths, participation checks, vocabulary and temporary diagnostics.
  No retained tests may require untracked runtime assets.
- [x] Review line growth and ownership. New contract code should replace scattered assumptions;
  no general replay infrastructure or unrelated lifecycle expansion is introduced.
- [x] Add retail markers only for deliberate observable compatibility decisions, with the required
  citations and evidence. Our storage strategy alone is not a retail divergence.
- [x] Run relevant checks and record results, runtime evidence and any precise limitations here.

From repository root:

```sh
cargo fmt --all --check
cargo test -p holtburger-world
cargo test -p holtburger-core
cargo test -p holtburger-protocol
cargo check -p holtburger-cli
cargo check -p holtburger-3d-host
cargo clippy -p holtburger-world -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings
```

For browser verification use the app's `harness:browser` script. Run its `test:ts`, `check` and lint
scripts as applicable to changed frontend code/fixtures. Treat clippy warnings as errors.

## Risks and remaining decisions

| Risk | Mitigation |
| --- | --- |
| Consumer bypasses scene admission | Audit snapshot, incremental publication, selection, bodies and cues; verify all against the same transitions. |
| Body recovery revives unresolved entity | Gate creation/recovery centrally; test retained nonzero wire positions. |
| Placement becomes a universal lifecycle enum | Keep ownership, visibility and asset loading separate; only model reasons required by placement consumers. |
| GUID reuse or stale input restores old attachment | Revalidate available incarnation/position facts; respect wire limitations. |
| Retention creates immortal unresolved chains | Specify expiry independently of mere owner existence while preserving genuine inventory retention. |
| Off-scene script processing changes observable timing | Scene-gated hook consumption and ramp sampling; absolute-time catch-up covered by the coordinator test. |

No user preference currently blocks the retained-data direction. The deadline and timing decisions are settled and covered by focused tests. Stop for user review only if
they require a broader replay system, another entity lifetime owner, or another material scope change.

## Current verification and handoff

The checklists above remain acceptance gates, not a claim that all existing code is verified.
Earlier combined runs passed world/core/protocol suites, and an earlier clippy run passed for
world/core/3D host. The browser `entity-selection` fixture also passed its GPU checks. That fixture
covers the selection presentation surface; it is not a live reproduction of the ranged-mob incident.

The production-handler integration test now passes with child-first creation, delayed cue delivery,
withdrawal and same-incarnation readmission. The missing test trait import was fixed. Two older
force-position tests were corrected to name their entity's current instance: future-instance
packets now properly defer rather than exercising force-position behavior immediately.

Current results after the timing/deadline changes: all 398 core, 269 protocol and 751 world tests
passed. Clippy passed for world/core/3D host/CLI with `--all-targets -- -D warnings`. Host and CLI `cargo check` also passed. The two focused frontend suites passed all 62 tests. No live ranged-mob reproduction is claimed.

The deadline regression proves later traffic for one missing parent preserves both waiting children
past the first packet's original deadline. Future-parent admission is also tested beyond the
missing-object timeout; a newer independent child position still supersedes deferred attachment.
The scale regression proves unresolved data keeps its last sampled scale, catches up an existing
ramp on admission, and starts an overdue new ramp at admission rather than backdating it.

Cleanup renamed the old pending-child helper to `resolve_announced_attachment`, narrowed the body
event helper to private visibility, and updated cue documentation to describe scene admission.

Final audit evidence:

| Requirement | Evidence |
| --- | --- |
| One retained store, independent scene readiness | `Entity::placement_intent`, `WorldState::resolve_scene_placement`; no ordinary-message inbox or duplicate entity store. |
| No missing-parent selection failure | `late_attachment_to_removed_parent_does_not_poison_other_selection_candidates` runs production ParentEvent handling and collision-backed selection with another valid candidate. |
| Both arrival orders and parent child-lists | World state tests `a_parent_announcing_an_unarrived_child_attaches_it_on_arrival` and `a_child_that_arrives_first_is_delegated_once_its_parent_exists`. |
| Retained updates cannot recover an orphan body | `unresolved_data_accepts_updates_without_vector_recovery_creating_a_body` checks nonzero position, vector timestamp, stack state and body absence. |
| Chain readiness, deletion and cycles | `scene_placement` tests cover missing/unplaced/placed/deleted roots and a cycle retaining nonzero positions. |
| Incarnation, supersession and wraparound | `attachment_lifecycle` tests cover future admission past 25 seconds, newer independent position, shared ParentEvent/Pickup ordering and GUID recreation; existing instance-delete and visual-description tests remain green. |
| Expiry and inventory retention | Missing-endpoint expiry, shared-parent refresh, announcement refresh distinction and orphan-versus-owned-inventory tests. |
| Publication and cue order | `retained_attachment_publishes_and_replays_its_cue_only_after_parent_arrival` uses packed protocol messages through core; checks one cue after admission, withdrawal and same-generation readmission. |
| Authored playback and scale timing | `world_creation_update_and_replacement_have_distinct_playback_lifetimes` now includes unresolved pause/resume; `withdrawn_scale_waits_then_catches_up_without_backdating_new_ramps` covers effect timing. |
| Frontend consumer compatibility | 62 tests in `dynamic-entity-feed.test.ts` and `game-presentation-runtime.test.ts`, including child-first realization and child-before-parent teardown. Feed removal deletes the current record, permitting same-generation readmission. |
| Reset and cleanup | World constructors initialize the single attachment owner; endpoint removal retires bound work while preserving explicitly future instances. Superseded pending-child and delegation helpers are removed. |

The code-quality review traced placement intent through body recovery, selection, dynamic projection,
retention, authored playback and cue delivery. World owns relationship semantics; core owns effect
scheduling/publication; the unchanged frontend owns asset readiness and attachment transforms.
The event comparison map retains only prior incarnation/placement, not entity data. Deadline fields
serve the two existing consumers (announcements and deferred placement events) under the same owner.
The added lifecycle module replaces the old pending-child and delegated-position paths; most new
verification lives beside its owner. The remaining cost is an uncached ancestor walk and full
reconciliation at world message/tick boundaries. No dependency index is justified by the available
workload evidence. No new deliberate retail divergence or compatibility marker is introduced.

No runtime tests depend on untracked assets. The browser harness uses local content as a separate
integration check. No TUI was launched. The user's ACE changes remain untouched. Implementation initially finished without staging or committing; the user subsequently requested
a full diff review and commit.

Final commands passed:

- `cargo fmt --all --check` and `git diff --check`.
- World/core/protocol test suites: 751 / 398 / 269 tests respectively.
- `cargo check -p holtburger-3d-host -p holtburger-cli`.
- `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-3d-host -p holtburger-cli --all-targets -- -D warnings`.
- `npm run test:ts -- src/lib/game/runtime/dynamic-entity-feed.test.ts src/lib/game/runtime/game-presentation-runtime.test.ts`: 62 tests.
- `npm run harness:browser -- --fixture entity-selection --brief`: exit 0 after its selection
  assertions, using the rebuilt host and real Chrome. Log: `/tmp/holtburger-placement-browser.log`.

The final world architecture documentation now names placement resolution and reconciliation rather
than the removed delegation helper. Rust reports a dependency future-compatibility notice for
`binrw 0.15.1`; project checks and clippy's warnings-as-errors gate passed. The browser result verifies
rendered selection, while Rust integration tests establish the attachment lifecycle behavior. This
is synthetic verification, not a claim to have reproduced the user's exact live packet history.

## Post-completion camera follow-up

The user reported camera snap-in during open-terrain movement after implementation. Live diagnostics
showed continuous target paths with approximately 55–73 ms of pending travel, below the 120 ms
recovery limit. Recovery was triggered solely by the two-path count cutoff introduced in
`84b82aff` (`fix(camera): preserve player travel timing across camera updates`), before this plan's
changes. Whether the attachment work affected its frequency was not established.

Removed that count cutoff while retaining the travel-time limit and discontinuity recovery.
A regression reproduced the reset before the fix and passed afterward; all 400 core tests and
core clippy passed, and the host was rebuilt. Temporary diagnostics were removed. The user
confirmed that the fix resolved the camera symptom. No remaining action blocks plan closure.

## Final diff review before commit

Reviewed the full accumulated diff, including the new lifecycle/resolver modules, protocol decoding,
world retention and body mutation, core projection/cue/scale adapters, TUI accessor migration, camera
playback, tests and documentation. The review found and corrected:

- Replacement withdrawal named the new incarnation even though the frontend still held the old
  one. Placement-change events now carry the previous generation; removal and stale scale cleanup
  use that exact generation. The production-message integration test covers visible generation 0
  replaced by unresolved generation 1 and requires removal of generation 0.
- The invalid-attachment-location test had an absent parent and never reached location validation.
  Its fixture now supplies the parent before sending the malformed event.
- Live attachment application accepted missing-child deadline data it never consumed. It now
  accepts a `PhysicsAttachment`; deadline lookup is limited to genuinely missing children.
- The scale command's exported scheduled-time field lost its consumer when ramp execution timing
  was corrected. Removed it; scheduled times remain internal ordering data.

Final review validation passed: 751 world, 400 core and 269 protocol tests; 62 focused frontend
tests; all-target world/core/3D-host/CLI clippy with warnings denied; formatting and whitespace
checks. No further blocking code-quality findings remain. The uncached world resolver/reconciliation cost
is an accepted trade-off, not a measured performance improvement. The unrelated ACE work remains
outside the commit. The camera cutoff fix has separate regression coverage and user-confirmed live
verification; its causal relationship to the lifecycle work remains unproven.

## Definition of done

- [x] Final contract and transition rules recorded; all three attachment inputs cut over.
- [x] Retained unresolved entities accept ordinary updates without acquiring scene participation.
- [x] Original late-event sequence cannot create an admitted orphan or fail selection.
- [x] Parent arrival/loss and independent placement changes correctly admit/withdraw descendants.
- [x] Ordering, incarnation, expiry, inventory retention and cue behavior match verified decisions.
- [x] World/core tests, browser evidence and required checks support the full behavior claim.
- [x] Obsolete machinery and diagnostics removed; no staging or commits unless requested.
