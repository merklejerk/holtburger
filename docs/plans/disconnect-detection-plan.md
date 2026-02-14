# Reliable Disconnect Detection Plan

## 1) Context & Boundaries

### Goal
Implement reliable client-side disconnect detection for live sessions by combining transport errors, inactivity timeout, and active heartbeat probing.

### In Scope
- Add liveness tracking for inbound/outbound traffic in session/client runtime.
- Add a staged connectivity model (`Connected -> Suspect -> Disconnected`) to avoid false positives.
- Add heartbeat probe behavior before forced disconnect.
- Expose status to CLI/TUI via existing `ClientEvent::StatusUpdate` flow.
- Add focused tests for timeout/probe transitions.

### Out of Scope
- Reconnection flow / auto-relogin.
- New protocol features not already supported by ACE server behavior.
- TUI redesign beyond existing status display hooks.

---

## 2) Ground Truth & Existing Patterns

### Reference Sources
- `crates/holtburger-core/src/session/mod.rs`
  - Transport send/recv, ACK handling, optional header parsing, `recv_message` event stream.
- `crates/holtburger-core/src/client/mod.rs`
  - Main event loop (`tokio::select!`) and state transitions to `Disconnected` on session errors.
- `crates/holtburger-core/src/client/messages.rs`
  - Existing `PingResponse` handling and status/event emission.
- `crates/holtburger-core/src/client/commands.rs`
  - Existing `ClientCommand::Ping`, graceful quit/disconnect behavior.
- `crates/holtburger-core/src/client/types.rs`
  - `ClientState`, `ClientEvent`, and retry structures.
- `apps/holtburger-cli/src/ui/update/world.rs`
  - Existing handling for `ClientEvent::StatusUpdate` and status display update points.

### Existing Patterns to Reuse
- Use the current single-runloop model in `Client::run` (no additional worker tasks required).
- Emit state changes through `send_status_event()` only (avoid introducing parallel status channels).
- Reuse existing ping command/event wiring for heartbeat probe mechanics.

---

## 3) Phased Implementation

### Phase 1: Add Liveness Model & Config

#### Deliverables
- Add liveness configuration struct(s), e.g.:
  - `LivenessConfig { suspect_after, disconnect_after, heartbeat_interval, max_missed_probes }`
- Add liveness runtime state, e.g.:
  - `last_rx_at`, `last_probe_at`, `missed_probes`, `is_suspect`
- Extend client state model for suspect mode (either new `ClientState::Suspect` or equivalent explicit signal).

#### Files
- `crates/holtburger-core/src/client/types.rs`
- `crates/holtburger-core/src/client/mod.rs`
- (optional) `crates/holtburger-core/src/client/builder.rs` for defaults

#### Acceptance Criteria
- Code compiles with new config/state types.
- State model can represent a non-terminal suspect condition.

---

### Phase 2: Runtime Detection in Main Loop

#### Deliverables
- Update `Client::run` to:
  - Refresh `last_rx_at` whenever any inbound session packet/event arrives.
  - Periodically evaluate elapsed inactivity via a dedicated interval tick.
  - Enter suspect state after `suspect_after`.
  - Send active heartbeat probe (`Ping`) at configured cadence while suspect.
  - Transition to disconnected after `disconnect_after` or probe miss threshold.
- Ensure hard transport errors still force immediate disconnect.

#### Files
- `crates/holtburger-core/src/client/mod.rs`
- `crates/holtburger-core/src/client/messages.rs` (only if probe-response bookkeeping lives there)
- `crates/holtburger-core/src/client/commands.rs` (only if probe helper is needed)

#### Acceptance Criteria
- On silent server path (no inbound traffic), client transitions `Connected -> Suspect -> Disconnected`.
- Any inbound traffic during suspect returns to `Connected` and clears miss counters.
- Existing explicit quit/disconnect flow remains unchanged.

---

### Phase 3: Status Surfacing + Observability

#### Deliverables
- Ensure suspect/disconnect transitions emit status updates once per transition.
- Add concise log messages with elapsed inactivity/probe counts.
- Ensure CLI/TUI reflects suspect/disconnected states without UI regressions.

#### Files
- `crates/holtburger-core/src/client/mod.rs`
- `apps/holtburger-cli/src/ui/update/world.rs` (only if additional state text mapping needed)

#### Acceptance Criteria
- Status UI updates correctly as transitions occur.
- Logs are sufficient to diagnose why disconnect was declared.

---

### Phase 4: Tests

#### Deliverables
- Add focused tests for liveness transitions using mock transport/event timing.
- Cover:
  - Inactivity entering suspect.
  - Suspect recovering on inbound traffic.
  - Disconnect after threshold/probe misses.

#### Files
- `crates/holtburger-core/src/session/mod.rs` tests and/or `crates/holtburger-core/src/client/*` tests (where most feasible).

#### Acceptance Criteria
- New tests pass.
- Existing tests unaffected.

---

## 4) Risks & Mitigations

- **Risk:** UDP traffic can be bursty, causing false suspect transitions.
  - **Mitigation:** Use two thresholds (`suspect_after < disconnect_after`) and reset on any inbound packet.
- **Risk:** Probe storms if server is slow.
  - **Mitigation:** Cap probe cadence and max missed probes.
- **Risk:** Replay mode behavior differs from live transport.
  - **Mitigation:** Gate live-only liveness timers or ensure replay defaults don’t aggressively disconnect.
- **Risk:** State churn spams status events.
  - **Mitigation:** Emit status events only on actual state changes.

---

## 5) Definition of Done

- `cargo check` passes for `holtburger-core` and `holtburger-cli`.
- New liveness tests pass.
- Manual smoke behavior verified:
  - Connected session remains stable under normal traffic.
  - Silent connection enters suspect then disconnects.
  - Inbound message during suspect recovers to connected.
- No regressions in explicit `/quit` disconnect path.

---

## 6) Rollout Defaults (Initial)

Suggested initial values (tune after live testing):
- `suspect_after`: 5s
- `heartbeat_interval`: 2s
- `max_missed_probes`: 3
- `disconnect_after`: 12s

These are conservative enough for gameplay responsiveness while tolerating short jitter.

---

## 7) Execution Worksheet

Execution tracking for implementing reliable disconnect detection.

### A) Task Checklist

#### Phase 1 — Liveness model
- [ ] Add liveness config struct and defaults.
- [ ] Add client liveness runtime fields (`last_rx_at`, probe bookkeeping).
- [ ] Add suspect representation in client state model.
- [ ] Compile check: `cargo check -p holtburger-core`.

#### Phase 2 — Runtime detection
- [ ] Add liveness tick to `Client::run` select loop.
- [ ] Update liveness on inbound session traffic.
- [ ] Implement suspect transition and heartbeat probe behavior.
- [ ] Implement final disconnect on timeout/probe misses.
- [ ] Verify graceful `/quit` path remains unchanged.

#### Phase 3 — Status + logs
- [ ] Emit status updates on transition only.
- [ ] Add actionable logs (idle duration, missed probes).
- [ ] Verify CLI/TUI status reflects suspect/disconnected states.

#### Phase 4 — Tests
- [ ] Add inactivity -> suspect test.
- [ ] Add suspect -> connected recovery test.
- [ ] Add suspect -> disconnected timeout test.
- [ ] Run target tests and ensure no unrelated failures are introduced.

---

### B) Decisions Log

| Date | Decision | Why | Impact |
|---|---|---|---|
| 2026-02-14 | Use layered detection (transport errors + inactivity + probe) | UDP alone does not provide reliable disconnect semantics | Lower false negatives for half-open/silent failures |
| 2026-02-14 | Use staged state (`Connected -> Suspect -> Disconnected`) | Avoid dropping during transient packet jitter | Better UX stability |
| TBD | Represent suspect as `ClientState::Suspect` vs side-channel flag | Keep status/event model coherent | Affects UI mapping and event consumers |

---

### C) Verification Log

| Date | Command / Check | Result | Notes |
|---|---|---|---|
| 2026-02-14 | `cargo check -p holtburger-cli` | ✅ | Baseline before implementation |
| YYYY-MM-DD | `cargo check -p holtburger-core` | ⬜ |  |
| YYYY-MM-DD | `cargo test -p holtburger-core` | ⬜ | Run focused tests first if suite is large |
| YYYY-MM-DD | Manual smoke (live: idle timeout behavior) | ⬜ | Validate suspect then disconnect transitions |

---

### D) Open Questions

1. Should suspect be a first-class `ClientState` or only a liveness flag + log?
2. Should any inbound transport packet reset inactivity, or only decoded `SessionEvent::Message`/`TimeSync`?
3. Should replay mode bypass liveness disconnect entirely?
4. Preferred timeout defaults for local ACE vs higher-latency remote environments?

---

### E) Handoff Notes

- Keep changes narrow to `holtburger-core` and existing UI status mapping.
- Do not add auto-reconnect in this iteration.
- If tests are hard to place at client-loop level, prioritize deterministic unit coverage around liveness transition logic extracted into a small helper.
