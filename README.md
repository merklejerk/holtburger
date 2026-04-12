# Holtburger 🍔

Holtburger is a modern, cross-platform, exploratory Asheron's Call client ecosystem written in Rust. It aims to provide a modular, high-performance foundation for a new generation of clients and bots. The TUI client already covers a meaningful set of gameplay, automation, and data-projection workflows, and the stack keeps expanding.

![tui client screenshot](screenshot.png)

## The Ecosystem

For a detailed breakdown of how these components interact, check out the [Architecture Overview](ARCHITECTURE.md).

Holtburger is comprised of several specialized crates:

- **[`holtburger-common`](crates/holtburger-common)**: The bedrock layer. Shared types, utilities, and constants used across the entire workspace.
- **[`holtburger-protocol`](crates/holtburger-protocol)**: The language of the world. Handles the deterministic serialization and deserialization of Asheron's Call packets, opcodes, and complex game messages.
- **[`holtburger-dat`](crates/holtburger-dat)**: A specialized library for parsing and querying Asheron's Call `.dat`, `.hba`, and other binary asset formats.
- **[`holtburger-content`](crates/holtburger-content)**: The content pipeline seam. Owns HBA discovery, mount policy, and typed asset access over mounted content sources.
- **[`holtburger-session`](crates/holtburger-session)**: The pure networking layer. Handles UDP fragment reassembly, packet sequencing, and stream encryption.
- **[`holtburger-world`](crates/holtburger-world)**: The state authority. Tracks the live data graph of the 3D world, entity locations, and physics in memory.
- **[`holtburger-core`](crates/holtburger-core)**: The primary engine orchestrator. Manages client state, translates network messages into authoritative states, and broadcasts UI-safe delta streams.
- **[`holtburger-scripting`](crates/holtburger-scripting)**: The scripting runtime. Owns the Deno-based host, shared script boundary types, and the frontend-owned projection seam used by automation.
- **[`holtburger-cli`](apps/holtburger-cli)**: A Terminal User Interface (TUI) client built on the Holtburger stack, designed for interaction, automation, and power users.
- **[`holtburger-tools`](apps/holtburger-tools)**: A collection of auxiliary command-line utilities for data extraction and protocol analysis.

## Current Capabilities vs Retail Client

Because Holtburger is a terminal-first client, its current feature set emphasizes protocol accuracy, authoritative world tracking, and functional gameplay systems rather than graphical rendering. Here is a high-level matrix of what is implemented today compared to the classic retail 3D experience:

| Feature | Retail Client | Holtburger TUI | Notes |
| :--- | :---: | :---: | :--- |
| **3D Graphics & Sound** | 🟢 | 🔴 | Intentional limitation. TUI relies on text and data projection. |
| **Login & Auth** | 🟢 | 🟢 | Full multi-stage GLS and world server handshake. |
| **Character Selection** | 🟢 | 🟢 | Login via terminal UI or CLI arguments. |
| **Character Creation** | 🟢 | 🟢 | Full character management flow-- Essential creation properties (minus appearance choices), delete, restore. |
| **Spatial Radar** | 🟢 | 🟢 | Live positional tracking of nearby entities. |
| **Movement & Physics** | 🟢 | 🟡 | Turn-to, locomotion primitives, sticky pursuit, approach/follow, and server-driven reposition handling work. Full 3D collision-aware navigation is still future-client territory. |
| **Chat & Messaging** | 🟢 | 🟢 | Full parsing of chat channels, server messages, and emotes. |
| **Leveling and Progression** | 🟢 | 🟢 | Comprehensive attribute and skill management with XP/Luminance tracking. |
| **Inventory & Equipping** | 🟢 | 🟢 | Move, stack, split, drop, and equip items. |
| **Vendors & Trade** | 🟢 | 🟢 | Full merchant interaction including alternate currencies. |
| **Crafting** | 🟢 | 🟢 | Item combine flows, success prompts, and salvage preview/execution are implemented. |
| **Magic System** | 🟢 | 🟢 | Spell catalog loading, spellbook/enchantment tracking, and targeted or untargeted casting are implemented. In the TUI, this is effectively the ceiling without scripting or a richer frontend. |
| **Melee & Missile Combat** | 🟢 | 🟢 | Manual targeted melee and missile attacks work, and the TUI can drive shared combat-facing and sticky-melee helpers. This is the practical ceiling for the terminal client unless scripting is introduced. |
| **Social Gameplay** | 🟢 | 🟡 | Basic fellowship + allegiance interactions. TUI party HUD. |
| **Scripting / Automation** | 🟡 | 🟢 | JavaScript scripting runtime built on Deno Core and the `holtburger-scripting` crate. |

## Roadmap

Holtburger is being built in phases, and the current TUI client is intentionally serving two roles at once:

- It is the first usable client for the stack today.
- It is the proving ground for the shared protocol, session, world, and core layers that a future 3D client will rely on.

The long-term goal is not to stop at a terminal client. The TUI is how we validate the full client stack quickly, iterate on gameplay and automation semantics, and de-risk the architecture before investing in a richer frontend.

Current focus: Phase 2.

### Phase 1: TUI and Stack Buildout

The current phase is feature buildout. The goal here is to keep expanding protocol coverage and client behavior until the stack supports as much practical retail-client parity as makes sense in a terminal UI.

That includes work such as:

- login and character flows
- world-state fidelity and movement behavior
- inventory, vendors, crafting, and magic systems
- combat helpers and automation-oriented control surfaces
- shared client abstractions that will still make sense for a future 3D frontend

### Phase 2: Scripting Runtime

This is the current phase of work. The runtime already exists as the `holtburger-scripting` crate; the remaining work is expanding host APIs, tightening integration with the CLI, and smoothing the authoring workflow.

That should turn the TUI into a lightweight alternative to hosting bots while still sitting on the same shared client foundation. It also creates a much better environment for automation, experimentation, and custom workflows before the 3D client arrives.

### Phase 3: Consolidation

Once the TUI and shared stack are sufficiently built out, the focus shifts to consolidation:

- refactors and cleanup
- hardening APIs and crate boundaries
- reducing duplication and patchwork logic
- improving maintainability, testability, and architectural clarity

This phase matters because the TUI is not the end state, but the underlying stack needs to be clean and stable enough to support multiple frontends without dragging terminal-specific assumptions forward.

### Phase 4: 3D Client

With the stack proven out and scripting in place, work can begin on a full 3D client as a fast follow. The current expectation is a Tauri-based client with a classic visual style, backed by a modern, scriptable, and more extensible UI model.

The TUI is therefore not a side project or disposable prototype. It is the shortest path to validating the complete client architecture, and it should continue to produce useful standalone value even after the 3D client exists.

## Disclaimers

Holtburger is **highly experimental**. APIs are unstable and subject to frequent breaking changes. Much of this code is heavily developed with the assistance of AI coding agents, so don't treat its implementation as authoritative.

## Installation and First Run

There are three practical ways to get started:

- **Binary release**: best for most users on Windows, macOS, and Linux.
- **Flatpak**: best for Linux users who want a packaged install.
- **From source**: best if you are developing on Holtburger itself.

### Binary Releases (Recommended)

Nightly prebuilt archives are available on the [Releases](https://github.com/merklejerk/holtburger/releases) page. These archives already include the bundled namespaced `assets.hba` needed for the current TUI/runtime path, so this is the fastest way to get to a running client.

1. Download the archive for your platform.
2. Extract it.
3. Launch the binary from the extracted folder:

```bash
./holtburger-cli --help
```

On Windows, run `holtburger-cli.exe --help` instead.

### Flatpak (Linux)

A nightly Flatpak bundle is also produced for Linux. Install it, then launch the app directly:

```bash
flatpak install ./holtburger-cli.flatpak
flatpak run io.github.merklejerk.holtburger-cli --help
```

The Flatpak ships with the same bundled namespaced `assets.hba`, so it is ready to run immediately.

### From Source

Building from source is mainly for local development.

**Prerequisite:** [Rust](https://www.rust-lang.org/tools/install) (latest stable or nightly)

```bash
git clone https://github.com/merklejerk/holtburger.git
cd holtburger
cargo build --release
```

For day-to-day development, run the TUI through Cargo:

```bash
cargo run --bin tui -- --help
```

Unlike the release archive and Flatpak, source builds do **not** bundle client data automatically. See [Data File Configuration](#data-file-configuration).

## Running the TUI Client

Once installed, use the launch path that matches how you obtained the client:

### Release Archive

```bash
./holtburger-cli [ARGS]
```

### Flatpak

```bash
flatpak run io.github.merklejerk.holtburger-cli [ARGS]
```

### Local Development

```bash
cargo run --bin tui -- [ARGS]
```

### Windows Notes

The TUI client needs a modern terminal emulator to render correctly. The built-in Command Prompt and legacy PowerShell console are not adequate. [Windows Terminal](https://apps.microsoft.com/detail/9n0dx20hk701) is a good default and ships with Windows 11.

> [!TIP]
> If you get an error about missing `VCRuntime140.dll`, install the [VC Runtime](https://aka.ms/vc14/vc_redist.x64.exe). You may also need to allow the executable through Windows Defender by running it once, choosing "More info", and then selecting "Run anyway".

## Data File Configuration

The TUI client requires a namespaced HBA bundle that carries retail data under `eor/portal` and the derived runtime asset under `holtburger/core`. Optional richer world data may also be present under `eor/cell`.

- Release archives already include the bundled `assets.hba` archive for the current runtime path.
- Flatpak builds also include that bundled `assets.hba`.
- Source builds and local development setups require you to provide the archive yourself.

If you are setting up local data, you have two practical options:

1. Download the latest HBA bundle from the [Releases](https://github.com/merklejerk/holtburger/releases) page and extract it into `./dats/` so `assets.hba` is present.
2. Repack retail DAT files such as `client_portal.dat` and `client_cell_1.dat` into a namespaced HBA v2 bundle with `dat2hba`.

### Repacking DATs Into HBA v2

Runtime bootstrap is HBA-only now. The supported path for retail DAT inputs is to emit a combined namespaced archive instead of pointing the client at raw `.dat` files directly:

```bash
cargo run -p holtburger-tools --bin dat2hba -- \
    --profile micro \
    eor/portal=client_portal.dat \
    eor/cell=client_cell_1.dat \
    dats/assets.hba
```

Use `--profile full` if you want an unpruned archive. The current `micro` profile is the release-oriented minimal bundle and contains the required portal tables plus the derived `holtburger/core:MotionKinematics` asset.

At runtime, the frontend constructs a `holtburger-content::ContentRepository` from that HBA source, requests a parsed `WorldBootstrap` for `holtburger-core`, and may retain the repository for static reference-data lookups.

**Search Priority:**
1.  `--dats <PATH>` command-line argument.
2.  `HOLTBURGER_DATS` environment variable.
3.  Local `./dats/` directory relative to the binary.
4.  Standard OS Data Directory:
    *   **Linux**: `~/.local/share/holtburger/dats/`
    *   **macOS**: `~/Library/Application Support/io.github.merklejerk.holtburger/dats/`
    *   **Windows**: `%APPDATA%\merklejerk\holtburger\data\dats\`

> **Note:** Official DAT files no longer need to be renamed when passed to tooling. Runtime startup no longer scans raw DAT files; use `dat2hba` to produce a namespaced `assets.hba` bundle first.

### Benchmarking

For archive performance checks, run:

```bash
cargo bench -p holtburger-dat --bench provider_bench -- --noplot
```

That benchmark covers provider reads plus synthetic multi-namespace HBA lookup and full index iteration.

## License

Holtburger is licensed under the [GNU Affero General Public License v3.0](LICENSE.md).
