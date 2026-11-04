---
title: 'Connect to your server'
description: 'Have your server address, port, and account ready.'
section: 'Start playing'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Choose a server

Holtburger is developed against **ACE**, the server software used by many community servers. Use the address and port supplied by your server; the usual port is **9000**. GDLE compatibility is unverified.

Accounts belong to individual servers. Follow your server's account-creation instructions, then use those credentials in Holtburger.

## In the 3D client

1. Open the launcher and add or select your server.
2. Select an account profile, or create one, and enter your account and password.
3. Press **Play**.
4. If prompted, [choose your game-data folder](/holtburger/start/content/).
5. [Select or create a character](/holtburger/start/characters/).

Profiles let you keep connection details for different accounts. Disconnecting returns you to the launcher.

<Media id="launcher" />

## In the terminal client

Open a terminal in the extracted bundle and supply your connection details:

```sh
./holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

On Windows, use `./holtburger-cli.exe` in PowerShell. For Flatpak, use the command in the [Linux terminal quickstart](/holtburger/start/tui/linux/).

Replace the capitalized values, and change the port if needed. There is no login screen. The terminal client's content is bundled; keep the extracted files together.

## If connection fails

Check the address, port and account against the server's instructions. Run the terminal client from a terminal so you can read any connection errors. For other startup problems, see [Help](/holtburger/support/).
