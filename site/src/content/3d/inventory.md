---
title: 'Inventory & equipment'
description: 'Keep your packs organized and useful items within reach.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Browse your packs

Open **Inventory** and select a pack to see its contents. The equipment area shows what you are wearing; the summary shows your burden.

Use the sort control to cycle **Native**, **Alphabetical**, and **Item type**. Alphabetical and type sorting change the view, so switch back to **Native** when arranging your actual inventory order.

## Move and equip

- Drag an item onto a compatible stack to merge them.
- In **Native** sorting, drag an item onto another item to place it before that item when they cannot merge.
- In **Native** sorting, drag items to pack headers to move them between packs.
- Drag an item onto an equipment slot to equip it. Drag worn equipment back into contents to unequip it.

You can also reorder ordinary packs. Main Pack stays first and spell foci stay last.

<Media id="inventory-moves" />

## Split a stack

Select the stack and press **Y**, or use **Split stack** in the selected-item actions. Choose the amount using the number field or slider.

Leave a free inventory slot for the new stack.

## Auto-merge a bag

Open the bag's context menu and choose **Auto-merge** to combine its compatible stacks. Check the completion feedback for changes and freed slots.

Auto-merge applies to the chosen bag when requested. If it stops after merging some stacks, those completed merges remain in place; inspect the bag before retrying.

<Media id="inventory-merge" />

## Loot and world containers

Select a container or corpse and press **R** to open it. Use its contents to move items into your inventory. **V** cycles unopened corpses; **Shift+V** cycles in reverse.

Use [Smart Tab and interaction](/holtburger/3d/combat/) for the rest of the selection controls, or [item actions](/holtburger/3d/inventory/) to examine and give what you find.

## Use or pick up

Select something and press **R** to interact. For a loose item, that means picking it up; for an item you carry, it can mean using or equipping it. Containers and other world objects open their relevant interaction.

Some items need a target. Activate the item first, then choose what to use it on. Follow the targeting prompt; **Escape** cancels.

## Examine

Press **E**, right-click the item, or use the magnifying-glass action to open its appraisal. Look here for requirements, combat values, effects, descriptions and inscriptions.

The appraisal window stays on the item you examined when your selection changes. Examine another object to replace it. You can move and resize the window.

<Media id="item-appraisal" />

## Give an item

1. Select the person or NPC receiving the item.
2. Select the item you want to give.
3. Press **G** and review any confirmation.

Holtburger remembers the selected recipient while you browse items, so you can choose another item without selecting the recipient again. Check the recipient shown before confirming.

To hand over part of a stack, [split it first](/holtburger/3d/inventory/#split-a-stack).

## Keep frequently used items close

Drag usable items onto an [action bar](/holtburger/3d/equipment-loadouts/) for quick access. Use [equipment loadouts](/holtburger/3d/equipment-loadouts/) when you want to change several slots together.
