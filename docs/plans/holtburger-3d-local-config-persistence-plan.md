# Holtburger 3D Local Configuration Persistence Plan

Status: **Implemented.** Automated verification is complete; the two unchecked definition-of-done
items remain manual cross-session acceptance checks in a real packaged client.
Origin: the client now has enough editable HUD and shortcut state that resetting it on every launch
is materially disruptive. This plan records the agreed persistence census and introduces a local
configuration boundary without adopting the retail/ACE configuration model.

## Context and Boundaries

### Goal

Persist the 3D client's user-scoped presentation preferences and character-scoped shortcut
configuration across sessions through one versioned, validated, local-only configuration owner.

### Persistence census

| State                                                                     | Scope                         | Initial persistence decision        |
| ------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| Client window bounds and maximized state                                  | User                          | Persist                             |
| Fixed HUD surface placement and size                                      | User                          | Persist                             |
| Spell bar placement and single/double shape                               | User                          | Persist                             |
| Minimap placement, size, and indoor/outdoor zoom diameters                | User                          | Persist                             |
| Minimap pan/temporary center                                              | Ephemeral                     | Do not persist                      |
| Chat filter selection                                                     | User                          | Persist                             |
| Weather enabled                                                           | User                          | Persist                             |
| Action bar count, order, orientation, shape, placement, and item bindings | Character                     | Persist as one composite value      |
| Spell bar spell bindings                                                  | Character                     | Persist                             |
| Selected spell tab                                                        | Ephemeral                     | Do not persist                      |
| Open panel, selected panel tab, dialogs, and layout-edit mode             | Ephemeral                     | Do not persist                      |
| Inventory and other container sort modes                                  | Ephemeral                     | Do not persist                      |
| Spell browser query, filters, selection, and scroll state                 | Ephemeral                     | Do not persist                      |
| Boom-camera zoom distance and all other live camera state                 | Ephemeral                     | Do not persist                      |
| Explorer state, including Explorer layout and camera state                | Ephemeral for now             | Do not persist                      |
| Server-entry UI, credentials, selected server, and last character         | Deferred                      | Do not add or persist               |
| Audio, graphics, input remapping, and theme selection                     | User when real controls exist | Do not add placeholder fields in v1 |

There is no account-scoped state in the initial document. User state is shared by every client
character launched by the same operating-system user. Character state follows the character even
if its game account changes. Account names and credentials are never configuration keys or stored
values.

### In scope

- Add a client-only, app-local settings contract containing exactly the persisted values above.
- Store one versioned JSON document under Electron's platform `userData` directory.
- Give development builds a distinct `userData` directory so local development and diagnostics
  cannot read, migrate, or overwrite a packaged installation's configuration.
- Validate data at both the disk and IPC boundaries and write atomically through Electron main.
- Restore and retain the normal client window bounds and maximized state.
- Hydrate user preferences before mounting the client UI.
- Hydrate character preferences only after the host establishes the authoritative local-player
  GUID.
- Refactor nested action-bar, spell-bar, HUD, minimap, and chat state just far enough to give the
  client composition owner controlled snapshots.
- Coalesce frequent UI mutations so dragging or resizing does not write at pointer frequency.
- Add pure migrations beginning with schema version 1, deterministic tests, and browser-harness
  coverage that never touches a developer's real settings file.

### Out of scope

- Reading, importing, merging, mirroring, or updating ACE/retail shortcut or spell-bar settings.
- Any server protocol, Rust host, `holtburger-core`, or shared-crate configuration API.
- Cloud sync, cross-device sync, multiple named profiles, import/export, or a settings reset UI.
- Persisting credentials, account names, server selection, character selection, or login history.
- Adding settings controls for audio, graphics, input remapping, or themes. Those fields should be
  added with their first real producer and consumer rather than reserved speculatively.
- Persisting Explorer state. The settings bridge is installed for the client entry only.
- Recovering a profile across a shard database replacement, character recreation, server alias
  change, or endpoint change.
- Preserving compatibility with pre-release local state. There is no existing persisted format to
  migrate, so version 1 is a clean cutover.

## Ground Truth and Existing Seams

### Application ownership

- `apps/holtburger-3d/electron/main.ts`
  - Owns the sole `BrowserWindow`, its fixed initial size, the platform app lifecycle, the parsed
    client endpoint, and the existing allowlisted IPC boundary.
  - It is the correct filesystem owner and the only layer that should derive a shard namespace
    from launch configuration.
- `apps/holtburger-3d/electron/preload.cts`
  - Exposes one context-isolated host bridge. Persistence should use a separate, equally narrow
    `holtburgerSettings` bridge rather than broadening the sidecar transport.
- `apps/holtburger-3d/src/client/main.ts` and `src/app/mount.ts`
  - Currently mount immediately after loading the theme. The client entry needs a user-settings
    bootstrap step before `ClientApp` is constructed; Explorer must retain its current path.
- `apps/holtburger-3d/src/client/ClientApp.svelte`
  - Already owns session lifetime, current local-player identity, spell-bar bindings, HUD mode,
    and frame settings. It is the correct renderer composition owner for hydrated user and
    character snapshots.
  - `current-state` and `local-player-established` provide the authoritative character GUID.
- `apps/holtburger-3d/src/client/ClientWorldView.svelte`
  - Currently owns `ClientHudLayout`, spell-bar shape, minimap view diameters, and open-panel
    state. The first three become controlled user settings; open-panel state remains local.
- `apps/holtburger-3d/src/client/ClientActionBars.svelte`
  - Currently owns the entire action-bar collection and a session-local next ID, and resets it from
    inventory identity events. Persisted character state requires a controlled bar collection;
    inventory sampling and item gestures remain inside this component.
- `apps/holtburger-3d/src/client/ClientChat.svelte`
  - Currently owns `enabledTags` beside genuinely ephemeral draft, failure, focus, and scroll
    state. Only the filter value should become controlled.
- `apps/holtburger-3d/src/client/client-hud-layout.ts`,
  `client-action-bar-state.ts`, and `client-spell-bar-state.ts`
  - Already define serializable, frontend-local values and pure mutation helpers. Persistence
    should adapt these contracts rather than inventing parallel generic configuration models.
- `apps/holtburger-3d/src/client/client-action-bar-reconciliation.ts`
  - Correctly retains replacement-aware bindings while inventory knowledge is incomplete, then
    updates or clears them only from an authoritative current inventory. Hydration must preserve
    this behavior.
- `apps/holtburger-3d/src/harness/browser/`
  - Is the appropriate visual and interaction verification surface. It must use an injected
    in-memory settings adapter or explicit initial snapshots, never Electron's real `userData`.

### Character identity evidence and limitation

ACE establishes that a character GUID is persistent inside one shard database for that
character's lifetime:

- `ACE/Source/ACE.Server/Network/Handlers/CharacterHandler.cs` allocates the player GUID once with
  `GuidManager.NewPlayerGuid()` during creation.
- `ACE/Source/ACE.Server/WorldObjects/WorldObject.cs` restores the same GUID from `Biota.Id` when
  loading a persisted object.
- `ACE/Source/ACE.Database/Models/Shard/ShardDbContext.cs` makes the relevant shard object and
  character identifiers database keys.

That does **not** make a character GUID globally or eternally stable. Another shard can use the
same numeric GUID, and a shard database rebuild or character deletion/recreation can reuse an
identity. Character profiles therefore use the composite key:

```text
normalized launch host and port + character GUID
```

Electron main derives the normalized endpoint from the launch-only `ClientLaunchConfiguration`.
The renderer supplies only the established character GUID. A last-known character name may be
stored as display/diagnostic metadata, but it never participates in identity. DNS aliases or an
endpoint change intentionally create a new profile; attempting network-level server identity
discovery is not deserved for local settings.

### ACE settings are evidence of incompatibility, not a storage source

`ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventPlayerDescription.cs` emits retail-shaped
shortcut data and exactly eight server spell lists. Holtburger's spell shortcut surface has ten
fixed tabs of ten cells, while its item action bars support multiple bars, layout, orientation,
shape, and replacement intent. Those models are not losslessly interchangeable.

The implementation must therefore:

- ignore ACE shortcut/spell-list payloads for Holtburger UI configuration;
- never use server data as a missing/invalid local-settings fallback;
- never emit retail shortcut/spell-list mutations on behalf of these controls; and
- treat "character-scoped" as a local profile-selection rule, not server authority.

### Constraints

- Electron main is the sole durable I/O owner. Svelte components never call filesystem or IPC
  APIs directly.
- The persisted document contains plain data only: no derived artwork, item facts, spell facts,
  runtime objects, panel visibility, or active gesture state.
- Every schema field must have a named runtime consumer. Version 1 has no placeholders for future
  settings pages.
- A missing document is reported as explicit absence. Electron supplies native window defaults and
  the renderer derives client defaults from the actual initial viewport before the first save.
  Invalid or unsupported documents fail with the file path and validation reason; they are never
  silently overwritten.
- The renderer cannot read the client endpoint, account, or password through the settings bridge.
- Character defaults must not be saved before that character's load completes. A late load for a
  retired character must not publish into or overwrite the active character.
- Unresolved action-item GUIDs and consumable replacement identity survive hydration until the
  existing authoritative reconciliation policy can decide their fate.
- Browser and unit tests must inject temporary paths/adapters and remain independent of untracked
  runtime assets.
- Development and packaged builds must never share a settings document. Configure the development
  `userData` override before Electron's `ready` event so Chromium session data is isolated along
  with Holtburger settings.

### Data distribution and concessions

- Expected data is small: one user snapshot, ordinarily a handful of character profiles, at most
  ten action bars with ten cells each, and ten spell tabs with ten cells each. One JSON document
  and whole-document atomic replacement are simpler and sufficient; no database or per-profile
  file tree is warranted.
- Settings mutations are cold UI events except for continuous drag/resize previews. Coalescing
  preview changes and persisting the latest snapshot after a short quiet period is sufficient.
- An abrupt process or machine failure may lose the final coalescing interval, but an atomic write
  must leave either the previous complete document or the next complete document.
- A renamed/aliased endpoint or replaced shard database may orphan a profile. Automatic guessing
  or name-based recovery is explicitly rejected because it can attach item GUIDs to the wrong
  character.
- Unknown future schema versions fail closed so an older client cannot erase newer settings.

## North Stars

1. Local configuration has one durable owner, one versioned contract, and one directed flow:
   disk to Electron main to renderer owner to controlled components.
2. Scope is part of the type and ownership model. User and character snapshots are not a bag of
   optional keys with runtime scope tags.
3. Server configuration and Holtburger configuration never compete for authority.
4. Hydration is a lifecycle state, not a race against default component initialization.
5. Persist user intent, not derived presentation or temporarily constrained geometry.
6. Components report complete typed values; a persistence coordinator validates, coalesces, and
   writes them. Components do not know where settings live.
7. Invalid state fails visibly. Defaults cover absence and explicit migrations, not corruption.
8. Prefer the smallest solution supported by the data: built-in filesystem primitives, existing
   Zod, one document, and no new dependency.

## Settled Design

### Version 1 document

The exact exported names may be adjusted to match local vocabulary, but the durable shape is:

```ts
interface ClientLocalSettingsV1 {
  readonly schemaVersion: 1;
  readonly user: {
    readonly window: {
      readonly normalBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      readonly maximized: boolean;
    };
    readonly client: {
      readonly hudLayout: ClientHudLayout;
      readonly spellBarShape: "single" | "double";
      readonly minimapViewDiameters: { indoor: number; outdoor: number };
      readonly chatFilters: readonly ClientChatFilterTag[];
      readonly weatherEnabled: boolean;
    };
  };
  readonly characters: Readonly<
    Record<
      CharacterProfileKey,
      {
        readonly lastKnownName: string | null;
        readonly actionBars: readonly ClientActionBar[];
        readonly spellBarBindings: ClientSpellBarBindings;
      }
    >
  >;
}
```

`ClientHudLayout` contains the placement and preferred size of all fixed client HUD surfaces,
including the spell bar and minimap. It does not contain action bars. Action bars stay one
character-scoped composite because their ordering, identities, placement, shape, and bindings are
interdependent.

Split `ClientSpellBarState` into durable bindings and ephemeral selection rather than serializing
the current type and remembering to discard one field. The UI may compose them for rendering, but
the settings contract contains only the ten-by-ten spell-ID matrix.

Do not persist an action-bar `nextId`. Add a pure allocator that chooses an unused positive ID from
the currently validated collection. This derives the fact at its owner and avoids coupling future
writes to a redundant counter.

### Storage and validation

- Add an app-local contract/codec module under `src/client/` for the persisted plain-data schemas,
  scope-specific defaults, and migrations. Reuse the existing Zod dependency; do not add
  `electron-store` or a generic settings framework.
- Add `electron/client-settings-store.ts` as the filesystem adapter. Its constructor accepts a
  path so tests can use a temporary directory.
- Packaged builds use Electron's default `userData` directory. With the current application name,
  the settings path is `%APPDATA%\holtburger-3d\client-settings.json` on Windows,
  `~/Library/Application Support/holtburger-3d/client-settings.json` on macOS, and
  `${XDG_CONFIG_HOME:-~/.config}/holtburger-3d/client-settings.json` on Linux.
- Before `app.whenReady()` in an unpackaged run, set `userData` to a sibling directory named
  `holtburger-3d-dev` (creating it first because Electron requires an existing override target).
  The development settings path is then `join(app.getPath("userData"), "client-settings.json")`.
  This deliberately isolates all Electron/Chromium state, not only the Holtburger JSON file.
- Production and development use the settings store only for the client entry; Explorer remains
  ephemeral even though it runs under the selected Electron profile directory.
- Read and parse once during client startup. Represent a missing file as an in-memory empty-store
  state, dispatch present data on `schemaVersion`, migrate through pure version-to-version
  functions, validate the current result, and retain it in main-process memory.
- Reject non-finite numbers, invalid enum values, malformed fixed-length bars, duplicate action-bar
  IDs, over-limit bar collections, unsafe IDs, unknown object keys, and unsupported versions.
- Save the complete current document to a sibling temporary file, sync/close it, and atomically
  rename it over the target. Serialize all mutations through one queue so an older async write
  cannot land after a newer snapshot.
- Missing file/directory is the only implicit-default case. A malformed document remains untouched
  and stops client startup with an actionable diagnostic rather than being replaced.
- Saving a renderer mutation rejects its IPC promise on failure. The renderer retains the current
  in-memory snapshot, reports one visible persistence warning, and retries the latest snapshot on
  a subsequent mutation. Main-owned window-save failures are reported through the existing fatal
  diagnostic path during startup and an explicit dialog/log during runtime.

### Narrow settings bridge

Expose a separate `window.holtburgerSettings` API with typed operations equivalent to:

```ts
loadUser(): Promise<{ readonly kind: "missing" } | { readonly kind: "loaded"; readonly settings: ClientUserSettings }>;
saveUser(settings: ClientUserSettings): Promise<void>;
loadCharacter(characterGuid: number): Promise<ClientCharacterSettings>;
saveCharacter(characterGuid: number, settings: ClientCharacterSettings, lastKnownName: string | null): Promise<void>;
```

The main-process handler validates the sender/main frame like `host:invoke`, validates every input
again, and derives `CharacterProfileKey` from the captured launch endpoint plus the GUID. It does
not expose generic file, key/value, profile-key, server, account, or credential operations.

Window settings do not traverse renderer IPC. Electron main restores them before creating the
window, updates the in-memory normal bounds from native move/resize/maximize events, and flushes
the store during the existing orderly `before-quit` sequence. Restoration intersects the saved
normal bounds with current display work areas; a completely unreachable window uses the current
default size centered on the primary display. Temporary OS clamping never rewrites the preferred
normal size until a real native bounds event reports the user's new choice.

### Renderer ownership and write coordination

`src/client/main.ts` loads validated user settings before mounting `ClientApp`. On explicit
absence, it builds settings from `CLIENT_UI_DEFAULTS`, the actual initial viewport, chat-filter
constants, map defaults, and client frame defaults, then saves that complete initial user snapshot
before mounting. This first save turns the empty-store state into a valid complete v1 document;
character operations cannot begin before it completes. `ClientApp` then owns one
`ClientUserSettings` snapshot and passes controlled sub-values/change callbacks to
`ClientWorldView` and `ClientChat`.

A small renderer-local persistence coordinator accepts complete user or character snapshots,
coalesces rapid changes, allows only one save per scope in flight, and retains the newest pending
revision. It does not implement storage or know the filesystem path. Drag/resize streams may
update the live snapshot immediately while persistence trails by a bounded quiet interval.

Character settings use an explicit generation-gated lifecycle:

1. An authoritative non-null local-player GUID arrives.
2. Retire the previous character generation and stop accepting writes for it.
3. Flush its already-scheduled latest snapshot where possible, then start the new profile load.
4. Keep character shortcuts unavailable while loading; never render editable defaults that could
   be mistaken for the loaded profile.
5. Publish loaded settings, or character defaults for a genuinely absent profile, only if the GUID
   and generation are still current.
6. Enable mutations and persistence for that generation.
7. On character replacement or session teardown, cancel gestures, retire the generation, and
   clear the composed character UI state.

Character name arrival updates metadata only. A name change cannot move, merge, or select a
profile.

## Phase 1: Contracts, Census, and Pure Codecs

### Deliverables

- Add the versioned document, user snapshot, character snapshot, profile-key, and schema types in
  an app-local client settings module.
- Split durable spell bindings from ephemeral selected-tab state in
  `client-spell-bar-state.ts`.
- Add pure defaults, endpoint normalization/profile-key construction in the main-process side,
  action-bar ID allocation, validation, and the version-dispatch migration shell.
- Add focused unit tests for every accepted and rejected shape.

### Task checklist

- [x] Encode the persistence census as separate `ClientUserSettings` and
      `ClientCharacterSettings` types; do not add runtime scope flags.
- [x] Export or adapt only the nested HUD/minimap types needed by the codec.
- [x] Make the current Holtburger ten-by-ten spell layout a fixed-length validated contract.
- [x] Validate action-bar collection count, unique IDs, ten exact slots, item/replacement values,
      anchors, shape, and orientation.
- [x] Validate chat filters as an ordered, duplicate-free subset of the known filter tags.
- [x] Define absence defaults from runtime constants and prove every default parses.
- [x] Normalize DNS host casing, bracket IPv6 when composing a key, retain the parsed port, and
      keep this helper in Electron/main territory.
- [x] Add a `schemaVersion` switch whose unknown-version branch is explicit even though v1 has no
      predecessor migration.
- [x] Refactor spell state consumers atomically so no old selected-plus-tabs persistence candidate
      survives.

### Acceptance criteria

- Round-tripping a complete v1 document is lossless and deterministic.
- Defaults pass the same parser used for disk and IPC input.
- Malformed fixed collections, duplicate bar IDs, non-finite geometry, unknown tags, unknown keys,
  and newer schema versions fail with specific diagnostics.
- The schema has no account, credential, selected-server, selected-character, Explorer, open-panel,
  container-sort, spell-browser, camera, or selected-spell-tab field.
- Existing spell-bar behavior and unit tests remain green after the binding/selection split.

### Decisions and course corrections

- Dry run: persisting the existing `ClientSpellBarState` would accidentally make tab selection
  character state. Splitting the composite is cleaner than a save-time omission list.
- Dry run: persisting `nextId` creates an unnecessary invariant with the bar collection. Deriving
  an unused ID removes a field and makes imported/migrated collections safer.
- Dry run: account ID is not needed to disambiguate a shard's character GUID and would make
  account transfer behavior worse. The local character key is shard plus GUID only.

## Phase 2: Electron Store, Window State, and IPC Boundary

### Deliverables

- Add `electron/client-settings-store.ts` and adjacent temporary-directory tests.
- Configure unpackaged Electron to use the isolated `holtburger-3d-dev` profile before `ready`.
- Initialize the store before the client `BrowserWindow` is created.
- Restore/save normal window bounds and maximized state.
- Add the allowlisted client settings IPC handler, context-isolated preload surface, and renderer
  bridge types.

### Task checklist

- [x] Make the store path injectable and keep all production path discovery in `main.ts`.
- [x] Select and create the unpackaged `holtburger-3d-dev` directory before `app.whenReady()`;
      retain Electron's ordinary application-named `userData` path in packaged builds.
- [x] Implement an explicit missing-file result, strict reads, pure migration, serialized
      mutation, atomic replacement, and explicit error propagation.
- [x] Ensure temporary files are unique per process/write and cleaned after a failed replacement
      without deleting the last good target.
- [x] Apply saved normal bounds only if reachable on a current display; otherwise center the normal
      default on the primary work area.
- [x] Record `getNormalBounds()` rather than maximized bounds and debounce native move/resize
      writes in main.
- [x] Flush pending main-process writes alongside host shutdown before `app.exit`.
- [x] Install settings handlers and preload capability only in client mode.
- [x] Apply the same sender/main-frame checks used by host IPC and validate all arguments/results.
- [x] Prove that the bridge exposes no path, arbitrary key, endpoint, account, password, or raw
      whole-document operation.

### Acceptance criteria

- A missing file returns explicit absence and becomes one complete document after renderer default
  construction; a valid file restores identically; invalid JSON, invalid data, and a future
  version fail without modifying the file.
- An interrupted/failing write leaves the prior complete file readable.
- Concurrent user, character, and window mutations commit in invocation order and retain all three
  sections.
- An off-screen saved window is recovered onto a current display; maximizing does not destroy its
  last normal bounds.
- Explorer starts without reading or writing `client-settings.json`.
- An unpackaged run writes only beneath `holtburger-3d-dev`; a packaged run writes only beneath
  `holtburger-3d`, and existing data in either directory has no effect on the other.
- Electron/preload type checks and focused store/IPC tests pass.

### Decisions and course corrections

- One small document is intentional. Separate profile files add directory lifecycle, multi-file
  migration, and cross-file update behavior without improving the expected handful-of-profiles
  case.
- Built-in Node filesystem operations plus existing Zod are sufficient. A general settings
  dependency would add more policy than this contract requires.

## Phase 3: User-Scoped Hydration and Controlled UI State

### Deliverables

- Add pre-mount user hydration to the client entry.
- Add a renderer-local settings persistence coordinator with focused scheduling/error tests.
- Make HUD layout, spell-bar shape, minimap zoom, chat filters, and weather controlled from
  `ClientApp`.
- Preserve ephemeral ownership for open panels, layout mode, minimap pan, chat draft/history,
  spell-browser state, and camera state.

### Task checklist

- [x] Extend the client mount seam to accept initial props without changing Explorer bootstrap.
- [x] Build missing user defaults against the actual initial client viewport and persist the full
      snapshot before component construction.
- [x] Move `hudLayout`, `spellBarShape`, and `mapViewDiameters` out of `ClientWorldView`; retain
      viewport resolution and constrained rendering there.
- [x] Convert `ClientChat.enabledTags` into controlled filters and a change callback while keeping
      draft, send failure, focus, hover, and scroll state local.
- [x] Feed persisted weather into the existing app-owned `FrameSettings` and presentation-session
      update path; do not add an unrelated settings UI in this phase.
- [x] Update complete user snapshots on each semantic mutation and coalesce persistence behind the
      coordinator.
- [x] Surface save failure through the existing client notification/error owner without reverting
      the user's current in-memory state.
- [x] Update harness fixtures to provide explicit user defaults or an in-memory adapter.

### Acceptance criteria

- The first rendered client frame uses hydrated layout, shape, zoom, chat filters, and weather;
  there is no default-layout flash followed by a persisted-layout jump.
- Moving/resizing a fixed HUD surface, changing spell shape, zooming the minimap, or toggling a chat
  filter persists and restores after remount.
- Minimap pan, open panels, layout mode, chat draft/scroll state, and browser state still reset.
- A drag/resize does not produce filesystem writes at pointer frequency.
- A save failure is visible, retains live UI state, and a later mutation retries the latest full
  snapshot rather than an older one.

### Decisions and course corrections

- Dry run: loading settings in `ClientApp.onMount` would render defaults first and let early edits
  race hydration. The client entry must complete user hydration before mounting.
- Dry run: directly teaching every HUD component about persistence would fan out IPC and lifecycle
  policy. Controlled state keeps components presentation-focused and gives saves one fan-in point.

## Steering Checkpoint: Re-dry-run Character Lifecycle

Before Phase 4, review the landed store and user coordinator against actual lifecycle event order.

- [x] Confirm whether `current-state` or `local-player-established` is first in each entry/re-entry
      path and ensure duplicate reports coalesce to one generation/load.
- [x] Simulate A-load, A-edit, A-to-B switch, late A-load, late A-save, B-edit, disconnect, and
      reconnect sequences with deterministic promises.
- [x] Confirm settings failure reporting does not depend on a world-mounted toast surface.
- [x] Reassess whether any user settings field lacks a real producer or consumer; remove it rather
      than inventing one.
- [x] Dry-run the remaining component prop changes through both production and browser harnesses,
      and split Phase 4 if it cannot remain compiling in one clean cutover.

## Phase 4: Character Profiles and Shortcut Ownership

### Deliverables

- Add generation-gated character profile hydration/persistence to `ClientApp`.
- Make action-bar collection state controlled by the app while leaving item facts, artwork,
  gestures, activation, and reconciliation in `ClientActionBars`.
- Connect durable spell bindings to the same character snapshot while retaining selected tab as
  ephemeral app state.
- Remove the old inventory-driven and spell-bar ad hoc reset paths.

### Task checklist

- [x] Introduce an explicit `absent | loading | ready` character-settings state carrying GUID and
      generation; never infer readiness from a non-null array.
- [x] Coalesce duplicate identity events and ignore every late result whose generation/GUID is no
      longer current.
- [x] Disable character shortcut rendering/editing/keyboard activation during profile hydration.
- [x] Lift `bars` out of `ClientActionBars` into controlled props and one complete change callback.
- [x] Replace mutable `nextId` with the Phase 1 pure unused-ID allocator.
- [x] Have inventory reconciliation publish a changed controlled collection only when structural
      equality changes, so reconciliation does not create a save loop.
- [x] Preserve hydrated missing-item GUIDs and replacement identity until current inventory facts
      are complete; persist any authoritative replacement/clear result.
- [x] Compose selected spell tab with loaded bindings in memory, reset selection to tab 1 on real
      character replacement, and persist only binding mutations.
- [x] Capture last-known name when available without allowing it to select or redirect a profile.
- [x] Retire the prior character generation and its gesture owners before installing the next
      profile. Remove `acceptSpellBarPlayer`, `ClientActionBars.acceptPlayer`, and lifecycle reset
      branches made obsolete by the central owner.

### Acceptance criteria

- Two characters on one shard retain independent action/spell bindings while sharing all user
  settings.
- The same numeric GUID on two endpoint namespaces resolves to two independent profiles.
- Switching A to B to A restores each exact bar collection and ten-tab spell binding matrix.
- A late A load/save cannot publish into or overwrite B's active state.
- Character shortcut input is unavailable during hydration; defaults are never accidentally saved
  over an existing profile.
- Unknown or temporarily absent bound items remain represented until authoritative reconciliation;
  replacement-aware consumables resume existing replacement behavior after inventory hydration.
- The client sends no retail shortcut/spell-list persistence command and does not consume ACE
  values as configuration.

### Decisions and course corrections

- Dry run: `ClientActionBars` currently learns identity indirectly from inventory snapshots. That
  is too late and duplicates `ClientApp`'s authoritative lifecycle knowledge. Central character
  hydration replaces both nested reset mechanisms in one cutover.
- Dry run: action-bar geometry and contents cannot be split cleanly across user and character
  documents because cloning, ordering, keyed rendering, and binding gestures operate on the same
  bars. The full collection is character-scoped as agreed.

## Phase 5: Cleanup, Runtime Verification, and Documentation

### Deliverables

- Remove obsolete session-local reset code, duplicate defaults, unused bridge vocabulary, and any
  compatibility adapters created during the cutover.
- Add deterministic persistence coverage to the browser harness and an Electron store/window
  probe using an isolated user-data directory.
- Record durable architecture facts in the closest maintained app documentation if the code alone
  is insufficient; leave implementation progress in this plan.

### Task checklist

- [x] Search for all remaining owners of persisted fields and prove each has exactly one canonical
      snapshot owner.
- [x] Search the settings document and IPC types for credentials, account names, selected server,
      selected character, Explorer state, and retail shortcut vocabulary; remove any occurrence.
- [x] Verify no component imports the preload bridge or filesystem adapter directly.
- [x] Verify all migration/default/parser branches have an input that exercises them.
- [ ] Exercise clean exit and immediate post-edit exit, documenting the bounded final-coalescing
      loss concession if the platform cannot guarantee renderer flush.
- [x] Exercise malformed config startup against a disposable copy and confirm the file is not
      overwritten.
- [x] Exercise removed-monitor window recovery and maximize/unmaximize restoration.
- [x] Run focused unit tests, then `npm run check`, `npm run lint:ts`, `npm run lint:dead`,
      `npm run format:check`, `npm run test:ts`, and `npm run build` from
      `apps/holtburger-3d`.
- [x] Run the applicable browser harness with explicit temporary settings, inspect the client HUD
      visually, and retain no tests or artifacts that depend on untracked game assets.

### Acceptance criteria

- Static checks, all TypeScript tests, production build, focused Electron tests, and deterministic
  browser verification pass without warnings.
- Visual acceptance confirms restored HUD/action-bar placement, shape, order, and minimap size at
  ordinary and constrained window sizes.
- Restart, character switch, endpoint namespace, corrupt-file, failed-write, off-screen-window,
  and stale-async-result cases behave as specified.
- The final implementation adds no dependency, server protocol, Rust persistence path, generic
  settings framework, or compatibility path to ACE configuration.

## Risks and Mitigations

| Risk                                                   | Mitigation                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Character GUID is mistaken for a global identity       | Main derives a shard-endpoint-plus-GUID key; document and test endpoint separation and accepted orphaning.          |
| A slow profile read publishes after a character switch | Carry GUID and monotonically increasing generation through every load/save completion and reject stale completions. |
| Defaults overwrite a profile before hydration finishes | Model loading explicitly and disable character mutation/persistence until installation completes.                   |
| Pointer-driven layout generates excessive I/O          | Update live state immediately but coalesce snapshots at one renderer coordinator; main serializes atomic writes.    |
| Async saves land out of order                          | Allow one write in flight, retain only the newest pending revision, and serialize document mutations in main.       |
| Config corruption is hidden by defaults                | Default only on file absence; preserve and report invalid files with their path and validation cause.               |
| A crash tears the JSON file                            | Write a complete sibling temp file, sync/close, then atomically rename over the target.                             |
| Removed monitor makes the window unreachable           | Validate saved normal bounds against current display work areas and center the default when none intersects.        |
| Hydrated item GUID is absent before inventory settles  | Reuse completeness-aware action-bar reconciliation; never prune from an incomplete entity snapshot.                 |
| Schema duplicates runtime contracts and drifts         | Parse runtime defaults in tests, validate every IPC payload through the same codec, and keep adapters colocated.    |
| Settings scope leaks into shared crates or Explorer    | Keep contracts and adapters in `apps/holtburger-3d`; install the bridge only for client mode.                       |
| Development migrates or corrupts release configuration | Override `userData` with `holtburger-3d-dev` before `ready`; test both resolved paths without touching either one.  |
| ACE values silently become fallback authority later    | Test missing local profile against Holtburger defaults and retain an explicit no-import/no-emit invariant.          |

## Definition of Done

- [x] The versioned client document contains exactly the agreed user and character fields.
- [x] User and character settings hydrate before their respective UI becomes editable.
- [x] User settings are shared across characters; action/spell bindings remain independent per
      shard endpoint and character GUID.
- [ ] Window state, HUD layout, spell shape, minimap zoom, chat filters, weather, action bars, and
      spell bindings restore across a real Electron restart.
- [ ] Every state classified ephemeral in the census still resets across a restart.
- [x] No credentials, account identity, server selection, character selection, Explorer state, or
      ACE shortcut/spell configuration is persisted.
- [x] Development and packaged builds resolve different `userData` directories and cannot observe
      or mutate each other's settings.
- [x] Validation, migration dispatch, atomic writes, write ordering, stale hydration, profile
      isolation, and window recovery have focused automated coverage.
- [x] Save/load failures are visible and never silently replace the last good file.
- [x] All applicable checks and the isolated browser/Electron verification pass.
- [x] Obsolete nested reset/ownership paths are removed; the final vocabulary consistently says
      user settings, character settings, and local profile.

## Open Questions

No product decision blocks implementation. The following implementation detail should be resolved
from evidence during the steering checkpoint rather than by expanding scope now:

- Whether the current component gesture endpoints permit persistence strictly on semantic gesture
  completion. If they do not, retain bounded renderer coalescing for v1 instead of adding commit
  callbacks to every movable surface solely for storage.
