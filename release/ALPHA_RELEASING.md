# Preparing an alpha

The alpha channel builds `3d-next` independently of the existing main nightly. Its workflow
stages a draft GitHub prerelease; publishing it is a separate final action after user native
verification. No stage creates commits or moves existing tags.

## Version and content inputs

From the repository root:

```sh
python3 .github/scripts/release_version.py bump 0.1.0-alpha.3
python3 .github/scripts/release_version.py check
```

The bump command updates the workspace Cargo version, Electron manifest, and both lockfiles.
Every workspace Rust package inherits that version. Protocol, archive, and settings schema
versions have independent compatibility meanings and are not bumped by this command.

`.github/alpha-content.json` pins the approved micro ZIP by GitHub API asset URL and SHA-256.
The initial micro input is stored in a public, non-latest content-only prerelease. Keep
that release available: read-only CI tokens cannot fetch draft release assets. Do not
replace the asset bytes or reuse the main nightly's moving micro input.

To regenerate content, use corrected `dat2hba --profile micro` with local portal and English
localization DATs, then run the noninteractive `content_bootstrap` harness against the HBA.
It must load production bootstrap and character-generation data successfully. Upload only the
validated micro ZIP containing `assets.hba`, update the descriptor, and review the change.
Retail DATs and full HBAs must not be uploaded to public CI or the release.

## Candidate build

The alpha workflow verifies pushes and pull requests on `3d-next` without publishing.
Tagged candidates must be committed on that branch, version-consistent, and clean.
Resolve the intended commit before creating a tag:

```sh
git rev-parse HEAD
# After reviewing the exact commit, create/push an alpha-YYYYMMDD-<commit-prefix> tag.
```

The non-SemVer tag namespace avoids triggering the separate cargo-dist release workflow.
The workflow checks that the tag prefix matches the source commit and that the commit belongs
to `3d-next`. All native builds consume the same commit, version, and micro digest.

Linux x86-64, Windows x86-64, and macOS Apple Silicon build on native runners. Forge consumes
the explicitly targeted Rust host through `HOLTBURGER_PACKAGE_HOST`, avoiding an implicit
native rebuild. CI validates the final suite after extraction and stages the complete matrix,
TUI-only and full-suite Flatpaks, standalone micro ZIP, notices, manifest, and checksums into
one draft. The complete inventory is nine assets.

Portable Linux builds use Ubuntu 22.04. The separate Flatpak job uses Ubuntu 24.04's
builder 1.4, which supports the SDK's `appstreamcli`; the older 22.04 builder
expects `appstream-compose`. Flatpak runtime requirements remain defined by the declared
26.08 runtime. Its installed production-bootstrap probe verifies binary compatibility.
The full-suite recipe owns the alpha runtime selection; the generated TUI alpha recipe and
both CI installation steps consume it. The main nightly keeps its independent TUI recipe.

The full-suite Flatpak reuses the inspected Linux archive without rebuilding its executables.
Its recipe under `.github/flatpak/` builds only pinned Zypak to support Chromium's nested
sandbox; the 26.08 runtime supplies the other linked libraries. Two small build patches track
actual object targets with compiler-generated dependency files and correct an upstream
copy-constructor member typo diagnosed by the 26.08 SDK. Original
Zypak/nickle notices are pinned with the native notices and retained in the installed app.

CI installs the full-suite artifact and verifies exact suite bytes, native architecture,
wrapper/tool entry points, app ID/runtime, bootstrap, private-host protocol, and packaged
recovery/theme/font behavior. Synthetic document-portal input and explicit output grants
exercise real conversion/export without retail data. Probe executables/launchers remain CI
tooling and are not public release binaries. Both Flatpaks contribute installed identity
receipts; aggregation rejects missing assets, wrong source/content/notices, or changed bytes.

## Dependency notices

The plan job installs the version of `cargo-about` named by
`python3 .github/scripts/generate_notices.py tool-version`, then generates one
`THIRD_PARTY_NOTICES.html` for all three target graphs. The same file is included in every
suite and the Flatpak, and uploaded separately for review. Suite metadata and the final
manifest pin its digest. Electron/Chromium and font notices remain inside h3d.

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

For local generation after installing that tool version:

```sh
python3 .github/scripts/generate_notices.py generate --output .holtburger-local/alpha-notices/THIRD_PARTY_NOTICES.html
```

## Final handoff and publication

User native-bundle verification occurs only after the complete draft exists. Provide its
link, source commit, checksums, known limitations, and this checklist:

1. Download the matching suite and verify its checksum; extract it with native tools.
2. Launch TUI from a terminal with connection arguments, including from another working directory.
3. Launch h3d using CLI connection arguments and select the user's retail installation.
4. Check basic gameplay, input, audio, window scaling, and OS launch behavior on available platforms.
5. Launch explicit Explorer; report any failures with redacted commands and build identity.
6. Install the full-suite Flatpak and repeat client/Explorer checks, including portal selection
   across restarts, graphics/audio/input, TUI invocation, and tool input/output permissions.

Record actual manual results and unverified platforms in draft release notes. A defect requires
a corrected, newly identified candidate and repeated affected checks. Never replace accepted
artifacts silently. Preserve experimental status for platforms unavailable to the user.

After final acceptance and explicit publication authorization, publish the existing draft
without rebuilding or altering application assets. Verify the public asset list and re-download
representative assets to compare SHA-256 values. Keep the existing `nightly` release intact.
