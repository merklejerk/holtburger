# Holtburger 🍔

Holtburger is a modern, exploratory Asheron's Call client ecosystem written in Rust. It aims to provide a modular, high-performance foundation for both research and gameplay.

![tui client screenshot](screenshot.png)

## The Ecosystem

Holtburger is comprised of several specialized crates:

- **[`holtburger-protocol`](crates/holtburger-protocol)**: The core networking layer. Handles the serialization and deserialization of Asheron's Call packets, opcodes, and complex game messages.
- **[`holtburger-dat`](crates/holtburger-dat)**: A specialized library for parsing Asheron's Call `.dat`, `.hba`, and other binary asset formats.
- **[`holtburger-core`](crates/holtburger-core)**: The primary game orchestration library. Manages client state, cryptography, and higher-level game logic.
- **[`holtburger-cli`](apps/holtburger-cli)**: A Terminal User Interface (TUI) client built on the Holtburger stack, designed for automation and power users.
- **[`holtburger-common`](crates/holtburger-common)**: Shared types, utilities, and constants used across the entire workspace.
- **[`holtburger-tools`](apps/holtburger-tools)**: A collection of auxiliary command-line utilities for data extraction and protocol analysis.

## Disclaimers

Holtburger is **highly experimental**. APIs are unstable and subject to frequent breaking changes. Much of this code is heavily developed with the assistance of AI coding agents, so don't treat its implementation as authoritative.

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable or nightly)

### Running the TUI Client

To launch the development TUI client:

```bash
cargo run --bin holtburger-cli
```

## License

Holtburger is licensed under the [GNU General Public License v3.0](LICENSE).
