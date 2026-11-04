---
title: 'Equipment loadouts'
description: 'Save a gear change without replacing every equipped slot.'
section: '3D client · Items & equipment'
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

<Media id="loadouts" />

## Activate and check

Activate the saved action-bar cell to apply the loadout. If an item is missing or a change fails, read the feedback and check your equipment. Other changes may already have succeeded.

Loadouts are saved with that character's action bars. Keep required items in your inventory, and rebuild a loadout when you replace one of its captured items.

See [action bars](/holtburger/3d/action-bars/) for arrangement and keyboard use.
