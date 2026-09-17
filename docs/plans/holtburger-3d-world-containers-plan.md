# 3D world-container implementation plan

Status: **Original slice implemented; existing visual gates accepted on 2026-09-17. Transfer extension accepted by the user; section-background drop follow-up implemented and verified.**
Updated: 2026-09-17. Current authorization: implement the extended plan, stopping for major blockers or user acceptance. Existing source/synthetic evidence does not imply unreported live scenarios passed.

## Goal and scope

Open, browse, transfer, rearrange, and close world-container contents using shared
access and transfer semantics that also serve the TUI and scripting.

In scope: chests, housing storage, hooks, corpses, direct child packs, individual
and whole-pack pickup, explicit deposits/withdrawals, rearrangement within accessible
storage, cross-panel drag/drop, loading states, server refusal feedback, switching/closure,
snapshot recovery, and a movable/resizable popup with horizontal pack navigation
above a combined sectioned contents grid. Preserve ordinary hook behavior: hooks
off activates the displayed item; hooks on opens storage, subject to server rules.

The TUI migration is part of this feature's scope. Its existing Nearby hierarchy
must support an external root containing a populated child pack, including pickup
and root-owned closure. Shared world/core layers own access and pickup eligibility;
the CLI owns indentation, selection, verbs, and historical-open styling. The TUI
does not need the 3D client's popup or pack-navigation strip.

Out of scope: vendor/player-trade UI, a generic parent system for those domains,
bulk loot, new external split/equip/give/ground-drop workflows, recursive pack-navigation
UX, protocol redesign, and a complete census of authored content. Shared storage
relationships remain lossless even though this UI presents root plus direct packs.

Vendor state and world-container state remain peers with an explicit core-owned
replacement rule. Player trade keeps its independent negotiation lifecycle. Do not
introduce `ExternalInteraction`, `ItemAccess`, or a universal container framework.

## Architecture and contracts

| Layer / owner | Shape and responsibility | Named consumers |
| --- | --- | --- |
| World: existing `StorageState` | Accepted parent/slot relationships and roster coverage; sole contents authority | Ownership, retention, inventory and external sections |
| World: `WorldContainerState` | Closed or open with one confirmed external root GUID; no copied contents | Access queries, eligibility, retention, publication |
| Core: existing inventory planner/runtime | Resolve transfers between owned or confirmed-access storage; preview and submit share resolution; pickup allocates a carried destination | Both frontends, scripting, host previews |
| Core: focused world-container runtime | Source correlation, explicit close/switch commands, pending operation lifetime | Both frontends and scripting commands |
| World: semantic entity projection | Existing records, including pending descriptions admitted by active access | Frontend item cells, selection, pickup affordances |
| Core: application/entity publication | Recoverable access level and affected semantic records | Initial/recovery snapshots and live consumers |
| 3D host adapter | Typed projection and command mapping | Browser session; no independent game state machine |
| 3D app: shared contents presentation | Root-based grouping, icon leases, pack navigation, section grids, sorting and activation hooks | Inventory and external-window compositions |
| 3D app: one item-drag owner | Session-level commands and facts, source/destination surface context, gesture lifetime and preview feedback | Contents surfaces, existing equipment/action-bar/viewport paths |
| 3D app: specialized panel shells | Inventory equipment/currencies/burden; external access/title/close; each owns layout preferences | HUD composition |

Use a small world-owned discriminated state equivalent to `Closed | Open { root }`.
This represents local confirmed access, not the server's physical open animation.
Opening/closing requests belong to core operation state. Carry the direct-use source
through existing busy/use machinery where possible; do not keep parallel trackers
for the same request. Exact internal type names may follow neighboring code.

The world state stores the root once. Shared access queries traverse accepted
storage links; callers do not independently reconstruct permission from raw IIDs,
roster history, visibility, or an item's description. Per-item eligibility remains
world-derived and is published through the existing semantic contract.

Pending entities stay in the existing entity projection/mirror. Extend admission
and retention for external descendants; do not add host/frontend limbo collections.
Vendor offers and trade previews alone never establish container pickup eligibility.

## Behavior to implement

1. Ordinary use remains the activation command. Correlate a dispatched use with its
   source; a matching external-root roster confirms access. Unrelated player/child
   rosters only update storage. Use completion alone never opens a window.
2. Accept roster/description updates in either order. Preserve pending identities
   and distinguish awaiting contents, loading descriptions, and confirmed empty.
3. Before replacing an active external container with another container request,
   revoke the old access and send its explicit close once. A failed new opening
   leaves the old window closed; do not silently resurrect its access.
4. A confirmed vendor response retires container access and closes that root;
   starting external-container access retires the prior vendor state. Keep the
   coordination narrow and publish the vendor clear to existing consumers.
5. Explicit close revokes local access immediately and uses `NoLongerViewingContents`,
   regardless of root type. Server close affects only the matching active root;
   a delayed A close cannot dismiss B. Closing an already retired root must not
   send repeated close requests merely because a component unmounted.
6. Reject a same-root reopen while that root's close is still pending, with existing
   feedback. No deferred-open queue or automatic retry. Phase 1 settles bounded
   failure/retry behavior; timeout is not proof of server closure and cannot itself
   restore access. Do not leave a permanent silent interaction lock.
7. Pickup reuses core inventory allocation and `PutItemInContainer`. Revalidate at
   submission; server updates move items. Taking a pack preserves its children.
8. Closing releases access-derived admission/retention, including pending identities.
   Current player ownership or another live retention reason preserves transferred
   items. Late hydration never independently restores access.
9. Revocation accompanies authoritative root deletion/transfer and character exit.
   Phase 5 completes range and teleport behavior using shared authority facts, not
   renderer asset availability. A frontend unmount/resync is not character exit.
10. Initial and recovery snapshots carry the access level. Publish access and affected
    semantic facts coherently so an observer cannot use an old pickup affordance
    after access was revoked; core revalidation remains the execution authority.

### UI policy (original slice plus planned transfer extension)

- Reuse `ClientHudWindow`; retain session-local position, size each opening before display
  from its initial contents (four to five columns, one to four rows), and preserve
  manual resizing throughout that opening. Late arrivals do not resize the window.
- Show the popup only for confirmed access. The title/root entry uses the container's
  identity, not player-specific “Main Pack” terminology or artwork.
- Single click selects; double click or the normal interaction key picks up a contents
  item. Existing target-acquisition mode keeps precedence over ordinary activation.
- The horizontal strip selects and scrolls to a section. Strip double click must not
  loot a pack accidentally. Provide an explicit “Take pack” section action for child
  packs; it uses the same pickup intent. This default is subject to visual acceptance.
- Preserve item inspection and shared icon/capacity presentation. Pending entries are
  visible but cannot be picked up until their required facts exist.
- Equipment, currencies, burden, split UI, and player-only control policy stay in the
  inventory composition. Phases 7–9 deliberately extend the shared contents drag path;
  they replace the original slice's explicit exclusion of external drag/drop.
- Contents/pack headers accept container destinations; item cells retain explicit
  insertion/merge semantics. Only positional drops require Native sorting in the
  destination surface. Container append and supported merges do not require Native
  sorting; the source panel's sort preference must not block cross-panel transfers.
- Existing click selection, target-acquisition precedence, double-click activation,
  navigation-only strip clicks, and explicit Take pack remain. A threshold-crossing
  drag must suppress the corresponding click/activation. The external root is never
  a drag source; real child packs may be transferred as whole items.

## North stars and concessions

- Reduce duplicated state: storage owns relationships, access owns the root, core
  owns request lifetime, and app state owns presentation.
- Add only fields with named consumers. Keep request state out of entity facts and
  keep window preferences out of shared crates.
- Prefer small functions/modules and existing primitives. Review added line count
  against deleted open-set/history logic and avoided panel duplication.
- Match established behavior without reproducing retail's architecture. Record any
  observable deliberate compatibility departure under the repository marker rules.
- Investigate remaining questions inside their affected phase. Missing complete retail
  knowledge is not an entry gate for implementation.
- A user can retry an operation after a reported failure. No promise of automatic
  recovery, queued clicks, or perfect prediction of server permission.

## Phased implementation

Each phase includes focused verification and updates this checklist. Keep changes
compilable; make required signature/consumer updates in the same phase as a contract
change. Do not stage or commit unless separately asked.

### Phase 1 — Establish access ownership and request lifecycle

Deliverables: a focused world access module alongside `state/storage.rs`; core
container coordination alongside `client/item_use.rs`; integration in inventory
handlers, `commands.rs`, `messages.rs`, `mod.rs`, and shared event/command types.

- [x] Introduce `WorldContainerState` and world transitions/access queries.
- [x] Separate `ViewContents` storage acceptance from external opening confirmation.
- [x] Retain dispatched use-source identity; handle matching response, failure,
  completion, send failure, and existing operation timeout without duplicate trackers.
- [x] Implement explicit close, different-root switching, and vendor replacement.
- [x] Specify and implement same-root pending-close rejection and its bounded failure
  path. Trace the existing UIQueue completion order first; use a focused harness only
  if needed. Record the chosen retry rule here before encoding it in tests.
- [x] Route existing close/use consumers through these transitions. Mechanically
  migrate affected TUI/context contracts here rather than leaving a second open-set
  authority until Phase 3. Historical “opened before” display remains app-local.

Acceptance: a root roster opens only the intended external access; child/player
rosters never switch it; denied/hook activation does not fabricate opening; A's
late close cannot close B; vendor and container states follow the replacement rule;
close failure does not grant access or leave a silent permanent lock. Focused core/
world transition tests pass, and changed shared/TUI call sites compile.

### Phase 2 — Admit incomplete contents and support looting

Deliverables: changes in world `entity_facts.rs`, `interaction.rs`, `context.rs`,
`state/liveness.rs`, storage/retention mutation paths, and core
`inventory_plan.rs`, `inventory_storage.rs`, `inventory_runtime.rs` as needed.

- [x] Admit announced external descendants as existing pending semantic records.
- [x] Derive root/descendant access from accepted storage relationships consistently
  for pickup, VIEWED use-location semantics, and retention.
- [x] Extend pickup to hydrated eligible external items and whole packs; preserve loose
  world pickup and existing destination allocation. Do not broaden eligibility to all
  visible unowned items or bypass the planner with raw actions.
- [x] Reconcile root revocation with unhydrated declarations and hydrated previews.
- [x] Preserve moved packs/items through former-root closure and roster replacement.
- [x] Cover both hydration orders, close-before-first-description, whole-pack transfer,
  full inventory/server refusal, and vendor/trade negative cases with synthetic data.

Acceptance: root/pack contents can load incrementally; pending identities are not
lootable; successful transfers preserve descendants; closing withdraws access to all
remaining descendants; late descriptions cannot restore it. Existing loose pickup
and owned-inventory behavior remain correct under relevant tests.

### Steering checkpoint — Confirm the shared slice

- [x] Trace root -> pack -> item through opening, transfer, and closing using the actual
  implementation. Confirm the new owner replaced state rather than duplicating it.
- [x] Review code size, naming, consumer responsibilities, and remaining uncertainty.
- [x] Adjust later phases based on actual contracts. Resolve routine choices directly;
  involve the user only for material scope/UX changes. Do not launch another open-ended
  evidence pass or introduce a vendor/container umbrella abstraction.

### Phase 3 — Publish recoverable state and migrate consumers

Phase boundary: Phase 1 migrates the TUI's current-root authority and keeps consumers
compiling; it does not complete nested-pack presentation. This phase removes the
remaining single-pack assumptions. The feature is not complete with only the 3D
consumer migrated.

Deliverables: core `client/entity_facts.rs`, application snapshot/event types;
`apps/holtburger-3d/host/src/client_projection.rs`, `client_runtime.rs`, `client_host.rs`;
app `client-host-contract.ts`, `client-lifecycle-session.ts`, `client-entity-mirror.ts`;
TUI data/entity/nearby reducers and scripting view adapter.

- [x] Add access to application snapshots and typed live publication. Phase 2 already
  invalidates semantic entity records when access or ancestor containment changes;
  integrate that behavior with the access snapshot/session contract here.
- [x] Prepare/commit coherent access and entity updates at the existing session boundary;
  avoid an observable access/eligibility mismatch and duplicated per-frontend inference.
- [x] Expose close through the narrow host command boundary. Reuse existing pickup/use
  submission and error reporting.
- [x] Migrate TUI Nearby filtering to shared accessible-descendant semantics instead of
  requiring each item's immediate parent to have a world position. Reuse its existing
  indented hierarchy to display root -> child pack -> contained item; do not add a TUI
  popup or horizontal pack strip.
- [x] Keep Open/Close verbs attached to external-root access, not each announced child
  pack. Any container-close action offered within the contents view targets the active
  external root. Route eligible item and whole-pack pickup through the shared planner.
- [x] Use the confirmed root for TUI current-container state and scripting
  `currentOpenContainer()`. Child rosters cannot replace it. Preserve historically-opened
  styling separately as frontend presentation history.
- [x] Add synthetic TUI reducer/view-model tests for a chest containing a populated pack:
  hierarchy membership/depth, root-only lifecycle verbs, item/pack pickup commands,
  and closure targeting the root. Do not run the interactive TUI for verification.
- [x] Test initial snapshot while open, recovery after lost events, root closure during
  resync, and pending child records across replacement snapshots.

Acceptance: a fresh/recovered browser session reconstructs the same root and contents
without replaying open events; TUI and scripting report the root rather than the last
child roster. The TUI displays a chest, its child pack, and that pack's items in the
existing hierarchy, permits eligible item/whole-pack pickups, and closes the external
root without treating child packs as separately opened containers. Closure removes
remaining external contents from the accessible view while preserving transferred
player-owned items. Closure invalidates affordances even when no item changed parent.
Host/schema/session tests and affected Rust/TypeScript checks pass.

### Phase 4 — Reuse inventory presentation and build the popup

Deliverables: focused contents primitives extracted from `ClientInventoryPanel.svelte`,
`client-inventory-sections.ts`, and appropriate icon/capacity helpers; orientation
support for `ItemGridStrip.svelte`; new app-local container panel/model composed in
`ClientWorldView.svelte` using `ClientHudWindow.svelte`.

- [x] Generalize pure membership/grouping around an explicit root and admitted records.
  Keep equipment/currencies/action bindings in `ClientInventoryState`.
- [x] Share sectioned contents rendering/cells and icon handling without cloning the
  inventory panel or making a universal vendor/trade list framework.
- [x] Add horizontal strip navigation with overflow handling; preserve vertical inventory
  navigation and root/pack native ordering.
- [x] Mount one movable/resizable window driven by confirmed access, with independent
  sort/scroll state, loading/empty states, selection, inspection, and close action.
- [x] Apply the initial UI policy, explicit whole-pack action, and target-acquisition
  precedence. Ensure existing inventory drag/split behavior does not attach implicitly.
- [x] Add synthetic browser fixtures for root-only, populated child packs, pending
  descriptions, empty contents, overflow, resize, and root switching.

Acceptance: both panels use shared contents primitives; container strip scrolls to
sections without looting; contents activation submits pickup and awaits server facts;
window movement/resizing does not send commands; close submits once; inventory
presentation still works. Component/model tests and browser harness report no errors.

### Phase 5 — Finish world lifecycle behavior

Deliverables: shared range/lifecycle integration in core runtime plus world spatial
queries where needed; focused harness scenario only when source/synthetic tests cannot
prove behavior. Reuse existing spatial primitives before adding new geometry.

- [x] Implement range checks against authoritative poses and cylinder geometry/use radius;
  resolve the missing retail callback through the available references or a focused
  experiment if needed. No renderer-dependent permission or frontend distance loop.
- [x] Complete teleport, authoritative root removal/transfer, character replacement,
  and disconnect transitions, suppressing network sends when the session cannot send.
- [x] Exercise delayed/no-ack close and same-root retry against the Phase 1 policy;
  tighten the narrow behavior if evidence requires it, without a generic request queue.
- [x] Verify hooks on/off, denied corpse/chest access, root switching, pack transfer,
  and walk-away closure with representative scenarios. Record which are source,
  synthetic, and live evidence; use the debug harness, never launch the TUI.

Acceptance: leaving access range or the character/root lifetime revokes access and
cleans the popup; transient asset loading does not. Close/retry behavior is explicit
and tested. Any unavailable live fixture is recorded as a remaining acceptance check,
not silently counted as passed or a reason to halt unrelated implementation.

### Phase 6 — Cleanup, integration checks, and visual acceptance

- [x] Remove obsolete `open_containers` authority, history-derived current-root logic,
  raw-roster-as-open events, duplicate grouping, unused helpers, and misleading names.
  Preserve only historical UI data with its existing rendering consumer.
- [x] Replace tests tied to discarded architecture with behavioral scenarios; retain no
  tests that require unchecked-in runtime assets. Keep references/compatibility markers
  accurate where observable behavior deliberately differs.
- [x] Run the validation below for touched packages. Re-run only checks affected by new
  edits; record results and actual limitations here.
- [x] Produce browser-harness evidence and a short user acceptance checklist/screenshots:
  move/resize, horizontal overflow, section navigation, item/pack pickup, and closing.
- [x] Original visual gates accepted by the user on 2026-09-17, following the compact-sort adjustment. The pickup/close race was separately reproduced and fixed; no additional live scenario results are inferred.

Acceptance: no duplicate authority or dead migration path remains; required automated
checks pass; the feature is ready for and receives user visual acceptance. Automated
completion and pending user acceptance must be reported separately if necessary.

## Transfer extension: model and boundaries

The new requirement exposes an owned-only assumption, not a missing second inventory
system. Keep world storage/access authority intact. Broaden the existing core transfer
planner and make both frontend panels compositions of shared contents presentation.
Do not unify ownership with permission to access external storage, and do not pull
vendors or negotiated trade into this model.

Constraints and data shapes:

- One player inventory and at most one confirmed external root, with direct child-pack
  sections; retain the existing lossless containment graph. This is the supported shape,
  not a claim about a world-database census. No arbitrary window registry is required.
- Native item and pack slot domains remain distinct. Resolve protocol positions from
  authoritative identities/relationships, never from sorted screen indices.
- World owns access; core revalidates endpoints when submitting. Frontend presentation
  has no independent writable-container authority. A local feasible preview cannot
  promise server acceptance.
- ACE owns destination-specific restrictions (including corpses, hooks, house permissions,
  attunement and container nesting). Do not add a parallel client type blacklist.
  Keep structural checks: current access, known facts required for the command, capacity
  where known/needed for placement, self/descendant containment cycles, and wire ranges.
- Server updates own membership and order. A refusal leaves the displayed authoritative
  contents intact and reports the actual error. Sending or previewing is not a move.
- Contents dragged from external storage gain no implicit permission to equip, give,
  drop on the ground, split, or bind an action. Existing ownership checks for those
  specialized actions remain. This extension concerns container transfers and the
  existing stack-target behavior where supported by ACE.
- A sent transfer may finish after close, root switch, or recovery. Preserve the
  pickup/close retention fix and extend it only for newly enabled command/result paths.
  An unsent gesture must instead be canceled when its access or target disappears.

Model chosen after considering narrower alternatives:

1. **World layer:** existing accepted storage graph plus confirmed external access;
   no new generalized storage-session authority or limbo cache.
2. **Core layer:** the existing identity-based inventory intents resolve container
   transfers. Explicit destinations support deposit, withdrawal, and reorder. Pickup
   remains a convenience that allocates a carried destination and resolves to the same
   move representation. Use action-specific source/destination checks instead of merely
   widening the planner's top-level ownership guard for every action.
3. **3D frontend:** one shared contents view (navigation, grouped grid, sort, loading,
   icon/capacity presentation, and activation hooks). Inventory adds equipment and its
   footer; the external shell adds access lifetime/title/close and horizontal orientation.
   Factor common contents projection and rendering, not a universal panel with many
   inventory/vendor/trade flags. Preserve each model's current resource/update cadence.
4. **3D gesture owner:** one item-drag owner consumes session facts/preview/submission
   directly, plus the source/destination contents surface's current root and sort mode.
   It must not obtain shared commands or world facts through `ClientInventoryState`.
   Surface context is presentation, not permission or another entity mirror. Keep
   specialized equipment, action-bar, and viewport branches without forcing them into
   container semantics. Inspect whether a small direct surface binding is sufficient
   before adding any registration mechanism.

Simply enabling external DOM selectors leaves the planner and sort/lifetime assumptions
wrong. Extracting only more markup leaves drag coupled to inventory. Conversely, a new
universal container service duplicates the existing session, world, and core owners.
The selected change removes those couplings at their owning layers.

Evidence and implementation anchors:

- Core `client/inventory_plan.rs::plan_inventory_intent` rejects unowned sources except
  Pickup; item targets and `plan_move` also require player ownership. Its blanket
  container-inside-nonplayer-root check would reject housing-storage deposits. Update
  these decisions together; do not accidentally grant every inventory action to loot.
- Core `client/inventory_runtime.rs` already executes Move/Merge plans through existing
  wire commands. `client/commands.rs::send_game_action` retains external move sources;
  world `state/liveness.rs` and inventory message handlers settle that retention.
- Frontend `client-item-drag.ts` holds `ClientInventoryState`, cancels unowned sources,
  hard-codes inventory DOM selectors, and reads inventory sort mode for preview and
  release. All four seams require a cutover, not just pointerdown admission.
- `ClientContentsGrid`, `ItemGridStrip`, `ClientContentsSortButton`,
  `client-container-contents.ts`, and `client-contents-visuals.ts` already provide shared
  presentation. Compose above these; remove superseded panel/gesture paths as extracted.
- ACE `WorldObjects/Player_Inventory.cs::HandleActionPutItemInContainer_Verify` resolves
  destinations from carried inventory, the landblock, and the last used container. It
  rejects direct corpse destinations and applies hook/attunement/storage restrictions.
  `DoHandleActionPutItemInContainer` sends authoritative containment updates.
  `HandleActionStackableMerge` is the source for newly enabled external stack paths;
  trace its outcomes before extending retention to that command.

### Phase 7 — Generalize shared transfer resolution

Deliverables: core `client/inventory_plan.rs`, `inventory_runtime.rs`, command dispatch;
world access/storage/retention queries only where needed; existing host preview contract
and consumer fixtures if its shape actually changes.

- [x] Resolve accessible transfer sources/destinations from owned storage or the active
  external root/descendants. Keep closed, stale, pending and vendor/trade-only identities
  from becoming transfer authority. Reuse existing world facts; add no universal capability
  matrix or duplicated endpoint permission fields.
- [x] Generalize Container and Item/Stack destinations while retaining native slot-domain,
  capacity, insertion/removal-index, and cycle rules. Keep Pickup's carried allocation
  and script destination preference. Preserve existing owned-only specialized actions.
- [x] Remove external-destination blockers that duplicate ACE-specific policy. A structurally
  feasible corpse deposit reaches ACE and can fail normally. Local known-space/slot checks
  still apply; no fabricated capacity or success on missing data.
- [x] Preserve carried-pack swap semantics. A drop onto an external container/pack names a
  destination; it must not become the player's two-command pack swap. Inspect and reuse
  the merge path for external item targets; merge-only intent must never silently become
  a positional move after a refusal.
- [x] Trace command success, rejection, deletion, and late completion for newly enabled
  moves/merges. Reuse existing retention; prove close/switch cannot discard descriptions
  or pack subtrees still needed by a dispatched transfer. Settle any new retention on
  real corresponding results or session exit, never an optimistic membership change.
- [x] Add focused world/core tests for explicit deposit and withdrawal, same-container and
  root/child-pack moves, pack transfer, native positions, pending/revoked endpoints,
  cycle rejection, server-refused destination, and close-before-completion. Exercise
  actual serialized result handling and semantic publication for the race paths.

Acceptance: one planner resolves owned/external container transfers into existing wire
commands. Preview and submit share resolution; server refusal preserves source facts.
Ordinary inventory behavior and specialized ownership restrictions remain correct.

### Steering checkpoint — Confirm transfer seams

- [x] Trace inventory -> external pack, external item -> explicit carried pack, and
  external reorder through preview, command, server result, publication, and retention.
- [x] Review whether widened checks actually removed owned-only coupling without granting
  unrelated actions. Reassess source-specific update results and the remaining frontend
  work; adjust routine details directly. Stop for a major source/model gap or material UX
  decision, not an open-ended completeness investigation.

Phase 7 evidence (2026-09-17): all 490 core and 845 world library tests pass
(`/tmp/holtburger-transfer-core-tests.log`). New cases cover explicit bidirectional
transfers, native rearrangement, root/child destinations, whole packs, cycles,
closed/pending endpoints, specialized ownership restrictions, merge-only behavior,
and serialized success/refusal after close. Owned deposits now use the existing
move-retention path so late success into a closed root releases stale descriptions.
ACE's merge path consumes or reduces the source and updates the destination stack;
it does not move the source identity. Serialized late full/partial merge tests prove
that the existing owned destination remains known after closing the source container.

Steering result: no new authority or wire/host contract is needed. The remaining
coupling is frontend-only: the drag owner currently obtains session facts/commands
and global sort policy from inventory. Phase 8 replaces that dependency with direct
session access and the two existing contents presentation owners. A shared contents
component owns navigation, scrolling and layout; panel shells retain their specialized
footer content and independent resource lifetimes. No dynamic window registry is needed.

### Phase 8 — Compose both panels from shared contents and gestures

Deliverables: `ClientInventoryPanel.svelte`, `ClientWorldContainerPanel.svelte`, their
models, shared contents components/helpers, `client-item-drag.ts`, and app/harness
composition. Names may follow existing conventions; no parallel drag implementation.

- [x] Extract the common contents view above existing grid/strip/sort components. Each
  panel supplies its prepared contents, orientation and activation behavior; inventory
  retains equipment/currency/burden/split UI, external shell retains access/title/close.
  Share common projection work without combining unrelated preferences or resource lifetimes.
- [x] Inject session facts and preview/submission directly into the drag owner. Bind source
  and target to their own contents surface, removing global inventory sort assumptions,
  owned-only source cancellation for transfers, and inventory-only selector policy.
- [x] Support explicit drops onto container headers/pack entries and item targets across
  both panels, plus rearrangement within external sections. Preserve navigation clicks,
  target-acquisition precedence, drag thresholds, and suppression of post-drag activation.
  Keep the root nondraggable and explicit Take pack available.
- [x] Apply Native-sort restrictions to positional targets in the destination surface.
  Append-to-container and supported merge-only targets work under other sorts. Independent
  source/destination sorting cannot select the wrong policy or use displayed indices.
- [x] Revalidate/cancel unsent gestures on source/target access withdrawal, root replacement,
  resync, or unmount. Reject stale preview completions, including after sort changes.
  Sent commands remain server-owned and can complete after the window closes.
- [x] Show the existing server refusal feedback. Drop highlighting means locally feasible,
  not guaranteed acceptance. Preserve equipment/action-bar/viewport and player-pack behavior;
  external sources must not acquire those specialized actions through shared DOM handling.

Acceptance: both panels use the same contents rendering and one cross-panel drag path.
Deposits, explicit withdrawals, and external reordering issue identity-based commands;
separate panel sort modes and lifecycle changes cannot misdirect a drop.

Phase 8 implementation (2026-09-17): `ClientContentsView` now composes the common
pack navigation, scrolling, section grid, and footer placement. Its orientation is
panel-local; footer snippets retain inventory currencies/burden and the existing compact
sort control. Both models use `contentsSections` for grouping and sorting. Resource leases,
sampling and preferences remain independently owned. The inventory split dialog remains
inventory-specific and is the remaining named consumer of its model's command capability.

`ClientItemDrag` now receives the session directly. Mounted contents roots resolve to
one of the existing presentation owners; no registry, permission matrix or entity mirror
was added. Destination sort controls item versus merge-only intents; container append is
available in every sort. Existing sorted unequip appends and carried-pack swaps remain
specialized paths. Captured source/destination roots plus current session access reject
stale gestures before sampled DOM replacement. Action-bar reconciliation also reads the
session directly, allowing deletion of inventory's generic `readEntities` proxy.

Review coverage: traced core planner -> existing runtime/dispatch -> world retention and
serialized result handling -> semantic publication; inspected session -> gesture owner ->
preview/release checks and both panel compositions. Shared projection removed duplicate
sorting; navigation/scroll markup and inventory-only drag selectors were replaced. New
code is concentrated in the shared contents layout and two-surface gesture lifetime checks,
not a second transfer controller. No vendor/trade lifecycle was widened. Existing artwork
leases and split/action-bar specialization remain justified independent consumers.

### Phase 9 — Integration, cleanup, and new visual acceptance

- [x] Replace the browser fixture asserting external drag is excluded with actual
  deposit/withdraw/reorder/whole-pack scenarios. Cover independently sorted panels,
  refused corpse deposit, pending records, stale preview, close/switch during a gesture,
  and authoritative completion after close. Preserve existing inventory gesture coverage.
- [x] Remove superseded inventory-only selector branches, duplicated contents preparation,
  unused command pass-throughs, and obsolete vocabulary. Assess added versus removed
  code; keep shared components focused and specialized controls in their compositions.
- [x] Run the existing validation strategy for affected packages. TUI/scripting consume
  shared behavior and keep compiling; no new TUI drag UI or interactive test run is required.
- [x] Record source, synthetic, and live evidence separately. Produce updated browser
  screenshots and request acceptance only for the newly added drag/drop/reorder behavior
  and any layout changed by extraction. Previously approved visuals do not need reapproval
  unless materially changed.

Acceptance: new transfer paths and old inventory controls pass focused tests/browser
checks, no duplicate authority or drag implementation remains, and the user accepts
newly introduced visual/gesture behavior.

Phase 9 evidence (2026-09-17):

- **Source and shared runtime:** ACE remains the destination-policy authority. Core/world
  tests exercise actual serialized containment, removal, stack-size and rejection messages;
  they do not depend on browser optimism or a running ACE instance.
- **Synthetic browser integration:** the canonical `--client-hud` run completed successfully
  with `/tmp/holtburger-transfers-browser.log`. The production panels, gesture owner, session
  decoder, mirror and toast display cover deposits, explicit withdrawals, external native
  targeting, whole packs in both directions, independently sorted surfaces, merge-only and
  append targets, pending cells, delayed preview after sort/close/recovery, root replacement,
  refusal feedback without optimistic movement, and known/enabled inventory arrival after
  closing an already-submitted withdrawal. Core replies/server facts are controlled fixture
  inputs; this is not a claim of live house/corpse permission acceptance.
- **Existing behavior:** the same browser run passed inventory equipment/unequip, pack swaps,
  split, action-bar, viewport, spell and theme checks. Harness assertions now name the Main
  Pack header and diagnostics window explicitly rather than depending on DOM order. The
  cross-panel fixture waits for both configured display cadences and binds server feedback
  as ClientApp does. No product timing or permission workaround was introduced.
- **Automated checks:** 2,013 affected Rust tests passed (world 845, core 490, CLI 351 library
  + 16 binary, host 311); 288 frontend tests passed. Strict affected-package clippy, Rust
  formatting, frontend type checks, ESLint, dead-code checking, Prettier and diff whitespace
  checks passed. Logs: `/tmp/holtburger-transfer-final-rust-tests.log`,
  `/tmp/holtburger-transfer-clippy.log`, `/tmp/holtburger-transfer-ts-tests.log`,
  `/tmp/holtburger-transfer-check.log`, `/tmp/holtburger-transfer-lint.log`,
  `/tmp/holtburger-transfer-dead.log`, `/tmp/holtburger-transfer-format-check.log`.
- **Review artifacts:** `/tmp/holtburger-transfers.png.world-container.png` shows both contents
  panels; `/tmp/holtburger-transfers.png.inventory.png` shows the retained inventory shell.
  Blue artwork is the harness's synthetic icon fixture. Shared layout and projection replace
  duplicated navigation, scroll, sorting and selector paths; the larger gesture owner handles
  the additional surface and its lifetime without a second drag implementation.
- **User/live evidence:** original visual gates and the transfer extension were accepted by
  the user. The requested section-background follow-up is recorded below. No additional
  live ACE or interactive TUI run is claimed.

**User gate accepted:** the user approved the transfer extension and requested the
section-background drop affordance documented below.

## Validation strategy

Use lightweight synthetic unit/message-sequence tests for semantic invariants; browser
fixtures verify actual DOM/layout/gesture wiring. Run checks incrementally per phase:

- Repository root: `cargo fmt --all -- --check`; targeted `cargo test -p holtburger-world`
  and `cargo test -p holtburger-core` with relevant test filters while iterating.
- Consumer integration: `cargo check -p holtburger-cli -p holtburger-3d-host`; run relevant
  CLI/scripting/host tests when their behavior changes. Do not run the TUI executable.
- Final affected Rust packages: `cargo test -p holtburger-world -p holtburger-core
  -p holtburger-cli -p holtburger-3d-host` and
  `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-cli
  -p holtburger-3d-host --all-targets -- -D warnings`; include scripting if touched.
- From `apps/holtburger-3d`: `npm run check`, `npm run test:ts -- <affected test files>`,
  `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and
  `npm run harness:browser -- <container fixture options>` after implementing the
  focused fixture. Inspect existing harness options rather than inventing a flag.
- Use existing manifest scripts where available. Classify unrelated failures from
  evidence; do not modify unrelated files to make broad checks green.

## Bounded decisions and risks

| Question / risk | Resolve in | Bound on the solution |
| --- | --- | --- |
| No acknowledgement or late close for the same root | Phase 1, verify in Phase 5 | Reject while pending, report failure, require deliberate retry; no automatic open queue or timeout-as-success |
| UseDone versus matching contents lifetime | Phase 1 | Extend existing request context; test actual message ordering assumptions |
| Range exit and teleport details | Phase 5 | Shared authority geometry/lifecycle; investigate only the missing rule needed to finish |
| Root/pack descriptions arrive out of order | Phase 2 | Existing pending records and storage declarations; no limbo cache |
| Vendor clear is presently frontend-only | Phases 1/3 | Fix replacement coordination only; no vendor/trade feature expansion |
| Coherent access/affordance publication | Phase 3 | Existing application snapshot/session commit boundary; no generic event bus |
| Pack navigation versus pickup gesture | Phase 4/user acceptance | Strip only navigates; explicit Take pack action initially |
| Unexpected nesting/content shape | Affected phase | Preserve facts; do not silently flatten or invent unsupported recursive access |

## Definition of done

- [x] Confirmed access has one shared owner and all consumers use it.
- [x] Root/child rosters and pending descriptions remain distinct from opening authority.
- [x] Individual/whole-pack pickup preserves authoritative ownership and descendants.
- [x] Close, switch, failure, range exit, root removal, teleport, and session exit have
  explicit behavior with appropriate synthetic or runtime verification.
- [x] Vendor/trade visibility alone does not grant loot access.
- [x] Snapshots reconstruct the current root and pending contents after recovery.
- [x] 3D popup reuses contents presentation, has horizontal navigation, and moves/resizes.
- [x] TUI/scripting authority reconstruction and dead migration vocabulary are removed.
- [x] TUI Nearby handles populated child packs, shared pickup eligibility, and root-owned
  close behavior, verified with synthetic reducer/view-model tests.
- [x] Required automated checks pass and limitations are recorded.
- [x] Original visual gates accepted on 2026-09-17.
- [x] Explicit deposits, withdrawals, and external rearrangement use the shared transfer planner.
- [x] Both frontend panels compose shared contents and a single drag owner independent of inventory state.
- [x] ACE-enforced destination refusals preserve authoritative membership and report feedback.
- [x] New transfer/retention/gesture scenarios pass tests; extension cleanup and visual acceptance complete.

## Ground truth and evidence appendix

The following source findings justify the plan. They are investigation records, not
runtime test results or a separate prerequisite phase. Line numbers are anchors;
verify symbols against current source while implementing.

### Reference summary

References are repository-relative; symbols are included to survive line movement.

| Finding | Reference |
| --- | --- |
| `ViewContents` contains parent GUID and ordered child GUID/category entries, no request ID or external-open flag. | `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventViewContents.cs`, constructor |
| External opening queues root and direct child-pack rosters, then descriptions in source order; different message groups mean this is not a wire-arrival guarantee. | `ACE/Source/ACE.Server/WorldObjects/Container.cs`, `SendInventory`; `NetworkSession.cs`, `Update` |
| Player login, pack creation, and pack pickup also produce contents rosters. | `Player_Networking.cs`; `Player_Inventory.cs`, `TryCreateInInventoryWithNetworking`, `HandleActionPutItemInContainer` |
| Base container use closes a prior container, but chest use calls `Open` directly. Do not describe this ACE inconsistency as a retail defect. | `Container.cs:695`; `Chest.cs:175` |
| Retail explicitly closes the previous ground container when switching and gates the UI on a matching requested root. | `acclient-eor-source/acclient.c:384417`, `SetGroundObject`; `:385428`, `OnViewContents` |
| Vendor use overwrites ACE's last-container pointer; external lookup depends on it. Retail coordinates vendor/container replacement. | `Vendor.cs`, `ApproachVendor`; `Player_Inventory.cs`, `FindObject`; `acclient.c:385728`, `Handle_VendorInfo` |
| ACE allows container insertion into Player or Storage in its movement path, and sends direct child contents on external opening. | `Player_Inventory.cs:921`; `Container.cs`, `SendInventory` |
| Core emits `PutItemInContainer` for planned moves; close emits `NoLongerViewingContents`. | `crates/holtburger-core/src/client/inventory_runtime.rs`, `move_action`; `commands.rs`, `CloseContainer` |
| Pickup eligibility currently requires a loose world object with no storage location. | `crates/holtburger-world/src/interaction.rs`, `pickup_candidate` |
| Every contents roster is currently recorded as an open container. Close removes one GUID and gathers only direct preview children. | `crates/holtburger-world/src/handlers/inventory.rs`; `state/mutations.rs`, `current_container_preview_item_guids` |
| Pending semantic records are supported, but description-less external descendants are excluded by current admission. | `crates/holtburger-world/src/entity_facts.rs`, `client_entity_guids`, `client_entity_facts`; `apps/holtburger-3d/src/client/client-entity-mirror.ts` |
| TUI derives current container from the latest open event; nearby filtering requires the direct parent's world position. | `apps/holtburger-cli/src/pages/game/data.rs`, `current_open_container`; `panels/dashboard/tabs/nearby/tab.rs`, `get_entities` |

### Detailed source findings — 2026-09-16

#### 1. Closure has several paths, and completion is asynchronous

**Observed in source:**

- `Container.cs:831-863`: `Close` can delay `FinishClose` by half the close motion
  duration. `IsOpen` and `Viewer` clear only in `FinishClose`, which emits
  `CloseGroundContainer`. Thus sending a close is not synchronous confirmation.
- `Player_Use.cs:258`, `HandleActionNoLongerViewingContents`: resolves the root on
  the current landblock and closes only when its viewer matches the player. A
  missing root or mismatched viewer produces no acknowledgement in this handler.
- Retail `acclient.c:242368`, `CloseCurrentContainer`, uses `ItemHolder::UseObject`
  when hiding the external panel (`OnVisibilityChanged`, `:242498`). Switching
  uses the explicit no-longer-viewing path (`SetGroundObject`, `:384417`). Do not
  reproduce two client-side close policies merely because retail has them.
- Retail `OnEndCharacterSession` (`:384806`) calls `CleanUpGameUI` (`:384671`),
  which clears trade/vendor UI and closes the ground container.
- Before implementation, world `PlayerTeleport` suspended runtime bodies without
  revoking container access, and deletion retired storage without clearing container
  authority. Phase 5 now revokes before teleport/reset or root storage retirement.

**Design consequence:** distinguish immediate local access revocation from network
close completion. Do not make window destruction the authoritative close mechanism.
Character exit and loss/deletion of the root need explicit transitions. Exact
teleport policy is not yet proven from retail; do not conflate temporary render
unavailability with authoritative root deletion.

#### 2. Range geometry is established; the final callback is incomplete

Retail `RecvNotice_SetGroundObject` (`acclient.c:242507`) registers the root with:
its authored use radius, `useRadii=true`, `ignoreZDelta=false`, one-second interval,
and zero timeout. `CalculateObjectRangeChecks` (`:380378`) invokes range exit when
`ObjectsInRange` fails. `ObjectsInRange` (`:417918`) returns false if either physics
object is absent, otherwise uses `get_distance_to_object` (`:305154`), which uses
`Position::cylinder_distance` with both objects' heights/radii. This is not a
center-distance or horizontal-only check.

The external-container range-handler vtable points to `loc_4CC900` (`:39178`),
whose body is absent from this decompile. Registration and distance policy are
proved; the precise callback action is not. No runtime observation was performed.

**Next evidence:** resolve the cylinder-distance primitive and equivalent existing
shared spatial query, then observe range exit if the missing callback matters to
compatibility. Keep range behavior in core/world, not a panel timer; renderer asset
readiness must not determine game access.

#### 3. Same-root reopening requires completion discipline

Analytical sequence from the source (not an observed packet capture):

1. Root A is open. Client requests close; ACE schedules `FinishClose` for an animated root.
2. Client immediately uses A again. `Chest.CheckUseRequirements` (`Chest.cs:126`)
   still sees it open and initiates closure rather than opening it.
3. A close response names only A. A locally generated request generation is absent
   from the wire and cannot prove which attempted lifetime it belongs to.

For A-to-B switching, B can open before A's delayed close. Close handling must be
identity-specific. `FinishClose` itself only clears `LastOpenedContainerId` when
it still equals the closing root.

`holtburger-session/src/session/receive.rs::recv_ordered_packet` orders server
packets. That does not serialize delayed ACE actions or provide request identity.
`session/send.rs::process_fragment` emits each message as soon as all its fragments
are complete, with no completed-message sequence barrier in that function.

ACE `NetworkSession.cs::Update` iterates and flushes separate group bundles.
`ViewContents` uses UIQueue; `GameMessageCreateObject` uses SmartboxQueue. Therefore
`SendInventory` source enqueue order does not establish roster-versus-description
arrival order. Likewise, transfer IID/containment updates and later pack hydration
must be reconciled from their authoritative relationships, not assumed to arrive as
one transaction. A packet capture is still needed to characterize actual schedules;
the feature should support both hydration orders regardless.

**Investigation recommendation, adopted for Phase 1:** revoke A immediately and gate a same-A reopen
while its close is unresolved. Do not automatically reopen on an arbitrary timer
or equate timeout with server acknowledgement. A no-ack close is possible, so the
failure/reset path must be specified before choosing a `Closing` state shape.
Use completion without a matching root roster is not successful opening.

#### 4. Whole-pack pickup preserves the subtree through ordinary storage updates

`Player_Inventory.cs::DoHandleActionPutItemInContainer` (`:1268`) removes the pack
from its old owner, inserts it at its destination, then sends container-IID and
containment events. The successful pickup continuation (`:1079`) sends the pack's
roster and its children's descriptions afterward. `VerifyContainerOpenStatus`
(`:1182`) closes a picked-up container if this player had that container itself open.

`StorageState` already changes parent links without discarding a pack's children;
its ownership query walks ancestors. Reuse it. Closing the former root must evaluate
current ownership, not delete everything from an earlier captured membership list.

Existing tests in `world/src/state/tests.rs` cover preserving other retention,
stale direct previews on reopening, and late updates retaining preview provenance.
They do not establish the full external-root -> pack -> child transfer/close sequence.
Those scenarios should be added as focused synthetic tests during implementation.

#### 5. Pending identities exist; external admission is missing

World stores roster relationships before descriptions. `client_entity_guids` and
`client_entity_facts` (`world/src/entity_facts.rs:217`) admit description-less owned
identities but exclude unowned external declarations. The frontend already accepts
`description: pending` alongside known location and roster coverage in its ordinary
entity map (`client-entity-mirror.ts`). Host adaptation does not need a second entity
store merely to transport these records.

Access-root descendants must become eligible for pending publication and remain
non-actionable until the required facts exist. Access revocation must also retire
pending records, not just hydrated entries in `state.entities`.

Existing tests named "late container item arrival" cover arrivals while the root is
open, then closure. The closed-container update test begins with an already-marked
preview. Neither proves a first-ever description arriving after close. That case
remains a test obligation; do not report it as already covered.

#### 6. Snapshot recovery must carry an access level

`ClientApplicationSnapshot` (`core/src/client/types.rs:361`) contains semantic
entities but no container-access state. `emit_current_application_snapshot`
(`core/src/client/mod.rs:705`) emits vendor/trade compatibility events separately,
before the application snapshot. `client_host.rs:228` intentionally discards all
non-snapshot events while awaiting initial/recovery state.

Therefore container access must be part of the recoverable application snapshot,
with corresponding host/frontend schemas. Forwarding standalone open/close
notifications is insufficient. Do not expand this task into vendor
or trade presentation recovery, but do not copy their event-only path either.

`EntityFactsPublication::observe/collect` currently invalidates entity/property/
storage changes, not an independent access-level transition. Opening/closing must
recompute affected `can_pick_up` and related semantic facts even if no entity moved.

#### 7. Consumer census and migration boundary

| Existing consumer | Current responsibility | Proposed disposition |
| --- | --- | --- |
| World inventory handler | Records every contents roster as open | Separate roster acceptance from confirmed root access |
| World retention + mutation paths | Direct-parent open-set tests and preview provenance | Query root-scoped access using accepted storage relationships |
| `WorldContextExt` | `VIEWED` use-location and destination checks | Consume the same shared access semantics |
| Core use/busy runtime | Tracks operation kind, not direct-use source | Investigate carrying source identity here before adding a parallel tracker |
| Core entity publication | Publishes derived eligibility | Invalidate on access transitions and admit pending descendants |
| TUI `GameData` | Open set and most-recent history derive current root | Replace authority reconstruction with shared root state |
| TUI nearby view | Visibility, verbs, open/previously-opened display | Use shared access for current behavior; keep historical display app-local |
| Scripting `currentOpenContainer()` | Delegates to TUI's history-derived root | Preserve API meaning using confirmed external root; child rosters must not replace it |
| TUI open/close actions | Open forwards ordinary Use; close forwards CloseContainer | Keep commands routed through shared core behavior |
| 3D host and semantic mirror | Snapshot recovery, typed retained records | Extend existing contracts; no duplicate limbo collections |

`has_opened_container_before` has a real nearby-rendering consumer; historical UX
should not be deleted solely because history must stop defining current authority.

Vendor audit: `trade_vendor.rs::ClearVendor` clears only `state.view.vendor`.
Trade updates also clear that presentation; vendor updates are ignored while TUI
trade state is present. Shared `WorldState.vendor` is set by approach packets.
These are frontend behaviors, not proof that shared vendor lifetime is complete or
that trade must join a new shared exclusivity enum. Limit changes to the explicit
vendor/world-container replacement rule; retain separate specialized state.

#### 8. Shapes and evidence limits

- Housing `Storage : Chest` has house-permission checks and permits pack insertion
  via the Player-or-Storage rule. This proves a practical pack-bearing root type.
- Corpses add loot permissions and mark themselves looted on close; hooks redirect
  activation when hidden. These are server activation/lifetime differences, not
  reasons for frontend-specific protocol commands.
- External contents delivery covers root and direct child containers, not arbitrary
  recursive delivery. The UI can start with root + direct-pack sections while shared
  containment remains lossless.
- No world-database census or live fixture run was performed. This pass establishes
  supported source paths, not prevalence, maximum authored depth, or item counts.


## Progress and decision log

- 2026-09-16: Made TUI nested-pack migration an explicit scope requirement, with
  presentation and behavior acceptance in Phase 3 after Phase 1's authority cutover.
  Verification uses synthetic reducer/view-model tests, not the interactive client.
- 2026-09-16: Completed source investigation of close timing, range geometry, whole-pack
  transfer, pending admission, consumers, snapshot recovery, and message groups.
- 2026-09-16: Converted the evidence document into six implementation phases and a
  steering checkpoint. Remaining uncertainties belong to their affected phases;
  exhaustive protocol/retail knowledge is not a prerequisite to starting.
- 2026-09-16: Implemented Phases 1–2 and completed the shared-slice checkpoint. No
  live-server or visual verification was performed. Existing ACE and ACViewer
  submodule dirtiness predates this task and remains untouched.

### Shared-slice checkpoint results

**Implemented ownership and seams.** World owns one `WorldContainerState` root and
computes descendant access from existing storage relationships. `ViewContents` accepts
rosters without opening access. Core retains the dispatched source in the existing
busy operation, confirms only its matching root roster, coordinates vendor replacement,
and owns outstanding close acknowledgements. TUI open/close reducers now project that
root; historical styling no longer selects the active container. No limbo collection,
second relationship graph, or vendor/container umbrella was introduced.

Traced direct use -> serialized message handling -> world roster acceptance -> core
confirmation -> world events/TUI reducers, and accepted contents -> semantic admission
-> pickup planner -> authoritative transfer -> former-root closure. Reviewed the
`WorldContext` VIEWED predicate against accepted parent links and the scripting
current-container adapter against the TUI root. Snapshot recovery and coherent browser
session publication are still Phase 3 obligations, not claims of this checkpoint.

**Close policy.** Explicit close revokes access before sending; repeated close does
not resend. A different root can open while the old root closes. Same-root use is
rejected while its acknowledgement is pending. After ten seconds, core reports an
unconfirmed close and permits a deliberate retry, without restoring access or queuing
use. Send failure releases the pending gate and propagates the error. The protocol
has no lifetime token: after a timeout/retry, a late same-root close can conservatively
revoke the retry. This accepted limitation does not let A's close affect B.

**Ordering evidence.** ACE `Player_Use.cs::TryUseItem` invokes activation before
scheduling `SendUseDoneEvent`; `Container.cs::SendInventory` enqueues root and child
rosters during activation. `GameEventViewContents.cs` and `GameEventUseDone.cs` both
use UIQueue. Core tests feed serialized rosters and UseDone through `handle_message`,
including completion-before-roster rejection. This establishes the source contract;
it does not claim a live packet capture. Description order remains independent.

**Admission and pickup.** Pending external descendants use existing entity facts.
Hydrated eligible contents use the existing inventory planner and destination allocator.
Closure and roster withdrawal revoke access-derived admission; late descriptions cannot
restore it. Moving a whole pack preserves its subtree through former-root closure and
roster replacement. Trade retention can preserve an entity without granting pickup;
vendor offers alone grant neither world-container access nor pickup.

**Review findings resolved.** Ancestor roster changes must invalidate descendant
records, including pending children that were previously outside the accessible tree.
The publication invalidation now covers this, with a regression test. Removed the old
open sets, direct-only preview cleanup, and tests that encoded roster-as-open authority.
The two focused modules add access transitions and request coordination; their bulk is
behavioral tests. The source increase is justified by these two missing responsibilities,
without a separate generalized session/controller framework.

**Verification.** `cargo test -p holtburger-world -p holtburger-core --lib`: 839 world
and 479 core tests passed. `cargo test -p holtburger-cli`: 351 library and 16 binary
unit tests passed; the interactive client was not launched. Core tests include local
UDP socket failure paths, run with sandbox escalation. Focused world tests additionally
cover nested VIEWED access and revocation. Clippy for world/core/CLI/3D host, all targets
with warnings denied, formatting, and diff whitespace checks passed.

**Remaining work at this checkpoint.** Phase 3 was the next authorized boundary: add
recoverable access publication, finish coherent browser session updates, and migrate
TUI nested filtering/verbs. Its mechanical root-state migration is already done.
Phase 4 still owns all popup/UI work; Phase 5 still owns root deletion/transfer,
character-exit, range, and teleport lifecycle completion. No new blocker or scope
change was found. Work stopped at this checkpoint as originally requested, then resumed
through the remaining phases on subsequent authorization.


### Phase 3 implementation results

- Access travels with semantic snapshots and deltas, so the existing mirror
  prepare/commit publishes the root and eligibility together. Host projection reuses
  these contracts; no extra event stream is needed. Receiver-loss tests cover pending
  descendants, gated deltas, reopening from snapshots, and closure during recovery.
- TUI Nearby reads world-produced descendant membership and pickup facts. A synthetic
  world/reducer/view test verifies chest -> pack -> item indentation, shared pickup
  commands, root-only Open/Close verbs, closure, and historical styling.
- Removed frontend open/close events; TUI history observes accepted state instead.
  Scripting current-container identity still delegates to the confirmed root.
- TUI pickup previously allocated locally and sent raw MoveItem. It now submits the
  shared pickup intent. That intent accepts scripting's optional carried-container
  preference; core validates ownership and uses its existing fallback allocator.
- Verification: 311 host tests, 351 CLI library tests and 16 CLI binary tests passed;
  275 client TypeScript tests passed. Core entity-facts tests (15) and pickup-preference
  coverage passed. Svelte/TypeScript/Electron checks passed before Phase 4 extraction.
  Browser evidence follows with the actual popup in Phase 4.

### Phase 4 implementation results

Shared contents membership, section rendering, activation, icon leasing/display sampling,
and strip orientation now serve inventory and the independent world-container popup.
External pack navigation does not loot; an explicit section action picks up the pack.
Inventory drag remains scoped to inventory, with targeting taking precedence in both panels.
The browser harness passed pending hydration, horizontal overflow, navigation, item/pack
pickup, targeting, move/resize, drag exclusion, recovery, root replacement, empty contents,
and coalesced close. Final screenshot: `/tmp/holtburger-containers-final.png.world-container.png`.
Artwork in this fixture is synthetic; this does not claim real-content visual acceptance.
Client TypeScript suite: 277 tests passed. Svelte/TypeScript checks passed.

### Phase 5 implementation results

World owns the use-range query and access revocation before root deletion/eviction,
transfer into storage, teleport, and character replacement. Core samples range on its
existing one-second runtime cadence, sends explicit close for range/teleport/transfer,
and clears access plus pending acknowledgements at session/character exit without
sending. Late use rosters cannot open access during portal space or after session exit.
Prepared target geometry now carries setup height alongside its existing radius; both
use canonical body poses and effective object scale. No renderer state or extra timer
owns permission. Missing geometry is unknown and leaves confirmed access unchanged.

Geometry is sourced from ACE `Physics/Common/Position.cs::CylinderDistance`,
`Physics/PartArray.cs::GetHeight`/`GetRadius`, and
`WorldObjects/WorldObject_Use.cs::IsWithinUseRadiusOf` (absent use radius: 0.6 metres).
Retail registration and geometry are established at `acclient.c:242507`, `:417918`,
`:305154`, and `:446301`. The missing `loc_4CC900` body remains unavailable; we implement
the planned explicit-close policy on range exit and do not claim its exact callback
was recovered. Teleport revocation is our explicit lifecycle policy, not a claim of
an observed retail packet sequence. These uncertainties do not change the shared boundary.

Synthetic tests cover scaled/default/authored range, vertical/overlap geometry, missing
preparation, single-send walk-away closure, teleport with late roster, root transfer,
accepted versus future-instance deletion, pending-descendant cleanup, terminal sessions,
and character-entry reset. Prior message tests cover denial/no-roster hook activation,
root switching, transferred packs, send failure, no acknowledgement, and explicit same-root
retry. Source confirms hooks-on container access/hooks-off activation and corpse/housing
permission checks. No live server fixture or world-database census was run; real hook,
corpse, housing storage, and walk-away checks remain in user acceptance below.

### Phase 6 checks and acceptance

- Complete affected Rust test suites passed: world 843, core 483, CLI library 351,
  CLI binary 16, host 311; doc tests passed. The interactive TUI was never launched.
- Client and icon-repository TypeScript tests: 288 passed across 35 files.
- Svelte/TypeScript/Electron checks, ESLint, Knip, Prettier check, Rust formatting,
  and affected-package Clippy with warnings denied passed.
- Reviewed world storage/access -> core correlation/publication -> host snapshot/delta ->
  session mirror -> popup and TUI consumers; pickup continues through the shared planner.
  Removed old open sets/events and duplicate grouping. Historical TUI styling remains
  presentation-only. Vendor/trade remain separate specialized state.
- Final canonical browser harness rerun passed after the close-guard fix. All container
  gesture/lifecycle assertions passed; screenshot inspected. No page errors were reported.
  Synthetic icon-failure fixtures produce expected console warnings; this is not proof
  of production artwork or live-server behavior. Full log:
  `/tmp/holtburger-container-final-browser.log`.
- Fixed a display-sampling edge case found during review: a same-root close/reopen between
  samples no longer leaves the popup close action latched. Its command-in-flight guard
  coalesces clicks and releases on settlement; core owns protocol idempotence.
- ACE and ACViewer submodule changes predate this task and remain untouched. No staging
  or commits were performed.

Original acceptance checklist (visual gates accepted by the user on 2026-09-17).
The checklist below remains a record of requested scenarios; the approval does not
establish unreported live hook/permission/TUI scenarios or a live retest of the race fix:


1. Review the popup layout and move/resize it; overflow the horizontal pack strip and
   navigate to a child-pack section. Artwork in the synthetic screenshot is placeholder.
2. With real content, select/inspect and double-click an item to loot it; use **Take pack**
   for a whole pack. Confirm the inventory updates after the server accepts the transfer.
3. Close/reopen/switch roots, walk out of range, and teleport while open. Confirm closure
   leaves no usable external items. Check hooks on/off and denied corpse/housing access.
4. TUI: confirm root -> child pack -> item indentation, pickup commands, and root-only
   Open/Close actions in Nearby. This is a manual acceptance check, not an automated TUI run.

### User review adjustment — compact sort control

Replaced the container footer's text button with the inventory panel's compact icon
and single-character mode indicator. Both panels now use `ClientContentsSortButton`,
including the accessible label and current/next-mode tooltip, so their presentation
stays aligned. Sort state and cycling remain owned by each panel.

Validation: Svelte/TypeScript checks, ESLint, and the canonical client-HUD browser
harness passed. Updated screenshot inspected:
`/tmp/holtburger-compact-sort.png.world-container.png`. Original visual gates were subsequently accepted on 2026-09-17;
unreported live scenarios remain unverified.

### User-reported race — pickup followed by immediate close

Reproduced with a serialized core message test: submit pickup from external storage,
close it, run world eviction, then receive containment without another description.
Before the fix, the final inventory fact was owned with `description: Pending`.
ACE `Player_Inventory.cs::DoHandleActionPutItemInContainer` sends the container IID
and containment event on success, not a new item description; its move/pickup chain
can complete after the viewer closes. `Container.cs::FinishClose` deliberately does
not send content deletions. Immediate local preview eviction therefore lost data
required by the already-dispatched pickup.

Core now retains external item descriptions when dispatching a container move and
releases on send failure. World's existing lifecycle store counts unresolved requests,
retains a moving pack's descendants through accepted storage ancestry, and releases
on containment success or item-scoped rejection. Session/character teardown clears
abandoned requests. Duplicate requests cannot release each other's retention early.
This retention never grants ownership or closed-container semantic admission. No
arbitrary timeout is used as evidence that a dispatched transfer cannot still finish.

Focused tests cover the original close/evict/complete order and the resulting known
inventory publication, pack subtree preservation, duplicate-request rejection, failed
sends, and session cleanup. This prevents the race; it does not reconstruct descriptions
already discarded by an earlier client build.

Validation after the race fix: 845 world and 484 core library tests passed. Clippy
for world/core/CLI/3D host (all targets, warnings denied), Rust formatting, and diff
whitespace checks passed. The reproducer was observed failing before the fix and
passing afterward; no live client or interactive TUI was launched.

### Scope extension decision — 2026-09-17

User accepted the other existing visual gates and requested planning for depositing
and rearranging contents. Applying the problem-solving review changed the proposed
cutover from simply hoisting more panel markup to generalizing container transfer
resolution and removing the drag owner's dependency on player inventory state.
Phases 7–9 describe that work; this update changes the plan only. No implementation
of the extension has been performed. ACE remains the destination-policy authority.

## Accepted transfer gate and section-background follow-up

The user accepted the transfer visuals/gestures and requested an additional drop affordance:
non-item space within each pack section, including the Empty label, should append to that
pack in both panels. Item cells retain reorder/merge targeting; disabled item cells do not
turn into background. Appending remains available under every display sort. The final
section owns unused pane height, and inter-section spacing belongs to the following section.
This is frontend target resolution over the existing Container intent; core/server policy
and authoritative movement remain unchanged.

- [x] Implement and browser-verify Empty labels, populated grid gaps and trailing section
  space for both contents surfaces, preserving item targeting and sorted append.

Verification: the full canonical `--client-hud` browser suite passed with new background
append assertions, including Empty labels in both panels, occupied-grid gaps in both
panels, unused trailing space in the carried pack, and background append while externally
sorted. Existing item reorder/merge, navigation, lifecycle and cross-panel scenarios still
pass. Frontend type checks, ESLint, formatting and diff whitespace checks pass. Evidence:
`/tmp/holtburger-section-drop-browser.log`, `/tmp/holtburger-section-drop-check.log`,
`/tmp/holtburger-section-drop-lint.log`, and
`/tmp/holtburger-section-drop.png.world-container.png`. No shared Rust or network behavior
changed in this follow-up.


## Final accumulated-diff quality review — 2026-09-17

Boundary: the complete container feature relative to HEAD, including untracked
implementations, the transfer extension, section-background drops, opening sizing,
and stale-lock correction. ACE/ACViewer submodule working trees are excluded.
Their source was used as evidence, not modified for this feature.

### Findings resolved before commit

- **Medium: replacement depended on cached classification.** In core
  `world_container.rs`, preparation retired the previous container/vendor, while
  authoritative roster admission could accept a root preparation did not recognize.
  The unlock fix made this distinction explicit. Preparation remains useful for
  promptly closing a known previous surface, but cannot own replacement alone.
  Both paths now call one idempotent replacement transition. Serialized-response
  tests cover an unclassified root replacing a container with exactly one close,
  repeated roster receipt, and both known/unclassified storage replacing a vendor.
- **Low: unused transition events survived the snapshot cutover.** World access
  transitions still returned open/close events with no remaining consumer; core
  forwarded them through unrelated world-event processing. Removed the event
  variants and forwarding. World changes access/retention directly; core publishes
  it through the existing semantic snapshot/delta boundary. Closure, replacement,
  teleport, deletion, and retention tests verify the resulting state and consumers.
- Updated the current sizing policy in this plan and corrected a displaced tuning
  comment. Historical investigation remains explicitly historical.

### Seam coverage and ownership

| Seam inspected | Guarantee and immediate consumers |
| --- | --- |
| ACE unlock/use/contents → core use correlation | Matching dispatched source and server roster establish access; cached lock metadata does not veto success. Failure/completion/timeout never invent access. |
| Core access transitions → world storage/retention | Accepted parent graph is sole membership authority. Closing withdraws permission; dispatched transfers retain descriptions independently until item outcome or session reset. |
| Core inventory planner → wire dispatch → world inventory handlers | Preview and submit share resolution; server containment commits movement. Whole-pack moves, refusal, merge, close-before-result, and failed sends were traced. |
| World facts → core snapshot/delta → host projection → frontend mirror | Root access and affected records cross one recoverable semantic boundary. Host forwards typed facts; mirror commits before notifying panel/selection/gesture consumers. |
| Shared state → CLI reducers/Nearby/actions | Shared descendant and pickup facts drive nested rows and verbs; the CLI owns indentation/history. Root-only close and pickup reach shared core behavior. |
| Frontend models → shared contents → drag/session commands | Grouping, sorting, icon leases and DOM selection were inspected together. Current session facts reject recovery/replacement gestures; submit revalidates authority. |
| Popup → opening measurement/HUD placement | Theme-derived measurement runs hidden; viewport clamps and manual resize remain existing HUD policy. Initial contents choose size once; later arrivals do not resize. |
| Icon repository → persistent model/display owners | Acquire replacement keys before releasing old keys; displayed URLs survive DOM replacement through tick and owner teardown. |

### Accepted costs and limits

The root-access state, close-acknowledgement tracking, and in-flight description
retention have different owners and lifetimes; collapsing them would conflate
permission, server completion, and data availability. Vendor and player trade remain
separate domains. Shared contents rendering removes the duplicated inventory grid,
strip, sorting, activation and artwork preparation; inventory-specific equipment,
currencies and split policy stay in its shell. No general container framework is needed.

Maintenance dry-runs covered another server-confirmed storage kind, root replacement
during a released drag, and whole-pack completion after closure. No new registry,
entity cache, or mirrored containment graph was required. Direct child packs are the
navigation limit; deeper relationships remain lossless shared data. A lost transfer
result can retain descriptions until session reset, without restoring access.

Verification includes affected Rust suites and strict Clippy, frontend type checks,
288 client/icon tests, ESLint, Knip, formatting, and the real-browser HUD harness
with container/transfer/sizing scenarios. Existing visual gates and the live unlock
retry were accepted by the user. This review did not run the interactive TUI, conduct
a new live server/content census, or audit unrelated vendor/trade workflows. Browser
fixtures exercise production UI/session components with synthetic server records;
they are not an end-to-end ACE session. No unresolved blocking finding remains.
