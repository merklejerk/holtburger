---
title: '3D client help'
description: 'Connection, game data, graphics and reporting problems.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Cannot connect

Check the server address, port and account in the [launcher](/holtburger/startup/launcher/). Holtburger is developed against ACE; GDLE compatibility is unverified.

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

Check the [game-data folder](/holtburger/startup/game-data/). That guide includes a DAT download if you need the files. `/assets` shows the current content location.

Use `/assets retry` to retry failed loading after a temporary problem. If you replace mounted archives or repair the installation itself, restart with the repaired folder.

## Report a rendering problem

Choose **Copy hardware info** in the launcher's graphics settings. Include it with the version, platform, settings you changed and a screenshot showing the problem.

<Media id="hardware-info" />

## Report a problem

[Open a GitHub issue](https://github.com/merklejerk/holtburger/issues) with your version from `/version`, platform, reproduction steps, expected result and what happened. Add relevant errors, a screenshot or a short clip. Include server software for connection issues and **Copy hardware info** for rendering issues.

Remove account credentials and private messages from anything you attach.
