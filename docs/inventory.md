# Inventory and equipment

## Authoritative state

`holtburger-world` owns containment, native ordering, and equipment relationships in
`src/state/storage.rs`. Consumers use `WorldState::storage_location`,
`container_contents`, `player_equipment`, and `storage_coverage`. Relationships may
arrive before entity descriptions; a missing description or pending native position
must not be interpreted as an empty slot.

A contained item has a parent GUID and an item-domain or pack-domain position.
Containers and foci share the pack domain. Equipment has a wearer and an equipment
mask. Accepted inventory, wield, and property messages update these relationships;
frontends never rewrite them optimistically after issuing a request.

## Native move and merge semantics

ACE `WorldObjects/Container.cs` is the reference for removal and insertion:
removal decrements later indices in the same domain, and insertion increments
indices at or after its destination. The item and pack domains shift independently.

`holtburger-core/src/client/inventory_plan.rs` resolves identity-based requests:

- An item target merges compatible stacks, otherwise inserts before the target's
  current native position after accounting for source removal.
- A stack-only target permits merging without authorizing positional movement.
- A container target appends after the highest remaining native index. Explicit
  full-container drops fail; they do not redirect to another container.
- A pack target exchanges two real carried containers. Main-pack and focus entries
  cannot be swapped. The first request moves the source to the target's original
  index; the second moves the target to the source's original index. This restores
  intervening positions, including foci, and works with sparse native indices.

Moves use `PutItemInContainer` (`0x0019`): source GUID, destination container GUID,
and native placement. The same request unequips an equipped source. Merges use
`StackableMerge` (`0x0054`): source GUID, destination GUID, and an explicit positive
quantity. Core limits the quantity to available destination capacity; a full
compatible stack falls through to positional movement for an item target, while
merge-only targeting rejects it. Overflow remains
on the source. Positions and amounts are checked against the server's signed
32-bit range before submission.

`inventory_runtime.rs` sends standalone moves, merges, splits, pickups, and drops
without retaining a completion-wait interaction lock. Server updates remain the
source of truth; overlapping requests can be rejected by the server.
Only a dependent pack exchange retains an inventory operation owner: it confirms
the first move and the target's expected intermediate position before sending the
second, then releases ownership. Protected equipment sequences and pack exchanges
exclude conflicting local requests while a continuation remains. Timeout abandons
unsent continuation steps; it sends no cancellation, and late server updates still apply.

Splits use `StackableSplitToContainer` (`0x0055`), carrying the source GUID,
destination container GUID, signed native placement, and positive amount. The
UI amounts include the current total quantity; that amount resolves to a no-op
before capacity allocation and sends no server command. Actual splits leave a
nonempty source. ACE's `Player_Inventory.cs`
`DoHandleActionStackableSplitToContainer` creates and contains the new identity
before reducing the source quantity. Both changes arrive through ordinary world-state
updates; the client does not wait for them to release an interaction lock.

`inventory_storage.rs` shares capacity allocation between pickup, splits, and equipment
replacement. It reserves currently free positions in the preferred source
container, then main pack, then remaining containers in native pack order.
Fallback containers are inspected only as needed; unhydrated required storage
rejects preflight rather than being treated as empty.

## Pickup and ground drop

World's `interaction::pickup_candidate` admits known, dynamic, non-creature objects
without Stuck that have independent ground placement and no storage relationship
or player ownership. The shared entity projection exposes `canPickUp`; this is
permission to attempt pickup, not a guarantee against server restrictions.
Core rechecks the same rule at submission and allocates main-pack space first,
then carried packs in native order, respecting separate item and pack slots.
Pickup appends with one `PutItemInContainer`; internal `Get` is merely a fixed
main-pack/placement-zero convenience for that same wire action.

Ground drop uses one `DropItem` with the source GUID. ACE `Player_Inventory.cs`
`HandleActionDropItem` accepts carried and equipped sources and handles dequipping
directly, so dropping equipment needs no spare inventory slot. Whole stacks and
bags remain whole objects. The server chooses placement near the character;
the protocol has no cursor-position field. Attunement, busy state, and other
server restrictions still produce ordinary action failure feedback.

In the 3D client, ordinary world interaction prefers pickup for an eligible object;
active use-on-target acquisition keeps precedence. Contents, real carried bags,
and equipment cells can be dragged onto the viewport canvas under every sort mode.
Panels, HUD controls, and outside-app releases are not ground destinations. An
entity under the cursor does not turn the gesture into give/use/container transfer.
Action-bar dragging continues to edit bindings rather than dropping objects.
Crossing the drag threshold with contents, a carried bag, or equipment selects
the source without toggling it off or activating it. Cancellation or rejection
keeps that selection. Binding-origin drags and use-with-target clicks preserve
entity selection.
The 3D host presents server inventory refusal reasons as neutral notices, without
an inventory-failure prefix or item GUID. Reasonless inventory rollback packets
do not produce a notice: ACE also sends them after separate explanatory feedback.
Core retains the complete result and identity.
Selection follows the retained identity across ownership and placement updates.
A temporary lack of ground placement during a drop does not clear it; authoritative
entity removal, lifecycle exit, or an established out-of-range position still does.

## Equipment replacement

`holtburger-world/src/equipment.rs` resolves public equipment semantics. Apparel
uses complete allowed coverage and independent clothing-priority conflicts.
Jewelry selects one allowed side. Hand conflicts use retail public combat-use,
ammo-type, and caster facts; known appraisal weapon skill refines legacy two-handed
weapons whose allowed-location mask still says melee.

References are retail `acclient.c:378448` (`BlocksUseOfShield`) and `380111`
(`AutoWearIsLegal`), plus ACE `WorldObject.cs` and `Player_Inventory.cs`. ACE's
private default combat style is not generally supplied through appraisal. Public
prediction therefore does not guarantee server admission: server-only requirements
or classification can still reject the final wield.

`holtburger-core/src/client/equipment_plan.rs` plans one assignment and allocates
storage for all displaced entities before issuing any command. It prefers the
incoming item's container, then the main pack, then carried containers in native
order. It does not credit the slot that the incoming item will free later.

`equipment_runtime.rs` owns peace transitions, confirmed unequips, final wield,
and combat restoration. It revalidates the remaining plan between requests. A
split-to-wield requires a new equipped identity and the expected source remainder
before any dependent combat restoration. Ownership ends when the final request is
sent; a standalone wield does not wait merely to announce completion.
Manual combat changes cancel pending equipment orchestration. Failures stop further
requests without rolling back confirmed changes. Existing action feedback reports
partial changes and uncertain timeouts.

Both the TUI and 3D client delegate equipment commands to this owner. There is no
frontend equipment executor or speculative multi-item loadout API.

## 3D interaction boundary

The 3D panel owns pointer gestures, sort preferences, and temporary eligibility
previews. Semantic preview requests and submissions cross the narrow host boundary
and use the same core evaluator. Sequences discard obsolete preview replies;
submission re-evaluates against current world state.

Right-clicking a stack with quantity greater than one requests split preflight.
Only a successful preflight opens the inventory-local amount dialog; no capacity
produces the existing warning toast. Inventory contents are inert while it is
open, but other panels and the viewport remain available. Submission rechecks
quantity and capacity, and Escape or Cancel closes without sending a split.
Electron's browser context menu is removed globally; Ctrl+Shift+I toggles DevTools.

In non-native sort modes, contents cells can be dragged onto the ground, equipment slots, or
compatible stacks, but cannot perform positional moves or header appends.
During these drags, core merge-only previews identify contents cells to leave
undimmed; incompatible and full stacks remain dimmed. Equipment candidates use
the existing compatibility hint. Merge hints refresh on inventory view changes
and are retired when the drag ends; the drop still requires a fresh preview.
Equipped items remain draggable: dropping on a contents cell or container header
appends to that container's native order, with no implicit merge or positional insertion.
A full destination is rejected rather than redirected. Pack swaps still use native
indices. The pack strip shows the main pack, real containers
in native order, foci in native order, then unused capacity.

After submission the panel renders authoritative host state. It does not subscribe
to operation progress or retain an execution lifecycle. Panel closure cancels only
the gesture; core continues an already submitted operation independently.

Rejected drops and transport failures use the existing application toast component.
Hover previews only highlight targets and displaced equipment; the panel has no
separate status or error message surface.
