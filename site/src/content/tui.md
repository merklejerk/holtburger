---
title: 'A terminal into Dereth'
description: 'Play, script, and automate without running a full 3D interface.'
section: 'Holtburger TUI'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## A client you can play

The dashboard brings together nearby entities, inventory, equipment, spells, character information, trade and fellowship. Chat and context panes keep commands and item details close at hand.

<Media id="tui-workflow" />

[Learn the panes and controls](/holtburger/tui/basics/), then follow the [gameplay guide](/holtburger/tui/gameplay/).

## A client you can script

Run the bundled fighter or mage, or write JavaScript against structured state, events and actions. One script runs at a time; starting another replaces it.

The embedded runtime is Deno Core, not full Deno or Node. There is no unrestricted filesystem, generic network access or runtime module loading.

<Media id="tui-script" />

Start with [running scripts](/holtburger/tui/running-scripts/) and the [bundled fighter and mage](/holtburger/tui/bundled-scripts/), or [write your own](/holtburger/scripting/).

## Set expectations

The TUI uses simplified movement and physics. It is a different interface, not a text rendering of every h3d feature.

`-Q` means quit on disconnect. It does not make the client quiet or headless. Trade/buff services and other specialized bots may need their own scripts.

## Get connected

Release bundles include the prepared content and bundled scripts. Unlike h3d, you do not need to provide retail DATs. Connection details are supplied at launch; there is no login screen.

[Get the beta](/holtburger/start/) for your platform.
