---
title: 'Getting around & playing together'
description: 'Plan your route, group up, and stay connected.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Navigate with the minimap

The minimap puts the surrounding terrain under your radar markers: buildings, elevation and impassable areas help you read the route ahead. Inside dungeons, it shows the dungeon layout so you can follow passages and keep your bearings.

A breadcrumb trail marks where you have recently walked, helping you retrace your steps through winding passages.

<Media id="minimap" />

## Read the world map

Open **World** and use the map to explore Dereth. Drag to pan and scroll to zoom. **Reset view** returns to the whole-world view.

Use **Map visibility** to show or hide town names, contracts, waypoints and housing. Keep the layers useful for your current trip; contract and housing searches add their own destinations.

<Media id="map" />

## Follow a waypoint

Mark your next stop and follow its direction and distance on the minimap. The world map keeps the destination pinned while you travel.

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

Use the [Journal](/holtburger/reference/journal/) for contract contacts and quest areas, [Housing](/holtburger/reference/housing/) for house searches, and [corpse recovery](/holtburger/3d/maps-travel/) after a death.

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

Open [Enchantments](/holtburger/3d/spells/) to inspect vitae alongside other harmful effects.

## Form a party

Open **Social → Party** and choose **Create Party**. Review the party's name, XP/luminance arrangement, recruitment settings and roster.

Select a player and choose **Invite to party** in the selected-target actions. Leaders can manage recruitment, let members invite, dismiss members, or transfer leadership. Members can leave; the leader also has a disband action.

The party HUD keeps member information close while you play. Selecting a member helps you quickly choose someone for a targeted action or spell.

<Media id="party" />

## Friends

In **Friends**, enter a character name and choose **Add Friend**. Search and the online filter help you find someone when the list is long. Use the Tell action beside a friend to start a message; the remove action takes them off your list.

## Allegiance

Use **Allegiance** to inspect your patron, vassals and membership information. Relationship actions let you break from a patron or dismiss a vassal after confirmation; review the named character before confirming. Recall destinations connected to your allegiance appear with the other [travel options](/holtburger/3d/maps-travel/).

## Control interruptions

In **Ignores**, enter a name and choose **Ignore character** or **Ignore account**. Account ignores also cover the target’s other characters. Search the list to remove an ignore later. Under party invitation preferences, **Ignore party invitations** lets you decline invitations while you are busy.

Use [chat filters](/holtburger/3d/chat/#filter-the-noise) when you want to reduce message categories rather than ignore a person.
