# Movement Contact Metadata Plan

## Context And Boundaries

### Goal
Replace hardcoded outbound movement contact bits with explicit per-call metadata while preserving the current TUI behavior and leaving room for future 3D clients to supply predicted physics state.

### In Scope
- Identify every outbound path that currently hardcodes `contact_long_jump` or `last_contact`.
- Define a per-call metadata shape for outbound movement/contact state that does not bake frontend-specific policy into `holtburger-core`.
- Preserve authoritative server-grounded state in `holtburger-world` so simple clients can use it if they choose.
- Refactor movement packet construction in `holtburger-core` to consume explicit contact metadata instead of hardcoded `1` values.
- Add focused tests for metadata propagation, server-grounded capture, and current default-policy preservation.

### Out Of Scope
- Implementing full client-side collision or prediction.
- Loading DAT collision data solely to answer grounded/contact state.
- Reworking the entire message bus or command architecture.
- Finalizing the 3D client's predicted-physics policy.
- Changing ACE protocol layouts.

## Ground Truth And Existing Patterns

### Reference Sources
- Current movement command handling in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- Current movement executor in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- Current command surface in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs)
- Current locomotion primitive model in [crates/holtburger-core/src/client/locomotion.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/locomotion.rs)
- Client construction seam in [crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs)
- Player/world movement sync handling in [crates/holtburger-world/src/handlers/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/movement.rs), [crates/holtburger-world/src/handlers/player.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/player.rs), [crates/holtburger-world/src/state/physics.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/physics.rs), and [crates/holtburger-world/src/player/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/player/mutations.rs)
- Protocol structures for movement packets in [crates/holtburger-protocol/src/messages/movement/actions.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/movement/actions.rs) and [crates/holtburger-protocol/src/messages/movement/messages/position.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/movement/messages/position.rs)
- ACE authoritative movement handling in [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs), [ACE/Source/ACE.Server/Network/Structure/PositionPack.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Structure/PositionPack.cs), and [ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs)
- Existing plan format precedent in [docs/plans/movement-controller-architecture-plan.md](/home/cluracan/code/holtburger/docs/plans/movement-controller-architecture-plan.md)

### Existing Patterns To Follow
- Keep protocol crates policy-free and focused on wire layout.
- Keep `holtburger-world` as the place that stores authoritative server facts.
- Keep `holtburger-core` as the bridge from world snapshot plus client intent to outbound protocol traffic.
- Prefer explicit per-call data over hidden subsystem state when threading frontend-specific policy through the core client.

## Dry-Run Findings Against The Current Codebase

### Current Hardcoded Contact Bits
These outbound paths currently hardcode contact-related fields:

- `ClientCommand::TurnTo` sends `MoveToStateActionData { contact_long_jump: 1 }` in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs#L552)
- `ClientCommand::SyncPosition` sends `AutonomousPositionActionData { last_contact: 1 }` in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs#L607)
- `MovementSystem::send_drive_pulse` sends `MoveToStateActionData { contact_long_jump: 1 }` in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs#L121)
- `MovementSystem::send_stop_pulse` sends `MoveToStateActionData { contact_long_jump: 1 }` in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs#L143)
- `MovementSystem::handle_server_controlled_movement` sends `AutonomousPositionActionData { last_contact: 1 }` in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs#L258)

`ClientCommand::SetState` already uses `contact_long_jump: 0` in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs#L530), so the migration must preserve that special case rather than globally forcing all movement messages through one default value.

### The Server Already Exposes An Authoritative Grounded Bit
ACE sets the `PositionFlags.IsGrounded` bit from server physics `OnWalkable` in [ACE/Source/ACE.Server/Network/Structure/PositionPack.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Structure/PositionPack.cs#L72), and our protocol crate already parses that as `UpdatePositionFlag::IS_GROUNDED` in [crates/holtburger-protocol/src/messages/movement/messages/position.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/movement/messages/position.rs#L110).

However, the world layer currently discards that flag:

- [crates/holtburger-world/src/handlers/player.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/player.rs#L18) forwards only `data.pos.pos` and sequences
- [crates/holtburger-world/src/player/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/player/mutations.rs#L164) stores only position and sequence values
- [crates/holtburger-world/src/player/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/player/types.rs) has no field for server-grounded state

So the architecture already has the raw protocol data needed for a simple client, but not the storage seam.

### Per-Call Metadata Must Cover More Than `ExecuteLocomotion`
The original idea of "attach metadata to locomotion execution" is directionally correct but incomplete.

Today, outbound movement-like packets are emitted from at least three distinct surfaces:

- `ClientCommand::ExecuteLocomotion` and `StopMoving` through `MovementSystem`
- `ClientCommand::TurnTo` and `ClientCommand::SyncPosition` directly in command handling
- server-controlled movement acknowledgements in `MovementSystem::handle_server_controlled_movement`

That means a locomotion-only seam is too narrow. The plan must introduce a shared contact metadata type usable by both:

- locomotion primitives
- direct one-off movement packet sends

### `LocomotionPrimitive` Is Intentionally Narrow
[crates/holtburger-core/src/client/locomotion.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/locomotion.rs) models only heading, speed, and whether the server should be refreshed.

That is a good sign. It means contact state should probably travel alongside the primitive rather than being embedded into the enum itself. Embedding contact into `LocomotionPrimitive` would mix low-level motion intent with frontend policy about predicted grounded state.

### `ClientCommand::ExecuteLocomotion` Currently Has No Room For Metadata
[crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs#L309) currently carries `ExecuteLocomotion(LocomotionPrimitive)`.

If the metadata is truly per call, we need one of these seams:

- replace the payload with a wrapper struct such as `LocomotionRequest { primitive, contact }`
- add a new movement-command wrapper type shared by `ExecuteLocomotion`, `SyncPosition`, and maybe `TurnTo`
- bypass command payload changes and compute contact inside `Client` before dispatching into `MovementSystem`

Of these, the wrapper approach is the cleanest if we want future clients to provide policy explicitly.

### The Builder Does Not Yet Need To Change If We Choose Per-Call Metadata
[crates/holtburger-core/src/client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs#L137) constructs `MovementSystem::new()` without any injected dependencies.

That is useful: if we choose explicit per-call metadata instead of a long-lived provider object, we avoid widening `Client::new` and the builder surface for now.

### Server `AutonomousPosition` Contact Flags Are Not A Reliable Replacement
The top-level server `AutonomousPosition` packet includes `contact_flags`, but ACE currently sends `1u` unconditionally in [ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageAutonomousPosition.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageAutonomousPosition.cs#L20).

So the only useful server-side grounded signal for this migration is `UpdatePositionFlag::IS_GROUNDED`, not `ServerAutonomousPositionData.contact_flags`.

## Recommended Architecture

### Core Principle
`holtburger-core` should consume explicit outbound contact metadata per call, not own the policy that computes it.

### Proposed Data Split

#### 1. Raw Authoritative State In `holtburger-world`
Add server-observed grounded state to `PlayerState`, updated from `UpdatePosition` handling.

Candidate fields:

- `server_grounded: Option<bool>`
- `server_grounded_position_sequence: u16` or equivalent freshness marker if needed

This keeps world state authoritative and avoids teaching `holtburger-core` to reinterpret protocol flags.

#### 2. Per-Call Metadata Type In `holtburger-core`
Introduce an explicit per-call metadata type for outbound movement packet construction.

Candidate shape:

```rust
pub struct MovementContactMetadata {
    pub has_contact: bool,
}
```

or, if we want to leave future room without committing to physics abstractions:

```rust
pub struct MovementPacketMetadata {
    pub contact: bool,
}
```

Keep it minimal. Do not add prediction confidence or reconciliation concepts until an actual client needs them.

#### 2a. Core Compatibility Default
When explicit movement contact metadata is not supplied, `holtburger-core` should use a narrow compatibility fallback:

1. explicit per-call metadata, if present
2. last server-grounded state from `holtburger-world`, if present
3. documented bootstrap fallback of `true` until server-grounded state has been observed

This preserves current behavior during login/bootstrap while making the fallback explicit and localized instead of scattered hardcoded `1` values.

#### 3. Wrapper Request For Primitive Execution
Replace `ExecuteLocomotion(LocomotionPrimitive)` with a wrapper payload, for example:

```rust
pub struct LocomotionRequest {
    pub primitive: LocomotionPrimitive,
    pub metadata: MovementPacketMetadata,
}
```

This preserves the narrow meaning of `LocomotionPrimitive` while making policy explicit at the command boundary.

#### 4. Shared Helper For Packet Serialization
Add small helper functions inside `MovementSystem` or a nearby movement utility module to map metadata into protocol fields:

- `contact_long_jump` for `MoveToStateActionData`
- `last_contact` for `AutonomousPositionActionData`

That keeps packet packing consistent without forcing every caller to remember how the AC wire format encodes contact.

### Why This Fits The Current Architecture
- Message flow remains unchanged: server messages update world state, frontends emit commands, core serializes protocol.
- No hidden provider/service object is introduced.
- The TUI can continue computing contact from whatever simple heuristic it wants.
- A future 3D client can supply predicted contact on each call without changing protocol or world crates again.

## Phased Implementation

### Phase 1: Capture Server Grounded State

#### Deliverables
- Update [crates/holtburger-world/src/player/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/player/types.rs) to store server-grounded state.
- Update [crates/holtburger-world/src/player/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/player/mutations.rs) so `update_position_from_server` accepts grounded state.
- Update [crates/holtburger-world/src/handlers/player.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/player.rs) to pass `data.pos.flags.contains(UpdatePositionFlag::IS_GROUNDED)`.
- Add or update tests in `holtburger-world` proving the grounded bit is preserved.

#### Acceptance Criteria
- A player `UpdatePosition` packet with `IS_GROUNDED` updates player state accordingly.
- Existing sequence-tracking behavior remains unchanged.
- `holtburger-world` tests pass.

### Phase 2: Introduce Explicit Per-Call Movement Metadata

#### Deliverables
- Add a small metadata type in `holtburger-core`, likely near [crates/holtburger-core/src/client/locomotion.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/locomotion.rs) or [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs).
- Add a wrapper request type for `ExecuteLocomotion` instead of mutating `LocomotionPrimitive` itself.
- Update command handling and any frontend call sites that build `ExecuteLocomotion`.
- Add a single helper that resolves outbound contact using the agreed precedence: explicit metadata, then server-grounded, then bootstrap `true`.

#### Acceptance Criteria
- `LocomotionPrimitive` remains pure motion intent.
- Command payloads can carry contact metadata explicitly.
- The fallback path is centralized and documented.
- Compilation succeeds without changing runtime behavior yet.

### Phase 3: Refactor Outbound Movement Packet Construction

#### Deliverables
- Update [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) so `execute_locomotion_primitive`, `send_drive_pulse`, and `send_stop_pulse` consume metadata.
- Update [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs) so `TurnTo` and `SyncPosition` also consume explicit metadata instead of hardcoded values.
- Decide whether `handle_server_controlled_movement` should accept metadata from the caller or preserve a narrower internal rule for now.

#### Acceptance Criteria
- No hardcoded `1` remains in outbound movement contact fields except where explicitly intentional and documented.
- `SetState(contact_long_jump: 0)` remains preserved.
- `holtburger-core` tests pass.

### Phase 4: Add A Simple Default Policy At The App Boundary

#### Deliverables
- Update the current app/frontend call sites to supply metadata explicitly.
- For the present TUI path, use a minimal default based on server-grounded state when available, with a documented fallback where it is unavailable.
- Add regression tests covering the current TUI behavior.

#### Acceptance Criteria
- Existing CLI/TUI behavior is preserved.
- The default path does not force future clients to reuse the same policy.
- There is a clear, documented seam where a future 3D client can provide predicted contact.
- If a caller omits metadata entirely, core still behaves compatibly by falling back to server-grounded and then bootstrap `true`.

## Key Design Decision To Resolve Before Coding

### Decision: Where Should Non-Locomotion Contact Metadata Live?
`ExecuteLocomotion` can carry a wrapper payload cleanly, but `TurnTo` and `SyncPosition` are separate commands today.

Recommended direction:

- keep `LocomotionRequest` for `ExecuteLocomotion`
- add the same `MovementPacketMetadata` to the small number of direct movement commands that need it, or refactor those commands through a shared movement request helper inside `Client`

Avoid a giant "everything movement-ish is now one command enum" rewrite in this task.

## Risks And Mitigations

### Risk 1: Overfitting The Seam To The Current TUI
If the metadata type mentions server-grounded semantics directly, we will leak one client's policy into core.

Mitigation:
- keep the type generic and packet-focused, for example `contact: bool`
- store server-grounded separately in `holtburger-world`

### Risk 2: Only Refactoring `ExecuteLocomotion`
That would leave `TurnTo`, `SyncPosition`, and server-controlled acknowledgements on the old path.

Mitigation:
- treat every current hardcoded contact site as in-scope for the migration

### Risk 3: Inflating `LocomotionPrimitive`
Stuffing contact metadata into the primitive itself would mix motion intent with frontend policy.

Mitigation:
- use a wrapper request or a parallel metadata parameter

### Risk 4: Breaking Current Command Producers
Changing `ClientCommand::ExecuteLocomotion` will affect app-level call sites.

Mitigation:
- dry-run and update all producers in the same phase
- keep the metadata struct small so call-site churn stays minimal

### Risk 5: Assuming Server Grounded Is Perfectly Fresh
ACE can briefly lose `OnWalkable` around jump edge cases.

Mitigation:
- treat `server_grounded` as a raw observed fact, not a universal truth
- keep smoothing or prediction policy out of this refactor

## Definition Of Done

- `holtburger-world` preserves authoritative server-grounded state from `UpdatePosition`.
- `holtburger-core` no longer hardcodes outbound movement contact bits except where explicitly documented.
- `LocomotionPrimitive` remains free of frontend policy fields.
- Movement/contact policy is supplied per call by the caller, not hidden inside `MovementSystem` construction.
- Current CLI/TUI behavior still works.
- Relevant tests pass in `holtburger-world`, `holtburger-core`, and affected app crates.

## Living Worksheet

### Task Checklist
- [ ] Add `server_grounded` storage to `PlayerState`
- [ ] Thread `IS_GROUNDED` from protocol handling into player state
- [ ] Introduce a packet-focused movement metadata type in core
- [ ] Replace `ExecuteLocomotion(LocomotionPrimitive)` with an explicit wrapper payload
- [ ] Refactor `MovementSystem` send helpers to consume metadata
- [ ] Refactor `TurnTo` and `SyncPosition` to consume metadata
- [ ] Decide how server-controlled movement acknowledgements obtain contact metadata
- [ ] Update app/frontend call sites
- [ ] Add or update tests for world grounded capture and outbound metadata propagation

### Decisions Log
- Prefer explicit per-call metadata over a long-lived provider object.
- Keep `LocomotionPrimitive` narrow and policy-free.
- Use server `UpdatePositionFlag::IS_GROUNDED` as an optional raw input for simple clients, not as a core-owned universal policy.
- Core compatibility default: explicit metadata first, else last server-grounded, else bootstrap `true`.

### Verification Log
- Dry-run verified current hardcoded contact send sites in core movement and command handling.
- Dry-run verified that `holtburger-world` currently drops `IS_GROUNDED` on the floor.
- Dry-run verified that builder construction does not need dependency-injection changes if the design stays per-call.

### Open Questions
- Should server-controlled movement acknowledgements continue using an internal default contact rule for now, or should the caller supply metadata there too?
- Do we want a single shared `MovementPacketMetadata` type for both locomotion and direct movement commands, or a slightly more specific wrapper per command family?