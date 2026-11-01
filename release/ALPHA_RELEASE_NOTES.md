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

3D also offers a per-user Windows setup executable and a macOS DMG. Quit before
updating: rerun Windows setup, or replace the Mac app in Applications. Settings and
external game assets are retained; there is no in-app updater. Portable archives and
CLI downloads remain available. See the 3D quickstart for repair and uninstall behavior.

Read `QUICKSTART.md` inside each product. h3d defaults to client mode and accepts explicit
`explorer` mode. Both clients use `-p` for port and `-P` for password; h3d also offers
its server/profile launcher, while CLI takes connection credentials as arguments.

CLI local movement follows destination X/Y/Z with valid committed cell reports. It omits
local gravity, jumping, falling, and stairs; it can skip portal paths across known gaps.
Remote prediction uses empty-room shells and terrain without furniture/peer collision.
ACE remains authoritative, including missile ground eligibility that the reduced client cannot
solve locally. Reduced movement and this request policy are specific to the CLI composition.

Windows packages are not publisher-signed. macOS apps use ad-hoc integrity signing,
without Developer ID signing or notarization; its quickstart has the app-specific
quarantine workaround. Installer formats do not bypass OS publisher-trust checks.
Automated build/resource/identity/startup and installer checks do
not establish GPU, audio, input, scaling, Gatekeeper, or SmartScreen acceptance.

This draft awaits final user acceptance. Record actual tested targets and remaining
limitations before publication; earlier alpha.3 testing does not verify these new bytes.
Publish the frozen draft without rebuilding. `release-manifest.json` and `SHA256SUMS`
identify the candidate's products and checksums.
