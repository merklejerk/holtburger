---
title: 'Scripting API reference'
description: 'Find a helper or action, then use the shared declarations for its exact types.'
section: 'Scripting'
---

## Exact contract

[Download holtburger.d.ts](/holtburger/assets/scripting/holtburger.d.ts) for all method signatures, event payloads, entity views and property IDs. This is copied from the runtime's existing declaration file at build time.

All helpers below are methods of **HB** (`Holtburger` is an alias). State can be unavailable: check nullable results before reading their fields. Actions return immediately; observe state and feedback to learn the result.

## Events and current state

| Method                                             | Returns or does                              |
| -------------------------------------------------- | -------------------------------------------- |
| `onEvent(handler)`                                 | Registers a structured-event handler         |
| `selfEntity()`, `characterSheet()`                 | Player snapshot and character stats, or null |
| `currentInteraction()`, `combatInfo()`             | Current interaction and combat state         |
| `currentTradeInfo()`, `party()`                    | Current trade or party, or null              |
| `currentOpenContainer()`                           | Open-container GUID, or null                 |
| `pendingConfirmation()`                            | Current confirmation, or null                |
| `busyOperation()`                                  | Current busy-operation name, or `none`       |
| `serverTime()`                                     | Server time, or zero before synchronization  |
| `inventory()`, `equipment()`                       | Container views and equipment-slot Map       |
| `enchantments()`, `spellbook()`, `inSpellbook(id)` | Active effects and known spells              |

## World queries

| Method                                                                                                                              | Use                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `entity(guid)`, `entityExists(guid)`                                                                                                | Look up an entity or check its presence                                         |
| `nearbyEntities(distance, kinds)`                                                                                                   | Filter nearby entities by metres and optional kinds                             |
| `distance(from, to)`                                                                                                                | Distance in metres between GUIDs or positions                                   |
| `headingTo(from, to)`                                                                                                               | Heading in radians                                                              |
| `entityBoolProp`, `entityIntProp`, `entityInt64Prop`, `entityFloatProp`, `entityStringProp`, `entityDataProp`, `entityInstanceProp` | Read a typed property using entity GUID and property ID; absent values are null |

## Output and interaction

| Method                                                 | Use                                                      |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `print(style, message)`, `debugLog(message)`           | Client messages and debug logging                        |
| `say(message)`, `emote(message)`, `soulEmote(token)`   | In-game speech, free-text emotes and named social emotes |
| `targetEntity(guid)`, `approach(guid)`, `follow(guid)` | Select or move toward a target                           |
| `setCombatMode(on)`, `attack(guid)`                    | Set combat mode or request an attack                     |
| `cancelInteraction()`                                  | Cancel the current interaction                           |
| `snapHeading(radians)`, `scoot(metres)`                | Turn or move a short distance                            |
| `castSpell(id, target)`                                | Cast a spell; target may be omitted or null              |
| `respondToConfirmation(accepted)`                      | Respond to the active confirmation                       |

## Items and trade

| Method                                                                          | Use                                                             |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `openContainer(guid)`, `closeContainer(guid)`                                   | Open or close a container                                       |
| `moveItem(item, container)`                                                     | Move a carried item                                             |
| `stackItems(source, destination, amount)`, `splitItem(item, container, amount)` | Merge or split a quantity                                       |
| `combine(source, destination)`, `useWith(source, destination)`                  | Use one item with another; both names emit the same action      |
| `salvage(tool, items)`, `assess(target)`                                        | Salvage an item list or request appraisal                       |
| `drop(item)`, `pickup(item, container)`                                         | Drop or pick up; container may be omitted/null for world pickup |
| `equip(item, slot)`, `unequip(item)`                                            | Equip by a snake_case slot name or remove worn equipment        |
| `openTrade(guid)`, `addToTrade(item)`                                           | Begin a trade or add an item                                    |
| `acceptTrade()`, `declineTrade()`, `resetTrade()`, `exitTrade()`                | Manage the offer and trade session                              |

## Persistence and HTTP

| Method                               | Use                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `loadConfig()`, `writeConfig(value)` | Read local preferences or write JSON/string content; write returns success |
| `loadData()`, `loadDataBin()`        | Read local-or-bundled JSON or binary sidecars                              |
| `postJson(request)`                  | Allowlisted JSON POST; returns a Promise                                   |

See [runtime and persistence](/holtburger/tui/scripting/runtime/) for file layout and event handling, and [HTTP integrations](/holtburger/tui/scripting/integrations/) for request limits and error handling.
