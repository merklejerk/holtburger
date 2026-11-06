---
title: 'TUI launch options'
description: 'Connection, startup scripts, logs, content, and HTTP policy.'
section: 'Terminal client'
presentation: reference
---

## Connect

```sh
./holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

| Option                  | Short | Meaning                                                          |
| ----------------------- | ----- | ---------------------------------------------------------------- |
| `--server ADDRESS:PORT` | `-s`  | Combined server endpoint                                         |
| `--host HOST`           | `-h`  | Host when not using the combined endpoint; defaults to 127.0.0.1 |
| `--port PORT`           | `-p`  | Port; defaults to 9000                                           |
| `--account NAME`        | `-a`  | Account name                                                     |
| `--password PASSWORD`   | `-P`  | Account password                                                 |
| `--character NAME`      | `-c`  | Character to enter                                               |
| `--content DIR`         | —     | Explicit prepared-content directory                              |

Use the [platform quickstart](/holtburger/start/) for the executable or Flatpak launch command. Extract the complete bundle before connecting.

## Script startup and disconnects

| Option              | Meaning                                             |
| ------------------- | --------------------------------------------------- |
| `--run NAME`        | Queue a script to start when the character is ready |
| `--run-args TEXT`   | Arguments for that queued script; requires `--run`  |
| `--auto-quit`, `-Q` | Exit immediately on disconnect                      |

After saving the [hello example](/holtburger/tui/scripting/), add `--character Bestie --run hello --run-args 'a first test'` to your connection command.

`-Q` does not mean quiet or headless. Use an external supervisor if you want an exit to cause a restart.

## Logs and diagnostics

| Option                       | Meaning                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `--log PATH`, `-l PATH`      | Write chat and game-system messages                           |
| `--debug-log PATH`           | Write Rust debug logs                                         |
| `-v`, `-vv`, `-vvv`, `-vvvv` | Show warn, info, debug, or trace logs in the TUI              |
| `-V`, `-VV`, `-VVV`, `-VVVV` | Set those levels for `--debug-log`; requires that file option |
| `--capture PATH`             | Record session traffic for diagnostics                        |
| `--help`                     | Show launch help                                              |
| `--version`                  | Show version                                                  |

Note that `-h` is the host option; use **`--help`** for help. Review logs and captures before sharing them; remove account credentials from reports.

## Script HTTP policy

| Option                                     | Meaning                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `--script-fetch-allow-host HOST:PORT`      | Allow that exact host and port; repeat for multiple hosts |
| `--script-fetch-timeout-ms NUMBER`         | Request timeout; defaults to 5000 ms                      |
| `--script-fetch-max-response-bytes NUMBER` | Response size limit; defaults to 262144 bytes             |

Without explicit allow-host options, only `localhost:9999` is allowed. See [HTTP integrations](/holtburger/tui/scripting/#http-integrations) for usage.

## Script directories

| Option                    | Environment         | Default                                              |
| ------------------------- | ------------------- | ---------------------------------------------------- |
| `--script-dir DIR`        | `SCRIPT_DIR`        | `./scripts/` for personal scripts and preferences    |
| `--script-bundle-dir DIR` | `SCRIPT_BUNDLE_DIR` | `scripts/` beside the executable for shipped scripts |

CLI options override environment values, as `--content DIR` overrides
`HOLTBURGER_DEFAULT_CONTENT`. Relative script paths are resolved from the launch
working directory. Empty selected paths are errors. A selected bundle directory
must already exist; a personal directory can be created when saving preferences.

Local scripts with matching basenames override bundled scripts. `/scripts` reports discovered scripts and directories.
