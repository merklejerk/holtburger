# 3D pickup, drop, and inventory operation ownership

Status: implemented; automated verification complete. Visual and live interactive
acceptance belongs to the user, per the implementation-thread instruction.

## Goal and agreed scope

Interacting with an eligible ground object attempts to put it into carried storage.
Dragging an inventory item, carried bag, or equipped item onto the 3D viewport
attempts to drop it near the character. Single-request inventory actions do not
hold the global inventory interaction lock while awaiting server updates.

Included:

- Objective, shared pickup eligibility and submission-time validation.
- Main-pack-first placement, then carried packs in native order, using the existing allocator.
- Whole-object/whole-stack drops, including equipped objects and bags.
- Separation of single-request submission from protected client-orchestrated sequences.
- Existing authoritative updates and failure feedback, with browser gesture verification.

Excluded: automatic stack merging on pickup, ground placement at the cursor,
partial-stack drops, looting unopened containers, new pickup queues, optimistic
inventory mutation, generalized resource reservation, and unrelated TUI policy migration.
Action-bar dragging continues to edit bindings; it never drops the bound object.

## Ground truth and investigation baseline

- `ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs:790`: container-move
  admission. At line 831, static GUIDs, creatures, and Stuck objects are rejected.
  Busy handling rejects requests or admits one subsequent pickup during return motion.
- The same file at line 970 implements world/container transfers with server-owned
  approach and pickup motion. At line 1371, DropItem accepts inventory or equipped
  sources; at line 1418 it dequips directly. At line 1472 the server chooses ground
  placement, attempting a position in front of the character.
- `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionPutItemInContainer.cs`:
  the request contains item GUID, container GUID, and placement.
- `crates/holtburger-core/src/client/commands.rs:836`: internal Get is only a
  PutItemInContainer convenience targeting the player at placement zero. MoveItem
  sends the same wire action with explicit destination. Pickup requires one request,
  never Get followed by MoveItem. DropItem is also already implemented on the wire.
- `crates/holtburger-world/src/context.rs:566`: TUI destination selection checks
  preferred storage, main pack, then other available storage.
- `crates/holtburger-core/src/client/inventory_storage.rs`: allocate_storage already
  supplies deterministic pack order, native append placement, separate item/pack
  slot budgets, and explicit errors for incomplete storage facts.
- `crates/holtburger-core/src/client/inventory_plan.rs`: all current intents require
  ownership. Pickup needs its own admission branch, not removal of this invariant.
- `crates/holtburger-core/src/client/inventory_runtime.rs`: single-request moves,
  merges, and splits currently share pending-operation machinery with pack exchanges.
  A ten-second timeout drops local tracking and unsent continuation steps; it sends
  no server cancellation. Late authoritative updates still apply.
- `crates/holtburger-core/src/client/commands.rs:109`, `inventory_plan.rs:420`,
  `equipment_runtime.rs`, and `item_use.rs`: audit all operation admission
  gates together. Inventory/equipment operations currently block broad categories
  of inventory, use, trade, and combat requests.
- `apps/holtburger-3d/src/client/client-item-interactions.ts`: ordinary interaction
  currently enters use; active target acquisition has its own precedence.
- `apps/holtburger-3d/src/client/client-item-drag.ts`: imperative pointer owner,
  preview correlation, release validation, cancellation, and binding gestures.
- `apps/holtburger-3d/src/client/ClientWorldView.svelte`: existing data-game-viewport
  marker. `ClientActionBars.svelte` currently constructs the drag owner.

Line numbers are investigation anchors; verify against current code during execution.
Use ACE for server rules and the read-only retail decompile for any additional claims
about retail client behavior. Do not infer eligibility from appearance or item names.

## Design principles

1. World owns reusable entity understanding; core owns allocation and execution;
   the frontend owns gesture interpretation and interaction precedence.
2. Eligibility authorizes an attempt, not a promise of success. The server retains
   burden, busy, attunement, trade, uniqueness, and other admission decisions.
3. Submit once against current authoritative facts. Never retry after a timeout
   automatically or label sending as successful pickup/drop completion.
4. Protect dependent sequences, not every outstanding network request.
5. Prefer subtraction: remove single-request confirmation state that has no remaining
   consumer instead of adding pickup/drop trackers to the old broad lock.
6. Keep resolved destination/placement in the plan; serializers and frontend consumers
   do not rederive the allocation.

## Owners and deliverables

| Layer and owner | Responsibility |
| --- | --- |
| world interaction semantics / entity facts | Derive and publish pickup eligibility from known description, GUID class, creature/Stuck facts, ownership, and authoritative ground placement. Core reuses the same rule. |
| core inventory planner | Add explicit pickup and ground-drop intents. Pickup allocates storage and resolves to Move; drop accepts owned carried or equipped objects and resolves to a drop action. |
| core storage allocator | Reuse existing allocation and append behavior; no parallel allocator. |
| core inventory/equipment runtimes | Single requests send without acquiring pending interaction ownership. Dependent pack/equipment sequences retain sequencing, conflicting-action protection, validation, rejection, and timeout handling. |
| 3D host and browser contracts | Extend existing typed inventory intent/preview and entity contracts; pass through existing preview_client_inventory / submit_client_inventory commands. |
| 3D item interaction owner | Active targeting first; otherwise eligible selected ground objects attempt pickup, remaining objects follow existing use behavior. |
| 3D drag owner / viewport composition | Explicit viewport destination, feedback, release handling, all sort modes, equipped sources, and overlay exclusion. |
| protocol, session, DAT, content | No anticipated implementation changes. Existing wire actions and data suffice. |

## Phase 1 — Separate submission from dependent orchestration

- [x] Classify every InventoryPlan and equipment execution path by whether a later
  client request depends on an earlier authoritative result.
- [x] Send standalone move/merge/split plans without retaining completion-wait state.
  Preserve validation and server error projection, including source identity.
- [x] Retain an operation owner for pack exchanges and dependent equipment sequences.
  Restrict its fields and names to actual continuation consumers; inspect single-step
  equipment cases before retaining any wait merely for a completion notice.
- [x] Update all command, planner, equipment, and item-use gates consistently. Retain
  lifecycle and unrelated busy-operation admission rules unless evidence warrants change.
- [x] Keep conflicting requests blocked while a protected sequence actually owns
  dependent state. Do not introduce fine-grained reservations in this slice.
- [x] Remove unused single-request confirmation variants, quantities, deadlines, and
  generic completion notices. Replace tests that only preserve retired architecture.

Acceptance: a pending standalone move does not locally block subsequent use or another
standalone inventory request. Pack exchange still waits before its second move,
revalidates assumptions, and never sends its continuation after rejection/timeout.
Timeout remains explicitly local abandonment, never claimed server cancellation.

Tradeoff: successive requests may use facts that have not caught up with the server.
ACE can reject them or resolve a different final ordering. Do not promise client-side
atomicity. Delayed updates from earlier requests can also arrive during a later sequence;
preserve step validation and exercise this ordering rather than treating the lock as
proof that no other server work exists.

## Phase 2 — Shared pickup/drop semantics and contracts

- [x] Add a shared pickup predicate/result in world. Require a known, unowned ground
  entity, dynamic GUID, non-creature classification, and no Stuck restriction.
  Use authoritative storage/placement rather than renderer residency as the ground test.
- [x] Publish the derived fact in entity facts, including correct republication when
  relevant properties, ownership, or placement change. Pending facts cannot enable pickup.
- [x] Add explicit pickup and ground-drop intent variants. Keep existing owned-source
  requirements on rearrangement intents. Validate again at submission after previews.
- [x] Resolve pickup through allocate_storage with player root preferred and the
  source's correct item/pack slot domain. Use native append placement, unlike TUI's zero.
- [x] Send one PutItemInContainer for pickup; send one DropItem for carried or equipped
  drop. Do not unequip first or require spare inventory space to drop equipment.
- [x] Update inventory preview projection, Zod contracts, entity validation, and fixtures.
  Reuse existing host commands and lifecycle-session transport methods.
- [x] Verify existing action-result feedback remains visible for both local admission
  failures and server rejection after removing standalone operation tracking.

Acceptance: pickup requests contain the selected destination exactly once; equipment
drop emits only DropItem; no new single-request timeout/lock is introduced. Inventory
and scene presentation change only from authoritative updates.

## Phase 3 — Frontend interaction and drag integration

- [x] Extend ClientItemInteractions' ordinary interaction routing to submit pickup.
  Preserve active use-on-target precedence and clicked/selected identity handling.
  Inventory use and action-bar activation retain their existing semantics.
- [x] Extend ClientItemDrag with an explicit ground destination using the real hit
  element and viewport marker. Avoid interpreting every null inventory target as ground.
- [x] Allow contents, real carried bags, and equipment-slot sources to drop to ground.
  Synthetic main-pack/focus entries and action bindings are not droppable objects.
- [x] Allow ground drop under every inventory sort mode; audit existing preview-result
  and release guards so they do not classify ground as a positional inventory move.
- [x] Preserve cancellation on Escape, pointer cancellation, blur, and lifecycle changes;
  suppress trailing selection/use clicks after a drag. Revalidate stale source ownership.
- [x] Exclude panels, HUD controls, and outside-app releases. Dropping over a rendered
  entity within the viewport still means ground drop, not give/use/container transfer.
- [x] Keep pointer-rate state imperative. Compose dependencies in existing app owners;
  do not move viewport policy into shared crates or grow a second drag subsystem.

Acceptance: each supported source produces one ground-drop intent on viewport release;
overlay/outside release produces none; action-bar gestures still edit bindings.

## Phase 4 — Verification and cleanup

- [x] World tests: dynamic loose object accepted; static, creature, Stuck, pending,
  owned, contained, and equipped-elsewhere objects rejected; fact changes republish.
- [x] Core tests: root capacity, fallback pack order, pack slots, incomplete/full storage,
  equipped drop with full inventory, changed ownership, and exact single wire requests.
- [x] Runtime tests: standalone requests do not claim global interaction ownership;
  protected sequences still reject conflicts and stop unsent steps on failure/timeout;
  late authoritative updates still apply after local abandonment.
- [x] Frontend tests: targeting precedence, pickup versus ordinary use, sorted inventory,
  equipment drops, stale previews/sources, cancellation, and action bindings.
- [x] Extend existing browser inventory probes with actual pointer drags onto viewport,
  overlay, and outside targets, including equipment sources and delayed authority updates.
  Verify no accidental world click/use follows release and no optimistic disappearance.
- [x] Check live-probe prerequisites and record limitations. The user owns visual/live
  interactive acceptance; retain automated synthetic browser coverage and do not run the TUI.
- [x] Sweep retired single-request tracking terminology, fields, notices, and tests.
  Inspect net production sLOC and justify new abstractions by named consumers.
- [x] Run appropriate Rust tests, cargo fmt checking, and clippy with warnings denied
  for touched crates and the host. In apps/holtburger-3d use existing npm scripts for
  test:ts, check, lint:ts, lint:dead, build, and harness:browser as applicable.

Do not retain tests dependent on unchecked-in runtime assets. No commits or staging
unless separately requested.

## Definition of done

- [x] Ground interaction attempts pickup only through the shared objective rule.
- [x] Destination selection reuses core allocation and handles unavailable capacity honestly.
- [x] Inventory, bag, and equipped viewport drops use one server-owned DropItem operation.
- [x] Single-request inventory actions do not acquire a completion-wait interaction lock.
- [x] Dependent sequences remain protected and correctly handle late updates and failures.
- [x] Authoritative inventory/scene updates and failure feedback remain intact.
- [x] Relevant unit, type, lint, build, and browser checks pass; limitations are documented.
- [x] Cleanup is complete and final behavior matches the agreed scope above.

## Resolved implementation decisions

- `world::interaction::pickup_candidate` returns the known source to core, avoiding
  a second lookup and an unreachable missing-source error after successful admission.
  Independent placement intent, non-null landcell, and absent storage membership
  establish ground placement without waiting for renderer assets.
- Only `PackExchange` retains inventory continuation state. It releases ownership
  when sending its second insertion. Removed move/merge/split confirmation variants,
  unused split metadata, and standalone completion notifications.
- Equipment still waits between peace/unequip/wield steps when later work depends on
  them. `SendFinal` explicitly releases the owner when sending a standalone/final wield
  or combat restoration. No restoration-acknowledgment stage remains.
- Shared entity projection publishes `canPickUp`; existing host commands carry the
  extended intent/preview types without a new adapter service. Frontend world
  interaction reads that fact, while submission revalidates through the shared rule.
- The viewport canvas is the exact ground destination; an inset outline keeps its
  preview visible. Existing native-sort guards explicitly exempt ground drops.
- No major blocker or scope expansion was required. No queue or reservation system
  was introduced. Net production nonblank lines decreased by 54, excluding harnesses,
  test files, and Rust test modules.

## Verification record

Completed on 2026-09-14:

- `cargo test -p holtburger-core -p holtburger-world --lib --quiet`:
  446 core tests and 799 world tests passed. The existing network test required
  loopback permission; the sandbox-only run failed with EPERM before binding.
- `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings` passed.
- `cargo fmt --all --check` and `git diff --check` passed.
- App `npm run test:ts`: 294 files / 2,362 tests passed.
- App `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run build` passed.
- Targeted Prettier formatting applied to changed app files.
- `npm run harness:browser -- --client-hud --brief` passed with actual CDP pointer
  events, including ground, equipped, and bag drops; sorted inventory; overlay/outside
  exclusion; authoritative display; preview freshness; and click suppression.
  The harness needed permission for its loopback server and browser.
- Packet-capture regression decodes exactly one PutItemInContainer to the allocated
  fallback pack and one DropItem for an equipped source, with no intermediate unequip.
- Publication regression covers pickup eligibility across Stuck changes, attachment,
  independent-position restoration, and inventory ownership changes.
- The live probe exits with `HOLTBURGER_PROBE_ACCOUNT must be set; credentials are
  never accepted as arguments.` Both account and password environment variables are
  absent. The user explicitly owns visual and interactive acceptance.

Build advisories: Vite reports its large-chunk advisory; Cargo reports a binrw
future-compatibility notice. TypeScript lint and clippy have no project diagnostics.

Review covered world eligibility/projection, core planning/submission and all changed
operation gates, unchanged host passthrough, browser validation, ordinary interaction,
drag preview/release, and server failure publication. Updated `docs/inventory.md` and
core architecture guidance to remove the retired confirmation model. Server execution
and visual appearance remain the user-owned acceptance boundary below.


## User-owned visual and interactive acceptance

These gates are intentionally left to the user and are not claimed as completed by
fixture-based automation:

- [ ] Interact with loose loot, including a usable item: it attempts pickup before use.
  Doors/creatures/Stuck scenery retain ordinary interaction. Active use-on-target
  mode still applies the source item to the selected target.
- [ ] Fill the main pack and pick up into a bag; check full-inventory failure feedback.
- [ ] Drag an inventory stack, carried bag, and equipped item onto the viewport.
  Confirm whole-object drops near the character, including equipped drop with full bags,
  and that a selected item stays selected through the ownership/ground-placement updates.
- [ ] Check the viewport drop outline and cancellation over UI or outside the window.
- [ ] Try another action while approaching loot: no client inventory-pending lock.
  Server busy/restriction errors remain possible. Confirm a failed drop keeps the item.
- [ ] Exercise equipment replacement and a pack exchange to confirm their dependent
  steps remain ordered, including combat restoration when appropriate.


### Follow-up: preserve selection across drop placement gaps

The selection owner now retains an existing authoritative identity while its placement
is unavailable. ACE clears container/wielder ownership before publishing ground placement;
that intermediate state previously cleared selection. Distance checks resume when placement
is available, and authoritative removal/lifecycle exit still clears selection. No drop timer,
pending operation, or automatic reselection was added. Selection unit tests and the browser
inventory probe cover separate ownership-removal and ground-placement updates for both
carried and equipped sources.

Follow-up verification: 2,364 TypeScript tests passed, app type checks and ESLint
passed, and the automated client-HUD browser probe reported
`dropSelectionPreserved: true`. Visual/live acceptance remains user-owned.

### Follow-up: select the inventory drag source

The frontend selects contents, carried bags, and equipped items when the drag
threshold is crossed. Pointer press alone does not select; repeated drags do not
toggle selection off. Cancellation and rejection retain the source selection.
Action-bar binding drags and use-with-target clicks preserve entity selection.
The drag owner cancels target acquisition before selecting and submits no action
until release. The selection owner validates the source against current facts.

Verification: 2,364 TypeScript tests, type checking, ESLint, and the complete
HUD browser probe passed. Browser checks cover selection at drag start,
cancellation, ground drops, and selection-neutral action-bar binding drags.
Visual/live interactive acceptance remains user-owned.

## Final code-quality review — 2026-09-14

Boundary: accumulated feature diff against HEAD, including this plan and the
selection/refusal follow-ups. The pre-existing ACE submodule change is excluded.

Confirmed finding (fixed before commit): the selected-entity HUD derived
canInteract solely from use capability, so its Interact button remained disabled
for pickup-only loot despite the controller accepting pickup. The HUD now reads
the published canPickUp fact. A regression covers enabling and retiring that
permission without unrestricted use. The allocator module description was also
updated to name its new pickup consumer.

Seams inspected:

- World pickup_candidate -> ClientEntityFacts -> core publication -> host payload
  -> TypeScript mirror -> interaction controller and selected-entity HUD.
  Submission independently rechecks current authority through the same predicate.
- Inventory intent -> lifecycle validation -> host command dispatch -> core planner
  and allocator -> wire submission; preview sequences -> drag release validation.
  Host submission acknowledges queuing, not successful server execution.
- Pack exchange and equipment continuation -> authoritative storage/equipment
  updates -> revalidation, rejection, timeout, lifecycle cancellation and final send.
  Renamed operation gates and retired vocabulary were searched across apps/crates.
- Drag threshold -> app callback -> validated selection; target acquisition
  cancellation, action-bar binding origins, trailing click suppression, and
  selection maintenance through ownership loss and unavailable ground placement.
- ACE inventory refusal -> core ActionResult retaining GUID/reason -> 3D host
  neutral notice -> lifecycle event -> toast. Reasonless rollback packets are
  intentionally silent; transport failures and timeouts retain warnings.

No remaining blocking findings in these paths. Shared world/core policies remain
separate from app gesture and notice policy. Reusing allocation and deleting
standalone completion tracking offsets the new behavior: final production
nonblank line delta is -16, excluding Rust test modules, frontend test files and
browser harnesses. No new queue, reservation cache, or renderer selection tracker
was introduced.

Accepted tradeoffs: capacity is an authoritative snapshot, not a reservation;
overlapping requests may be rejected. Unavailable placement retains selection
without a timer. Neutral inventory notices omit item identity by UX policy;
core consumers still receive it. Server-side execution beyond the inspected ACE
paths, real asset appearance, and live interactive acceptance remain user-owned.

Review-fix verification: all eight selected-entity tracking tests, app type checks,
ESLint, cargo formatting and diff whitespace checks passed. Earlier feature-wide
Rust/TypeScript tests and Clippy results above remain applicable; the review fix
changes only the HUD affordance plus comments/documentation. The final automated
HUD browser probe is recorded below after completion.

Final HUD browser probe passed, including drag selection, pickup/drop, binding
behavior, placement-gap selection retention, and neutral inventory refusal notices.
