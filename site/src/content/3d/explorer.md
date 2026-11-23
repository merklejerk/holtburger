---
title: 'World Explorer'
description: 'Fly across Dereth offline, spawn and pose entities, possess creatures, and inspect lighting and assets.'
section: '3D client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
import Media from '#lib/components/Media.svelte';
</script>

World Explorer is an offline mode built into Holtburger 3D. Use it to fly through Dereth without connecting to a server, stage scenes and screenshots, spawn and possess creatures, or inspect world lighting and game assets.

<Media id="explorer-showcase" />

<IllustratedProse name="danbys-outpost">

## Launch Explorer

1. Open the Holtburger launcher and select the **Explorer** tab.
2. Optionally enter a starting location—a landblock hex (`A9B4`), dungeon cell ID (`0xA9B40100`), or Dereth coordinates (`42.1N, 33.6E`). Leave it blank to start at `22S, 2W`.
3. Press **Launch Explorer**.

Explorer uses the same [game-data folder](/holtburger/startup/game-data/) as the 3D client. Release builds also bundle a compiled ACE-World weenie catalog (`weenies.hwc`) automatically so entity spawning works out of the box. Expand **Advanced** in the launcher if you want to override either path for a session.

Open the system menu with `Esc` to return to the launcher or quit.

</IllustratedProse>

## Fly and jump anywhere

Use the shortcut dock in the lower right to open floating panels. Explorer starts with a clean viewport; panels can be moved, resized, or arranged by unlocking the HUD layout from the corner controls.

Open **Navigation** for two ways to move around:

- **Location** shows your current scene and cell, a direct jump bar for coordinates, landblock IDs, or dungeon cell IDs, and the interactive world map. Click anywhere on the map to jump there, or drag to pan.
- **Camera** adjusts fly speed (`5`–`1000 m/s`), toggles whether audio follows the camera, and switches between **Frontend free fly** (noclip) and **Host physical fly** (collision-aware movement).

## Spawn, pose, and possess

Open **Entities** to search the weenie catalog by name, class, or WCID, adjust spawn distance, and spawn creatures or objects directly in front of the camera. Newly spawned entities are selected automatically.

- **Select and inspect:** Left-click an entity in the viewport to select it, right-click to select and open **Inspect**, or cycle nearby entities with `Tab` and `Shift+Tab`.
- **Pose with the 3D gizmo:** Selecting an unpossessed world entity pauses its physics and shows a 6-DOF transform gizmo. Drag the axis arrows to move it or the rings to rotate it. Hold `Shift` to snap increments, or press `Esc` mid-drag to revert.
- **Physics and launching:** In **Inspect**, use **Move here** to reposition an entity in front of the camera, **Launch** to propel it (launches issued while physics is paused fire when you deselect), or expand **Physics state** to switch between integrated and pose-only simulation and toggle individual physics flags.

<Media id="explorer-gizmo" detail />

- **Possess creatures:** Select any supported creature or character and press `F` (or choose **Possess** in **Inspect** or the Active Entities list) to step into third-person control. While possessed, use normal client movement and jumping, switch available stances, and adjust the **Run rate** slider in **Inspect**. Press `F` again or choose **Release** to return to the camera.

## Lighting, visuals, and screenshots

- **Scene** controls outdoor **Environment** (day, time of day, sky group, and live clock following) and **Streaming** (whether scene interest follows the camera, plus outdoor residency radii for terrain, buildings, objects, generated scenery, and environment cells).
- **Visuals** toggles individual scene layers—including retail-hidden geometry and portal vs. flat interior rendering—alongside per-category nameplates, distance fog, viewer and static outdoor lights, ambient occlusion, entity shadows, and live color grading.
- **Clean screenshots:** Press `Ctrl+Shift+H` to hide the entire HUD (and `Ctrl+Shift+H` or `Esc` to bring it back). Toggle **Show nameplates** under **Settings → UI** when you want an uncluttered frame.
- **Diagnostics** provides live frame telemetry and a GPU texture-atlas inspector.

## Controls

Fly bindings and Explorer shortcuts can be remapped in **Settings → Controls**. While possessing a creature, Explorer uses your regular [3D client movement and camera controls](/holtburger/3d/controls/).

| Action                                                | Default binding               |
| ----------------------------------------------------- | ----------------------------- |
| Move forward / backward                               | `W` / `S`                     |
| Strafe left / right                                   | `Z` / `C`                     |
| Turn left / right                                     | `A` / `D` or `Left` / `Right` |
| Ascend / descend                                      | `Space` / `Ctrl+Space`        |
| Precision speed (hold)                                | `Shift`                       |
| Toggle autorun                                        | `Q`                           |
| Look around                                           | Left-drag or Right-drag       |
| Pan camera (free fly)                                 | Middle-drag                   |
| Move vertically (fly) / zoom (possessing)             | Mouse wheel                   |
| Select / inspect entity                               | Left-click / Right-click      |
| Cycle nearby entities                                 | `Tab` / `Shift+Tab`           |
| Open Inspect for selected entity                      | `E`                           |
| Move or rotate selected entity                        | Drag gizmo (`Shift` snaps)    |
| Possess or release selected entity                    | `F`                           |
| Despawn selected entity                               | `Delete`                      |
| Hide or show HUD                                      | `Ctrl+Shift+H`                |
| Cancel gizmo drag, unhide HUD, deselect, or open menu | `Esc`                         |
