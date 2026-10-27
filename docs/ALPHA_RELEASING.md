# Preparing an alpha

The alpha channel builds `3d-next` independently of the existing main nightly. Its workflow
stages a draft GitHub prerelease; publishing it is a separate final action after user native
verification. No stage creates commits or moves existing tags.

The release pipeline is ready for subsequent candidates. The verified `0.1.0-alpha.3`
candidate at `7ab6645a6` is a historical packaging baseline, not the source selected for
publication. Merge the pending development work first and cut a fresh candidate from the
resulting source. Preserve earlier drafts/tags; do not publish or replace their assets as
part of cleanup.

The user has accepted broken TUI support with bundled micro for this alpha. Do not regenerate
content, add a topology-only movement mode, or make TUI gameplay a publication blocker in this
release task. Keep the limitation in the quickstart and release notes. Signing/notarizing macOS
is also deferred; ship the documented app-specific quarantine workaround.

## Version and content inputs

From the repository root:

```sh
python3 .github/scripts/release_version.py bump 0.1.0-alpha.4
python3 .github/scripts/release_version.py check
```

The bump command updates the workspace Cargo version, Electron manifest, and both lockfiles.
Every workspace Rust package inherits that version. Protocol, archive, and settings schema
versions have independent compatibility meanings and are not bumped by this command.

`.github/alpha-content.json` pins the approved micro ZIP by GitHub API asset URL and SHA-256.
The initial micro input is stored in a public, non-latest content-only prerelease. Keep
that release available: read-only CI tokens cannot fetch draft release assets. Do not
replace the asset bytes or reuse the main nightly's moving micro input.

Content repair is deferred for this alpha. For a future repair, update profile selection/pruning
before using `dat2hba --profile micro` with local portal and English localization DATs. Validate
the HBA with the noninteractive `content_bootstrap` harness and a probe exercising the complete
`read_character_gen_catalog()` path. The existing bootstrap probe parses the main character-generation table but
does not prove creation choices or world entry work; its successful result must not be
described as full TUI validation. Any future content repair needs focused catalog and
world-data checks before it can be called complete. Upload only the
validated micro ZIP containing `assets.hba`, update the descriptor, and review the change.
Retail DATs and full HBAs must not be uploaded to public CI or the release.

## Candidate build

`Alpha checks` validates pushes and pull requests on `3d-next` on Linux only, without release packaging.
Prose-only changes outside shipped documentation skip compilation while still reporting the
`Alpha validation` status. Configure that final status as the branch requirement rather than
individual conditionally skipped matrix jobs.

After committing and pushing the intended release inputs to `3d-next`, open GitHub
**Actions → Alpha Release Candidate → Run workflow**, select **3d-next**, and run it.
The workflow uses the commit selected when dispatching, checks the suite version and clean
source identity, and creates `alpha-YYYYMMDD-COMMITPREFIX` using the commit's committer date
and first nine commit characters. The source-owned date keeps the generated tag stable across
reruns on later days. It then validates and packages that same source in the same run, finally
staging a draft prerelease. It does not bump the version or publish the draft.

GitHub requires the dispatch workflow definition on the repository's default branch (`main`)
before exposing the button. Land the workflow definition there as well as on `3d-next`,
then select `3d-next` in the branch dropdown. Other branches are rejected. See
[GitHub's manual-run documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

The built-in token creates the tag without triggering a second tag-push workflow, so no
personal token is required. A rerun can reuse an existing lightweight tag for the identical
commit; a conflicting tag is rejected rather than moved. Candidate runs do not automatically
cancel an in-progress candidate.

An explicitly pushed alpha tag remains an alternative entry point. Resolve the intended
commit before creating one:

```sh
# After merging development changes, bumping the version, reviewing notices if needed,
# reviewing the diff, and committing/pushing the release inputs to 3d-next:
python3 .github/scripts/release_version.py check
git status --short
git rev-parse HEAD
# Use the reviewed commit's first nine hex digits and today's date:
git tag alpha-YYYYMMDD-COMMITPREFIX FULL_COMMIT_SHA
git push origin refs/tags/alpha-YYYYMMDD-COMMITPREFIX
```

These are optional operator commands, not automatic cleanup steps. Resolve any uncommitted
changes before preparing a candidate. A new source needs a new tag and candidate; never move
an earlier alpha tag.
Version `0.1.0-alpha.4` above is the next example after the alpha.3 baseline, not an automatic bump.

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
it removes the Azure preference from the runner's `/etc/apt/apt-mirrors.txt`, retaining the
official Ubuntu archive/security mirrors, and explicitly
installs required helpers without optional recommended media packages. Additional caching is
justified only by measured setup cost after consolidation.
The required `librsvg2-common` package supplies SVG decoding for the TUI's AppStream icon;
keep it explicit when disabling recommended packages.

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
accessing license sources. Failures emit a warning in both branch validation and candidate
planning; they do not block CI or candidate creation. The local `check` command still exits
nonzero to report stale inputs/output. Its whole-file fingerprints include Cargo versions,
so a suite-only version bump may warn but does not require regeneration to release.
Ordinary application source changes do not invalidate notices.

The candidate job uploads that committed HTML for all three native target graphs.
The same file is included in every suite and both Flatpaks, and uploaded separately for
review. Suite metadata and the final manifest pin its digest. Electron/Chromium and font
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
Generation failures are local maintenance work, not a CI gate. A suite-only version bump
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

User native-bundle verification occurs only after the complete draft exists. Provide its
link, source commit, checksums, known limitations, and this checklist:

1. Download the matching suite and verify its checksum; extract it with native tools.
2. Keep the accepted broken-TUI limitation explicit. TUI gameplay is not required for this alpha;
   any optional full-HBA testing must be recorded separately from bundled-micro behavior.
3. Launch h3d using CLI connection arguments and select the user's retail installation.
4. Check basic gameplay, input, audio, window scaling, and OS launch behavior on available platforms.
5. Launch explicit Explorer; report any failures with redacted commands and build identity.
6. Install the full-suite Flatpak and repeat client/Explorer checks, including portal selection
   across restarts, graphics/audio/input, and tool input/output permissions.

Record actual manual results and unverified platforms in draft release notes. Prior candidate
checks are evidence for the pipeline, not acceptance of the next candidate's application bytes.
A defect outside the explicitly accepted limitations requires a fix or an explicit scope decision.
A fix requires a newly identified candidate and repeated affected checks. Never replace accepted
artifacts silently. Preserve experimental status for platforms unavailable to the user.

After final acceptance and explicit publication authorization, publish the existing draft
without rebuilding or altering application assets. Verify the public asset list and re-download
representative assets to compare SHA-256 values. Keep the existing `nightly` release intact.

Use GitHub's existing release editor, or the equivalent CLI command after authorization:

```sh
gh release edit alpha-YYYYMMDD-COMMITPREFIX \
  --repo merklejerk/holtburger --verify-tag \
  --draft=false --prerelease --latest=false
```

Review the draft's source, nine assets, manifest/checksums, and final release notes before this
command. It publishes the selected draft without invoking a build. Leave superseded experimental
drafts unpublished; deleting them or their tags is separate housekeeping, not part of cutting the
next release. Follow the same process for each later alpha rather than reopening the implementation
plan or introducing another publication workflow.
