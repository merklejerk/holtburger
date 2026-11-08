---
title: 'Scripts'
description: 'Write and run TUI scripts using structured game state, events and actions.'
section: 'Terminal client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
import hello from '../../../examples/hello.js?raw';
import status from '../../../examples/status.js?raw';
</script>

## Write your first script

Pass `--script-dir DIR` or set `SCRIPT_DIR` to a writable directory for your scripts and preferences. The CLI option takes precedence. Keep the directory outside the extracted release folder so updates do not replace your work.

Save this as `hello.js` there, or [download the example](/holtburger/assets/scripting/hello.js):

<pre><code>{hello}</code></pre>

Enter the world, then run `/run hello a first test`. The script prints a greeting and sends its startup arguments to the debug log.

<IllustratedProse name="lugian">

## Run and manage scripts

| Command               | Action                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `/scripts`            | Show status, queued startup, directories and discovered scripts        |
| `/run NAME [ARGS...]` | Start `NAME.js`; replace the active script if one is running           |
| `/script MESSAGE`     | Send a message to the active script; its meaning depends on the script |
| `/unrun`              | Stop the script and clear queued startup                               |

One script runs at a time. A local script takes precedence over a bundled script with the same basename.

To start at launch, add `--character NAME --run hello` to your connection command. Use `--run-args 'TEXT'` for startup arguments. Startup waits until the character is ready. `-Q` / `--auto-quit` exits on disconnect for use with an external supervisor. See [launch options](/holtburger/tui/options/) for the full flags.

</IllustratedProse>

## Runtime and events

The TUI loads one JavaScript file into an embedded Deno Core runtime. `HB` is the API global; `Holtburger` is an alias. Bundle dependencies into one file: the runtime does not provide Node or full Deno APIs, a browser DOM, runtime `import()`/`require()`, unrestricted filesystem access or general-purpose networking.

Register handlers with `HB.onEvent(handler)`. They run synchronously in registration order, so keep each handler short. Check for missing state and wait for feedback before repeating an action; submitting an action does not mean it has finished.

| Event                                                | Use                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `lifecycle` → `started`                              | Setup; startup arguments are in `event.data.data.args`                  |
| `lifecycle` → `tick`                                 | Repeated decisions; elapsed time is in `event.data.data.elapsedSeconds` |
| `lifecycle` → `stopped`                              | End-of-run handling                                                     |
| `command`                                            | Messages from `/script`, in `event.data.msg`                            |
| `workflow`                                           | Interaction, confirmation and busy-state changes                        |
| Entity, inventory, spellbook, party and vital events | React to state changes                                                  |
| `chat_message`, `combat_feedback`, `weenie_error`    | Observe action feedback                                                 |
| `teleport_started`, `player_killed`                  | Reconsider assumptions when the situation changes                       |

## API reference

[Download holtburger.d.ts](/holtburger/assets/scripting/holtburger.d.ts) for exact method signatures, event payloads, entity views and property IDs. This declaration file comes from the scripting runtime and also supplies editor help for JavaScript or TypeScript. Not all events have a `data` member; state queries can return null.

| Task                        | Selected `HB` methods                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Read player and world state | `selfEntity()`, `characterSheet()`, `entity(guid)`, `nearbyEntities(distance, kinds)`                                     |
| Read inventory and effects  | `inventory()`, `equipment()`, `enchantments()`, `spellbook()`                                                             |
| Track ongoing work          | `currentInteraction()`, `busyOperation()`, `pendingConfirmation()`, `currentTradeInfo()`                                  |
| Print or speak              | `print(style, message)`, `debugLog(message)`, `say(message)`                                                              |
| Move and fight              | `approach(guid)`, `follow(guid)`, `scoot(metres)`, `attack(guid)`, `castSpell(id, target)`                                |
| Manage items                | `moveItem(item, container)`, `splitItem(item, container, amount)`, `equip(item, slot)`, `salvage(tool, items)`            |
| Trade and interact          | `openTrade(guid)`, `addToTrade(item)`, `acceptTrade()`, `useWith(source, destination)`, `respondToConfirmation(accepted)` |

## Files and persistence

For a script named `hello`:

| File                        | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `hello.js`                  | Runnable script                                                |
| `hello.data.json`           | Optional data for `HB.loadData()`                              |
| `hello.data.bin`            | Optional binary data for `HB.loadDataBin()`                    |
| `.config/hello.config.json` | Local preferences for `HB.loadConfig()` and `HB.writeConfig()` |

Local script and data files take precedence over bundled files with the same basename. Config always belongs to the writable local directory. Check the boolean returned by `HB.writeConfig()` before treating a preference as saved.

TypeScript projects must compile and bundle into one plain JavaScript file without runtime module imports.

## HTTP integrations

`HB.postJson()` sends a JSON POST and returns a Promise. By default, only **localhost:9999** is allowed. Repeat `--script-fetch-allow-host HOST:PORT` at launch to allow destinations; supplying it replaces the default list. HTTP(S) URLs can also specify the host; paths and credentials are not part of an allowlist entry.

Request limits default to **5,000 ms** and **262,144 response bytes**. Adjust them with `--script-fetch-timeout-ms` and `--script-fetch-max-response-bytes`.

Start your own JSON service at `http://localhost:9999/status`, save this as `status.js` and run `/run status`. The service must accept a JSON POST and return JSON; the example supplies only the client:

<pre><code>{status}</code></pre>

[Download the status example](/holtburger/assets/scripting/status.js).

Completed responses provide `ok`, `status` and `bodyJson`. Check `ok` before using the result. Denied destinations, timeouts, transport failures, oversized responses and invalid JSON reject the Promise, with codes such as `policy_denied`, `timeout` or `response_too_large`. Handle rejections so failures stay visible.

Requests are JSON-only, with no custom headers. The host sends Holtburger-identifying Origin and User-Agent headers. Use a separate service when an integration needs another protocol or credentials handling.

## Bundled examples

The fighter and mage are fully functional combat bots, bundled as examples to study and adapt for your own character and goals:

- [Fighter source](https://github.com/merklejerk/holtburger/blob/main/apps/holtburger-cli/scripts/fighter.js) demonstrates survival priorities, healing, party support and target selection. Try `/run fighter --aggro-dist 15 --max-party-dist 20` to explore its distance controls.
- [Mage source](https://github.com/merklejerk/holtburger/tree/main/apps/holtburger-cli/scripts/src/mage) demonstrates a larger TypeScript project bundled into one script, including spell selection, restoration and party following. Run it with `/run mage`; keep `mage.js`, `mage.data.json` and `mage.data.bin` together.

Mage preferences live in `SCRIPT_DIR/.config/mage.config.json`. Its `preferredSpells` and `bannedSpells` arrays accept spell IDs or spell key names from the script's data; empty arrays use ordinary selection.

Copy examples into your writable script directory to change them. Test changes under supervision, watch the feedback and use `/unrun` to stop. Trade services, buffing and specialized routes need scripts tailored to those tasks.
