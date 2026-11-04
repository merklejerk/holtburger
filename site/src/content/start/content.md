---
title: 'Choose your game data'
description: 'The 3D client uses your AC installation. The terminal client comes prepared.'
section: 'Start playing'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## For the 3D client

When asked for content, choose the **folder** containing your Asheron's Call game files:

| File                       | Needed?                          |
| -------------------------- | -------------------------------- |
| `client_portal.dat`        | Yes                              |
| `client_cell_1.dat`        | Yes                              |
| `client_local_English.dat` | Yes                              |
| `client_highres.dat`       | Optional high-resolution content |

Keep these together. Select the folder rather than an individual file. Holtburger remembers your choice, so keep the game data somewhere permanent, outside the application folder.

A full HBA archive is also supported. If you already have retail DATs, you can use that folder directly; conversion is optional.

<Media id="content-picker" />

## Change the folder

In the launcher, expand **Advanced** and use **Browse content folder** to set a content path for the selected profile. **Use application default** clears that override.

On Linux Flatpak, the folder picker must grant access to the selected location. If that fails, follow the explicit folder-access command in the [Linux installation guide](/holtburger/start/3d/linux/#troubleshooting).

## For the terminal client

Extract the whole release bundle and keep its `content/` and `scripts/` folders beside the executable. You do not need retail DATs.

The terminal client's prepared data is not enough for the 3D client. If terminal data is missing, extract the complete bundle again.

## Next

[Connect to your server](/holtburger/start/connect/).
