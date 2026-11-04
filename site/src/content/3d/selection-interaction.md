---
title: 'Selection & interaction'
description: 'Keep your eyes on the world. Let Smart Tab do the searching.'
section: '3D client · Movement & interaction'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Start with Smart Tab

Use Smart Tab for everyday targeting: cycle to compare targets, or acquire an immediate target and get straight to your next action.

Your stance and fellowship affect the selection. Use the hostile-only and in-view options to narrow it further.

| Action                       | Default control       |
| ---------------------------- | --------------------- |
| Cycle combat targets         | Tap Tab               |
| Cycle in reverse             | Tap Shift+Tab         |
| Acquire the immediate target | Hold Tab or Shift+Tab |
| Select yourself              | X                     |
| Interact with selection      | R                     |
| Examine selection            | E                     |

<Media id="targeting-diagram" />

<Media id="smart-tab" />

## Select, use, examine

- **Select** a target for your next action.
- **Interact** to use it, pick it up, or start a conversation.
- **Examine** for appraisal details. Right-clicking an object or item also selects and examines it.

The appraisal window stays on the object you examined, even when you select something else.

## When to use another selector

Click something when you know exactly what you want. Use these keys to cycle through objects or unopened corpses:

| Looking for      | Forward  | Reverse        |
| ---------------- | -------- | -------------- |
| World objects    | Ctrl+Tab | Ctrl+Shift+Tab |
| Unopened corpses | V        | Shift+V        |

## Your first-session controls

| Action                    | Default control        |
| ------------------------- | ---------------------- |
| Move forward / backward   | W / S                  |
| Turn left / right         | A / D                  |
| Strafe left / right       | Z / C                  |
| Walk                      | Hold Shift             |
| Toggle autorun            | Q                      |
| Charged jump              | Hold and release Space |
| Precise jump mode         | Ctrl+Space             |
| Toggle combat             | Backquote (`)          |
| Cycle resting postures    | N                      |
| Open chat                 | Enter                  |
| Cancel the active context | Escape                 |

Rest between fights to recover health and stamina faster. The posture cycle moves through kneeling → sitting → lying down → standing, with lying down giving the fastest recovery.

<Media id="posture-diagram" />

## Camera and text input

[Camera controls](/holtburger/3d/movement-camera/#look-around-or-steer) let you look around freely or steer your character with the mouse.

You can keep using movement keys after clicking ordinary HUD buttons. While typing or using a dialog, those keys go to that control instead.

Change bindings and mouse preferences under **Settings → Input**.

<Media id="camera" />
