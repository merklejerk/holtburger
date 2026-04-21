# Script Fetch Plan

## Context And Boundaries

### Goal

Add a narrow frontend-owned `HB.fetchJson` capability to the TUI scripting runtime so scripts can make small outbound JSON requests under explicit command-line policy, without turning the embedded Deno host into a general-purpose network runtime.

### Why This Matters

The current scripting host is intentionally tiny and explicitly promises no raw networking. That keeps the runtime predictable, but it blocks practical automation cases such as talking to a local helper process, polling a small JSON status endpoint, or posting script telemetry.

We should solve that with a host-curated API, not by dropping in generic Deno networking wholesale.

### In Scope

- Define a minimal `HB.fetchJson` surface for small JSON request-response workflows.
- Keep network policy frontend-owned and injected by the TUI at startup.
- Make user-tunable policy ephemeral and command-line driven rather than persisted in config files.
- Default the allowed-host policy to `localhost:9999`.
- Treat an empty allowed-host list as effectively disabled, without a separate enable flag.
- Add a phased implementation path covering host API, CLI plumbing, tests, and docs.

### Out Of Scope

- Exposing raw `fetch`, `Request`, `Response`, streams, cookies, or browser-compatible networking semantics.
- Dynamic module imports, remote code loading, or general Deno permission plumbing.
- Persistent scripting-network config files.
- A full cross-client scripting policy shared with future frontends.
- Arbitrary localhost or LAN access by default.

## Ground Truth And Existing Patterns

### Reference Sources

- [AGENTS.md](AGENTS.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [apps/holtburger-cli/ARCHITECTURE.md](apps/holtburger-cli/ARCHITECTURE.md)
- [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs)
- [apps/holtburger-cli/src/scripting.rs](apps/holtburger-cli/src/scripting.rs)
- [apps/holtburger-cli/src/pages/game/domains/script.rs](apps/holtburger-cli/src/pages/game/domains/script.rs)
- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)
- [crates/holtburger-scripting/src/lib.rs](crates/holtburger-scripting/src/lib.rs)
- [crates/holtburger-scripting/holtburger.d.ts](crates/holtburger-scripting/holtburger.d.ts)
- [crates/holtburger-scripting/SCRIPTING_GUIDE.md](crates/holtburger-scripting/SCRIPTING_GUIDE.md)
- [docs/plans/deno-core-scripting-architecture-plan.md](docs/plans/deno-core-scripting-architecture-plan.md)

### Relevant Current Architecture Facts

- The TUI owns the scripting bridge and frontend projection state; it already wires `TuiScriptClientView` into `ScriptHost` in [apps/holtburger-cli/src/scripting.rs](apps/holtburger-cli/src/scripting.rs).
- The scripting runtime is a frontend-owned embedded `deno_core` host, not a full Deno CLI environment, as documented in [crates/holtburger-scripting/SCRIPTING_GUIDE.md](crates/holtburger-scripting/SCRIPTING_GUIDE.md).
- The public script surface is hand-authored as a frozen `HB` object in [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs), so adding one more curated method fits the existing pattern.
- Script startup is already queued from CLI arguments in [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs), which makes command-line-only script policy a natural fit.
- The current guide explicitly says scripts do not have raw networking. That contract must be revised carefully if `HB.fetchJson` lands.

### Existing Patterns To Follow

- Frontend-owned policy and integration seams belong in the CLI crate, per [apps/holtburger-cli/ARCHITECTURE.md](apps/holtburger-cli/ARCHITECTURE.md).
- Script intents should continue compiling back into frontend actions rather than reaching across boundaries directly.
- The scripting crate should stay focused on the host boundary types and runtime plumbing, not TUI-specific argument parsing or persisted app configuration.

## Core Design Decisions

### Decision 1: Use A Bespoke `HB.fetchJson`, Not Generic Deno Fetch

The runtime should expose a narrow `HB.fetchJson` API tailored for small JSON request-response use cases. We should not install the full generic Deno fetch stack as the script contract.

Consequences:

- The host keeps a reviewable attack surface.
- We avoid browser-compatibility scope creep.
- The API can return plain JSON-friendly objects instead of re-creating `Response`, streaming semantics, or script-visible headers.
- The runtime can inject fixed `Origin` and `User-Agent` values that identify Holtburger without exposing headers back to scripts.

### Decision 2: Keep Network Policy Frontend-Owned

Allowed-host policy should be supplied by the TUI at process startup and passed into the scripting bridge. The scripting crate should enforce the policy it is given, but it should not discover that policy from files or own a persistent config story.

Consequences:

- Policy remains a frontend concern, which matches the current crate boundaries.
- Other frontends can choose a different policy model later without forcing TUI assumptions into shared crates.

### Decision 3: Command-Line-Only User Tuning

Any user-visible policy knobs introduced in v1 should be ephemeral CLI arguments. We should not add a persisted fetch config file.

Consequences:

- Launch-time behavior is explicit and reproducible.
- There is no new config file lifecycle to document or migrate.
- The implementation can reuse the existing Clap-based startup flow.

### Decision 4: Default Allowlist Is `localhost:9999`

The default allowed-host list should contain only `localhost:9999`. Users can override that with a CLI option. An empty list means no hosts are allowed, which is equivalent to disabling fetch without a second `enabled` switch.

Consequences:

- The common local-helper workflow works out of the box.
- We do not silently grant broad localhost, LAN, or internet access.
- The host-policy model stays simple: host list only, no separate boolean gate.

## Proposed Runtime Topology

```text
CLI args
  -> parse script fetch policy
  -> build frontend scripting bridge config
  -> spawn ScriptHost with runtime-owned HTTP policy

script code
  -> HB.fetchJson(request)
  -> scripting host op validates request against injected policy
  -> host performs bounded HTTP request
  -> host resolves Promise with small response object
```

Ownership split:

- CLI crate owns argument parsing and launch-time policy defaults.
- CLI scripting bridge owns translating parsed args into a scripting-host config object.
- `holtburger-scripting` owns runtime boundary types, policy enforcement, JS op plumbing, and Promise resolution.

## Proposed API Shape

### Script-Facing API

Keep v1 intentionally small:

```ts
type HbFetchRequest = {
  url: string;
  method?: "GET" | "POST";
  bodyJson?: JsonValue;
  timeoutMs?: number;
};

type HbFetchResponse = {
  ok: boolean;
  status: number;
  bodyJson: JsonValue | null;
};
```

Optional convenience in the same phase:

```ts
HB.fetchJson(request): Promise<{
  ok: boolean;
  status: number;
  bodyJson: JsonValue | null;
}>;
```

Deliberately exclude in v1:

- cookies
- script-visible headers
- redirect customization beyond a safe default
- binary upload and streaming bodies
- arbitrary browser header semantics
- request cancellation API beyond host-enforced timeout
- request methods other than `GET` and `POST`

Failure semantics:

- HTTP responses resolve normally, even for non-2xx status codes.
- Timeouts, DNS failures, connect failures, TLS failures, malformed URLs, and policy denials reject the Promise with a normal JS error.
- The rejected error should carry a stable machine-readable code so scripts can distinguish timeout from other transport failures.

### CLI Policy Surface

Recommended initial CLI flags:

- `--script-fetch-allow-host <HOST[:PORT]>`
  - repeatable
  - default value list: `localhost:9999`
  - supplying the flag one or more times replaces the default list
- `--script-fetch-timeout-ms <MILLISECONDS>`
  - CLI arg with a sane default timeout
- `--script-fetch-max-response-bytes <BYTES>`
  - CLI arg with a sane default response cap

Important rule: if a knob is user-configurable in v1, it should be CLI-only and not persisted.

The host should always add fixed Holtburger-identifiable request headers internally, including `Origin` and `User-Agent`, but those headers should not be script-visible or script-configurable.

## Phased Implementation

### Phase 1: Define The Shared Host Boundary

#### Deliverables

- Add script-facing request/response types to the scripting crate.
- Add a small host-policy type for allowed hosts and bounded request limits.
- Extend the frozen `HB` API with `fetchJson`.
- Document the Promise-based behavior and error semantics in the type definitions.

#### Files

- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)
- [crates/holtburger-scripting/src/lib.rs](crates/holtburger-scripting/src/lib.rs)
- [crates/holtburger-scripting/holtburger.d.ts](crates/holtburger-scripting/holtburger.d.ts)

#### Acceptance Criteria

- The public scripting API shape is explicit and intentionally narrower than raw fetch.
- The scripting crate can represent runtime host policy without depending on the CLI crate.
- The JS API returns Promises and fits the current event-loop-driven host model.

### Phase 2: Wire CLI Arguments Into Frontend-Owned Policy

#### Deliverables

- Add new Clap args in the TUI entrypoint.
- Parse the effective allowed-host list using `localhost:9999` as the default.
- Treat an explicit empty effective list as deny-all.
- Add CLI args for timeout and max-response with sane defaults.
- Thread the policy into the CLI scripting bridge and into `ScriptHost::spawn`.

#### Files

- [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs)
- [apps/holtburger-cli/src/scripting.rs](apps/holtburger-cli/src/scripting.rs)
- [apps/holtburger-cli/src/pages/game/domains/script.rs](apps/holtburger-cli/src/pages/game/domains/script.rs) if startup plumbing changes require it

#### Acceptance Criteria

- Launch-time script-fetch policy is entirely driven by CLI args.
- No new persistent config file is introduced.
- The default policy allows only `localhost:9999`.
- Overriding the host list from the CLI is unambiguous and test-covered.
- Timeout and max-response limits are user-tunable from the CLI and still have sane defaults.

### Phase 3: Implement Bounded Request Execution

#### Deliverables

- Add an async host op that validates request method, URL scheme, host, and port.
- Enforce the injected allowed-host list before any outbound request is sent.
- Apply timeout and response-size limits.
- Return small structured results for JSON responses and normal JS errors for policy, timeout, or transport failures.

#### Files

- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)

#### Acceptance Criteria

- Requests to unapproved hosts are rejected.
- The default path can talk to `localhost:9999` but not arbitrary localhost ports.
- `GET` and `POST` are supported without exposing a broader network runtime.
- Requests resolve through the existing Deno event loop without hanging the host.

### Phase 4: Tests, Docs, And Guardrails

#### Deliverables

- Add unit tests for CLI parsing, effective host-list selection, and host-policy validation.
- Add scripting-host tests covering allowed, denied, timeout, and malformed-request cases.
- Update scripting docs to replace the current blanket “no networking” statement with the new host-curated `HB.fetchJson` contract.
- Add usage examples for the local-helper workflow.

#### Files

- [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs)
- [crates/holtburger-scripting/src/host.rs](crates/holtburger-scripting/src/host.rs)
- [crates/holtburger-scripting/SCRIPTING_GUIDE.md](crates/holtburger-scripting/SCRIPTING_GUIDE.md)
- [README.md](README.md) if startup documentation should mention the new CLI flags

#### Acceptance Criteria

- CLI parsing tests prove default and override behavior.
- Host tests prove deny-by-policy behavior and bounded execution.
- User-facing docs no longer contradict the runtime.

## Risks And Mitigations

### Risk: Localhost Default Still Expands The Sandbox

Even a narrow `localhost:9999` default is a real sandbox expansion.

Mitigation:

- Keep the default as exact host plus port, not all localhost.
- Keep the API narrow.
- Reject every request outside the configured allowlist.

### Risk: Async Host Work Becomes Hard To Reason About

Promise-based HTTP must still cooperate with the existing script-host lifecycle.

Mitigation:

- Reuse the current event-loop pumping model in the scripting host.
- Keep request semantics strictly request-response.
- Avoid streaming and long-lived sockets.

### Risk: Policy Logic Leaks TUI Concerns Into Shared Crates

If the scripting crate starts parsing CLI strings or owning app-specific defaults, crate boundaries get muddy.

Mitigation:

- Parse CLI args in the TUI.
- Pass a typed policy object into the scripting host.
- Keep shared crate logic focused on enforcement, not argument UX.

### Risk: Header And Redirect Scope Creep

“Just one more header” or “just one more fetch option” can quickly turn this into raw fetch.

Mitigation:

- Freeze a small v1 surface.
- Explicitly list excluded features in docs and tests.
- Add new semantics only when a concrete use case proves they are needed.

## Definition Of Done

- `HB.fetchJson` exists as a documented Promise-based scripting API.
- The TUI exposes command-line-only launch policy for allowed hosts, with `localhost:9999` as the default.
- An empty effective allowlist denies all fetches without a second enable flag.
- Requests are bounded by host policy and execution limits.
- Timeouts and other transport failures reject with a documented JS error shape and stable error code.
- Tests cover CLI parsing, policy enforcement, and basic request behavior.
- Docs accurately describe the new network contract and local-helper workflow.
- `cargo test -p holtburger-scripting` and relevant CLI tests pass.

## Living Worksheet

### Task Checklist

- [ ] Phase 1: define scripting-host request, response, and policy types
- [ ] Phase 1: extend the JS `HB.fetchJson` surface and TypeScript declarations
- [ ] Phase 2: add TUI CLI args for script-fetch host policy
- [ ] Phase 2: thread effective policy through the CLI scripting bridge
- [ ] Phase 3: implement bounded async request execution
- [ ] Phase 3: enforce exact host allowlist semantics
- [ ] Phase 4: add CLI parsing and host enforcement tests
- [ ] Phase 4: update scripting docs and startup docs

### Decisions Log

- Command-line-only policy: user-visible script-fetch tuning should be ephemeral and supplied at startup, not persisted.
- Default allowed-host list: `localhost:9999`.
- No separate enable flag: an empty effective allowlist acts as deny-all.
- Favor a bespoke `HB.fetchJson` over enabling generic Deno fetch as the public script contract.
- The runtime injects Holtburger-identifiable `Origin` and `User-Agent` headers internally; scripts do not set or observe headers.
- Timeout and max-response limits are exposed as CLI args with sane defaults.

### Verification Log

- Pending implementation.

### Open Questions

- None.