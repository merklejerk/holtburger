# Alpha release from `3d-next`

Status: implementation stopped at the dependency-notice gap below, per the user's instruction to stop on major gaps. Hosted platform verification and final native acceptance remain pending.

## Goal and boundaries

Publish a reproducible alpha suite from one identified `3d-next` commit as GitHub Release assets, containing the TUI, h3d, and the tools and resources needed to use them.

The user has authorized implementing this plan. No commits or source pushes have been made; final publication waits for user native-bundle acceptance.

### Accepted scope

- Ship the TUI as `holtburger-cli`, h3d as a complete Electron application with its private Rust host, `dat2hba`, and `dat-tool`.
- Keep Explorer available through an explicit `explorer` argument in the same h3d application.
- Make client mode the default h3d entry. Continue requiring connection/account arguments; no graphical login flow or launcher is needed.
- Align h3d short flags with TUI: `-p` means port and `-P` means password. Keep `--port` and `--password`.
- Ship `fighter.js`, `mage.js`, `mage.data.json`, and `mage.data.bin`. The script-derived data is approved for distribution.
- Ship a regenerated micro HBA for TUI, including the standalone micro download. Preserve the TUI Flatpak artifact.
- Keep h3d's runtime UI resources, themes, fonts, branding, licenses, and third-party notices in its application package.
- Supply a quickstart, checksums, release identity, and a platform/dependency limitations statement.
- Publish the alpha as a separate prerelease channel. Preserve the existing `main` TUI nightly.
- Use one inexpensive asset-presence check to distinguish unsuitable small HBA content for h3d. The selected sentinel is `eor/portal:0x0500000C`.
- Unify suite version maintenance and make versions and source revisions agree across builds and release assets.

### Exclusions and concessions

- Do not distribute full retail DATs, full HBAs, `weenies.hwc`, local settings, credentials, runtime caches, or captured live-session data.
- Do not ship optional specialized tools (`export-weenie-catalog`, `survey-weenie-catalog`, `soul-emotes`, `weenie-resists`) or debug-harness binaries.
- Do not add HBA profile metadata, change the archive version, or build a completeness validator. Passing the sentinel check is a suitability heuristic; later resource failures remain ordinary visible errors.
- Do not add a login UI, separate launcher, updater, h3d Flatpak, or additional installer formats. Unsigned application archives are acceptable for alpha.
- Do not change the retail decompile. No gameplay or rendering feature work is needed for this release.
- Do not run the interactive TUI for diagnostics. Use focused noninteractive probes and package inspection. Visual acceptance belongs to the user.
- The user cannot verify native release bundles until the end. Phases 1–7 must progress using automated evidence without requiring user installation or launch checks. Final native acceptance uses the complete staged release artifacts immediately before publication.
- Packaged builds may be distributed as experimental on platforms without interactive verification. Build/package evidence must not be described as verified gameplay support.
- Existing small/full archives retain their current format. Existing malformed-archive and mixed-family behavior is not relaxed to make discovery appear successful.
- Reproducibility means pinned source, content, dependencies, and build instructions for this alpha; byte-identical rebuilds across independent runs are not an acceptance requirement.

## Ground truth and evidence

Paths below are relative to the repository root. Code takes precedence where existing documentation is stale.

| Source | What it owns / why it matters |
| --- | --- |
| `.github/workflows/nightly.yml` | Working `main` nightly; TUI archives, scripts, micro download, Flatpak, and GitHub publication. |
| `.github/workflows/release.yml`, `Cargo.toml` | Generated cargo-dist workflow, version-shaped tag trigger, distribution targets, and workspace version. |
| `.github/workflows/holtburger-3d-portability.yml` | Native Electron packaging, host smoke, package inspection, theme checks, and ZIP round-trip checks. Currently branch-scoped and diagnostic only. |
| `.github/workflows/rust-ci.yml` | Existing Rust checks; branch filters currently omit `3d-next`. |
| `.github/scripts/fetch_micro_hba.sh` | Downloads a mutable external micro archive. Checks only that `assets.hba` exists. |
| `apps/holtburger-3d/package.json`, `apps/holtburger-3d/forge.config.cjs` | Build scripts, Electron resources, package version, runtime dependency pruning, and ZIP maker. |
| `apps/holtburger-3d/electron/main.ts`, `apps/holtburger-3d/electron/client-launch.ts`, `apps/holtburger-3d/scripts/entry-paths.mjs` | Entry choice, connection parsing, private host launch, and packaged content root. |
| `apps/holtburger-3d/electron/content-startup.ts`, `apps/holtburger-3d/electron/content-preference-store.ts` | Saved selections, explicit overrides, automatic discovery, asset picker, and recovery. |
| `crates/holtburger-content/src/repository.rs`, `crates/holtburger-content/src/repository/mounting.rs` | Shared installation paths, archive family selection, resource-index access, and candidate iteration. |
| `crates/holtburger-dat/src/manifest.rs`, `apps/holtburger-tools/src/dat2hba.rs` | Full/pruned/micro filtering and conversion. |
| `crates/holtburger-core/src/client/builder.rs::load_assets` | Current TUI bootstrap requirements. |
| `apps/holtburger-cli/src/bin/tui.rs`, `apps/holtburger-cli/src/scripting.rs` | TUI content entry and script/config/data lookup. |
| `apps/holtburger-cli/build.rs`, `apps/holtburger-cli/src/version.rs` | TUI display currently prefers build override/CI hash/Git hash rather than package SemVer. |
| `apps/holtburger-3d/scripts/app-build.ts`, `apps/holtburger-3d/src/app/app-build.ts` | h3d package version, Git revision, and modified status. Host handshake separately uses `CARGO_PKG_VERSION`. |
| `apps/holtburger-3d/scripts/verify-electron-package.mjs`, `apps/holtburger-3d/scripts/verify-electron-archive.mjs` | Existing resource, license, executable-permission, and macOS framework-symlink checks. |
| `apps/holtburger-cli/dist/`, `release-test/` | Existing TUI Flatpak and manual release test environment; the latter does not establish h3d desktop compatibility. |

### Findings that affect implementation

1. The published `nightly` release was updated on 2026-10-26. Its micro ZIP was read into memory and matched local `dats/micro.zip` byte-for-byte: 344,010 bytes, containing only five HBA records. It has skill/spell/XP/character-generation tables and the retired `holtburger/core:0x4D4F544B` baked-motion resource. It cannot satisfy current TUI bootstrap.
2. Current micro generation retains raw motion content and several newer tables, but omits `SecondaryAttributeTable::FILE_ID` (`0x0E000003`), which `ClientBuilder::load_assets` requires. Fixing the filter and regenerating are both necessary.
3. Local full `dats/assets.hba` contains the unpruned surface-texture sentinel `eor/portal:0x0500000C`. Both smaller profile filters exclude that resource type. The published micro archive lacks the sentinel.
4. Shared discovery returns the first mountable selection. Only absent/empty candidates are skipped. A sentinel check after discovery returns would be too late to try another candidate.
5. Directory mounting chooses HBA over DAT when both exist. Keep that family rule: do not mount retail DATs underneath a micro archive to hide missing content.
6. TUI content defaults include working-directory-relative `./dats`; scripts default to `scripts`. h3d's packaged portable root is `dirname(process.execPath)/dats`, followed by Holtburger's platform data directory. On macOS that executable directory is inside the `.app`, not beside it. Neither path searches arbitrary retail installations.
7. The local Linux package passed `npm run check:package`. Its ZIP records executable modes for the shell and host. It is approximately 129 MiB compressed and 316 MiB unpacked. Its ASAR had no DAT/HBA/HWC payload, but includes diagnostic HTML entries and source maps.
8. The local packaged Rust host requires `GLIBC_2.43` symbols (`acosf`, `atan2f`). Electron's executable has a much older glibc requirement. Build and inspect the entire suite in the selected release environment; do not promote local binaries.
9. Nightly installs matrix Rust targets but invokes Cargo without `--target`; both macOS rows use the same runner label. Archive labels do not establish executable architecture.
10. Most Rust packages inherit workspace version `0.1.0`; tools and the weenie-catalog crate hardcode it. Electron separately owns `0.1.0` in its manifest and lockfile. Protocol, archive, catalog, and settings schema versions are separate compatibility contracts.

Previously inspected public references:

- [Existing nightly release](https://github.com/merklejerk/holtburger/releases/tag/nightly).
- [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows): default-branch restrictions matter for scheduled/manual-dispatch workflow installation.
- [GitHub release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository): draft/prerelease publication behavior. Recheck repository settings before implementing publication.

## Design principles and ownership

1. One source commit, suite version, and micro artifact digest per release. Every matrix job consumes that same resolved identity.
2. Use the existing Forge packaging and verification paths. Build once, inspect, archive, and publish those bytes; do not rebuild between package inspection and publication.
3. Keep release assembly in repository tooling/CI. Keep CLI and Electron launch policy in their apps. No release orchestration belongs in `core` or `world`.
4. `dat` owns profile filtering and archive decoding. `content` owns installation paths, archive mounting, and indexed resource facts. h3d owns its one-sentinel admission decision.
5. Do not duplicate discovery rules in Electron or make shared content know about h3d's chosen sentinel. A small caller-supplied admission predicate in existing discovery is sufficient; no policy framework is needed.
6. Keep h3d's bundled host private, version-matched, and executable in the native application layout.
7. TUI bundled resources must remain discoverable from another working directory. User script overrides and explicit content paths retain priority.
8. Prefer exact inventories over globs and exact asset digests over moving downloads. Do not add abstractions or metrics without a named consumer.
9. Keep each milestone reviewable. Replace obsolete flags/examples/tests as part of each change rather than retaining parallel interfaces.

## Release shape and contracts

### Download inventory

| Asset | Contents / purpose |
| --- | --- |
| `holtburger-alpha-<version>-<rust-target>.zip` on Windows/macOS; `.tar.gz` on Linux | Complete suite for that architecture. |
| `holtburger-cli-<version>-x86_64.flatpak` | TUI only, including the same micro HBA and scripts. |
| `holtburger-micro-<version>.zip` | Standalone regenerated micro archive; ZIP root contains `assets.hba`. |
| `SHA256SUMS` | Digests of downloadable suite, Flatpak, micro, and release manifest assets. |
| `release-manifest.json` | Exact version, source commit, micro digest, per-platform build environment and executable architectures, verification status, and asset filenames. Used for support and publication validation. |

Suite contents:

```text
holtburger-alpha-<version>-<target>/
  holtburger-cli[.exe]
  dat2hba[.exe]
  dat-tool[.exe]
  dats/assets.hba                 # regenerated micro, for TUI
  scripts/fighter.js
  scripts/mage.js
  scripts/mage.data.json
  scripts/mage.data.bin
  h3d/                           # intact native Forge package
    ... Electron files / holtburger-3d.app on macOS ...
  QUICKSTART.md
  LICENSE.md
  THIRD_PARTY_NOTICES...          # actual notices required by shipped components
  build-info.json                # version, source commit, target, micro digest
```

Do not flatten Electron resources or dereference macOS framework symlinks. The root micro archive is not copied into h3d's resources or presented as 3D content. Do not stage the development `dats/` directory wholesale.

The final release manifest records platform verification evidence; per-suite build info supplies identity offline. Checksums exclude `SHA256SUMS` itself. Build info does not attempt to hash its enclosing archive.

### Source-to-publication lifecycle

```mermaid
flowchart LR
  Source[Resolved commit on 3d-next + suite version] --> Matrix[Native platform builds]
  Micro[Regenerated micro ZIP + pinned digest] --> Bootstrap[Noninteractive bootstrap validation]
  Bootstrap --> Matrix
  Matrix --> Inspect[Package checks + architecture/linkage checks]
  Inspect --> Suite[Suite assembly + extracted-suite checks]
  Suite --> Staging[CI artifacts + checksums + manifest]
  Staging --> Draft[One draft GitHub prerelease]
  Draft --> User[Final user native-bundle acceptance]
  User --> Release[Complete published alpha prerelease]
```

### h3d content admission

```text
CLI override or saved selection -> mount -> sentinel in repository index?
  yes -> existing bootstrap and runtime
  no  -> existing recoverable asset-setup path with an actionable diagnostic

automatic portable candidate -> mount -> sentinel present?
  no  -> try platform-data candidate
  yes -> existing bootstrap and runtime

automatic candidates exhausted -> asset setup / choose retail installation
malformed archive or access failure -> visible error; do not silently search past it
```

Apply the same inexpensive indexed sentinel check to selected content regardless of container format; a complete retail portal mount exposes the same resource key. This avoids adding archive-profile or frontend-specific format contracts. A mixed HBA/DAT directory retains HBA-first selection; if that selected family lacks the sentinel, reject the selection rather than silently combining families.

An explicit override is never replaced by automatic search. A saved unsuitable selection is handled through existing recovery, not silently forgotten. Automatic search remains bounded; no registry/cross-disk retail installation scanner is in scope.

## Phased implementation

Checked tasks have implementation or local evidence recorded below; platform-wide acceptance still requires hosted builds. Unchecked tasks remain outstanding. At each milestone record commands, results, source commit, and any course correction in this document.

### Phase 1: Establish artifact prerequisites and platform matrix

Deliverables: agreed matrix and Linux baseline; a concrete route to supply regenerated micro content; alpha tag ownership and CI trigger design.

- [x] Target Linux x86-64, Windows x86-64, macOS arm64, and macOS x86-64 to preserve the existing archive coverage. Identify a native runner for each; verify Intel macOS runner availability before writing the matrix. If unavailable, surface the reduction for a user decision rather than relabel an arm64 binary.
- [ ] Start Linux portability work with the existing h3d probe's `ubuntu-22.04` baseline, subject to confirming current dependency builds. Document any evidence requiring a newer baseline before accepting it.
- [x] Locate the user's retail portal and English localization DATs for local micro generation. Include other DAT roles only where the corrected micro manifest needs them. Existing full HBA alone is not an input supported by `dat2hba`; do not invent a new conversion mode to avoid identifying the real source files.
- [x] Choose a pinned, downloadable location for the approved regenerated micro ZIP and record its SHA-256 in a repository release-content descriptor. Keep it separate from the existing main-nightly mutable URL. The descriptor needs only the URL and expected digest; provenance can be recorded in release notes.
- [x] Define the one-time handoff to that location after Phase 2: manual content-asset upload if necessary. Public build runners receive only the micro artifact, never retail DATs/full HBAs. Verify content before uploading; do not publish the stale current archive as a placeholder.
- [x] Reserve alpha tags such as `alpha-20261026-<shortsha>`, deliberately outside the cargo-dist SemVer-shaped tag pattern. Suite SemVer remains `0.1.0-alpha.1` or the selected successor; publication validates it against manifests, not by parsing the dated tag as SemVer.
- [x] Use alpha tag pushes as the initial publication trigger so a new default-branch workflow installation is not a prerequisite. Verify the tag commit is reachable from `3d-next`; always build the tag's exact commit, never the later branch head.
- [x] Keep a nonpublishing push/PR verification route for `3d-next`. A later scheduled or UI-dispatched channel is separate work requiring the appropriate default-branch workflow installation.

Acceptance: each platform has an honest runner/architecture plan; the retail-to-micro handoff has a usable source and destination; alpha tags cannot also invoke cargo-dist. Unresolved prerequisite questions are recorded before build/publication work proceeds.

### Phase 2: Repair and deliver the micro artifact

Primary files: `crates/holtburger-dat/src/manifest.rs`, its tests, `apps/holtburger-tools/src/dat2hba.rs`, `.github/scripts/fetch_micro_hba.sh` or a narrow alpha-specific consumer, and a focused probe in `crates/holtburger-debug-harness`.

- [x] Add `SecondaryAttributeTable::FILE_ID` to micro retention. Audit the concrete `ClientBuilder::load_assets` readers and character-generation needs against current micro rules; add only missing required inputs.
- [x] Preserve the existing raw-motion pruning contract. Do not restore baked motion or bypass bootstrap errors with synthetic defaults.
- [x] Add synthetic unit coverage showing required table retention and surface-texture exclusion for both small profiles. Use runtime constants for table IDs. Host admission tests use the host-owned sentinel; lower-level `dat` tests must not import the app or create a dependency cycle. Avoid runtime-asset-dependent permanent tests.
- [x] Provide a focused noninteractive diagnostic that mounts a supplied HBA and executes production `ClientBuilder::load_assets`, plus the TUI character-generation reader. It must not open a socket or start the TUI. Retain it as harness tooling, not a suite binary.
- [x] Generate a fresh micro ZIP with corrected `dat2hba --profile micro` from identified retail inputs, then run the diagnostic against it. Record generator commit, digest, size, namespace inventory, and bootstrap result.
- [x] Inspect its contents and confirm it lacks the sentinel and visual resource classes excluded by the micro manifest. Stage only `assets.hba` into the micro ZIP.
- [x] Complete the Phase 1 content-asset handoff and pin the URL/digest. Fetch into a clean staging directory, fail on HTTP errors/digest mismatch/unexpected ZIP entries, and validate the fetched bytes through the same bootstrap diagnostic.
- [ ] Use this exact artifact for all suite archives, the standalone micro asset, and TUI Flatpak. Do not replace the main nightly's input implicitly.

Acceptance: current bootstrap and character-generation reads succeed with the regenerated micro artifact; the existing published five-record micro fails the probe as expected during investigation; every alpha consumer verifies and uses the same digest. Do not retain a permanent test tied to the old downloadable artifact.

### Phase 3: Make application launch and resource lookup release-ready

Primary files: `apps/holtburger-3d/electron/main.ts`, `electron/client-launch.ts`, `scripts/entry-paths.mjs`, their tests and consumers; `apps/holtburger-3d/host/src/protocol.rs`; shared content discovery; TUI content and scripting entry points.

- [x] Change default entry selection to client and remove redundant Explorer fallbacks in the same cutover. Keep explicit `client` accepted and explicit `explorer` functional. Fix positional entry detection to distinguish both short and long flags: the current `!startsWith("--")` would mistakenly treat an initial `-a` as an entry name.
- [x] Swap h3d short port/password aliases. Sweep dev wrappers, probes, fixtures, tests, docs, and surviving examples. Do not keep ambiguous compatibility aliases. Long options retain current meaning; ACE `--port` remains distinct from Vite's dev-server port.
- [x] Test omitted entry with supplied account, including an initial short flag (`-a account -p 9000 -P password`), explicit client, explicit Explorer, both short and long connection flags, missing account, and credential removal from renderer URLs. Missing account remains a clear CLI startup error.
- [x] Define one documented h3d-host sentinel key for `eor/portal:0x0500000C`. Query existing resource metadata without decoding the texture or scanning content payloads.
- [x] Extend existing content candidate iteration with one caller-supplied admission predicate; keep the sentinel and its diagnostic in the h3d host. Preserve absence/empty skipping and error handling for malformed/unreadable archives. Route normal and diagnostic host entry points through consistent admission.
- [x] Integrate explicit/saved rejection with the existing typed content-setup failure and recovery mechanism. Exhausted automatic candidates must explain that a full archive or retail installation is required, without changing the native folder-selection flow.
- [x] Use small synthetic repositories to cover unsuitable first candidate followed by suitable candidate, exhaustion, explicit/saved rejection, valid HBA/DAT selection, and corruption remaining visible. The tests prove admission/lifecycle behavior, not archive completeness.
- [x] Give TUI a portable executable-relative `dats` fallback. Compute the executable directory in the TUI app and pass the portable location into shared discovery; do not teach shared content about executable layout. Preserve ordering: explicit `--dats`, `HOLTBURGER_DATS`, existing working-directory `dats`, executable-adjacent `dats`, platform data directory. Deduplicate identical paths.
- [x] Give bundled TUI scripts an executable-adjacent read fallback using the existing local/system script lookup. Keep `SCRIPT_DIR`, local overrides, and `SCRIPT_BUNDLE_DIR` precedence; script configuration remains associated with the writable local script directory. Do not make changing the current directory or writing into an installed bundle a startup requirement.
- [x] Leave h3d's automatic search bounded to existing roots. Document that the suite's TUI micro is not a 3D installation, including macOS's app-internal executable directory.

Acceptance: synthetic tests establish candidate continuation, recovery, and argument semantics. TUI content and bundled script/sidecar resolution works from an unrelated directory without launching the TUI. Existing explicit paths, local script overrides, and Flatpak environment overrides retain precedence.

### Phase 4: Unify version and source identity

Primary files: workspace/package Cargo manifests, Cargo lockfile, Electron package/lockfile, CLI build/version code, h3d build metadata, and one repository version-maintenance script.

- [x] Make tools and weenie-catalog inherit the workspace package version.
- [x] Add one documented version-bump command taking an explicit SemVer. Update the root Cargo version, Electron package version, and both lockfiles using appropriate package-manager tooling. Do not bump unrelated script-authoring package versions or dependencies.
- [x] Add a read-only consistency check for CI and local preflight. Reject invalid versions and mismatches; do not silently rewrite manifests in the release job.
- [x] Have TUI display suite version plus source revision. Preserve a deliberate development identity without allowing a CI event SHA to substitute for the checked-out source revision.
- [x] Reuse h3d's existing version/revision display and host package version. Capture identity from the resolved checkout once; pass the actual source revision explicitly where CI environment fallbacks could diverge.
- [x] Ensure cached Cargo builds invalidate build metadata when its revision/version inputs change. Capture clean/modified status before staging release outputs; do not mark every release modified because its own staging directory is untracked.
- [x] Leave `PROTOCOL_VERSION`, `HBA_VERSION`, catalog versions, and persisted settings versions unchanged unless a separate compatibility change requires them.

Acceptance: one version command updates all suite version owners and lockfiles; read-only checking catches a deliberately mismatched manifest; CLI display, Electron package/display, host handshake, build info, and release manifest agree. Full source SHA is available for support, even if UI labels abbreviate it.

### Phase 5: Steering checkpoint before CI/publication

- [x] Reassess actual micro size, bootstrap evidence, path changes, native runner availability, and dependency baselines.
- [x] Verify the regenerated micro is available by pinned digest without giving retail assets to public CI.
- [x] Walk the four-platform package flow using final output paths. Resolve `target/<triple>/release` versus Forge's current hardcoded `target/release` before implementing assembly.
- [x] Confirm scope remains CLI-driven startup, one sentinel, no HBA format change, no optional tools, and no updater/launcher.
- [x] Update remaining phases for findings. Raise any platform reduction or baseline increase as a concrete tradeoff before proceeding.
- [x] Use CI and noninteractive evidence for this checkpoint; user native-bundle verification is deferred to the final release handoff and is not a prerequisite here.

Acceptance: remaining packaging and publication work has no unresolved source-asset, target-path, identity, or trigger collision assumptions.

### Phase 6: Build and verify native suites

Primary files: the alpha workflow, reusable build/assembly helpers under `.github/scripts/`, Forge config/package scripts, suite validator, and TUI Flatpak recipe.

- [ ] Adapt the existing portability jobs instead of duplicating their checks. Run a nonpublishing check path for `3d-next`; require Rust formatting/tests/clippy with warnings denied and app checks/lint/tests as applicable.
- [x] Pin the validated runner labels, Rust toolchain, Node version, and package-manager lockfiles used by release builds. Build with Cargo `--locked` and `npm ci`.
- [x] Resolve the source commit once and use it across every job. Confirm it belongs to `3d-next`; fetch enough history for that check. A branch advancing during the run must not change any artifact.
- [x] Build only `tui`, `dat2hba`, `dat-tool`, and `holtburger-3d-host` for the matrix target. Do not use a release `--workspace` build that compiles all diagnostic binaries.
- [x] Make the Cargo target triple explicit and make Forge consume that exact host path. Use native target runners, or implement a single target-aware host-path contract; do not let `npm run package` rebuild a different host implicitly.
- [x] Make Electron platform/architecture explicit and compare Rust and Electron executable architectures to the artifact label. Preserve Forge's private-sidecar exclusion from cargo-dist.
- [ ] Inspect Rust and Electron dynamic dependencies and glibc/symbol requirements on Linux. Record the oldest validated runtime environment; verify no library is unresolved there. Use corresponding executable/dependency inspection on Windows/macOS.
- [ ] Run existing sidecar protocol smoke, package inspection, theme/font runtime checks, and archive checks. Update content-startup fixtures to satisfy the new sentinel gate before later bootstrap failures are exercised; do not allow the new early rejection to make recovery tests hollow.
- [x] Exercise default client startup with CLI arguments through a noninteractive probe. Use explicit Explorer for content-only checks where no ACE connection should be attempted. No interactive TUI execution or agent visual acceptance.
- [x] Assemble the exact suite inventory above. Require both tools; remove best-effort copies and broad script globs. Include required notices and the user quickstart.
- [ ] Preserve the TUI Flatpak's separate writable local scripts and bundled scripts, with the same micro digest. Run a no-network bootstrap/load probe inside its runtime rather than relying only on a successful Flatpak build.
- [x] Validate the final suite after extraction, not only the nested Forge package. Reuse the existing package inspector on extracted h3d and check native symlinks/modes, expected files, micro digest, build identity, and script sidecar pairs.
- [x] Inspect the shipped inventory for unintended local files and full content. Permit Electron's own `icudtl.dat` and runtime blobs; a blanket ban on every `.dat` filename is incorrect. Validate the exact permitted micro archive rather than assuming any `.hba` is safe.
- [ ] Generate final filenames, per-suite build info, global release manifest, and checksums from inspected bytes. Store candidate artifacts in CI without publishing for build-verification runs.

Acceptance: every included platform has a correctly identified archive that passes final extraction inspection and relevant noninteractive runtime checks. Flatpak and standalone micro match suite content. No unchecked copy, missing file, target mismatch, or local full-data dependency can pass the workflow.

### Phase 7: Cleanup, documentation, and candidate review

- [x] Write durable quickstart content covering native executable paths on all OSes, long-form connection arguments, explicit Explorer, user-supplied retail data, and the TUI micro/full distinction.
- [x] Document macOS CLI invocation of the executable inside `.app`, unsigned-app limitations, and verified platform prerequisites. Do not imply double-clicking without credentials enters a game.
- [x] Describe user data, caches, script overrides, and writable script preferences. Do not ship live credentials or personalized configuration examples.
- [x] Sweep outdated h3d short flags, Explorer-default claims, and release descriptions only in active code/docs touched by this change. Historical inactive plans do not need rewriting.
- [x] Decide whether to omit diagnostic HTML entries from release Vite inputs; do so only if cleanly separable from existing verification. Source maps can remain in alpha. Neither is a reason to delay shipping.
- [x] Remove obsolete staging helpers, duplicate packaging paths, dead tests, and any temporary asset-dependent tests. Keep useful probes in diagnostics tooling.
- [x] Review the complete diff for crate/app boundary violations, unnecessary type fields, fallbacks, line-count growth, and accidental scope expansion.
- [ ] Run the required checks once against the final candidate commit. Rebuild only when changes invalidate prior evidence. Prepare a short final native-bundle checklist covering extraction, OS launch, CLI arguments, content selection, and basic client use; do not require the user to execute it in this phase.

Acceptance: candidate artifacts and quickstart are concrete and reviewable; cleanup is complete; remaining platform limitations are accurately documented. No implementation work remains concealed behind a future launcher or unperformed asset generation. User native-bundle acceptance remains pending until the complete draft release is available.

### Phase 8: Publish and verify the first alpha

- [ ] Once execution/publication is authorized, create the selected non-SemVer-shaped alpha tag at the verified commit. Do not stage or commit changes without an explicit request.
- [ ] The tag workflow repeats required validation and creates a draft prerelease only for its exact source commit. Keep write permissions limited to publishing jobs; PR jobs must not publish.
- [ ] Upload the complete suite matrix, TUI Flatpak, standalone micro ZIP, manifest, and checksum file to that draft. Verify the expected asset inventory and checksums/identity before handing it to the user. Keep the release unpublished at this point.
- [ ] At this final handoff, provide the draft release link, exact candidate commit/version, checksums, known limitations, and the native-bundle checklist. The user verifies the platforms available to them now; record results and any unverified platforms separately from CI evidence. No earlier phase depends on these manual checks.
- [ ] If native acceptance exposes a defect, fix it and produce a new identified candidate. Repeat affected automated checks and user checks against the replacement artifacts; do not silently substitute bytes already tested by the user.
- [ ] Publish after final user acceptance and publication authorization. Promote the exact staged bytes that were tested; the publication step must not rebuild them. Platforms unavailable to the user retain explicit experimental/unverified status rather than invented acceptance evidence.
- [x] On reruns, validate tag/source identity and reuse matching draft artifacts or fail clearly on conflicting content. Do not silently move tags or overwrite an already published alpha with different bytes.
- [ ] Mark the release as a prerelease and avoid changing stable/latest-channel intent. Keep `nightly` and its main-branch workflow independent.
- [ ] Fetch representative published assets and verify hashes against the uploaded checksum manifest; compare the release's actual asset list with the expected matrix. Inspect a published suite's extracted layout using the same validator.
- [ ] Verify the release points to the intended source commit and that the cargo-dist workflow did not race to publish another release for the same tag.
- [ ] Record the release URL, commit, version, micro digest, CI run, verification results, and remaining limitations here. Ship build instructions/source reference alongside the binaries and retain component notices.

Acceptance: a public GitHub prerelease contains the complete agreed artifact set for one source commit, downloadable bytes match checksums, and the existing TUI nightly remains intact.

## Validation map

| Concern | Evidence required |
| --- | --- |
| Micro retention | Synthetic manifest tests using real table constants; generated artifact passes production bootstrap and character-generation reads. |
| h3d gate | Synthetic content tests for sentinel present/absent, candidate continuation, explicit/saved recovery, and visible corruption. |
| CLI contract | Default entry and explicit modes; short/long flags; missing account; credentials absent from renderer URLs. |
| Portable TUI | Injected directory tests from an unrelated working directory for content, scripts, sidecars, and override precedence; no interactive client run. |
| Version identity | Consistency checker, CLI build output, h3d metadata, host handshake, and manifest all identify the same version/commit. |
| Rust quality | `cargo fmt --all --check`; affected package tests and `cargo clippy ... --all-targets -- -D warnings`; extend existing workspace gates where appropriate. |
| Frontend quality | Existing `npm run check`, `npm run lint:ts`, `npm run test:ts`, `npm run check:branding`; other established lint gates as needed by touched code. |
| Package runtime | Existing smoke/content/theme checks adjusted for client-default and sentinel admission; no asset-free test accidentally claims real-content success. |
| Native portability | Target inspection plus native runner/runtime dependency checks for shell, host, and tools throughout implementation; user-owned native/visual acceptance only at the final draft-release handoff. |
| Final download | Extracted suite and native package validation, symlink/mode checks, micro digest, exact inventory, and checksum round trip after publication. |

## Risks and mitigations

| Risk | Mitigation / accepted limit |
| --- | --- |
| Micro generation has no accessible retail source inputs | Resolve paths before implementation depends on an artifact; do not send full data to public CI. |
| Old main-nightly micro is reused accidentally | Separate alpha content descriptor with digest and production bootstrap validation. |
| Sentinel is treated as completeness certification | Name it as a cheap h3d admission check; preserve normal runtime failures. No format change or content census. |
| New gate stops recovery probes at the wrong stage | Include the sentinel in minimal synthetic fixtures intended to test later failures. |
| Micro masks retail DATs in one directory | Preserve family selection, isolate TUI data, reject unsuitable h3d selection with guidance. |
| Local binaries accidentally enter release | Build in pinned native CI environments; inspect linkage/architecture and accept only outputs tied to the resolved commit. |
| Intel macOS runner is unavailable | Treat as an early feasibility decision. Never advertise the other architecture under its filename. |
| Host-path change is defeated by npm's implicit Cargo rebuild | Establish one target-aware host selection and build once before Forge packages it. |
| CI event SHA differs from checkout | Resolve and distribute checked-out commit identity explicitly; validate tag, manifest, and embedded labels. |
| Two release workflows react to alpha tag | Use a disjoint tag namespace and verify the trigger behavior before publishing. |
| Tag-push workflow bypasses default-branch dispatch assumptions | Start with explicit alpha tag pushes; later UI/schedule support is optional follow-up. |
| Signing/desktop behavior differs across OSes | State unsigned/experimental status and record actual native verification. Do not disable Electron sandboxing to make tests pass. |
| User native-bundle checks are unavailable during implementation | Progress using CI/noninteractive evidence; stage the complete draft release before the final manual handoff, then publish those exact tested bytes. |
| Packaging effort grows into product feature work | Keep launcher/login/updater, completeness validation, optional tools, and extra formats excluded. |

## Definition of done

- [ ] Agreed suite binaries/resources, TUI Flatpak, and standalone micro are present as GitHub Release assets.
- [ ] Corrected micro artifact initializes current TUI content and is shared by digest across consumers.
- [ ] h3d defaults to client, retains explicit Explorer, and uses TUI-compatible port/password flags.
- [ ] h3d uses the sentinel for admission without archive format changes or a thorough content validator.
- [ ] Portable TUI resource lookup works independently of the invocation directory.
- [ ] Suite version and exact source commit agree across package metadata, displayed identities, tags, and manifests.
- [ ] Platform labels match executable architectures; Linux dependencies and baseline are verified.
- [ ] Required formatting, tests, lint/clippy, package checks, and extracted-suite checks pass without ignored warnings.
- [ ] No full retail assets, optional tools, private data, or local caches are in the published inventory.
- [ ] Quickstart and release notes explain CLI launch, retail-data selection, unsigned status, and platform verification limits.
- [ ] Published assets pass checksum verification; the existing main nightly remains operational.
- [ ] Final user native-bundle/visual acceptance and any unverified platforms are recorded without overstating support; published bytes match the accepted candidate.

## Open execution questions

These do not block writing the plan; resolve them at the named phase before dependent work.

1. **Phase 1:** Where are the retail portal/localization DATs for regenerated micro content, and where should its pinned downloadable ZIP live? Investigation found only the full HBA and stale micro ZIP under local `dats/`.
2. **Phase 1:** Is a usable native Intel macOS runner available? Default scope preserves all four nightly archive targets; any reduction needs an explicit decision.
3. **Phase 4:** What is the first suite version? Proposed `0.1.0-alpha.1`, independent of the dated alpha tag.
4. **Phase 8, final handoff:** Which platforms can the user exercise interactively? Their native-bundle checks are unavailable before this point. Publish truthful experimental status for the rest; do not manufacture acceptance evidence.
5. **Resolved implementation gap:** Rust notices now use pinned cargo-about, checksum-verified upstream clarifications, a bounded metadata-only exception, and a pinned native-library appendix. Generation and packaging are locally verified below; hosted consumption remains pending.

## Decisions and execution journal

- **2026-10-26, planning:** Accepted one-sentinel admission; rejected HBA metadata/version changes and exhaustive checks.
- **2026-10-26, planning:** CLI-only connection setup remains intentional; a separate launcher is future work. Default h3d client startup without account arguments is expected to fail clearly.
- **2026-10-26, planning:** Micro HBA and existing script-derived data are approved bundle content. Specialized tools and full retail content are excluded.
- **2026-10-26, planning:** h3d adopts TUI short flags (`-p` port, `-P` password) with a clean cutover.
- **2026-10-26, planning:** Preserve TUI Flatpak and standalone micro downloads. Keep alpha publication separate from the existing main nightly and cargo-dist tag namespace.
- **2026-10-26, user clarification:** Native release-bundle verification is possible only at the end. Complete implementation, automated checks, and draft artifact assembly first; final user acceptance precedes publication of those same bytes.
- **Implementation:** Active. Remaining unchecked items require the final local audit, hosted CI evidence, or final user acceptance.

### Local implementation evidence (2026-10-26)

- Retail inputs located at `/home/cluracan/data/ace/Dats/client_portal.dat` and `client_local_English.dat`. No full data was copied into release staging.
- Native runner contract: `ubuntu-22.04`/Linux x64, `windows-2022`/Windows x64, `macos-14`/arm64, and `macos-15-intel`/Intel. Intel availability verified against the official GitHub runner reference; actual matrix runs remain pending.
- Corrected micro: 8,446 records (8,445 portal, one language); HBA 2,762,679 bytes, deterministic ZIP 1,546,684 bytes. SHA-256 `df24573f24e4ca46398041ab70c9188825ad6a82e5db229c4146fe8d757aa098`. Production bootstrap and CharGen load passed with 13 heritage groups. Old micro fails at missing `0x0E000003`.
- Generator was built from the current worktree based on `06e2a97af1cc193f7886033826e6f13dd47925a3` with the micro-filter correction; no generator commit has been created. Input is staged in unpublished content draft release ID `424889586`, asset ID `679860746`; `.github/alpha-content.json` pins its API URL/digest. The actual CI download helper fetched and verified it successfully.
- Chosen suite version: `0.1.0-alpha.1`. Version command and consistency check succeeded; Cargo.lock changed only workspace package versions, npm lockfile only root version entries.
- DAT/content library tests: 132 and 134 passed. Initial focused h3d content-admission tests passed; argument tests passed (61 tests). Full h3d TypeScript checks/lint passed; 415 files / 3,823 tests passed after release identity/handshake changes.
- Synthetic HBA and DAT fixtures now include an authored sentinel so sidecar/recovery probes reach their intended later failures. Four sidecar mode/family combinations passed. Automated Electron recovery passed both modes; it will be repeated with default-client launch and the final targeted host. No screenshots or user visual acceptance were performed.
- Affected Rust clippy checks passed with warnings denied, including the bootstrap harness. Full native unit tests are in progress: a socket-binding test required unsandboxed loopback access after a sandbox EPERM.
- Release tooling unit tests passed (8); new alpha workflow passes actionlint. Local explicit-target suite build is in progress; V8 archive download required network access after sandbox DNS failure.
- The alpha workflow only stages a complete draft on alpha tags. There is no automatic final publication; exact staged bytes are reserved for the user's final verification.

### Final local checks and stop point (2026-10-26)

- Explicit-target builds of all four suite executables and the bootstrap probe succeeded. The TUI compiler output reports `0.1.0-alpha.1 (06e2a97a)`; the TUI itself was not launched.
- Native Rust unit tests passed with loopback permitted: host library 392 tests, TUI library 324 tests, and TUI binary parser/bootstrap tests 16 tests, plus other selected targets. The added local/bundled script-path assertions also passed their focused test after the final cleanup edit.
- Target-aware Forge packaging succeeded. A local Linux suite was assembled and inspected both before and after extraction: approximately 157 MiB compressed. It remains a modified-worktree diagnostic candidate, not a publishable release.
- The extracted suite passed the real automated packaged Electron content-recovery probe in Explorer and default client mode, including persisted failure, next-launch setup, override isolation, reset, and bounded shutdown. No native user acceptance or visual review has occurred.
- Release-tool unit tests passed (10), including matching-draft reruns, refusal to alter published releases, and conflicting-asset refusal. Actionlint passed. Rust formatting and version consistency checks passed. Hosted matrix/Flatpak verification is still unperformed.
- **Major gap:** The assembly currently includes application, Electron/Chromium, and font notices but lacks a complete Rust dependency notice bundle. Metadata inspection found 422 external packages in the suite dependency/build graph; 26 have no root standalone license/notice file. Copying those files alone is insufficient.
- Tried the standard generator `cargo-about` 0.9.3, installed under `/tmp` only. A locked Linux TUI report with `--fail` succeeded but assigned generic MIT text containing `Copyright (c) <year> <copyright holders>` to `v8`, `deno_core`, and `binrw`. The report/config remain ignored local diagnostics; they were not shipped or accepted as resolved notices. Generated report: `.holtburger-local/alpha-rust-licenses.json`.
- Proposed refinement: a dedicated notice-generation task using upstream texts pinned to dependency revisions, with validation against placeholders and explicit handling of native libraries embedded by Rust crates. Cover the complete suite graph and include the resulting notices in archives and Flatpak. This is a required artifact gap, not a request for user native testing or a claim about legal compatibility.
- Stopped at this gap as requested. No application alpha tag, source commit/push, or published application release was created. Only the previously verified micro input is stored in an unpublished content draft. GitHub-native matrix runs will also require a committed/pushed source revision after the remaining implementation is ready; standing instructions prohibit creating commits without a request.

- Final handoff checks: 83 focused entry/connection/handshake TypeScript tests passed; local/bundled script-path regression passed; version consistency, actionlint, and all 10 release-tool unit tests passed. No application release was published.

### Notice completion and resumed implementation (2026-10-26)

- The earlier stop overclassified a tractable implementation task as a blocker. Work resumed without requiring user native testing or an additional product decision.
- Added `generate_notices.py` using cargo-about 0.9.3 and `.github/about.toml` across all four target graphs. The resolved report has 403 packages and 133 license-text groups. Upstream clarifications use exact hashes; original combined AWS-LC notices remain intact. Apache-first selection uses declared SPDX alternatives rather than fabricating missing MIT attributions.
- `deno_core_icudata` 0.74.0 has no standalone notice in its published crate or pinned repository. The generator explicitly labels its declared MIT text as metadata-sourced, omits only the canonical placeholder attribution, and never invents ownership/year. Unexpected leading template attributions fail generation; license-appendix examples are preserved.
- Vendored 29 original V8/native-library notice files with pinned URLs, hashes, and explicit encodings in `.github/native-notices.json`. The data crate's ICU bytes match the pinned ICU `common/icudtl.dat` Git blob `331d2f39dc500327bf138b4f3f1e5105da384932`; provenance is retained in that descriptor. Native package-version drift requires notice review.
- Real notice generation passed, producing a roughly 940 KiB HTML artifact. Suites include it at their root; metadata and final aggregation validate its hash. The workflow generates it once, shares it across consumers, and stages it as a separate reviewable release asset.
- Alpha Flatpak uses a generated JSON extension of the shared recipe, preserving main-nightly inputs. Local Flatpak assembly succeeded; runtime `sha256sum` proved the installed notice and micro HBA exactly match approved inputs, without launching TUI. The production-bootstrap runtime probe still needs the Ubuntu 22.04 hosted build: locally linked binaries require a newer glibc than the Flatpak runtime.
- Release tooling now passes 17 unit tests, including notice-text preservation, HTML escaping, bounded metadata handling, native digest/version drift, complete matrix aggregation, and shared-notice identity. Actionlint, version consistency, and diff whitespace checks passed.
- HEAD advanced independently to `e510835a8aab44ca0650cb16e3dec13fa5eececc`. Suite verification correctly rejected the earlier renderer revision; Rust binaries and renderer were rebuilt and Forge repackaged against the current checkout. This remains a modified-worktree diagnostic candidate, not publishable bytes.
- The rebuilt Linux suite passed final extraction inspection and the automated packaged content-recovery probe in both Explorer and default client modes. Final review removed inaccurate crates.io links for unpublished workspace packages from the generated notices; the final notice artifact was regenerated and affected package assembly repeated. No visual acceptance was performed.
- Remaining gates: committed/pushed source for hosted matrix and Flatpak bootstrap evidence, complete staged application draft, then final user native acceptance and publication authorization. No application commit, push, tag, or published release has been created by this work.

- **User authorization:** Commit and push the completed release implementation to `3d-next` for hosted verification. Final publication and native acceptance remain separate gates.

### First hosted run and content access correction

- Committed the implementation as `b11505d72819502e2703409231522c71bb211552` and pushed `3d-next`. Hosted run `40428975869` passed source/version identity, all 17 release-tool tests, formatting, and notice generation/upload.
- Native/Flatpak consumers failed before compilation: GitHub returned HTTP 403 for the draft micro asset using read-only `GITHUB_TOKEN`. Local testing with a maintainer token had not proved CI's narrower access.
- Published the already approved, bootstrap-verified micro ZIP as the non-latest, content-only prerelease `content-alpha-df24573f24e4ca46`. The asset ID and digest are unchanged. An anonymous API download retrieved 1,546,684 bytes and matched the pinned SHA-256. This avoids granting release-write permissions to build/PR jobs; application publication remains gated on final user native acceptance.
