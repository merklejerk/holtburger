---
title: 'Explorer & tools'
description: 'Browse content offline or inspect data with the included utilities.'
section: 'Tools'
---

## Offline Explorer

Explorer lets you browse game content without connecting to a server. It needs the same full game data used by the 3D client.

The [Windows](/holtburger/start/3d/windows/#optional-offline-explorer), [macOS](/holtburger/start/3d/macos/#optional-offline-explorer), and [Linux](/holtburger/start/3d/linux/#optional-offline-explorer) quickstarts include the command for their installed or portable bundle.

## Data utilities

Terminal-client bundles also include `dat-tool` and `dat2hba`. Use their `--help` output for available inspection and conversion commands. Ordinary TUI play uses the prepared data in the bundle; ordinary 3D play can use a retail installation directly.

On Linux Flatpak, external input/output folders need explicit grants. The [terminal quickstart](/holtburger/start/tui/linux/#optional-scripts-and-tools) includes the command pattern.

## Development

For building the clients and working on shared crates, use the [3D development guide](https://github.com/merklejerk/holtburger/blob/main/apps/holtburger-3d/README.md#development), [terminal development guide](https://github.com/merklejerk/holtburger/blob/main/apps/holtburger-cli/README.md), and [architecture overview](https://github.com/merklejerk/holtburger/blob/main/ARCHITECTURE.md).
