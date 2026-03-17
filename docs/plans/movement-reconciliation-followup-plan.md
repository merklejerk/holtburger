# Movement Reconciliation Follow-up Plan

## Context & Boundaries

## Progress Update

### 2026-03-17: Phase 1 Completed

- Added sparse player-owned `PositionType -> WorldPosition` retention on `PlayerState` for non-live self position-property updates.
- Routed `PrivateUpdatePosition` and `PublicUpdatePosition` through named world helpers so only `PositionType::Location` mutates live world transforms.
- Kept generic entity state lean: non-self public non-`Location` updates are now treated as non-live and ignored rather than being surfaced onto entities.
- Added focused `holtburger-world` tests covering self private/public non-`Location` retention and non-self public non-`Location` no-op behavior.
- Verified with:
  - `cargo test -p holtburger-world position_non_location`
  - `cargo test -p holtburger-world stale_player_autonomous_sync_is_ignored`

### Goal

Close the remaining movement-authority gaps after the initial stale `UpdatePosition` and forced-reposition fixes, while preserving the project boundary that `holtburger-world` owns authoritative state and frontends own higher-level controller policy.

### In Scope

- Audit and fix all remaining self-movement apply sites that can accept stale or semantically wrong packets.
- Stop treating position-property packets as live locomotion when they are not actually current location.
- Add stale-order guards for self non-autonomous `UpdateMotion` if ACE sequencing semantics support them.
- Add teleport-start automation teardown in a way that matches the controller/front-end ownership model.
- Upgrade movement diagnostics so logs reflect teleport, force-position, and server-control epochs instead of only force-position deltas.
- Add focused tests for each corrected path.

### Out of Scope

- Full 3D-client prediction redesign.
- Generic property modeling for every unimplemented position-valued property unless needed to safely stop corrupting live position state.
- Reworking `holtburger-world` handler routing beyond what is required for movement correctness.

## Investigation Summary

### Item 1: `PrivateUpdatePosition` / `PublicUpdatePosition`

Findings:

- ACE uses these packets as property-style position updates, not the same thing as authoritative live movement.
- In ACE, these messages carry a byte sequence tied to `SequenceType.UpdatePosition` plus a `PositionType` field. See:
  - `ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessagePrivateUpdatePosition.cs`
  - `ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessagePublicUpdatePosition.cs`
- `PositionType` includes many non-live locations such as `Sanctuary`, `LastOutsideDeath`, `LinkedPortalOne`, and `TeleportedCharacter`. See `crates/holtburger-protocol/src/messages/movement/types.rs`.
- ACE currently emits `PrivateUpdatePosition(player, PositionType.LastOutsideDeath, corpse.Location)` on death.
- Our current handler in `crates/holtburger-world/src/handlers/movement.rs` still maps all self `PrivateUpdatePosition` and all self/non-self `PublicUpdatePosition` directly into live entity motion via `set_player_position` / `move_entity_to_position`.

Implication:

- This is not only a stale-ordering concern. It is also a semantics bug: non-`Location` position properties can overwrite the actor's live world transform.

### Item 2: stale `UpdateMotion` ordering

Findings:

- Self non-autonomous `UpdateMotion` is handled in `crates/holtburger-core/src/client/messages.rs` and executed immediately through `MovementSystem::handle_server_controlled_movement`.
- We currently store `server_control_sequence` and `movement_sequence` on the player, but do not reject stale non-autonomous motion events.
- ACE `MovementData` writes:
  - `ObjectMovement` with `GetNextSequence(SequenceType.ObjectMovement)` for every motion packet.
  - `ObjectServerControl` with `GetNextSequence(...)` for non-autonomous movement and `GetCurrentSequence(...)` for autonomous movement.
- For self non-autonomous motion, `server_control_sequence` is therefore the main authoritative epoch key, with `movement_sequence` available as an additional packet-order signal if needed.

Implication:

- We have enough ground truth to add a stale-order guard for self non-autonomous `UpdateMotion`.

### Item 3: teleport-start automation teardown

Findings:

- On `PlayerTeleport`, `crates/holtburger-world/src/handlers/player.rs` updates only `teleport_sequence`.
- `crates/holtburger-core/src/client/messages.rs` logs portal transition start and sends login complete, but does not surface a frontend event or reset automation.
- Current frontend automation teardown is driven by `ForcedReposition` only.
- `ClientViewEvent` has no teleport-start event today.

Implication:

- There is no hook for controller-owning frontends to suspend approach/sticky state when a teleport begins.

### Item 4: bootstrap `ObjectCreate` self position path

Findings:

- Self `ObjectCreate` is handled player-first in `crates/holtburger-world/src/handlers/player.rs` and uses `sync_player_position`, not live movement mutation.
- Routing order in `crates/holtburger-world/src/handlers/routing.rs` means this path is intentionally bootstrap-oriented and does not go through the generic movement handler first.
- `sync_player_position` in `crates/holtburger-world/src/state/physics.rs` is explicitly documented as bootstrap/hydration-only.

Implication:

- This path looks intentional and low-risk. The likely work here is documentation plus regression coverage, not behavioral change.

### Item 5: movement diagnostics

Findings:

- `MovementSystem` stores only `last_sent_pos_seq: Option<u16>` in `crates/holtburger-core/src/client/movement.rs`.
- `crates/holtburger-core/src/client/messages.rs` uses it only to warn when force-position sequence advances.
- Teleport and server-control sequencing are not tracked in the same diagnostic state.

Implication:

- Diagnostics are currently too narrow to explain stale teleport or stale server-controlled movement issues.

## Ground Truth & Existing Patterns

### Reference Sources

- `ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessagePrivateUpdatePosition.cs`
- `ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessagePublicUpdatePosition.cs`
- `ACE/Source/ACE.Server/Network/Motion/MovementData.cs`
- `ACE/Source/ACE.Server/Network/Sequence/SequenceType.cs`
- `ACE/Source/ACE.Server/WorldObjects/Creature_Death.cs`

### Existing Patterns In This Repo

- Self `UpdatePosition` stale gating:
  - `crates/holtburger-world/src/player/mutations.rs`
  - `crates/holtburger-world/src/handlers/player.rs`
  - `crates/holtburger-world/src/state/physics.rs`
- Frontend-owned forced-reposition handling:
  - `crates/holtburger-core/src/client/navigation.rs`
  - `apps/holtburger-cli/src/pages/game/state.rs`
- Authoritative world/player split and bootstrap sync:
  - `crates/holtburger-world/src/handlers/routing.rs`
  - `crates/holtburger-world/src/state/physics.rs`

## Phased Implementation

### Phase 1: Fix position-property semantics before ordering

Deliverables:

- Change `crates/holtburger-world/src/handlers/movement.rs` so `PrivateUpdatePosition` and `PublicUpdatePosition` no longer blindly mutate live position.
- Introduce explicit handling by `PositionType`.
- Add minimal authoritative storage for self and/or entity position properties if required to avoid silent data loss.

Preferred implementation shape:

- Treat only `PositionType::Location` as a live-location candidate.
- Route non-`Location` values into explicit sparse player-owned position-property storage keyed by `PositionType` rather than a fat closed model with one field per position variant.
- Do not let this logic live in the movement handler as implicit ad hoc branching; add focused helpers on `PlayerState` / `WorldState` so the semantics are named.
- Preserve omission-friendly behavior: only allocate/store entries that actually arrive from the server.
- Keep ownership concrete: these values live on `PlayerState`, not generic `Entity` state. If frontends need them, expose them through player-scoped query/accessor surfaces rather than by widening the entity model.

Acceptance Criteria:

- A `LastOutsideDeath` update no longer changes the player's live location.
- Existing current-location behavior for true live movement packets is preserved.
- Tests cover at least one non-`Location` private update and one non-self public update path.

### Phase 2: Guard stale self `UpdateMotion`

Deliverables:

- Add a helper on `PlayerState` to decide whether a self non-autonomous `MovementEventData` is current.
- Gate `MovementSystem::handle_server_controlled_movement` from `crates/holtburger-core/src/client/messages.rs` using that helper.
- Update player sequence state only when the packet is accepted.

Preferred implementation shape:

- Use `server_control_sequence` as the primary stale-order key for self non-autonomous `UpdateMotion`.
- Use `movement_sequence` only if needed as a tie-breaker or for diagnostics; do not invent ordering semantics without evidence.
- Preserve current behavior for autonomous motion snapshots and non-player entities.

Acceptance Criteria:

- Older non-autonomous `UpdateMotion` packets are ignored.
- Newer non-autonomous `UpdateMotion` packets still drive server-controlled movement and send the confirming `AutonomousPosition` heartbeat.
- Tests cover at least one stale and one current self non-autonomous motion packet.

### Phase 3: Add teleport-start automation teardown

Deliverables:

- Add a frontend-visible event or equivalent engine-owned hook for `PlayerTeleport`.
- Make the CLI respond by cancelling current locomotion automation immediately.
- Choose and document sticky policy for teleport start.

Recommended policy:

- Full reset for teleport start: clear active approach and sticky latch, because a teleport usually invalidates target-space assumptions rather than merely correcting them.
- Keep forced reposition behavior as the softer policy: preserve sticky latch there.

Acceptance Criteria:

- A `PlayerTeleport` packet stops active automation before post-teleport world updates arrive.
- The selected sticky policy is covered by tests and documented in code comments or plan decisions.

### Phase 4: Lock in bootstrap intent and diagnostics

Deliverables:

- Add a regression test or comment proving `ObjectCreate` self position sync is bootstrap-only and intentionally bypasses stale gating.
- Replace `last_sent_pos_seq` with a richer diagnostic struct that tracks at least teleport, force-position, and optionally server-control sequence.
- Upgrade logs in `crates/holtburger-core/src/client/messages.rs` so they can distinguish stale force-correction, teleport-epoch shifts, and server-controlled motion reordering.

Acceptance Criteria:

- Bootstrap `ObjectCreate` remains unchanged except for tests/docs.
- Diagnostic logs clearly identify which sequence advanced.

## Risks & Mitigations

- Risk: non-`Location` position properties currently have nowhere obvious to live.
  - Mitigation: use sparse `PositionType -> WorldPosition` storage so we retain only observed updates without introducing a large dedicated struct.

- Risk: `UpdateMotion` ordering could be misread if `movement_sequence` matters more than expected.
  - Mitigation: base the first implementation on ACE's `ObjectServerControl` increment rules for non-autonomous packets and keep `movement_sequence` in tests/logs for validation.

- Risk: teleport-start policy is less obvious than forced reposition policy.
  - Mitigation: make teleport handling explicit and test-backed rather than trying to reuse forced-reposition semantics implicitly.

- Risk: touching movement handlers can create duplicate authority paths.
  - Mitigation: keep all self-authoritative accept/reject logic in named `PlayerState` helpers, not scattered call-site conditionals.

## Definition of Done

- All remaining self movement apply sites are either sequence-gated or explicitly documented as bootstrap-only.
- Position-property packets no longer corrupt live movement state.
- Self non-autonomous `UpdateMotion` rejects stale packets.
- Teleport start tears down automation via an explicit path.
- Focused tests cover each changed message family.
- Targeted crates compile and tests pass.

## Dry Run Against Current Code

### Phase 1 Dry Run

- Files to touch:
  - `crates/holtburger-world/src/handlers/movement.rs`
  - `crates/holtburger-world/src/player/types.rs` and `crates/holtburger-world/src/player/mutations.rs`
  - possibly a player/world query surface if we expose the retained data upward
- Outcome:
  - Implemented as planned with no significant pivot.
  - Added a small sparse `PlayerState` map keyed by `PositionType` and named world helpers for private/public position-property application.
  - Chose not to widen generic `Entity` state for non-self public non-`Location` updates; those packets are now consumed as non-live data and intentionally dropped.

### Phase 2 Dry Run

- Files to touch:
  - `crates/holtburger-world/src/player/mutations.rs`
  - `crates/holtburger-core/src/client/messages.rs`
  - `crates/holtburger-core/src/client/movement.rs`
  - tests in `crates/holtburger-core/src/client/movement.rs` or nearby focused test modules
- Surprise already avoided:
  - ACE confirms `ObjectServerControl` is incremented for non-autonomous `UpdateMotion`, so we do have a real ordering key.
- Gap:
  - We do not currently persist any “last accepted non-autonomous server control sequence” separate from the generic player sequence fields, so the helper design needs care.

### Phase 3 Dry Run

- Files to touch:
  - `crates/holtburger-core/src/client/types.rs`
  - `crates/holtburger-core/src/client/messages.rs`
  - `apps/holtburger-cli/src/pages/game/state.rs`
  - `crates/holtburger-core/src/client/navigation.rs` if we add a dedicated teleport reset helper
- Surprise already found:
  - There is no `ClientViewEvent` for teleport start today.
- Gap:
  - Need an explicit event/hook addition, but the sticky policy decision is now resolved: teleport start should clear the sticky latch and active approach entirely.

### Phase 4 Dry Run

- Files to touch:
  - `crates/holtburger-world/src/handlers/player.rs`
  - `crates/holtburger-world/src/state/physics.rs`
  - `crates/holtburger-core/src/client/movement.rs`
  - `crates/holtburger-core/src/client/messages.rs`
- No major surprise here.
- Main caution:
  - Keep bootstrap `ObjectCreate` documented as intentionally different from live movement updates, or a future cleanup pass will "simplify" it back into the wrong path.

## Task Checklist

- [x] Phase 1: stop position-property packets from mutating live movement indiscriminately
- [x] Phase 1: add sparse player-owned `PositionType -> WorldPosition` storage for observed non-location updates
- [x] Phase 1: add tests for non-location private/public position updates
- [ ] Phase 2: add self non-autonomous `UpdateMotion` stale guard
- [ ] Phase 2: add tests for stale/current server-controlled motion
- [ ] Phase 3: surface teleport-start event or engine hook
- [ ] Phase 3: implement teleport-start automation teardown policy in CLI/core
- [ ] Phase 3: test teleport-start automation behavior
- [ ] Phase 4: add bootstrap intent regression coverage for self `ObjectCreate`
- [ ] Phase 4: expand movement diagnostics beyond force-position only

## Decisions Log

- Forced reposition should preserve sticky latch but stop active locomotion.
- Teleport start should be a stronger reset than forced reposition: clear active approach and sticky latch because target-space assumptions become invalid.
- Non-location position-property packets must not be treated as live world position.
- Non-location position-property updates should be retained in sparse authoritative player-owned storage keyed by `PositionType`, not a fat dedicated struct with one field per variant.
- These retained position properties should not live on generic `Entity`; if surfaced to clients, do it through player-scoped access/query boundaries.
- For Phase 1, self non-`Location` private/public updates are retained on `PlayerState`; non-self public non-`Location` updates are intentionally ignored until a proven player-facing need justifies a broader model.

## Open Questions

- No open questions at the moment.