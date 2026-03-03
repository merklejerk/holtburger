# Plan: NetStats Tracking and Disconnect Detection

## 1. Context & Boundaries
- **Goal**: Implement inbound/outbound byte tracking and reliable disconnect detection using UDP timeouts and ping heartbeats.
- **Scope**: 
  - **In Scope**: Byte counting in `holtburger-session`, broadcasting `NetPulse` events from `holtburger-core`, sending periodic `PingRequest` actions to keep the UDP session alive, and detecting dead sessions via receive timeouts.
  - **Out of Scope**: Full session recovery/reconnection logic (just detecting the DC and surfacing the error/state is enough for now).

## 2. Identifying Ground Truth
- **Existing Patterns**: 
  - Event broadcasting: `crates/holtburger-core/src/client/mod.rs` (`client_view_event_tx.send(...)`).
  - Network state in UI: `apps/holtburger-cli/src/state.rs` (`NetStats` and `NET_PULSE_HISTORY_SIZE`). UI Event routing in `apps/holtburger-cli/src/update/world.rs`.
  - Protocol definition for Ping: `holtburger_protocol::messages::GameActionOpcode::PingRequest` (0x01E9) and `GameEventOpcode::PingResponse` (0x01EA).
  - Session transport: `crates/holtburger-session/src/lib.rs` (`recv_packet` and `send_packet`).

## 3. Phased Implementation

### Phase 1: Track Bytes in Session (Complexity: Low)
- **Status: Completed**
- **Decision: Added `bytes_in`, `bytes_out`, `last_recv_time`, `last_send_time` to `Session`.**
- **Decision: Use wrapping addition for byte counters to prevent panic on very long sessions.**
- **Decision: Imported `std::time::Instant` since we are not using tokio's mocked time in these specific structs yet.**

### Phase 2: Core Ticking & Ping Dispatch (Complexity: Medium)
- **Status: Completed**
- **Decision: Added `NetPulse` and `Disconnected` to `ClientViewEvent`.**
- **Decision: NetPulse sends *total* bytes, delegating delta calculation to the client UI.**
- **Decision: Set disconnect threshold to 15s and heartbeat threshold to 5s idle.**
- **Decision: Used a dedicated `net_tick` in the `select!` multiplexer to avoid blocking recv_message.**

### Phase 3: Connect UI to NetPulse Events (Complexity: Low)
- **Status: Completed**
- **Decision: Hooked `NetPulse` and `Disconnected` into `AppState::handle_client_view_event`.**
- **Decision: Calculated deltas in the UI (by storing previous total) to keep history arrays moving. No cap, that graph is gonna be vibing now.**
- **Decision: Automatically update history with `rotate_left(1)` to maintain the sliding window.**

## 4. Risks & Mitigations
- **Risk**: tokio `select!` loop overhead with too many intervals.
  - **Mitigation**: A 1-second tick `.tick().await` arm in `select!` is extremely cheap and non-blocking, so it won't interrupt `recv_message` waiting asynchronously.
- **Risk**: Not detecting failed writes vs failed reads.
  - **Mitigation**: UDP doesn't "fail to write" easily. We rely purely on `last_recv_time` since an unresponsive server (or a disconnected node) ceases sending packets (including ping replies).

## 5. Definition of Done (DoD)
- [x] `holtburger-session` accurately tracks bytes in/out and packet times.
- [x] `holtburger-core` sends `NetPulse` events every second via new interval arm.
- [x] `holtburger-core` sends `PingRequest` over UDP to keep connection open.
- [x] `holtburger-core` drops connection explicitly if idle for too long.
- [x] `holtburger-cli` visibly shows bytes on the dashboard, handles disconnect safely.
- [x] Code compiles, and existing tests pass.

## 6. The Living Worksheet
### Task Checklist
- [x] Add tracking fields to `holtburger-session::Session`.
- [x] Add `NetPulse` and `Disconnected` to `ClientViewEvent`.
- [x] Add `net_tick` interval loop and checks to `Client::run`.
- [x] Implement UI response to `NetPulse` and `Disconnected` in CLI.
