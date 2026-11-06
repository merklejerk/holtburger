---
title: 'Install & connect in the TUI'
description: 'Download the terminal bundle and connect from your shell.'
section: 'Terminal client'
---

## Install

Choose the [Windows](/holtburger/tui/install/windows/), [macOS](/holtburger/tui/install/macos/), or [Linux](/holtburger/tui/install/linux/) instructions. Extract the whole bundle and keep its content and scripts together; retail DATs are not required.

## Connect

Run from the extracted directory:

```sh
./holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

Use `./holtburger-cli.exe` in Windows PowerShell. Flatpak launch commands are in the Linux instructions. Use your server's actual address, port and account credentials.

Once connected, [find your way around](/holtburger/tui/basics/) or [run a script](/holtburger/tui/scripting/#run-and-manage-scripts).
