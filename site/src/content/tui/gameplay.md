---
title: 'Play through the terminal'
description: 'Use the dashboard lists and contextual actions to explore and manage your character.'
section: 'Terminal client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Nearby and movement

In **Nearby**, select an entity and read the footer actions. Use the offered interaction, approach, follow or combat action for that target. **Assess** opens its details.

`/scoot 3` moves approximately three metres forward. `/combat` toggles combat mode. Rest with `/kneel`, `/sit`, `/lie`, or `/stand`.

Movement is simplified: the terminal client does not locally simulate jumping, falling, gravity or stairs. Keep that in mind when following someone or supervising a script through difficult terrain.

## Inventory and equipment

Use **Inventory** to browse packs and carried items. Select the item, then use the footer for the available action: use, move, split, give, drop, or salvage. Multi-step actions update the footer with the next choice, such as a destination container or quantity.

**Equip** shows equipment and its available equip/unequip actions. Check the context details before changing gear or consuming an item.

## Spells and progression

In **Spells**, filter the list, select a spell, and use the offered casting action. Set the required target or self action as prompted.

**Character** contains character stats and improvement actions. Read the displayed cost before spending experience or training a skill.

## Trading and salvage

Use **Trade** for an active vendor or player trade. Review the offered items, quantities and confirmation actions before completing it.

Salvage actions prepare a batch for review. Check the items and stack quantities before confirming destruction.

<Media id="tui-gameplay" />

## Party and recovery

**Party** shows the roster and member actions. Commands such as `/create-party`, `/invite PLAYER`, and `/leave` are also available.

Use `/help death` for corpse recovery and permissions, and `/help ls` for lifestone recall. The [TUI command reference](/holtburger/reference/tui-chat-commands/) has the full command groups.
