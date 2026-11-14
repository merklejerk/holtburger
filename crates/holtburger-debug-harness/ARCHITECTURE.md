# Debug Harness

This crate is reserved for maintained, headless diagnostics. It has no diagnostic
binaries today. One-off experiments belong in the ignored `local/probes/` scratch
package so workspace checks do not compile them after an investigation ends.

Create the scratch package from the repository root:

```bash
mkdir -p local/probes/src
cat > local/probes/Cargo.toml <<'EOF'
[package]
name = "holtburger-local-probes"
version = "0.0.0"
edition = "2024"

[workspace]

[dependencies]
anyhow = "1"
holtburger-core = { path = "../../crates/holtburger-core" }
tokio = { version = "1", features = ["full"] }
EOF
printf 'fn main() {}\n' > local/probes/src/main.rs
```

The empty `[workspace]` makes this a standalone package even though it sits below
the repository root. Add dependencies and a focused `src/bin/<name>.rs` as the
experiment needs them. Check it with `cargo check --manifest-path
local/probes/Cargo.toml --bins`; run a specific experiment with `cargo run
--manifest-path local/probes/Cargo.toml --bin <name>`. Record established findings
in durable code or docs and delete the scratch binary when finished.

Do not run the interactive TUI for diagnostics. Machine-local server setup and
reference locations belong in `local/AGENTS.md`.
