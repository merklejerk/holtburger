---
title: 'Help on the road'
description: 'Start with the symptom. Keep your version and platform handy.'
section: 'Help'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Cannot connect

Check the server address, port and account. Holtburger is developed against ACE; GDLE compatibility is unverified.

## Game data is missing

For h3d, select a complete retail DAT folder or a supported full HBA archive. The compact terminal-client content is not sufficient for 3D rendering.

For the terminal client, extract the full release bundle. Retail DATs alone do not replace its prepared navigation data.

## Graphics or startup trouble

The launcher's App settings controls the graphics backend and display synchronization. In-game graphics settings control presentation such as view distance and render scale.

Use **Copy hardware info** from the launcher graphics settings when reporting rendering trouble. Include your client version, platform, reproduction steps and what happened.

<Media id="hardware-info" />

## Report a problem

[Open an issue on GitHub](https://github.com/merklejerk/holtburger/issues). Remove account credentials from screenshots and logs before attaching them.
