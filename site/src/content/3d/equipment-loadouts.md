---
title: 'Equipment loadouts & action bars'
description: 'Keep gear swaps and frequently used items ready.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Capture your current gear

1. Equip the items you want in the loadout.
2. In **Inventory**, choose **Create loadout**.
3. Check the slots this loadout should change.
4. Optionally choose a name and icon.
5. Drag the result icon onto an action-bar cell to save it.

## Choose what changes

| Slot in the builder   | Result when activated |
| --------------------- | --------------------- |
| Checked, with an item | Equip that item       |
| Checked, empty        | Unequip that slot     |
| Unchecked             | Leave that slot alone |

For example, include only your weapon slots to swap weapons while leaving your armor and jewelry untouched. Include an empty slot when the gear change should explicitly clear it.

<Media id="loadouts" detail />

## Activate and check

Activate the saved action-bar cell to apply the loadout. If an item is missing or a change fails, read the feedback and check your equipment. Other changes may already have succeeded.

Loadouts are saved with that character's action bars. Keep required items in your inventory, and rebuild a loadout when you replace one of its captured items.

## Fill a bar

Drag a usable item from inventory onto an action cell.

Click a filled cell to activate it. Right-click an item-backed cell to examine its item.

## Use the keyboard

Press **Ctrl+1** through **Ctrl+0** to focus a bar. While that bar is focused, **1–0** activates its ten cells. You can also move between cells with the arrow keys and press **Enter** to activate the focused cell.

See the [controls reference](/holtburger/reference/3d-controls/#combat-and-bars) to look up or customize bar bindings.

## Arrange and manage

You can keep up to ten action bars, with ten cells each. Use the bar menu:

| Action | Use it to                               |
| ------ | --------------------------------------- |
| Clone  | Make another copy to arrange separately |
| Cycle  | Change the bar's place in the sequence  |
| Clear  | Remove its cell bindings                |
| Delete | Remove the bar                          |

Layout controls let you move and rotate bars. The last bar cannot be deleted.

<Media id="action-bars" detail />

## Consumables

A consumable binding can switch to an equivalent item in your inventory when the original is exhausted. Keep replacements on hand and check feedback if a binding cannot be used.

Rebind equipment and rebuild loadouts when you replace their saved items.

Action-bar contents and loadouts are saved per character. Spell tabs have their own [spell bar](/holtburger/3d/spells/).
