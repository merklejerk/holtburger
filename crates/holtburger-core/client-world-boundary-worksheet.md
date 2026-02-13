# Client/World Boundary Hardening Worksheet

> Scope: `crates/holtburger-core`
> 
> Goal: eliminate `client`/`world` desync risk by enforcing a single state-authority boundary.
> 
> Status: Draft
> 
> Date: 2026-02-13

---

## 1) Problem Statement

Current implementation has a few high-risk boundary leaks:

- `client/movement.rs` updates `world.player.position` directly while physics tick uses player entity state.
- `client/messages.rs` also writes player position/sequence on `AutonomousPosition`, while `world/state.rs` already handles that message.
- Heading/turn math exists in both `client/movement.rs` and `world/state.rs`, which can drift.

These patterns make it possible for `WorldState.player` and `WorldState.entities[player_guid]` to diverge.

---

## 2) Target Architecture (Decision)

- `client/*` owns:
  - protocol I/O, command intent, message routing, retry/session behavior.
- `world/*` owns:
  - all authoritative world mutation (player/entity transforms, velocity, sequence tracking, scene updates, derived world events).

### Boundary rule

If logic mutates world model state, it must go through `WorldState` methods (or a dedicated world system), not direct field writes from `client`.

---

## 3) Non-Goals

- No large ECS rewrite in this pass.
- No UX/TUI behavior changes.
- No protocol behavior changes unless required to preserve existing semantics.

---

## 4) Execution Plan (Phased)

## Phase 0 — Baseline + Guardrails

- [x] Capture baseline behavior and tests:
  - [x] Run `cargo test -p holtburger-core`.
  - [x] Note existing movement-related tests and gaps.
    - *Findings:* Unit tests for heading math and spatial partitioning exist. However, there are **no** tests enforcing the invariant between `WorldState.player` and `WorldState.entities[player_guid]`. Integrated movement flow (client -> world -> scene) is not validated.
- [x] Add explicit invariants to worksheet sign-off:
  - [x] Player mirror invariant: `world.player.position == entities[player_guid].position` (when player entity exists).
  - [x] Sequence fields are updated in exactly one place per message path.

**Exit criteria**
- Baseline test status recorded.
- Invariants agreed before refactor starts.

---

## Phase 1 — Introduce World Mutation API

Add narrow `WorldState` methods that encapsulate paired updates:

- [x] `set_player_position(pos)`
  - updates `player.position`
  - updates player entity position (if present)
  - updates spatial scene index
  - returns canonical `WorldEvent::EntityMoved`
- [x] `set_player_velocity(velocity)`
  - updates player entity velocity (and any mirrored field if needed)
  - returns canonical vector/update event when appropriate
- [x] Optional helper: `apply_player_autonomous_position(...)`
  - position + sequence updates in one atomic world call

**Exit criteria**
- No external module needs to update player/entity transform fields directly.
- API is small and focused.

---

## Phase 2 — Remove Duplicate AutonomousPosition Application

- [x] Keep message decode/routing in `client/messages.rs`.
- [x] Ensure world state mutation occurs exactly once via `WorldState::handle_message` (or a single world API call from client, but not both).
- [x] Remove/replace duplicate direct writes in `client/messages.rs` for:
  - [x] position
  - [x] instance/server_control/teleport/force sequences

**Exit criteria**
- Single source of truth for `AutonomousPosition` mutation.
- Existing event emission semantics preserved (no double-emits).

---

## Phase 3 — Move Client Movement Writes Behind World API

- [x] In `client/movement.rs`, replace direct writes to:
  - [x] `world.player.position = ...`
  - [x] `world.entities.get_mut(player_guid)...`
- [x] Route all such writes through Phase 1 world methods.
- [x] Preserve behavior for:
  - [x] approach abort/stuck handling
  - [x] velocity stop/reset
  - [x] server-controlled movement arrival updates

**Exit criteria**
- `client/movement.rs` has zero direct writes to player/entity transform internals.

---

## Phase 4 — Deduplicate Heading/Turn Math

- [ ] Extract heading calculation into one shared helper location (`world` utility or shared module).
- [ ] Make both:
  - `client/movement.rs` turn handling
  - `world/state.rs` `UpdateMotion::TurnToObject`
  use the same helper.

**Exit criteria**
- One canonical heading implementation.
- No duplicated angle conversion logic.

---

## Phase 5 — Tests for Invariants + Regressions

Add/expand tests nearest source modules (`#[cfg(test)]` colocated):

- [ ] World API tests:
  - [ ] `set_player_position` updates player + entity + scene consistently.
  - [ ] `set_player_velocity` updates expected fields/events.
- [ ] Message flow tests:
  - [ ] `AutonomousPosition` does not double-apply/double-emit.
- [ ] Movement tests:
  - [ ] approach path keeps mirror invariant across ticks.
  - [ ] forced reposition path preserves invariant.

If ACE synthetic fixture support is needed for protocol truth:

- [ ] Add synthetic protocol test in `ACE.Server.Tests/SyntheticProtocolTests.cs`.
- [ ] Generate fixture binary under `crates/holtburger-core/tests/fixtures/`.
- [ ] Use fixture-driven unpack/update test in Rust.

**Exit criteria**
- New tests fail before fix, pass after fix (where practical).
- Invariants enforced in tests.

---

## Phase 6 — Cleanup + Documentation

- [ ] Remove stale comments implying client-side authority for world mutation.
- [ ] Update `crates/holtburger-core/ARCHITECTURE.md` with boundary contract:
  - client routes intents/messages
  - world mutates authoritative state
- [ ] Add short “do/don’t” section for future contributors.

**Exit criteria**
- Docs match implemented architecture.

---

## 5) Work Log Template

### Phase 3 update (2026-02-13)
- Changed: Replaced all direct field writes to `world.player.position` and `world.entities` (for the player) with calls to `set_player_position` and `set_player_velocity`. Touched `client/movement.rs`, `client/commands.rs`, `client/mod.rs`, and `world/state.rs`.
- Files touched: `src/client/movement.rs`, `src/client/commands.rs`, `src/client/mod.rs`, `src/world/state.rs`
- Behavior impact: Centralized all player transform logic. Prediction and server-controlled movement now stay in sync with the entity map and spatial scene.
- Tests run: `cargo test -p holtburger-core` (Passed).
- Follow-ups: Phase 4 (Deduplicate Heading/Turn Math).

---

## 6) Risk Register

- **Risk:** Event ordering regressions when removing duplicate writes.
  - **Mitigation:** Keep old/new path diff notes; add event-count assertions.
- **Risk:** Scene index not updated in one mutation path.
  - **Mitigation:** centralize in one world API and test scene consistency.
- **Risk:** Hidden callers still mutate world internals directly.
  - **Mitigation:** grep checks during review (`world.player.` / `entities.get_mut(player_guid)`).

---

## 7) Final Sign-off Checklist

- [ ] No direct player/entity transform mutation from `client/*`.
- [ ] No duplicate `AutonomousPosition` mutation path.
- [ ] Shared heading logic is single-source.
- [ ] Invariant tests added and passing.
- [ ] `cargo test -p holtburger-core` passing.
- [ ] Architecture doc updated.
