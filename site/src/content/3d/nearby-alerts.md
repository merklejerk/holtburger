---
title: 'Nearby lists & alerts'
description: 'Find something nearby, or ask Holtburger to notify you when its name appears.'
section: '3D client · Interface & chat'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Narrow the nearby list

Open **Nearby** to browse entities around you. Search names and use the category, tracked-name and sorting controls to reduce the list to what you need.

Select an entry when you want a particular target. For everyday combat selection, [Smart Tab](/holtburger/3d/selection-interaction/) is usually the quicker starting point.

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
