---
title: 'Interactions'
description: 'Select, use, loot and give, with relevant actions beside your selection.'
section: '3D client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
import Media from '#lib/components/Media.svelte';
</script>

## Pick something specific

Click a particular object when you know what you want, or find it in the [Nearby list](/holtburger/3d/nearby/). Use **R** to interact and **E** to examine; right-clicking also selects and examines.

You can also select by name with [`/scan NAME`](/holtburger/3d/nearby/#select-by-name-from-chat), such as `/scan diamond golem`.

For looting, the [controls reference](/holtburger/3d/controls/#select-and-interact) includes dedicated object and unopened-corpse cyclers.

## Use the selected-entity HUD

The selected-entity HUD keeps the name, health bar and relevant actions together. The magnifying glass opens [inspection](/holtburger/3d/inspecting/).

Open **Selected entity actions** beside the name for actions suited to your selection. A player can offer Tell, Trade or Invite to party; an item can offer Split stack or Salvage.

<Media id="selected-hud" detail />

## Use or pick up

Select something and press **R** to interact. For a loose item, that means picking it up; for an item you carry, it can mean using or equipping it. Containers and other world objects open their relevant interaction.

Some items need a target. Activate the item first, then choose what to use it on. Follow the targeting prompt; **Escape** cancels.

<IllustratedProse name="drudge">

## Loot and world containers

Select a container or corpse and press **R** to open it. Use its contents to move items into your inventory. **V** cycles unopened corpses; **Shift+V** cycles in reverse.

For locked doors and containers, use the [key and lockpick helper](/holtburger/3d/locks/). To clear unwanted gear, [sell it](/holtburger/3d/trading/#buy-or-sell-at-a-vendor) or [salvage it](/holtburger/3d/crafting/#salvaging-items).

</IllustratedProse>

## Give an item

1. Select the person or NPC receiving the item.
2. Select the item you want to give.
3. Press **G** and review any confirmation.

Holtburger remembers the selected recipient while you browse items, so you can choose another item without selecting the recipient again. Check the recipient shown before confirming.

For an exchange of offers, use [player trading](/holtburger/3d/trading/#trade-with-another-player).

To hand over part of a stack, [split it first](/holtburger/3d/inventory/#split-a-stack).
