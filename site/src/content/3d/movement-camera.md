---
title: 'Movement & camera'
description: 'Move your character, look around, and get comfortable with the defaults.'
section: '3D client · Movement & interaction'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Get moving

| Action              | Default control        |
| ------------------- | ---------------------- |
| Forward / backward  | W / S                  |
| Turn left / right   | A / D                  |
| Strafe left / right | Z / C                  |
| Walk                | Hold Shift             |
| Toggle autorun      | Q                      |
| Charged jump        | Hold and release Space |
| Precise jump mode   | Ctrl+Space             |

**A and D turn; Z and C strafe.** These are Holtburger defaults. Change them under **Settings → Input** if you prefer another arrangement.

For a normal jump, hold Space to charge and release to leap. [Precise jumping](/holtburger/3d/jumping/) gives you a target and trajectory preview instead.

<Media id="movement-keys" />

## Look around or steer

- **Drag with the left button** to orbit the camera around your character.
- **Hold the right button** to steer your character and tilt the camera, with mouse movement enabled.
- **Hold the middle button or both buttons** to move forward, with mouse movement enabled.
- **Scroll** to zoom the camera.

Camera orbit lets you look somewhere without turning your character. Mouse steering turns the character as well.

<Media id="camera" />

## Rest with N

Press **N** to cycle through resting crouch/kneel → sit → lie down → stand. You can press again to advance to the next posture.

This is the resting kneel, separate from the social kneel emote.

<Media id="postures" />

## When keys go to the interface

Clicking an ordinary HUD button leaves movement keys available. While typing or using a dialog, those keys go to that control instead. Finish or leave that control before moving again.

Adjust bindings, mouse steering, and axis inversion under **Settings → Input**.

<Media id="input-settings" />

## Next

[Learn Smart Tab and interaction](/holtburger/3d/selection-interaction/) to select, use and examine what is around you.
