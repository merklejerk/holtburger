# H3d character title selection

Status: implementation and automated verification complete. Visual acceptance
remains with the user.

## Goal and boundaries

Let a connected player select a character title from a dropdown in the h3d
Character panel, with immediate optimistic selection and server reconciliation.

User decisions:

- The server owns earned-title enforcement. Do not add client-side membership
  validation to compensate for ACE behavior.
- Selection is optimistic. Do not add confirmation tracking, request correlation,
  pending locks, retries, or rollback machinery.
- Visual acceptance belongs to the user.

In scope:

- Initial and incremental server title messages and the outbound selection action.
- Character-scoped earned-title retention and selected-title updates.
- Extend the existing character sheet and host command path.
- A native dropdown beneath the character name, using existing UI conventions.
- Focused unit tests, contract fixtures, and nonvisual browser verification.

Out of scope: ACE changes, TUI title controls, new DAT decoding or content-loading
paths, a searchable picker, a selectable clear-title action, and a general command
transaction framework. The retail decompile remains read-only.

## Ground truth and existing owners

Paths are relative to the repository root. Recheck symbols before implementation.

| Source | Evidence or existing responsibility |
| --- | --- |
| `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventCharacterTitle.cs` | Initial payload: `u32` version (currently 1), selected ID, count, and title IDs. |
| `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventUpdateTitle.cs` | Incremental payload: title ID and a 32-bit set-as-display flag. |
| `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionSetTitle.cs` | Selection request contains one `u32` title ID. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs:214` | `SendSelf` sends PlayerDescription and the initial title list before player object creation. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Character.cs:326` | `AddTitle` adds registry entries and optionally changes selection; `HandleActionSetTitle` delegates to it. |
| `acclient-eor-source/acclient.c:474660` | Retail title-table unpacking. |
| `acclient-eor-source/acclient.c:384221` | An incremental update always adds the title and selects it only when the flag is set. |
| `acclient-eor-source/acclient.c:202504` | Retail excludes title zero from selectable entries. |
| `acclient-eor-source/acclient.c:202449` | Retail inserts localized names in sorted order. |
| `acclient-eor-source/acclient.c:668249` | Retail sends action `0x002C` followed by the title ID. |
| `crates/holtburger-content/src/character_titles.rs` | Existing localized ID lookup; reuse without enumerating the entire catalog. |
| `crates/holtburger-world/src/inspection.rs:1594` | Existing selected-title text, with character-template fallback. |
| `crates/holtburger-world/src/player/property_retention.rs` | Private property provenance survives omissions in public object recreation; explicit newer public values win. |
| `crates/holtburger-core/src/client/character_sheet.rs` | Existing shared character snapshot. |
| `crates/holtburger-core/src/client/commands.rs:77` | Character options already mirror a local change after transport acceptance. |
| `apps/holtburger-3d/src/client/ClientWorldPanel.svelte:425` | Existing native select with `ui-input` styling. |

ACE currently checks whether a requested title is defined, then may grant it even
if it was not earned. That is server behavior. The dropdown lists server-reported
entries, but core must not turn list membership into a command permission rule.

## Ownership and contracts

- **Protocol layer:** numeric wire fields and deterministic packing/unpacking.
- **Content layer:** existing localized title lookup.
- **World layer:** retained earned IDs, player property mutations, and title-change
  events. The selected ID lives on the player entity as `CharacterTitleId`; do not
  introduce a second independently mutable selected ID in PlayerState.
- **Core layer:** reusable selection command, optimistic property update, and
  character-sheet construction/publication.
- **Host adapter:** narrow command forwarding and sheet projection.
- **Frontend layer:** alphabetical ordering, dropdown behavior, local immediate
  selection, labels, and existing error presentation.

Add an optional composite title-selection field to the character sheet:

```text
titleSelection: null | {
    selectedId: u32,
    entries: [{ id: u32, name: null | string }]
}
```

`null` means the initial registry is unavailable. An empty entries array means a
received empty registry. ID zero means no selected title and is not a selectable
clear action. Each entry's optional name comes from the existing content catalog;
keep unresolved IDs and make their missing names explicit in the UI.

The existing sheet title string continues to use shared inspection semantics.
Core resolves entry names once when constructing the snapshot. The frontend does
not duplicate DAT lookup, hashing, or template-fallback rules.

The selection command carries the character identity and numeric title ID.
Character identity prevents stale panel commands from targeting another character;
it is a lifecycle check, not earned-title enforcement. Do not add a quote, token,
request ID, or content-enum membership restriction.

## Flow and lifecycle

```text
ACE CharacterTitle / UpdateTitle
  -> protocol decoder
  -> world title registry + player property
  -> world change event
  -> core character sheet
  -> host projection
  -> frontend owner -> dropdown

dropdown change
  -> frontend owner immediately updates its selected ID
  -> host selection command
  -> core sends TitleSet
  -> core mirrors CharacterTitleId after transport acceptance
  -> existing sheet publication
  -> later server messages replace selection with server-provided facts
```

The frontend's optimistic value is part of its existing sheet display state, not
a separate pending transaction. Incoming sheet replacements win without request
matching. The core mirror prevents subsequent ordinary sheet publications from
reverting an accepted local selection while waiting for the server update.

Host invocation success means a command was queued, not that the server accepted
it. Use existing invocation and runtime/session error handling. Do not add a
permanent waiting state or attempt to infer rejection from silence. Dispatch
failure does not require a feature-specific rollback.

On server updates:

- A full title table replaces earned IDs and updates selected ID.
- An incremental event adds its ID idempotently; it changes selected ID only if
  the set-as-display flag is set.
- Property-only selected-title updates also refresh the sheet.
- Register title-originated property updates with existing private-property
  retention so later public object descriptions that omit the property preserve
  it. Preserve the existing rule that an explicitly supplied public value wins.
- Retire registry state on a new character baseline or session retirement.
  Preserve it across ordinary panel closure and world movement/teleportation.
- Admit events through existing event ordering and active-character identity
  rules; do not create another sequence tracker.

## Implementation phases

### 1. Protocol support

Touch `crates/holtburger-protocol/src/opcodes.rs`, player `actions.rs` and
`events.rs`, and `messages/game_action.rs` and `messages/game_event.rs`.

- [x] Activate `TitleSet = 0x002C`, `CharacterTitle = 0x0029`, and `UpdateTitle = 0x002B`.
- [x] Add documented payload types and pack/unpack dispatch.
- [x] Preserve the table version in the wire type. Check retail's version handling
  before choosing a rejection rule; do not invent one from ACE's current value.
- [x] Read the update flag as a 32-bit field, matching existing boolean conventions.
- [x] Add exact-byte tests for all three messages, empty/multiple-entry tables,
  both update flag states, and truncated payloads/counts.

Acceptance: emitted selection bytes match ACE/retail; table/update decoding is
lossless and malformed payloads fail through the existing decoder contract.

### 2. World retention and shared selection

Touch `crates/holtburger-world/src/player/{types,mutations}.rs`,
`handlers/player.rs`, `events.rs`, and the existing world property-mutation path
as needed. Touch core `client/{types,commands,character_sheet,messages,mod}.rs`.

- [x] Add optional earned-ID registry state, initialized as unavailable.
- [x] Apply full/incremental title events and emit one focused title-change event.
- [x] Reuse private property retention for selected-title mutations.
- [x] Reset registry state with the correct character baseline lifecycle.
- [x] Extend ClientCharacterSheet with the composite selection contract.
- [x] Add SetCharacterTitle with character identity and title ID; check current
  character/lifecycle, send the action, mirror the selected property, and publish.
- [x] Add title-change events to existing sheet invalidation.
- [x] Test event semantics, deduplication, hydration retention, character reset,
  optimistic selection, and reconciliation with later server facts.

Acceptance: shared facts serve both current and future clients; title grants
without selection preserve the selected ID; public hydration and stale character
state cannot silently corrupt selection. Selection adds no membership enforcement.

### 3. Host and dropdown

Touch `apps/holtburger-3d/host/src/{client_runtime,client_projection}.rs`,
`src/lib/host/host-transport.ts`, and frontend
`src/client/{client-character-sheet-contract,client-character-sheet-state,client-lifecycle-session}.ts`
plus `ClientCharacterSheetPanel.svelte`.

- [x] Extend initial/current-state and incremental sheet projections together.
- [x] Add a typed `set_client_character_title` host command and both host/frontend
  command allowlists; forward the character identity and title ID.
- [x] Extend the strict frontend schema and existing owner with immediate selection.
- [x] Render a labeled native select beneath the character name using `ui-input`.
- [x] Sort localized names in the frontend with an ID tie-breaker.
- [x] Exclude zero from actionable options; retain unknown nonzero IDs with an
  explicit label such as `Unknown title (ID 123)`.
- [x] Represent unavailable, empty, and unlisted-current selection states honestly
  without inventing a selectable title or defaulting to the first option.
- [x] Use KeyboardInputPolicy; add no panel-local focus/blur workaround.
- [x] Use existing error handling and reset optimistic state with the sheet/session.
- [x] Update sheet fixtures, lifecycle tests, projection tests, and HUD harness data.

Acceptance: selection is immediately visible, sends the selected ID once per
change, and later sheet updates replace it. Keyboard ownership follows existing
editor policy. Closing/reopening the panel retains current character state.

### 4. Verification and cleanup

- [x] Run focused protocol, world, core, and host Rust tests.
- [x] Run affected frontend owner/lifecycle tests through `npm run test:ts -- ...`.
- [x] Run project formatting checks, `npm run check`, TypeScript lint, and clippy
  for touched Rust packages with warnings denied.
- [x] Exercise the existing browser HUD harness nonvisually: initial selection,
  dropdown command dispatch, server reconciliation, and character retirement.
- [x] Remove speculative helpers or redundant title state introduced during work.
- [x] Confirm no new confirmation, correlation, retry, rollback, or membership
  mechanism survived implementation.
- [x] Report automated evidence and leave visual acceptance to the user.

Do not run the interactive TUI. Tests must use checked-in or synthetic data;
do not retain tests that require untracked runtime DAT assets.

## Risks and implementation constraints

- Login ordering can lose selected title during public object creation. Use the
  existing property retention path and test that specific sequence.
- CharacterSheet currently exposes display text, not selection identity. Add the
  numeric selection contract; never infer IDs from labels or template strings.
- A title grant can arrive without selecting it. Test that flag independently.
- Missing localization must not erase registry IDs or fabricate catalog content.
- A stale command can outlive its character. Carry identity and apply existing
  lifecycle admission without adding transactional machinery.
- Optimistic selection may persist if the server silently declines it. This is
  an accepted consequence of the requested optimistic behavior; later server
  facts reconcile it.

## Definition of done

The connected Character panel offers server-reported titles, updates selection
immediately, sends the documented action, and reconciles authoritative updates.
Shared state remains coherent across hydration and character lifecycle changes.
Focused tests and required checks pass, with visual acceptance left to the user.

Expected size: a few hundred production lines plus tests/fixtures across the
existing owners. No new framework, shared content path, or protocol request for
fetching titles is needed. Reassess if implementation grows substantially beyond
these responsibilities.

No user decisions are currently blocking implementation. Source details such as
wire-version policy must be proved from the references during implementation.


## Implementation and verification record

Implemented the feature through the existing character-sheet publication and
session owner. Selected title remains on the player entity, and earned IDs live
in PlayerState. Core mirrors selection after sending; frontend selection updates
immediately. Later snapshots reconcile both without a transaction owner.

Decisions proved during implementation:

- Retail `CharacterTitleTable::UnPack` skips the version word. Protocol decoding
  preserves it without enforcing version 1; the wire test includes version 99.
- Existing `ProtocolUnpack`/`ProtocolPack` for bool uses a 32-bit word and serves
  the incremental flag directly.
- Existing private-property retention preserves title updates when a public object
  description omits them. The world test exercises title update followed by
  actual ObjectCreate processing, rather than directly replacing an entity.
- An incremental grant before a complete initial registry does not claim a
  complete registry. Normal ACE ordering sends the initial table first.
- The title command carries character identity; stale/not-ready commands use
  existing action feedback. Eligibility remains server-owned.
- The host reuses the core title-selection serialization; no extra conversion
  type or title-specific event transport was needed.

Automated checks passed:

- `cargo test -p holtburger-protocol --test character_titles`: three exact-wire
  tests, including empty lists, unknown IDs/versions, both flags, and truncation.
- `cargo test -p holtburger-world character_titles --lib`: two tests covering full
  replacement, incremental grant/selection, deduplication, public hydration,
  character baseline reset, and unrelated-character events.
- `cargo test -p holtburger-core character_title --lib`: optimistic shared-state
  publication, server reconciliation, lifecycle admission, and registry retirement.
- `cargo test -p holtburger-3d-host --lib`: 367 tests passed, including typed title
  command parsing and title-selection JSON projection.
- `npm run test:ts -- src/client/client-character-sheet-state.test.ts
  src/client/client-lifecycle-session.test.ts src/lib/host/host-transport.test.ts`:
  60 tests passed, including immediate selection, send failure, and reconciliation.
- `npm run harness:browser -- --character-sheet --brief`: passed with production
  Character-panel markup and session wiring. Covered initial options, name sorting,
  unknown IDs, zero filtering, identity-preserving dispatch, optimistic selection,
  server reconciliation, loading/empty/unlisted selection states, and retirement.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and
  `npm run format:check` passed.
- `cargo fmt --all -- --check` and clippy for protocol, world, core, 3d host, and
  CLI with `--all-targets -- -D warnings` passed.
- `git diff --check` passed.

The browser harness required sandbox escalation to open its loopback server; the
rerun succeeded. The tests used synthetic or checked-in inputs. No interactive
TUI launch, screenshot review, or visual acceptance was performed.

The final quality pass traced wire decoding, world retention, core publication,
host projection, frontend schema, owner mutation, and panel consumption together.
There is no new confirmation, membership-validation, retry, or rollback mechanism.
Accepted limitation: a silently rejected selection remains optimistic until later
server facts replace it.

## Commit review

Verdict: ready within the character-title selection scope. The review covered
the accumulated implementation, tests, and plan, including protocol dispatch,
world hydration and private-property retention, core command admission and
publication, host parsing/projection, frontend session dispatch and snapshot
replacement, and the Character panel's final consumption.

One presentation finding was fixed: the existing title text could show the old
title beside an optimistically updated dropdown. The loaded dropdown now serves
as the title display; the text remains while the registry is unavailable. The
browser harness asserts that optimistic selection has no competing title text.
Protocol definitions were also moved before their test modules, and the world
registry uses the module's collection import consistently.

No title-specific transaction owner or extra shared abstraction is justified.
Frontend optimism and shared world state remain separate snapshots with distinct
owners. Registry resets belong to world baseline hydration and core session
lifecycle respectively. Eligibility remains server-owned as requested. Visual
acceptance and unrelated subsystems are outside this review.
