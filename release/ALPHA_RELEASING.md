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

`Alpha checks` validates pushes and pull requests on `3d-next` on Linux only, without release packaging.
Prose-only changes outside shipped documentation skip compilation while still reporting the
`Alpha validation` status. Configure that final status as the branch requirement rather than
individual conditionally skipped matrix jobs.

`Alpha Release Candidate` runs only for an explicitly pushed alpha tag. It calls the same
validation workflow for that exact source, in parallel with production packaging. Tagged
candidates must be committed on `3d-next`, version-consistent, and clean.
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

Portable Linux builds use Ubuntu 22.04. The combined Flatpak job uses Ubuntu 24.04's
builder 1.4, which supports the SDK's `appstreamcli`; the older 22.04 builder
expects `appstream-compose`. Flatpak runtime requirements remain defined by the declared
26.08 runtime. Its installed production-bootstrap probe verifies binary compatibility.
The full-suite recipe owns the alpha runtime selection; the generated TUI alpha recipe and
the single Flatpak provisioning step consume it. The main nightly keeps its independent TUI recipe.

Both Flatpaks reuse the inspected Linux archive without rebuilding its executables.
Their combined job waits only for Linux, independently of Windows/macOS, and installs tooling
and runtime once. Separate builder state/repository directories keep the app inventories
independent. Private bootstrap and compiled Electron probe imports come from the Linux job.
The Flatpak job installs locked JavaScript dependencies with `npm ci --ignore-scripts`:
compiled imports need zod/MessagePack and package inspection needs `@electron/asar`.
Skipping install scripts avoids downloading Electron; the job does not compile probes or the app.
The headless Ubuntu runner needs no desktop installation or alternate distribution.
The provisioning step still downloads OS packages and SDK/runtime on a fresh runner;
it uses the main Ubuntu archive in place of the previously stalled Azure mirror and explicitly
installs required helpers without optional recommended media packages. Additional caching is
justified only by measured setup cost after consolidation.

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

## Validation scope

Shared correctness runs once on Linux: the six affected library test targets, TUI CLI tests,
the converter's library/CLI tests, full frontend tests, type checks, and lint. Unit-test
selection excludes unshipped diagnostic binaries. Content parity uses self-contained synthetic
DAT/HBA fixtures. Release builds still explicitly name only
the shipped executables and the private bootstrap probe.

Windows and Apple Silicon run only for explicitly requested candidates. Their jobs build
and inspect the actual native packages and exercise startup, the private host, content
recovery, and packaged assets; they do not repeat shared unit suites. Platform-specific
investigations use targeted checks as needed, without a generic dispatch interface.

Candidate packaging on every target retains branding, bootstrap,
package/architecture/resource inspection, private-host smoke, default-client/Explorer content
recovery, and actual packaged font/image decoding. The exhaustive development theme suite
runs in Linux validation. All native packages use the content probe's default
`--theme-check assets`.
Flatpak retains `--theme-check full` because custom-theme filesystem access crosses its sandbox.
Automated install/startup and exact artifact checks remain release gates; manual native/visual
acceptance remains the final publication gate.

## Dependency notices

Rust/native notices are generated locally and committed as
`.github/licenses/THIRD_PARTY_NOTICES.html`, with a generated
`THIRD_PARTY_NOTICES.inputs.json` freshness record beside it. CI runs
`python3 .github/scripts/generate_notices.py check` without installing cargo-about or
accessing license sources. It rejects changed Cargo manifests/lockfile, notice policy,
original native notices, generator code, or altered/missing generated output.
Ordinary application source changes do not require regeneration.

The candidate job uploads that committed HTML for all three native target graphs.
The same file is included in every suite and both Flatpaks, and uploaded separately for
review. Suite metadata and the final manifest pin its digest. Electron/Chromium and font
notices remain inside h3d through the existing package checks.

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

When changing Cargo manifests/lockfile (including the suite version) or notice inputs,
install the pinned tool locally if needed, generate and review the output, and commit
both generated files with the input change:

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
