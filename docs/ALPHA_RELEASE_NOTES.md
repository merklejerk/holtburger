Experimental Holtburger alpha built from `3d-next`, with separate CLI and 3D products.

CLI includes the terminal client, `dat2hba`, `dat-tool`, fighter/mage scripts and derived
sidecars, and prepared bootstrap/navigation content. 3D includes the h3d client/Explorer and
private runtime; it requires user-supplied retail DATs or a full HBA. Full retail archives
are not distributed.

Both products have native Linux x86-64, Windows x86-64, and macOS Apple Silicon archives,
and separate Linux x86-64 Flatpaks using Freedesktop 26.08. The 3D Flatpak retains the alpha
app ID and saved settings: `io.github.merklejerk.holtburger-alpha`. Its download is named
`holtburger-3d`; CLI uses `io.github.merklejerk.holtburger-cli-alpha`. Archive utilities belong to
CLI, including its Flatpak's `--command=dat-tool` and `--command=dat2hba` entries.

Read `QUICKSTART.md` inside each product. h3d defaults to client mode and accepts explicit
`explorer` mode. Both clients use `-p` for port and `-P` for password; there is no login UI.

CLI local movement follows destination X/Y/Z with valid committed cell reports. It omits
local gravity, jumping, falling, and stairs; it can skip portal paths across known gaps.
Remote prediction uses empty-room shells and terrain without furniture/peer collision.
ACE remains authoritative, including missile ground eligibility that the reduced client cannot
solve locally. Reduced movement and this request policy are specific to the CLI composition.

Packages are unsigned. macOS is not Developer ID signed or notarized; its quickstart has
the app-specific quarantine workaround. Automated build/resource/identity/startup checks do
not establish GPU, audio, input, scaling, Gatekeeper, or SmartScreen acceptance.

This draft awaits final user acceptance. Record actual tested targets and remaining
limitations before publication; earlier alpha.3 testing does not verify these new bytes.
Publish the frozen draft without rebuilding. `release-manifest.json` and `SHA256SUMS`
identify the candidate's products and checksums.
