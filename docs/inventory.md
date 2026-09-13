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

`inventory_runtime.rs` serializes requests with equipment operations. It waits for
accepted destination/quantity consequences, and confirms the first pack move and
the target's expected intermediate position before sending the second. A merge
requires both the destination increase and source decrease/removal. Timeout is an
uncertain outcome: the outstanding server request may still complete.

Splits use `StackableSplitToContainer` (`0x0055`), carrying the source GUID,
destination container GUID, signed native placement, and positive amount. The
UI amounts include the current total quantity; that amount resolves to a no-op
before capacity allocation and sends no server command. Actual splits leave a
nonempty source. ACE's `Player_Inventory.cs`
`DoHandleActionStackableSplitToContainer` creates and contains the new identity
before reducing the source quantity. The inventory owner confirms both the new
identity at the planned destination and the expected source remainder.

`inventory_storage.rs` shares capacity allocation between splits and equipment
replacement. It reserves currently free positions in the preferred source
container, then main pack, then remaining containers in native pack order.
Fallback containers are inspected only as needed; unhydrated required storage
rejects preflight rather than being treated as empty.

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
split-to-wield requires a new equipped identity and the expected source remainder.
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

In non-native sort modes, contents cells can be dragged onto equipment slots or
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
