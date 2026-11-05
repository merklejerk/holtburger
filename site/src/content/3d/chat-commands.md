---
title: '3D chat commands'
description: 'Messages, emotes, travel, corpse permissions, and local utilities.'
section: '3D client'
---

## Help and syntax

Use `/help` (alias `/?`) for the command list, and `/help COMMAND` for a topic. Commands accept **`/` or `@`**. Capitalized words below are placeholders; brackets mark optional arguments.

## Tell and reply

| Command                 | Alias | Action                                                         |
| ----------------------- | ----- | -------------------------------------------------------------- |
| `/tell PLAYER, MESSAGE` | `/t`  | Tell a named player; a comma ends the name                     |
| `/tellselected MESSAGE` | `/ts` | Tell the selected player or speak directly to the selected NPC |
| `/reply MESSAGE`        | `/r`  | Reply to the most recent incoming player or NPC teller         |
| `/retell MESSAGE`       | `/rt` | Tell your most recent outgoing recipient again                 |
| `/say MESSAGE`          | —     | Send local speech for this message                             |
| `/emote MESSAGE`        | —     | Send a free-text action in local chat                          |

Example: `/tell Best Friend, meet at the lifestone`. Check the destination preview when replying; an NPC conversation can change the reply target.

## Channels

Append your message after any alias. These commands change the destination for that message, leaving the destination picker unchanged.

| Destination          | Command aliases                |
| -------------------- | ------------------------------ |
| Party                | `/f`, `/fellowship`, `/party`  |
| Allegiance           | `/a`, `/guild`, `/gu`          |
| Allegiance broadcast | `/ab`, `/allegiance broadcast` |
| Vassals              | `/v`, `/vassals`               |
| Patron               | `/p`, `/patron`                |
| Monarch              | `/m`, `/monarch`               |
| Co-vassals           | `/c`, `/co-vassals`            |
| General              | `/general`, `/cg`              |
| Trade                | `/trade`, `/ct`                |
| LFG                  | `/lfg`, `/clfg`                |
| Roleplay             | `/roleplay`, `/crp`            |
| Society              | `/society`, `/soc`             |
| Olthoi               | `/olthoi`, `/o`                |

For example, `/f ready` speaks to your party. **In h3d, `/p` means patron; in the TUI it means party.**

## Social emotes

Type `*wave*` to perform a named social emote. Typing `*` offers completions; Tab or Enter accepts a suggestion, and Enter submits the completed input.

Local speech can include gestures, such as `Hello *wave*`. Explicit tells, channel messages and `/emote` bodies keep their text literal. The [emote wheel](/holtburger/3d/chat/#use-an-emote) is another way to choose gestures.

## Waypoint and recalls

| Command                          | Action and aliases                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/waypoint [COORDINATES\|clear]` | Show, set or remove a waypoint; `/wp` is an alias                                                                             |
| `/lifestone`                     | Lifestone recall; `/lif`, `/ls`                                                                                               |
| `/marketplace`                   | Marketplace recall; `/mar`, `/mp`                                                                                             |
| `/pkarena`                       | PK arena recall; `/pka`                                                                                                       |
| `/pklarena`                      | PK Lite arena recall; `/pla`                                                                                                  |
| `/house recall`                  | House recall; `/house re`, `/hou recall`, `/hou re`, `/hor`, `/hr`                                                            |
| `/house mansion_recall`          | Allegiance housing; `/house alleg_recall`, `/house ma`, `/hou mansion_recall`, `/hou alleg_recall`, `/hou ma`, `/hom`, `/hoa` |
| `/allegiance hometown`           | Allegiance hometown; `/allegiance ho`, `/all hometown`, `/all ho`                                                             |

Example: `/waypoint 42.3N, 12.7E`. See [maps and travel](/holtburger/3d/maps-travel/) for map layers and recall controls.

## Death and permissions

| Command                                    | Action                                        |
| ------------------------------------------ | --------------------------------------------- |
| `/corpse`                                  | Show saved last outdoor death location        |
| `/corpses`                                 | List approximate deaths observed this session |
| `/permit PLAYER`, `/unpermit PLAYER`       | Grant or revoke access to your corpse         |
| `/consent on`, `/consent off`              | Accept or decline incoming permissions        |
| `/consent who`                             | List received permissions                     |
| `/consent remove PLAYER`, `/consent clear` | Discard one or all received permissions       |
| `/die`, `/rip`                             | Kill your character after confirmation        |

Death may drop items and cause vitae. For recovery and location limitations, see [corpse recovery](/holtburger/3d/maps-travel/).

## Local utilities

| Command         | Action                                                           |
| --------------- | ---------------------------------------------------------------- |
| `/version`      | Show client version and build revision                           |
| `/fps`          | Toggle the FPS display                                           |
| `/ui-showcase`  | Toggle conditional HUD previews without layout editing controls  |
| `/assets`       | Show the active content location                                 |
| `/assets retry` | Retry failed content loading                                     |
| `/loc`          | Print and copy character/camera location details for diagnostics |
| `/logopolis`    | Open Logopolis                                                   |

Replacing the game-data files while the client is running still requires restarting with the repaired folder; `/assets retry` only retries loading.
