---
title: 'Spells & enchantments'
description: 'Prepare your spell bar, cast on the move and keep track of your enchantments.'
section: '3D client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
import Media from '#lib/components/Media.svelte';
</script>

## Cast from your spell bar

Select a target by clicking it or using [Smart Tab](/holtburger/3d/combat/); **X** selects yourself. In magic stance, click a spell or press **1–0** to cast from the displayed tab.

<Media id="spell-bar" detail />

| Default shortcut | Action                                           |
| ---------------- | ------------------------------------------------ |
| **1–0**          | Cast the corresponding cell; **0** is the tenth. |
| **Shift+1–0**    | Switch spell tabs.                               |
| **Ctrl+Shift+1** | Cast your wielded caster’s spell.                |

### Set up your bar

Drag spells from **Spells** into cells. Use the ten tabs to group your regular casts, with shortcuts for the first ten cells on each tab. Choose a single or double display layout to fit your HUD.

<Media id="spells" detail />

Spell bindings are saved per character. Customize shortcuts in **Settings → Input**.

<IllustratedProse name="olthoi">

## Browse your spellbook

The Character shortcut pulses when you learn a new spell.

Search by name or combine filters for school, level, damage type and targeting. Select a spell’s name for its description, mana cost, range and components.

Unlike retail, you can **cast directly from the list**. In magic stance, select your target and press **Cast** beside a spell—useful for an occasional cast you have not put on a bar.

</IllustratedProse>

<Media id="spell-list" detail />

## Cast on the move

Keep moving through spell windups with your normal controls. Reposition without retail’s sliding key combinations.

<Media id="run-casting" />

Supported non-Life projectile spells can also fire forward without a selection. Face where you want to cast; Life spells and other targeted spells still need their normal target.

## Read your current effects

Open **Enchantments**, or click a buff/debuff tray icon, to inspect active effects grouped by the stats they affect. Vitae appears with harmful effects.

Search by spell or stat name and filter the list. Sort by **Name**, **Power** or **Duration**; duration puts the effects expiring soonest first.

<Media id="enchantments" detail />
