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

Use [precise jumping](/holtburger/3d/jumping/) to plan a leap with a target and trajectory preview.

<Media id="movement-keys" />

## Look around or steer

- **Drag with the left button** to orbit the camera around your character.
- **Hold the right button** to steer your character and tilt the camera, with mouse movement enabled.
- **Hold the middle button or both buttons** to move forward, with mouse movement enabled.
- **Scroll** to zoom the camera.

<Media id="camera" />

## Rest between fights

Resting speeds up health and stamina recovery. Press **N** to cycle through kneeling → sitting → lying down → standing. Lying down gives the fastest recovery.

<Media id="postures" />

## When keys go to the interface

Clicking an ordinary HUD button leaves movement keys available. While typing or using a dialog, those keys go to that control instead. Finish or leave that control before moving again.

Adjust bindings, mouse steering, and axis inversion under **Settings → Input**.

<Media id="input-settings" />

## Next

[Learn Smart Tab and interaction](/holtburger/3d/selection-interaction/) to select, use and examine what is around you.
