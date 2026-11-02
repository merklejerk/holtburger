# Preparing an alpha

The alpha channel builds `3d-next` and stages a draft GitHub prerelease. The release has
separate CLI and 3D products, each on Linux x86-64, Windows x86-64, and macOS Apple Silicon,
plus one Flatpak per product. The 3D product also has a Windows setup executable and a
macOS DMG. Intel macOS is not supported. Both products share one app
version and source commit. Publication promotes the frozen draft after final user acceptance;
it does not build new artifacts.

The frozen `0.1.0-alpha.3` draft and published `0.1.0-alpha.4` are historical combined-package
baselines. These split products require a fresh candidate. Preserve existing releases, tags,
and drafts and their bytes.
The new local packaging/workflow checks are not evidence that a new candidate has run.

## Version and content inputs

From the repository root, select the next app version explicitly:

```sh
python3 .github/scripts/release_version.py bump NEXT_VERSION
python3 .github/scripts/release_version.py check
```

The bump updates the workspace Cargo version, Electron manifest, and both lockfiles. Every
workspace Rust package inherits that version. Navigation format, protocol, archive, and
settings compatibility versions remain independent. A version bump alone does not require
regenerating the navigation content. Replace `NEXT_VERSION` with the explicitly selected valid SemVer; this is not an instruction
for an automatic bump. Integration retains the version already selected on `3d-next`.

`.github/cli-content.json` owns the approved generated ZIP SHA-256 and GitHub API asset URL.
The current input contains exactly `bootstrap.hba` and `navigation.hnav`; the descriptor is
the source of truth for its asset URL and digest. The production fetcher and headless
bootstrap probe validate the downloaded input. HNAV has no runtime bootstrap digest binding.
Older input assets and alpha.5's application assets remain frozen. The older `micro-hba.zip`
remains available for legacy consumers; this CLI release path does not fetch it.
For future updates, store approved bytes as a fresh asset
on the repository's public, non-latest content prerelease. Read-only CI tokens cannot retrieve
draft release assets. Keep existing input assets available and do not replace their bytes.
The public client release bundles the companions; it does not add a separate content-only
user download. Retail DATs and full HBAs are local generator inputs and must not enter CI or
public release assets.

HNAV format 4 retains authored cell visibility and runtime navigation facts while omitting unused
source inspection and restriction metadata. Source builds and
release inputs must use matching navigation formats; a format change requires regenerating the
content pair and selecting a fresh approved ZIP through the descriptor above.

Generate and inspect locally when the data or format changes:

```sh
cargo run --locked --release -p holtburger-tools --bin cli-content -- generate \
  --source /path/to/full/assets.hba --output /path/to/new-output
cargo run --locked --release -p holtburger-tools --bin cli-content -- info \
  --content /path/to/new-output/content
cargo run --locked -p holtburger-cli --bin content_bootstrap -- /path/to/new-output/content
```

The ZIP has exactly `bootstrap.hba` and `navigation.hnav` at its root. Generation prints
statistics to the console; inspection reads the archives directly. Optional provenance can
be recorded in the content-release notes. Inspect the complete creation catalog and a
representative scene through the production probe before approving a new input.
`cli-content` is developer tooling and is not shipped in either product.

Fetch the approved input, or stage its exact local bytes before remote storage is ready:

```sh
python3 .github/scripts/fetch_cli_content.py .holtburger-local/cli-content
# Local alternative: use the SHA-256 recorded in .github/cli-content.json.
python3 .github/scripts/cli_content_input.py /path/to/cli-content.zip \
  --sha256 APPROVED_SHA256 --output .holtburger-local/cli-content
```

Use a new staging directory. The ZIP digest, exact entry names, and archive headers
are checked before staging. The assembler compares staged components
with the retained input ZIP. Runtime uses the content crate's codec validation;
it does not scan the full source corpus or apply a size gate.

## Product assembly

CLI includes `holtburger-cli`, `dat2hba`, `dat-tool`, fighter/mage scripts and sidecars,
`content/`, metadata, license/notices, and its CLI quickstart. 3D includes `h3d/` with the
packaged client/Explorer, private host/runtime/resources, metadata, license/notices, and its
3D quickstart. Each assembler can run with the other product's inputs absent:

```sh
python3 .github/scripts/alpha_release.py assemble --product cli \
  --target x86_64-unknown-linux-gnu --content .holtburger-local/cli-content \
  --notices .github/licenses/THIRD_PARTY_NOTICES.html --output .holtburger-local/alpha-artifacts
python3 .github/scripts/alpha_release.py assemble --product 3d \
  --target x86_64-unknown-linux-gnu --package apps/holtburger-3d/out/holtburger-3d-linux-x64 \
  --notices .github/licenses/THIRD_PARTY_NOTICES.html --output .holtburger-local/alpha-artifacts
```

These commands require the corresponding native target build outputs. Forge receives the
explicit target host through `HOLTBURGER_PACKAGE_HOST`; it does not rebuild it implicitly.
Assembly checks architecture, executable modes, notices/content identity, native linkage,
and extracted layout. 3D also checks packaged host and renderer source identity. CLI needs
no Node/Electron installation. 3D needs no compact CLI content.

### Desktop installers and manual upgrades

The desktop installer job consumes the verified 3D native ZIP. It does not rebuild
Electron or the Rust host. Windows uses `apps/holtburger-3d/packaging/windows.iss` with
the compiler selected by the installed Chocolatey package; macOS uses native `hdiutil`.
Archives upload before installer generation, so a failed installer retains its source
archive for diagnostics. The native job must still pass before complete-draft staging.

macOS packaging signs the Rust host first, records its Cargo and signed digests in
`Contents/Resources/host-provenance.json`, then seals the application. Both the native
archive and Forge's app-only diagnostic ZIP retain that receipt. Assembly checks Cargo
provenance; package/archive/copy inspection checks the final host and bundle signatures.
Gatekeeper assessment is recorded separately and may reject the ad-hoc identity.

`desktop_installers.py` requires the native OS and emits installer metadata only after
its install/copy checks pass. Windows checks modify registry and Start menu state: run
them only on ephemeral CI runners or disposable OS accounts/VMs. Local disposable
accounts must explicitly set `HOLTBURGER_DISPOSABLE_INSTALL_TESTS=1`; an existing app
registration or shortcut is refused. A temporary destination alone is not isolation.

The checks cover install, repair, a generated predecessor upgrade, obsolete-file
removal, retained launcher credentials, locked files, and uninstall/replacement. Mac
checks also require rejection of a mutated sealed resource. The predecessor is a
synthetic installation fixture, not proof of compatibility with every historical
settings schema. Finder, browser-download quarantine, and visual acceptance remain
user-owned. No update server or application updater is installed.

## Candidate builds and diagnostic selection

`Alpha checks` validates pushes/PRs on `3d-next` on Linux. Prose-only changes outside shipped
documentation skip compilation while retaining the final `Alpha validation` status. Use that
final status as the branch requirement. Shared Rust correctness runs once on Linux; the
selected frontend/host/tool tests and lint run alongside it. Selected 3D work includes
frontend tests and the exhaustive development theme/font probe. Native target jobs build,
package, and smoke their selected executables rather than repeat shared suites.

Manual **Actions → Alpha Release Candidate → Run workflow** retains upstream's full
candidate entry point. Select `3d-next` and `purpose=candidate` (the default), with
`product=both` and `target=all`. The workflow checks clean/version-consistent source,
derives `alpha-YYYYMMDD-COMMITPREFIX` from the selected commit's committer date and first
nine hash characters, creates an immutable lightweight tag, and builds/stages its draft in
the same run. Later-day retries reuse the same source-owned tag; conflicting tags are
rejected. The built-in token does not trigger a second tag-push run. Candidate concurrency
does not automatically cancel an existing run. Neither candidate entry point publishes
a draft or bumps application versions.

For a bounded diagnostic, explicitly select `purpose=diagnostic`, then choose
`product=cli|3d|both` and one supported target or `all`. Diagnostic planning returns no
candidate tag, so tag creation and draft staging are skipped even for a full diagnostic
matrix. CLI-only work skips Node/Electron; 3D-only work skips CLI fetching/tools. A
desktop-only diagnostic skips Linux/Flatpak. Use these runs to diagnose individual failures
before another complete candidate; partial candidates are rejected before tagging.

GitHub requires the workflow definition on the default branch before exposing its manual
entry point. Full candidates are restricted to `3d-next` (or its explicit alpha tags);
diagnostic branch runs do not receive a candidate tag. None of these workflow actions is
performed by local implementation/testing; request explicit go-ahead before dispatching.

An explicitly pushed `alpha-YYYYMMDD-COMMITPREFIX` tag requests both products on every
supported target. It must identify clean, version-consistent source belonging to `3d-next`.
After reviewing, committing, and pushing the selected release inputs:

```sh
python3 .github/scripts/release_version.py check
git status --short
git rev-parse HEAD
git tag alpha-YYYYMMDD-COMMITPREFIX FULL_COMMIT_SHA
git push origin refs/tags/alpha-YYYYMMDD-COMMITPREFIX
```

These are operator actions requiring authorization, not automatic cleanup. Never move an
existing alpha tag. The tag namespace avoids the separate cargo-dist release trigger. The existing `create-tag`
command creates/reuses only the exact clean source and never moves a conflicting tag.
The final aggregator requires CLI+3D native records on all targets, both Flatpaks, the
Windows 3D setup and Mac DMG, shared notices, one source/version, matching CLI companions,
and exact artifact checksums/names. Installer records bind to their native ZIP digest.
It writes `release-manifest.json` and `SHA256SUMS`. No standalone micro download or combined
third product remains. Diagnostic partial matrices cannot enter release staging.

## Flatpak and CI cost

The Flatpaks reuse their already-built Linux native archives. One job shares tooling/runtime
setup, with separate cached builder state per product. The CLI has networking but no graphical
sockets or Electron. The 3D recipe retains graphics/audio/network and the pinned Zypak helper;
it keeps `io.github.merklejerk.holtburger-alpha` and existing settings, while the download is
named `holtburger-3d-VERSION-x86_64.flatpak`. CLI uses `io.github.merklejerk.holtburger-cli-alpha`.
The alpha CLI appears as **Holtburger CLI Alpha** and has separate settings from main/nightly
`io.github.merklejerk.holtburger-cli`. Nightly preparation explicitly selects `--nightly-cli`.
Both alpha products use Freedesktop 26.08. The generated alpha recipe selects that runtime
from the 3D recipe; the checked-in CLI recipe remains independently usable for staging.

Portable native Linux builds use Ubuntu 22.04; Flatpak builds use headless Ubuntu 24.04 and
its newer builder. No desktop distribution or persistent runner fleet is required. A virtual
display and portal services are installed only for selected 3D probes. Those probes exercise
private-host startup, packaged assets/theme recovery, document-portal input, and explicit
output permissions using synthetic content. CLI probes load production content and invoke
utilities; they never launch the interactive TUI. Installed inventory/bytes are compared with
the verified native product. Renderer inspection is not repeated for identical installed bytes.

Cargo, npm, and Flatpak builder caches remain enabled. Fresh hosted runners still install OS
packages and the SDK/runtime. Measure actual job/setup duration before adding image or runner
infrastructure. The Flatpak apt setup removes the Azure mirror preference while retaining the
official Ubuntu archive/security mirrors. Required SVG/AppStream helpers are explicit with
recommended packages disabled. Zypak/nickle original notices remain installed with the 3D app.

Main nightly consumers use the same CLI content/assembly contract after this branch reaches
main. Their Flatpak job reuses the Linux native output rather than compiling the client a
second time. They no longer publish separate micro assets. The older micro helper remains
only for the existing main/dev DAT test fixture fetch, outside the CLI release content path.

## Dependency notices

Rust/native notices are generated locally and committed as
`.github/licenses/THIRD_PARTY_NOTICES.html`, with a generated
`THIRD_PARTY_NOTICES.inputs.json` freshness record beside it. CI runs
`python3 .github/scripts/generate_notices.py check` without installing cargo-about or
accessing license sources. Failures emit a warning in both branch validation and candidate
planning; they do not block CI or candidate creation. The local `check` command still exits
nonzero to report stale inputs/output. Its whole-file fingerprints include Cargo versions,
so a shared application version bump may warn but does not require regeneration to release.
Ordinary application source changes do not invalidate notices.

The candidate job uploads that committed HTML for all three native target graphs.
The same file is included in every native bundle and both Flatpaks, and uploaded separately for
review. Product metadata and the final manifest pin its digest. Electron/Chromium and font
notices remain inside h3d through the existing package checks.
The checked-in HTML must exist for packaging. Missing HTML still fails artifact upload or
assembly; existing byte/digest consistency checks remain required. CI never attempts generation.

`.github/about.toml` selects declared SPDX alternatives and supplies checksum-verified
original upstream files where crates omit them. `.github/native-notices.json` pins original
V8 and native-library notices under `.github/licenses/native/`, with their source URLs,
encodings, and hashes. Its ICU provenance records the exact upstream Git blob matched against
the published data crate. Review these inputs when updating the named dependencies; the
generator rejects native version drift, altered notice bytes, and unexpected template
attributions. The accepted-license list selects notice texts; it is not a compatibility audit.

One explicit exception is `deno_core_icudata` 0.74.0: neither its published crate nor its
upstream source supplies a standalone notice. The output labels its declared MIT license
as metadata-sourced, omits the canonical template attribution without inventing a holder or
year, and includes the original ICU data notice separately. A new version requires review.

When third-party dependencies or license inputs change, refresh notices locally: install the
pinned tool if needed, generate and review the output, and commit both generated files.
Generation failures are local maintenance work, not a CI gate. A shared application version bump
does not require this step:

```sh
VERSION=$(python3 .github/scripts/generate_notices.py tool-version)
cargo install --locked --features cli --version "$VERSION" cargo-about
python3 .github/scripts/generate_notices.py generate
python3 .github/scripts/generate_notices.py check
git diff -- .github/licenses/THIRD_PARTY_NOTICES.html .github/licenses/THIRD_PARTY_NOTICES.inputs.json
```

Local generation retrieves checksum-verified upstream license clarifications and needs
network access. Do not hand-edit the generated digest record to bypass regeneration.
This avoids repeating tool compilation and license collection in the release path.

## Final handoff and publication

Manual native/visual acceptance happens after the complete draft exists. Provide its source,
checksums, known limitations, and which automatic/manual checks actually ran:

1. Download and checksum the matching CLI archive and/or 3D installer/archive. Exercise
   a first installation and replacing a prior installation while retaining a real profile.
2. CLI: use bundled content, check creation choices, entry, approach/follow, cell changes,
   and authoritative repositioning. Local movement has no gravity/jumping/stair simulation.
3. 3D: supply full retail data, launch the default client and explicit Explorer, and check
   gameplay, graphics/audio/input, window scaling, and OS launch behavior.
4. On Linux, install the two separate Flatpaks. Check CLI utility permissions and 3D portal
   selection across restarts. The 3D app ID preserves prior alpha settings.

Record unavailable native targets explicitly. Old alpha.3 acceptance does not establish the
new split candidate's behavior. A fix requires a new identified candidate and affected checks;
never silently replace frozen artifacts. Developer ID signing/notarization remains deferred;
ad-hoc integrity signing does not remove the quarantine limitation in the quickstart.

After final acceptance and explicit publication authorization, publish the existing draft
without rebuilding or altering application assets:

```sh
gh release edit alpha-YYYYMMDD-COMMITPREFIX \
  --repo merklejerk/holtburger --verify-tag \
  --draft=false --prerelease --latest=false
```

Verify the public asset list and representative downloaded checksums. Preserve the existing
nightly release and superseded drafts/tags; cleanup of them is a separate action.
