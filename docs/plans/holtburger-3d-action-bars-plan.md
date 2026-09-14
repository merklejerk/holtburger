# Client action bars

Status: implementation and automated verification complete. Visual and
interactive acceptance is user-owned, per the implementation conversation.

## Goal and boundaries

Add configurable, keyboard-accessible action bars to the 3D client. The first
content type is a reference to player-owned equipment; activation equips that
item through the existing shared equipment replacement behavior.

This plan covers app-local state, layout, cells, pointer gestures, keyboard
ownership, and the narrow command integration needed for activation. It does not
add persistence, additional action types, an action plugin framework, inventory
item movement through action cells, or new equipment conflict rules. Configuration
is session-local. Do not implement a general persistent configuration strategy as
part of this work.

## Agreed behavior

### Bars, slots, and layout

- Keep between one and ten bars. Start with one horizontal bar at the bottom
  center edge of the client viewport.
- Every bar contains exactly ten numbered slots: `1` through `9`, then `0` for
  slot ten. Sparse bars are allowed. Empty slots never cause compaction or
  renumbering.
- Action cells look like inventory item cells but are separate components with
  separate semantics. Their content determines the action.
- Support two discrete shapes at the same cell size:

  | Orientation | Single            | Double                         |
  | ----------- | ----------------- | ------------------------------ |
  | Horizontal  | One row, `1–0`    | Two rows: `1–5`, then `6–0`    |
  | Vertical    | One column, `1–0` | Two columns: `1–5`, then `6–0` |

- Layout-unlocked resize gestures snap between single and double shapes. They
  do not add slots or freely stretch individual cells. Rotation preserves shape
  and content order. Placement and rotation are locked during normal play.
- Reuse the existing layout anchors, viewport containment, and unlock control.
  Bars remain present in normal play, independently of the inventory panel.
- Each bar has a numbered menu strip: on the left for horizontal bars and on
  top for vertical bars. It spans both rows/columns in the double shape and is
  included in the anchored layout extent. Keep the popup reachable near viewport
  edges. Layout move handles start after the strip so its full area remains clickable.
- The menu contains rotate, cycle, clone, and delete. Cycle and binding edits
  remain available while layout is locked. Implementation default: clone/delete
  also remain available while locked; the lock restricts geometry editing.
- Disable delete for the final bar and clone at ten bars. Do not hide these
  operations or silently exceed the limits.

### Sequence operations

Bar identity is stable; hotkey sequence is its position in the ordered collection.

- Cycle moves the selected bar one sequence forward, with wrapping, shifting
  affected bars. `[A, B, C]` becomes `[A, C, B]` when B cycles and `[C, A, B]`
  when C cycles. Cycle is disabled with a single bar.
- Clone inserts an independent copy immediately after the source, shifting later
  bars. Copy orientation, shape, and bindings; assign a new identity and find
  non-overlapping space inside the viewport, preferring adjacent placement.
  If no room exists, report the failure without creating a bar.
- Delete closes the sequence gap. Never maintain a second mutable sequence field.

### Binding and dragging

- Inventory item to action cell: bind or replace with that exact equipment item.
  Do not move or equip the inventory item. Only known, player-owned equippable
  items are admitted; unknown facts do not establish eligibility.
- Action cell to another action cell: atomically swap both contents, including
  empty destinations and destinations in other bars.
- Action cell to itself: no change.
- Action cell released anywhere other than another action cell: clear the source.
  This explicitly includes inventory, other panels, and unused viewport space.
  Do not turn these drops into inventory operations.
- Empty cells are targets, not drag sources. A click below the drag threshold
  activates; a completed drag suppresses click activation.
- Escape, pointer cancellation, or window blur cancels the gesture and preserves
  bindings. Lifecycle teardown also cancels without committing a drop.
- Commit edits only on a completed release. Do not clear a source at drag start.

### Activation and keyboard

- Clicking an occupied cell invokes its action.
- `Ctrl + 1–9/0` activates the corresponding bar and highlights its first slot,
  even if empty. `0` selects bar ten. Nonexistent sequences do not activate a bar.
- Use existing keyboard scope ownership. Editors and modals retain their current
  protections; activating a bar cancels held game input through that policy.
- For a single row use left/right; for a single column use up/down. For a double
  shape, navigate the visible grid with all four arrows. Wrap within the current
  row or column, preserving numbered gaps. Ignore irrelevant arrows on single
  shapes without passing them to movement.
- Enter activates the highlighted slot. A plain `1–9/0` activates that numbered
  slot directly. Both clear focus, including empty or rejected activations.
  Treat `Ctrl + digit` as a bar switch, not as a plain cell digit.
- Escape, viewport click, modal interruption, window blur, and lifecycle teardown
  cancel action focus. Switching bars starts at the new bar's first slot.
- Ignore repeat keydowns for activation; arrow navigation may repeat. Ensure a
  consumed key cannot also trigger a game command or native button activation.
- Already-equipped bindings are no-ops. Missing items retain an unavailable
  binding. Never substitute another item with the same name or template.
- Binding admission and runtime equipment admission are different: insufficient
  storage or server rejection can prevent activation of a valid binding. Use
  existing feedback and pending-operation behavior; never create a parallel
  browser-owned unequip/equip sequence.

## Ground truth and integration points

- `apps/holtburger-3d/src/client/ClientWorldView.svelte`: composition, current
  in-memory HUD layout, viewport geometry, and runtime/layout mode.
- `src/client/client-hud-layout.ts`, `ClientHudPanel.svelte`,
  `client-ui-contract.ts`, and `client-ui-defaults.ts` beneath the app: anchored
  geometry and layout affordances. Current layout keys describe fixed surfaces;
  dynamic bars should reuse placement primitives without inventing ten fixed keys.
- `src/app/ItemGridCell.svelte`, `ItemIcon.svelte`, and shared cell styling:
  appearance reuse. Inventory cells currently expose inventory-specific DOM
  identity and disable empty buttons, which must not dictate action-cell behavior.
- `src/client/client-item-drag.ts`: imperative pointer owner, drag ghost,
  preview correlation, and click suppression at the common world DOM boundary.
  Inventory intents and local action-cell edits remain separate outcomes.
- `src/client/client-inventory-state.ts` and `client-inventory-contract.ts`:
  current inventory facts and typed interaction boundary. An inventory equipment
  destination requires a mask; action activation passes an identity and side
  preference so shared equipment facts choose the concrete mask.
- `src/lib/input/keyboard-input-policy.ts`: scope activation, cancellation,
  editor/modal ownership, and quarantine of held keys across focus changes.
- `src/client/client-lifecycle-session.ts` and `host/src/client_runtime.rs`:
  typed session methods and host command dispatch. Trace the corresponding
  Electron bridge/capability declarations before extending this path.
- `crates/holtburger-core/src/client/equipment_plan.rs` and
  `equipment_runtime.rs`: existing storage allocation, blocking equipment
  removal, default slot selection, and execution lifecycle.
- `crates/holtburger-core/src/client/types.rs` and `commands.rs`: existing
  `GetAndWield` command path; verify its admission and already-equipped behavior
  before choosing it as the narrow host adapter target.
- `src/harness/browser/ClientHudHarness.svelte`, `client-inventory-probe.ts`,
  and `keyboard-policy-fixture.ts`: existing browser verification surfaces.

Paths beginning `src/` above are relative to `apps/holtburger-3d/`.
Current code is the integration authority. If equipment semantics need to change,
prove the requirement against ACE/ACViewer and the retail decompile as applicable;
do not infer new rules or modify the retail decompile.

## Design principles

- Keep action-bar policy and representations app-local. Shared core owns game
  semantics; no bar IDs, hotkeys, or layout shapes cross into shared crates.
- Use a typed content union with only the implemented equipment variant and an
  explicit empty slot. Derive the action from content rather than storing a
  separately mutable action tag. Add future variants only with actual consumers.
- Store stable bar identity, orientation, shape, placement, and ten slot contents.
  Derive sequence and grid coordinates once at their owning layer. Avoid storing
  an independent size that can disagree with shape and cell dimensions.
- Keep focus as a single optional bar/slot selection. Keep transient drag state
  imperative; only completed edits and bounded display updates enter Svelte state.
- Resolve bindings from retained player state independently of whether inventory
  is mounted. Retain identity when unavailable; release icon resources on teardown.
- Extend or extract the current drag owner into one app-local item/binding gesture
  owner. Use typed source and destination variants, not competing global listeners
  or action cells masquerading as inventory cells. Preserve inventory previews,
  sorted-view restrictions, split dialogs, and pending-operation protections.
- Reuse visual primitives and styles without introducing a universal cell or
  drag framework. Measure the final line impact and remove replaced paths.

## Implementation phases

### 1. State model and discrete geometry

- [x] Add focused app-local action-bar state/types and pure collection operations.
- [x] Add stable identities, ten sparse slots, bounds, sequence movement, clone,
      and delete. Clone contents must be independently editable.
- [x] Add shape-to-grid, dimensions, rotation, resize snapping, menu-strip geometry,
      and viewport placement helpers; put adjustable dimensions in frontend tuning.
- [x] Define transient focus and lifecycle reset behavior. Reset the collection
      for a new character/session so bindings cannot leak across characters.
- [x] Test collection bounds, sequence permutations, sparse swaps, clone
      independence, geometry, with test-owned inputs. Strip appearance remains part of user visual acceptance.

Acceptance: pure operations preserve ten slot positions, one-to-ten bars, unique
identity, and contiguous sequences; geometry matches all four agreed shapes.

### 2. Visible bars and layout integration

- [x] Add `ActionCell.svelte` and a client action-bar component using existing
      cell artwork/styling and the HUD placement primitives.
- [x] Compose a dynamic bar collection in `ClientWorldView.svelte` with the
      default bottom-center placement and visible sequence/slot labels.
- [x] Implement popup menu, limit-disabled operations, unlocked movement,
      unlocked rotation, and snapping resize. Place clones without overlapping existing bars.
- [x] Make unavailable and empty states distinct; ensure empty cells remain drop
      targets. Supply accessible names and selection cues.
- [x] Exercise resizing, rotation, and lock integration in the browser harness.
      Constrained bars retain fixed cell size and scroll instead of losing slots.
- [ ] User acceptance: all corners, small viewports, and layout-control reachability.

Acceptance: bars remain mounted with inventory closed. Automated checks cover
menu operations and discrete geometry. User acceptance covers visual reachability
in small viewports; scrolling preserves all slots without changing bar shape.

### 3. Equipment binding, pointer transfers, and execution

- [x] Trace the full existing equipment command and feedback path. Reuse default
      slot resolution; add only the necessary typed host/session adapter if absent.
- [x] Resolve icon, label, ownership, and equippable availability independently
      of the inventory panel. Revalidate on release and activation.
- [x] Refactor the existing drag owner for inventory sources and action-binding
      sources, with explicit inventory, action-cell, and outside drop outcomes.
- [x] Implement inventory binding, atomic cross-bar swaps, same-source no-op,
      outside clearing, cancellation, and post-drag click suppression.
- [x] Preserve the exact binding during pending equipment operations; use the
      shared busy/error behavior for repeated activation. Verify the already-worn
      no-op before dispatch so an action cannot accidentally unequip it.
- [x] Test unavailable items, invalid inventory sources, replacements, sparse
      transfers, swaps, clearing over panels, and cancelled gestures.
- [x] Verify a blocking-equipment activation uses the shared ordered runtime and
      reports storage/admission failure without attempting a browser-side workaround.

Acceptance: binding operations send no inventory mutation commands; activation
uses shared equipment behavior; all release/cancel outcomes match the contract.

### 4. Keyboard ownership and integration review

- [x] Register scope activation for `Ctrl + 1–9/0`, using current sequence order.
- [x] Implement numbered activation, geometric arrows, wrapping, Enter, Escape,
      focus cue, and repeat handling with one owner for the active bar/slot.
- [x] Cancel stale focus on deletion, blur, modals, and teardown; reconcile
      focus with bar identity through cycle and geometry changes.
- [x] Verify switching bars, text editing, held movement, native button defaults,
      inventory modal interaction, and consumed key release behavior in a browser.
- [x] Reassess the integrated design: one drag owner, one keyboard owner, no
      duplicated equipment semantics, and no reliance on inventory mounting.

Acceptance: `Ctrl + 1`, then `3` activates exactly one slot; arrows follow every
shape including gaps; scope transitions cannot leak movement or stale activation.

### 5. Cleanup and final verification

- [x] Remove replaced drag paths, obsolete selectors, and unused adapters/types.
      Review vocabulary so action content is not mislabeled as inventory movement.
- [x] Review added line count and abstraction cost; retain only behavior needed
      by the actual first-cut consumers.
- [x] Run appropriate focused tests with `npm run test:ts -- ...`; run app
      `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and formatting checks.
      Format touched files only using the project's formatter configuration.
- [x] If Rust changes, run affected tests and `npm run check:rust` plus
      `npm run lint:rust`; treat warnings as errors.
- [x] Use `npm run harness:browser -- ...` for a noninteractive integrated
      browser check, extending synthetic fixtures as needed. Do not run the TUI.
- [x] Record actual checks, limitations, and relevant screenshots in this plan.
      Do not retain tests requiring untracked runtime assets.

## Risks and mitigations

- A pointer release is destructive to the binding anywhere outside action cells.
  This is intentional user policy. Preserve cancellation and the drag threshold;
  make dragging visible and never interpret a cancelled gesture as a release.
- Expanding drag ownership can disturb inventory previews and modals. Keep typed
  outcomes separate and cover existing inventory gestures in browser regression
  checks, including sorted contents and split dialogs.
- Focus changes cancel movement by existing policy. Verify rather than adding a
  second movement routing path. Test browser/Electron delivery of Ctrl+digit so
  shell accelerators cannot consume the required sequences unnoticed.
- A valid equipment reference can become unavailable or fail admission later.
  Retain the reference, show its unavailable state, and let core revalidate.
- Two-dimensional bars add geometry and navigation policy. Use one canonical
  slot/grid mapping for rendering and navigation; no hand-maintained copies.
- No persistence means reload/session replacement loses customization. This is
  the accepted first-cut limitation, not a reason to add configuration storage.

## Definition of done

- [x] Agreed bar, drag, activation, keyboard, and layout behaviors are implemented.
- [ ] User visual/interactive acceptance, including live equipment replacement.
- [x] Action cells are distinct from inventory cells while sharing appearance.
- [x] Equipment execution uses existing shared conflict/storage/runtime behavior.
- [x] Session-local configuration and lifecycle teardown are explicit and safe.
- [x] Focused tests and real browser interaction checks pass; relevant static
      checks pass without ignored warnings.
- [x] No speculative future-action framework or persistence work was introduced.

## Remaining implementation decisions

No implementation blocker was encountered. Resizing grows toward the viewport
center. The menu strip follows orientation. Clone spacing and resize/menu tuning live in
`client-tuning.ts`. Small viewports scroll fixed-size cells. Clone/delete remain
available while locked; rotation, movement, and resizing require unlocking.

## Execution record

Implemented the action-bar collection, separate action cells, discrete grid
geometry, scope-based keyboard interaction, and the equipment identity/side command.
`ClientItemDrag` replaces the former inventory-only owner without an alias. It
runs at the common world DOM boundary; inventory and action binding destinations
remain separate typed outcomes.

Code review consolidated equipment eligibility, kept item/artwork reads coherent,
and removed hidden inventory sorting from action-bar display sampling. A player
identity change in a replacement snapshot also retires session-local bindings.

Browser verification found and resolved three integration issues: the old dummy
keyboard fixture competed for Ctrl+1; a sort revision could retire newly issued
merge hints; and focused-scope Escape handling could prevent drag cancellation.
The dummy fixture now uses Ctrl+F8, initial drag hints capture their source view,
and gesture Escape cancellation runs through the keyboard policy before scope
handling. Transient action scopes end on blur and are not restored after modals.

Automated evidence:

- 42 focused TypeScript tests pass across action state/grid, equipment eligibility,
  inventory state, lifecycle command routing, and keyboard policy.
- 15 shared equipment planner/runtime tests pass, including storage admission and
  confirmed blocking-item removal before wielding.
- The host MessagePack equipment-identity command test passes.
- App Svelte/TypeScript checks, ESLint, unused-code checks, and host all-target
  Clippy with denied warnings pass at the recorded checkpoint.
- The integrated browser HUD harness passed with the action-bar probe plus existing
  inventory and keyboard regressions. Its action probe covers binding without game
  mutation, typed equip activation, sparse/cross-bar transfers, outside clearing,
  focused Escape cancellation, cycling, mandatory final bar, discrete resize,
  rotation, grid navigation, and blur cancellation.
- Final post-cleanup automated run passed: `npm run harness:browser -- --client-hud`
  (log: `/tmp/action-bars-final-harness.log`). Final type/lint checks and touched-file
  Prettier/Rust formatting checks also pass.

### User acceptance checklist

The user volunteered to own visual and interactive acceptance. These checks are
handoff work, not claims that the agent performed live-server or visual signoff:

- Check bottom-center appearance, cell art, numbered side strips, popup placement,
  and overlap with the rest of the HUD in both themes and small windows.
- Move/rotate/resize unlocked bars through all four shapes. Confirm locked geometry,
  cloning/cycling/deletion through ten bars, and Ctrl+0 addressing bar ten.
- Try direct clicks, two-step hotkeys, sparse navigation, blur/modals, and drag
  cancellation. Drag occupied cells onto each other and onto inventory/viewport.
- Bind actual equipment, trigger a blocking-item replacement, and inspect busy,
  storage-full, missing-item, already-equipped, and server-rejection behavior.

Configuration remains session-local and is intentionally lost on session/character
replacement. No persistence or future-action framework was added. No files were
staged or committed.

### Menu-strip refinement

Replaced the floating corner menu button with the supplied side-strip design:
left for horizontal bars, top for vertical bars, spanning the entire cross-axis.
The strip shows the sequence number and opens the existing popup. Its extent is
included in layout anchoring, and unlocked move handles are inset past it.
Automated strip geometry assertions cover the default row and both double shapes.
Visual/interactive acceptance remains user-owned.

Refinement verification passed: app type checks, ESLint, unused-code checks,
touched-file formatting, and the integrated HUD browser harness with strip
alignment assertions (`/tmp/action-strip-harness.log`).

Strip spacing is theme-owned through `--ui-action-bar-strip-gap` (base default
`4px`). A CSS-sized measurement element keeps anchored dimensions and layout
handles synchronized with live theme changes, including relative length units.
The TypeScript gap setting and inline override were removed.

### Clone placement refinement

Cloning tries above/below horizontal bars and beside vertical bars, then searches
nearby free space against every mounted action bar. The layout owner supplies
current resolved bounds and natural dimensions, including theme lengths. The
search preserves existing bars and the clone's natural size (limited only by the
viewport). If no space exists, report the failure without adding a bar. The
minimum spacing lives in `CLIENT_ACTION_BAR_TUNING.cloneGap`.

### Action activation side preference

Shift at activation requests off hand for eligible hand-held equipment; ordinary
activation requests main hand. Ineligible off-hand requests retain main hand.
For rings and bracelets, Shift forces right; without Shift, choose left if free,
right if only left is occupied, and left when both are occupied. Reapply this
policy on every activation, including items already worn. Other equipment keeps
its ordinary location. Clicks, Enter, and digit shortcuts carry the same
preference; shifted digits use physical key codes. The frontend sends intent,
while core's `PreferredSide` target resolves eligibility through existing
equipment facts and replacement planning. Moving already-worn items retains
conflict removal and same-slot no-op handling.

### Configurable action-bar input

`INPUT_DEFAULTS.actionBars` now owns numbered focus and cell bindings, spatial
navigation, confirm, cancel, and the alternate-side modifier. Numbered entries
are zero-based positions: 0 addresses bar/cell 1 and 9 addresses bar/cell 0.
Bindings accept either layout-resolved `key` values or physical `code` values;
physical digit codes preserve activation under Shift. The UI consumes semantic
navigation and activation through `APP_INPUT`, while keyboard scopes retain
ownership and bar-focus chords take priority over cell activation. Alternate-side
state is resolved identically for clicks and keys. Standard global Escape
cancellation remains part of the shared keyboard policy.

### Final accumulated-diff quality review

Boundary: the complete action-bar feature against HEAD, including untracked
components/tests, the inventory-drag replacement, common input changes, and the
client-to-core equipment seam. ACE and ACViewer worktrees are unrelated.

Contract coverage:

- `ActionCell` / `ClientActionBar` -> `APP_INPUT` -> keyboard scopes: numbered
  activation, modifier intent, focus switching, cancellation, and native button
  ownership; compared mapped key/code behavior with held movement consumers.
- `ClientActionBars` -> `ClientItemDrag` -> inventory preview/submission: local
  swaps/clears versus authoritative inventory commands, correlated late replies,
  source removal, Escape/blur, and lifecycle cancellation.
- Inventory baseline -> action display -> icon repository: coherent owned-item
  reads, persistent/display leases, post-DOM release, pending state, and replacement
  character identity. No raw producer-rate snapshots enter reactive UI state.
- Bar geometry -> clone search -> HUD anchors and layout controls: source-natural
  size, viewport-relative bounds, no-room outcome, and reserved menu-strip extent.
- Session `equipItem` -> command allowlists -> MessagePack host dispatch -> core
  `PreferredSide` planning and equipment runtime: identity and alternate preference
  survive unchanged; rejection, storage allocation, confirmed displacement,
  same-slot no-op, and already-worn jewelry re-selection remain core-owned.
- Popup consumer -> shared popup -> keyboard scope/top layer: disabled commands,
  menu activation, outside/trigger dismissal, resize, and teardown were inspected.

Fixed findings:

- P2: moving the drag listener to the world root caused unrelated pointer downs to
  build inventory presentation. Hit admission now precedes inventory reads, and
  the previous gesture view has no idle lifetime.
- P2: mixed key/code maps were rejected without proof of an actual layout conflict.
  Static checks reject definite overlaps; runtime matching rejects ambiguous real
  events while allowing disjoint mixed bindings. Focus eligibility is checked
  before activation callbacks can initialize local state.
- P2: character resets reused the keyed first-bar identity and retained mounted
  focus/menu/drag state. Reset bars now receive fresh identities; the browser
  lifecycle probe checks that the outgoing surface is detached.
- P3: the strip tooltip still advertised a hardcoded Ctrl chord after remapping.
  It now describes the menu without claiming an obsolete binding. Moved drag
  styles retain their original component cascade layer.

Accepted tradeoffs: session-local configuration, equipment-only bindings, bounded
UI sampling, and a small local free-rectangle search. No persistence framework or
new shared drag framework is warranted. Visual and live-server acceptance remain
user-owned; protocol serialization, shared planning/runtime, and synthetic browser
interaction are the automated boundary of this review.

Final review validation: 2,332 TypeScript tests and 441 core tests passed. The host
MessagePack equipment command test, full browser HUD regression (including the
character-reset assertion), Svelte/TypeScript checks, ESLint, unused-code checks,
and core/host all-target Clippy with warnings denied also passed.
