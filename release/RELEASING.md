# Preparing and announcing a release

Development and release tooling live on `main`. Beta starts at `0.2.0` and uses
ordinary unsuffixed `0.x.y` versions with immutable `v0.x.y` tags. Releases contain separate
CLI and 3D products on Linux x86-64, Windows x86-64, and macOS Apple Silicon, plus a Flatpak
per product. 3D also includes a Windows setup executable and macOS DMG. Intel macOS is not
supported. Both products share one version and original source commit.

The release workflow stages the complete beta draft for native acceptance. Publishing that
accepted draft does not rebuild its assets. Nightlies use the same builders and automatically
publish as prerelease/non-latest after checks succeed. Historical tags, drafts, and release
assets remain unchanged; the new pipeline does not migrate them.

## Version and content inputs

Record suite version bumps as ordinary reviewed changes on main. Use `release_version.py
bump VERSION` to update the Cargo workspace, Electron manifest, and both lockfiles; protocol,
archive, settings, and navigation compatibility versions remain independent. The checked-in
version must be unsuffixed and `release/channel.json` must contain `"beta"`. Build metadata
(`+...`) is rejected. A version bump alone does not require regenerating navigation content.

Tag the reviewed source `vVERSION`, or manually dispatch Release from main to create that tag
and continue the build in the same run. Existing tags must resolve to the same source commit;
annotated and lightweight tags are accepted. A tagged merge commit is valid. Never move a tag
or reuse a release version for changed source. Rerun a failed workflow at its original source;
main advancing does not invalidate a retry of an existing reachable tag.

Local release tooling uses the resolved dependencies in `.github/scripts/requirements.txt`:

```sh
uv run --no-project --with-requirements .github/scripts/requirements.txt \
  python .github/scripts/release_version.py check
```

`.github/cli-content.json` owns the approved generated ZIP SHA-256 and GitHub API asset URL.
The current input contains exactly `bootstrap.hba` and `navigation.hnav`; the descriptor is
the source of truth for its asset URL and digest. The production fetcher and headless
bootstrap probe validate the downloaded input. HNAV has no runtime bootstrap digest binding.
Existing content assets remain frozen. This path does not fetch legacy micro archives.
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
  --source /path/to/new-output/content
cargo run --locked -p holtburger-cli --bin content_bootstrap -- --content /path/to/new-output/content
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
python3 .github/scripts/release_suite.py assemble --product cli \
  --target x86_64-unknown-linux-gnu --content .holtburger-local/cli-content \
  --notices .github/licenses/THIRD_PARTY_NOTICES.html --output .holtburger-local/release-artifacts
python3 .github/scripts/release_suite.py assemble --product 3d \
  --target x86_64-unknown-linux-gnu --package apps/holtburger-3d/out/holtburger-3d-linux-x64 \
  --notices .github/licenses/THIRD_PARTY_NOTICES.html --output .holtburger-local/release-artifacts
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
removal, retained launcher credentials, locked files, and uninstall/replacement. Windows
also switches both ways between beta/nightly installer version headers over the current
verified payload. This proves installer ordering behavior, while each actual distribution
receives its own runtime probes; it does not substitute for testing two real releases. Mac
checks also require rejection of a mutated sealed resource. The predecessor is a
synthetic installation fixture, not proof of compatibility with every historical
settings schema. Finder, browser-download quarantine, and visual acceptance remain
user-owned. No update server or application updater is installed.

## Release, nightly, and diagnostic builds

`Build checks` validates main pushes/PRs and supplies reusable release validation. Root prose
changes outside shipped inputs can skip compilation while retaining the final `Validation`
status. Tag, schedule, and manual release builds receive full validation. Native jobs build
and probe each platform, including launcher-first and direct-client update lifecycle checks
with temporary profiles and intercepted browser opening.

After committing the version bump and merging it into main, create the immutable stable tag:

```sh
git tag v0.2.0
git push origin refs/tags/v0.2.0
```

Alternatively, dispatch **Actions → Release** on main with `purpose=release`, `product=both`,
and `target=all`. There is no requested-version input and no automatic version commit:

```sh
gh workflow run release.yml --repo merklejerk/holtburger --ref main \
  -f purpose=release -f product=both -f target=all
```

The nightly wrapper runs every eight hours or by manual dispatch, always from main. It reads
the current checked-in base version and appends `-nightly-FULL_SOURCE_SHA`, for example
`0.2.0-nightly-0123456789abcdef0123456789abcdef01234567`. Its tag is `v` plus that complete
version, pointing to original main source. There is no floating nightly tag. Hashes identify
builds and are not ordered for update discovery.

Each disposable nightly build/assembly checkout stamps only the four suite version files.
Preparation verifies an initially clean source and permits only the exact version-field delta,
including lockfiles. All binaries, package metadata, installers, archives, and manifests use
the resulting effective version while provenance retains original main's commit. These
changes are never committed to main. A complete matching published build is checked and
skipped before rebuilding; matching drafts may resume, but conflicting bytes/identities fail.
Neither retries nor publication overwrite an existing asset.

Beta and nightly use the same app IDs, install locations, shortcuts, and user profiles.
Installing either replaces the other; there are no side-by-side nightly installations.
Nightly builds have no update checks or update feed, including startup and focus/resume.
A current-version nightly sorts below that version's beta even when built later.

Diagnostics select `purpose=diagnostic` and one or both products/targets. They do not create
tags, stage drafts, or publish. Complete release/nightly builds require both products and
all supported targets. The old cargo-dist and CLI-only nightly publishers are retired.

The aggregator requires every native target, both Flatpaks, Windows setup, macOS DMG, matching
notices/content/source/version/channel/kind, and exact file digests/names. It writes schema 2
`release-manifest.json` and `SHA256SUMS`. Promotion uses the same inventory validator; staging
additionally checks every payload byte. A partially successful build cannot publish.

## Flatpak and CI cost

The Flatpaks reuse their already-built Linux native archives. One job shares tooling/runtime
setup, with separate cached builder state per product. The CLI has networking but no graphical
sockets or Electron. The 3D recipe retains graphics/audio/network and the pinned Zypak helper;
it uses `io.github.merklejerk.holtburger-3d`, matching the Windows installer and macOS
bundle ID, while the download is
named `holtburger-3d-VERSION-x86_64.flatpak`. CLI uses `io.github.merklejerk.holtburger-cli`.
Both products use the runtime generation selected by the 3D recipe (currently Freedesktop
26.08). Each product has one canonical recipe shared by beta and nightly.

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

## Dependency notices

Rust/native notices are generated locally and committed as
`.github/licenses/THIRD_PARTY_NOTICES.html`, with a generated
`THIRD_PARTY_NOTICES.inputs.json` freshness record beside it. CI runs
`python3 .github/scripts/generate_notices.py check` without installing cargo-about or
accessing license sources. Failures emit a warning in both branch validation and release
planning; they do not block CI or release creation. The local `check` command still exits
nonzero to report stale inputs/output. Its whole-file fingerprints include Cargo versions,
so a shared application version bump may warn but does not require regeneration to release.
Ordinary application source changes do not invalidate notices.

The release job uploads that committed HTML for all three native target graphs.
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
   selection across restarts. Beta and nightly deliberately share installation/profile locations; exercise replacement in both directions.

Record unavailable native targets explicitly. Previous release acceptance does not establish the
new distribution's behavior. A fix requires a new identified release and affected checks;
never silently replace frozen artifacts. Developer ID signing/notarization remains deferred;
ad-hoc integrity signing does not remove the quarantine limitation in the quickstart.

After final acceptance and explicit publication authorization, publish the existing draft
without rebuilding or altering application assets:

```sh
gh release edit v0.2.0 \
  --repo merklejerk/holtburger \
  --draft=false --prerelease=false --latest=true
```

Verify the public asset list and representative downloaded checksums. Preserve the existing
nightly release and superseded drafts/tags; cleanup of them is a separate action.

## Update feed and Pages

GitHub Pages uses GitHub Actions as its source. The `github-pages` environment must allow
main, since promotion checks out trusted main tooling and deploys from that ref. Promotion
needs `contents: read`; deployment needs `pages: write` and `id-token: write`.

`Promote Update Feeds` reconciles the complete published release inventory after publication
or manual dispatch. It accepts only unsuffixed `v0.x.y` tags with complete schema 2 beta
release manifests, exact tag/version agreement, and verified public asset inventories.
Historical alpha/candidate tags, nightlies, and drafts are excluded before manifest loading.
Malformed managed stable releases fail visibly. The highest eligible SemVer selects:

`https://merklejerk.github.io/holtburger/updates/beta.json`

There is no alpha or nightly projection. Each deployment uploads a complete generated site.
With no eligible stable release, beta.json is absent; a failed check is not proof the app is
current. Generation failure leaves the prior deployment intact. Delivery is eventually
consistent: verify served JSON and its release link after publication.

Repair after a failed promotion or release withdrawal:

```sh
gh workflow run promote-updates.yml --repo merklejerk/holtburger --ref main
```

Older events cannot replace a newer release while the full inventory is unchanged. Publishing
with workflow credentials must explicitly arrange promotion rather than assume an automated
release event triggers another workflow. A corrective release needs a greater version; the
memory-only client cache is not an urgent recall mechanism.

Packaged clean beta client builds check once asynchronously at startup and at most hourly
while launcher/pregame footers are visible. Focus/resume reevaluates due work; hidden windows
and gameplay do not start follow-up checks. The bounded request includes body reading and is
aborted on shutdown. Results survive document replacement. Nightly, development, modified,
unpackaged, and Explorer builds do not check. The footer opens the confirmed version-tag
release downloads page; installation remains manual.
