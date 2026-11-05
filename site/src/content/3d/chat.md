---
title: 'Chat & emotes'
description: 'Chat that stays out of the way, with command suggestions and useful links.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Send a message

Press **Enter** to type a message. Choose the destination, type, and send; sending returns you to the game. If a command suggestion is highlighted, Enter accepts that suggestion first.

## Discover commands as you type

Start typing a command to see matching suggestions, their syntax and a short description. Browse with the arrow keys and accept with **Tab** or **Enter**—handy for finding a command without leaving the game to look it up.

Input history lets you reuse commands you have already sent.

Type `/help` for the command list or `/help COMMAND` for one command. Both `/` and `@` can introduce commands. Chat commands also include utilities such as waypoints, recalls and corpse permissions.

<Media id="chat-completion" detail />

## Keep the world clickable

Inactive chat lets clicks pass through to the world. You can select, steer and interact in the space behind the chat buffer without moving it out of the way.

Hold **Control** (**Command** on macOS) when you want to scroll, select text or click a chat link. Release it to make that space clickable in the world again. Use the **Interact with chat history** icon to leave chat interactive until you toggle it off.

Typing also activates chat. **Enter** opens the composer; sending returns control to the game. **Escape** leaves history interaction or clears the message you are editing. If command suggestions are open, the first Escape dismisses them.

<Media id="chat" detail />

## Use links in chat

Hold **Control** (**Command** on macOS), or enable **Interact with chat history**, then click:

- **Coordinates** to set a [waypoint](/holtburger/3d/maps-travel/#follow-a-waypoint).
- **A linked name in an entity alert** to select that creature or object. You can then [inspect it](/holtburger/3d/inspecting/) or interact as usual.

<Media id="chat-links" detail />

## Filter the noise

Use message and channel filters to keep relevant conversations visible. The timestamp control adds or removes times beside messages.

Chat settings can also suppress your own evasion/resist notices and spell incantations when those messages crowd the history.

## Use an emote

Hold **T** to open the emote wheel. Click an emote, or select it with **Space** or **Enter**. Releasing T dismisses the wheel. Recent choices make repeated gestures easier to find.

When an emote requires peace, Holtburger can switch temporarily and restore the previous combat stance afterward.

<Media id="emotes" detail />
