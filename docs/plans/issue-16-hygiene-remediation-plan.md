# Issue #16 Hygiene Remediation Plan

## 1) Context & Boundaries

### Goal
Resolve the six hygiene findings from issue #16 while preserving protocol correctness and improving long-term maintainability.

### In Scope
- Remove duplicated optional-header parsing in session transport logic.
- Refactor command handling to reduce `handle_command` complexity and repeated action-send boilerplate.
- Eliminate action sequence TODO placeholders by routing sequencing through a single source of truth.
- Close protocol parity-test gaps called out in the issue.
- Resolve/document the current no-parity fixture exception.
- Define and document a canonical fixture policy.

### Out of Scope
- New gameplay features or command semantics changes unrelated to hygiene findings.
- TUI behavior redesign.
- Broad protocol rewrites outside the touched message/session surfaces.

---

## 2) Ground Truth & Existing Patterns

### Reference Sources
- `crates/holtburger-core/src/session/mod.rs`
  - Existing optional-header parsing paths and packet hashing/event extraction.
- `crates/holtburger-core/src/client/commands.rs`
  - Current command routing and game-action send patterns.
- `crates/holtburger-core/src/client/mod.rs`
  - Session/client coordination and action-send integration points.
- `crates/holtburger-protocol/src/messages/game_action.rs`
- `crates/holtburger-protocol/src/messages/network/events.rs`
- `crates/holtburger-protocol/src/messages/inventory/types.rs`
- `crates/holtburger-protocol/src/messages/game_message.rs`
  - Current dispatch/parity assertions and fixture coverage behavior.
- `ACE/Source/ACE.Server/` and `ACE/Source/ACE.Server.Tests/`
  - Authoritative behavior for packet sequencing/packing and fixture generation.

### Existing Patterns to Reuse
- Gold Standard parity loop: generate with ACE tests -> create binary fixture -> assert Rust pack/unpack parity.
- Keep tests colocated with source modules (`#[cfg(test)]`) unless cross-crate integration requires otherwise.
- Keep command API surface stable while reducing internal branching complexity.

---

## 3) Phased Implementation

### Phase 1: De-duplicate transport optional-header parsing

#### Deliverables
- Introduce a shared optional-header cursor/helper in session transport code.
- Replace duplicated offset calculations used by hash/payload/time-sync parsing paths.
- Add focused tests for mixed optional-flag combinations.

#### Files
- `crates/holtburger-core/src/session/mod.rs`

#### Acceptance Criteria
- One canonical parsing path computes optional-header offsets.
- Existing packet decode behavior is unchanged for current fixtures/tests.
- Targeted transport parsing tests pass.

---

### Phase 2: Decompose command handling and centralize action send flow

#### Deliverables
- Introduce focused command handlers in `commands.rs` with explicit routing boundaries:
  - `handle_auth_command(...)` for login/character selection/enter world.
  - `handle_chat_command(...)` for talk/tell.
  - `handle_interaction_command(...)` for use/identify/spell casting.
  - `handle_inventory_command(...)` for drop/get/move/get-and-wield/split-to-wield.
  - `handle_movement_command(...)` for jump/turn/setstate/moveto/syncposition.
  - `handle_progression_command(...)` for raise/train skill/vital/attribute.
  - `handle_system_command(...)` for ping/quit/noclip/resource resolution/combat cancel/mode.
- Add a single `send_game_action(...)` helper (and optional `send_game_action_if_in_world(...)`) so command branches stop constructing `GameMessage::GameAction(Box::new(GameActionMessage { ... }))` inline.
- Preserve command API/behavior exactly (same command variants, same logs at the same semantic points, same world-side prediction updates).
- Keep sequencing policy explicit:
  - Phase 2 introduces the helper abstraction only.
  - Phase 3 owns the switch from placeholder sequence values to centralized session sequencing.

#### Refactor Strategy (Phase 2A/2B/2C)
- **Phase 2A (Mechanical extraction):** Move match-arm bodies into private helper methods without behavior changes.
- **Phase 2B (Boilerplate collapse):** Route repeated GameAction message construction through the helper.
- **Phase 2C (Safety pass):** Verify command side effects (event emission, movement prediction, disconnect flow) are unchanged.

#### Verification Matrix (Must stay equivalent)
- **Auth path:** `Login`, `SelectCharacter`, `SelectCharacterByIndex`, `EnterWorld`.
- **World-gated actions:** `Talk`, `Tell`, interaction, inventory, movement/combat commands.
- **Client-local side effects:** `SetNoClip`, `MoveTo` target tracking, event channel sends.
- **Disconnect semantics:** `Quit` still performs graceful logoff attempt before transport disconnect.

#### Files
- `crates/holtburger-core/src/client/commands.rs`
- (if needed) `crates/holtburger-core/src/client/mod.rs`

#### Acceptance Criteria
- `handle_command` is primarily a thin router; most branch logic lives in focused private helpers.
- Repeated GameAction envelope construction is centralized in one helper.
- Behavior parity is maintained for command side effects and message payloads.
- `cargo check -p holtburger-core` and targeted command-related tests pass.

---

### Phase 3: Fix action sequencing correctness path

#### Deliverables
- Remove `sequence = 0 // TODO` call sites for `GetAndWield` and `SplitToWield`.
- Route sequence assignment through centralized session/client action sequencing.
- Add or extend tests for affected action opcodes.

#### Files
- `crates/holtburger-core/src/client/commands.rs`
- `crates/holtburger-core/src/session/mod.rs` (or existing sequencing owner)

#### Acceptance Criteria
- No action command path assigns placeholder sequence values.
- Sequencing behavior matches existing authoritative expectations from ACE references.
- Tests cover touched action paths.

---

### Phase 4: Close parity-test gaps on protocol surfaces

#### Deliverables
- Add `assert_pack_unpack_parity` coverage for representative `game_action` fixtures.
- Add parity coverage for `network/events` (`PingResponseData` and related event types).
- Re-enable/modernize parity tests in `inventory/types`.
- Use ACE synthetic tests to generate missing fixture data where needed.

#### Files
- `crates/holtburger-protocol/src/messages/game_action.rs`
- `crates/holtburger-protocol/src/messages/network/events.rs`
- `crates/holtburger-protocol/src/messages/inventory/types.rs`
- `ACE/Source/ACE.Server.Tests/SyntheticProtocolTests.cs` (as needed for fixture generation)
- `crates/holtburger-protocol/tests/fixtures/` (or canonical destination decided in Phase 5)

#### Acceptance Criteria
- Gaps called out in issue #16 have concrete parity tests.
- New fixtures are derived from ACE output, not hand-invented bytes.
- Updated protocol module tests pass.

---

### Phase 5: Resolve no-parity exception and fixture policy drift

#### Deliverables
- Investigate why `PLAYER_DESCRIPTION_TUI_2026_02_07` currently uses dispatch-only assertion.
- Either:
  - restore full pack parity for that fixture path, or
  - document a bounded, explicit exception with rationale and tracking.
- Define canonical fixture policy and document it in one source of truth.

#### Files
- `crates/holtburger-protocol/src/messages/game_message.rs`
- `docs/` testing/protocol docs (exact target doc chosen during execution)

#### Acceptance Criteria
- Exception status is explicit (closed or documented with reason/owner/follow-up).
- Fixture location policy is written once and referenced consistently.

---

## 4) Risks & Mitigations

- **Risk:** Optional-header refactor changes packet interpretation subtly.
  - **Mitigation:** Add flag-matrix tests and compare before/after behavior on known fixtures.
- **Risk:** Command decomposition introduces behavior drift.
  - **Mitigation:** Keep public command entrypoint stable; refactor in small commits with targeted tests.
- **Risk:** Sequencing changes break protocol parity under load.
  - **Mitigation:** Use one sequencing source of truth and add regression tests for the touched opcodes.
- **Risk:** Parity gap closure blocked by missing deterministic fixture inputs.
  - **Mitigation:** Generate fixtures via ACE synthetic tests; avoid speculative bytes.
- **Risk:** Fixture policy decision causes churn.
  - **Mitigation:** Decide once, document once, then migrate only touched/necessary fixtures.

---

## 5) Definition of Done

- All six issue #16 findings are either resolved in code/tests or documented as explicit tracked exceptions.
- `cargo check` passes for touched crates.
- Relevant test suites pass for touched modules/crates.
- Added/updated fixtures are traceable to ACE-based generation steps.
- Fixture policy is documented in a single canonical location.

---

## 6) Execution Worksheet

### A) Task Checklist

#### Phase 1
- [x] Add optional-header cursor/helper in session transport.
- [x] Replace duplicate optional-header offset logic.
- [x] Add/update transport parsing tests.

#### Phase 2
- [ ] Add Phase 2 helper method skeletons and route command groups to them.
- [ ] Move auth/chat/system command logic into dedicated helpers (no behavior changes).
- [ ] Move interaction/inventory/progression command logic into dedicated helpers.
- [ ] Move movement/combat command logic into dedicated helpers, preserving prediction updates.
- [ ] Add `send_game_action(...)` helper and replace inline GameAction envelope boilerplate.
- [ ] Run `cargo check -p holtburger-core` and targeted tests for command paths.
- [ ] Do a manual diff review of `Quit`, `SetNoClip`, and `MoveTo` side effects.

#### Phase 3
- [ ] Remove placeholder sequence assignments.
- [ ] Route all affected action sequencing through central path.
- [ ] Add/adjust tests for `GetAndWield` and `SplitToWield` sequencing.

#### Phase 4
- [ ] Add/expand parity tests in `game_action.rs`.
- [ ] Add/expand parity tests in `network/events.rs`.
- [ ] Re-enable/modernize parity tests in `inventory/types.rs`.
- [ ] Generate any new fixture bytes via ACE synthetic tests.

#### Phase 5
- [ ] Investigate `PLAYER_DESCRIPTION_TUI_2026_02_07` no-parity path.
- [ ] Resolve parity or document explicit bounded exception.
- [ ] Publish canonical fixture policy in docs.

---

### B) Decisions Log

| Date | Decision | Why | Impact |
|---|---|---|---|
| 2026-02-14 | Plan organized into 5 phases mapped 1:1 to issue findings | Keeps execution traceable to issue #16 | Easier progress/risk tracking |
| 2026-02-14 | Extracted `OptionalHeaderCursor` to its own module | Keep `session/mod.rs` from bloating and improve testability of parsing logic | High reuse for hash/offset/extraction |
| 2026-02-14 | Keep sequencing semantics split across phases (abstraction in Phase 2, correctness switch in Phase 3) | Avoid mixing large refactor with protocol-sensitive sequence behavior changes | Smaller blast radius and cleaner validation |
| TBD | Canonical fixture directory policy | Remove contributor confusion and drift | Affects fixture placement + docs |
| TBD | `PLAYER_DESCRIPTION_TUI_2026_02_07` parity disposition | Clarify whether this is fixable or intentional | Affects test guarantees |

---

### C) Verification Log

| Date | Command / Check | Result | Notes |
|---|---|---|---|
| 2026-02-14 | Planning-only: no code changes executed yet | ✅ | Next step is implementation phase-by-phase |
| 2026-02-14 | `cargo test -p holtburger-core session` | ✅ | Phase 1 refactoring verified with existing and new tests |
| 2026-02-14 | Phase 2 planning deep-dive against current `client/commands.rs` | ✅ | Helper boundaries and verification matrix added before implementation |

---

### D) Open Questions

1. Should fixture policy be split by ownership (`holtburger-protocol` fixtures for message codec tests, `holtburger-core` fixtures for core integration), or fully consolidated into one location?
2. Is there known non-determinism behind `PLAYER_DESCRIPTION_TUI_2026_02_07`, or is this purely an implementation gap?
3. Preferred implementation order after Phase 1: command decomposition first or parity gap closure first?
