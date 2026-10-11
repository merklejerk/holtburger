# h3d Contracts Journal Implementation Plan

Status: base Journal implemented and automatically verified on 2026-10-10.
The outdoor contracts map extension is implemented and automatically verified
on 2026-10-11. Phases 6–8 are complete. Visual acceptance remains with the user. Actual
ACE acquisition/update/removal/relogin validation is unavailable because the
noninteractive probe requires `HOLTBURGER_PROBE_ACCOUNT`; synthetic transport and
browser lifecycle verification passed. The live-probe checklist below records
that reproduced prerequisite failure, not a completed live gameplay sequence.

## Goal and scope

Wire the Journal shortcut to a compact, server-backed contracts list with status
icons and expandable details. This implements the quest-log portion of retail's
journal, not its player-written notebook. Extend the World map with an optional,
compact layer of outdoor contract contacts and quest-area points.

In scope:

- Static contract definitions, tracker messages, retained character state, and
  the narrow host/frontend delivery path.
- Search, status filtering, stable ordering, independently expandable rows,
  descriptions, authored progress text, contacts, locations, and countdowns.
- Outdoor contract map markers, a Contracts icon toggle, role-specific icons,
  coincident-point grouping, and hover tooltips.
- Remove from journal through the existing server abandonment action.
- Accessible status icons and reuse of existing HUD, control, dialog, and
  keyboard ownership behavior.

Out of scope:

- Personal notes, manual timers, reconstructed quest history, and `/myquests` parsing.
- Map navigation/actions, indoor entrance discovery, pinned HUD quests, and progress bars.
- Persistent marker labels, radius/region rendering, routes, marker click actions,
  proximity/zoom clustering, and settings persistence for the Contracts toggle.
- ACE changes, retail decompile edits, TUI UI work, and speculative generic panel abstractions.
- Optimistic deletion, rollback, acknowledgement tracking, timeout state,
  automatic retries, and mutation-specific pending UI.

## Accepted UX and design constraints

- A collapsed row shows an expand chevron, status icon, quest name, authored
  progress or repeat countdown when applicable, and an optional deadline badge.
- Expanded content shows description, readable status, the appropriate contact
  and location, quest area, timer details, and a secondary Remove from journal action.
- Multiple rows can remain expanded. Preserve expansion by contract ID, search,
  filters, and scrolling across panel closes. Reset character-specific state on
  character retirement; filtering must not discard expansion state.
- Default ordering is alphabetical with contract ID as the tie-breaker. No
  automatic reorder as timers tick. No additional sorting controls in this slice.
- Search matches name and description using the shared spell-search word and
  subsequence rules: every query term matches a word, including terms split
  across fields. This follow-up is already implemented; map reads stay unfiltered.
- Status icons distinguish Available, In progress, Completed, and Waiting to
  repeat. Use shape as well as color, readable tooltips, and accessible labels.
  Counter stages use the In progress icon. A deadline badge is independent of status.
- Do not invent a Ready to repeat history category: Available after login does
  not prove prior completion. Expired repeat countdowns become Available.
- Preserve authored progress text; do not infer a universal target or percentage.
- Show missing locations explicitly and distinguish indoor cells from outdoor
  locations. Do not infer an outdoor entrance for an indoor destination.
- Contact selection follows proven retail stage rules. Role labels must remain
  honest when a definition supplies only one contact.
- Remove sends the command and leaves the row until authoritative deletion.
  Surface dispatch errors through the existing error path. Repeated removal is
  harmless in ACE's erase path; add no pending/timeout machinery.
- Explain that removal retains quest progress. Use existing confirmation/dialog
  behavior for the removal prompt rather than introducing another modal owner.

## Accepted outdoor map UX

- A Contracts icon button uses the existing Journal icon and HUD button styling,
  `aria-pressed`, an accessible name, and a Show contracts tooltip. Default off.
  Retain the choice across closing/reopening the World panel and switching its
  tabs. Reset it to off on character retirement/change; do not add disk settings.
- Show the retail-selected contact when its destination is outdoors, in all
  resolved statuses. Show an outdoor quest-area point only while In progress,
  including counter stages. This quest-area visibility rule is h3d presentation
  policy, not an ACE relevance rule. Deadline expiry alone does not hide an
  In progress quest-area marker.
- Contact selection stays with the existing shared resolver: Available uses the
  start contact; In progress/counters prefer the end contact; Completed/Waiting
  use the start contact; an absent start name permits the supplied end contact.
  Do not independently select contacts in map code or show both contacts by default.
- Contact markers use a simple person icon; quest-area markers use a quest icon.
  Icons encode location role, not contract status. Use theme hooks, fixed CSS-pixel
  sizes across zoom, and no persistent names, countdowns, or other text on the map.
- One contract can contribute two distinct markers. A quest area is one authored
  point, never a radius or polygon. These authored destinations are not live NPC
  observations and do not prove a next objective or entrance.
- Hover tooltips show contract name, readable status, location role (Start contact,
  End contact, or Quest area), the NPC name for contacts, and outdoor coordinates.
  Use the existing map tooltip owner. An unrelated pointer location still shows
  the existing cursor coordinates; preserve settlement tooltip behavior.
- Merge exactly coincident horizontal world positions into one visible marker,
  across roles and contracts. A combined marker uses the quest icon and lists all
  contributing contracts/roles in its tooltip. Keep distinct locations separate;
  do not introduce displacement, distance thresholds, or zoom clustering.
  Identity remains contract ID plus role, never the contract name.
- If separate icons overlap in screen space, hover includes all hit contract
  markers rather than making one inaccessible. Contract hits take tooltip
  priority over settlement hits; otherwise preserve settlement/cursor fallbacks.
- Omit indoor, missing, unresolved, and off-map destinations. Exclude nothing
  based on Journal search/filter/expansion or whether the Journal has been opened.
  Server updates/deletions, recovery, and character retirement drive marker facts.
- Reuse existing map pan/zoom/input ownership. Markers have no click behavior and
  must not intercept drag, wheel, or the existing map command gestures.

### Marker roles and contextual visibility

This table describes the ordinary two-contact definition. The shared resolver
still owns contact selection, including definitions with only one named contact;
the frontend consumes its selected role rather than deriving it from the label.
Each destination must independently pass the outdoor/map-bounds checks.

| Retained contract state | Selected contact marker | Quest-area marker |
| --- | --- | --- |
| Available, stage 1 | Start contact, person icon | Hidden |
| In progress, stage 2 or counter stage | End contact when supplied, otherwise start; person icon | Quest icon at the authored area point |
| Completed, stage 3 without repeat semantics | Start contact, person icon | Hidden |
| Waiting to repeat, stage 3 with positive repeat duration | Start contact, person icon | Hidden |
| Stage 3 repeat duration expires to Available | Keep the resolver-selected contact, person icon | Hidden |
| In-progress deadline expires | Keep the resolver-selected contact, person icon | Keep the area point; deadline expiry is not completion |
| Unresolved definition or retired character | No marker | No marker |

Two roles may be visible for one in-progress contract. Different positions show
different icons; exactly coincident positions share a quest icon, with both
roles listed in the tooltip. An indoor contact does not suppress an outdoor area,
and an indoor area does not suppress an outdoor contact. A sole end contact
remains labeled End contact even when the contract is Available or Completed.
The tooltip carries status; marker artwork carries role.

### Completion and retention contract

Completed is a resolved display status, not a distinct ACE wire enum or a signal
to delete the row. ACE sends stage 3 (`DoneOrPendingRepeat`); the shared resolver
uses the authored repeat flag and received repeat duration to distinguish
Completed, Waiting to repeat, and Available. A positive repeat duration ages to
Available without implying a new contract or exposing a completion-history row.

ACE's `ContractManager.NotifyOfQuestUpdate` calls `Update`, which sends an
updated tracker. It does not erase the registry entry when the quest finishes.
`Abandon` calls `Erase`, which removes the entry and sends `DeleteContract`.
Therefore completion alone retains the Journal row and its eligible contact
marker; membership changes only through authoritative deletion/replacement or
character retirement. Do not infer deletion from status, deadline, panel close,
or a successfully queued removal command.

Retained facts belong to the shared world state and the character/session
delivery owner. Journal expansion, search, filters, and scroll belong to the
frontend Journal view. Map toggle and prepared marker nodes belong to the
frontend World panel. Closing either panel changes presentation work, not
contract membership; neither panel becomes the source of truth for the other.

## Ground truth and evidence

Retail references, all in `acclient-eor-source/acclient.c`:

- `gmContractsUI::FillProgressString`, line 201079: stage labels, repeat expiry,
  completion interpretation, and counter formatting.
- `gmContractsUI::UpdateButtons`, line 201271: description, contact selection,
  location display, and deadline presentation.
- `LandDefs::inbound_valid_cellid`, line 199885, and `gid_to_lcoord`, line
  199925: outdoor terrain-cell eligibility and journal coordinates.
- `gmContractsUI::RebuildContractList`, line 201935: static/dynamic join by contract ID.
- `gmContractsUI::ListenToElementMessage`, line 202193: sorting and abandonment.
- `CPlayerSystem::UpdateContractTrackerTable`, line 380182, and
  `UpdateContractTracker`, line 380249: replacement/update and receipt-time anchors.
- `CContractTracker::UnPack`, line 431336: 28-byte tracker layout.

ACE references:

- `ACE/Source/ACE.DatLoader/FileTypes/ContractTable.cs`: portal record `0x0E00001D`.
- `ACE/Source/ACE.DatLoader/Entity/Contract.cs`: complete static definition layout.
- `ACE/Source/ACE.Server/Network/Structure/ContractTracker.cs`: tracker layout,
  server-owned stage computation, and counter encoding.
- `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventSendClientContractTrackerTable.cs`
  and `GameEventSendClientContractTracker.cs`: full and incremental messages.
- `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAbandonContract.cs`.
- `ACE/Source/ACE.Server/WorldObjects/Managers/ContractManager.cs`: acquisition,
  quest-flag monitoring, and removal without erasing quest progress.
- `ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs`: login delivery;
  empty registries produce no tracker table.
- `ACE/Source/ACE.Server/Managers/QuestManager.cs`, `GetNextSolveTime`: timer
  values are remaining seconds, including sentinel outcomes, not Unix timestamps.
- `CContract::UnPack`, `acclient.c:432424`: version is read without a version-based
  decode branch. Preserve it; do not reject nonzero versions merely because this
  census observed zero, or require tracker/definition version equality without evidence.

The read-only survey decoded all 322 definitions in the local retail DAT and
consumed the complete 97,244-byte record. All definitions had version 0.

| Authored fact | Count | Consequence |
| --- | ---: | --- |
| Repeat flag | 300 | Repeat countdowns are a primary use case |
| Progress flag | 90 | Counter stages need explicit modeling |
| Progress format text | 89 | Counter without text must still render In progress |
| Target-shaped progress strings | 86 | Preserve text rather than assume every counter has a target |
| Open-ended progress strings | 3 | Contracts, Wins, and Quests are not percentages |
| Deadline flag | 3 | Conditional badge; two definitions are named test contracts |
| Description | 322 | Maximum observed length is 181 characters |
| Start contact only | 55 | End contact cannot be required |
| End contact only | 11 | Start contact cannot be required |
| Both contacts | 256 | Stage-dependent contact choice |
| Indoor start/end cell | 95 each | Indoor destinations are common |
| Quest-area location | 320 | Preserve locations for future map integration |

Distinct IDs can share the same name. Never key, deduplicate, or preserve row
identity by name. The shipped table includes test content; this census does not
prove gameplay frequency or player registry composition. Do not filter test
definitions by their names in production.

The local `dats/assets.hba` index also contains `eor/portal:0x0E00001D`, with
97,244 uncompressed bytes and only the Zstd flag. The current runtime bundle
therefore already retains the complete record; no local bundle regeneration is
needed for this feature. Future micro archives must retain it once bootstrap
requires the catalog.

## Ownership and delivery

```text
portal DAT -> dat decoder -> content definition lookup
                                      |
server -> protocol -> world trackers -> core publication
                                      |
                         h3d host typed projection
                                      |
                    frontend owner -> expandable journal

Remove -> frontend -> host adapter -> core -> protocol -> server
Delete <- frontend <- host event   <- core <- world    <- server
```

- `dat`: lossless static decoding, using existing position and string primitives.
- `content`: runtime static definition access and parsing/validation of authored
  progress formats. No archive paths in core.
- `protocol`: deterministic wire types, codecs, and opcodes only. Preserve both
  incremental flags, including SetAsDisplayContract, without inventing pinning UX.
- `world`: authoritative character tracker retention, replacement, upsert,
  deletion, and shared game-derived semantics. Decode the counter once into a
  composite stage type; consumers must not repeat stage arithmetic.
- `core`: character admission/reset, event publication, and abandonment command
  dispatch. Consume parsed data when static definitions are required.
- Host: typed, narrow projection and command adapter. No stage decision logic.
- Frontend: icons, labels, filters, ordering, expansion, confirmation, and cadence.

Load a parsed `ContractCatalog` through `ContentRepository` into `WorldBootstrap`,
following the title catalog pattern. World keeps an immutable Arc and joins
trackers to definitions for shared interpretation. Update both bootstrap assembly
paths: core's `ClientRuntimeBuilder::load_assets` and the host's
`SharedHostContent::client_world_bootstrap`. Update `WorldBootstrap::synthetic`
and every explicit constructor caller, including the death-motion harness and
world tests. The micro manifest must retain the table because shared startup now
requires it. Do not add a second host-only catalog/cache or per-row content fetch.

Follow the enchantment timing pattern in `world/src/enchantments.rs`, core's
`application_snapshot`/event publication, and frontend `ClientTimedEnchantments`:

1. World records remaining seconds plus a Rust monotonic receipt anchor. Use
   elapsed subtraction rather than adding enormous sentinel durations to Instant.
2. A shared world read function resolves semantics and remaining durations at
   an explicit `now`. Core uses that same function for events and recovery.
3. Host serializes the resolved snapshot, without Rust Instants. Browser receipt
   adds one `performance.now()` anchor to the snapshot.
4. The frontend owner advances display durations from that anchor; it never
   resets the anchor on panel open or a display tick. On recovery it receives
   newly aged durations and replaces its receipt anchor.

This accepts ordinary IPC transit delay, as the existing enchantment path does.
It avoids clock synchronization machinery and the discontinuous fallback in
`WorldState::current_server_time`. Never feed receipt-relative contract durations
through that server-time clock. No periodic core timer publications are needed.

The resolved contract type supplies the semantic timer role and expiry outcome:
repeat waiting expires to Available, deadline running expires to Finished. One
frontend display helper advances these supplied outcomes and supplies the status
icon, readable label, and filter category together; it does not reinterpret wire
stages or quest flags. Preserve stage 3's distinction between positive repeat
duration, expired repeat duration, and no positive duration with/without a static
repeat flag. Counter stages are in progress, including stage 4's zero counter.

For contact selection, use the end contact only when its name exists and the
tracker is stage 2/counter stage, or the starting name is absent. Otherwise use
the start contact; stage 3 does not automatically select the end contact. Derive
outdoor journal coordinates from the cell ID, not the authored frame: the low
word must be 1–64 and both landblock bytes below 255. With
`x = blockX * 8 + (cell - 1) / 8` and
`y = blockY * 8 + (cell - 1) % 8`, longitude/latitude respectively are
`(coordinate - 1024) * 0.1 + 0.5`. Zero is missing; other nonzero destinations
display Indoors, matching retail's failed outdoor-coordinate lookup. Preserve
the full authored position in the static definition regardless of display.

Initialize an empty tracker registry at character entry because ACE omits an
empty table. Preserve accepted facts across portals and clear them on character
retirement. Admit early login events through the existing character lifecycle.

Malformed static content/format strings fail catalog assembly with context.
Missing definitions for incoming IDs retain the tracker and produce an explicit
unresolved row identifying the contract ID; removal remains possible. Do not fail
the whole session or silently drop other rows for one lookup miss. Use one typed
resolved/unresolved row union rather than nullable fields that consumers must
reassemble. Malformed wire input, including nonfinite durations or stage zero,
fails protocol decoding. Finite negative durations are valid expiry sentinels.
Delete messages remove by ID without requiring static lookup first.

### Map extension sources and ownership

Ground truth adds `ACE/Source/ACE.DatLoader/Entity/Contract.cs`, `Position.cs`,
and `Frame.cs`: three authored destinations (start NPC, end NPC, quest area),
each with cell ID, origin XYZ, and orientation. There is no quest-area extent.
The DAT decoder already preserves all of them; no new DAT or wire message is
needed. `crates/holtburger-world/src/state/contracts.rs` already supplies the
selected contact role and semantic status, independent of the panel lifetime.

The current resolved outdoor location has only latitude/longitude used for
retail Journal display. Extend that same variant with a mandatory source
`WorldPosition`, using the existing `holtburger-common` representation and
preserving the original cell identity in its `landblock_id`. Construct it from
`ContractPosition` where world resolves the selected contact and area. Retain
Journal coordinate fields and their existing meaning; do not reconstruct source
positions from display coordinates, round them, or normalize away the cell ID.
Missing and indoor variants do not acquire optional outdoor-position fields.
The consumer of the added source position is the map projection; rotation is
preserved as part of the existing lossless position type, not as a new map feature.

Carry this shape through the existing host snapshot/event and frontend schema.
Follow the serialized `WorldPosition` shape already used in
`client-housing-contract.ts`; verify real Rust serialization instead of asserting
that a DAT `Frame` automatically serializes. No second host catalog, map-specific
server command, or retained authoritative marker registry is warranted.

Frontend `ClientContractsState` gains an unfiltered, aged facts read, with the
same nullable known/unavailable convention and the same receipt anchor. Journal
`read()` uses it before applying its own query/filter/order. Both consumers use
one aging helper; map code never reinterprets wire stages or quest flags. Do not
retain another facts cache merely to feed the map.

```text
world's selected contact/area + source positions + semantic status
                 -> existing core snapshot/event -> host -> session owner
                                                     |             |
                                    Journal local query/filter     unfiltered facts
                                                                   |
                                              app-local map eligibility/placement
                                                                   |
                                               grouped SVG markers + hover tooltip
```

- Shared world layer: selected contact and lossless destination facts.
- App host layer: typed delivery using the existing contracts seam.
- App frontend layer: source AC position to branded scene coordinates, quest-area
  eligibility, toggle, grouping, icons, hit testing, and tooltip composition.
- Existing WorldMapOwner: image residency/view/RAF only. Contract behavior stays
  in the client panel/overlay, not the image source or shared map infrastructure.

For map placement follow `client-housing-map.ts` and the established outdoor
landblock transform: source origin X/Y is landblock-local east/north, Z is
height; the canonical scene uses north-negative Z. Use
`createLandblockWorldOrigin` and the existing scene-coordinate brands at the
conversion owner. Render with `projectWorldMapPoint`. Never invert the Journal's
cell-based display coordinates or add its display bias to source geometry.
Tooltip coordinates at authored points use `formatWorldMapCoordinates`, as the
other map markers do; the Journal keeps its existing retail coordinate labels.
These may differ because the Journal labels a terrain cell rather than the exact
source point. Keep both meanings explicit and covered by tests.

Existing map seams to reuse:

- `client/ClientWorldView.svelte`: pass the retained contracts owner to the World panel.
- `client/ClientWorldPanel.svelte`: overlay roots, map draw subscription, visible
  cadence, icon controls, tooltip ownership, and character reset policy.
- `client/client-housing-search-overlay.ts` and
  `lib/game/world-map/settlement-overlay.ts`: retained SVG nodes/draw/hit patterns.
  Reuse mechanisms where warranted without extracting a speculative overlay framework.
- `lib/game/world-map/view.ts`, `lib/game/landblocks.ts`, and
  `lib/game/map/map-coordinates.ts`: projection, source conversion, and display.
- `harness/browser/ClientHudHarness.svelte`, `WorldMapHarness.svelte`, and
  `scripts/browser-harness.mjs --client-world-map`: runtime verification paths.

## Existing integration patterns

- `crates/holtburger-dat/src/file_type/` and `src/manifest.rs`.
- `crates/holtburger-content/src/repository.rs` and `src/character_titles.rs`:
  parsed static catalog access.
- `crates/holtburger-protocol/src/messages/friends.rs`, game event/action dispatch,
  and `src/opcodes.rs`.
- `crates/holtburger-world/src/state/friends.rs`, `handlers/friends.rs`, and events.
- `crates/holtburger-core/src/client/friends.rs`, commands, messages, snapshots,
  and lifecycle reset wiring. Reuse delivery, not its pending-action UX.
- `crates/holtburger-world/src/bootstrap.rs`, `state/types.rs`,
  `handlers/routing.rs`, and `enchantments.rs`: composition, reduction, and timing.
- `apps/holtburger-3d/host/src/client_friends.rs`, `client_projection.rs`, and
  `client_runtime.rs`.
- `apps/holtburger-3d/src/client/client-lifecycle-session.ts`, host schemas, and
  `client-friends-state.ts` for session ownership/recovery conventions.
- `apps/holtburger-3d/src/lib/host/host-transport.ts`: command/event allowlists
  and event payload map; this is a separate seam from frontend Zod schemas.
- `ClientShortcutDock.svelte`, `ClientWorldView.svelte`, `ClientHudWindow.svelte`,
  UI defaults/layout persistence, `ClientDialogs`, and `src/app/ui-base.css`.
- Existing disclosures and icon assets must be inspected before adding new ones.

## Phased implementation

### Phase 1: Static content and wire codecs

- [x] Add `file_type/contract_table.rs`, exports, and typed asset integration.
- [x] Add content lookup using the existing repository/catalog pattern.
- [x] Parse authored progress formats into a narrow safe representation; support
  literal text and the observed integer placeholder without a general printf engine.
- [x] Implement tracker table/update codecs and abandonment action; enable
  opcodes `0x0314`, `0x0315`, and `0x0316` throughout pack/unpack dispatch.
- [x] Make the decoded progress counter representable on the wire by
  construction: `count <= u32::MAX - 4`. A public unrestricted `u32` followed
  by `checked_add(4).expect(...)` leaves an invalid constructible state. Use a
  narrow validated counter value rather than a pack-time assertion. Verify
  zero, the maximum representable count, and rejection above the maximum.
- [x] Add the catalog to `WorldBootstrap`, both runtime assembly paths, synthetic
  bootstrap, and explicit constructor callers. Keep phases independently compilable.
- [x] Add the table to the micro manifest and test profile retention. Full/pruned
  profiles and the local runtime bundle already retain it; do not regenerate them.
- [x] Add synthetic format/codec fixtures covering empty tables, counters, flags,
  truncated input, and malformed reachable cases.

Acceptance: affected crates compile; synthetic decoding and round-trip tests
pass; raw DAT and generated content lookup resolve the same surveyed definitions.
Keep asset-dependent verification as an investigation, not a retained test.

### Phase 2: Shared retained state and commands

- [x] Add focused contracts state/reducer and world events.
- [x] Establish timer normalization and typed stage/counter semantics; use ACE
  and retail to resolve completion/repeat behavior precisely.
- [x] Wire core event admission, snapshots, publication, entry/retirement reset,
  and abandonment dispatch.
- [x] Register the handler in world routing and both tracker events in core's
  character-lifetime admission guard. Event ordering already selects the character;
  reuse it rather than add another sequence or session-identity mechanism.
- [x] Represent active-but-empty separately from no active character using the
  existing snapshot lifecycle convention. Initialize empty before login events,
  and never reset on PlayerDescription or scene/world-generation changes.
- [x] Ensure deletion of an absent ID is an idempotent removal, never an insertion.
- [x] Test replacement, upsert, deletion, progress, expiry, early delivery,
  empty login, portals, retirement, and snapshot recovery.
- [x] Prove command queueing never mutates the retained registry.

Acceptance: one authoritative registry, no raw quest-flag reconstruction, timer
anchors survive recovery, and no stale contracts leak between characters.

### Steering checkpoint

Review the static/dynamic join, timer transport, and lifecycle before adding UI.
Confirm no app-local policy has moved into shared crates and no second retained
registry or derived stage arithmetic has appeared. Investigate any mismatch with
ACE/retail before extending the implementation.

### Phase 3: Host and frontend delivery

- [x] Add a narrow `host/src/client_contracts.rs` projection/action adapter.
- [x] Extend host snapshots/events, command routing, and TypeScript schemas.
- [x] Add `client-contracts-state.ts` and session lifecycle wiring for facts,
  search, filtering, and expansion.
- [x] Project resolved static facts without dropping full source data from shared
  definitions. Reuse the established recovery ordering.
- [x] Follow the resolved-duration/browser-receipt pattern above. Test that an
  unrelated tracker update ages every unchanged row instead of restarting it.
- [x] Route the new command/event through sidecar and browser transport allowlists,
  listener-before-snapshot recovery, and terminal reset handling, following Friends.
- [x] Verify composition with a real Rust-produced serialized snapshot/event
  parsed by the frontend schema. Cover resolved/unresolved rows, both timer
  variants, nullable fields, contact roles, and camelCase field names; independently
  hand-authored Rust and TypeScript fixtures do not establish this seam.
- [x] Route removal failures to existing error presentation; add no mutation
  tracker, acknowledgement timeout, retries, or optimistic updates.

Acceptance: recovery and incremental delivery agree; character retirement clears
facts and local row state; a successful dispatch leaves membership unchanged.

### Phase 4: Journal window and expandable rows

- [x] Add `ClientJournalPanel.svelte` and wire Journal into system panel routing,
  retained window composition, UI defaults, layout persistence, and session props.
- [x] Add `journal` to `ClientUiDefaults`, HUD layout construction, and
  `client-settings-contract.ts`. Existing settings save each HUD placement
  independently; test that old saved placements merge with the new default
  without resetting other windows. No broad settings migration is needed.
- [x] Update exhaustive HUD consumers outside the production shell. In
  `src/harness/browser/UiShowcase.svelte`, exclude Journal from the `HudSurface`
  union for simple HUD surfaces, as the other retained windows are excluded.
  Do not cast away the missing placement/resizable guarantees.
- [x] Reuse common controls/styles and keyboard policy. Add authored SVG status
  assets only where existing icons are insufficient.
- [x] Implement collapsed/expanded content, accessible icon labels, search,
  status filter, stable ordering, and independent expansion by ID.
- [x] Add removal confirmation explaining retained quest progress.
- [x] Bind the frontend owner as an existing `LocalDialogSource`; dismiss its
  question on panel hide/character retirement and if the target is deleted.
  Recheck current membership and command availability on acceptance. This local
  question identity is not a server acknowledgement or pending-mutation tracker.
- [x] Refresh visible countdowns at a bounded display cadence; stop hidden work.
  Do not publish countdown ticks through the core event stream.
- [x] Cover duplicate names, open-ended progress, counter without format,
  one-contact definitions, missing/indoor locations, and expired timers.
- [x] Prune expansion only for authoritative deletions/full replacements, never
  filtering. Retain a row for unresolved content and disable mutations outside
  an active in-world command context while preserving accepted facts.

Acceptance: dock opens the retained window; closing/reopening preserves local
state; filtering preserves expansion; countdowns do not reorder rows; removal
only disappears after authoritative deletion. Visual acceptance belongs to the user.

### Phase 5: Verification and cleanup

- [x] Run affected Rust tests, formatting checks, and clippy with warnings denied.
- [x] Run app type checks, focused TypeScript tests, lint, and formatting checks
  through existing package scripts.
- [x] Use the browser harness for nonvisual interaction/lifecycle verification:
  toggling rows, filtering, panel reopen, countdown expiry, recovery, and deletion.
  Extend the existing `ClientHudHarness.svelte` probe registration and
  `scripts/browser-harness.mjs` dispatch with a contracts probe, following the
  Friends probe. Exercise the production dock/window composition, not just an
  isolated panel mount: verify retained DOM/scroll, hidden cadence cleanup,
  disclosure keyboard activation, input ownership, and removal through the
  existing dialog owner. Change characters within the same session owner and
  prove search, expansion, scroll, and confirmation reset; keying by the owner
  object alone does not establish character retirement behavior.
- [x] Use the debug harness or existing noninteractive client probe for actual
  acquisition/update/removal/relogin sequences where suitable content exists.
  Do not run the TUI. Report exact unavailable prerequisites and retain synthetic evidence.
- [x] Sweep placeholder routing, obsolete vocabulary, redundant representations,
  dead fields, and temporary diagnostics. Update touched architecture/protocol docs.
  Restore the title-catalog method's documentation in `content/src/repository.rs`
  and use `resetCharacterLists` for the frontend method/comment that now also
  retires journal state.
- [x] Add retail compatibility markers only for deliberate observable quirks or
  divergences, with the required citation, consequence, and census.

Acceptance: automated checks pass; browser behavior and transport/lifecycle
evidence support the implementation; no runtime-asset-dependent tests remain.

Use these concrete paths to check the complete slice, with injected clocks and
synthetic definitions/packets where live content is unnecessary:

| Trigger | Required result |
| --- | --- |
| Enter a character with no contracts and receive no table | Active journal displays an empty list, not indefinite loading |
| Receive trackers before PlayerDescription | Accept within EnteringWorld; subsequent description does not erase them |
| Receive a full table after prior deltas | Atomically replace membership by ID |
| Receive a second tracker while the first timer has aged | First countdown continues from its original receipt |
| Open, close, and reopen the journal after elapsed time | Expansion/scroll remain; durations do not restart |
| Recover snapshot after lost events | Replace facts with currently aged durations using the same shared resolver |
| Positive repeat duration reaches zero with no new packet | Icon, readable status, and status filter all become Available coherently |
| Deadline reaches zero | Deadline becomes Finished; quest progress/status is not falsely completed |
| Two contracts share a name | Independent rows, expansion, removal, and deterministic order |
| Remove command queues successfully | Row remains until deletion; no pending/timeout state |
| Deletion arrives while confirmation is open | Row and its local question disappear; stale acceptance sends no command |
| Delete an unknown ID with no static definition | No row is inserted and no definition lookup is required |
| Enter a portal | Keep facts and local row state |
| Retire character, then receive a late tracker | State remains cleared; existing ordering/admission rejects stale input |
| Load old saved HUD placements | Add Journal default; preserve all prior windows |
| Change character while retaining the session owner | Clear local controls/scroll/question even if the new character shares contract IDs |
| Serialize a resolved Rust snapshot and deliver it through the host | Frontend schema accepts actual producer output with no field reconstruction |

### Phase 6: Outdoor source positions and independent map facts

- [x] Extend resolved outdoor destinations with the existing lossless
  `WorldPosition`; leave static decoding, contact selection, indoor/missing
  behavior, Journal labels, and server tracker semantics intact.
- [x] Update the frontend schema and existing Rust-produced transport fixture
  test for source cell ID, origin, and rotation. Test contact and area positions
  independently, including nonzero local offsets that a cell-center shortcut
  would erase. Report invalid/nonfinite authored positions with content context
  rather than inventing a fallback point; check the local definition census for
  such inputs before choosing any broader handling.
- [x] Add the unfiltered aged facts read to `ClientContractsState`; make the
  Journal consume that read before its existing presentation filters. Preserve
  one receipt anchor and reset path, with no new authoritative cache.
- [x] Add a focused app-local `client-contracts-map.ts` projection: selected
  outdoor contacts in all statuses, outdoor area only In progress, branded scene
  positions, IDs/roles, tooltip facts, and exact horizontal-position grouping.
  Sort group members by contract name, ID, then role for stable hover output.
- [x] Test Available/In progress/counter/Completed/Waiting policies; only-start
  and only-end contacts; deadline expiry; missing/indoor/unresolved destinations;
  duplicate names; same-point roles/contracts; and distinct local positions in
  the same terrain cell. Read semantic status; do not recalculate it.
- [x] Prove Journal search/status filters cannot alter the unfiltered map facts.

Acceptance: actual Rust output passes the frontend schema; source offsets survive
transport and placement; eligibility is owned by h3d; Journal behavior remains
correct and map facts exist without mounting/opening the Journal.

Before adding UI, review the position census and serialized seam. Stop for a
major content/coordinate gap rather than disguising it with cell-center fallbacks.
The extension should need roughly 350–550 production lines plus focused tests;
reassess a substantial overrun for duplicate owners, generic helpers, or stale paths.

### Phase 7: Compact World-map markers and Contracts toggle

- [x] Pass the session contracts owner through `ClientWorldView` to
  `ClientWorldPanel`; update other typed panel callers/harness fixtures.
- [x] Add the default-off Contracts icon toggle alongside existing map controls.
  Use the Journal icon, `aria-pressed`, tooltip/name, retained panel choice, and
  explicit character reset. Avoid new settings or a new toolbar framework.
- [x] Add a focused `client-contracts-map-overlay.ts` and SVG root following
  current retained overlay patterns. Reuse suitable authored person/quest assets;
  add independent SVG files only when current assets cannot express the roles.
  Combined groups use the quest icon; no inline SVG geometry or persistent labels.
- [x] Prepare marker datasets on accepted facts/context changes, not player
  motion, pan, or zoom. Map draws only project retained points; do not put full
  snapshot reads, classification, or array publication on the 30 Hz player path.
- [x] Subscribe/re-read current owner facts when the visible layer activates.
  Hidden/toggled-off maps do no contract display polling; reactivation samples
  currently aged facts. Reuse the existing journal display cadence only for
  visible timer/status presentation, without duplicating expiry rules or
  rebuilding SVG membership every tick. Unsubscribe/dispose owned resources.
- [x] Reproject through the map's image RAF and resize path. Cull off-map and
  off-viewport points; keep icons a fixed CSS size and true source position.
- [x] Extend the existing tooltip composition/hit testing with grouped contract
  entries and all overlapping hits, followed by existing settlement/cursor
  fallbacks. Keep tooltip text safely rendered and constrained to map bounds.
- [x] Clear marker nodes, stale hover content, and toggle state at character
  retirement/change; server deletion/full replacement removes associated roles.
  Successful removal dispatch alone leaves markers visible until server deletion.
- [x] Preserve existing pan/zoom, hidden-map retention, settlements, housing,
  player/home markers, and map command gestures. Marker nodes do not acquire
  click actions or another tooltip owner.

Acceptance: simple role icons are the only persistent contract ink on the map;
one contract can show contact and area; identical points share one icon with
complete tooltip facts; the default-off toggle works independently of Journal
visibility and preserves its choice across panel/tab switches.

### Phase 8: Map extension verification and cleanup

- [x] Run affected Rust unit tests, `cargo fmt`, and clippy with warnings denied
  for shared position/projection changes. Run app `check`, focused spell/Journal
  and map tests, `lint:ts`, `lint:dead`, and `format:check` through package scripts.
- [x] Extend the existing browser harness with contract-map fixtures and probes.
  Use the production World dock/window, not only an isolated overlay. Cover
  toggle accessibility/default/reopen/tab behavior; both role icons; tooltip
  names/status/NPC/coordinates; coincident grouping and overlapping hits; source
  offsets; pan/zoom/resize; and no persistent text labels or radius geometry.
- [x] Keep the Journal unopened, then receive tracker updates and prove map
  changes. Set a Journal search/filter, close it, and prove map membership stays
  independent. Queue removal, then deliver deletion, proving both lifecycle steps.
- [x] Exercise snapshot recovery, portals, hidden updates/reopen, timer expiry,
  and character replacement with overlapping IDs. Check stale tooltip clearing,
  toggle reset, and that hidden/toggled-off contract cadence work stops.
- [x] Explicitly verify an In progress -> Completed authoritative update keeps
  the contract row, removes only its area marker, and updates its selected
  contact/tooltip; a later deletion removes all its roles. Cover indoor/outdoor
  eligibility independently for contact and area, plus a sole end contact whose
  tooltip must retain the authored End contact role outside In progress.
- [x] Run the existing World-map/housing interaction probes to catch tooltip,
  input-gesture, and overlay ordering regressions. Use synthetic evidence where
  live probe prerequisites remain unavailable; report exact missing prerequisites.
- [x] Reassess added lines and owners, remove temporary instrumentation and
  duplicate timers/caches, and update touched architecture docs. Keep contract
  overlay policy app-local; add no generic clustering or overlay framework.
- [x] Record execution decisions/check evidence here when implemented. Leave
  visual acceptance of icon readability and map density to the user.

Acceptance: automated seam and browser behavior checks pass, including existing
map interactions. No live-play or visual-acceptance claim is inferred from them.

## Risks and resolutions

- **Timer sentinels and misleading wire names:** treat values as durations; prove
  normalization against ACE and test finite negative/expired values.
- **Recovery restarting timers:** preserve owner anchors and explicitly test delayed
  snapshots and remounts. Settle transport representation before frontend work.
- **Stage 3 is not always permanently Done:** follow retail's repeat-flag and
  duration interpretation rather than assign one label solely from the wire stage.
- **Definition lookup failure:** retain an explicit unresolved row with its ID;
  no invented descriptions, silent omission, or unsupported version-equality rule.
- **Unsafe authored formatting:** parse the supported grammar once in content;
  consumers format through it rather than evaluate arbitrary printf syntax.
- **Scope growth:** the optional outdoor map layer is now planned; map actions,
  indoor entrance discovery, routes, proximity clustering, and HUD pinning stay
  deferred. The layer does not require new server messages.
- **Confusing coordinate meanings:** preserve the Journal's retail cell labels;
  use authored source positions for map placement and the map's existing formatter
  for marker tooltips. Never derive precise geometry from displayed degrees.
- **Clutter and collisions:** default off, fixed-size role icons, hover-only
  information, exact-point grouping, and tooltips listing overlapping hits.
  Dense unrelated points can still overlap at whole-world zoom; this is an
  accepted first-slice concession, not grounds for an unrequested clustering system.
- **Static facts overclaiming relevance:** quest areas are point references, not
  extents or confirmed objectives. In-progress-only area visibility is explicitly
  app policy; contact choice remains the shared retail rule.
- **Small feature, broad plumbing:** the new feature files contain 1,519 physical
  production lines before Rust test modules, plus existing-file integration.
  Wiring pushes the slice above the original 1,600-line upper estimate. The final
  review found no need for a second registry, catalog cache, generic panel
  framework, or mutation tracker. The cost is concentrated in lossless static
  decoding, typed wire/shared/host contracts, lifecycle integration, and the UI.
- **Exhaustive app types widen with a new window:** the Journal exclusion in
  `UiShowcase`'s simple-surface union resolves the dry-run's two Svelte errors.
  No casts or broad settings migration were added. The old-placement merge test
  exercises the actual startup settings path and preserves other windows.
- **Unit evidence is narrower than end-to-end evidence:** the Rust-produced
  MessagePack payload is checked against the same fixture parsed by TypeScript;
  the browser probe exercises production window composition and host dispatch.
  These checks do not establish actual live ACE acquisition or relogin behavior.
  The reproduced missing account prerequisite is recorded below.

## Map extension implementation decisions and evidence

- The runtime archive census decoded all 322 definitions. There are 699 outdoor
  destinations; none has a zero XYZ origin, nonfinite XYZ component, or an origin
  outside its declared terrain cell. Catalog assembly additionally passed finite
  checks for every destination's origin and orientation. The temporary census
  binary was removed after execution.
- Outdoor variants carry the existing source `WorldPosition` through serde; the
  native field is boxed to keep the resolved/unresolved row union compact. The
  serialized object shape stays unchanged by indirection. The shared host/frontend
  fixture checks both contact and area origins and a nonidentity area rotation.
- The session owner supplies one unfiltered aged read and fact-only notifications.
  Journal queries/dialog changes do not prepare the map. Map nodes are retained
  across timer refreshes; authoritative facts/context changes rebuild their cold
  presentation. Image loading hides placements without discarding prepared facts.
- The existing map tooltip is bounded and scrollable for long coincident lists.
  Moving into it retains hover; unchanged text is not reassigned on timer ticks.
  This keeps all entries accessible without introducing another popup owner.
- The contracts browser probe now covers the production World panel before the
  Journal is opened; it runs under the existing `--client-contracts` flag. The
  existing `--client-world-map` probe also passes with settlements, real pointer
  pan/zoom, home placement, housing search, and retained image behavior.
- The live probe was rerun on 2026-10-11 and exits 1 with
  `HOLTBURGER_PROBE_ACCOUNT must be set; credentials are never accepted as arguments.`
  Live gameplay remains unverified; the synthetic evidence is recorded explicitly.

Final map-extension verification on 2026-10-11:

| Check | Evidence |
| --- | --- |
| Affected Rust library suites | Host 369, content 98, world 963 tests pass (1,430 total); includes finite-source validation, original cell/origin/rotation preservation, and Rust-produced host fixture |
| `cargo clippy -p holtburger-content -p holtburger-world -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings` | Pass; existing dependency-level future incompatibility notice for `binrw 0.15.1` remains |
| `cargo fmt --all -- --check` and `git diff --check` | Pass |
| `npm run check` | Pass: Svelte zero errors/warnings and app/node/test/Electron TypeScript checks |
| Focused `npm run test:ts` | 8 files, 95 tests pass: map projection, contracts owner, spell search, enchantments, lifecycle, World map, settlements, pointer gestures |
| `npm run lint:ts`, `npm run lint:dead`, `npm run format:check` | Pass |
| `npm run harness:browser -- --client-contracts` | Pass: 36-row Journal plus production map probe; source offsets, role/overlap tooltips, grouping, zoom/resize, hidden/off cadence, retained toggle, recovery, portals, completion retaining contact, authoritative deletion, timer expiry without node rebuild, scrollable crowded tooltip, character reset, native keyboard toggle/disclosure |
| `npm run harness:browser -- --client-world-map` | Pass: existing pan/zoom, settlement/cursor hover, command gestures, home/housing overlays/search, character reset, tabs/reopen, progressive loading and retained image cache |
| `node scripts/live-client-probe.mjs` | Exit 1: missing `HOLTBURGER_PROBE_ACCOUNT`; live gameplay remains unverified |

The native keyboard probe exposed a missing World-panel input scope. The panel
now uses the existing native-controls scope, and Enter activates the toggle.
Completion tests additionally preserve a sole End contact label and independently
check indoor/outdoor eligibility for each role. A shared-world table test verifies
only-start and only-end definitions across available, active, counter, and stage-3
states, plus the ordinary stage-3 starting-contact selection. The projection and overlay total
258 production lines; integration stays within the planned approximate 350–550
line extension. The review retained one authoritative registry, one browser
receipt anchor, and one active map display cadence; no generic overlay framework,
clustering policy, or temporary diagnostic was added. Browser checks made no
screenshots or visual-acceptance claim. No files were staged or committed.

## Base Journal implementation decisions and verification

- Removed the positional `WorldBootstrap::new` constructor when the new catalog
  would have made it an eight-argument API. Both production assembly paths and
  diagnostic callers now construct the existing typed bootstrap record directly.
- Replaced touched asset-dependent core/world test fixtures with synthetic
  reference data. The real-content investigation used a temporary diagnostic
  binary, then removed it: production `ContentRepository` reads matched all 322
  raw DAT definitions against the local runtime archive, including parsed formats.
- Character selection is validated before world-entry reset/publication. Invalid
  entry cannot create an active empty journal. Existing character admission and
  event ordering admit early trackers and reject delivery after retirement.
- The frontend read model groups known rows/total in one nullable journal value.
  Unavailable facts cannot masquerade as a known empty list. Character identity
  keys the retained list DOM so a character change retires scrolling even when
  contract IDs overlap. Panel hiding only stops display cadence and confirmation.
- Extracted the existing duration formatter into `src/app/duration-format.ts` and
  cut over inspection and journal consumers. Journal coordinate text follows its
  proven retail cell formula rather than the map's different presentation rule.
- Ordinary retail status/contact/location semantics are cited in code. No new
  compatibility marker was warranted: the survey did not establish a deliberate
  defect reproduction or correction requiring `RETAIL QUIRK`/`RETAIL DIVERGENCE`.
- Final seam review covered DAT to catalog/bootstrap, protocol to world/core
  admission/publication, core snapshot/event to host MessagePack/frontend schema,
  local confirmation to core dispatch, and recovery/retirement to retained DOM.
  Deliberately accepted: normal IPC transit delay and unresolved content rows.
  Unverified: live gameplay sequences and user visual acceptance.

Checks executed from the repository root or app directory as appropriate:

| Check | Evidence |
| --- | --- |
| Affected Rust library suites | Host 369, content 97, core 630, DAT 129, protocol 295, world 961 tests pass; world/core suites rerun after their final changes |
| `cargo clippy` on DAT/content/protocol/world/core/CLI/debug-harness/3D-host, `--all-targets -- -D warnings` | Pass; Cargo additionally reports the existing dependency-level future incompatibility notice for `binrw 0.15.1` |
| `cargo fmt --all -- --check` and `git diff --check` | Pass |
| `npm run check` | Pass: Svelte zero errors/warnings, app/node/test/Electron TypeScript checks |
| `npm run test:ts` | Full suite passed: 352 files, 2,935 tests at that checkpoint; final contracts/startup/lifecycle checks passed: 3 files, 53 tests after subsequent focused changes |
| `npm run lint:ts`, `npm run lint:dead`, `npm run format:check` | Pass |
| `npm run harness:browser -- --client-contracts` | Pass with 36 rows: retained window/scroll, hidden polling stop, server deletion, timer expiry/filter, snapshot recovery, character reset, and keyboard disclosure |
| `node scripts/live-client-probe.mjs` | Exit 1: `HOLTBURGER_PROBE_ACCOUNT must be set; credentials are never accepted as arguments.` No live acquisition/update/removal/relogin claim |

The browser check uses CDP interactions without screenshots or visual acceptance.
Its page console contains only Vite connection debug messages; Chrome itself
prints ambient GCM/deprecated-endpoint and shutdown diagnostics. No temporary
content diagnostic remains in source. No files were staged or committed.

## Definition of done and remaining decisions

The Journal opens a usable contracts list from real runtime content and server
trackers; icons and expandable rows match the accepted UX; lifecycle and timers
remain correct; removal follows server state without pending machinery; checks
and nonvisual runtime verification pass; the user can perform visual acceptance.
The base slice and map extension have completed their automated checks.

The map extension is done when its Contracts toggle controls only outdoor
selected-contact and contextual quest-area icons; hover tooltips distinguish
roles and retain all grouped/overlapping facts; positions preserve authored
offsets; Journal filtering cannot affect the map; accepted updates, recovery,
deletion, and retirement remain correct; hidden work stops; and the affected
automated/browser checks pass. User visual acceptance remains a handoff.

No major architectural blocker remains in the implemented base slice. Timing delivery,
archive profile support, bootstrap wiring, missing-content handling, version
preservation, and contact/coordinate rules are implemented and checked. The
bounded integration/type gaps found by the dry-run were closed.

Handoff remains: user visual acceptance of compact rows/icons/details and a live
ACE acquisition/update/removal/relogin sequence once the probe account is
configured. The plan explicitly allows reporting unavailable live prerequisites
with retained synthetic evidence; that concession was used, not silently treated
as live validation.

The accepted map UX has no remaining product decision: selected outdoor contact,
area only In progress, distinct contact/area icons, combined quest icon at shared
points, hover-only information, and default-off Contracts toggle. Source-position
validation/census and production map integration are complete, with the evidence
recorded above. Escalate evidence-backed content or
architectural gaps; do not expand this slice to clustering or navigation by default.
