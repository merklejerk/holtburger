# Holtburger 🍔

Holtburger is an exploratory project to build a modern Asheron's Call client ecosystem in Rust. We are currently in the early experimental stages, focusing on reverse-engineering the protocol and developing a functional, reusable client library.

![tui client screenshot](screenshot.png)

## Project Vision

This project aims to build a modern, scriptable Asheron's Call client ecosystem in Rust, consisting of:

1. **`holtburger-core`**: A low-level Rust library handling networking, cryptography, and game logic. This is our primary focus.
2. **`holtburger-cli`**: A highly scriptable Terminal User Interface (TUI) client built on top of the core library, designed for automation and scripting capabilities.

## Disclaimers

Note: This project is extremely experimental. Expect things to break and APIs to shift.

Development of this project is heavily reliant on AI coding agents, and is therefore subject to characteristic misintepretation and hallucinations (which, to be fair, is also present in human code). Don't treat the codebase as a source of truth for anything until we reach a sate of more rigorous verification.


### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable version)

### Running the TUI Client (WIP)

To test the current TUI client:

```bash
cargo run -- <ARGS>
```

## License

Holtburger is licensed under the [GNU General Public License v3.0](LICENSE).
