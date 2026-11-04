---
title: 'Spells & enchantments'
description: 'Find spells, prepare your bars, and see which effects count.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Find a spell

Open **Spells** to browse the spells your character knows. Type part of a name, or expand **Filters** to narrow by school, level, damage type, beneficial/harmful effect, target type, or fellowship.

You can select several choices in a category. For example, choosing two schools shows either school; adding a level restricts both to that level. **Reset** clears the search and filters.

Select a spell's name to expand its details: description, mana, range, duration where applicable, and formula components.

## Cast from the list

Enter magic stance, choose the appropriate target, and press **Cast** beside the spell. If Cast is disabled, check your stance and the spell's details.

For targeted spells, use [Smart Tab](/holtburger/3d/combat/) to select your target, or **X** to select yourself.

## Build your spell bars

Drag a spell from the list into a spell-bar cell. Use the tabs to group spells for different tasks. There are ten tabs; the first ten positions on each tab have keyboard shortcuts, with room for additional cells beyond them.

The spell bar supports single and double display layouts. Its spell bindings follow the character; the display shape is a general interface preference.

<Media id="spells" />

## Casting without a selection

Supported non-Life projectile spells can fire forward when you have no selection. Face where you want to cast. Life spells and other targeted spells still need their normal target.

## Read your current effects

Open **Enchantments** to inspect active spells and their remaining time. Effects are grouped by the stats they affect.

The beneficial and harmful effect trays reflect effects currently contributing to your stats. Vitae appears with harmful effects.

## Effective and overridden

A spell can still be present while a stronger effect overrides it. Expand an effect's overridden-spell group to see those other spells and their durations.

Use this when you want to know why a familiar buff is not changing a stat, or what may remain after another effect expires.

<Media id="enchantments" />

## Find the effect you need

Search by spell or stat name and use the filters to narrow the list. The sort control cycles between **Name**, **Power, strongest first**, and **Duration, soonest first**.

Sort by duration to see what is running out. Use **Reset** to clear your search and filters.
