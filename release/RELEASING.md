# Preparing and announcing a release

Development and release tooling live on `main`. Beta starts at `0.2.0` and uses
ordinary unsuffixed `0.x.y` versions with `v0.x.y` tags that become immutable at publication. Releases contain separate
CLI and 3D products on Linux x86-64, Windows x86-64, and macOS Apple Silicon, plus a Flatpak
per product. 3D also includes a Windows setup executable and macOS DMG. Intel macOS is not
supported. Both products share one version and original source commit.

h3d owns installer construction and native acceptance through its app-local
`package:installer` command (`--native DIR --output FILE [--iscc PATH]`). Root
`release:installers` admits/extracts the source archive, invokes that command, then
hashes the installer and writes its suite receipt. From `apps/holtburger-3d/`, run
`npm run check:installers` and `npm run test:installers` for tooling checks.

Release preparation is a manually requested Copilot analysis followed by a release PR.
Reviewing and merging that PR authorizes automatic build, verification, and publication.
There is no subsequent manual draft acceptance or publish step. Nightlies use the same
builders and publish as prerelease/non-latest after checks succeed. Published releases,
tags, and assets remain unchanged. Unpublished attempts may be replaced by a retry.

## Preparing a release

One-time setup:

- Create a fine-grained personal access token with the **Copilot Requests** permission
  for a user with Copilot access. Store it as the repository Actions secret
  `COPILOT_RELEASE_TOKEN`. Organization-provided access also requires the Copilot CLI
  policy to be enabled. AI usage draws on that user's Copilot entitlement.
- In repository **Settings → Actions → General → Workflow permissions**, enable
  **Allow GitHub Actions to create and approve pull requests**. The workflow creates
  PRs; it does not approve or merge them.
- Keep review/merge protection on `main`. If PR checks created by the workflow token
  require approval, use the PR's **Approve workflows to run** control before merging.
- Configure GitHub Pages to use GitHub Actions and allow its environment to deploy
  from `main`.

Run **Actions → Prepare Release → Run workflow** on `main`, or:

```sh
gh workflow run prepare-release.yml --repo merklejerk/holtburger --ref main -f bump=auto
```

`bump=auto` uses Copilot's recommendation; `patch` and `minor` are bounded overrides.
There is no arbitrary requested-version input. Deterministic code computes either
`0.x.y → 0.x.(y+1)` or `0.x.y → 0.(x+1).0`. It rejects major changes, skipped increments,
downgrades, prerelease suffixes, and build metadata. The same rule applies after PR edits
and again when a release PR merge starts publication. The manual `version:bump` command also enforces it.

Copilot receives the latest published beta's verified source identity, merged PR context,
previous release notes, and permission to inspect source/history. Without a published beta,
it reviews current functionality and the full history for the first release. The analysis
job cannot write repository contents through its workflow token. Its strict JSON proposal
contains only patch/minor choice, rationale, and complete replacement notes.

A separate writer job revalidates the source and published baseline, computes the version,
and opens a unique `release/prepare-*` branch/PR containing exactly the four suite version
files and `release/RELEASE_NOTES.md`. It refuses a second open release PR. Main advancing
during preparation or a changed published baseline requires running preparation again.
Failed runs do not overwrite historical branches. Close an abandoned PR before retrying;
reviewing/editing an existing PR is usually simpler.

Review the notes, known issues, upgrade instructions, and version rationale in the PR.
Copilot should retain unresolved limitations unless source evidence demonstrates a fix;
human review owns the accuracy of those judgments. If main advances while the PR is open,
review the intervening changes and update the notes as necessary. PR checks reject unrelated
files, dependency changes hidden in version files, empty/unchanged notes, and invalid increments.
Merge the PR to start **Release**. Its reviewed merge commit becomes that attempt's
source. Ordinary PR merges, direct version commits, and tag pushes do not automatically publish betas.

The publisher waits for all required checks and both products on every target. It uploads
assets to a private draft to avoid exposing an incomplete distribution, then publishes in
the same run. A failed upload may leave a draft that a retry can resume; it is not a manual
handoff. Matching draft assets resume uploading; a draft with a different source or conflicting
bytes is replaced as a whole. Published bytes are never replaced.

## Retrying a failed release

GitHub's **Re-run jobs** repeats the original workflow and source commit. Use it for
transient failures when the source needs no changes. To include fixes merged into `main`,
run **Actions → Release → Run workflow**, select branch `main`, purpose `release`, product
`both`, and target `all`, or:

```sh
gh workflow run release.yml --repo merklejerk/holtburger --ref main \
  -f purpose=release -f product=both -f target=all
```

This manual publication request uses the checked-in version and release notes without
another version bump or preparation PR. Review the intervening changes and notes before
requesting it. Planning requires a clean checkout of current `main` and pins one full source
commit for all validation, packages, installers, and receipts. All products and targets must
pass again; artifacts from different attempts are never combined.

Planning does not reserve a tag. The publisher creates the tag after build verification,
before staging the private draft. It may move an unpublished beta tag left by an earlier
failed attempt to the selected source. A conflicting nightly tag is rejected because its
short hash must still identify the full original commit. Publication attempts are serialized.

Once a version is public, retries verify its manifest, source, tag, and assets. An exact
published match skips rebuilding; selecting changed source for that version fails and requires
a new release version. The version and tag become immutable at publication, not at preparation.

## Version and content inputs

The writer uses the existing suite version tooling to update the Cargo workspace,
Electron manifest, and both lockfiles. Protocol, archive, settings, and navigation
compatibility versions remain independent. The checked-in version must be unsuffixed and
`release/channel.json` must contain `"beta"`. A version bump alone does not require
regenerating navigation content.

Local release tooling uses Node.js 24.13.1 and npm 11.8.0 with the independent
repository-root lockfile. App dependencies still install inside the app:

```sh
npm ci
npm run version:check
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
npm run --silent content:fetch -- .holtburger-local/cli-content
# Local alternative: use the SHA-256 recorded in .github/cli-content.json.
npm run --silent content:stage -- /path/to/cli-content.zip \
  --sha256 APPROVED_SHA256 --output .holtburger-local/cli-content
```

Use a new staging directory. The ZIP digest, exact entry names, and archive headers
are checked before staging. The assembler compares staged components
with the retained input ZIP. Runtime uses the content crate's codec validation;
it does not scan the full source corpus or apply a size gate.

## Product assembly

The TUI owns bundled scripts under `apps/holtburger-cli/scripts/`, including mage's
nested compiler. Build validation checks its committed export; release assembly copies
the files selected by the TUI's `scripts/bundle.json` into the native bundle's
`scripts/` directory.

CLI includes `holtburger-cli`, `dat2hba`, `dat-tool`, fighter/mage scripts and sidecars,
`content/`, metadata, license/notices, and its CLI quickstart. 3D includes `h3d/` with the
packaged client/Explorer, private host/runtime/resources, metadata, license/notices, and its
3D quickstart. Assembly selects `release/quickstarts/PRODUCT/PLATFORM.md` for the
target and ships it as the bundle's only `QUICKSTART.md`. Each guide stands alone;
Linux guides cover portable and Flatpak installation, and 3D Windows/macOS guides
cover installer and portable installation. Installers and Flatpaks retain the guide from
their native input. Each assembler can run with the other product's inputs absent:

```sh
npm run --silent release -- assemble --product cli \
  --target x86_64-unknown-linux-gnu --content .holtburger-local/cli-content \
  --notices .github/licenses/THIRD_PARTY_NOTICES.html --output .holtburger-local/release-artifacts
npm run --silent release -- assemble --product 3d \
  --target x86_64-unknown-linux-gnu --package apps/holtburger-3d/out/holtburger-3d-linux-x64 \
  --notices .github/licenses/THIRD_PARTY_NOTICES.html --output .holtburger-local/release-artifacts
```

These commands require the corresponding native target build outputs. Forge receives the
explicit target host through `HOLTBURGER_PACKAGE_HOST`; it does not rebuild it implicitly.
Assembly checks architecture, executable modes, notices/content identity, native linkage,
and extracted layout. 3D also checks packaged host and renderer source identity. CLI needs
no Node/Electron installation. 3D needs no compact CLI content.

### Desktop installers

h3d owns installer construction and native acceptance checks through its
`package:installer` command. Root `release:installers` verifies/extracts the native
archive, invokes that app command, then hashes the installer and writes the suite
receipt. The app command accepts `--native DIR --output FILE [--iscc PATH]` and
requires its own app dependencies. `npm run check:installers` and
`npm run test:installers` run from `apps/holtburger-3d/`.
and manual upgrades

The desktop installer job consumes the verified 3D native ZIP. It does not rebuild
Electron or the Rust host. Windows uses `apps/holtburger-3d/packaging/windows.iss` with
the compiler selected by the installed Chocolatey package; macOS uses native `hdiutil`.
Archives upload before installer generation, so a failed installer retains its source
archive for diagnostics. The native job must still pass before publication.

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
status. Release PR merges, schedules, and manual builds receive full validation. Native jobs build
and probe each platform, including launcher-first and direct-client update lifecycle checks
with temporary profiles and intercepted browser opening.

The nightly wrapper runs every eight hours or by manual dispatch, always from main. It reads
the current checked-in base version and appends `-nightly-SHORT_SOURCE_SHA`, using the first
eight hexadecimal characters, for example `0.2.0-nightly-01234567`. Its tag is `v` plus that complete
version, pointing to original main source. There is no floating nightly tag. Hashes identify
builds and are not ordered for update discovery. Manifests and provenance retain the full
40-character source commit. An existing short-hash tag for another commit is rejected.

Each disposable nightly build/assembly checkout stamps only the four suite version files.
Preparation verifies an initially clean source and permits only the exact version-field delta,
including lockfiles. All binaries, package metadata, installers, archives, and manifests use
the resulting effective version while provenance retains original main's commit. These
changes are never committed to main. A complete matching published build is checked and
skipped before rebuilding. Matching drafts may resume; stale or conflicting drafts are replaced
before upload. Neither retries nor publication overwrite a published asset.

Beta and nightly use the same app IDs, install locations, shortcuts, and user profiles.
Installing either replaces the other; there are no side-by-side nightly installations.
Nightly builds have no update checks or update feed, including startup and focus/resume.
A current-version nightly sorts below that version's beta even when built later.

The release PR replaces `release/RELEASE_NOTES.md` with user-facing changes, known issues,
and upgrade instructions. Nightly descriptions are generated from the source commit.
Both descriptions append installation links pinned to that commit. Publication uses
descriptions from the selected source, including on retries; temporary draft edits are
not authoritative.

Diagnostics select `purpose=diagnostic` and one or both products/targets. They do not create
tags or publish releases. Complete release/nightly builds require both products and
all supported targets. The old cargo-dist and CLI-only nightly publishers are retired.

The aggregator requires every native target, both Flatpaks, Windows setup, macOS DMG, matching
notices/content/source/version/channel/kind, and exact file digests/names. It writes schema 2
`release-manifest.json` and `SHA256SUMS`. Promotion uses the same inventory validator; publication
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
`npm run check:notices` without installing cargo-about or
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
VERSION=$(node scripts/checks/notices.ts tool-version)
cargo install --locked --features cli --version "$VERSION" cargo-about
npm run generate:notices
npm run check:notices
git diff -- .github/licenses/THIRD_PARTY_NOTICES.html .github/licenses/THIRD_PARTY_NOTICES.inputs.json
```

Local generation retrieves checksum-verified upstream license clarifications and needs
network access. Do not hand-edit the generated digest record to bypass regeneration.
This avoids repeating tool compilation and license collection in the release path.

## Acceptance and publication

Merging the release PR or manually requesting `purpose=release` is the publication decision. Automated native packaging/runtime
checks remain required; manual graphics, input, gameplay, Finder/browser quarantine, and
visual acceptance are no longer publication gates. Those limitations should be understood
when reviewing the release PR. Developer ID signing/notarization remains deferred;
ad-hoc integrity signing does not remove the quarantine limitation in the quickstart.

A new highest-version beta publishes as non-prerelease/latest after verification.
Retrying an older beta does not replace a newer latest release. Nightlies remain
prerelease/non-latest and have no update feed. The workflow then explicitly dispatches the
website/update-feed workflow from main because publication with `GITHUB_TOKEN` does not
trigger a separate release-event workflow. If website dispatch fails after publication,
the release remains public; rerun the failed job or dispatch the website workflow below.
Do not replace frozen assets to repair publication. Fixes need a new reviewed release.

## Update feed and Pages

GitHub Pages uses GitHub Actions as its source. The `github-pages` environment must allow
workflow dispatch from main and release events from `v0.*.*` tags. Deployment protection
matches the event ref, even though promotion checks out trusted main tooling; checking out
main does not change the release event’s tag ref. Promotion needs `contents: read`;
deployment needs `pages: write` and `id-token: write`.

`Publish Website and Update Feeds` reconciles the complete published release inventory after publication
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

Older events cannot replace a newer release while the full inventory is unchanged.
The release publisher explicitly requests promotion after beta publication. A corrective
release needs a greater version; the memory-only client cache is not an urgent recall
mechanism.

Packaged clean beta client builds check once asynchronously at startup and at most hourly
while launcher/pregame footers are visible. Focus/resume reevaluates due work; hidden windows
and gameplay do not start follow-up checks. The bounded request includes body reading and is
aborted on shutdown. Results survive document replacement. Nightly, development, modified,
unpackaged, and Explorer builds do not check. The footer opens the confirmed version-tag
release downloads page; installation remains manual.
