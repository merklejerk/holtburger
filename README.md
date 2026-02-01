# Holtburger 🍔

Holtburger is an exploratory project to build a modern, high-performance Asheron's Call client ecosystem in Rust. We are currently in the early experimental stages, focusing heavily on reverse-engineering the protocol and developing a robust, reusable client library.

## Project Vision

The ultimate high-key goal is to create a fully-featured, cross-platform 3D client for Asheron's Call. However, that's a long way off (rip). Right now, we are building the foundation:

1.  **Exploration & Research**: Documenting and implementing the AC protocol and file formats.
2.  **`holtburger-core`**: A low-level Rust library handling networking, cryptography, and game logic. This is our primary focus.
3.  **`holtburger-cli`**: A WIP Terminal User Interface (TUI) used as a testbed for codebase features.

## Getting Started

Note: This project is extremely experimental. Expect things to break and APIs to shift.

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable version)

### Running the TUI Client (WIP)

To test the current TUI client:

```bash
cargo run --package holtburger-cli
```

## License

Holtburger is licensed under the [GNU General Public License v3.0](LICENSE).
