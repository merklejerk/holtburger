---
title: 'Make the interface yours'
description: 'Arrange the HUD and keep useful information close.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Move and resize the HUD

Choose **Unlock UI layout** to edit the layout. Move the HUD elements and use the available resize controls, then choose **Lock UI layout** when finished.

Give frequently used controls comfortable positions before a fight. You can arrange windows and bars separately; leave room for chat, targeting and the world view.

If you want to start over, use **Settings → HUD layout → Reset HUD placements**.

<Media id="hud" />

## Scale controls and text separately

Use overall UI scale to change control sizes, and text scale to adjust readability. Start with the text size you can comfortably read, then fit the controls around it.

Appearance settings also let you choose fonts and themes. Traveler's Kit provides the leather-and-copper treatment used as inspiration for this site.

## Keep useful information visible

Vital warnings, progression feedback and the selected-target HUD help you notice changes without opening another panel. [Nearby alerts](/holtburger/3d/interface/) can call attention to names you are watching for.

Use `/fps` to toggle the FPS display when adjusting graphics. For startup or rendering trouble, see [Help](/holtburger/support/).

## Save the right things

Your preferences are saved on this computer. Action-bar contents, spell bindings and alert rules are saved separately for each character.

## Send a message

Press **Enter** to type a message. Choose the destination, type, and send; sending returns you to the game. If a command suggestion is highlighted, Enter accepts that suggestion first.

Use command completions and input history to avoid retyping familiar commands.

Type `/help` for the command list or `/help COMMAND` for one command. Both `/` and `@` can introduce commands. Chat commands also include utilities such as waypoints, recalls and corpse permissions.

## Read older messages

Chat normally follows new messages and lets you click through the history into the world. To scroll back, select text or click a coordinate link, hold **Control** (**Command** on macOS) while using the history. Release it to return to live messages.

For longer reading, use **Interact with chat history** to keep the history active. It holds your place while you scroll back. Turn the toggle off when finished to resume following new messages.

Typing also makes the history interactive. Clicking the history switches from typing to reading; press **Enter** to return to your message. **Escape** leaves the history or clears the message you are editing and returns control to the game. If command suggestions are open, the first Escape dismisses them.

Use message and channel filters to keep relevant conversations visible. The timestamp control adds or removes times beside messages.

Chat settings can also suppress your own evasion/resist notices and spell incantations when those messages crowd the history.

<Media id="chat" />

## Speak to an NPC

Interact with the NPC and use the offered dialogue or reply controls when available. Keep the conversation visible while choosing a response.

## Use an emote

Hold **T** to open the emote wheel. Click an emote, or select it with **Space** or **Enter**. Releasing T dismisses the wheel. Recent choices make repeated gestures easier to find.

When an emote requires peace, Holtburger can switch temporarily and restore the previous combat stance afterward.

<Media id="emotes" />

## Narrow the nearby list

Open **Nearby** to browse entities around you. Search names and use the category, tracked-name and sorting controls to reduce the list to what you need.

Select an entry when you want a particular target. For everyday combat selection, [Smart Tab](/holtburger/3d/combat/) is usually the quicker starting point.

## Add a name alert

Use the name-alert control on a nearby entry for an exact match, or create a rule in the alert editor. Choose how the name should match:

| Match      | Example          | Matches                              |
| ---------- | ---------------- | ------------------------------------ |
| Exact name | `Drudge Prowler` | That full name                       |
| Substring  | `Drudge`         | Names containing that text           |
| Name glob  | `Drudge *`       | A full name beginning with `Drudge ` |

Matches ignore capitalization. In a glob, `*` matches any text and `?` matches one character. Use a backslash to match a literal `*`, `?`, or backslash.

Check the editor's preview against nearby names, then save the rule.

<Media id="nearby-alerts" />

## Tune the list

Enable or disable individual rules as needed, and delete rules you no longer use. Rules are saved for the character.

Alerts notify you about matching nearby encounters without repeating the same notice continuously. Choose patterns specific enough that the notifications stay useful.
