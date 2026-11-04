# Preparing and announcing a release

Candidates currently build `3d-next` and stage a draft GitHub release.
The explicit audience in `release/channel.json` is independent of SemVer suffixes and
GitHub prerelease/latest flags. Beta uses ordinary unsuffixed `0.x.y` versions. The release has
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

Select the next suite SemVer explicitly when requesting a candidate. Candidate CI applies it
with `release_version.py`, records a version-only commit, and atomically pushes that commit
and its immutable candidate tag before any build. The requested version must be greater than
all allocated candidates, including unpublished or failed ones. Retries of the same workflow
reuse the original source/version; a different source needs a new version. Gaps are expected.
Build metadata (`+...`) is not a release version increment and is rejected.

The suite version covers Cargo workspace packages, Electron's manifest and both lockfiles.
Navigation format, protocol, archive and settings compatibility versions remain independent.
A version bump alone does not require regenerating navigation content. The next channel is
recorded in `release/channel.json` before requesting its candidate; CI never guesses channel
from a version suffix. If branch protection later prevents bot allocation, use a reviewed
version PR and adapt the allocation entry point; do not bypass protection.

Local release tooling uses the resolved dependencies in `.github/scripts/requirements.txt`:

```sh
uv run --no-project --with-requirements .github/scripts/requirements.txt \
  python .github/scripts/release_version.py check
```

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
python3 .github/scripts/candidate_release.py assemble --product cli \
  --target x86_64-unknown-linux-gnu --content .holtburger-local/cli-content \
  --notices .github/licenses/THIRD_PARTY_NOTICES.html --output .holtburger-local/candidate-artifacts
python3 .github/scripts/candidate_release.py assemble --product 3d \
  --target x86_64-unknown-linux-gnu --package apps/holtburger-3d/out/holtburger-3d-linux-x64 \
  --notices .github/licenses/THIRD_PARTY_NOTICES.html --output .holtburger-local/candidate-artifacts
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

`Candidate checks` validates pushes/PRs on `3d-next` on Linux. Prose-only changes outside
shipped documentation skip compilation while retaining the final `Candidate validation`
status. Candidate validation and native package jobs explicitly check out the allocated
version commit, rather than the older dispatch event commit. Shared correctness/lint checks
run once; each native job packages and probes its own platform. Packaged update probes cover launcher-first
and direct client startup with temporary profiles and intercepted browser opening; no retail
assets are required for these native boundary checks.

Manual **Actions → Release Candidate → Run workflow** selects `3d-next`,
`purpose=candidate`, `product=both`, `target=all`, and an explicit greater `version`:

```sh
gh workflow run candidate-release.yml --repo merklejerk/holtburger --ref 3d-next \
  -f purpose=candidate -f product=both -f target=all -f version=NEXT_VERSION
```

The workflow serializes allocations, requires the dispatch commit still to be the release
branch head, records the version commit, and derives
`candidate-YYYYMMDD-COMMITPREFIX` from that commit. Branch advancement rejects the request
instead of silently selecting new application code. Branch and tag push atomically; neither
is force-updated. The workflow continues its own builds without relying on a bot push to
trigger another run. Rerun a failed candidate workflow to reuse its allocation; starting a
fresh request from changed source requires another greater version.

For diagnostics, select `purpose=diagnostic`, leave `version` empty and choose one or both
products and selected targets. Diagnostics never bump versions, create tags, stage drafts
or announce updates. Complete candidates always require both products and all targets.

GitHub needs the manual workflow registered on the default branch. Before beta, a small
workflow-only registration on `main` is sufficient; dispatch explicitly with `--ref 3d-next`
to execute the actual implementation there. Registration must not merge application work or
select `main` as the release source. Promotion tooling also stays on `3d-next` until the
separately authorized beta merge. At that merge, resolve any registration-stub add/add
conflicts by retaining the full workflow implementations. Keep default-branch registration stubs small and make an
accidental dispatch at `main` fail with an instruction to select the supported ref.

Explicit candidate tag pushes can rebuild an already allocated immutable candidate. Do not
create another tag for the same suite version or move an existing tag. The date/hash tag
namespace avoids the separate cargo-dist workflow that publishes SemVer-shaped tags.
Historical `alpha-*` tags remain unchanged and participate in allocation's previous-version
comparison, but new candidates use only `candidate-*` tags.

The aggregator requires both products on every native target, both Flatpaks, Windows setup,
macOS DMG, matching notices/content/source/version/channel and exact file digests/names. It
writes schema-versioned `release-manifest.json` plus `SHA256SUMS`. The same pure inventory
validator is used later by promotion; local staging additionally checks every payload byte.

## Flatpak and CI cost

The Flatpaks reuse their already-built Linux native archives. One job shares tooling/runtime
setup, with separate cached builder state per product. The CLI has networking but no graphical
sockets or Electron. The 3D recipe retains graphics/audio/network and the pinned Zypak helper;
it uses `io.github.merklejerk.holtburger-3d-alpha`, matching the Windows installer and macOS
bundle ID, while the download is
named `holtburger-3d-VERSION-x86_64.flatpak`. CLI uses `io.github.merklejerk.holtburger-cli-alpha`.
The alpha CLI appears as **Holtburger CLI Alpha** and has separate settings from main/nightly
`io.github.merklejerk.holtburger-cli`. Nightly preparation explicitly selects `--nightly-cli`.
Both alpha products use Freedesktop 26.08. The generated alpha recipe selects that runtime
from the 3D recipe; the checked-in CLI recipe remains independently usable for staging.
The 3D ID replaces the earlier alpha Flatpak ID. It creates a separate installation and
settings directory; earlier settings and portal grants are not migrated automatically.

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
   selection across restarts. The renamed 3D app starts with a separate settings directory.

Record unavailable native targets explicitly. Old alpha.3 acceptance does not establish the
new split candidate's behavior. A fix requires a new identified candidate and affected checks;
never silently replace frozen artifacts. Developer ID signing/notarization remains deferred;
ad-hoc integrity signing does not remove the quarantine limitation in the quickstart.

After final acceptance and explicit publication authorization, publish the existing draft
without rebuilding or altering application assets:

```sh
gh release edit candidate-YYYYMMDD-COMMITPREFIX \
  --repo merklejerk/holtburger --verify-tag \
  --draft=false --prerelease --latest=false
```

Verify the public asset list and representative downloaded checksums. Preserve the existing
nightly release and superseded drafts/tags; cleanup of them is a separate action.

## Update feeds and Pages rollout

Enable GitHub Pages with **GitHub Actions** as its source. The repository-level
`github-pages` environment must permit candidate tag deployments and manual promotion from
`3d-next`; review existing environment rules before changing them. The promotion workflow
needs `contents: read`, and its deployment job needs `pages: write` plus `id-token: write`.
The initial rollout must verify the repository's actual Pages URL matches the two fixed
endpoints compiled into H3D:

- `https://merklejerk.github.io/holtburger/updates/alpha.json`
- `https://merklejerk.github.io/holtburger/updates/beta.json`

`Promote Update Feeds` runs after an accepted candidate is published. It uses trusted tooling
from `3d-next`, resolves that checkout to one commit, discovers all published releases with
pagination, and validates complete managed-candidate manifests and public asset inventories.
It ignores unrelated release families and drafts. A malformed published managed candidate
fails visibly rather than silently disappearing from the selection.

The highest SemVer wins. The alpha feed accepts alpha or beta releases so checking-capable
alpha installations can discover beta. The beta feed accepts beta only. GitHub's latest and
prerelease badges do not control routing. A channel with no eligible release has no feed
file; clients treat its 404 as an unavailable check, not proof they are current. Old
installations that lack checking cannot discover this feature retroactively; ship an alpha
bridge first if that transition is desired.

Promotion uploads/deploys one complete Pages site containing both channel projections. It
never publishes a draft, rebuilds accepted packages, or downloads every installer to repeat
native acceptance. A failed generation/deployment leaves the previous deployed site intact.
Pages delivery is eventually consistent; verify the served JSON and release links after
initial deployment, and allow ordinary propagation time.

For repair or after withdrawing/deleting a release, explicitly reconcile:

```sh
gh workflow run promote-updates.yml --repo merklejerk/holtburger --ref 3d-next
```

Rerunning a promotion also reconciles the current full inventory; an older event cannot
replace a newer release while that inventory is unchanged. If future publication uses
`GITHUB_TOKEN`, explicitly dispatch promotion because token-generated events generally do
not trigger another workflow. A corrective release must have a greater SemVer. Clients
retain a previously confirmed update on check failure; this is not an urgent recall system.

H3D checks once asynchronously at native startup, then at most hourly while a launcher or
pregame footer is visible. Focus/system resume reevaluates due work, minimizing/hiding
suppresses follow-up checks, and gameplay starts none. A request already underway may finish.
The five-second deadline includes body reading. Results survive document replacement and
remain memory-only. Unpackaged, modified, development and Explorer runs do not check.
The footer opens the confirmed release's downloads page in the system browser; it performs
no installation. Optional network work is aborted without delaying application shutdown.

At the authorized beta merge, change `candidate_allocation.RELEASE_BRANCH` and promotion's
trusted checkout ref to `main`, update dispatch examples, push/PR branch filters and Pages
environment allowlists together, and verify a complete candidate and promotion repair from
`main`. The beta audience alone never changes the source ref. Retain existing desktop and
Flatpak IDs/settings locations: their alpha spelling preserves installations across versions.
