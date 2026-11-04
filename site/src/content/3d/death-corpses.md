---
title: 'Death & corpse recovery'
description: 'Find a recorded death location and arrange help retrieving your items.'
section: '3D client · World & social'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Find your way back

Use `/corpse` to show your saved last outdoor death location. `/corpses` lists approximate deaths observed during the current session.

Enable **Interact with chat history** and click the coordinates to set a waypoint. Follow it using the [world map](/holtburger/3d/maps-travel/), then use **V** or **Shift+V** to cycle through unopened corpses nearby.

Use the coordinates to reach the area, then look for your corpse. The `/corpses` history clears when the character session ends.

<Media id="corpse-recovery" />

## Let someone help

Grant a player access to your corpse:

```text
/permit Best Friend
```

Revoke that grant with `/unpermit Best Friend`.

To manage permissions other people grant you:

| Command                        | Action                            |
| ------------------------------ | --------------------------------- |
| `/consent on` / `/consent off` | Accept or decline incoming grants |
| `/consent who`                 | List received permissions         |
| `/consent remove PLAYER`       | Discard one received permission   |
| `/consent clear`               | Discard all received permissions  |

## Check vitae

Open [Enchantments](/holtburger/3d/enchantments/) to inspect vitae alongside other harmful effects.
