# Entity collision eligibility

Status: complete. Implementation, production-path verification, cleanup, and seam audit are finished. The user authorized committing after the final quality pass. The user authorized creating this plan after the
initial investigation found gaps in authoritative-state propagation. This is a follow-up to the
completed entity-physics redesign, not a reopening of its solver or crowd-tuning work.

## Goal and boundaries

Make entity contact eligibility follow the verified client collision rules, including live changes,
through one shared policy consumed by physical queries and contact reporting.

In scope:

- Player/player exemptions and PK, PKLite, and impenetrable exceptions.
- Directional ethereal/static rules and existing missile exclusions.
- Authoritative facts from creation, property updates, and relevant object refreshes.
- Physical consumers: hard sweeps, support, crowd resistance, overlap separation, recovery checks,
  and solidification checks. Reporting must share applicable exclusions without equating observation
  with obstruction.
- Analytic source checks and asset-independent unit/integration fixtures.

Out of scope:

- Mob/mob overlap tuning, changes to pushing strength, momentum, reconciliation, or solver scheduling.
- A generic collision-layer engine, configurable rule registry, or new spatial index.
- Invented projectile targets inferred from nearby enemies, attacks, or sticky pursuit.
- A general rewrite of entity lifecycle or unrelated protocol handling.

## Ground truth and current findings

Paths below are relative to the repository root. Line numbers identify the inspected revision;
symbols are the durable lookup anchors.

| Source | Finding / purpose |
| --- | --- |
| `acclient-eor-source/acclient.c:304609`, `CPhysicsObj::FindObjCollisions` | Player exemptions, ethereal and viewer handling; response/report distinction. |
| `acclient-eor-source/acclient.h:32800`, `CWeenieObject_vtbl` | Names the decompiled virtual calls used by that filter. |
| `acclient-eor-source/acclient.c:418315`, `ACCWeenieObject::IsPKLite`, `IsPK`, `IsImpenetrable` | Client reads public description flags. |
| `acclient-eor-source/acclient.c:449427`, `PublicWeenieDesc::SetPlayerKillerStatus` | Status 4 sets PK, 0x40 sets PKLite, 0x20 sets impenetrable; other values clear those three flags. Preserve unrelated flags. |
| `acclient-eor-source/acclient.c:302641`, `OBJECTINFO::missile_ignore` | Target-sensitive rule exists, but existence does not establish delivery of a target to the client. |
| `acclient-eor-source/acclient.c:302685`, `OBJECTINFO::init`; `:307392`, `CPhysicsObj::get_object_info` | Ordinary transition preparation. No ordinary ignore-creatures producer identified. |
| `acclient-eor-source/acclient.c:333148`, `CObjCell::find_obj_collisions` | Self/parent and initial-placement exclusions. |
| `ACE/Source/ACE.Server/Physics/PhysicsObj.cs:403`, `FindObjCollisions` | Readable counterpart of player exemptions. |
| `ACE/Source/ACE.Server/Physics/ObjectInfo.cs`, `MissileIgnore` | Explicit server modification for two-way projectile detection; do not copy blindly into the client. |
| `ACE/Source/ACE.Server/WorldObjects/PKModifier.cs:173`; `Player_Death.cs` | PK changes broadcast public `PlayerKillerStatus` updates. |
| `ACE/Source/ACE.Server/WorldObjects/WorldObject_Networking.cs:28`, `SerializeUpdateObject` | Update serializes a create-shaped description; identical shape does not imply identical lifecycle behavior. |
| `crates/holtburger-protocol/src/messages/game_message/unpack.rs:141` | `UpdateObject` already decodes. No world handler was found in the investigation. |

Initial pipeline and gaps (superseded by execution findings below):

1. `world/src/entity.rs::apply_description` retains public flags. `Entity::set_property` stores PK
   updates but does not synchronize those flags. `state/mutations.rs::apply_property_update_to_target`
   has a body-scale side effect, but no contact-status side effect.
2. `core/src/client/collision.rs::client_entity_body_facts` joins entity data for preparation.
   `core/src/dynamic_entity.rs` builds `DynamicBodyCollisionDefinition` with shared geometry.
3. `world/src/entity_physics.rs::EntityDynamicCollisionPolicy::accepts_response_from` only checks
   mover response permission, solid target, and non-missile target. It lacks player pair semantics
   and authored staticness for the ethereal-mover exception.
4. `world/src/spatial/mobile_contact.rs::ContactParticipant::receives_response_from` is the common
   physical entry point. Reporting in `mobile_contact/step/report.rs` and solidification filtering
   in `dynamic_index.rs::pair_is_filtered` have separate decisions that must be reconciled.
5. `spatial/physical_body.rs::dynamic_configuration_for_state` replaces state-derived policy while
   retaining geometry. New identity/category facts must survive this path and local physics hooks.

## Required behavior

For ordinary solid bodies with geometry and no overrides, the symmetric player matrix is:

| Pair | Can obstruct? |
| --- | --- |
| NPK / NPK, NPK / PK, NPK / PKLite | No |
| PK / PK | Yes |
| PKLite / PKLite | Yes |
| PK / PKLite | No |
| Impenetrable player / any player | Yes |
| Player / creature; creature / creature | Yes |
| Player or creature / solid fixed object | Yes |

“Can obstruct” is eligibility, not a no-overlap guarantee or momentum-transfer rule. NPCs and pets
have no separate exemption in the inspected pair filter. Do not reuse our narrower pushable-character
classification as retail creature identity.

Verified directional overrides (retail FindObjCollisions and missile_ignore):

- Ethereal target does not ordinarily block and is excluded from step-down support; the combined
  ethereal/ignore-collisions target is skipped entirely.
- Ethereal mover ignores non-static targets while still respecting solid static geometry.
  Static means the authored physics bit, not frozen, settled, fixed-position geometry, or excluded
  from local integration.
- Missile targets are skipped by the retail missile filter. Targeted-missile exceptions remain
  conditional on proving a client-owned target input.
- Nonblocking contacts may still report. Player exemptions and missile exclusions can skip geometry
  altogether; determine report eligibility from those branches, not from the blocking result alone.

## Constraints, concessions, and north stars

- Authoritative world understanding belongs in `world`; protocol decoding remains lossless and
  frontend preparation supplies geometry, not independent gameplay rules.
- One owner normalizes mutable facts. Consumers do not reread properties or reinterpret flags.
- Separate cheap semantic refresh from expensive geometry preparation. A PK change must not recreate
  a body, restart animation, reset reconciliation, or lose an accepted physical path.
- Preserve directional decisions; do not collapse asymmetric pairs into a single symmetric boolean.
- Keep grouping of dependent facts honest. Prefer a player-specific value within a category type
  over independent player/PK booleans that admit meaningless combinations. Preserve source bit
  combinations if the wire permits them; do not invent mutual exclusion without proof.
- Preserve existing residency, attachment, and query-domain gates. Semantic eligibility does not
  grant scene residency or override a missing geometry contract.
- No cached per-pair state unless a demonstrated need warrants it. The pair rule should be cheap,
  pure, and independently testable.
- Mob overlap appearance remains an accepted deferred concern. Do not add ignore-creatures behavior
  solely because the retail enum has a flag for it.
- No live reproduction is required for deterministic policy or update routing. No permanent tests
  depend on local DAT files, server credentials, or an external server.

## Phase 1 — Analytic contract gate

- [x] Trace creation, public/private PK property delivery, object refresh, and physics hooks through
  entity mutation and installed body refresh. Identify sequence/liveness admission for each input.
- [x] Trace retail `SetPlayerKillerStatus` callers and preserve initial-description versus later
  property-update ordering. Avoid consulting a stale retained property after a newer description.
- [x] Trace `UpdateObject` in retail and ACE. Determine the required recreation, motion-directive,
  attachment-announcement, and reset behavior rather than assuming semantic-only refresh.
  Unknown-object creation and replacement use the proven force-recreate semantics and existing
  lifecycle admission, rather than an invented refresh-only instance guard.
- [x] Trace client projectile target writes, initialization and transport. Record either the concrete
  producer or the bounded conclusion that target-sensitive server behavior is not a proven client
  requirement. Do not block ordinary player eligibility indefinitely on this independent question.
- [x] Complete an explicit directional table of skip / observe-only / physical-response cases,
  including support and solidification. Verify the precise branches rather than extrapolating from
  flag names; correct the conversational matrix where necessary.

Acceptance: every proposed input has a named producer and update path; every output has a named
consumer. Record unresolved behavior explicitly. Stop for scope review if correct object refresh
requires a broad lifecycle rewrite or new protocol discovery. Missing `UpdateObject` handling is a
known gap to assess, not permission to implement the entire message surface speculatively.

## Phase 2 — Authoritative contact facts

- [x] Normalize player collision status from initial flags and admitted property changes, following
  the retail update operation. Test clearing old PK/PKLite/impenetrable bits.
- [x] Implement the bounded object-refresh handling established by Phase 1, or record a separately
  scoped prerequisite if it cannot be safely isolated. Source audit now proves forced recreation;
  sharing the existing create/replacement admission path is appropriate (see execution findings).
- [x] Carry normalized category/status and authored staticness into prepared contact data for client
  bodies. Give Explorer/direct-query producers explicit semantics appropriate to their sources.
- [x] Refresh installed semantic facts through the existing mutation/configuration path. Preserve
  geometry ownership and ensure later physics-state changes do not overwrite category/status.
- [x] Test description → PK update → physics hook/state update → contact preparation, plus instance
  replacement and stale updates where the existing admission contract supports them.

Acceptance: facts remain current on an already installed body; geometry and physical/presentation
continuity are preserved for a semantic-only update. Full object refresh follows proven recreation. Both controlled and remote players are covered.

## Phase 3 — Shared pair policy and consumers

- [x] Replace the incomplete pair predicate with a single world-owned eligibility operation. Final
  result shape follows the verified table: keep query suppression, observation, and response distinct
  only where consumers need them; avoid an unconstrained collection of policy booleans.
- [x] Route hard sweeps, support probes, crowd admission/resistance, separation, and recovery through
  this policy without introducing special cases in solver arithmetic.
- [x] Consolidate report and solidification exclusions with the shared rules. Solidification evaluates
  the prospective solid target; blindly querying its current ethereal state would defeat the check.
- [x] Add projectile target input only if Phase 1 proved its source. Otherwise document the precise
  supported client behavior and remaining research question, without a guessed target fallback.
- [x] Exercise a semantic change while a report is active: establish the existing report-end contract
  and prove an exempt pair cannot continue generating fresh contact reports.

Acceptance: all physical paths agree about exempt pairs, and observation-only contacts retain their
intended event behavior. No second PK rule remains inside a consumer.

## Phase 4 — Verification and cleanup

- [x] Table-test every player combination in both directions, including non-player counterparts,
  impenetrable exceptions, and flag transitions.
- [x] Table-test ethereal/static directionality, missile-target exclusions, and verified report cases.
- [x] Add focused production-path fixtures: overlapping exempt players have no separation or crowd
  resistance; an eligible pair retains existing resistance; hard-target eligibility and support agree.
  Use existing runtime tuning constants rather than hard-coded tuning values.
- [x] Verify public PK updates change the next contact decision on the same installed body, including
  a stationary target. Verify semantic-only updates preserve motion/path state and full object refreshes recreate as proven.
- [x] Remove replaced filtering helpers, redundant category derivations, and stale terminology.
  Update durable architecture notes with policy ownership and proven compatibility limits.
- [x] Run affected Rust library tests, formatting, and warning-denied Clippy; include app checks only
  if touched contracts reach the host/frontend. Inspect the final diff for unintended solver changes.

Maintainability acceptance:

- [x] No geometry rebuild or body lifecycle reset for contact-status-only changes.
- [x] No solver consumer reads raw object flags or PK properties.
- [x] No duplicated player exemption or missile exclusion logic between reporting and response.
- [x] Authored staticness is independent from integration eligibility and mobility.
- [x] New fields each have a producer, refresh rule, and named consumer; no speculative target fields.
- [x] The change leaves the accepted crowd model and its tuning intact.

## Risks and mitigation

| Risk | Mitigation |
| --- | --- |
| New description and retained property disagree | Normalize at admitted mutation time; test ordering instead of using a property-first fallback. |
| UpdateObject replays creation behavior | Establish refresh semantics and instance admission before routing it; preserve ongoing motion. |
| Physics hooks erase player facts | Keep state-derived policy and identity-derived facts under explicit owners; test successive updates. |
| Physical exemptions still generate gameplay collision reports | Share geometry-skip rules; independently test report lifecycle. |
| Solidification never notices an obstruction | Evaluate prospective solid participation, not current ethereal participation. |
| “Static” inferred from sleeping or fixed geometry | Carry the authored bit explicitly; cover frozen and settled non-static targets. |
| Server-only projectile knowledge leaks into client policy | Require a demonstrated client producer; do not infer from attack/sticky targets. |

## Decisions and completion

### Execution findings

- Final contract consolidation replaces the separate query/response predicates with
  `EntityContactInteraction::{Ignored, Observable, Blocking}`. This removes the caller obligation
  to combine two partial answers. The old `pair_is_filtered` forwarding helper was deleted.
- Exact consumer table: player-exempt, suppressed-target, missile-target, and missile-to-ethereal
  pairs are ignored; remaining solid targets block response-enabled movers unless an ethereal
  mover faces a non-static target; remaining pairs are observable, subject to report permissions.
  Self/residency/parent representation gates remain outside semantic policy. Support requires
  blocking, just as sweeps do. Solidification substitutes prospective solid target participation.
- Seam review inspected client local/remote installation, live PK mutation, physics reconfiguration,
  report traversal/lifetimes, resistance, hard sweep/support, recovery, and prospective solidification.
  No new serialized frontend contract or camera behavior was introduced. Explorer fixture changes
  explicitly declare non-player identity and authored staticness; possession is not PK identity.
- Deferred client-target research remains bounded: no nonzero named target writes were found in
  the available decompile. This is not proof about missing/unrecovered client code. There is no
  speculative target field or promise of server-targeted behavior in the implemented contract.

- `UpdateObject` now enters the existing create/replacement path, explicitly matching the
  force-recreate retail branch. It can introduce an unknown object; this is demonstrated by the
  retail function's missing-object branch and a world-message test. It inherits existing delete
  reconciliation rather than inventing a new instance gate. This supersedes the earlier plan's
  prohibition on sharing the create path and its assumption that a full refresh preserves motion.
- Public and private PK-message fixtures verify the installed body is unchanged except contact
  identity, including shared geometry pointer identity. Subsequent physics reconfiguration retains
  player status. A full refresh replaces stale PK-property state with its new description.
- Production collection fixtures cover mobile and hard peers: exempt players have no resistance,
  separation, or report touches; eligible PK pairs still obstruct. Changing to NPK stops touches and
  existing reports expire through the existing strict one-second report lifetime.
- Hard-top support fixture verifies that changing a pair to exempt players revokes support, while
  a PK pair retains it. The removed-support concession does not bypass this observed movement check.
- Verification: world/core library suites passed (707/358); the subsequently added support test
  passed. Warning-denied Clippy passed for world/core/3D-host/debug-harness across all targets.

- Implemented `PlayerCollisionStatus`, prepared separately from physics-state policy. Client
  installation joins current world identity after content work completes; admitted PK property
  changes update the installed status directly. State reconfiguration retains this identity.
- Added authored staticness to physics-derived policy and used it for ethereal mover response.
  Shared query exclusions now feed mobile/hard contact selection, report traversal, and
  solidification. No projectile target field was added without a source.
- Baseline world/core library tests passed after the policy cutover (701 world tests; core suite
  result in `/tmp/contact-policy-tests.log`). New matrix tests cover all ordinary player pairs,
  ethereal/static versus frozen directionality, and untargeted-client missile exclusions. Additional
  production-path and update-continuity fixtures remain required; passing baseline tests alone
  does not establish completion.

- `SmartBox::HandleUpdateObject` (`acclient.c:140101`) calls `HandleCreateObject` with
  `force_recreate=1`. The branch at `:139601` removes/recreates an existing object before the
  ordinary timestamped refresh path. The plan's initial assumption of a motion-preserving retail
  refresh was incorrect. Keep this lifecycle work separate from semantic-only PK updates; determine
  the appropriate bounded client admission before implementing the message.
- `ACCWeenieObject`'s integer update switch (`acclient.c:419736`) calls
  `PublicWeenieDesc::SetPlayerKillerStatus` for property 0x86. Both public and private integer
  messages already reach `Entity::set_property` through `apply_property_update_to_target`.
  Normalization is being added at that mutation point; later descriptions directly replace flags.
- The decompile's named `OBJECTINFO::targetID` references comprise two zero initializations
  (`:300334`, `:300868`) and the missile-filter read (`:302652`). No nonzero client producer was
  identified. Do not add speculative target storage. Server-targeted missile behavior remains
  unproven for the client and is independent from the confirmed player-policy work.
- Existing public/private property handlers do not perform per-property timestamp admission.
  This plan must not claim that adding PK normalization establishes stale-property rejection;
  preserve the existing transport/admission contract and test admitted update ordering.

- Initial expectation was a single predicate/preparation change. Investigation found missing live PK
  normalization, unhandled decoded object refreshes, and an unproven client projectile target source.
  The user requested this bounded plan before implementation.
- The earlier full matrix mixed a verified target-sensitive retail function with an unverified client
  data path. Phase 1 must resolve that distinction before treating it as an implementation requirement.
- No user preference is currently missing. The open questions are source/contract questions listed
  in Phase 1; answer them analytically before considering live diagnostics.

Definition of done: all applicable phase and maintainability checks pass; the supported matrix and
remaining explicitly deferred research are recorded; regression checks pass; no unrelated solver
changes remain. A broad prerequisite is not silently counted as complete. Commit only when requested.

## Completion audit

| Obligation | Evidence / disposition |
| --- | --- |
| Authoritative status normalization | `Entity::set_property`; flag-transition test plus public/private message tests. Later full descriptions replace the entity and its stale property state. |
| Current status at installation | Both coordinator completion paths join current world identity; delayed local completion test changes PK status while content work is in flight. |
| Preserve semantic-update continuity | `pk_messages_refresh_installed_identity_without_changing_body_state` compares the complete body except status, verifies shared geometry identity, and checks physics reconfiguration retains status. |
| Full refresh semantics | Both world routing stages handle UpdateObject; local/remote unknown-object and replacement tests pass. Force recreation is sourced to retail, not inferred from packet shape. Existing deletion reconciliation remains shared. |
| Complete pair contract | `contact_with` produces one of Ignored/Observable/Blocking. Table tests cover player pairs, non-player peers, static/frozen ethereal directionality, and demonstrated missile exclusions. |
| Physical consumers | `ContactParticipant::receives_response_from` feeds admission, separation, hard sweeps, support, and recovery. Mobile/hard peer integration tests prove exemptions remove response; support test proves an exemption revokes hard-top support. |
| Observation and lifetime | Production collection tests prove exempt pairs stop reporting; existing report lifetimes expire without new touches. Existing ethereal-trigger fixture remains green. |
| Solidification | Shared policy evaluates prospective solid state; current-overlap fixture now also proves player exemption and non-player obstruction. |
| Subtraction and API quality | Deleted both partial predicates and the forwarding filter. Consumers no longer combine independent partial answers; no raw PK checks in solver consumers. Geometry and contact status keep separate lifetimes. |
| Validation | Final world/core/host library suites: 708/358/276 passed. Subsequent local/remote refresh test passed. All-target warning-denied Clippy passed for world/core/host/debug-harness; formatting and diff checks passed. No frontend wire or TypeScript files changed, so app UI checks were not required. |
| Scope retained | No mob overlap tuning, solver arithmetic, scheduling, camera, or reconciliation changes. No credential-dependent tests. |

Remaining research: nonzero client projectile target delivery is not established by the available
source. The implementation and durable architecture document promise only the demonstrated
untargeted-client filtering. This is the explicitly allowed Phase 1 outcome, not an unfinished
implementation field. Existing property timestamp admission is unchanged; no new guarantee of
stale public-property rejection is claimed. No other required cleanup remains.

### Pre-commit quality pass

Reviewed the complete diff and immediate consumers: preparation/installation, admitted property
updates, state reconfiguration, query selection, report lifecycle, prospective solidification, and
local-player/full-object message routing. No additional blocking code or architecture findings.
Corrected a stale missile-field comment that implied unimplemented target/category inputs and
made the content-preparation versus installed-identity boundary explicit on the retained field.
The status join remains owned by the two client installation paths and world property mutation;
it does not participate in content cache identity or trigger a geometry rebuild. Existing async
completion and body-continuity fixtures cover that seam. All host/harness collateral changes are
explicit fixture initialization for the two added facts. No solver tuning changes are present.
