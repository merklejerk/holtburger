---
title: 'Action bars'
description: 'Put items and equipment changes where you can reach them.'
section: '3D client · Items & equipment'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Fill a bar

Drag a usable item from inventory onto an action cell. Drag the result from **Create loadout** onto a cell to save an [equipment loadout](/holtburger/3d/equipment-loadouts/).

Click a filled cell to activate it. Right-click an item-backed cell to examine its item.

## Use the keyboard

Press **Ctrl+1** through **Ctrl+0** to focus a bar. While that bar is focused, **1–0** activates its ten cells. You can also move between cells with the arrow keys and press **Enter** to activate the focused cell.

Number keys are used elsewhere for spells and combat, so focus the intended bar before using its cell shortcuts. Change bindings in **Settings → Input**.

## Arrange and manage

You can keep up to ten action bars, with ten cells each. Use the bar menu:

| Action | Use it to                               |
| ------ | --------------------------------------- |
| Clone  | Make another copy to arrange separately |
| Cycle  | Change the bar's place in the sequence  |
| Clear  | Remove its cell bindings                |
| Delete | Remove the bar                          |

Layout controls let you move and rotate bars. The last bar cannot be deleted.

<Media id="action-bars" />

## Consumables

A consumable binding can switch to an equivalent item in your inventory when the original is exhausted. Keep replacements on hand and check feedback if a binding cannot be used.

Rebind equipment and rebuild loadouts when you replace their saved items.

Action-bar contents and loadouts are saved per character. Spell tabs have their own [spell bar](/holtburger/3d/spells/).
