---
title: 'Terminal client help'
description: 'Connection, bundled content, scripts and diagnostic logs.'
section: 'Terminal client'
---

## Cannot connect

Check the address, port and account in your [launch command](/holtburger/tui/connect/). Holtburger is developed against ACE; GDLE compatibility is unverified.

## Content is missing

Extract the complete release bundle and keep its prepared content alongside the executable. Retail DATs alone do not replace the TUI’s navigation data. See the [installation instructions](/holtburger/tui/connect/).

## A script will not start

Enter the world before using `/run`. Use `/scripts` to check the active script, local directory and discovered names. A local script overrides a bundled one with the same basename.

For the mage, keep the bundled data sidecars with the script. See [running scripts](/holtburger/tui/running-scripts/) for file layout and [runtime limits](/holtburger/tui/scripting/runtime/) if a custom script expects Node or Deno APIs.

## Report a problem

[Open a GitHub issue](https://github.com/merklejerk/holtburger/issues) with your version from `/version`, platform, launch options without credentials, reproduction steps and relevant errors. For scripts, include the script name and whether the task works manually.

Use `--log` for chat/system messages and `--debug-log` for diagnostic output. See [launch options](/holtburger/tui/options/) for levels and capture options. Attach the relevant log excerpt, with passwords, account credentials and private messages removed.
