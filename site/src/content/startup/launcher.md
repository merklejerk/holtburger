---
title: 'Launcher'
description: 'Choose a server, save your account and get ready to enter Dereth.'
section: 'Startup'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

The launcher keeps your servers, account profiles and game-data settings together. Select a server on the left, choose or enter your account on the right, then press **Play**.

<Media id="launcher" />

## Import your server

Choose **Import from TreeStats** in the launcher. Search for your server, or filter by server type and software. Sort by population when you want to see where people are playing, then add the server to your launcher.

Holtburger is developed against **ACE**. **GDLE compatibility is unverified**; check the server software before choosing.

<Media id="treestats-import" detail />

## Add your account

Select the imported server and enter your account credentials. **Save to new profile** keeps a connection ready for next time; profiles let you switch between accounts without retyping the details. The server can also remember [its own DAT folder](/holtburger/startup/game-data/#keep-server-specific-dats-separate), shared by all its account profiles.

Accounts belong to the server. Follow its account-creation instructions if you need a new one.

Press **Play**, choose your [game-data folder](/holtburger/startup/game-data/) if prompted, and [choose your character](/holtburger/startup/characters/).

## Enter a server manually

For a private server or one missing from TreeStats, use the launcher's server editor and enter the address and port supplied by its operator.

For failed connections, see [Help](/holtburger/3d/help/).

## Launch settings

Open **App settings** in the launcher to choose a graphics backend and toggle **Synchronize frames with the display (VSync)** or **Use GPU compositing**. Apply changes with **Save and restart**. Windows defaults to OpenGL with VSync and GPU compositing off; **Use defaults** restores your platform's choices.

For explanations of each setting, see [graphics troubleshooting](/holtburger/3d/help/#before-the-game-opens). If pieces of the interface briefly disappear, see [Windows UI flickering](/holtburger/3d/help/#windows-ui-flickering).

Launcher settings are reconciled from supported older formats and repaired automatically when loaded. Servers, account profiles, saved credentials, and launch history carry forward. Missing preferences receive defaults, invalid history is cleared, and malformed entries are removed while valid entries are retained. Older profile content-folder overrides move to their server when its profiles agree; conflicting overrides revert to the application default and are reported. The launcher saves a backup of the original file before writing changes. If the catalog cannot be repaired, the launcher automatically backs up the original and creates an empty catalog. Backup or write failures are reported without replacing the original.

## Switch characters

While playing, open the **System menu** and choose **Return to main menu**. This logs out your character and returns to character selection on the same connection.

## Switch accounts or servers

From character selection, choose **Disconnect** to return to the launcher. If you are in the world, first use **System menu → Return to main menu**. Select another server or account profile in the launcher and press **Play**.

**Quit application** closes the client.
