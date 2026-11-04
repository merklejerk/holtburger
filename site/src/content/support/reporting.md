---
title: 'Report a problem'
description: 'Give us the version, the steps, and what you expected to happen.'
section: 'Help'
---

## Before filing

Check the relevant [installation guide](/holtburger/start/) or [graphics help](/holtburger/support/graphics/). For script problems, include the script name and whether the same task works manually.

## Include the essentials

[Open an issue on GitHub](https://github.com/merklejerk/holtburger/issues) with:

- Client: 3D or TUI, version from `/version`, and your platform.
- Steps that reproduce the problem, starting from the relevant screen or command.
- Expected behavior and what actually happened.
- Error messages, screenshots or a short clip where useful.

For rendering problems, add **Copy hardware info** from the launcher. For connection problems, include the server software if known; Holtburger is developed against ACE and GDLE compatibility is unverified.

## Logs and captures

The TUI can write chat/system messages with `--log` and debug output with `--debug-log`. See [launch options](/holtburger/tui/reference/options/) for levels and capture options.

Share the relevant portion rather than a large unrelated log. Remove passwords, account credentials and private messages before attaching files. Never post a launcher profile or command line with a real password in it.
