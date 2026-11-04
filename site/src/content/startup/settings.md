---
title: 'Game data & launch settings'
description: 'Point Holtburger at your AC files and choose your graphics settings.'
section: 'Startup'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Use your existing AC files

Choose the folder containing `client_portal.dat`, `client_cell_1.dat`, and `client_local_English.dat`. Keep `client_highres.dat` alongside them if you have it.

Keep the folder somewhere permanent, outside the Holtburger application directory.

## Need the DATs?

[Download the End-of-Retail DAT files](https://mega.nz/file/Q98n0BiR#p5IugPS8ZkQ7uX2A_LdN3Un2_wMX4gZBHowgs1Qomng), also linked by [ACCPP](https://www.accpp.net/manual-installation). Extract the archive, then select the folder containing the DAT files in Holtburger.

<Media id="content-picker" />

## Change the folder

In the launcher, expand **Advanced** and choose **Browse content folder**. **Use application default** clears the selected profile's override.

For Linux Flatpak folder-access problems, see the [Linux installation guide](/holtburger/start/3d/linux/#troubleshooting).

## Launch settings

Open **App settings** in the launcher to choose a graphics backend and enable or disable **Synchronize frames with the display (VSync)**. Apply the changes with the restart action.

For rendering problems, see [graphics troubleshooting](/holtburger/support/graphics/).
