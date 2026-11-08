---
title: 'Coming from retail?'
description: 'The changes to know, and the tools you no longer need a plugin for.'
section: '3D client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
</script>

## Get your bearings

Holtburger’s UX, rendering and physics take their own direction. The game knowledge carries over, but expect a different feel to movement, management, and interaction.

<IllustratedProse name="qalabar">

## What's new or different?

| Area                     | What changes in Holtburger                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup & characters     | [Import servers from TreeStats](/holtburger/startup/launcher/), save account profiles and use [per-server DAT folders](/holtburger/startup/game-data/). The [character builder](/holtburger/startup/characters/#create-a-character) previews skills and vitals live alongside your allocations.                                                                     |
| HUD & controls           | A [new HUD layout](/holtburger/3d/) with relevant actions beside your selection, rebindable controls and a rest-posture cycler. [Arrange and theme it](/holtburger/3d/interface/) with separate UI/text scaling and window opacity.                                                                                                                                 |
| Targeting & inspection   | [Smart Tab](/holtburger/3d/combat/#use-smart-tab-in-combat) combines cycling and immediate acquisition. A bold outline shows selection through obstructions; a separate reticle marks active combat. [Appraisals](/holtburger/3d/inspecting/) include rotatable creature/player models.                                                                             |
| Combat & movement        | [Compact, unobtrusive combat HUDs](/holtburger/3d/combat/) keep power/accuracy and height visible without taking retail’s screen space, with keyboard shortcuts for adjustments. Run-cast and shoot through windups using normal movement controls. [Precise jumping](/holtburger/3d/movement-camera/#precise-jumping) previews power and trajectory before launch. |
| Inventory & shortcuts    | [Combined, sortable packs](/holtburger/3d/inventory/), an equipment strip, currency totals and bag auto-merge. [Action bars](/holtburger/3d/action-bars/) mix supplies, tools and [selected-slot loadouts](/holtburger/3d/equipment-loadouts/); consumables find replacements and targeted items default to self-use.                                               |
| Spells & character stats | [Search/filter spells](/holtburger/3d/spells/), organize shortcut tabs or cast from the list. Search enchantments by spell or stat, grouped by affected stat and sortable by expiry. [Expanded progression details](/holtburger/3d/character/) show skill contributions and bonuses.                                                                                |
| Maps & discovery         | [Terrain and dungeon minimaps](/holtburger/3d/maps-travel/) with elevation, buildings and breadcrumbs. World-map overlays show contracts, housing and waypoints; minimap markers guide you to destinations. [Nearby searches and name alerts](/holtburger/3d/nearby/) help find encounters.                                                                         |
| Chat & social            | [Click-through chat](/holtburger/3d/chat/) preserves playable space, with command autocomplete, clickable coordinates/entity alerts and an emote wheel. [Social](/holtburger/3d/community/) groups party, friends, allegiance and ignores; the party HUD keeps teammate vitals visible.                                                                             |
| Tools & crafting         | [Keys and lockpicks](/holtburger/3d/locks/) get an integrated helper. [Crafting and salvage](/holtburger/3d/crafting/) offer success-chance confirmation and mixed-material salvage estimates. Giving remembers your recipient while you browse items.                                                                                                              |
| Housing & contracts      | [Housing](/holtburger/3d/housing/) combines map searches, payment auto-fill and home management. The [Journal](/holtburger/3d/journal/) adds search, status filters, repeat timers and mapped destinations.                                                                                                                                                         |
| Character appearance     | [Live in-world barbershop previews](/holtburger/3d/appearance/) and helmet/cloak visibility toggles conveniently beside your equipment.                                                                                                                                                                                                                             |

</IllustratedProse>

## Make it yours

[Layout & theming](/holtburger/3d/interface/) covers movable HUD components, independent UI and text scaling, window opacity, fonts and themes.

These tools are built in. Existing Decal plugins and profiles cannot be imported.

## Plugins, scripts and automation

h3d prioritizes streamlined, active play. It has no plugin system yet; plugins and scripting are planned, with automation among their intended uses.

The [terminal client](/holtburger/tui/) already supports JavaScript and bundled fighter/mage scripts. It is the preferred form factor for macros and bots without running a full 3D client. Trade and buff services need scripts tailored to those tasks.
