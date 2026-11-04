---
title: 'Selection & interaction'
description: 'Keep your eyes on the world. Let Smart Tab do the searching.'
section: '3D client · Movement & interaction'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Start with Smart Tab

**Tap Tab to cycle targets. Hold it to acquire the immediate target.** Use Shift+Tab to cycle in reverse; holding it also acquires the immediate target.

Use Smart Tab for everyday targeting. Your stance, fellowship and targeting settings affect what it selects. Attack or interact after choosing your target.

Use the hostile-only and in-view options to narrow what Smart Tab selects.

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

These are separate actions:

- **Select** something to make it your current target.
- **Interact** with R to use it, pick it up, or begin the appropriate interaction.
- **Examine** with E for appraisal details. Right-clicking an object or item also selects and examines it.

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

**N cycles resting kneel/crouch → sit → lie down → stand.** This is a resting posture, distinct from the social kneel emote.

<Media id="posture-diagram" />

## Camera and text input

Drag with the left mouse button to look around. With mouse steering enabled, hold the right button to turn your character and tilt the camera. Hold the middle button or both buttons to move forward.

You can keep using movement keys after clicking ordinary HUD buttons. While typing or using a dialog, those keys go to that control instead.

Change bindings and mouse preferences under **Settings → Input**. These are Holtburger defaults, so expect your retail muscle memory to need some adjustment.

<Media id="camera" />
