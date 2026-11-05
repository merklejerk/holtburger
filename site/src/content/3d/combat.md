---
title: 'Targeting & fighting'
description: 'A new combat layout, with targeting and attack controls close at hand.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Your attack controls

Equip your weapon and press **Backquote (`)** to enter combat. Holtburger groups the familiar power/accuracy and attack-height choices into a compact, curved HUD:

- **The outer arc** sets melee power or missile accuracy. Drag it for a precise value, or choose a preset.
- **High / Medium / Low** inside the gauge selects attack height.
- **▶** starts attacking your selected target. While attacking, it becomes the pause control to cancel the attack; **Escape** also cancels.

With a missile weapon, ammunition supply appears alongside the attack control. In magic stance, use your [spellbook or spell bars](/holtburger/3d/spells/) to cast.

<Media id="combat-controls" detail />

<Media id="combat-controls-missile" detail />

## Use Smart Tab in combat

Tap **Tab** to cycle targets, or hold it to acquire an immediate target. **Shift+Tab** cycles in reverse. Use the hostile-only and in-view options to keep the selection useful for your current fight.

Choose your target, then start your attack or cast. Use the displayed key hints for power, height and spell shortcuts; the [full keymap](/holtburger/reference/3d-controls/#combat-and-bars) covers each stance.

<Media id="smart-tab" />

## Use the selected-entity HUD

The selected-entity HUD keeps the name, health bar and relevant actions together. The magnifying glass opens [inspection](/holtburger/3d/inspecting/).

Open **Selected entity actions** beside the name for actions suited to your selection. A player can offer Tell, Trade or Invite to party; an item can offer Split stack or Salvage.

<Media id="selected-hud" detail />

## Keep track of your target

A bold outline traces your selected creature or object, making it easier to pick out in a crowd than retail’s corner reticle. A separate combat reticle marks the target you are actively attacking or casting at, so you can distinguish selection from the ongoing fight.

<Media id="target-indicators" />

## Fight on the move

Keep running while casting or firing a bow. Movement continues through the windup with your normal movement controls—no sliding key combinations to learn. Reposition between enemies or keep your distance while attacking.

<Media id="run-casting" />

<Media id="moving-archery" />

## Pick something specific

Click a particular object when you know what you want, or find it in the [Nearby list](/holtburger/3d/nearby/). Use **R** to interact and **E** to examine; right-clicking also selects and examines.

[Inspection is separate from selection](/holtburger/3d/inspecting/): keep an appraisal open while you move on to another target. For looting, the [controls reference](/holtburger/reference/3d-controls/#select-and-interact) includes dedicated object and unopened-corpse cyclers.

## Between fights

Use [loadouts](/holtburger/3d/equipment-loadouts/) for planned gear changes, and ready your [spell bars](/holtburger/3d/spells/) for the next encounter.
