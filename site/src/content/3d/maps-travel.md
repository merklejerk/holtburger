---
title: 'Maps & travel'
description: 'Find your bearings, mark a destination, and recall when ready.'
section: '3D client · World & social'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Read the world map

Open **World** and use the map to explore Dereth. Drag to pan and scroll to zoom. **Reset view** returns to the whole-world view.

Use **Map visibility** to show or hide town names, contracts, waypoints and housing. Keep the layers useful for your current trip; contract and housing searches add their own destinations.

<Media id="map" />

## Set a waypoint

Use the map's context menu to mark a destination, or enter coordinates in chat:

```text
/waypoint 42.3N, 12.7E
```

`/waypoint` shows the current waypoint. `/waypoint clear` removes it. `/wp` is an alias.

Coordinate links in chat can also set a map pin. Enable **Interact with chat history** before clicking a coordinate link.

<Media id="waypoints" />

## Recall

Open **Recall destinations** on the map to see the destinations available to your character. Chat shortcuts include `/lifestone`, `/marketplace`, and `/house recall`.

Use the destination that fits your trip. House and allegiance recalls depend on your character's home or allegiance arrangements.

## Find a specific destination

Use the [Journal](/holtburger/3d/journal/) for contract contacts and quest areas, [Housing](/holtburger/3d/housing/) for house searches, and [corpse recovery](/holtburger/3d/death-corpses/) after a death.
