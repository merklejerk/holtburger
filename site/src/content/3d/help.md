---
title: '3D client help'
description: 'Connection, game data, graphics and reporting problems.'
section: '3D client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
import Media from '#lib/components/Media.svelte';
</script>

## Cannot connect

Check the server address, port and account in the [launcher](/holtburger/startup/launcher/). Holtburger is developed against ACE; GDLE compatibility is unverified.

On Windows, if Play returns you to the launcher with `host exited before completing the protocol` and `code=3221225781`, follow the [missing-DLL recovery steps](/holtburger/start/3d/windows/#host-exits-with-code-3221225781).

<IllustratedProse name="black-hills">

## Before the game opens

Open the launcher's gear button → **App settings** for process-wide graphics choices. Apply changes with **Save and restart**. These choices are separate from the graphics controls inside the game.

| Setting                                     | What it controls                                                                                                    | Windows default |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------- |
| Graphics backend                            | The graphics API used by the browser runtime. Automatic lets it choose; Windows also offers OpenGL and Direct3D 11. | OpenGL          |
| Synchronize frames with the display (VSync) | Requests frame synchronization with the display.                                                                    | Off             |
| Use GPU compositing                         | Uses the GPU to combine interface surfaces for display. Turning it off can resolve flickering UI patches.           | Off             |

macOS and Linux default to Automatic with VSync and GPU compositing on. **Use defaults** restores the choices for your platform. Change one setting at a time and restart to compare results.

If the application will not open, start with the [installation guide for your platform](/holtburger/start/). It covers unsigned-download prompts, Linux runtime dependencies, and Flatpak folder access.

</IllustratedProse>

## Windows UI flickering

Intermittent transparent or missing patches have been observed on NVIDIA laptops, including in game panels, character selection, and the launcher logo. Turning off **Use GPU compositing** resolved the flicker in a reported on/off comparison; the underlying cause has not been established. Windows now defaults to this workaround, including when loading older app settings that have no compositing preference.

If you see this problem, open **App settings**, turn off **Use GPU compositing**, and choose **Save and restart**. If you previously added graphics flags to a shortcut, remove them before comparing saved settings; explicit launch overrides can take precedence. Changing VSync or switching to Direct3D 11 is not required for this workaround. Direct3D 11 can reduce frame rate on some systems, so retain OpenGL if it performs better.

If flickering continues with GPU compositing off, include **Copy hardware info** and a short recording in your report. A recording is more useful than a screenshot for a glitch that lasts only a frame. See the [Windows installation troubleshooting section](/holtburger/start/3d/windows/#troubleshooting) for other startup problems.

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

Open **App settings → Current graphics → Copy hardware info** in the launcher. The report includes the running Electron/Chromium versions, GPU details, and startup/saved graphics settings. Include it with the settings you changed and a screenshot or short recording showing the problem.

<Media id="hardware-info" />

## Report a problem

[Open a GitHub issue](https://github.com/merklejerk/holtburger/issues) with your version from `/version`, platform, reproduction steps, expected result and what happened. Add relevant errors, a screenshot or a short clip. Include server software for connection issues and **Copy hardware info** for rendering issues.

Remove account credentials and private messages from anything you attach.
