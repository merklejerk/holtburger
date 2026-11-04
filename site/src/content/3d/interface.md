---
title: 'Make the interface yours'
description: 'Arrange the HUD and keep useful information close.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Move and resize the HUD

Choose **Unlock UI layout** to edit the layout. Move the HUD elements and use the available resize controls, then choose **Lock UI layout** when finished.

Give frequently used controls comfortable positions before a fight. You can arrange windows and bars separately; leave room for chat, targeting and the world view.

If you want to start over, use **Settings → HUD layout → Reset HUD placements**.

<Media id="hud" />

## Scale controls and text separately

Use overall UI scale to change control sizes, and text scale to adjust readability. Start with the text size you can comfortably read, then fit the controls around it.

Appearance settings also let you choose fonts and themes. Traveler's Kit provides the leather-and-copper treatment used as inspiration for this site.

## Keep useful information visible

Vital warnings, progression feedback and the selected-target HUD help you notice changes without opening another panel. [Nearby alerts](/holtburger/3d/interface/) can call attention to names you are watching for.

Use `/fps` to toggle the FPS display when adjusting graphics. For startup or rendering trouble, see [Help](/holtburger/support/).

## Save the right things

Your preferences are saved on this computer. Action-bar contents, spell bindings and alert rules are saved separately for each character.

## Narrow the nearby list

Open **Nearby** to browse entities around you. Search names and use the category, tracked-name and sorting controls to reduce the list to what you need.

Select an entry when you want a particular target. For everyday combat selection, [Smart Tab](/holtburger/3d/combat/) is usually the quicker starting point.

## Add a name alert

Use the name-alert control on a nearby entry for an exact match, or create a rule in the alert editor. Choose how the name should match:

| Match      | Example          | Matches                              |
| ---------- | ---------------- | ------------------------------------ |
| Exact name | `Drudge Prowler` | That full name                       |
| Substring  | `Drudge`         | Names containing that text           |
| Name glob  | `Drudge *`       | A full name beginning with `Drudge ` |

Matches ignore capitalization. In a glob, `*` matches any text and `?` matches one character. Use a backslash to match a literal `*`, `?`, or backslash.

Check the editor's preview against nearby names, then save the rule.

<Media id="nearby-alerts" />

## Tune the list

Enable or disable individual rules as needed, and delete rules you no longer use. Rules are saved for the character.

Alerts notify you about matching nearby encounters without repeating the same notice continuously. Choose patterns specific enough that the notifications stay useful.
