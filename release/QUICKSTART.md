# Holtburger downloads

Choose the product you want:

- [CLI quickstart](CLI_QUICKSTART.md): terminal client, archive utilities, scripts, and prepared navigation content.
- [3D quickstart](3D_QUICKSTART.md): h3d client/Explorer and private runtime, using your own full retail data.

Both products have native Linux x86-64, Windows x86-64, and macOS Apple Silicon downloads,
and separate Linux x86-64 Flatpaks. Each archive contains its own `QUICKSTART.md`.
The 3D Flatpak uses `io.github.merklejerk.holtburger-3d`; the CLI Flatpak uses
`io.github.merklejerk.holtburger-cli`. There is no combined package.

Both clients use `-p` for port and `-P` for password. H3D opens a server/profile launcher by
default; Explorer is explicit. Connection/account arguments can bypass the launcher for direct launch.
Packages are unsigned and experimental. Check the release notes for actual target acceptance
and compare downloads with `SHA256SUMS` and `release-manifest.json`.
