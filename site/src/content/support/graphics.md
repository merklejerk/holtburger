---
title: 'Graphics & startup help'
description: 'Find the right settings, tune the view, and collect useful hardware details.'
section: 'Help · 3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Before the game opens

Use the launcher's **App settings** for the graphics backend and display synchronization. These choices are separate from the graphics controls inside the game.

If the application will not open, start with the [installation guide for your platform](/holtburger/start/). It covers unsigned-download prompts, Linux runtime dependencies, and Flatpak folder access.

## If the game runs slowly

Change one setting at a time so you can judge the result:

- Reduce **render scale** to draw fewer pixels, trading sharpness for speed.
- Reduce **view distance** to draw less of the world.
- Adjust shadows, ambient occlusion and weather to reduce scene work.

Use `/fps` to show the frame-rate display while comparing settings. Render scale above the normal resolution draws more pixels for a sharper result at a higher rendering cost.

## If content is missing

Check the [game-data folder](/holtburger/startup/settings/), particularly if the terminal client's compact content was selected by mistake. `/assets` shows the current content location.

Use `/assets retry` to retry failed loading after a temporary problem. If you replace mounted archives or repair the installation itself, restart with the repaired folder.

## Report a rendering problem

Choose **Copy hardware info** in the launcher's graphics settings. Include it with the version, platform, settings you changed and a screenshot showing the problem.

<Media id="hardware-info" />

[Report the problem](/holtburger/support/reporting/) with steps someone else can follow.
