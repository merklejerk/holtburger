---
title: 'Chat & emotes'
description: 'Chat that stays out of the way, with command suggestions and useful links.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Your chat panel

The chat panel combines message history, channel filters and a message composer. **Chat** and **Combat** toggle those message groups; the dropdown filters individual channels and the clock toggles timestamps. The destination button beside the message field chooses where you send.

<Media id="chat-overview" detail />

## Keep the world clickable

Chat history is **click-through by default**. You can see messages while selecting, steering and interacting with the world behind them, so the buffer does not take that space away from play.

Activate the history when you want to scroll, select text or follow a link:

- **Hold Control** (**Command** on macOS) for temporary interaction. Release it to let clicks through again.
- Click **Interact with chat history** to keep it interactive; toggle it off or press **Escape** when finished.

<Media id="chat" detail />

## Send a message

Press **Enter** to type a message. Choose the destination, type, and send; sending returns you to the game. If a command suggestion is highlighted, Enter accepts that suggestion first.

## Discover commands as you type

Start typing a command to see matching suggestions, their syntax and a short description. Browse with the arrow keys and accept with **Tab** or **Enter**—handy for finding a command without leaving the game to look it up.

Input history lets you reuse commands you have already sent.

Type `/help` for the command list or `/help COMMAND` for one command. Both `/` and `@` can introduce commands. Chat commands also include utilities such as waypoints, recalls and corpse permissions.

<Media id="chat-completion" detail />

## Use links in chat

With chat history interactive, click:

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
