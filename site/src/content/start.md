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

| Platform            | 3D client         | Terminal client   |
| ------------------- | ----------------- | ----------------- |
| Windows x86-64      | Setup or ZIP      | ZIP               |
| macOS Apple Silicon | DMG or ZIP        | ZIP               |
| Linux x86-64        | Flatpak or tar.gz | Flatpak or tar.gz |

Each bundle includes a platform-specific **QUICKSTART.md** with installation, connection and troubleshooting steps. Extract the entire portable bundle rather than moving just the executable.

## 3D client

1. Have your server address, port and account credentials ready.
2. Open the launcher, add the server and press Play.
3. When asked, choose your game-data folder.
4. Select or create a character.

The folder needs `client_portal.dat`, `client_cell_1.dat` and `client_local_English.dat`. `client_highres.dat` is optional. A full HBA archive is also supported.

<Media id="launcher" />

<Media id="content-picker" />

Start with the [controls guide](/holtburger/3d/selection-interaction/), especially if you played retail.

## Terminal client

Supply your server, port, account and password at launch as described in the included quickstart. Prepared content and scripts are bundled; keep them with the executable.

Press **Ctrl+Q** to quit. Keep personal scripts and preferences in a separate writable location so updates do not overwrite them.
