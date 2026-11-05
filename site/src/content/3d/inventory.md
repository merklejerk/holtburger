---
title: 'Inventory & equipment'
description: 'Keep your packs organized and useful items within reach.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## See your packs together

Inventory puts your main pack and bags in one scrolling view, with a heading for each bag. Click a pack icon to jump straight to its contents instead of opening bags one at a time.

Cycle the sort control through **Native**, **Alphabetical**, and **Item type** to find things within each bag. Sorting changes the view without moving your items; return to **Native** when arranging their actual order.

<Media id="inventory-overview" detail />

## Equipment at a glance

The equipment strip keeps worn gear beside your pack contents. Hover a slot to dim items that cannot go there; drag an item to narrow the strip to compatible slots. Drop it onto a slot to equip it, or drag worn gear back into a bag to unequip it.

Helmet and cloak visibility controls sit below the strip, alongside **Create loadout** for [saved gear swaps](/holtburger/3d/equipment-loadouts/).

<Media id="equipment-strip" detail />

## Move items

- Drag an item onto a compatible stack to merge them.
- In **Native** sorting, drag an item onto another item to place it before that item when they cannot merge.
- In **Native** sorting, drag items to pack headers to move them between packs.

You can also reorder ordinary packs. Main Pack stays first and spell foci stay last.

## Split a stack

Select the stack and press **Y**, or use **Split stack** in the selected-item actions. Choose the amount using the number field or slider.

Leave a free inventory slot for the new stack.

<Media id="inventory-split" detail />

## Auto-merge a bag

Open the bag's context menu and choose **Auto-merge** to combine its compatible stacks. Check the completion feedback for changes and freed slots.

Auto-merge applies to the chosen bag when requested. If it stops after merging some stacks, those completed merges remain in place; inspect the bag before retrying.

<Media id="inventory-merge" detail />

## Loot and world containers

Select a container or corpse and press **R** to open it. Use its contents to move items into your inventory. **V** cycles unopened corpses; **Shift+V** cycles in reverse.

Use [Smart Tab and interaction](/holtburger/3d/combat/) for the rest of the selection controls, or [item actions](/holtburger/3d/inventory/) to examine and give what you find.

For locked doors and containers, use the [key and lockpick helper](/holtburger/3d/locks/). To clear unwanted gear, [sell it](/holtburger/3d/trading/#buy-or-sell-at-a-vendor) or [salvage it](/holtburger/3d/crafting/#salvaging-items).

## Use or pick up

Select something and press **R** to interact. For a loose item, that means picking it up; for an item you carry, it can mean using or equipping it. Containers and other world objects open their relevant interaction.

Some items need a target. Activate the item first, then choose what to use it on. Follow the targeting prompt; **Escape** cancels.

## Examine

Open an [appraisal](/holtburger/3d/inspecting/) to check an item’s requirements, combat values, effects and inscriptions. It stays open while you select something else.

## Give an item

1. Select the person or NPC receiving the item.
2. Select the item you want to give.
3. Press **G** and review any confirmation.

Holtburger remembers the selected recipient while you browse items, so you can choose another item without selecting the recipient again. Check the recipient shown before confirming.

For an exchange of offers, use [player trading](/holtburger/3d/trading/#trade-with-another-player).

To hand over part of a stack, [split it first](/holtburger/3d/inventory/#split-a-stack).

## Keep frequently used items close

Drag usable items onto an [action bar](/holtburger/3d/equipment-loadouts/) for quick access. Use [equipment loadouts](/holtburger/3d/equipment-loadouts/) when you want to change several slots together.
