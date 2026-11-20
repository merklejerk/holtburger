---
title: 'Finding creatures & objects'
description: 'Find something specific nearby, or get an alert when a name you are watching appears.'
section: '3D client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
import Media from '#lib/components/Media.svelte';
</script>

## Narrow the nearby list

Click **Nearby entities and alerts** on the minimap’s lower-left rim, or press **Ctrl+F**, to open the entity list.

<Media id="nearby-button" detail />

Search names and use the category, tracked-name and sorting controls to reduce the list to what you need.

Select a result to make it your current target, then [inspect it](/holtburger/3d/inspecting/) or interact using your usual [target controls](/holtburger/3d/interactions/#pick-something-specific). For everyday combat selection, [Smart Tab](/holtburger/3d/combat/) is usually the quicker starting point.

<Media id="nearby-list" detail />

## Select by name from chat

Use `/scan NAME` to select a nearby creature or object without opening the list. For example, try `/scan diamond golem`. Abbreviations such as `/scan dmnd glm` work too.

The best name match wins; equally good matches select the nearest. If nothing matches, chat shows **No entity found** and keeps your current selection.

See the [chat commands reference](/holtburger/3d/chat-commands/#select-by-name) for command syntax.

<IllustratedProse name="olthoi">

## Add a name alert

Use the name-alert control on a nearby entry for an exact match, or create a rule in the alert editor. Choose how the name should match:

| Match      | Example          | Matches                              |
| ---------- | ---------------- | ------------------------------------ |
| Exact name | `Drudge Prowler` | That full name                       |
| Substring  | `Drudge`         | Names containing that text           |
| Name glob  | `Drudge *`       | A full name beginning with `Drudge ` |

Matches ignore capitalization. In a glob, `*` matches any text and `?` matches one character. Use a backslash to match a literal `*`, `?`, or backslash.

Check the editor's preview against nearby names, then save the rule.

</IllustratedProse>

## Spot matching encounters

When an entity matches an enabled alert rule, h3d highlights it across chat, the minimap, and the 3D scene:

- **Chat alert:** Click the linked name in chat to select the creature or object. Hold **Control** (**Command** on macOS) while clicking, or enable [chat-history interaction](/holtburger/3d/chat/#use-links-in-chat).
- **Minimap marker:** Matching entities appear as a star on the minimap.
- **Nameplate star crest:** Matching entities show a star above their nameplate across Minimal, Smart and Always nameplate modes, remaining readable at distance and through walls or dungeon rooms.
- **In-scene beacon:** Entities in direct line of sight are ringed by a glowing 3D light cylinder rising from their base—tall outdoors to spot over terrain and compact indoors in dungeons and buildings.

<Media id="alert-indicator" detail />

## Manage your alerts

Enable or disable individual rules as needed, and delete rules you no longer use. Rules are saved for the character. Choose patterns specific enough that notifications and beacons stay useful.
