---
title: 'Inventory & containers'
description: 'Move items between packs, split stacks, and free up space.'
section: '3D client · Items & equipment'
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

You need space for the new stack. Holtburger tries the source pack first, then other available packs. Choosing the whole stack does not split it.

## Auto-merge a bag

Open the bag's context menu and choose **Auto-merge** to combine its compatible stacks. Check the completion feedback for changes and freed slots.

Auto-merge applies to the chosen bag when requested. If it stops after merging some stacks, those completed merges remain in place; inspect the bag before retrying.

<Media id="inventory-merge" />

## Loot and world containers

Select a container or corpse and press **R** to open it. Use its contents to move items into your inventory. **V** cycles unopened corpses; **Shift+V** cycles in reverse.

Use [Smart Tab and interaction](/holtburger/3d/selection-interaction/) for the rest of the selection controls, or [item actions](/holtburger/3d/items/) to examine and give what you find.
