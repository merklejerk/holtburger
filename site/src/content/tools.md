---
title: 'Tools & development'
description: 'Inspect data with the included command-line utilities or build Holtburger from source.'
section: 'Tools'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
</script>

<IllustratedProse name="black-hills">

## Offline World Explorer

Explorer is built into Holtburger 3D and opens straight from the launcher’s **Explorer** tab—no server required. See the [World Explorer guide](/holtburger/3d/explorer/) for flying, spawning and posing entities, creature possession, and lighting controls.

For launching Explorer directly from a terminal, see the [Windows](/holtburger/start/3d/windows/#optional-offline-explorer), [macOS](/holtburger/start/3d/macos/#optional-offline-explorer), and [Linux](/holtburger/start/3d/linux/#optional-offline-explorer) quickstarts.

</IllustratedProse>

## Live API

Both the 3D and terminal clients include an opt-in, localhost-only HTTP/WebSocket API for external bots, companion tools, and AI agents. See [Live API & AI agents](/holtburger/live-api/) for enabling it in the launcher or CLI and using `/api prompt` to connect an agent.

## Data utilities

Terminal-client bundles also include `dat-tool` and `dat2hba`. Use their `--help` output for available inspection and conversion commands. Ordinary TUI play uses the prepared data in the bundle; ordinary 3D play can use a retail installation directly.

On Linux Flatpak, external input/output folders need explicit grants. The [terminal quickstart](/holtburger/tui/install/linux/#optional-scripts-and-tools) includes the command pattern.

## Development

For building the clients and working on shared crates, use the [3D development guide](https://github.com/merklejerk/holtburger/blob/main/apps/holtburger-3d/README.md#development), [terminal development guide](https://github.com/merklejerk/holtburger/blob/main/apps/holtburger-cli/README.md), and [architecture overview](https://github.com/merklejerk/holtburger/blob/main/ARCHITECTURE.md).
