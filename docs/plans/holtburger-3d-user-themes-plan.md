# H3D user themes

Status: implemented and automatically verified; the user confirmed the local verification theme worked. Created 2026-10-25. Phase evidence is recorded below; the ground-truth section preserves the implementation's starting point.

## Goal and boundaries

Let client users discover, select, reload, and remember local CSS themes with bundled images and fonts, while preserving component and game-runtime lifetimes.

In scope:

- One themes directory under Electron's existing user-data profile; development and packaged profiles remain separate.
- Folder discovery, an Electron asset protocol, typed preload access, and client UI settings integration.
- The same theme controls in the existing pregame and in-game appearance settings.
- Relative image, font, and CSS import URLs; reloads refresh those dependencies too.
- Automated correctness checks and user-owned visual acceptance.

Out of scope: an editor, theme marketplace, ZIP installation, manifests, automatic file watching, arbitrary external search paths, remote theme resources, or a public picker for the loader's second override sheet. Explorer retains Base; discovery/serving remains mode-independent, but an Explorer picker and persisted selection are deferred. No shared Rust crate, sidecar, game-content, or retail-behavior changes.

This plan builds on the current working-tree consolidation of the former Standard theme into `src/app/ui-base.css`. Preserve that work. Earlier theme plans are historical context, not requirements for this feature.

## Ground truth

Paths below are relative to `apps/holtburger-3d/`.

| Concern               | Existing implementation and consequence                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appearance            | `src/app/ui-base.css`, `base.css`, `ui-theme.ts`, `mount.ts`: complete Base appearance; ordered `base, components, theme, overrides` layers; queued stylesheet replacement preserves the active selection on resource failure. `replace(null, null)` restores Base.                                                                                                                                      |
| Native ownership      | `electron/main.ts`, `preload.cts`, `client-user-data.ts`: main owns filesystem access and validates IPC senders. User data already separates development and packaged profiles. No custom asset protocol exists. Product startup also installs content admission and starts a host; the Phase 1 asset-only probe needs its own diagnostic main entry.                                                    |
| Loading origins       | `electron/main.ts:loadEntry`, `vite.config.ts`: development uses an HTTP origin; production uses built files. Vite's filesystem allowlist is not a user-theme solution.                                                                                                                                                                                                                                  |
| Content policy        | `client/index.html`, `explorer/index.html`: styles, fonts, and images currently lack permission for a theme scheme. Keep script permissions unchanged.                                                                                                                                                                                                                                                   |
| Settings              | `src/client/client-settings-contract.ts`, `client-settings-defaults.ts`, `client-settings-sections.ts`, `client-settings-transport.ts`, `client-settings-persistence.ts`; `electron/client-settings-store.ts`, `client-settings-repair.ts`: UI preferences are one independently persisted user section with existing repair/defaulting behavior.                                                        |
| Bootstrap             | `src/client/main.ts`: user settings load after content admission and before `ClientApp` mounts. `src/explorer/main.ts` has no equivalent settings bootstrap.                                                                                                                                                                                                                                             |
| Controls and mutation | `ClientAppearanceSettingsControls.svelte` is reused by `ClientSettingsPanel.svelte` and `ClientPregameSettings.svelte`. The gameplay path passes through `ClientGameplayView.svelte`; `ClientBindingProbe.svelte` also constructs the settings panel. `ClientApp.svelte` owns UI mutations, coalesced persistence, and close preparation.                                                                |
| Fonts                 | `ClientApp.svelte` applies explicit font preferences at the client appearance scope; Theme default leaves them inherited. `client-combat-effects-appearance.ts` already requests font faces and invalidates the combat glyph atlas on `loadingdone`. Its `fonts.load` rejection currently has no handler; `ContentStartup.svelte` turns global unhandled rejections into an application failure overlay. |
| Native diagnostics    | `scripts/client-settings-startup-probe.mjs`, `scripts/cdp-client.mjs`: precedents for non-interactive Electron probes. `scripts/verify-electron-settings-runtime.mjs` checks emitted Node ESM dependencies.                                                                                                                                                                                              |

External references: [Electron protocol registration and handling](https://www.electronjs.org/docs/latest/api/protocol), [scheme privileges](https://www.electronjs.org/docs/latest/api/structures/custom-scheme), and [CSS font loading](https://www.w3.org/TR/css-font-loading/). Check installed Electron declarations when choosing API details. Standard-scheme registration must occur before app readiness; the handler belongs to the window's Electron session.

## North stars and contracts

1. Base remains complete and directly imported. User themes are optional CSS overrides; reuse the existing loader rather than creating another style-application path.
2. Main owns paths and asset URLs. Renderers exchange theme IDs, never arbitrary filesystem paths. All production code stays in this app.
3. Browser CSS resolves dependencies. Do not rewrite CSS URLs, inline files, or build a dependency parser.
4. Loading a theme never constructs or retires gameplay, presentation, or window owners.
5. Distinguish a saved preference from the active appearance when startup recovery requires it. Do not silently rewrite a missing theme preference to Base.

Folder contract:

```text
<userData>/themes/
  midnight/
    theme.css
    images/panel.png
    fonts/heading.woff2
    styles/controls.css
```

- Discover immediate directories containing a regular `theme.css`; return sorted folder IDs. Folder names are also display labels, so do not add redundant metadata fields. Encode URL segments correctly, including spaces and Unicode. IDs must be single directory names, excluding separators and dot-directory traversal.
- Main creates the root lazily for list/resolve/open operations, inside the recoverable theme error path; failure must not escape `app.whenReady` and prevent the window from opening. An empty root is a valid empty catalog. Root enumeration failures reject the list operation visibly. Unrelated directories without `theme.css` are not themes. An unreadable or invalid candidate is omitted with a theme-specific native diagnostic while other valid candidates remain available; resolving that candidate explicitly returns a specific error.
- Check canonical paths for both theme roots and requested assets. Validate the parsed URL envelope and decoded path segments before filesystem resolution: URL parsing normalizes literal and encoded dot segments, so a raw-string traversal check alone is insufficient. Reject malformed IDs, invalid generations, absolute paths, and both path separator forms. Requests must stay within their theme, and theme roots must stay within the canonical themes directory. In-tree symlinks may resolve within those boundaries; escapes are rejected.
- Proposed preload operations: list IDs, resolve an ID to a fresh stylesheet URL, and open the fixed themes directory. Reuse application-frame admission checks. Put shared app-local codecs in `src/app/`, with Node-compatible imports for main-process consumers.
- Proposed URL shape: `holtburger-theme://local/<theme-id>/<generation>/theme.css`. Each resolution issues a new generation; relative assets and nested imports inherit that namespace. The generation is transient and never persisted. Serve current files without maintaining historical snapshots; overlapping file edits are not an atomic bundle update.
- Register a standard, secure scheme; permit it explicitly in style/image/font policy without bypassing CSP. Supply correct MIME and font CORS behavior for both development HTTP and packaged file documents. Limit serving to CSS and supported image/font resource types. Keep external resources blocked under the existing policy. Do not change application navigation rules to admit theme documents.
- Resolve and serve by validated filesystem identity, not a permanently cached catalog or a renderer-supplied path. Recheck confinement and existence per request; discovery does not pin files against removal/replacement. Opening the directory uses Electron shell support and treats its returned error string as a reported failure.
- Use no-store responses plus fresh generation URLs so browser/font caches cannot retain edited assets on Reload. Paths that deliberately leave the generation namespace are outside the relative-bundle contract.

The main asset handler reports failures with the theme ID and relative asset path. Selection success means the stylesheet loaded, not that all possible conditional resources were decoded. Missing/corrupt images or fonts use browser fallback behavior with diagnostics; no universal asset-preload or CSS-validity guarantee is added. Arbitrary CSS can disrupt layout, and the cascade convention is not isolation. Existing pregame overrides and explicit user font choices retain their precedence under that convention. A CSS syntax error is subject to browser parsing and is not necessarily a stylesheet load rejection.

Handle rejected combat `document.fonts.load` promises explicitly: report the font family and cause through a nonfatal visible diagnostic, preserve browser fallback, and guard callbacks after owner retirement. Do not suppress the startup shell's global error handling. A failed font request must not become an unhandled rejection, mount failure, or presentation restart; exercise missing and corrupt font files against this actual consumer.

## Selection and lifecycle

```mermaid
sequenceDiagram
    participant UI as Client appearance controls
    participant Owner as App theme-selection owner
    participant Main as Electron theme catalog
    participant Loader as Existing stylesheet loader
    participant Settings as Existing UI settings persistence
    UI->>Owner: Select ID / Reload
    Owner->>Main: Resolve ID to fresh URL
    Main-->>Owner: Generation-scoped stylesheet URL
    Owner->>Loader: replace(url, null)
    alt Stylesheet loaded
        Loader-->>Owner: Committed + appearance notification
        Owner->>Settings: Publish selected ID using latest UI settings
    else Resolve or stylesheet failure
        Owner-->>UI: Error; keep active appearance and saved preference
    end
```

- Add nullable `themeId` to the existing UI settings contract; `null` means Base. Missing fields in older supported UI sections decode to Base without resetting fonts/scales or bumping the section version. Persist IDs only, not paths, URLs, generations, or discovery results.
- Extend the existing stylesheet loader with per-request cancellation and a finite load deadline. Abort/timeout must detach staged links, clear handlers/timers, reject the request, preserve active links, and release the queue; racing only the returned promise is insufficient because a late `load` could still publish. Skip aborted queued requests before staging. Bound theme resolution plus CSS loading with one operation budget shorter than the native renderer-close preparation budget (currently 5 seconds); keep the setting explicit and inject clocks/signals in unit tests. Late IPC resolution results are discarded before invoking the loader.
- Keep selection operations in one small app-local owner, usable during bootstrap and then by the client shell. Its explicit cold state covers active ID, pending request, and error. The preferred ID remains in settings; it can differ from active Base when a saved theme is unavailable. Store one tagged operation state rather than independently mutable loading/error flags. An operation failure returns the owner to an actionable state, including after timeout.
- Bootstrap: load settings, resolve/apply the saved theme, check close admission, then mount `ClientApp`. The earlier content-admission shell uses Base. Failure mounts the client with Base and a visible issue, retaining the saved ID. A catalog/asset failure must not block game startup. Check the startup cancellation signal before starting theme work and after it settles. If close arrives while bootstrap is awaiting theme work, `StartupGameLifecycle` aborts the signal synchronously and the theme owner aborts its current operation; skip mounting and retire the untransferred owner. If mounting throws, retire it there too. Transfer ownership to `ClientApp` once, with no constructor/effect replay that loads the same theme again.
- Runtime: serialize Select, Reload, and Base requests. Commit the selected preference only after stylesheet success. Merge the committed ID into the latest UI settings, never a snapshot captured before the await. Unrelated UI mutations do not initiate theme loads. Refresh list does not apply a theme or clear its saved ID. Successful application commits the in-memory preference and queues the existing disk save; a later persistence failure reports/retries through the existing mechanism and does not roll back the active appearance or claim the new preference was durably saved.
- Controls show the preferred choice and explain when Base is active because it is unavailable. Include a labeled unavailable option for a preferred ID absent from the catalog so a native select cannot misleadingly show Base as the remembered choice. Reload retries the preferred ID and remains usable when it is missing from the last catalog; Refresh list only updates the catalog. Offer Base, discovered themes, Open themes folder, Refresh list, and Reload theme. Keep Base selectable even when discovery fails. Reuse existing controls and keyboard ownership; do not duplicate pregame/in-game owners.
- Close: stop admitting selection requests and retire pending preference commits synchronously before the existing settings flush. An unfinished selection at close is not saved; only already committed preferences are flushed. Abort the active load, discard queued selection requests, and drain their handled completions without publishing into the retiring UI. Repeated retirement joins the same cleanup; cancellation is not shown as a theme error. This fits `ClientApp`'s existing quit guard and parallel resource preparation instead of attempting a late settings mutation. The startup signal replaces the old close predicate and its duplicate boolean, and remains attached after ownership transfers to `ClientApp`. Preserve existing lifecycle checks around asynchronous bootstrap.
- Recovery: choosing Base explicitly replaces the saved preference. `--ignore-config` starts with default Base through the existing settings bypass; it is not a new theme-specific launch mode. Removing/renaming a broken theme also gives startup recovery. Respect existing settings-file override and reset semantics; the theme directory remains under user data, not beside an arbitrary `--settings-file`.

## Phases

### Phase 1: Prove local CSS and dependent assets

- [x] Add focused `electron/ui-theme-catalog.ts` discovery/path/URL logic and an Electron protocol adapter, colocated tests, and narrow shared app-local request/result codecs. Keep the catalog and codecs importable in Node without Electron globals; the protocol adapter alone depends on Electron. Discovery and serving errors remain recoverable theme errors.
- [x] Wire registration, session handler, IPC, and fixed-directory opening through `electron/main.ts` and `preload.cts`; add only the resource-policy permissions required in both entry HTML files.
- [x] Add a focused non-interactive Electron probe with a dedicated diagnostic main entry importing the production catalog/protocol adapter. Do not import product `electron/main.ts`, which starts content admission, or add a production host-bypass flag. Load the probe page under the exact production resource policies and verify session-handler installation before navigation. Include a small checked-in fixture theme with an image, nested CSS import, and a redistributable font plus its source/license. The fixture fonts are original rectangle glyphs generated from the checked-in fontTools source, under the repository license; no external or system font is required.
- [x] Test discovery ordering, names requiring URL encoding, root and per-entry read failures, missing entries, traversal/encoded paths, symlink confinement, and disappearance/replacement after discovery with temporary filesystem fixtures.
- [x] Implement/test loader cancellation and deadlines against stalled loads, aborted queued requests, late load events, and success after a failed operation. Thread cancellation from the selection owner in Phase 2; existing callers retain the same normal selection behavior.

Acceptance: the real Electron window loads the fixture's CSS, image, imported CSS, and font through the protocol in development and built-file modes. Font loading is proven with `document.fonts.load`/resolved faces; image decoding and computed background usage are checked programmatically. Rejected paths cannot read an outside sentinel file. No gameplay host or server is needed for this proof.

**Steering gate:** before settings/UI work, verify relative imports, font CORS, MIME, and cache behavior in both origins. Resolve any protocol-design change here and update the remaining tasks; a plain Chrome/HTTP fixture is insufficient evidence for Electron serving.

### Phase 2: Complete client selection and persistence

- [x] Add the renderer transport and theme-selection owner under `src/app/`; preserve `ui-theme.ts` as the stylesheet lifecycle owner.
- [x] Add `themeId` to `client-settings-contract.ts` and defaults; cover decoding/repair of old UI sections, normal save/reset, and the existing config bypass.
- [x] Integrate bootstrap in `src/client/main.ts`, then transfer the initialized owner to `ClientApp.svelte`. Wire the gameplay path through `ClientGameplayView.svelte` → `ClientSettingsPanel.svelte` and the pregame path through `ClientPregameSettings.svelte`, both reaching `ClientAppearanceSettingsControls.svelte`. Update `ClientBindingProbe.svelte` and other typed fixture constructors with explicit injected theme capabilities rather than nullable production fallbacks. Follow current context/prop conventions rather than introducing a service registry.
- [x] Reuse one theme-controls component in the existing shared appearance controls. Wire the owner to existing settings mutation, error presentation, and close preparation.
- [x] Cover successful and failed selection, Base restoration, unavailable saved selection, repeated requests, concurrent font/scale edits, persistence failures, and close during bootstrap and runtime loading. Include a stalled load and verify no post-close commit or appearance notification. Use injected transports/loaders for focused unit tests.

Acceptance: selection works from both settings surfaces, survives restart, and preserves drafts/window layout/runtime identity. Failed selection keeps the previous appearance and preference. A missing saved theme visibly uses Base without erasing its ID. Explicit font choices win, Theme default follows the bundled face, and existing scales remain intact. Config bypass starts with Base. Saving failures remain visible through the existing persistence mechanism.

### Phase 3: Verify reloads and recovery end to end

- [x] Extend the Electron probe to edit CSS, its referenced image, nested imported CSS, and font assets; reload and verify new generation URLs and loaded content without document/component replacement.
- [x] Verify actual font readiness and combat glyph-atlas refresh using the existing font notification owner. Handle its rejected `fonts.load` promises nonfatally and verify missing/corrupt faces do not reach `ContentStartup`'s unhandled-rejection failure path or update a retired presentation. Do not add another font lifecycle unless a demonstrated missing consumer requires it.
- [x] Exercise catalog refresh, deleted selected files, malformed/missing stylesheet resources, missing/corrupt dependent assets, rapid selections, and persistence/recovery. Distinguish stylesheet rejection from browser asset fallback in assertions and diagnostics.
- [x] Run current Svelte/TypeScript, ESLint, Knip, touched-file formatting, frontend build, Electron build/runtime-import checks, focused tests, and native probes. Add the focused probe to `package.json`.

Acceptance: Reload refreshes referenced resources; failures identify the relevant theme/resource; valid selections recover after failure; cached appearance consumers refresh without remounting. Verification uses checked-in or temporary synthetic fixtures, with no TUI launch or agent visual acceptance.

Existing broad probes have reproduced baseline failures from the preceding consolidation: UI-theme contrast on the bright backdrop is 1.50 against a 4.5 target, the full HUD fixture omits required enchantment `cooldowns`, and the broad presentation probe expects Disconnect where the existing Settings button appears in its fixed Tab sequence. These are historical evidence, not permanent exemptions. The presentation Tab failure was reproduced against original tracked files during this implementation. The focused `--user-theme-lifecycle` probe instead verifies the actual feature on the same production ClientApp and real content. Preserve the distinction from focused theme results and fix any new regression attributable to this feature.

### Phase 4: Cleanup and author guidance

- [x] Remove temporary adapters, duplicate selection paths, unused contracts, and diagnostics that no longer serve the feature. Review new production sLOC: expect several hundred lines, primarily native serving and typed UI wiring; challenge substantial growth before adding abstractions.
- [x] Update `UI_STYLE_GUIDE.md` and the README with the actual theme root, folder convention, supported asset types, cascade rules, font precedence, reload behavior, recovery, and dependent-asset limitations. Preserve earlier inactive plans as historical notes.
- [x] Extend emitted Node ESM checks for new cross-boundary imports. Ensure user themes remain external to ASAR and usable with built entries; add package verification only where the feature changes packaging assumptions.

Acceptance: documentation describes the shipped behavior, all runtime imports resolve, there is one selection owner, and no dead compatibility vocabulary or duplicate loader remains.

## Risks and mitigations

| Risk                                                               | Mitigation                                                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Scheme works in development but fails in packaged file documents   | Phase 1 proves both origins under production policies, including font CORS and relative imports, before UI work.                   |
| Reload updates CSS but retains image/font cache entries            | Fresh generation namespace for the whole relative bundle; no-store responses; verify changed decoded assets.                       |
| Async completion overwrites newer UI settings or saves after close | One serialized selection owner, latest-value merge at commit, and synchronous retirement of pending commits before close flush.    |
| Discovery errors or broken themes prevent access to settings       | Base is always available; startup issue is visible; saved IDs survive fallback; existing config bypass recovers disrupted layouts. |
| Loader success is mistaken for whole-bundle validation             | Specify stylesheet-only commit semantics; test/report font/image failures separately.                                              |
| Feature grows into a theme framework                               | Folder IDs and one entry CSS file; defer manifests, watchers, remote resources, and Explorer persistence.                          |
| Stalled stylesheet holds the selection queue or close wait         | Cancellation removes staged links; one finite operation deadline bounds startup; retirement aborts and drains without publication. |
| A missing theme font becomes a global application failure          | Handle the existing combat font-load rejection with visible diagnostics and browser fallback; retain global error handling.        |

## Definition of done and decisions

- [x] All phase acceptance criteria pass, including real Electron CSS/image/font loading in both origins.
- [x] Client settings select, reload, restore Base, persist, and recover with no runtime remounts or lost concurrent preferences. Stalled loads time out, close cancels queued/in-flight loads, and failed bundled fonts never reach the global application-failure path.
- [x] Path confinement and typed desktop boundaries are tested; no shared Rust ownership changes occur.
- [x] Checks and durable author guidance are complete; visual acceptance remains with the user.

The implemented first cut keeps client picker/persistence only, folder names as IDs/labels, and browser fallback plus diagnostics for dependent-asset failures. Discovery/serving is app-local and mode-independent; Explorer remains on Base. Settings, reload, font, and failure-path verification is complete. Revisit the deferred capabilities only when the scope expands. The evidence below records the completed phases and their bounded course corrections.

Implementation evidence (2026-10-25):

| Requirement                            | Authoritative verification                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native discovery and path confinement  | Seven `electron/ui-theme-catalog.test.ts` cases cover sorted/encoded names, invalid and unreadable entries/roots, symlinks, removal after discovery, malformed URLs, and supported-type boundaries.                                                                                                                                                                                          |
| Real CSS/image/font serving and reload | `npm run probe:user-themes` passes development HTTP and built-file origins under production policy. It verifies red→blue decoded image pixels, first→second imported CSS, changed font advances, and retained input identity/draft.                                                                                                                                                          |
| Failed load, cancellation, and timeout | The same Electron probe verifies abort and queued abort, finite stalled-request timeout, rejection of a failed second stylesheet, staged-link cleanup, preserved active links, and subsequent queue recovery. Owner unit tests also bound resolution and discard late results.                                                                                                               |
| Shared settings and persistence        | The Electron probe drives real pregame/gameplay settings components with the production selection owner, preload transport, persistence scheduler, and disk-backed settings store. It verifies select/Base/reload, failed-select dropdown restoration, document restart restoration, missing preferred ID with active Base, retry outside a stale catalog, and folder-opening error display. |
| Native client startup                  | `npm run probe:client:settings` passes against the actual Electron client, including the theme discovery bridge and old-profile Base default. The diagnostic now waits for `.client-appearance-scope`, because the earlier content-admission shell is not evidence of completed settings bootstrap.                                                                                          |
| Bootstrap and close                    | `client-main.test.ts`, `startup-game-lifecycle.test.ts`, and `ui-theme-selection.test.ts` verify saved-theme application before mount, missing-theme recovery, latest-settings merging, cancellation during bootstrap and runtime selection, discarded queued requests, and the deadline/close-budget invariant.                                                                             |
| Font lifecycle                         | The Electron probe observes a real font completion invoking the existing atlas-refresh callback. Missing/corrupt faces reach nonfatal diagnostics, and a failed font promise resolved after observer retirement produces no late callback. Existing renderer tests verify atlas invalidation preserves logical effects.                                                                      |
| Actual runtime retention               | `npm run harness:browser -- --user-theme-lifecycle --brief --building-radius 1 --settle-ms 1000` passes on real ClientApp at the roster and in gameplay: same canvas/context count, retained runtime, no extra portal reveal/logout/disconnect, no browser errors.                                                                                                                           |
| Scaling and typography regression      | `npm run harness:browser -- --client-text-scaling --brief` passes, including theme overrides, retained UI, top-layer controls, and Explorer behavior.                                                                                                                                                                                                                                        |
| Static/unit checks and build           | All 411 frontend test files / 3,762 tests pass; Svelte/TypeScript checks report zero errors/warnings; ESLint and Knip pass. The Electron probe command also builds frontend/Electron and passes emitted Node ESM runtime-import checks. Touched-file formatting and `git diff --check` pass.                                                                                                 |

Phase 1 needed no protocol redesign: standard/secure registration with explicit CSP and font CORS works in both tested origins. The diagnostic uses `app.whenReady().then(...)`, avoiding top-level-await readiness deadlock. No agent-owned visual acceptance was performed; the user subsequently confirmed the local verification theme worked. No shared Rust files were changed.
