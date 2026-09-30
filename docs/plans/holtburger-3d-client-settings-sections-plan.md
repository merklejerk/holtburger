# H3D Client Settings Sections Plan

## Context and boundaries

**Goal:** Let H3D worktrees share future settings safely by loading and saving independently versioned settings sections, while introducing the new format without changing the legacy file used by an older worktree.

In scope: a versioned collection format, section-level validation and saves, a global new-format default, a worktree-local settings file selected by the main-process `--settings-file` override, a one-off legacy conversion script, and focused verification. The renderer may keep a composed `ClientUserSettings`/`ClientCharacterSettings` view for normal use. Out of scope: automatic migration during app startup, synchronization between simultaneously running clients, settings import UI, and changes to game/server configuration.

The existing shared development file remains byte-for-byte untouched during this rollout. The default development destination remains `client-settings.json` in the shared development user-data directory. The packaged default uses the same filename in its separate user-data directory. This worktree selects `<worktree>/.holtburger-local/client-settings-sections.json` (ignored by Git) with `--settings-file`. The override accepts a path in client mode only and stays in Electron main, never the renderer URL. The development wrapper resolves relative paths from npm's original invocation directory before starting Electron. A supplied legacy file is rejected with an actionable conversion error rather than rewritten.

## Ground truth and constraints

- `electron/main.ts` currently loads `client-settings.json` before window creation; `--ignore-config` only changes later renderer reads. Native window geometry therefore needs its own pre-renderer load path.
- `electron/client-settings-store.ts` reads one complete document and atomically replaces it on each save. Its queue serializes one process, but does not coordinate processes. A permissive parser alone would discard unknown data when this store writes.
- `src/client/client-settings-contract.ts` has strict whole-document schemas and v1–v13 migrations. This worktree's version 13 adds `hudLayout.book`. A read-only check of the shared Linux development file found **a different version 13**: it has `characterSheet` and lacks `book`. Its other recognized user, HUD, window, and character sections pass the current value validators. The converter must recheck its input when run; the version number alone does not identify the shape.
- `src/client/ClientApp.svelte`, `client-character-settings-owner.ts`, `client-settings-transport.ts`, `electron/preload.cts`, and `electron/main.ts` load/save complete user or character snapshots. `ClientWorldView.svelte` identifies the moved HUD surface internally but emits a complete layout; its reset path also emits a complete layout.
- `scripts/entry-paths.mjs` partitions main-process client flags before constructing the renderer URL. `electron/client-launch.ts` validates them. `electron/client-user-data.ts` currently shares one development profile among worktrees.
- `src/client/client-settings-defaults.ts` builds viewport-dependent user defaults in the renderer. Keep default computation there; the store reports missing or incompatible sections rather than inventing UI defaults.

### Durable contract

Use one JSON file with a stable `formatVersion: 1` envelope, user sections, a map of independently versioned HUD placements, and character profiles containing independently versioned sections. Each entry is `{ "version": 1, "value": ... }`. The envelope version changes only if the collection structure changes; adding a section or HUD surface does not change it.

```json
{
  "formatVersion": 1,
  "user": {
    "window": { "version": 1, "value": {} },
    "graphics": { "version": 1, "value": {} },
    "input": { "version": 1, "value": {} },
    "hudPlacements": {
      "inventory": { "version": 1, "value": {} },
      "book": { "version": 1, "value": {} }
    }
  },
  "characters": {
    "<profile-key>": {
      "actionBars": { "version": 1, "value": [] },
      "spellBarBindings": { "version": 1, "value": {} },
      "combatControls": { "version": 1, "value": {} }
    }
  }
}
```

The omitted user keys are `spellBarShape`, `minimapViewDiameters`, `chatFilters`, `ui`, and `inspection`; character profiles also retain `lastKnownName` as an independently saved section. These are semantic ownership boundaries, not one entry per scalar. Give `statusTray` its existing special placement validator. Keep each known section's value strict and typed. Preserve unknown section and HUD keys as unmodified JSON values when the file is rewritten; whitespace and formatting need not be byte-identical. For a known key with a newer version or malformed value, report that key as unavailable, use a renderer default for the session, and refuse a save to that key; unrelated keys remain usable. A malformed envelope or unsupported `formatVersion` remains a file-level error. Do not silently downgrade a section.

Saves identify one user section, one HUD surface, or one character section by profile key. A HUD reset sends a batch of **known** surfaces; it never replaces the whole `hudPlacements` map. Queue save **operations**, not precomputed whole-document snapshots: inside each queued operation, the store re-reads the selected file, validates the target's existing version, changes only that entry, and atomically replaces the file. Untouched raw entries survive. Simultaneous processes using the same file still have last-writer-wins races between read and replacement; the worktree-local override avoids that case during this rollout. Do not claim cross-process transactionality without adding a real file lock.

### Conversion and promotion

The one-off script reads an explicit `--from` legacy file and writes an explicit `--to` new-format file. Run it **before the first new-app launch**, which could create the local target from defaults. It accepts a v13 legacy envelope, validates each recognized user, HUD, window, and character value independently, and wraps unknown user/character sections and HUD placement keys as opaque version-1 entries. The observed `characterSheet` placement must survive conversion; the absent `book` placement remains missing so this worktree supplies its normal default. The script fails on an unsupported source version, unknown top-level structure, invalid known values, or an existing target. It writes the target with private permissions and never changes the source. It records the source SHA-256 in an adjacent `<to>.legacy-source.sha256` file for the later promotion check. It can use the app's built settings validators, but legacy-document recognition and mapping live only in the script. No legacy migration code runs in Electron or the renderer.

After the new format is merged and older worktrees no longer need the legacy file, the user may copy the local collection over the global `client-settings.json` and launch without `--settings-file`. This replaces the legacy data at that path, so older worktrees can no longer read it. Before promotion, compare the legacy source with the converter's recorded hash. If it changed since conversion, convert the current legacy file into a second temporary file and reconcile changed sections against the local collection; a blind copy would lose later edits. The app itself does not perform this promotion.

## North stars

1. Accept additions locally: a new HUD panel adds one placement entry, not a global schema bump.
2. Preserve what this build cannot understand; validate what it does understand at every IPC and disk boundary.
3. Make write ownership visible in commands. Full in-memory snapshots must not become full-file save requests.
4. Keep the legacy shared file outside the new app's write path throughout the worktree rollout.
5. Cut the old runtime migration chain after the conversion script and new loader are proven.

## Phased implementation

### Phase 1: Section codec and store

- Extract current value validators into user-section, HUD-placement, window, and character-section contracts. Keep composed runtime types where useful, but remove the durable v1–v13 union from app runtime after cutover.
- Add collection envelope parsing that retains opaque unknown entries and reports missing/incompatible known entries. Add targeted writes and a known-surface batch reset in `client-settings-store.ts`.
- Test unknown sections and unknown HUD panels surviving unrelated writes, known future-version sections refusing writes, malformed known sections remaining isolated, native window read/write, and multiple character profiles. Exercise read-merge-write with a second sequential store instance.

**Acceptance:** a v1 collection file can be loaded and changed without deleting an unknown entry or downgrading an unsupported section.

### Phase 2: Launcher and frontend cutover

- Add `--settings-file` to `entry-paths.mjs`, `client-launch.ts`, Electron main, tests, and README. Keep the unpackaged default in its global development user-data directory and select the worktree-local path explicitly; add `/.holtburger-local/` to `.gitignore`. Reject the override in Explorer mode and reject empty paths; resolve relative paths from the invoking directory.
- Replace whole-snapshot preload/IPC saves with typed section commands. Compose loaded sections with renderer defaults. Change user/character mutation owners to publish only their changed section. Change HUD callbacks to carry the changed surface; make reset publish a batch of known surfaces.
- Preserve `--ignore-config` as a deliberate reset of supported known values while retaining unknown and newer-version entries; surface any refused reset rather than claiming it was saved. Keep native window restoration independent of renderer settings.
- Test CLI partitioning, preload transport contracts, cold settings hydration, character generation gating, HUD move/reset granularity, and `--ignore-config` behavior.

**Acceptance:** development launch with `--settings-file` and all renderer saves target the local file; a read-only before/after hash of the shared legacy file is identical after launch, window resize, HUD drag, and character settings saves.

### Steering check

Review the resulting API and file size before scripting migration. If the store has become a generic settings framework, collapse it back to the actual user, HUD, window, and character sections. Simulate a collection-aware client whose known HUD set excludes `book`: when it saves `chat`, the `book` entry must remain structurally equal. An existing v12 worktree cannot read the collection format and instead remains on the untouched legacy file.

### Phase 3: One-off converter and rollout proof

- Use a temporary script-only conversion command with current value validators; remove the script, its tests, build configuration, and npm command after the local file is created. Refuse source/target equality (including path aliases), an existing target or hash sidecar, invalid known v13 data, and source versions other than the supported input; leave the source and any pre-existing destination untouched on failure. Clean up newly created output if final publication fails.
- Test conversion with two synthetic v13 fixtures: this worktree's `book` layout and the observed sibling-worktree shape with `characterSheet` but no `book`. Include window, every recognized user section, multiple character profiles, and names. Validate the output with the new loader, compare all recognized values, and assert that opaque `characterSheet` survives and the missing `book` uses a runtime default; verify source bytes are unchanged. Run the converter against a **copy** of the observed development file into a temporary destination for a local dry run, without modifying the shared original.
- Document the explicit `--from`, `--to`, and `--settings-file` commands and the source-hash check before eventual promotion. Do not automatically copy or promote into the global path.

**Acceptance:** the converter creates a usable local collection file while the legacy shared file and older worktree remain functional.

### Phase 4: Cleanup and verification

- Remove obsolete whole-document save calls, runtime historical migrations, unused versioned contracts, stale schema-version wording, and the temporary conversion tooling after its one-time run.
- Run `npm run check`, `npm run lint`, `npm run format:check`, `npm run test:ts`, and `npm run build:electron:main` in `apps/holtburger-3d`. Add a noninteractive Electron settings startup check using an isolated override path so the actual preload/main wiring is exercised. Do not run the TUI or perform visual acceptance.

**Done when:** the book placement needs no document migration; older compatible section readers can preserve it while changing their own settings; this worktree selects a local file through `--settings-file`; a one-time converter produces it from the legacy file; and the legacy shared file remains unchanged throughout this worktree rollout.

## Risks and concessions

- An older already checked-out worktree cannot read the new collection format until it receives the new parser. Keeping its shared file legacy avoids breaking it during rollout.
- The current shared development file is v13 today, but its HUD keys differ from this worktree's v13. The script validates recognized sections independently, preserves `characterSheet` as opaque data, and refuses unknown top-level structure or changed known-section shapes. It rechecks the file at conversion time.
- An unknown section is retained, not validated. A known incompatible section is visible as unavailable and cannot be overwritten. Default runtime values for it are not evidence that persistence succeeded.
- Worktree-local settings are lost if the worktree is deleted without copying the file. The ignored directory is intentional; do not put persistent settings in `target/`, which cleanup can remove.
- Packaged installations with legacy files at the default path reject them until the settings are converted externally. There is no unattended packaged migration in this slice.
- Concurrent writers using the same file remain outside the guaranteed behavior. Sequential independent saves re-read and merge; simultaneous writes require a separate locking change.

## Open questions

None for implementation. Global promotion is a later manual step and requires checking whether the legacy file changed after conversion.

## Execution record

- Implemented the section collection, targeted IPC saves, global new-format default, and worktree-local override. Removed the runtime v1–v13 migration chain and historical keyboard schemas.
- Ran the temporary converter once against the shared legacy file to create the ignored worktree-local collection, then removed its source, tests, TypeScript build configuration, npm command, and generated output. The local collection and its source-hash sidecar remain ignored by Git.
- Converted a temporary copy of the observed shared v13 file. The source copy was unchanged; the output retained all 20 HUD placements, including opaque `characterSheet`, contained two character profiles, and left `book` absent for this build's default.
- The noninteractive Electron probe started with an isolated override, mounted the renderer, read a future-version `book` placement through preload, and saved chat filters without changing that placement. The probe exposed and fixed development argument parsing when Chromium switches precede the app path.
- The probe also launched npm from a temporary directory with a relative `--settings-file` value and confirmed that the file in that invoking directory was selected.
- `npm run check`, `npm run test:ts` (2,691 tests), `npm run lint`, and `npm run build:electron:main` passed. Formatting and final diff checks are performed at completion.

## Merge integration with the character panel

- Kept the section-based runtime and durable format, adding `characterSheet` as a known version-1 HUD placement alongside `book`. Preserved the character/progression event contracts and both browser probe entrypoints.
- Replaced historical settings migration tests with the incoming section tests and focused coverage for restoring and updating character panel geometry, preserving unrelated placements, and refusing newer panel versions during saves and resets. Extended the Electron startup probe to exercise the character panel placement across preload and main.
- Recreated conversion as temporary tooling outside the repository. A dry run against a copy passed before creating this worktree's ignored `.holtburger-local/client-settings-sections.json` and source-hash sidecar. The local collection retains all 20 legacy HUD placements and both character profiles. `book` is absent and receives the renderer default. The legacy source remained byte-for-byte unchanged.
- The local collection is selected with the README's `--settings-file` launch command. The shared global file remains legacy; promotion requires a separate explicit step and a fresh source-hash comparison. No conversion code was added to application startup.
- Combined verification passed: affected Rust test suites, workspace clippy with warnings denied, Rust formatting, app type checks, TypeScript/dead-code lint, 2,702 TypeScript tests, Electron build/runtime checks, character panel and book browser probes, and the Electron settings startup probe. The initial concurrent book/settings runs failed during module load or mount; each passed when repeated without competing development servers. Live server spending and visual acceptance were not performed.
