---
title: 'Movement & jumping'
description: 'Mouse steering and a preview for the jumps worth planning.'
section: '3D client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
import Media from '#lib/components/Media.svelte';
</script>

## Look around or steer

Left-drag orbits the camera without turning your character. With mouse movement enabled, hold the right button to steer; hold the middle button or both buttons to move forward.

<Media id="camera" />

<IllustratedProse name="black-hills">

## Precise jumping

1. Press **Ctrl+Space** to enter precise jump mode.
2. Point at the place you want to jump toward.
3. Use **W** to increase power or **S** to decrease it. You can also adjust the power bar or use **Shift+scroll**.
4. Adjust power until the trajectory reaches your intended landing. Check for obstacles along the arc and leave room to land.
5. Click to launch the chosen jump. Press **Escape** to cancel instead.

Holtburger's movement and physics have their own feel. Try a few low-risk jumps before relying on a familiar retail route.

</IllustratedProse>

<Media id="jump-demo" />

See the [controls reference](/holtburger/3d/controls/) for other movement bindings, or adjust them in **Settings → Input**.
