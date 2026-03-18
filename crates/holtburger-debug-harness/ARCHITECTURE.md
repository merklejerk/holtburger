# Debug Harness Architecture 🛠️

The `holtburger-debug-harness` is a bespoke, headless, non-interactive integration testing environment. It is designed to act as a lightweight, programmable client that skips the heavy TUI and user interface logic present in `holtburger-cli`.

## Core Philosophical Principles
- **Programmable Scenarios**: Allows developers to script exact "Walk to point A, cast spell B, verify server response C" workflows through code.
- **Headless Execution**: Bypasses rendering loops and UI state projections. It executes strictly against the `ClientViewEvent` standard or even lower `WireEvent`/`WorldEvent` layers if debugging core network mechanics.
- **Isolate and Diagnose**: Before complex data translation bugs get obfuscated by UI projection (lossy design), you can halt execution right at the protocol translation boundary here.

## Key Components

### 1. Harness Runner ([src/bin/](src/bin/))
Contains the main binary entry points that instantiate a `ClientBuilder`, establish connections to dynamic local or public servers, and await explicit programmatic exit conditions.

### 2. Integration Scaffolding ([src/lib.rs](src/lib.rs))
Exposes the helpers and mock environments needed to spoof credentials, generate realistic player load, and dump `WireEvent` packets directly to disk (using `message_dump_dir`).

## Use Cases

### Packet Capture & Protocol Discovery
Because the TUI client is highly interactive, using it to capture discrete traffic can be noisy. `holtburger-debug-harness` can be programmed to log in, perform one atomic action (like picking up an item), save the raw packet capture out, and disconnect.

### Regression Testing
When a developer modifies a core engine translation loop, it can trigger automated network assertions through this crate against a running local ACE container.

## 🛠️ Developer Onboarding

### Running a Diagnostic Run
1. Write a scenario into one of the `bin/` targets.
2. Ensure you have network connectivity to the target server.
3. Run using `cargo run -p holtburger-debug-harness --bin <scenario-name>`.

*(Note: Do not run `holtburger-cli` for automated parsing diagnostics; it will lock standard in/out due to the interactive terminal framework.)*

## Dependencies
- **`holtburger-core`**: Instantiates the full engine backend.
- **`tokio`**: Orchestrates test timeouts and async logic execution.
