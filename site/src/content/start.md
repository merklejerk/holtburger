---
title: 'Your next visit to Dereth'
description: 'Choose a client, get the beta, and connect to your server.'
section: 'Start playing'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Download the beta

[Open the beta release downloads](https://github.com/merklejerk/holtburger/releases/latest).

| Platform            | 3D client                                        | Terminal client                                   |
| ------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Windows x86-64      | [Setup or ZIP](/holtburger/start/3d/windows/)    | [ZIP](/holtburger/start/tui/windows/)             |
| macOS Apple Silicon | [DMG or ZIP](/holtburger/start/3d/macos/)        | [ZIP](/holtburger/start/tui/macos/)               |
| Linux x86-64        | [Flatpak or tar.gz](/holtburger/start/3d/linux/) | [Flatpak or tar.gz](/holtburger/start/tui/linux/) |

Each archive includes **QUICKSTART.md** with installation, connection and troubleshooting steps. Extract the entire portable bundle rather than moving just the executable.

## 3D client

1. Have your server address, port and account credentials ready.
2. Open the launcher, add the server and press Play.
3. When asked, choose your game-data folder.
4. Select or create a character.

The folder needs `client_portal.dat`, `client_cell_1.dat` and `client_local_English.dat`. `client_highres.dat` is optional. A full HBA archive is also supported.

<Media id="launcher" />

<Media id="content-picker" />

For the full walkthrough, see [connection](/holtburger/start/connect/), [game data](/holtburger/start/content/), and [character selection](/holtburger/start/characters/).

Start with the [controls guide](/holtburger/3d/selection-interaction/), especially if you played retail.

## Terminal client

Supply your server, port, account and password at launch as described in the included quickstart. Prepared content and scripts are bundled; keep them with the executable.

Press **Ctrl+Q** to quit. Keep personal scripts and preferences in a separate writable location so updates do not overwrite them.
