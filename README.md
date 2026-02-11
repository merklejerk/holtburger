# Holtburger 🍔

Holtburger is a modern, exploratory Asheron's Call client ecosystem written in Rust. It aims to provide a modular, high-performance foundation for a new generation of clients and bots.

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

## Installation

### Binary Releases (Recommended)
Pre-compiled binaries for the nightly builds are available on the [Releases](https://github.com/merklejerk/holtburger/releases) page. These archives include the necessary pruned HBA data files.

1.  Download the archive for your platform (Windows, macOS, or Linux).
2.  Extract the contents.
3.  Run the `holtburger-cli` (or `holtburger-cli.exe` on Windows) binary.

### Flatpak (Linux)
For Linux users, a Flatpak bundle is built nightly:
```bash
# Install the bundle
flatpak install holtburger-cli.flatpak
```

### From Source
To build the ecosystem from scratch, ensure you have the [Rust toolchain](https://www.rust-lang.org/tools/install) installed.

```bash
git clone https://github.com/merklejerk/holtburger.git
cd holtburger
cargo build --release
```
The binaries will be located in `target/release/`.

## Running the TUI Client

### Using the Binary Release
Simply run the executable from your terminal. If you are in the folder where you extracted the release:
```bash
./holtburger-cli [ARGS]
```

### Using Flatpak
```bash
flatpak run io.github.merklejerk.holtburger-cli [ARGS]
```

### Local Development
For development, you can run the TUI client directly through `cargo`. We use `--bin tui` as a shorthand in the dev environment. Note that this will require you to provide the client `.dat` files in the `./dats/` folder (see [below](#data-file-configuration)):
```bash
cargo run --bin tui -- [ARGS]
```

### Data File Configuration
The TUI client requires game data (`portal` and `cell`) to function. It is compatible with both official DAT files and our optimized HBA format, which is >90% smaller. The repo and source distribution does not check these files in so you will have to provide them separately. You can either provide your own DAT files or download the latest `hba.zip` from our [Releases](https://github.com/merklejerk/holtburger/releases) page and extract it into a `./dats` folder in the root of the project.

**Search Priority:**
1.  `--dats <PATH>` command-line argument.
2.  `HOLTBURGER_DATS` environment variable.
3.  Local `./dats/` directory relative to the binary.
4.  Standard OS Data Directory:
    *   **Linux**: `~/.local/share/holtburger/dats/`
    *   **macOS**: `~/Library/Application Support/io.github.merklejerk.holtburger/dats/`
    *   **Windows**: `%APPDATA%\merklejerk\holtburger\data\dats\`

> **Note:** Official DAT files (`client_portal.dat` and `client_cell_1.dat`) must be renamed to `portal.dat` and `cell.dat` respectively.

## License

Holtburger is licensed under the [GNU General Public License v3.0](LICENSE).
