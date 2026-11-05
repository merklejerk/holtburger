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

## Check your currencies

Hover over the pyreal total at the bottom of Inventory to see **Alternate currencies**. Holtburger totals currencies such as Mhoire Coins, venom sacs and trade notes across your packs—no hunting through bags or counting stacks as in retail.

<Media id="inventory-currencies" detail />

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

## Keep frequently used items close

Drag usable items onto an [action bar](/holtburger/3d/action-bars/) for quick access. Use [equipment loadouts](/holtburger/3d/equipment-loadouts/) when you want to change several slots together.
