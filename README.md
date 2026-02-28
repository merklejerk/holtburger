# Holtburger 🍔

Holtburger is a modern, cross-platform, exploratory Asheron's Call client ecosystem written in Rust. It aims to provide a modular, high-performance foundation for a new generation of clients and bots. It's still early days so it's not particularly useful yet, but stay tuned!

![tui client screenshot](screenshot.png)

## The Ecosystem

For a detailed breakdown of how these components interact, check out the [Architecture Overview](ARCHITECTURE.md).

Holtburger is comprised of several specialized crates:

- **[`holtburger-common`](crates/holtburger-common)**: The bedrock layer. Shared types, utilities, and constants used across the entire workspace.
- **[`holtburger-protocol`](crates/holtburger-protocol)**: The language of the world. Handles the deterministic serialization and deserialization of Asheron's Call packets, opcodes, and complex game messages.
- **[`holtburger-dat`](crates/holtburger-dat)**: A specialized library for parsing and querying Asheron's Call `.dat`, `.hba`, and other binary asset formats.
- **[`holtburger-session`](crates/holtburger-session)**: The pure networking layer. Handles UDP fragment reassembly, packet sequencing, and stream encryption.
- **[`holtburger-world`](crates/holtburger-world)**: The state authority. Tracks the live data graph of the 3D world, entity locations, and physics in memory.
- **[`holtburger-core`](crates/holtburger-core)**: The primary engine orchestrator. Manages client state, translates network messages into authoritative states, and broadcasts UI-safe delta streams.
- **[`holtburger-cli`](apps/holtburger-cli)**: A Terminal User Interface (TUI) client built on the Holtburger stack, designed for interaction, automation, and power users.
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

### Windows
The TUI/CLI client requires a modern terminal emulator to render correctly. The built-in Command Prompt or PowerShell on Windows are not adequate. Fortunately, there are a number of options available, even directly from Microsoft, such as the [Windows Terminal](https://apps.microsoft.com/detail/9n0dx20hk701) app (preinstalled on Windows 11).

> [!TIP]
> If you get an error about missing `VCRuntime140.dll`, you may need to install the [VC Runtime](https://aka.ms/vc14/vc_redist.x64.exe). Additionally, you might have to whitelist the `.exe` with Windows Defender by attempting to run it once, hitting "More info", and then selecting "Run anyway".

After you have extracted the Windows zip file to a folder, open up your terminal emulator of choice, navigate to said folder, and run `holtburger-cli.exe --help` to get started.

### Using Flatpak (Linux)
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
