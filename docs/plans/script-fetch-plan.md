# Script Fetch Non-Blocking Plan

## Context And Boundaries

### Goal

Make `HB.fetchJson()` non-blocking for the TUI by moving only the HTTP request work off the synchronous script-host execution path, while keeping the refactor narrowly contained to the scripting crate.

### Why This Matters

`HB.fetchJson()` currently returns a Promise to scripts, but the Rust host still performs the request synchronously inside the same thread that drives the embedded JS runtime. That means the TUI can stall while a request is in flight.

We do not need a full script-runtime-worker architecture to fix that immediate problem. The narrower target is to background only the request execution, keep JS and V8 interactions on the script-host thread, and resolve or reject pending fetch Promises during the host's existing tick or event pumping.

### In Scope

- Remove blocking HTTP request execution from the synchronous `HB.fetchJson()` host op path.
- Keep Promise creation and Promise settlement owned by `holtburger-scripting`.
- Run only the outbound HTTP request work in a small bounded background worker pool.
- Drain completed request outcomes on the script-host thread before normal event dispatch and tick handling.
- Preserve the existing fetch policy model, CLI surface, and script-facing API contract.
- Add tests proving the TUI-facing script host no longer blocks while requests are pending.

### Out Of Scope

- A dedicated out-of-process or cross-thread script runtime worker.
- A full Tokio-backed async `deno_core` host redesign.
- Reworking the TUI's event loop or frontend state architecture.
- Changing the `HB.fetchJson()` request or response shape.
- Expanding fetch capabilities beyond the current bounded JSON-only semantics.

## Ground Truth And Existing Patterns

### Reference Sources

- [AGENTS.md](AGENTS.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [apps/holtburger-cli/ARCHITECTURE.md](apps/holtburger-cli/ARCHITECTURE.md)
- [apps/holtburger-cli/src/pages/game/domains/script.rs](apps/holtburger-cli/src/pages/game/domains/script.rs)
- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)
- [crates/holtburger-scripting/src/types.rs](crates/holtburger-scripting/src/types.rs)
- [crates/holtburger-scripting/src/lib.rs](crates/holtburger-scripting/src/lib.rs)
- [crates/holtburger-scripting/holtburger.d.ts](crates/holtburger-scripting/holtburger.d.ts)
- [crates/holtburger-scripting/SCRIPTING_GUIDE.md](crates/holtburger-scripting/SCRIPTING_GUIDE.md)

### Relevant Current Architecture Facts

- The TUI currently calls into the script host inline during game-state reduction in [apps/holtburger-cli/src/pages/game/domains/script.rs](apps/holtburger-cli/src/pages/game/domains/script.rs).
- `ScriptHost` owns the embedded `deno_core` runtime and currently drives JS execution synchronously in [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs).
- `HB.fetchJson()` already exists and already has a bounded policy model and stable error codes, but the current host op performs the request synchronously.
- The TUI already provides a recurring tick event to running scripts, which gives the scripting crate a natural cadence for draining completed background fetches without adding new frontend responsibilities.

### Existing Patterns To Follow

- Keep frontend policy ownership in the TUI crate and runtime mechanics in the scripting crate.
- Preserve the frozen `HB` surface and avoid widening the public API for implementation convenience.
- Keep V8 and JS object interactions on the script-host thread; background workers should handle only plain Rust data.

## Core Design Decisions

### Decision 1: Limit The Fix To Request Execution

The bug to fix is request blocking, not general script latency isolation. The plan should background only the network request work and keep the rest of the script host architecture unchanged.

Consequences:

- The change stays narrow and mostly confined to `holtburger-scripting`.
- We avoid a larger worker-runtime refactor until there is a stronger need for one.
- Promise continuations may settle on the next script-host pump rather than immediately when the socket completes.

### Decision 2: Use A Small Bounded Worker Pool

The background execution should use a small fixed-size pool rather than one ad hoc thread per request. That keeps request handling off the host thread without creating unbounded thread growth.

Consequences:

- We get the non-blocking behavior we want without making request bursts expensive to reason about.
- The pool size and saturation policy remain explicit implementation choices instead of accidental behavior.
- The host still owns the request IDs and Promise settlement path.

### Decision 3: Keep Promise Resolution On The Script-Host Thread

Background workers must not touch V8 handles or JS callbacks. They should return only plain Rust completion data keyed by an internal request ID.

Consequences:

- We keep V8 safety simple and explicit.
- The host thread remains the only place that resolves or rejects JS Promises.
- The implementation can use thread-safe queues without cross-thread JS ownership.

### Decision 4: Reuse Existing Tick And Event Pumping

Completed fetches should be drained before normal script event dispatch and before tick work is evaluated, using the host's existing execution cadence.

Consequences:

- No new CLI or TUI API is needed just to advance fetches.
- The change can remain invisible to frontend code or require at most a tiny host-method call-site adjustment.
- Promise continuation latency is bounded by the next host pump rather than true immediate wakeup.

### Decision 5: Preserve The Existing Fetch Contract

This refactor should not change allowed-host behavior, timeout semantics, max-response behavior, request methods, JSON rules, or script-visible error codes.

Consequences:

- The work is mechanical and architectural rather than product-facing.
- Existing tests for fetch semantics should remain valid and simply shift to the new completion path.

## Proposed Runtime Topology

```text
script code
  -> HB.fetchJson(request)
  -> host allocates request id + JS promise capability
  -> host validates request policy and spawns background request worker

background worker
  -> performs bounded HTTP request using plain Rust data only
  -> pushes { request_id, outcome } into a thread-safe completion queue

script host pump on next tick/event
  -> drain completed outcomes
  -> resolve/reject stored JS promises on the host thread
  -> run pending JS microtasks / continuations
  -> continue normal event dispatch
```

Ownership split:

- `holtburger-scripting` owns request IDs, pending Promise bookkeeping, worker spawning, completion queue draining, and JS Promise settlement.
- The TUI continues to own fetch policy inputs, but should not need behavior changes for this refactor.

## Phased Implementation

### Phase 1: Add Internal Fetch Request Tracking

#### Deliverables

- Add host-internal pending fetch bookkeeping keyed by request ID.
- Represent completed fetch results as plain Rust data that can cross thread boundaries safely.
- Separate synchronous request validation from actual request execution.

#### Files

- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)

#### Acceptance Criteria

- The host can allocate and track multiple outstanding fetch requests at once.
- Pending fetch state does not store frontend borrows or non-thread-safe JS state in worker-owned data.
- Validation failures still reject immediately with the current documented error codes.

### Phase 2: Move HTTP Execution To Background Workers

#### Deliverables

- Submit accepted requests into a small bounded worker pool.
- Run the bounded HTTP request logic off the script-host thread.
- Push completion outcomes into a thread-safe queue owned by the host.

#### Files

- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)

#### Acceptance Criteria

- Issuing `HB.fetchJson()` does not block the thread that is currently driving the script host.
- The TUI remains responsive while a slow request is in flight.
- Request timeouts, transport failures, and oversized responses are preserved in completion outcomes.

### Phase 3: Settle Promises During Existing Host Pumps

#### Deliverables

- Add a host-internal drain step that resolves or rejects completed fetch Promises before normal event dispatch.
- Ensure tick and event handling both flush pending completions and run JS continuations.
- Drop stale completions safely when a script host shuts down before the request finishes.

#### Files

- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)
- [apps/holtburger-cli/src/pages/game/domains/script.rs](apps/holtburger-cli/src/pages/game/domains/script.rs) only if an explicit host pump call-site adjustment is proven necessary

#### Acceptance Criteria

- Completed fetches settle their Promises on the script-host thread without blocking the TUI while the request is in flight.
- Promise continuations run on the next host pump and can emit normal script intents.
- No V8 interaction occurs on background threads.

### Phase 4: Tighten Tests And Docs Around Non-Blocking Semantics

#### Deliverables

- Add host tests for multiple concurrent fetches, deferred completion, and stale completion drop on shutdown.
- Add regression tests proving a fetch can remain pending while the host continues ticking.
- Update docs to describe that `HB.fetchJson()` remains Promise-based and no longer blocks the TUI while the request runs.

#### Files

- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)
- [crates/holtburger-scripting/holtburger.d.ts](crates/holtburger-scripting/holtburger.d.ts) if any implementation-facing comments need clarification
- [crates/holtburger-scripting/SCRIPTING_GUIDE.md](crates/holtburger-scripting/SCRIPTING_GUIDE.md)

#### Acceptance Criteria

- Tests cover success, timeout, denial, concurrent in-flight requests, and post-shutdown completions.
- Docs no longer imply that a pending fetch can stall the client.

## Risks And Mitigations

### Risk: Promise Settlement Requires V8 Work On The Correct Thread

If background workers try to touch JS state directly, the runtime becomes unsafe fast.

Mitigation:

- Restrict background workers to plain Rust request execution only.
- Keep Promise resolve and reject handling entirely inside host-thread drain logic.

### Risk: Completed Requests Do Not Run Until The Next Tick Or Event

This design removes blocking, but completion is still pump-driven.

Mitigation:

- Explicitly document that settlement latency is bounded by the next host pump.
- Drain completions before normal tick and event dispatch so they are processed at the earliest natural point.

### Risk: Unbounded Background Request Spawning

Scripts could issue many requests in a burst and create resource pressure.

Mitigation:

- Keep the worker pool bounded so request bursts do not create unbounded thread growth.
- Keep all current host allowlist and timeout limits intact.

### Risk: Script Shutdown Leaves Orphaned Completions

Requests may finish after the script host has already been stopped.

Mitigation:

- Track host-local request IDs and pending state.
- Ignore completions whose request ID is no longer known.

## Definition Of Done

- `HB.fetchJson()` no longer blocks the TUI while the HTTP request is in flight.
- The fix is contained to `holtburger-scripting`, except for at most a minimal host pump call-site adjustment if proven necessary.
- Promise settlement happens only on the script-host thread.
- Existing fetch policy and error semantics remain unchanged.
- Tests cover concurrent pending requests, delayed completion, and shutdown cleanup.
- `cargo test -p holtburger-scripting` and relevant CLI tests pass.

## Living Worksheet

### Task Checklist

- [ ] Phase 1: add pending fetch request bookkeeping in the script host
- [ ] Phase 1: define plain Rust completion payloads keyed by request ID
- [ ] Phase 2: move bounded HTTP execution into background workers
- [ ] Phase 2: queue completed request outcomes back to the host
- [ ] Phase 3: drain completions before normal host tick and event dispatch
- [ ] Phase 3: settle or reject JS Promises on the host thread only
- [ ] Phase 3: ignore stale completions after script shutdown
- [ ] Phase 4: add concurrent and deferred-completion tests
- [ ] Phase 4: update docs to describe non-blocking request execution

### Decisions Log

- This plan targets only request non-blocking behavior, not general script-runtime isolation.
- The intended containment boundary is the scripting crate, with no planned CLI product-surface changes.
- Background workers handle network I/O only; V8 interaction stays on the script-host thread.
- Promise completion is pump-driven and should settle on the next tick or event rather than immediately on socket readiness.
- The background execution model uses a small fixed-size worker pool rather than one thread per request.

### Verification Log

- Pending implementation.

### Open Questions

- What exact pool size and saturation behavior should v1 use?
