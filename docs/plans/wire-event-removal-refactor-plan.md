# WireEvent Removal Refactor Plan

## Context And Boundaries

### Goal
Remove `WireEvent` as `holtburger-core`'s mixed-responsibility event bus, preserve the current `session -> core -> world -> core -> tui` authority split, and fold replay removal into the same refactor so the remaining event surfaces are honest and minimal.

### In Scope
- Remove `WireEvent` from the normal core-to-frontend/runtime flow.
- Remove replay-era public runtime/event plumbing that no longer earns its keep.
- Keep `holtburger-world` consuming decoded protocol messages directly; do not introduce a new DTO layer between core and world.
- Preserve current observable client behavior for the TUI and scripts via `ClientViewEvent`.
- Preserve a deliberate low-level message dump/debug path if we still need raw bytes for diagnostics.
- Update the debug harness so it no longer depends on `WireEvent`.
- Update architecture docs and any stale references that claim `WireEvent` is the main session->core protocol surface.

### Out Of Scope
- Re-architecting `holtburger-world` to stop consuming `GameMessage`.
- Rewriting session reliability/retransmit internals.
- Designing a brand new generic observability framework for every crate.
- Changing protocol layouts in `holtburger-protocol`.
- Refactoring unrelated `ClientViewEvent` shape issues unless they block `WireEvent` removal.
- Preserving full debug-harness behavior during the refactor. Harness fallout is acceptable if it simplifies the main runtime cleanup.

## Ground Truth And Existing Patterns

### Reference Sources
- Current `WireEvent` and `ClientViewEvent` definitions in [crates/holtburger-core/src/client/types.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/types.rs)
- Current `WireEvent` projection bridge in [crates/holtburger-core/src/client/mod.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- Current message decode and `WireEvent` emission flow in [crates/holtburger-core/src/client/messages.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/messages.rs)
- Current command-side synthetic `WireEvent` usage in [crates/holtburger-core/src/client/commands.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- Current session surface in [crates/holtburger-session/src/session/types.rs](/home/me/code/holtburger/crates/holtburger-session/src/session/types.rs) and [crates/holtburger-session/src/session/receive.rs](/home/me/code/holtburger/crates/holtburger-session/src/session/receive.rs)
- Current world boundary in [crates/holtburger-world/ARCHITECTURE.md](/home/me/code/holtburger/crates/holtburger-world/ARCHITECTURE.md)
- Current debug harness dependency on `WireEvent` and `message_dump_dir` in [crates/holtburger-debug-harness/src/bin/extractor.rs](/home/me/code/holtburger/crates/holtburger-debug-harness/src/bin/extractor.rs)
- Current core architecture claims in [crates/holtburger-core/ARCHITECTURE.md](/home/me/code/holtburger/crates/holtburger-core/ARCHITECTURE.md)

### Existing Patterns To Follow
- Keep `holtburger-session` responsible for transport, ordering, fragmentation, retransmit, and time-sync only.
- Keep `holtburger-world` authoritative for decoded gameplay/state mutations, not transport concerns.
- Keep `holtburger-core` as the orchestrator that decodes session payloads, routes to world, and projects frontend-facing deltas.
- Prefer one honest event surface per audience over one overloaded bus with misleading names.
- If a low-level debugging surface remains, keep it explicitly diagnostic rather than quietly reusing the main app event channel.

## Dry-Run Findings Against The Current Codebase

### `WireEvent` Is Not Actually A Wire-Only Surface
The enum in [crates/holtburger-core/src/client/types.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/types.rs) mixes:

- protocol-derived messages such as `GameMessage`, `RawMessage`, and `ViewContents`
- normalized semantic outcomes such as `CombatFeedback`, `Chat`, and `CharacterList`
- purely client-synthesized events such as `ClientError` and `LogMessage`

That makes the type name misleading and invites misuse.

### Core Currently Uses `WireEvent` As A Normalization Bridge
`ClientRuntime::emit_wire_event()` in [crates/holtburger-core/src/client/mod.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/mod.rs) immediately projects many `WireEvent` variants into `ClientViewEvent` and then rebroadcasts the original `WireEvent`. This means `WireEvent` is currently serving as an internal staging bus rather than a true externally meaningful abstraction.

### Commands Emit Fake "Wire" Events
`commands.rs` emits `WireEvent::ClientError` and `WireEvent::LogMessage` in [crates/holtburger-core/src/client/commands.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/commands.rs). These are not packet-derived and are the clearest proof that `WireEvent` has drifted into a generic misc-event bus.

### Session Does Not Currently Expose Decoded Protocol Messages
`holtburger-session` currently yields `SessionEvent::Message(Vec<u8>)` and `SessionEvent::TimeSync(f64)` in [crates/holtburger-session/src/session/types.rs](/home/me/code/holtburger/crates/holtburger-session/src/session/types.rs). Core performs `GameMessage` unpacking itself in [crates/holtburger-core/src/client/messages.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/messages.rs). So removing `WireEvent` does not require changing the world boundary first.

### World Already Has The Right Upstream Boundary
`holtburger-world` consumes decoded `GameMessage` values and emits `WorldEvent` as documented in [crates/holtburger-world/ARCHITECTURE.md](/home/me/code/holtburger/crates/holtburger-world/ARCHITECTURE.md). That means we do not gain much by inventing a new DTO between core and world just to make the dependency graph look cleaner.

### Replay Removal Lowers The Value Of A Raw Broadcast Bus
Replay-oriented construction is already considered dead in earlier planning, and the main remaining low-level seam is the packet/message extractor path via [crates/holtburger-debug-harness/src/bin/extractor.rs](/home/me/code/holtburger/crates/holtburger-debug-harness/src/bin/extractor.rs) plus `message_dump_dir`. Once replay is intentionally removed, `WireEvent` loses one of its last semi-legitimate reasons to exist as a public surface.

### The Debug Harness Still Needs A Replacement Story
The extractor currently uses two different seams:

- `message_dump_dir` for raw message bytes
- `subscribe_wire_events()` for character-list detection and control flow

That means `WireEvent` cannot simply be deleted in one diff without replacing at least the control-flow portion if we want to preserve extractor behavior. That preservation is now explicitly low priority, so extractor breakage is acceptable during the main cleanup as long as the runtime/event architecture lands cleanly.

### `subscribe_wire_events()` Has Very Few Real Consumers
The current `subscribe_wire_events()` call sites are limited to:

- core tests in [crates/holtburger-core/src/client/messages.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/messages.rs)
- core tests in [crates/holtburger-core/src/client/commands.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- the extractor harness in [crates/holtburger-debug-harness/src/bin/extractor.rs](/home/me/code/holtburger/crates/holtburger-debug-harness/src/bin/extractor.rs)

There do not appear to be ordinary runtime/front-end consumers of `WireEvent`. That materially improves the task ordering: we can refactor the core runtime toward direct `ClientViewEvent` emission first, then migrate tests and the extractor, and only then remove the public `WireEvent` surface.

### Architecture Docs Have Drifted From The Code
The core and session architecture docs still talk as if `WireEvent` is the main protocol event surface from session into core. The current code does not match that description. The refactor should use the code as ground truth and then update the docs to match the new shape.

## Variant Migration Matrix

This matrix is the concrete dry-run output for Phase 1. It exists to keep the refactor honest and to prevent us from deleting `WireEvent` only to recreate it under a different name.

| `WireEvent` variant | Current producer(s) | Current consumer(s) | Recommended destination |
| --- | --- | --- | --- |
| `RawMessage(Vec<u8>)` | `client/messages.rs` on every inbound payload | core message tests | remove from runtime bus; preserve only through explicit raw dump/diagnostic sink if still needed |
| `GameMessage(Box<GameMessage>)` | `client/messages.rs` after decode | `emit_wire_event()` projects `ServerName`; otherwise no meaningful runtime consumer | delete from runtime bus; handle special cases directly during decode |
| `CharacterList` | `client/messages.rs` | `emit_wire_event()`, extractor, tests | emit `ClientViewEvent::CharacterList` directly |
| `CharacterManagementResponse` | `client/messages.rs` | `emit_wire_event()`, tests | emit `ClientViewEvent::CharacterManagementResponse` directly |
| `CharacterDeleteResponse` | `client/messages.rs` | `emit_wire_event()`, tests | emit `ClientViewEvent::CharacterDeleteResponse` directly |
| `PlayerEntered` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::PlayerEntered` directly |
| `StatusUpdate` | `client/mod.rs` | `emit_wire_event()` | emit `ClientViewEvent::StatusUpdate` directly |
| `ServerMessage` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::ServerMessage` directly |
| `Chat` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::Chat` directly |
| `ChannelMessage` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::ChannelMessage` directly |
| `Tell` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::Tell` directly |
| `Emote` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::Emote` directly |
| `PingResponse` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::PingResponse` directly |
| `ItemManaResponse` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::ItemManaResponse` directly |
| `CombatFeedback` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::CombatFeedback` directly |
| `BootAccount` | `client/messages.rs` | `emit_wire_event()` | emit `ClientViewEvent::BootAccount` directly |
| `WeenieError` | `client/messages.rs` | `emit_wire_event()` currently maps to `ActionResult`; `ClientViewEvent::WeenieError` exists but is not the active projection path | emit `ClientViewEvent::ActionResult` directly; treat the standalone `ClientViewEvent::WeenieError` shape as follow-up cleanup if it remains unused |
| `InventoryServerSaveFailed` | `client/messages.rs`, one core test helper in `client/mod.rs` | `emit_wire_event()` maps to `ActionResult` | emit `ClientViewEvent::ActionResult` directly |
| `CharacterError` | `client/messages.rs` | `emit_wire_event()` maps to `ActionResult` | emit `ClientViewEvent::ActionResult` directly |
| `UseDone` | `client/messages.rs` | `emit_wire_event()` only maps non-`None` values to `ActionResult` | handle directly inside message processing / busy-operation logic; no separate bus variant needed |
| `ClientError` | `client/commands.rs` | `emit_wire_event()` maps to `ActionResult` | remove first; emit `ClientViewEvent::ActionResult` directly |
| `LogMessage` | `client/commands.rs` | `emit_wire_event()`, command tests | remove first; emit `ClientViewEvent::LogMessage` directly |
| `ViewContents` | `client/messages.rs` | no projection in `emit_wire_event()` and no active subscriber surfaced by the dry run | delete unless a concrete consumer still exists; world already handles the decoded message |

## Natural Task Scheduling Adjustments From The Dry Run

The codebase suggests a cleaner execution order than a naive "delete enum and fix compile errors" approach.

### 1. Remove Fake `WireEvent` Variants Before Touching Packet-Derived Ones
`ClientError` and `LogMessage` are the least defensible variants and have the narrowest blast radius. They should move first because they do not depend on any decode-path refactor.

### 2. Migrate Test Expectations Alongside Each Slice
Several tests in [crates/holtburger-core/src/client/messages.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/messages.rs) and [crates/holtburger-core/src/client/commands.rs](/home/me/code/holtburger/crates/holtburger-core/src/client/commands.rs) currently assert both wire and view emission. Those should be converted incrementally to assert only the surviving semantic surface for each migrated slice, rather than left for one giant cleanup at the end.

### 3. Leave Raw Diagnostics Until The End
`RawMessage` and any surviving message-dump facility should be the last step. They are the only plausible reason a low-level seam might still exist after replay removal, so deleting them early would create churn without clarifying the architecture.

### 4. Collapse `GameMessage` As A Special Case During Decode, Not Via A New Bus
The only currently observed semantic projection from `WireEvent::GameMessage` is `WorldNameUpdated` for `GameMessage::ServerName`. That is a sign to move that projection into the decode/message-handling path directly instead of preserving a generic decoded-message event layer.

## Recommended Architecture

### Core Principle
Split event surfaces by audience, not by historical accident.

- `SessionEvent`: transport/session internals only
- `GameMessage`: decoded protocol input owned by the core->world boundary
- `WorldEvent`: authoritative world mutation outcomes
- `ClientViewEvent`: frontend/script/harness semantic feed
- optional diagnostic sink: explicit raw-packet/raw-message observability, only if still needed

### Proposed Runtime Shape

#### 1. Remove `WireEvent` From The Main Runtime API
`ClientRuntime` should stop publishing `WireEvent` as a general broadcast surface. Core should instead:

- decode session bytes into `GameMessage`
- route decoded messages to direct core handlers and `WorldState::handle_message()`
- emit `ClientViewEvent` directly for frontend-facing semantics
- emit `WorldEvent` projections directly into `ClientViewEvent`

This removes the current "emit wire event, immediately re-project it" double hop.

#### 2. Keep World On `GameMessage`
Do not insert a new core-owned DTO layer between core and world in this refactor. That would mostly move the routing duplication rather than remove it.

#### 3. Replace Raw `WireEvent` Needs With Narrower Seams
Anything still needed after `WireEvent` removal should become one of:

- direct `ClientViewEvent` emission for UI-visible semantics
- a private helper path for action-result/log/status emission inside core
- a dedicated diagnostic callback or sink for raw bytes / decoded messages, if packet extraction still matters

If the extractor only needs raw byte dumps plus `CharacterList`, that is much narrower than the current full `WireEvent` bus.

#### 4. Treat Replay Removal As Part Of The Same Cleanup
Replay-era plumbing should not be preserved behind a renamed abstraction. If replay is dead, remove replay-based construction and any event surfaces that only existed to support it.

## Phased Implementation

### Phase 1: Finalize And Validate `WireEvent` Responsibility Inventory

#### Deliverables
- Validate the existing dry-run matrix against any hidden consumers or edge cases and lock the remaining decisions.
- Ensure every current `WireEvent` variant is classified as one of:
  - raw diagnostic
  - decoded protocol observation
  - normalized semantic event
  - client-generated misc event
- Confirm all `subscribe_wire_events()` consumers and what they actually need.
- Decide which responsibilities survive the refactor and which are deleted with replay/removal.

#### Acceptance Criteria
- Every `WireEvent` variant has an explicit replacement target or deletion decision.
- Every current subscriber has an explicit migration target.
- No variant remains in the "we will figure it out later" bucket.

### Phase 2: Remove Synthetic Non-Wire Usage First

#### Deliverables
- Replace `WireEvent::ClientError`, `WireEvent::LogMessage`, and similar command-generated usage with direct `ClientViewEvent` emission or private helper methods inside core.
- Introduce small helper methods in `ClientRuntime` for recurring direct view-event emission where needed.
- Keep behavior unchanged from the TUI/script consumer perspective.

#### Acceptance Criteria
- `commands.rs` no longer emits fake `WireEvent` values for client-generated logs/errors.
- The remaining `WireEvent` usages, if any, are strictly packet-derived or deliberately diagnostic.
- Narrow tests for touched command/view-event behavior pass.

### Phase 3: Collapse The `emit_wire_event()` Bridge

#### Deliverables
- Replace `emit_wire_event()` call sites in core message handling with direct `ClientViewEvent` emission and direct internal state handling.
- Remove the broad `match` projection in `ClientRuntime::emit_wire_event()`.
- Keep any necessary decode-local helpers small and explicit rather than rebuilding a new catch-all bus under a different name.

#### Acceptance Criteria
- Normal frontend-visible semantics flow directly into `ClientViewEvent` without bouncing through `WireEvent`.
- Core no longer needs a public `subscribe_wire_events()` path for ordinary runtime behavior.
- `WireEvent` is either gone or reduced to an explicitly diagnostic private/internal type.

### Phase 4: Remove Replay-Era Public Plumbing And Optionally Repair Harnesses

#### Deliverables
- Remove replay-era public construction/event plumbing encountered in core/session during the refactor so we do not preserve dead seams behind the new architecture.
- Preserve raw message dumping through `message_dump_dir` or replace it with a narrower explicit diagnostic sink if that is cleaner.
- If worth the effort, update [crates/holtburger-debug-harness/src/bin/extractor.rs](/home/me/code/holtburger/crates/holtburger-debug-harness/src/bin/extractor.rs) to stop depending on `WireEvent` and use `ClientViewEvent::CharacterList` or another explicit semantic signal for control flow.

#### Acceptance Criteria
- Replay-era public runtime/event plumbing is removed rather than hidden behind compatibility shims.
- Any remaining low-level diagnostic seam is explicit and narrow.
- If the extractor is touched in this phase, it no longer depends on `subscribe_wire_events()`.

#### Priority Note
This phase is intentionally lower priority than the main runtime cleanup. If removing `WireEvent` cleanly causes temporary extractor regressions, that is acceptable. Harness restoration should not block deleting the mixed-responsibility runtime event surface.

### Phase 5: Remove `WireEvent` Public Surface And Dead Code

#### Deliverables
- Delete `WireEvent` and `subscribe_wire_events()` if no diagnostic public API remains necessary.
- Remove `wire_event_tx` and associated runtime plumbing from `ClientRuntime`.
- Remove dead tests, helpers, and imports that existed only to support `WireEvent`.
- Update architecture docs in core/session/debug-harness to match the new event flow.

#### Acceptance Criteria
- `holtburger-core` no longer exports `WireEvent` as part of the runtime API.
- The documented runtime flow matches the code: session bytes -> core decode -> world -> world/core projections -> `ClientViewEvent`.
- `cargo test` for touched crates passes.

## Risks And Mitigations

### Risk 1: We Accidentally Delete Useful Diagnostics Along With Replay
The current overloaded bus makes it easy to lose raw observability when simplifying the API.

Mitigation:
- classify raw diagnostic needs explicitly in Phase 1
- keep `message_dump_dir` or replace it with a narrow diagnostic sink before deleting `WireEvent`
- do not couple diagnostic deletion to the same patch as semantic event rewiring unless the replacement already exists

### Risk 2: View-Event Behavior Regresses Because The Current Bridge Hides Ordering
`emit_wire_event()` currently centralizes some ordering and projection behavior.

Mitigation:
- migrate one local slice at a time
- validate with narrow tests around touched message/command flows
- prefer small helper methods over broad rewrites so ordering stays explicit

### Risk 3: Docs And Harnesses Lag The Refactor
This repo already has stale architecture prose around the session/core event boundary.

Mitigation:
- treat docs as first-class deliverables, not cleanup if time permits
- finish with a doc audit across core and session surfaces, and update debug-harness docs if that tool is still meant to be supported afterward

Adjusted priority for this refactor:
- documentation remains first-class because it defines the architecture contract
- debug-harness recovery is explicitly allowed to lag if needed

### Risk 4: We Recreate `WireEvent` Under A New Name
If we remove the type but keep one universal intermediate bus, the architecture does not really improve.

Mitigation:
- require every surviving event surface to name its audience explicitly
- reject catch-all replacements unless they are strictly diagnostic and narrowly scoped

## Definition Of Done

- `WireEvent` is deleted or reduced to a private/narrow diagnostic seam with no frontend/runtime semantic role.
- `holtburger-core` emits `ClientViewEvent` directly for frontend-visible semantics.
- `holtburger-world` still consumes `GameMessage` directly and no new DTO layer is added between core and world.
- Replay-era public construction/event plumbing is removed.
- Core/session architecture docs describe the actual event flow accurately.
- If the debug harness remains in active use after the refactor, it no longer depends on `subscribe_wire_events()`.
- Focused tests for touched crates pass.

## Living Worksheet

### Task Checklist
- [x] Phase 1: Finalize and validate the `WireEvent` inventory and migration matrix.
- [x] Phase 2: Remove synthetic client-generated `WireEvent` usage.
- [x] Phase 3: Replace bridge-style `emit_wire_event()` projections with direct `ClientViewEvent` emission.
- [x] Phase 4: Remove replay-era public plumbing and optionally repair harness tooling.
- [x] Phase 5: Delete `WireEvent` public API and update docs.

### Decisions Log
- Decision: keep `holtburger-world` on `GameMessage`; no new DTO layer between core and world in this refactor.
- Decision: treat replay removal as in-scope because it materially reduces the need for a raw event bus.
- Decision: preserve low-level diagnostics only through a narrow explicit seam, not through a mixed runtime event type.
- Decision: Phase 2 removes `WireEvent::ClientError` and `WireEvent::LogMessage` outright instead of preserving them as renamed compatibility variants.
- Decision: command-generated errors/log output now go straight to `ClientViewEvent` through small `ClientRuntime` helpers (`emit_action_result`, `emit_log_message`) rather than bouncing through the wire bus.
- Decision: Phase 3 moves message/status-side `ClientViewEvent` projection to the producer paths (`messages.rs` plus `send_status_event`) instead of keeping any projection logic inside `emit_wire_event()`.
- Decision: `emit_wire_event()` now acts only as the remaining `WireEvent` rebroadcast seam for tests/debug consumers; it no longer has frontend semantic responsibilities.
- Decision: Phase 4/5 deletes `WireEvent` entirely instead of preserving a private diagnostic event enum, because the remaining consumer need was fully covered by direct `ClientViewEvent` semantics plus raw byte dumping.
- Decision: raw message dumping survives, but only as explicit builder configuration via `ClientRuntimeBuilder::message_dump_dir(...)`; the mutable runtime field is no longer part of the public API.
- Decision: the debug harness now treats `ClientViewEvent::CharacterList` as its control-flow signal and uses builder-configured raw message dumps for packet capture.

### Verification Log
- Completed Phase 1 in planning/doc analysis:
  - validated the full `WireEvent` variant inventory against the current codebase
  - confirmed the remaining subscribers and their actual needs before implementation began
  - locked the migration matrix that drove Phases 2 through 5
- Completed Phase 2 in core:
  - removed `WireEvent::ClientError` and `WireEvent::LogMessage`
  - moved command-side emission to direct `ClientViewEvent` helpers in `ClientRuntime`
  - updated the fellowship status command test to read from `ClientViewEvent`
  - added a command test covering the missing-confirmation client error path
- Completed Phase 3 in core:
  - removed the `ClientViewEvent` projection match from `ClientRuntime::emit_wire_event()`
  - moved status updates to direct `ClientViewEvent::StatusUpdate` emission before any wire rebroadcast
  - moved message-side semantic projection in `client/messages.rs` to direct `ClientViewEvent` emission for character selection flow, chat/server messages, combat feedback, action results, boot/status cases, and world-name updates
  - updated the mod-level action-result projection test so it asserts the new direct path instead of `emit_wire_event()` side effects
- Completed Phase 4/5 in core and harness:
  - deleted `WireEvent`, `subscribe_wire_events()`, `wire_event_tx`, and all remaining wire-bus rebroadcast logic from `holtburger-core`
  - removed the last message-side `emit_wire_event()` calls and migrated the remaining message tests to assert only `ClientViewEvent`
  - moved raw message dump configuration from `ClientRuntime.message_dump_dir` to `ClientRuntimeBuilder::message_dump_dir(...)`
  - updated the extractor harness to use `ClientViewEvent::CharacterList` for control flow while preserving raw dump capture through builder configuration
  - updated core/session/debug-harness architecture docs to describe the post-`WireEvent` event flow accurately
- Validation:
  - `cargo test -p holtburger-core command`
  - `cargo test -p holtburger-core messages`
  - `cargo test -p holtburger-core client`
  - `cargo check -p holtburger-debug-harness`
  - no editor errors in the touched core files

### Course-Correct Check
- No course correction needed before Phase 3.
- The Phase 2 result matches the plan's intended shape: remaining `WireEvent` usage in core is no longer command-generated misc output.
- Watch item for Phase 3: keep the new direct-emission helpers narrow and resist turning them into another generic intermediate bus.
- No course correction needed after Phase 3.
- The runtime/frontend semantic path no longer depends on `emit_wire_event()` normalization; that bridge has been collapsed as planned.
- Watch item for Phase 4/5: `WireEvent` still rebroadcasts many packet-derived semantic events for tests/debug consumers, so the next phases must delete or narrow that public seam rather than letting the temporary duplication become permanent.
- No course correction needed after Phase 5.
- The mixed-responsibility runtime event surface is now fully gone from code and public exports.
- Remaining watch item is documentation drift outside the touched architecture files, not an architectural blocker in the runtime itself.

### Open Questions
- Resolved: raw byte dump support is sufficient for the surviving diagnostic need in this refactor; we did not keep a public decoded-message diagnostic stream.
- Resolved: the surviving diagnostic sink now lives in builder/config construction through `ClientRuntimeBuilder::message_dump_dir(...)`.