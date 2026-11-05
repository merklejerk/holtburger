---
title: 'TUI chat commands'
description: 'Messaging, gameplay utilities, and script control in the terminal client.'
section: 'Terminal client'
presentation: reference
---

## Help and syntax

Use `/help` or `/?` for discovery, and `/help COMMAND` for a topic. Commands also accept the `@` prefix. Use the lowercase spellings shown here.

`PLAYER`, `MESSAGE` and other capitalized words are placeholders. Square brackets mark optional arguments; do not type the brackets.

## Messages and allegiance

| Command                | Aliases          | Action                               |
| ---------------------- | ---------------- | ------------------------------------ |
| `/tell PLAYER MESSAGE` | `/t`             | Send a private message               |
| `/reply MESSAGE`       | `/r`             | Reply to your last incoming tell     |
| `/g MESSAGE`           | `/guild`         | Allegiance chat                      |
| `/p MESSAGE`           | `/party MESSAGE` | Party chat                           |
| `/swear PLAYER`        | —                | Swear allegiance to the named player |
| `/unswear`             | —                | Break from your current patron       |

The TUI's `/tell` takes a single word as the recipient name, followed by the message. The 3D client's comma-separated tell syntax is different.

Unprefixed input sends ordinary speech; a leading colon sends a text emote. Commands not handled locally are sent to the server as entered.

## Party

| Command                | Aliases                                         | Action                                      |
| ---------------------- | ----------------------------------------------- | ------------------------------------------- |
| `/party`               | —                                               | Show party status                           |
| `/create-party [NAME]` | `/createparty`, `/party-create`, `/partycreate` | Create a party; omitted name uses a default |
| `/invite PLAYER`       | —                                               | Invite a player                             |
| `/promote PLAYER`      | —                                               | Transfer party leadership                   |
| `/uninvite PLAYER`     | —                                               | Dismiss a member                            |
| `/leave`               | —                                               | Leave the party                             |

For example: `/create-party Evening Hunt`, then `/invite Bestie`.

## Movement and posture

| Command                            | Action                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| `/combat`                          | Toggle combat mode                                              |
| `/scoot [METRES]`                  | Move forward approximately that distance; defaults to one metre |
| `/kneel`, `/sit`, `/lie`, `/stand` | Request a resting posture                                       |
| `/pkl`                             | Enter PK Lite mode                                              |

Resting leaves combat and stays peaceful. `/kneel` is the resting crouch, separate from the social kneel emote.

## Recalls

| Destination         | Command and aliases                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Lifestone           | `/lifestone`, `/lif`, `/ls`                                                                                                               |
| Marketplace         | `/marketplace`, `/mar`, `/mp`                                                                                                             |
| PK arena            | `/pkarena`, `/pka`                                                                                                                        |
| PK Lite arena       | `/pklarena`, `/pla`, `/arena`                                                                                                             |
| House               | `/house recall`, `/house re`, `/hou recall`, `/hou re`, `/hor`, `/hr`                                                                     |
| Allegiance housing  | `/house mansion_recall`, `/house alleg_recall`, `/house ma`, `/hou mansion_recall`, `/hou alleg_recall`, `/hou ma`, `/hom`, `/hoa`, `/hq` |
| Allegiance hometown | `/allegiance hometown`, `/allegiance ho`, `/all hometown`, `/all ho`                                                                      |

## Death and corpse permissions

| Command                                     | Action                                        |
| ------------------------------------------- | --------------------------------------------- |
| `/corpse`                                   | Show the saved last outdoor death location    |
| `/corpses`                                  | List approximate deaths observed this session |
| `/permit PLAYER`                            | Grant access to your corpse                   |
| `/unpermit PLAYER`                          | Revoke access you granted                     |
| `/consent on` / `/consent off`              | Accept or decline incoming grants             |
| `/consent who`                              | List received permissions                     |
| `/consent remove PLAYER` / `/consent clear` | Discard one or all received permissions       |
| `/die`, `/rip`                              | Kill your character after confirmation        |

Recorded locations can be approximate or stale. They do not confirm that a corpse or its items remain. Death can drop items and cause vitae.

## Scripts

| Command               | Action                                                          |
| --------------------- | --------------------------------------------------------------- |
| `/scripts`            | Show status, queued startup, directories and discovered scripts |
| `/run NAME [ARGS...]` | Start or replace the active script                              |
| `/script MESSAGE`     | Send a message to the active script                             |
| `/unrun`              | Stop the script and clear queued startup                        |

Example: `/run fighter --aggro-dist 15`. See [running scripts](/holtburger/tui/running-scripts/) for startup and local-file precedence.

## Client and character options

| Command                                      | Action                                |
| -------------------------------------------- | ------------------------------------- |
| `/options`, `/option`                        | List supported character options      |
| `/option SETTING on` / `/option SETTING off` | Change one option                     |
| `/version`                                   | Show build version and revision       |
| `/clear`                                     | Clear chat and the current input line |
| `/quit`, `/exit`                             | Exit the client                       |
| `/logopolis`                                 | Open Logopolis                        |

Examples: `/option trade-chat on`, `/option share-xp off`. Use `/options` for the current setting names.
