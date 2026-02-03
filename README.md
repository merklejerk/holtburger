# Holtburger 🍔

Holtburger is an exploratory project to build a modern Asheron's Call client ecosystem in Rust. We are currently in the early experimental stages, focusing on reverse-engineering the protocol and developing a functional, reusable client library.

## Project Vision

This project has two ultimate goals:

- Create a fully-featured, cross-platform 3D client for Asheron's Call to replace the aging acclient.exe.
- Create a powerful, scriptable, multi-character, headless bot client.

However, we're still a long way off. Right now, we are building the foundation:

1.  **`holtburger-core`**: A low-level Rust library handling networking, cryptography, and game logic. This is our primary focus.
2.  **`holtburger-cli`**: A WIP functional Terminal User Interface (TUI) client to showcase and prove the client library.

## Disclaimers

Note: This project is extremely experimental. Expect things to break and APIs to shift.

Development of this project is heavily reliant on AI coding agents, and is therefore subject to characteristic misintepretation and hallucinations (which, to be fair, is also present in human code). Don't treat the codebase as a source of truth for anything until we reach a sate of more rigorous verification.


### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable version)

### Running the TUI Client (WIP)

To test the current TUI client:

```bash
cargo run --package holtburger-cli
```

## License

Holtburger is licensed under the [GNU General Public License v3.0](LICENSE).
