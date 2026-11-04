---
title: 'Finding creatures & objects'
description: 'Find something specific nearby, or get an alert when a name you are watching appears.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Narrow the nearby list

Open **Nearby** to browse entities around you. Search names and use the category, tracked-name and sorting controls to reduce the list to what you need.

Select a result to make it your current target, then examine or interact with it using your usual [target controls](/holtburger/3d/combat/#pick-something-specific). For everyday combat selection, [Smart Tab](/holtburger/3d/combat/) is usually the quicker starting point.

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

## Manage your alerts

Enable or disable individual rules as needed, and delete rules you no longer use. Rules are saved for the character.

Alerts notify you about matching nearby encounters without repeating the same notice continuously. Choose patterns specific enough that the notifications stay useful.
