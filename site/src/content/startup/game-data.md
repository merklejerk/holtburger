---
title: 'Game data'
description: 'Use your AC DAT files and keep server-specific folders with each profile.'
section: 'Startup'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Use your existing AC files

Holtburger looks for your game data automatically. If it cannot find your DATs, it asks you to choose their folder when you launch the client.

Choose the folder containing `client_portal.dat`, `client_cell_1.dat`, and `client_local_English.dat`. Keep `client_highres.dat` alongside them if you have it.

Keep the folder somewhere permanent, outside the Holtburger application directory.

## Need the DATs?

[Download the End-of-Retail DAT files](https://mega.nz/file/Q98n0BiR#p5IugPS8ZkQ7uX2A_LdN3Un2_wMX4gZBHowgs1Qomng), also linked by [ACCPP](https://www.accpp.net/manual-installation). Extract the archive, then select the folder containing the DAT files in Holtburger.

<Media id="content-picker" detail />

## Keep server-specific DATs separate

Each launcher profile can remember its own DAT folder. Keep a server’s custom files in a separate folder, and switching profiles brings the right files with you.

Select the profile, open **Advanced → Browse content folder**, then choose **Overwrite profile** to save the change. Use **Save to new profile** to keep another setup alongside it.

To return a profile to the default folder, choose **Use application default** and save the profile.

For Linux Flatpak folder-access problems, see the [Linux installation guide](/holtburger/start/3d/linux/#troubleshooting).

<Media id="profile-content" detail />
