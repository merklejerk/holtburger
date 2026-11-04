---
title: 'Chat & emotes'
description: 'Find commands as you type, catch up on messages, and get back to playing.'
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

## Read older messages

Chat normally follows new messages and lets you click through the history into the world. To scroll back, select text or click a coordinate link, hold **Control** (**Command** on macOS) while using the history. Release it to return to live messages.

For longer reading, use **Interact with chat history** to keep the history active. It holds your place while you scroll back. Turn the toggle off when finished to resume following new messages.

Typing also makes the history interactive. Clicking the history switches from typing to reading; press **Enter** to return to your message. **Escape** leaves the history or clears the message you are editing and returns control to the game. If command suggestions are open, the first Escape dismisses them.

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
