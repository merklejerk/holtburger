# Disconnect Detection Worksheet

Execution tracking for implementing reliable disconnect detection.

## A) Task Checklist

### Phase 1 — Liveness model
- [ ] Add liveness config struct and defaults.
- [ ] Add client liveness runtime fields (`last_rx_at`, probe bookkeeping).
- [ ] Add suspect representation in client state model.
- [ ] Compile check: `cargo check -p holtburger-core`.

### Phase 2 — Runtime detection
- [ ] Add liveness tick to `Client::run` select loop.
- [ ] Update liveness on inbound session traffic.
- [ ] Implement suspect transition and heartbeat probe behavior.
- [ ] Implement final disconnect on timeout/probe misses.
- [ ] Verify graceful `/quit` path remains unchanged.

### Phase 3 — Status + logs
- [ ] Emit status updates on transition only.
- [ ] Add actionable logs (idle duration, missed probes).
- [ ] Verify CLI/TUI status reflects suspect/disconnected states.

### Phase 4 — Tests
- [ ] Add inactivity -> suspect test.
- [ ] Add suspect -> connected recovery test.
- [ ] Add suspect -> disconnected timeout test.
- [ ] Run target tests and ensure no unrelated failures are introduced.

---

## B) Decisions Log

| Date | Decision | Why | Impact |
|---|---|---|---|
| 2026-02-14 | Use layered detection (transport errors + inactivity + probe) | UDP alone does not provide reliable disconnect semantics | Lower false negatives for half-open/silent failures |
| 2026-02-14 | Use staged state (`Connected -> Suspect -> Disconnected`) | Avoid dropping during transient packet jitter | Better UX stability |
| TBD | Represent suspect as `ClientState::Suspect` vs side-channel flag | Keep status/event model coherent | Affects UI mapping and event consumers |

---

## C) Verification Log

| Date | Command / Check | Result | Notes |
|---|---|---|---|
| 2026-02-14 | `cargo check -p holtburger-cli` | ✅ | Baseline before implementation |
| YYYY-MM-DD | `cargo check -p holtburger-core` | ⬜ |  |
| YYYY-MM-DD | `cargo test -p holtburger-core` | ⬜ | Run focused tests first if suite is large |
| YYYY-MM-DD | Manual smoke (live: idle timeout behavior) | ⬜ | Validate suspect then disconnect transitions |

---

## D) Open Questions

1. Should suspect be a first-class `ClientState` or only a liveness flag + log?
2. Should any inbound transport packet reset inactivity, or only decoded `SessionEvent::Message`/`TimeSync`?
3. Should replay mode bypass liveness disconnect entirely?
4. Preferred timeout defaults for local ACE vs higher-latency remote environments?

---

## E) Handoff Notes

- Keep changes narrow to `holtburger-core` and existing UI status mapping.
- Do not add auto-reconnect in this iteration.
- If tests are hard to place at client-loop level, prioritize deterministic unit coverage around liveness transition logic extracted into a small helper.
