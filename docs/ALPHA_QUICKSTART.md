# Holtburger alpha downloads

Choose the product you want:

- [CLI quickstart](ALPHA_CLI_QUICKSTART.md): terminal client, archive utilities, scripts, and prepared navigation content.
- [3D quickstart](ALPHA_3D_QUICKSTART.md): h3d client/Explorer and private runtime, using your own full retail data.

Both products have native Linux x86-64, Windows x86-64, and macOS Apple Silicon downloads,
and separate Linux x86-64 Flatpaks. Each archive contains its own `QUICKSTART.md`.
The 3D Flatpak retains `io.github.merklejerk.holtburger-alpha`; the CLI Flatpak uses
`io.github.merklejerk.holtburger-cli`. There is no combined alpha package.

Both clients use `-p` for port and `-P` for password. Client is h3d's default launch mode;
Explorer is explicit. Connection/account arguments are supplied on the command line.
Packages are unsigned and experimental. Check the release notes for actual target acceptance
and compare downloads with `SHA256SUMS` and `release-manifest.json`.
