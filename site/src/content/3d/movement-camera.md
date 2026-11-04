---
title: 'Movement & jumping'
description: 'Mouse steering and a preview for the jumps worth planning.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Look around or steer

Left-drag orbits the camera without turning your character. With mouse movement enabled, hold the right button to steer; hold the middle button or both buttons to move forward.

<Media id="camera" />

## Precise jumping

1. Press **Ctrl+Space** to enter precise jump mode.
2. Point at the place you want to jump toward.
3. Use **W** to increase power or **S** to decrease it. You can also adjust the power bar or use **Shift+scroll**.
4. Inspect the target and trajectory preview.
5. Click to launch the chosen jump. Press **Escape** to cancel instead.

<Media id="jump" />

## Read the preview

Adjust power until the path reaches your intended landing. Look for obstacles along the arc and leave room to land.

Holtburger's movement and physics have their own feel. Try a few low-risk jumps before relying on a familiar retail route.

<Media id="jump-demo" />

See the [controls reference](/holtburger/reference/3d-controls/) for other movement bindings, or adjust them in **Settings → Input**.
