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

For h3d, choose the folder containing your retail DATs. [Game data & launch settings](/holtburger/startup/settings/) includes a download if you need the files.

For the terminal client, extract the full release bundle. Retail DATs alone do not replace its prepared navigation data.

## Graphics or startup trouble

The launcher's App settings controls the graphics backend and display synchronization. In-game graphics settings control presentation such as view distance and render scale.

Use **Copy hardware info** from the launcher graphics settings when reporting rendering trouble. Include your client version, platform, reproduction steps and what happened.

<Media id="hardware-info" />

[More graphics and startup help](/holtburger/support/graphics/).

## A script will not start

Enter the world before using `/run`. Use `/scripts` to check the active script, local directory and discovered names. A local script overrides a bundled one with the same basename.

For the mage, keep the bundled data sidecars with the script. See [running scripts](/holtburger/tui/running-scripts/) for file layout and [runtime limits](/holtburger/tui/scripting/runtime/) if a custom script expects Node or Deno APIs.

## Report a problem

[Report a problem](/holtburger/support/reporting/) with the version, reproduction steps and relevant evidence. Remove account credentials from screenshots and logs before attaching them.
