# Live Automation API Architecture (`holtburger-live-api`)

`holtburger-live-api` provides a shared, transport-neutral Live Automation API engine (`LiveApiEngine`) plus an opt-in localhost-only HTTP/WebSocket/OpenAPI 3.1 server (`axum` + `aide` + `schemars`). It serves three equal consumers over one typed contract: external WebSocket bots, REST/agent clients, and in-process V8 scripts (`holtburger-scripting`).

## Design Principles

- **Core-Owned Authority, Zero State Duplication**: `LiveApiEngine` holds only a `ClientRuntimeHandle` (`holtburger-core`), a bounded `seq`-indexed semantic `EventLog` (2,048 entries), and optional frontend hooks. All snapshot queries execute read-only closures on the `ClientRuntime` event loop via `ClientRuntimeHandle::read(...)`, avoiding shared mutable locks over `WorldState`.
- **Derived Capabilities (No Frontend Stubs)**: Advertised capabilities (`core.*`, `world.spatial`, `content.spells`, `content.skills`, `ui.selection`, `ui.print`, `h3d.hud`) are derived automatically from the resident collision scene and mounted `StaticReferenceCatalogs`, `ClientUiHook`, and `ClientHudHook`. TUI mounts `ClientUiHook` only and never stubs `ClientHudHook`.
- **Two Controllers Only**: Commands routed through `LiveApiEngine` carry `ControlSource::Automation`. User input always carries `ControlSource::User` and interrupts automation steering. Toggling Pause Automation cancels active automation movement/combat and causes core to reject further `Automation` commands until resumed. Multi-bot coordination belongs to external consumers rather than client-side locks.
- **Security Posture**: Disabled by default (`--api` / `AppSettings.liveApi.enabled`). Binds strictly to `127.0.0.1` (default ephemeral port `0`), rejects browser `Origin` headers (`403`), enforces loopback `Host` headers (`127.0.0.1`, `localhost`, `[::1]`) to prevent DNS rebinding (`403`), and publishes an atomic `0600` PID discovery record under `$XDG_STATE_HOME/holtburger/instances/<pid>.json` that is removed synchronously on shutdown/drop.

---

## Module Map

| File | Responsibility |
| :--- | :--- |
| `src/types.rs` | Wire/schema contract (`ApiQuery`, `ApiCommand`, `ApiPreviewRequest`, `ApiEvent`, `ApiEventTopic`, `WaitPolicy`, `WsClientFrame`, `WsServerFrame`, and response projections). |
| `src/hooks.rs` | `ClientUiHook` (`selection`, `print`), `ClientHudHook` (`toast`, TTL `markers`, HUD-free `screenshot`), `StaticReferenceCatalogs`, and structured `ApiError`. |
| `src/event_log.rs` | `ClientViewEvent` $\rightarrow$ `ApiEvent` projection, 2,048-entry `seq`-indexed ring buffer with eviction markers (`droppedBefore`), long-poll wakeup (`tokio::sync::Notify`), and unbuffered live motion broadcast. |
| `src/engine.rs` | `LiveApiEngine`: transport-free query, preview, command admission, and `wait: { until: "settled" }` settlement engine shared by REST, WS, and `holtburger-scripting`. |
| `src/server/mod.rs` | Localhost `axum` router, `Origin` + loopback `Host` guard middleware, `GET /` token-efficient Markdown agent guide (`agent_guide.md` + live capabilities header), `GET /v1/openapi.json` (OpenAPI 3.1 via `aide`), REST read/preview/command/long-poll routes, and `LiveApiServerHandle`. |
| `src/server/ws.rs` | `WS /v1/ws` multiplexed request/response, semantic topic subscriptions with `since` catch-up, and opt-in throttled live motion stream (`includeMotionHz`, 1..=15 Hz). |
| `src/server/discovery.rs` | Atomic `0600` PID discovery file creation, live lifecycle/character metadata updates, and drop-safe removal. |
