---
title: 'Runtime & persistence'
description: 'Understand the script lifecycle, saved preferences, and build format.'
section: 'Scripting'
---

## One JavaScript entry point

The TUI loads one JavaScript file into an embedded Deno Core runtime. `HB` is the API global; `Holtburger` is an alias.

This is not the full Deno or Node environment. There is no browser DOM, runtime `import()`/`require()` graph, unrestricted filesystem API, or general-purpose network API. Bundle dependencies into your final script file and use the provided persistence and HTTP helpers.

## Events

Register handlers with `HB.onEvent(handler)`. Handlers run synchronously in registration order, so keep each handler short.

| Event                                                | Useful for                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `lifecycle` → `started`                              | Initialize a run; arguments are in `event.data.data.args`               |
| `lifecycle` → `tick`                                 | Repeated decisions; elapsed time is in `event.data.data.elapsedSeconds` |
| `lifecycle` → `stopped`                              | End-of-run handling                                                     |
| `workflow`                                           | Interaction, confirmation and busy-state changes                        |
| `command`                                            | Messages sent with `/script`; text is `event.data.msg`                  |
| `chat_message`, `combat_feedback`, `weenie_error`    | Observe messages and action feedback                                    |
| Entity, inventory, spellbook, party and vital events | Reconsider decisions when state changes                                 |
| `teleport_started`, `player_killed`                  | Retire assumptions when the situation changes                           |

See the [API declarations](/holtburger/assets/scripting/holtburger.d.ts) for the full event union and payloads. Not all events have a `data` member.

## Files belonging to a script

For a script named `hello`:

| File                        | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `hello.js`                  | Runnable script                                                |
| `hello.data.json`           | Optional data for `HB.loadData()`                              |
| `hello.data.bin`            | Optional binary data for `HB.loadDataBin()`                    |
| `.config/hello.config.json` | Local preferences for `HB.loadConfig()` and `HB.writeConfig()` |

Local script/data files take precedence over bundled files with the same basename. Config always belongs to the writable local directory. Check the boolean returned by `HB.writeConfig()` before treating a preference as saved.

## Author in TypeScript

Use the existing [declaration file](/holtburger/assets/scripting/holtburger.d.ts) for editor help and type checking. Compile TypeScript and bundle dependencies into one plain JavaScript file, without runtime module imports.

The shipped mage uses this workflow. Its source package is linked from the [script source directory](https://github.com/merklejerk/holtburger/tree/main/assets/scripts/src/mage).
