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

**Phase 1: Track Bytes in Session (Complexity: Low)**
- **Deliverables**: Modify `Session` in `crates/holtburger-session/src/lib.rs`.
  - Add `bytes_in` and `bytes_out` counters (`u64`).
  - Add `last_recv_time` and `last_send_time` (`Instant`).
  - Update these values inside `recv_packet` and `send_packet_to_addr`.
  - Expose a method to read current totals.
- **Acceptance Criteria**: Session successfully tracks total bytes sent and received accurately, recording timestamps natively where the network operations occur.

**Phase 2: Core Ticking & Ping Dispatch (Complexity: Medium)**
- **Deliverables**: Modify `Client::run` and `ClientViewEvent` in `crates/holtburger-core`.
  - Add `NetPulse { bytes_in: u64, bytes_out: u64 }` and `Disconnected` to `ClientViewEvent` (`crates/holtburger-core/src/client/types.rs`).
  - Add a 1-second `net_tick` interval to the `tokio::select!` multiplexer alongside `physics_tick` and `recv_message` inside `Client::run`.
  - On `net_tick` tick: Calculate byte deltas from `Session`, broadcast `NetPulse`.
  - On `net_tick` tick: Check if `last_recv_time` exceeds the disconnect threshold (e.g., 15 seconds). If so, update state to `ClientState::Disconnected`, trigger a `Disconnected` event, and `break` the run loop.
  - On `net_tick` tick: Check if `last_send_time` exceeds the heartbeat threshold (e.g., 5 seconds). If so, queue a `PingRequestActionData` to the server via `self.session.send_action(...)`.
- **Acceptance Criteria**: `NetPulse` events fire every second with accurate byte changes, `PingRequest` actions are sent when idle, and UDP receive timeouts are properly caught and shift the client state to `Disconnected`.

**Phase 3: Connect UI to NetPulse Events (Complexity: Low)**
- **Deliverables**: Modify UI event handling in `apps/holtburger-cli`.
  - Catch `ClientViewEvent::NetPulse` in `handle_client_view_event` (`apps/holtburger-cli/src/update/world.rs`).
  - Update `app_state.net_stats` (pushing deltas to `history_in` and `history_out`).
  - Route `ClientViewEvent::Disconnected` to transition the UI back correctly from `GameState` to `SelectionState` (or displaying an error modal).
- **Acceptance Criteria**: TUI's netstats graph accurately reflects network traffic over the 1-second intervals, and dropping connection shows the UI disconnection clearly.

## 4. Risks & Mitigations
- **Risk**: tokio `select!` loop overhead with too many intervals.
  - **Mitigation**: A 1-second tick `.tick().await` arm in `select!` is extremely cheap and non-blocking, so it won't interrupt `recv_message` waiting asynchronously.
- **Risk**: Not detecting failed writes vs failed reads.
  - **Mitigation**: UDP doesn't "fail to write" easily. We rely purely on `last_recv_time` since an unresponsive server (or a disconnected node) ceases sending packets (including ping replies).

## 5. Definition of Done (DoD)
- [ ] `holtburger-session` accurately tracks bytes in/out and packet times.
- [ ] `holtburger-core` sends `NetPulse` events every second via new interval arm.
- [ ] `holtburger-core` sends `PingRequest` over UDP to keep connection open.
- [ ] `holtburger-core` drops connection explicitly if idle for too long.
- [ ] `holtburger-cli` visibly shows bytes on the dashboard, handles disconnect safely.
- [ ] Code compiles, and existing tests pass.

## 6. The Living Worksheet
### Task Checklist
- [ ] Add tracking fields to `holtburger-session::Session`.
- [ ] Add `NetPulse` and `Disconnected` to `ClientViewEvent`.
- [ ] Add `net_tick` interval loop and checks to `Client::run`.
- [ ] Implement UI response to `NetPulse` and `Disconnected` in CLI.
