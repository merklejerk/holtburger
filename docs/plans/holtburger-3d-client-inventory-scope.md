# Client inventory view — phased implementation plan

Status: implemented and verified with deterministic Rust/TypeScript fixtures and the
canonical browser harness. The implementation replaces the WIP scope and competing
contract proposals; historical investigation evidence is retained below.
The existing filename is retained so conversation links remain useful.

Live follow-up: normal character entry initially left the semantic mirror pending
because it retired the character-selection baseline without receiving another
application snapshot. A manual current-state request immediately populated Main
Pack and Sack. Core now publishes the existing application snapshot after completed
initial entry (including the synthetic StartGame path); teleport completion keeps
its continuous delta feed. The activation test covers both causes, and the frontend
regression covers entry, subsequent item deltas, and a second character on the same
transport. Live Electron verification confirmed automatic population after login: 24 item
cells, Main Pack and Sack sections, and successful item selection without browser
errors. Initial-entry portal-space also retires the old baseline, including when
the frontend attaches after the character-selection lifecycle announcement.
Exit and character-selection events retain the cache; only initial character
entry, missed-event recovery, and session disposal invalidate it.

## Final diagnostic and quality follow-up

Selected diagnostics now read one client-owned GUID join of shared entity facts and
optional scene presentation. Shared names, item type, object flags, WCID, and the
optional catalog weenie type work for inventory-only identities. The catalog source
is labeled explicitly; missing facts remain unavailable rather than borrowing scene
names. Item types and object flags use named flag lists with unknown bits retained.

The final accumulated-feature review traced protocol categories into world storage,
world facts into core snapshots/deltas, host recovery into the frontend mirror, and
that mirror into inventory, selection, health, and diagnostics. It also inspected the
TUI WorldContext adapter, private-property retention, floating-panel lifetime, cell
and strip reuse, and theme hooks. The obsolete ownership caches and scene-only name
lookup are removed. Review cleanup removed a duplicate inventory-removal mutation
from the player handler and pack-specific wording from the shared item strip.

Accepted limits remain clipped-name icon placeholders, direct carried-container UI,
frontend-only sorting, optional catalog metadata, and selection loss during genuinely
unowned/unplaced drop transitions. This review does not claim a broader audit of
unchanged movement, rendering, or all TUI behavior.

## Goal and boundaries

Add a live, selectable client inventory panel showing Main Pack and carried storage,
backed by recoverable world-derived entity facts shared with selection and health.

In scope: preserve server storage declarations; one authoritative world ownership
interpretation; narrow semantic snapshot/deltas; browser mirror; selection and
health integration; one mutually exclusive Inventory/Debug window and placement;
responsive square cells with temporary clipped names.

Out of scope: icons/assets, drag/drop, stack manipulation, new use/equip workflows,
external loot UI, equipment grid, filter controls, burden summaries,
generic subscriptions, broad TUI redesign, and a renderer/Explorer event cutover.

### Implemented first-cut behavior

The contents pane has a fixed one-row footer with the server-maintained pyreal
total and a sort-mode button cycling native slot order, alphabetical names, and
public item type (then name). Sorting is frontend-only, within existing section
subgroups; the pack strip retains server slot order. Unknown descriptions sort
last outside native mode. The server's `CoinValue` includes nested packs:
ACE `Player_Commerce.cs::UpdateCoinValue` uses recursive
`Container.cs::GetInventoryItemsOfTypeWeenieType`. Both coin balance and public
item type travel in known entity facts through the existing snapshot/delta feed.

Live currency follow-up: `PlayerDescription` delivered `CoinValue`, but the later
public character description replaced the entity properties and discarded it. World
now retains private-feed property keys across public recreation while storing values
only on the entity. Live verification changed the footer from `Pyreals: …` to
`Pyreals: 8`; regressions cover the login value, a subsequent zero update, public-only
replacement, and a fresh login baseline.


Follow-up: the inventory now has an independently scrolling right-hand pack strip.
The strip hides native scrollbars and overlays directional arrows only where more
cells exist. Up aligns the nearest preceding cell’s top edge; Down aligns the
nearest following cell’s bottom edge. Wheel scrolling remains available.
It shows Main Pack plus the server's total pack-slot capacity, placing containers
and foci at their announced indices and leaving unused slots empty. Clicking a
pack selects it and scrolls its contents section to the top inset, clamped to the
contents pane’s available scroll range. Foci have no section and only select. Ordinary-slot
storage remains in the contents/sections rather than occupying a pack slot. Missing
capacity does not hide announced occupants. Both contents grids and the strip use
`src/app/ItemGridCell.svelte`, a shared presentation component whose caller supplies
its label, identity, selection, disabled state, and action. World entity facts now
carry `packCapacity` alongside `itemCapacity`; existing snapshots/deltas deliver both.


These defaults were carried from scoping into implementation. They define this
slice's behavior, rather than promising future inventory actions or icon presentation.

- Main Pack and direct carried storage get sections, including known-empty packs.
  Headers show `(count / capacity)` for ordinary item slots, excluding separate
  container/foci slots. Capacity comes from server facts; unknown capacity shows `?`.
  Grids are compact occupied cells in server order; no empty-capacity slots.
- Owned storage headers select that item. Main Pack selects the local player. Ordinary-slot storage also appears in its parent's ordinary grid:
  this preserves its slot semantics while providing a contents section.
- Pack-slot storage appears through its section header. Non-storage pack-slot
  entries (foci) get a small subgroup inside their parent section; no fake storage
  section. Pending pack entries remain in that subgroup until storage is known.
- Pending descriptions show a neutral loading cell and cannot acquire selection.
  Known items with pending slots remain selectable in a trailing unslotted group.
  Full names are accessible; names do not control cell size.
- Owned selections survive container moves, equipment changes, and panel closure.
  Actual semantic removal clears; an unowned/unplaced retained item clears in this
  first cut. Do not promise continuity through separate drop/unequip messages.
- Health eligibility is the public creature semantic, including friendly creatures.
  This is broader than retail's player/pet/attackable query UI. Pending descriptions
  have no eligibility answer. Inventory selection introduces no new actions:
  hide/disable the existing Interact affordance for owned selections in this slice.
- Preserve received nesting in world. The panel targets direct carried containers;
  unexpected deeper storage may be shown as an owned item without recursive UI.

## Ground truth and design rules

| Source | What it establishes |
| --- | --- |
| ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventItemServerSaysContainId.cs | Containment supplies GUID, parent, placement, and category. |
| ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs:922,1358,1437 | Normal pack nesting restriction; container-move and multi-message drop flow. |
| ACE PlayerDescription/ViewContents writers and protocol player/inventory events | Ordered rosters; membership announcement can precede hydration. |
| crates/holtburger-world/src/state/scene_placement.rs | Placement failure can name an ancestor, not deletion of the target. |
| crates/holtburger-core/src/client/dynamic_entity_view.rs:52 | Renderer projection needs placement, setup/model, and bodies; unsuitable for pending inventory. |
| apps/holtburger-cli/src/pages/game/domains/entity.rs | Frontend entity-event mirror precedent, including properties and despawn. |
| apps/holtburger-cli/src/bin/tui.rs:894 | Snapshot request after lag; not proof of complete TUI inventory recovery. |
| apps/holtburger-3d/host/src/client_host.rs:216 | Existing ordered forwarding and lag suppression until application snapshot. |
| apps/holtburger-3d/src/client/client-lifecycle-session.ts:602 | Current replacement handling and the demonstrated validation-before-commit gap. |

Use world as the authority, core as publisher, host as adapter, and browser as a
read-model consumer. Inventory, selected name, health eligibility, and selection
validity share one semantic mirror. Keep the renderer's specialized dynamic mirror;
its removal means stop rendering, not delete the identity.

Prefer affected-record replacement over field patch protocols. Do not add selected
GUID queries/watches, a universal event envelope, redundant epochs/revisions, or a
parallel inventory identity store. World-derived ownership is sent explicitly;
JS may group children for layout but does not infer ownership by ancestry.

The local census (9 characters, 1–46 owned items, mean 20.6) supports linear owned
storage scans. It does not justify full retained-world scans on every movement tick
or establish production timing. Genuine missing data and server intermediate states
are allowed; silent loss of announced inventory is not.

## Concrete contracts for implementation

### World storage authority and admission

Add a focused storage module under `crates/holtburger-world/src/state/`, with private
accepted locations and per-container roster coverage. Use existing GUID/EquipMask
primitives. Typed Item/Container/Foci belongs with common inventory primitives;
protocol owns decoding and rejects unknown categories.

Location methods establish a player baseline, replace direct contents, place an
item, announce a Container IID, equip, withdraw, and reconcile hydration. Ordered
slot indices belong to separate item/pack domains. A known parent can have a pending
slot; never manufacture index zero. Replace parent membership in one mutation;
omissions only withdraw relationships still belonging to that parent.

Admission precedence for this plan:

1. Existing lifecycle/instance-delete rules gate entity admission. Do not clone
   tombstone logic into storage or assume an ordering between ACE message queues.
2. PlayerDescription and ViewContents establish rosters, including missing GUIDs.
   Explicit containment, equipment, and accepted Container/Wielder updates change
   those relationships even before hydration.
3. A repeated same-parent IID preserves known placement. A changed parent leaves
   placement pending until ordered evidence arrives. Hydration supplies description
   and capabilities; it cannot replay an older parent over accepted declarations.
4. A create-only object is retained entity evidence, not admission into the player's
   owned roster. It becomes owned through an explicit accepted storage statement.
   This is a deliberate proposed tightening of current behavior; cover it with the
   existing ACE create-plus-containment flow and late-create regression fixtures.
5. Withdrawal changes reachability. Do not destroy a dropped pack's internal
   contents while it remains retained. Actual lifecycle deletion and a fresh player
   baseline retire obsolete records. Later owned storage declarations represent a
   pending identity if its previous description is still deleted. Eviction of that
   description does not erase the newer declarations; only admitted hydration
   supplies the new description. No wire generation or transaction is added.

Cut over `PlayerState.inventory/equipment` writers to this owner, including roster
hydration in `player/mutations.rs`. Consumers get read queries, not mutable aliases.
The direct callers found are `context.rs`, `interaction.rs`, `handlers/player.rs`,
`state/mutations.rs`, and world tests. Sweep additional bare PlayerState callers
while implementing; do not use this initial search as proof no others exist.
Equipment mask semantics remain shared, but unrelated equipment controllers and
physics attachment machinery do not get redesigned.

### Semantic record, baseline, and delta

Proposed public names: world `ClientEntityFacts`/query, core
`ClientEntitySnapshot`, `ClientEntityDelta`, `ClientViewEvent::EntityFactsChanged`.
Keep types near their semantic owner; names may adjust to repository conventions.
Host serializes the same facts. The following TS sketch documents the wire shape;
actual schemas and equivalent Rust types must enforce the stated invariants.

```ts
/** Typed placement retained by world from storage messages. */
type StorageSlot =
  | { readonly kind: "pending" }
  | { readonly kind: "item"; readonly index: number }
  | { readonly kind: "pack"; readonly index: number;
      readonly entryKind: "container" | "foci" };

/** Received storage location; separate from physical attachment/scene placement. */
type StorageLocation =
  | { readonly kind: "none" }
  | { readonly kind: "contained"; readonly parentGuid: number;
      readonly slot: StorageSlot }
  | { readonly kind: "equipped"; readonly wearerGuid: number };

/** No synthetic name, eligibility, or storage capability before hydration. */
type EntityDescription =
  | { readonly kind: "pending" }
  | { readonly kind: "known"; readonly name: string;
      readonly healthQuery: "eligible" | "ineligible" };

/** World establishes storage from capability or received roster, not slot kind. */
type StorageCoverage =
  | { readonly kind: "not-established" }
  | { readonly kind: "container";
      readonly roster: "awaiting" | "announced" };

/** One identity's facts for inventory, selected display, and selection maintenance. */
interface ClientEntityFacts {
  readonly guid: number; // Key shared with selection and rendering.
  readonly description: EntityDescription; // Cell/header/HUD and health consumer.
  readonly location: StorageLocation; // Parent grouping and equipment exclusion.
  readonly ownedByPlayer: boolean; // World-derived, never inferred by JS.
  readonly scenePlacement: "available" | "unavailable"; // Not mesh residency.
  readonly storage: StorageCoverage; // Empty/pending section visibility.
}

/** Full semantic baseline; local player identity remains in current-state. */
interface ClientEntitySnapshot {
  readonly entities: readonly ClientEntityFacts[];
}

/** Changes to this one read model, applied before notifying its consumers. */
interface ClientEntityDelta {
  readonly upserts: readonly ClientEntityFacts[];
  readonly removed: readonly number[];
}
```

The domain is world `iter_visible_entities()` (retained current entities not subject
to accepted deletion), plus player-reachable announced storage identities awaiting
hydration. Include the established local-player root even if description is pending.
Exclude descriptions from deleted incarnations and debug-only lookup results;
later owned announcements can represent the same GUID with a pending description. Visible here does
not mean rendered or nearby: retained non-owned previews can be present but are
filtered out of inventory. Unknown physical ancestors alone do not fabricate items.

Ownership and scene availability intentionally overlap; equipped objects can have
both. Pending owned children can exist without entity descriptions. A non-owned
missing record is absence; an existing unplaced record is retained. These cases
remove the need for a separate availability enum/store. Storage `not-established`
is not a claim that an unhydrated item can never contain objects.

Keep entity generations in world lifecycle and the existing dynamic projection.
The semantic wire is GUID-keyed accepted state on one ordered stream; do not add a
second generation mechanism without a demonstrated out-of-order producer. Replacing
an accepted incarnation replaces its record; delayed protocol deletes are filtered
by world before they become semantic deltas. Frontend selection retains its existing
GUID identity policy.

An empty delta is not published. Upsert/removal GUIDs are unique and disjoint.
Snapshots have unique identities. Parent/owned relationships must be consistent
with the complete post-delta level, including the player root and pending records.
Require represented parents for the owned closure; a non-owned retained entity may
reference an external parent outside this domain. Do not fabricate it or reject
valid partial external knowledge. Validate by preparing the next level, then commit; do not reject a batch just because
one parent appears later in its array. World rejects contradictory storage graphs.

Core retains the last published records to emit changed affected records. Reuse
world event GUIDs plus a focused storage invalidation signal for declaration-only
changes. On a storage mutation, a linear owned-closure/affected-parent scan can find
subtree ownership and shifted slots. Scene placement events cover affected attachment
children; tick deletion and baseline changes must participate. Do not scan all
entities for ordinary motion with unchanged semantic facts.

Add `entities: ClientEntitySnapshot` to the existing application snapshot/current
state and a semantic delta event to the existing client channel. Retain full dynamic
snapshots and motion deltas for rendering. There is no new envelope coupling both.
Snapshot reads and delta generation use the same world projection function; core
must flush pending semantic changes before publishing a baseline on the same stream.

### Browser and recovery

Add a session-owned imperative `ClientEntityMirror` with prepared snapshot/delta
application, GUID lookup, and a locally maintained change token for display sampling.
The token is not a wire sequence or owner identity. It advances for accepted semantic
changes; a dedicated inventory revision is unnecessary initially because this feed
excludes routine motion/health fractions. Rebuild panel grouping by simple reads.

Extend existing listener-before-request setup. The host currently hides its lag
state from browser: on first detected lag, emit a small `client-state-resyncing`
notification through the host sink before requesting the existing replacement.
Suppress all live deltas until ApplicationSnapshot as today. Browser marks semantic
reads pending, gates dynamic deltas through the existing await-snapshot mechanism,
and pauses source-based selection invalidation/new inventory acquisition. Cached
panel display may remain, with a recovery indication. No second recovery request.

Prepare shell, semantic, and dynamic replacement validation before assigning any
state; publish notifications after installation. A rejected replacement leaves the
prior accepted level intact and surfaces the error. Terminal lifecycle clears state.
No timeout guesses deletion and no panel lifecycle owns reception.

## Phases and acceptance criteria

All phase items below have been checked against the implementation and evidence.
No production code was staged or committed.

Final verification, 2026-09-11:

| Check | Result / evidence |
| --- | --- |
| `cargo fmt --all -- --check` | Passed. |
| `cargo check --workspace` | Passed, including CLI, scripting, and debug harness consumers. |
| `cargo test -p holtburger-protocol` | 270 library tests passed; doc tests passed. |
| `cargo test -p holtburger-world --features test-support` | 766 library tests passed; doc tests passed. |
| `cargo test -p holtburger-core -p holtburger-3d-host` | 405 core and 284 host library tests passed; remaining test/doc targets passed. |
| Affected-package `cargo clippy … --all-targets -- -D warnings` command below | Passed. |
| `npm run test:ts` | 2,198 tests across 277 files passed. |
| `npm run check` | Svelte, application/test/node TypeScript, and Electron checks passed. |
| `npm run lint:ts`, `npm run lint:dead` | ESLint and Knip passed. |
| `npm run build`, `npm run build:electron:main` | Passed. Vite emits a large-chunk advisory; no performance claim is inferred. |
| `npm run harness:browser -- --client-hud --brief --screenshot /tmp/holtburger-inventory-final.png` | Passed; no browser errors/exceptions. See `clientInventory` evidence in `/tmp/holtburger-inventory-final-browser.log`. |
| `git diff --check` and staged-diff inspection | Clean; no staged changes. |

The inventory browser probe uses the actual session decoder, semantic mirror,
selection/health controllers, window, and panel. It covers shared placement and
exclusivity; live moves/renames; description loading; recovery gating/replacement;
deletion; close/reopen; pointer/wheel/keyboard isolation; sampling teardown; and
producer bursts without consumer reconstruction. At 600px and 280px window widths,
the fixture has eight/four occupied columns and all measured cells are square
within one CSS pixel. The inventory screenshot at
`/tmp/holtburger-inventory-final.png.inventory.png` was visually inspected.

Verification is synthetic: no interactive TUI was run and no live ACE session is
claimed for that original verification run. Icons, item actions, equipment grids,
external containers, and recursive presentation remain the declared non-goals.

### Phase 1 — retain ordered storage and establish one world owner

Files: common inventory primitives; protocol `messages/player/events.rs` and
`messages/inventory/events.rs`; world new `state/storage.rs`, state module/types,
`player/{types,mutations}.rs`, `handlers/{player,inventory}.rs`, `state/mutations.rs`,
`state/liveness.rs`, `context.rs`, and `interaction.rs`.

- [x] Replace raw category fields with typed wire values and fix the misleading
  PlayerDescription tuple comment. Preserve encoding behavior for valid values.
- [x] Implement private accepted locations/coverage and the admission rules above.
- [x] Route roster, containment, IID, equipment, deletion, and hydration paths through
  that owner; expose accepted-parent, equipment, ownership, and readiness queries.
  Direct-child grouping consumes accepted parent facts; no unused standalone
  child-query abstraction was added.
- [x] Remove competing PlayerState ownership writers and migrate actual readers.
  Keep TUI presentation unchanged except compile-required shared API adaptation.
- [x] Expose narrow entity-fact projection and focused storage invalidation with
  coverage for missing GUIDs. Keep scene placement errors explicit.
- [x] Add fixture-based protocol/world tests for ordered domains, pending children,
  empty roster replacement, late create after move/removal, repeated IID preserving
  slot, equipment ownership, dropped-container reachability, and instance replacement.

Acceptance: relevant protocol/world tests pass; readiness includes declared missing
children; unknown descriptions do not erase slots; direct ownership callers compile
against one owner; workspace compilation catches CLI/core API fallout. No test needs
untracked runtime assets or the interactive TUI.

Course correction: accepted deletion retires storage at the world lifecycle
boundary, including queued deletes when their matching incarnation arrives.
A pack's old child roster cannot reappear with its next incarnation. Conversely,
later declarations survive deferred eviction of the old description and project as
pending until hydration. World and core regression fixtures cover both directions.
Core therefore needs no protocol-specific deletion invalidation.

### Phase 2 — publish reconstructible semantic snapshots and deltas

Files: core new `client/entity_facts.rs`, `client/{types,mod,messages,runtime}.rs`,
exports and snapshot constructors/tests; world invalidation entry points as needed.

- [x] Implement the record/snapshot/delta contracts and shared projection function.
- [x] Publish at completed message/follow-up and tick mutation boundaries; cover
  declaration-only changes, ancestor/subtree effects, semantic removal before final
  eviction, hydration, and player baseline replacement.
- [x] Add semantic baseline to `application_snapshot`; flush prior updates before
  snapshot publication. Avoid publishing unchanged records on routine movement.
- [x] Adapt existing ClientApplicationSnapshot constructors/fixtures and exhaustive
  matches in host/TUI without duplicating authoritative event paths.
- [x] Prove baseline + deltas equals a fresh baseline after each operation in a
  fixture sequence, including pack moves, empty rosters, pending hydration, delete,
  equipment, and login/reset. Use world-derived expected state, not a second copy
  of the same delta algorithm.

Acceptance: core tests and affected consumers compile; reconstruction equality holds;
ordinary motion emits no semantic changes unless placement availability changes;
no whole-world projection runs on every motion tick.

### Steering checkpoint — verify the shared cutover stayed bounded

- [x] Review phase 1–2 diff for duplicate ownership, fields without consumers, and
  accidental whole-Entity serialization. Remove them before frontend work.
- [x] Recheck publication sites against fixture equality coverage and audit direct
  world writes outside network handlers. Fold findings into remaining phases.
- [x] Confirm actual retained-set/projection cost supports simple scans. Measure only
  if the implementation reveals a concern; do not prebuild indexes.
- [x] Rehearse phase 3–5 integration against the now-concrete types. Escalate actual
  architecture/scope changes; routine adjustments do not require a permission pause.

### Phase 3 — wire the semantic mirror and existing recovery path

Files: host `client_projection.rs`, `client_host.rs`, `protocol.rs`; Electron
`host-protocol.ts` and associated routing; `src/lib/host/host-transport.ts` event
names/payload mapping and `electron-host-transport.ts`; frontend `client-host-contract.ts`,
`client-lifecycle-session.ts`, new `client-entity-mirror.ts`; existing dynamic mirror
prepare/commit support only where required by replacement validation.

- [x] Serialize/decode semantic baseline/deltas and resync-start notification through
  the existing channel. Trace routing end to end; add no alternate transport.
- [x] Implement prepared mirror replacement/batch application and synchronous commit.
  Give consumers current/pending reads and stable GUID lookup at one accepted level.
- [x] Add all listeners before initial request. Notify browser on host lag, suppress
  deltas, then install the complete replacement before observer callbacks.
- [x] Move potentially failing dynamic/shell validation before current-state writes.
  Avoid changing Explorer live delivery semantics while sharing pure validation.
- [x] Test parent/child batch order, malformed duplicate/disjoint keys, startup,
  lag with dropped deltas, rejected replacement, shutdown, and GUID reuse in a new
  session. Existing host lag test must assert one request and resync notification.

Acceptance: Rust host tests, TS contracts/session/mirror tests, and Electron transport
checks pass. Invalid input exposes no partial level. Cached recovery state cannot
admit inventory selection. Applying recovery equals a clean initial snapshot.

### Phase 4 — use semantic facts for selection and health

Files: `client-entity-selection.ts`, `client-entity-interactions.ts`, `ClientApp.svelte`,
`ClientSelectedEntityHud.svelte`, relevant UI contracts and tests.

- [x] Add checked inventory acquisition, retaining GUID and pending viewport-query
  cancellation. Migrate selected-name/eligibility reads to the semantic mirror.
- [x] Replace direct dynamic removal, dynamic snapshot absence, and maintenance
  absence as selected-identity verdicts. Preserve renderer-owned hover cleanup.
- [x] Reconcile owned/scene/unplaced/removed policy after semantic commit and lifecycle
  transitions; distance evidence must not override ownership.
- [x] Reconcile health subscription on selection and same-GUID facts; distinguish
  pending/ineligible/awaiting-response/known display without fake health meters.
- [x] Hide/disable inventory Interact under the stated default; keep existing world
  action admission and viewport/minimap acquisition.
- [x] Test pickup with both render/semantic delivery orders, container reordering,
  equipment, removal, genuine unplaced gap, late viewport replies, recovery, and
  eligible -> item -> item -> creature health command counts.

Acceptance: owned pickup selection survives either presentation order; semantic
removal clears even with no rendered object; no inventory click queries health for
an ineligible item; existing scene acquisition and distance tests remain meaningful.

### Phase 5 — shared floating window and inventory sections

Files: `ClientWorldView.svelte`, `ClientShortcutDock.svelte`, `client-hud-layout.ts`,
new `ClientInventoryPanel.svelte` and a small colocated grouping helper if needed;
reuse `ClientHudWindow.svelte` and existing selected HUD.

- [x] Replace debug-only open state with one panel discriminant; generalize the shared
  placement and all diagnostics-specific layout vocabulary in touched paths.
- [x] Wire Inventory/Debug typed toggles and close behavior, preserving capability
  gating and input isolation from the viewport.
- [x] Render the working defaults: Main Pack/direct storage, header selection, foci
  subgroup, explicit loading, occupied server-order cells, and shared selected GUID.
- [x] Use CSS grid/aspect-ratio for squares; clipped names and accessible full names.
  Sample immediately on mount and at bounded cadence; stop timer on unmount.
- [x] Test meaningful grouping cases (foci, ordinary-slot storage, empty/pending pack,
  equipped exclusion) rather than mirroring markup. Reuse existing layout resolver
  tests, which enumerate every configured surface, and extend browser coverage for
  shared-window switching and resizing.

Acceptance: Inventory and Debug cannot coexist and share position/size; resizing
keeps cells square; contents/name changes appear without reopening; close/reopen
reads current facts; selection highlight follows GUID; panel input does not move
or select through the viewport.

### Phase 6 — integrated browser verification and cleanup

Files: existing browser harness entry/probe infrastructure under
`src/harness/browser/` and `scripts/browser-harness.mjs` as needed, affected tests,
and touched source/documentation vocabulary.

- [x] Add a deterministic client fixture through the actual session/transport/UI
  composition. Feed snapshot/deltas for pickup, pack moves, rename, deletion, and
  lag/recovery while observing selected HUD, cells, and outgoing commands.
- [x] Run canonical browser harness to capture initial panel, switched panel, narrow
  and wide layouts, loading/recovery, and selected item. Verify square geometry,
  no viewport input leakage, clean browser errors, and one live session/timer owner.
- [x] Remove replaced ownership mutators, stale selector paths, unused types/fixtures,
  and diagnostics-only placement vocabulary. No compatibility feed or test-only
  authority remains. Keep evidence from temporary probes out of production tests.
- [x] Run final checks below, fixing touched diagnostics rather than suppressing them.
  A real noninteractive client probe may supplement fixture evidence when local
  ACE/assets are available; never run the interactive TUI for verification.
- [x] Update this plan with completed work, actual commands/results, limitations,
  and any remaining decisions. Do not claim live verification from synthetic tests.

Acceptance: integrated scenarios pass and final checks are clean; no production test
requires untracked assets; no subscriptions or availability query framework remains;
all Definition of Done items are backed by actual results.

## Verification commands and definition of done

Run focused suites alongside each phase; do not repeat broad suites without a new
change/failure. Rust commands run from repo root; npm commands from apps/holtburger-3d.
Final affected-package checks:

- `cargo fmt --all -- --check`
- `cargo check --workspace` (includes API fallout in CLI/harness/tools)
- `cargo test -p holtburger-protocol`
- `cargo test -p holtburger-world --features test-support`
- `cargo test -p holtburger-core -p holtburger-3d-host`
- `cargo clippy -p holtburger-common -p holtburger-protocol -p holtburger-world -p holtburger-core -p holtburger-3d-host -p holtburger-cli --all-targets -- -D warnings`
- `npm run test:ts`, `npm run check`, `npm run lint:ts`, `npm run lint:dead`
- `npm run build` and `npm run build:electron:main`
- `npm run harness:browser -- --client-hud --brief --screenshot /tmp/holtburger-inventory-final.png`

- [x] Announcements survive missing descriptions; storage/location has one owner.
- [x] Snapshot plus deltas reconstructs the fresh semantic baseline.
- [x] Recovery suspends stale admission and commits a validated complete replacement.
- [x] Selection/health consume semantic facts independently of rendering order.
- [x] Mutually exclusive panels share placement; square cells update while mounted.
- [x] Placeholder text has no icon-specific infrastructure or name-driven sizing.
- [x] Viewport/minimap acquisition and existing renderer behavior still work.
- [x] Relevant tests, build/type/lint checks, and browser evidence are recorded.
- [x] No production code has been staged/committed without an explicit request.

## Final ownership and cleanup review

- World owns received containment/equipment, roster coverage, recursive ownership,
  and description/scene facts. The old PlayerState inventory/equipment writers are
  removed; shared parent/equipment readers use the accepted storage owner.
- Core publishes affected record replacements at completed message and tick
  boundaries, flushing before recovery snapshots. Equality fixtures cover missing
  descriptions, moves, empty rosters, equipment, removal, player reset, and deferred
  eviction/readmission. Movement alone does not dirty semantic records.
- Host adapts the existing ordered stream. Its lag test verifies one resync
  notification/request and suppression until replacement.
- The session owns immutable decoded records and prepared mirror commits. UI grouping
  derives layout only; it never reconstructs ownership. Selection and health read
  those facts; renderer disappearance only clears hover.
- ClientWorldView owns shared placement; the floating window owns gestures and
  keyboard containment. Inventory's mounted timer samples coherent records and is
  removed with the panel.
  Existing viewport/minimap acquisition and renderer delivery retain their owners.
- Searches found no surviving PlayerState inventory/equipment writers, old ownership
  synchronizers, or diagnostics-specific placement state. All new exported symbols
  have consumers; Knip and strict Clippy are clean.
- The main tradeoff is keeping raw entity properties for existing scene/TUI consumers
  while moving authoritative ownership to accepted declarations. The TUI remains a
  separate frontend read model; there is no new TUI parity or raw-world replication
  project in this slice.

## Risks, review choices, and course corrections

| Risk / decision | Mitigation / planned default |
| --- | --- |
| Late create revives old containment | Accepted storage statements own admission; fixtures cover actual ACE queue order and instance-delete behavior. Revisit strict create-only admission if contrary evidence appears. |
| Delta misses subtree/slot/ancestor consequences | Post-operation reconstruction equality, focused invalidation, and phase 2 steering review. |
| Scope grows into general world replication | Narrow consumed fields; specialized dynamic path unchanged; no raw property bags. |
| Recovery leaves selectable stale cache | Explicit resync-start event plus existing full replacement gate; no new request protocol. |
| Equipment API changes spread unexpectedly | Migrate actual shared callers, compile workspace, keep TUI presentation separate. |
| Unknown performance distribution | Simple owned scans; no semantic changes for normal motion; measure only a demonstrated concern. |
| Genuine multi-message drop gap | Clear-on-unplaced default; retaining through it remains a user-visible policy amendment. |

The behavior defaults at the top are implemented first-cut policies: foci/header
presentation, public-creature health eligibility, clear-on-unplaced, and disabled
owned-item Interact. Future changes to these policies or cell visuals remain
frontend concerns; no unresolved approval or implementation gate remains.
No unresolved delivery alternative or selection-service design is hidden in phase 1.

Planning refinements incorporated: host lag needs a browser resync notification;
world deletion admission, not final eviction alone, controls semantic removal;
batch validation must use the post-delta level; non-owned external parents may be
absent; transport registration includes the shared host event-name/payload map.

Review coverage: inspected world storage/placement/liveness entry points, core
snapshot/event/command boundaries, host forwarding and protocol mapping, browser
session/mirror/selection, and TUI entity/recovery consumers. This is a source-level
plan review; the proposed contracts have not been compiled and integrated browser
behavior remains phase 6 work. Record implementation corrections under each phase.

## Supporting investigation record

The following source findings and temporary probe results predate implementation.
Where earlier discussion considered inventory-specific revisions or publication
shapes, the concrete contracts above take precedence. These notes are evidence,
not additional implementation requirements.

## Evidence and existing mechanisms

Paths below are relative to the repository root. Findings describe the inspected
code, not a claim that all runtime behavior has been empirically verified.

### Floating panels and selection

- `apps/holtburger-3d/src/client/ClientHudWindow.svelte` already implements a
  draggable, resizable window with supplied content and placement.
- `apps/holtburger-3d/src/client/ClientWorldView.svelte` owns `debugOpen` and
  `hudLayout.diagnostics`; diagnostics currently mounts inside `ClientHudWindow`.
- `apps/holtburger-3d/src/client/ClientShortcutDock.svelte` includes Inventory as
  a stub; only Debug currently has an action.
- `apps/holtburger-3d/src/client/client-entity-selection.ts` owns selected GUID.
  Its `select` method invalidates pending viewport selection. However,
  `maintainSelection` uses scene residency/distance, and dynamic removals and
  replacement snapshots can invalidate selection. Those assumptions do not cover
  carried inventory.
- `apps/holtburger-3d/src/client/ClientApp.svelte` reads selected names through the
  presentation session. Inventory names need a source independent of rendering.
- `apps/holtburger-3d/src/client/client-entity-interactions.ts` currently queries
  health for every newly selected non-null GUID while in-world.

### Inventory authority and transport

- `crates/holtburger-world/src/player/types.rs` owns inventory membership.
- `crates/holtburger-world/src/state/mutations.rs` maintains recursive ownership.
  `all_player_contained_objects_exist` gates activation on hydration of the
  **currently tracked** inventory closure and its parent relationships. The
  investigation below found that uncreated children announced by `ViewContents`
  are not tracked, so this is not proof of full announced-inventory completeness.
- `crates/holtburger-world/src/context.rs` provides ownership, storage usage, and
  capacity helpers. Ownership includes equipment, so an ownership filter alone
  is broader than pack contents.
- `crates/holtburger-core/src/client/types.rs` has broad entity events, but its
  `ClientApplicationSnapshot` has no dedicated inventory projection.
- `apps/holtburger-3d/host/src/client_projection.rs` and
  `apps/holtburger-3d/src/client/client-host-contract.ts` likewise lack a dedicated
  inventory snapshot/update contract. A live, recoverable inventory view therefore
  needs work beyond adding markup.

### Container-slot classification

- `crates/holtburger-world/src/hydration.rs` maps the wire description flag
  `ObjectDescriptionFlag::REQUIRES_PACK_SLOT` to
  `PropertyBool::RequiresBackpackSlot`.
- `crates/holtburger-common/src/properties/world_object.rs` defines
  `uses_player_container_slot()` as `requires_backpack_slot() || can_hold_items()`.
- `WorldContextExt::storage_usage` in `crates/holtburger-world/src/context.rs`
  counts direct player children using that classifier separately from ordinary
  items. The existing split applies to player storage, not indiscriminately to
  every container.
- The same file's `player_slot_counts_split_main_pack_items_from_container_slots`
  test exercises this distinction.

Consequence: occupying a player container slot and being a storage container are
different facts. A flag-only item must not disappear from the UI. The frontend
should consume authoritative classification rather than reconstructing flags.
ACE's `WorldObject_Properties.cs::UseBackpackSlot` uses
`WeenieType == WeenieType.Container || RequiresPackSlot`.
`Container.cs::TryAddToInventory` separates capacity and placement by this
classification. This is not literally the same predicate as our capability-based
helper, and ACE applies it inside `Container`, whereas our usage helper gives
separate container capacity only to the player. Equivalence for supported content
is not universal: the investigation found a movable Chest template for which the
predicates disagree. More importantly, the protocol already carries the server's
classification, which world currently discards. Preserve that evidence rather than
requiring template metadata or inventing a UI predicate. See the investigation
findings for the foci examples, census, and source references.

### Health subscription eligibility

- `ACE/Source/ACE.Server/WorldObjects/Player.cs`,
  `HandleActionQueryHealth` (around line 393), resolves the requested world object
  as `Creature`. Zero or a non-creature clears the selected target. A creature
  becomes the selected target and receives a health query.
- The network action in
  `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionQueryHealth.cs`
  delegates directly to that method.

This supports creature eligibility rather than subscribing for every selected
item. Public object creation carries `ItemType`; its creature bit is already
hydrated and exposed by `WorldObjectExt::is_creature()`. The investigation below
validates that path against the template census and distinguishes this proposed
server-supported policy from retail's narrower UI query policy.

### TUI inspiration

- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`
  derives an owned-item hierarchy from container relationships, sorts siblings by
  formatted name, and includes equipped items. Its selection is index-based.
- The adjacent `render.rs` shows main-pack usage, separate pack-slot usage,
  per-container counts, burden, and item status. Existing shared storage helpers
  should supply these facts if they enter scope.
- `apps/holtburger-cli/src/utils.rs::format_item_name` adds stack count, salvage
  material, and structure/durability. This is useful future behavior evidence,
  not a requirement to reproduce rich text labels in the placeholder grid.
- Inventory actions in the TUI consult shared world eligibility helpers. Use
  those as references when actions expand; do not import terminal keyboard,
  filtering, cursor, or footer policy into the 3D app.

## Investigation findings — 2026-09-11

Evidence combines Rust/ACE/retail source inspection, read-only SQL against the local
`ace-holtburger-db` container, and existing focused Rust tests. No client was
launched and no production implementation was changed. SQL queried template facts
and anonymous shard aggregates; no character/account identities were collected.

### 1. Slot classification is transmitted, not something we need to guess

Resolved sources:

- `ACE/Source/ACE.Entity/Enum/ContainerType.cs`: `NonContainer = 0`,
  `Container = 1`, `Foci = 2`.
- `ACE/Source/ACE.Server/WorldObjects/WorldObject.cs::ContainerType` (around 453)
  uses container weenie type first, then RequiresPackSlot, then NonContainer.
- `GameEventPlayerDescription.cs:401–415` writes the main-pack roster in separate
  ordinary/pack-slot order with those categories.
- `GameEventViewContents.cs` writes each child GUID/category in placement order.
- `GameEventItemServerSaysContainId.cs` writes GUID, parent, placement, and category.
- `crates/holtburger-protocol/src/messages/player/events.rs:153–170` decodes and
  bounds-checks the category. `messages/inventory/events.rs` decodes ViewContents
  categories and containment slot/category, currently as raw `u32` values.

The loss occurs after decoding:

- `player/mutations.rs:416` keeps only GUIDs from the initial inventory pairs.
- `handlers/inventory.rs::handle_event` discards containment slot/category when
  calling `move_entity_into_container`.
- The ViewContents branch discards categories and handles only already-created
  entities. Neither authoritative roster ordering nor declarations survive.

**Scope consequence:** retain server-declared storage membership, category, and
ordering in world, separately from whether the entity description has arrived.
Use those facts for player slot semantics. No new catalog dependency is needed.
Storage capability still comes from capacities; a NonContainer slot category does
not prove an item cannot hold contents. Do not rename ContainerType into a boolean
that collapses Foci or conflate it with scene attachment placement.

Retaining placement is recommended even with compact grids: it gives their order a
real consumer and avoids recreating ordering when icons replace names. The precise
UI order remains a behavior choice; implementing retail empty-slot visuals is not
implied. Replacement rosters and insertion/removal updates must maintain order at
the world owner, not by sorting names in each consumer.

### 2. Census: foci, exceptions, and nesting

Population: **43,913 ACE World templates** in the local database at investigation
time. Sources joined `weenie` with bool 81 (RequiresBackpackSlot), bool 1 (Stuck),
int 6/7 (capacities), and int 1 (ItemType). This is a local template census, not a
claim about all servers or runtime-mutated objects.

Important normalization: ACE exposes capacities as `byte?`
(`WorldObject_Properties.cs:1203–1213`) and writes those bytes in public object
descriptions. Authored `-1` therefore becomes 255. A raw SQL `capacity > 0` census
misclassifies those templates. Reported comparisons below use `COALESCE(value,0)
& 255`, matching that byte representation; they do not apply every constructor's
possible runtime override.

| Finding | Evidence / implication |
| --- | --- |
| Five flag-only, zero-storage foci | WCIDs 15268 Foci of Enchantment, 15269 Foci of Artifice, 15270 Foci of Verdancy, 15271 Foci of Strife, 43173 Foci of Shadow. All Generic type with RequiresBackpackSlot. They need selectable UI representation, not invented storage. |
| 84 Container-type templates | All have nonzero item capacity after byte conversion. Our existing predicate and ACE agree for this category in the census. |
| 29 Container-type templates also have container capacity | 28 are authored Stuck. WCID 32199, Pumpkin Follower, is not Stuck and has 120 item slots and 10 container slots. These capacities establish representability, not permission to nest packs through the normal move action. |
| No capacity-only omission exercised in this population | Zero templates have nonzero container capacity and zero item capacity after conversion. Retail's broader predicate still matters as a contract distinction, but there is no measured local case justifying a standalone compatibility fix now. |
| One not-Stuck Chest exception | WCID 1114, Crude Lockbox: Chest type, five item slots, no container slots. ACE sends NonContainer, while the capacity-based helper treats it as a player pack-slot item. Not-Stuck is evidence for candidacy, not a complete live pickup experiment. |

Retail evidence: `acclient.c:210543` classifies a UI container using RequiresPackSlot
or either capacity. `acclient.c:265166–265168` applies the same predicate when
updating ordinary/container lists. `acclient.c:264618–264626` checks the target's
container capacity when placing a container, and item capacity for ordinary items.
Thus UI-container appearance, actual storage capability, and server slot category
are distinct concepts. A renderer or inventory UI must not collapse them.

ACE's `Container.cs::TryAddToInventory` (around 513) tests separate capacities.
The higher-level player move action has a stronger rule:
`Player_Inventory.cs:922–930` rejects a Container item unless the destination is
Player or Storage (house storage). Its comment identifies this as an ACE quest-stamp
protection rule, not proven retail behavior. Therefore ordinary pack-into-pack
movement is blocked despite any authored capacity. The same action also rejects
actual Corpse destinations.

`Player_Networking.cs::SendInventoryAndWieldedItems` (240–261) emits only
direct carried items and one level of their contents; it is **not recursive**.
The new UI cannot promise to recover deeper items the server has not sent.

**Scope consequence:** target main pack plus direct carried packs for ordinary ACE
behavior. Preserve received parent relationships in shared data rather than
hard-coding one-level storage into the contract. Deeper objects inserted by server
logic/admin tooling are not proven to recover at login. Supporting those completely
would expand discovery scope; no ACE change is included by this investigation.

### 3. Completeness requires retaining announcements

ACE login (`Player_Networking.cs:240–261`) and item creation
(`Player_Inventory.cs:90–107`) send a container create, ViewContents, then child
creates. Those are separate messages. The current world ViewContents handler
skips every unknown GUID; its existing
`test_view_contents_ignores_unknown_guid_without_synthesizing_entity` confirms this.

Not synthesizing an Entity is correct. Discarding the storage declaration is the
problem for the new read model. The initial readiness check only knows GUIDs in
`player.inventory`, so it cannot wait for an announced child that was never added
to that closure. Its existing readiness test proves the tracked-closure case, not
the stronger completeness guarantee the earlier scope wording suggested.

A containment event for a missing entity is another reachable intermediate shape:
the player handler can add its GUID to inventory, while the inventory handler's
location mutation returns false because no entity exists. There may be no entity
event for that change.

**Scope consequence:** world owns declared membership and hydration state together.
The inventory projection must distinguish pending descriptions from an empty
container. Complete snapshots cannot silently omit announced children. Retaining
the roster also makes the existing activation completeness check honest. Exact
loading presentation is still a UI decision; fake entities and discarding unknown
items are not required to solve it.

### 4. Mutation and publication boundaries

`WorldState::handle_message` (`state/types.rs:268`) runs handlers then reconciles
scene placements before returning events. Core then processes world effects and
follow-up effects in `client/messages.rs::handle_world_events`. Its runtime loop
handles each decoded session message separately (`client/runtime.rs:190`), and
also calls `world.tick()` for deferred pruning outside that message path.

| Trigger | Current authoritative path | Publication consequence |
| --- | --- | --- |
| Login roster | PlayerDescription -> player membership replacement | Changes can name unhydrated items; must invalidate storage without requiring an entity spawn. |
| Create/update object | Description hydration, ownership synchronization, scene reconciliation | Can add a hydrated item or change name, capacity, location, or classification prerequisites. |
| Container IID update | Property mutation -> ownership synchronization and world-presence withdrawal | Pickup may become owned and emit scene removal in this same completed world mutation. |
| Containment event | Player membership side effect, then item location mutation | Slot/category currently lost; missing entity can change ownership without an emitted entity event. |
| ViewContents | Container-open event plus updates to known children | Must retain a replacement roster, including unknown children, rather than treating ContainerOpened as sufficient inventory data. |
| Wield/unequip | Wielder/equipment properties and WieldObject event | Pack contents change while player ownership can continue; equipment-only entries still matter to selection policy even if hidden from this panel. |
| InventoryRemoveObject/ObjectDelete | Ownership removed immediately; entity marked for deletion | Actual EntityDespawned can wait until world.tick. Inventory must not wait for that event. |
| Relevant property/identify changes | Entity mutation plus property/identified events | Only projection-relevant changes should trigger publication; health, movement, and unrelated stats should not rebuild inventory. |
| Tick eviction | world.tick -> sweep/remove/reconcile | Cover removal outside network handlers, without scanning all inventory every physics tick. |

**Recommended ownership:** world invalidates its storage read model at its mutation
sites (including declarations/deletion with no entity event). Core projects affected
semantic records at completed authority boundaries and publishes actual changes.
Snapshot generation reads the same fact domain. No inventory-specific public
revision or generic world transaction engine is implied.

The browser needs coherent installation before selection reconciliation. At initial
or recovery replacement, install inventory and dynamic levels before notifying
consumers. For live mutations, selection must stop treating scene removal as identity loss.
Adding an inventory event after existing dynamic events without changing selection
semantics preserves the race. The revised contract scopes delivery through a shared
semantic mirror; a combined inventory/render envelope is not required.

### 5. Selection continuity: two different races

**Within one completed world mutation:** moving an item into inventory emits
PropertiesUpdated and a scene-placement change. Core's
`client/mod.rs:965–985` turns unresolved placement into DynamicEntity::Removed,
even though the canonical Entity remains owned. The browser currently treats this
as invalid selection. Replace that inference with accepted identity-availability
facts; changing only `maintainSelection` would miss the direct removal handler.

**Across multiple server messages:** ACE drop sends Container=0, then the move-item
event, then UpdatePosition (`Player_Inventory.cs:1437–1443`). Unequip sends Wielder=0,
equipment flags, and PickupEvent before subsequent placement/containment messages
(`Player_Inventory.cs:401–405`). Therefore a per-message atomic publication still
has legitimate intermediate unowned/unplaced states.

Decision required: either allow selection to clear when leaving the owned set
until the object is a valid scene target, or preserve a selected retained entity
through a world-reported pending-placement state. The latter needs explicit
availability facts; it cannot be derived reliably from absence in inventory and
scene feeds. `ResolvedScenePlacement` already distinguishes MissingEntity,
DeletedEntity, and UnplacedEntity in world; the current dynamic removal event
collapses those reasons. Do not invent a timed grace period or keep all removed
GUIDs indefinitely. Moves directly between owned packs can preserve selection
without this expanded drop-continuity contract.

### 6. Health eligibility can use current public facts

`Entity::apply_description` (`entity.rs:1603`) hydrates mandatory public ItemType.
`WorldObjectExt::is_creature()` tests its CREATURE bit. Retail's own IsCreature
does the same (`acclient.c:418067`). This needs no static template catalog and no
renderer realization. An entity awaiting creation is not yet eligible to initiate
a query; a later accepted description can resolve that state.

ACE's health handler accepts Creature. Its source inheritance includes Player,
Vendor, Cow, Pet, CombatPet (through Pet), and GamePiece. The local template census
found the creature bit in all 7,831 Creature, 1,179 Vendor, 17 Cow, 12 GamePiece,
29 Pet, and 259 CombatPet templates. The only other creature-bit templates were
three Admin and one Sentinel. Player construction derives from Creature and adds
the Player description flag (`Player.cs:35,114,139`). This validates a
**public-creature eligibility policy for this population**, not a universal proof
that arbitrary custom templates map to ACE's C# runtime class.

Retail's exact query policy is narrower: `acclient.c:231478–231487` checks a
non-stack selection and then IsPlayer, pet owner, or ObjectIsAttackable before
querying health. `acclient.h:21274` resolves the decompiled vtable call as IsPlayer.
Using the public creature bit would intentionally allow health for friendly
creatures/vendors too. That is a proposed product policy supported by ACE, not a
claim of exact retail parity. Item mana queries are a separate future feature.

**Recommended contract:** project health applicability from world facts alongside
the relevant entity display facts; reuse the existing dynamic display path for
world entities, and the inventory read model for items. Keep selection GUID as
the identity owner; `ClientEntityInteractions` owns the effective subscribed GUID
and health response state. Reconcile on identity **and eligibility** changes,
cancel once on transition to no eligible target, and never let panel mount own it.
Unknown/awaiting response and not-applicable must remain distinguishable in the HUD.

The existing health response echoes GUID and fraction, not a request generation.
Replies for other GUIDs can be ignored; an old reply after deselecting and reselecting
the same GUID cannot be correlated more precisely by inventing a frontend sequence.
Treat it as the latest received server health for that GUID.

### 7. Lifetime, recovery, interaction, and scale

- Portal entry suspends scene bodies and increments world presentation generation;
  it does not clear player inventory (`handlers/player.rs:67`, core
  `start_world_activation`). Inventory identity/revision should be scoped to the
  player/session, not reset merely because the camera/scene generation changed.
  The existing selector clears on non-in-world lifecycle; preserving selection
  through portals is not required by this slice.
- Host broadcast lag recovery already suppresses events until an
  ApplicationSnapshot. Extend that path. A restarted browser session must clear
  accepted inventory state before accepting a fresh snapshot; do not compare
  unrelated sessions' revision numbers or let an old player's cache leak forward.
- Existing `ClientCommand::Use` accepts a GUID and delegates cached usability/busy
  rules to core/world (`client/commands.rs:478–511`). Inventory selection does not
  require a new transport command. Whether the existing Interact affordance is
  enabled for inventory items remains a UI scope decision; adding equip/use-with
  workflows is not implied.
- Anonymous local shard census: **9 non-deleted characters**, all with owned
  items; minimum **1**, maximum **46**, mean **20.6**, maximum observed ownership
  depth **1** (direct player children). The SQL traversed Container/Wielder IID
  roots, then Container descendants, with cycle avoidance and a depth guard of 32.
  These saved development characters do not exercise pack nesting or represent
  mature inventories. Full replacements remain a reasonable starting point, not
  a benchmark result. Wire-byte size and live burst cadence cannot be measured for
  a projection that does not exist yet; measure those during implementation if
  cost becomes material, without introducing permanent speculative metrics.

Verification performed:

- `cargo test -p holtburger-world --lib inventory`: 8 passed.
- `cargo test -p holtburger-world --lib view_contents`: 3 passed.
- `cargo test -p holtburger-world --lib player_contained_object_readiness`: 1 passed.

These verify current behavior only. In particular, the passing unknown-contents
test exposes the declaration-retention gap; it is not evidence that the proposed
inventory contract is already implemented.

## Concrete ordering and recovery checks

Follow-up checks used six temporary Rust integration probes against the existing
world implementation, two temporary browser-session unit probes, and the existing
selection and host-recovery tests. All diagnostic code was removed afterward;
only this document is retained. The proposed-contract walkthroughs below are
analytical checks, not claims that a future inventory implementation already passes.

### Cross-queue ordering changes the reconciliation requirement

ACE `GameMessageCreateObject` and `GameMessageDeleteObject` use SmartboxQueue;
ViewContents, containment, InventoryRemoveObject, and public Container IID updates
use UIQueue. `NetworkSession.cs::EnqueueSend` puts messages into per-group bundles;
`Update` visits those bundles separately. `SendBundle` can pack Smartbox messages
around available space and explicitly preserves UIQueue ordering when skipping a
fragment (`NetworkSession.cs:814–899`).

Our session orders packets, then yields logical messages as fragment reassembly
completes (`session/receive.rs::recv_message`, `session/send.rs::process_fragment`).
**Packet order does not recover source enqueue order across these queues.**
A containment/removal statement followed at the client by an older serialized
object description is a meaningful case; it must not be dismissed as impossible
merely because ACE enqueued the create first in a method body.

This does not justify a new generic network reorderer in the inventory slice.
There is no shared storage revision on both messages to reconstruct that order.
The needed distinction is semantic: accepted UI storage declarations own the
storage relationship; object descriptions hydrate identity and item facts. The
new model must define their precedence explicitly, rather than letting the last
handler to write a Container property implicitly decide membership.

Retail supplies a useful structural reference: `ACCObjectMaint::ViewObjectContents`
(`acclient.c:374769–374814`) creates a separate inventory record even if the parent
entity is absent, clears both old lists, and fills them from the roster. When a
containment event names a missing item, the UI dispatcher updates the known parent's
inventory (`acclient.c:377741–377765`), and `ServerSaysContainID` inserts at the
specified position (`acclient.c:417573–417589`). Retaining declarations independently
of entity hydration is therefore supported by retail behavior as well as ACE data.

### Storage sequence walkthrough

Notation: P is the player, A/B are packs, X/Y are items. A roster is a complete
replacement for that parent's direct contents, not a delta and not a global list
of all entities. Descriptions and storage declarations have separate authority.

| Input sequence | Observed current behavior / source evidence | Required proposed result |
| --- | --- | --- |
| Known A; roster A=[X]; X not created | Probe: X is absent from inventory membership, and tracked-closure readiness returns true. | Retain X's declared membership/category/order. A is pending hydration, not empty or complete. |
| Roster A=[X] before A exists | Retail maintains an inventory record independently of the parent's entity. Current ViewContents stores only an open-container GUID and handles known children. | Retain the roster keyed by parent identity; hydrate its header/capacities when A arrives. Do not synthesize an Entity for A or X. |
| Missing X; move X to B at slot 3; later create X says parent P | Probe: ownership GUID is retained, destination/category/order are lost, and create places X under P. | Hydrate X without overriding the accepted move to B. Storage placement must survive missing descriptions. |
| Roster A=[X,Y]; move X to B; later roster A=[Y] | Existing entity-only iteration cannot express roster replacement semantics. | Detach X from A on move, add it once to B, and preserve B when replacing A. Removal is conditional on the current parent still being A. |
| Roster A=[X]; replacement A=[] | Probe with hydrated X: X remains owned and its Container remains A today. | A becomes empty. Discard its obsolete pending declaration/placement; do not delete X globally because its new location may be elsewhere. |
| Roster A=[X]; A=[]; delayed create X says A | Cross-queue case. A create currently resynchronizes ownership from its own Container property. | A description alone must not repopulate a newer accepted roster. A subsequent explicit storage admission can add X again. |
| InventoryRemoveObject(X); later create X says A | Probe: create clears the unconditional delete marker and restores ownership today. | Keep storage removal distinct from description hydration. Do not recreate a removed inventory entry solely from that delayed description. |
| Instance-delete X generation g; create X generation g; then newer generation | Probe: matching create stays non-owned; newer generation is admitted. | Reuse existing instance-aware lifecycle semantics; a blanket GUID tombstone must not permanently ban a legitimate new incarnation. |
| Roster A=[X]; remove A before X is created | Existing recursive ownership traversal discovers children through created entities only. | Withdraw the declared subtree using storage relationships, including unhydrated children. A late child create cannot restore the removed subtree. |
| UI move X from slot i to j in the same pack | Containment includes placement; retail inserts into an ordered list. | Move one existing membership; do not duplicate X. Compact/order the appropriate slot category at its world owner. |

Two identity/time domains must remain explicit:

- Storage statements are GUID-based and ordered within their accepted UI stream.
  Roster replacement, move, and removal govern membership. A retained empty roster
  is known-empty; it is not equivalent to never having received a roster.
- Entity lifecycle uses instance sequences where supplied. InventoryRemoveObject
  has no instance sequence, and creates do not carry the roster's sequence.
  We cannot invent a cross-domain timestamp comparison. A genuinely new admission
  must have explicit membership evidence; a new entity instance must not inherit
  old pending location instructions blindly.

These checks rule out "HashSet of owned GUIDs plus latest entity Container field"
as the complete new inventory shape. They also rule out a browser-only fix. World
needs parent-scoped ordered membership declarations that survive missing entities,
with explicit known-empty/unknown distinction and reconciliation with lifecycle.
The direct parent/category/order form one placement fact; avoid independently
mutable copies in both a roster and an unrelated item-location map.

The exact policy for a create-only owned object before any storage announcement
is pending hydration/admission, not evidence of an empty or fully known pack.
The implementation must distinguish that provisional evidence from an accepted
roster; it must not force a whole Entity or every raw protocol field into the
frontend contract. A revision generated after projection does not solve input
precedence inside world.

### Publication and observer walkthrough

Full initial/recovery replacements must be prepared and installed before notifying
consumers. For live traffic, the required outcomes below do not prescribe a combined
inventory/scene envelope. The revised contract separates semantic entity state from
rendering and uses a snapshot plus deltas for the semantic mirror.

| Transition | Required observable result |
| --- | --- |
| Pickup selected X | Containment establishes ownership. Losing scene geometry does not clear X, regardless of inventory-panel repaint timing. |
| Drop selected X | Evaluate accepted location/availability, not an accidental ordering of two browser projections. Genuine unowned/unplaced protocol states follow the chosen concession. |
| Move X between owned packs | One world location mutation preserves owned identity; do not replay remove/add through UI selection. |
| Deletion, including an inventory-only item | Authoritative loss reaches selection even if there is no dynamic removal. |
| Recovery contains owned X but no scene X | Install the complete replacement before notifications; scene snapshot absence does not declare X absent. |
| Lag/recovery | No stale admission or negative availability conclusion from a retained display or pre-recovery delta. |
| New session with reused GUIDs | Reset the accepted semantic baseline; do not retain prior-session admission evidence. |
| Malformed replacement | Validate before any partial store installation. |

What the running checks established:

- A valid current-state replacement already installs the dynamic mirror before
  `current-state` and `dynamic` observer notifications. The temporary probe observed
  the new player identity and new entity set in **both** callbacks, with a pre-snapshot
  delta suppressed. Extend this existing ordering to inventory.
- The duplicate-GUID probe found a narrower existing atomicity gap: shell state is
  assigned before `DynamicEntityMirror.apply` rejects duplicate snapshot identities.
  The exception leaves new shell identity beside the old dynamic mirror. As the
  replacement path is extended, move all potentially failing validation/preparation
  ahead of commit. This was a rejected-input probe, not a reproduced server payload.
- The host's existing lag test passed: one replacement request, suppression until
  the application snapshot, then resumed live delivery. Inventory belongs in that
  same application snapshot; no separate recovery command is needed.
- Current `ClientEntitySelection` independently handles dynamic removals, dynamic
  replacement snapshots, and bounded scene maintenance. All three must consult
  the accepted inventory/availability facts; changing only the maintenance timer
  leaves the direct notification paths incorrect.

The multi-message drop/unequip gap remains a product choice, not an unresolved
ordering experiment: an atomic commit cannot supply a world position that the
server has not sent yet. Retaining selection there requires a world-reported
retained/unplaced state; clearing on leaving ownership is the narrower concession.

Verification results for this follow-up:

- Six temporary world sequence probes passed, reproducing the current behaviors
  named above. They used synthetic entities and protocol messages with no runtime
  assets or live session.
- `npm run test:ts -- src/client/client-lifecycle-session.test.ts
  src/client/client-entity-selection.test.ts`: 24 passed, including the two temporary
  session probes. The other 22 are existing tests.
- `cargo test -p holtburger-3d-host
  lag_requests_one_snapshot_and_suppresses_deltas_until_replacement`: 1 passed.
- Removed the temporary Rust file and both temporary TypeScript tests; production
  source and permanent tests are unchanged.

These checks are sufficient to draft concrete storage and publication contracts.
They narrow the required shape without choosing loading visuals, foci layout,
health policy, or drop-continuity behavior on the user's behalf.
