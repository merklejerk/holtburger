# Media capture handoff

Generated from `authoring/captures.json`, the media catalog and actual page placements. Edit those sources rather than this report.

The website works without these captures. This is the final-session shot list, not a prerequisite to writing or deployment. Start with the **First** shots; the rest can be collected when convenient. The agent owns static component crops and the assigned scripted UI clips, using the local test server. The user owns movement, combat, camera and natural-control clips, plus all interactive TUI capture. The user reviews the first static samples before bulk capture. Fixture images must be labeled as UI illustrations, never as gameplay evidence.

Keep originals outside Git and publish processed files through [MEDIA.md](MEDIA.md). Record the client version, use readable text scale, hide credentials, and leave a second of stillness before/after each action. Prefer short clips over one long recording.

## 3D controls and active play

Use a safe outdoor area with several nearby creatures or objects, a short practice jump, and enough health/stamina. Keep movement and targeting defaults for the demonstration. Record short clips with key presses visible.

### Smart Tab in action

**First · user · available · clip** — ID: `smart-tab`

- Setup: Several eligible targets; show peace/combat stance and targeting preferences.
- Frame: Keep the target HUD, a few candidates and the key display in frame.
- Expected result: A hold acquires a target; taps and Shift+Tab cycle; interaction/attack is a separate deliberate action.
- Used in: [3d/combat/#use-smart-tab-in-combat](https://merklejerk.github.io/holtburger/3d/combat/#use-smart-tab-in-combat), [gallery/#clips](https://merklejerk.github.io/holtburger/gallery/#clips)

### From preview to landing

**First · user · available · clip** — ID: `jump-demo`

- Setup: A repeatable, safe short jump with the landing visible.
- Frame: Show the character, target, trajectory and power bar together.
- Expected result: The chosen preview and executed landing are visible in one continuous clip.
- Used in: [3d/movement-camera/#precise-jumping](https://merklejerk.github.io/holtburger/3d/movement-camera/#precise-jumping), [gallery/#clips](https://merklejerk.github.io/holtburger/gallery/#clips)

### Camera and mouse steering

**First · user · available · clip** — ID: `camera`

- Setup: Open ground with a landmark to compare character facing.
- Frame: Keep the character and landmark visible; label mouse buttons.
- Expected result: Orbit leaves facing alone; right-hold steers, and middle/both buttons move forward.
- Used in: [3d/movement-camera/#look-around-or-steer](https://merklejerk.github.io/holtburger/3d/movement-camera/#look-around-or-steer)

### Melee combat HUD

**First · agent · available · still** — ID: `combat-controls`

- Setup: A melee weapon equipped in combat stance.
- Frame: Crop the curved HUD with power, height and start/stop controls.
- Expected result: The unfamiliar layout and its controls are recognizable.
- Used in: [3d/combat/#your-attack-controls](https://merklejerk.github.io/holtburger/3d/combat/#your-attack-controls)

### A closer look

**First · agent · available · still** — ID: `creature-appraisal`

- Setup: A player appraisal with a loaded 3D model and useful character details.
- Frame: Crop the appraisal window; show the model and identity clearly.
- Expected result: The reader recognizes the model preview; prose explains rotation and independent selection.
- Used in: [3d/inspecting/#turn-the-model-around](https://merklejerk.github.io/holtburger/3d/inspecting/#turn-the-model-around)

### Selected-entity actions

**First · agent · available · still** — ID: `selected-hud`

- Setup: A selected player with several available actions.
- Frame: Crop only the selected-entity HUD and its open menu; keep labels readable.
- Expected result: Show a tight crop of the selected name, health bar, magnifying glass and open actions menu.
- Used in: [3d/interactions/#use-the-selected-entity-hud](https://merklejerk.github.io/holtburger/3d/interactions/#use-the-selected-entity-hud)

### Cast on the run

**First · user · available · clip** — ID: `run-casting`

- Setup: A caster, usable spell and safe route with room to run.
- Frame: Keep the running character and cast animation visible. Spellbook and unrelated windows closed; agree framing with the user.
- Expected result: The character continues moving throughout the windup and the completed spell is visible.
- Used in: [3d/combat/#fight-on-the-move](https://merklejerk.github.io/holtburger/3d/combat/#fight-on-the-move), [3d/spells/#cast-on-the-move](https://merklejerk.github.io/holtburger/3d/spells/#cast-on-the-move)

### Chat history and controls

**First · user · available · still** — ID: `chat-overview`

- Setup: Show the chat buffer with messages and its controls.
- Frame: Crop the full chat panel, including activation icon, filters and composer.
- Expected result: Introduce the chat panel and identify its controls.
- Used in: [3d/chat/#your-chat-panel](https://merklejerk.github.io/holtburger/3d/chat/#your-chat-panel)

### Keep your selection in sight

**First · user · available · still** — ID: `selection-outline`

- Setup: Select or attack a creature in the world.
- Frame: Crop the creature and enough scene context to identify its indicator.
- Expected result: Show the selected outline through an obstruction.
- Used in: [3d/combat/#keep-track-of-your-target](https://merklejerk.github.io/holtburger/3d/combat/#keep-track-of-your-target)

### Your active combat target

**First · user · available · still** — ID: `combat-reticle`

- Setup: Select or attack a creature in the world.
- Frame: Crop the creature and enough scene context to identify its indicator.
- Expected result: Show the reticle marking the active combat target.
- Used in: [3d/combat/#keep-track-of-your-target](https://merklejerk.github.io/holtburger/3d/combat/#keep-track-of-your-target)

### Open Nearby

**First · user · available · still** — ID: `nearby-button`

- Setup: Show the minimap’s Nearby button.
- Frame: Crop the button with its minimap rim for orientation.
- Expected result: Locate the control that opens the entity list and alerts.
- Used in: [3d/nearby/#narrow-the-nearby-list](https://merklejerk.github.io/holtburger/3d/nearby/#narrow-the-nearby-list)

### Choose an emote

**Later · agent · available · still** — ID: `emotes`

- Setup: The emote wheel open.
- Frame: Crop the wheel with its choices and recent emotes.
- Expected result: The reader can recognize and choose from the wheel.
- Used in: [3d/chat/#use-an-emote](https://merklejerk.github.io/holtburger/3d/chat/#use-an-emote)

### A message becomes a destination or target

**Later · agent · available · still** — ID: `chat-links`

- Setup: A coordinate message and a real entity alert in the same chat buffer.
- Frame: Crop to the two linked messages and the history-interaction control.
- Expected result: Show coordinate and entity-alert links in the chat buffer with history interaction enabled.
- Used in: [3d/chat/#use-links-in-chat](https://merklejerk.github.io/holtburger/3d/chat/#use-links-in-chat)

### Find something nearby

**Later · agent · available · still** — ID: `nearby-list`

- Setup: Several nearby creatures or objects with distinguishable names.
- Frame: Crop the Nearby panel with an active search and a short result list.
- Expected result: Show the Nearby name search, useful filters and matching results.
- Used in: [3d/nearby/#narrow-the-nearby-list](https://merklejerk.github.io/holtburger/3d/nearby/#narrow-the-nearby-list)

### Missile combat HUD

**Later · agent · available · still** — ID: `combat-controls-missile`

- Setup: A bow equipped with ammunition, in combat stance.
- Frame: Crop the curved HUD with accuracy, height and ammunition.
- Expected result: The reader recognizes the missile variation and ammunition display.
- Used in: [3d/combat/#your-attack-controls](https://merklejerk.github.io/holtburger/3d/combat/#your-attack-controls)

## Equipment, inventory and spells

Use a character with two gear choices, stackable supplies, an Ust, two expendable salvage materials, a usable spellbook/caster, and a vendor nearby. Save valuables outside the salvage batch.

### Equipment loadouts

**First · agent · available · clip** — ID: `loadouts`

- Setup: Two weapon/gear arrangements, with one slot intentionally omitted and an empty included slot.
- Frame: Crop the builder and destination bar. Stop once the preset is saved; do not demonstrate gear changes.
- Expected result: The reader can create and save a loadout; prose explains what applying it changes.
- Used in: [3d/equipment-loadouts/#choose-what-changes](https://merklejerk.github.io/holtburger/3d/equipment-loadouts/#choose-what-changes), [gallery/#clips](https://merklejerk.github.io/holtburger/gallery/#clips)

### Find a spell and bind it

**First · agent · available · clip** — ID: `spells`

- Setup: Known spells in several schools/levels and an empty spell-bar cell.
- Frame: Keep the spell search, filters and destination bar readable, then close the spellbook before casting. The final framing must include the character and cast effect.
- Expected result: A spell is found, inspected and bound, then cast with the book closed so the animation and result are visible.
- Used in: [3d/spells/#set-up-your-bar](https://merklejerk.github.io/holtburger/3d/spells/#set-up-your-bar)

### Review a mixed salvage batch

**First · agent · available · still** — ID: `salvage`

- Setup: Two expendable materials, including a stack; prepare but do not submit the batch.
- Frame: Use a tight component crop; retain relevant controls and enough context to follow the task. Close view of Items to salvage and Estimated output; retain all quantities.
- Expected result: Whole-stack inclusion and separate material output rows are visible.
- Used in: [3d/crafting/#review-the-salvage-output](https://merklejerk.github.io/holtburger/3d/crafting/#review-the-salvage-output)

### All your packs in one view

**First · agent · available · clip** — ID: `inventory-overview`

- Setup: Two populated packs with varied item names and types; equipment visible alongside contents.
- Frame: Crop the inventory panel. Show both bag headings in the shared scroll view, jump using a pack icon, then cycle Native, Alphabetical and Item type sorting.
- Expected result: The reader understands that bags share a scrolling view and sorting reorganizes each bag visually without moving items.
- Used in: [3d/inventory/#see-your-packs-together](https://merklejerk.github.io/holtburger/3d/inventory/#see-your-packs-together)

### The equipment strip

**First · agent · available · still** — ID: `equipment-strip`

- Setup: A few equipped items, with the strip scrolled to its top and its toolbar visible.
- Frame: Crop only the equipment strip: equipped slots, scroll controls and helmet/cloak/loadout toolbar. Exclude adjacent bag contents.
- Expected result: The reader recognizes the equipment slots and can locate the visibility and loadout controls.
- Used in: [3d/inventory/#equipment-at-a-glance](https://merklejerk.github.io/holtburger/3d/inventory/#equipment-at-a-glance)

### Your active enchantments

**First · user · available · still** — ID: `enchantments`

- Setup: Several real active effects with readable remaining durations.
- Frame: Crop only the populated Enchantments window; wait for all visible spell icons to load and show groups, remaining time and search/filter controls.
- Expected result: The reader recognizes the effect groups and can find durations and filtering controls.
- Used in: [3d/spells/#read-your-current-effects](https://merklejerk.github.io/holtburger/3d/spells/#read-your-current-effects)

### Find a spell or cast from the list

**First · user · available · still** — ID: `spell-list`

- Setup: Open the Spells tab with filters and one spell expanded.
- Frame: Crop the full panel, keeping filters, details and Cast buttons visible.
- Expected result: Show spell discovery and direct casting from the list.
- Used in: [3d/spells/#browse-your-spellbook](https://merklejerk.github.io/holtburger/3d/spells/#browse-your-spellbook)

### Your spell shortcuts

**First · user · available · still** — ID: `spell-bar`

- Setup: Populate a spell tab with several spells.
- Frame: Crop the spell bar, including tab selectors and shortcut hints.
- Expected result: Introduce the spell bar before explaining how to populate it.
- Used in: [3d/spells/#cast-from-your-spell-bar](https://merklejerk.github.io/holtburger/3d/spells/#cast-from-your-spell-bar)

### Item shortcuts with alternate actions

**First · user · available · still** — ID: `action-bar-intro`

- Setup: Populate an action bar and hover a targeted item shortcut.
- Frame: Crop the bar and tooltip, keeping the Shift-click alternate action readable.
- Expected result: Introduce direct item shortcuts, default self-use and alternate targeting.
- Used in: [3d/action-bars/#more-than-item-shortcuts](https://merklejerk.github.io/holtburger/3d/action-bars/#more-than-item-shortcuts)

### Alternate currency totals

**First · user · available · still** — ID: `inventory-currencies`

- Setup: Carry several alternate currencies and open the currency popup.
- Frame: Crop the inventory footer and readable alternate-currency totals.
- Expected result: Show the currency summary across carried packs.
- Used in: [3d/inventory/#check-your-currencies](https://merklejerk.github.io/holtburger/3d/inventory/#check-your-currencies)

### Choose your title

**First · user · available · still** — ID: `character-title`

- Setup: Open the earned-title selector in Character → Progression.
- Frame: Crop the character header and expanded title list.
- Expected result: Show how to choose an earned character title.
- Used in: [3d/character/#choose-a-title](https://merklejerk.github.io/holtburger/3d/character/#choose-a-title)

### Helmet and cloak visibility

**First · user · available · still** — ID: `appearance-toggles`

- Setup: Show helmet and cloak visibility controls in Inventory.
- Frame: Crop the controls beneath the equipment strip.
- Expected result: Locate the helmet and cloak appearance toggles.
- Used in: [3d/appearance/#show-or-hide-your-helmet-and-cloak](https://merklejerk.github.io/holtburger/3d/appearance/#show-or-hide-your-helmet-and-cloak)

### Open a locked container

**Later · agent · available · clip** — ID: `locks`

- Setup: A real locked chest/door, at least one key, trained Lockpick and a usable pick.
- Frame: Keep the locked entity and the unlock helper in frame together, with the viewport feedback animation visible.
- Expected result: The reader sees the key/lockpick actions and their success or failure overlay on the actual target.
- Used in: [3d/locks/#pick-the-lock](https://merklejerk.github.io/holtburger/3d/locks/#pick-the-lock)

### Review a vendor exchange

**Later · agent · available · still** — ID: `vendor`

- Setup: One purchase and one sale queued at a vendor.
- Frame: Crop the vendor window with stock, both queued items and the balance.
- Expected result: The reader recognizes the reviewed exchange and Trade button.
- Used in: [3d/trading/#buy-or-sell-at-a-vendor](https://merklejerk.github.io/holtburger/3d/trading/#buy-or-sell-at-a-vendor)

### Auto-merge a bag

**Later · agent · available · still** — ID: `inventory-merge`

- Setup: An inventory pack-strip or bag-header context menu open.
- Frame: Crop the bag control and popup, with Auto-merge readable.
- Expected result: The reader can find the Auto-merge action.
- Used in: [3d/inventory/#auto-merge-a-bag](https://merklejerk.github.io/holtburger/3d/inventory/#auto-merge-a-bag)

### Action-bar menu

**Later · agent · available · still** — ID: `action-bars`

- Setup: A filled action bar with its menu expanded.
- Frame: Frame just the bar and popup; all four menu actions are readable.
- Expected result: The reader can locate Clear, Cycle, Clone and Delete.
- Used in: [3d/action-bars/#arrange-and-manage](https://merklejerk.github.io/holtburger/3d/action-bars/#arrange-and-manage)

### Review a crafting attempt

**Later · agent · available · still** — ID: `crafting-confirmation`

- Setup: A trained Cooking skill, Flour and Water, with crafting-chance confirmation enabled.
- Frame: Crop the real chance-confirmation dialog. Identify the attempted recipe in its caption or surrounding guide text.
- Expected result: The server-reported chance and explicit accept/decline controls are readable.
- Used in: [3d/crafting/#review-the-attempt](https://merklejerk.github.io/holtburger/3d/crafting/#review-the-attempt)

### Split a stack

**Later · agent · available · still** — ID: `inventory-split`

- Setup: A carried stack with the split quantity dialog open.
- Frame: Crop the modal with item name, amount, slider and Split button.
- Expected result: The quantity choice is clear without showing the whole inventory.
- Used in: [3d/inventory/#split-a-stack](https://merklejerk.github.io/holtburger/3d/inventory/#split-a-stack)

## World, party and character states

Group location-dependent work together: a party member for trade/party, an owned or permitted house, an active contract, an outdoor death location when convenient, and your server’s barber service. These shots can wait until the relevant state occurs naturally.

### Terrain under your radar

**First · agent · available · still** — ID: `minimap`

- Setup: Outdoor minimap with useful terrain, buildings and impassable zones.
- Frame: Crop the minimap at a readable scale.
- Expected result: The reader sees the terrain information available around them.
- Used in: [3d/maps-travel/#navigate-with-the-minimap](https://merklejerk.github.io/holtburger/3d/maps-travel/#navigate-with-the-minimap)

### Read the world map

**First · agent · available · still** — ID: `world-map-controls`

- Setup: Open the World map with a recognizable location and its visibility controls.
- Frame: Crop to the map panel; keep labels and layer controls readable.
- Expected result: Crop the World map with its visibility controls, a useful destination and pan/zoom context.
- Used in: [3d/maps-travel/#read-the-world-map](https://merklejerk.github.io/holtburger/3d/maps-travel/#read-the-world-map)

### Recall destinations

**First · user · available · still** — ID: `recall-menu`

- Setup: Open Recall destinations on the world map.
- Frame: Crop the menu and its trigger with destination labels readable.
- Expected result: Show the map’s recall destination menu.
- Used in: [3d/maps-travel/#recall](https://merklejerk.github.io/holtburger/3d/maps-travel/#recall)

### Party vitals at a glance

**First · user · available · still** — ID: `party-hud`

- Setup: Show the party HUD with a full roster.
- Frame: Crop the teammate cards and vital bars.
- Expected result: Show the compact party HUD and its member vitals.
- Used in: [3d/community/#form-a-party](https://merklejerk.github.io/holtburger/3d/community/#form-a-party)

### Your allegiance

**First · user · available · still** — ID: `allegiance`

- Setup: Open Social’s Allegiance tab with relationship details visible.
- Frame: Crop the panel with membership, relationships and contributed XP readable.
- Expected result: Show allegiance relationships and membership details.
- Used in: [3d/community/#allegiance](https://merklejerk.github.io/holtburger/3d/community/#allegiance)

### Search for housing on the map

**First · user · available · still** — ID: `housing-map`

- Setup: Enable a housing search overlay on the world map.
- Frame: Show the map with house markers distributed across the results.
- Expected result: Show housing search results as a world-map overlay.
- Used in: [3d/housing/#find-housing](https://merklejerk.github.io/holtburger/3d/housing/#find-housing), [3d/maps-travel/#read-the-world-map](https://merklejerk.github.io/holtburger/3d/maps-travel/#read-the-world-map)

### Manage your house

**First · user · available · still** — ID: `housing-management`

- Setup: Open the Housing tab for an owned home with maintenance and property details expanded.
- Frame: Crop the tab with access, decoration and advanced sections visible.
- Expected result: Introduce the house management controls and maintenance summary.
- Used in: [3d/housing/#manage-your-house](https://merklejerk.github.io/holtburger/3d/housing/#manage-your-house)

### Review both offers

**Later · agent · available · still** — ID: `player-trade`

- Setup: A consenting second player with a small sample offer on each side.
- Frame: Use a tight component crop; retain relevant controls and enough context to follow the task. Frame the whole trade window with both participants and confirmation/reset controls.
- Expected result: Both offers and acceptance states are readable; no valuable exchange is required.
- Used in: [3d/trading/#trade-with-another-player](https://merklejerk.github.io/holtburger/3d/trading/#trade-with-another-player)

### Your destination on the map

**Later · agent · available · still** — ID: `waypoints`

- Setup: A waypoint set on the world map.
- Frame: Crop the destination pin and enough map labels to orient it.
- Expected result: The reader recognizes a marked destination.
- Used in: [3d/maps-travel/#follow-a-waypoint](https://merklejerk.github.io/holtburger/3d/maps-travel/#follow-a-waypoint)

### Prepare a house payment

**Later · agent · available · still** — ID: `housing-payments`

- Setup: A house crystal with a real purchase/maintenance requirement and suitable carried items.
- Frame: Use a tight component crop; retain relevant controls and enough context to follow the task. Show eligibility/payment rows and Auto-fill; stop before payment unless desired.
- Expected result: Prepared amounts and remaining requirements are readable.
- Used in: [3d/housing/#inspect-a-house-crystal](https://merklejerk.github.io/holtburger/3d/housing/#inspect-a-house-crystal)

### Track a contract

**Later · agent · available · still** — ID: `journal`

- Setup: An in-progress or repeatable contract with a contact/quest location.
- Frame: Use a tight component crop; retain relevant controls and enough context to follow the task. Show filtered contract details, a timer and its map destination; use two stills if needed.
- Expected result: Progress/timing and the useful destination are clear.
- Used in: [3d/journal/#find-a-contract](https://merklejerk.github.io/holtburger/3d/journal/#find-a-contract)

### Find your way back

**Later · user · available · still** — ID: `corpse-recovery`

- Setup: A real saved outdoor death location shown by /corpse.
- Frame: Crop the chat output and clickable coordinates.
- Expected result: The reader can locate the saved death coordinates; prose explains setting a waypoint.
- Used in: [3d/maps-travel/#find-your-way-back](https://merklejerk.github.io/holtburger/3d/maps-travel/#find-your-way-back)

### Keep the party in view

**Later · agent · available · still** — ID: `party`

- Setup: A small party with a leader and another visible member.
- Frame: Show the roster/recruitment controls and party HUD together at a readable scale.
- Expected result: The leader, membership and selected member can be identified.
- Used in: [3d/community/#form-a-party](https://merklejerk.github.io/holtburger/3d/community/#form-a-party)

### A change of appearance

**Later · agent · available · still** — ID: `barber`

- Setup: Your server’s barber interaction, with heritage-specific choices available.
- Frame: Crop Barbershop with appearance choices and Apply/Cancel.
- Expected result: The choices and explicit Apply action are clear; applying is optional.
- Used in: [3d/appearance/#barbershop](https://merklejerk.github.io/holtburger/3d/appearance/#barbershop)

### Dungeon map and breadcrumbs

**Later · user · available · still** — ID: `minimap-dungeon`

- Setup: A dungeon minimap after walking a winding route.
- Frame: Crop the minimap with passages and breadcrumb trail visible.
- Expected result: The reader can distinguish the passage layout and their recent route.
- Used in: [3d/maps-travel/#navigate-with-the-minimap](https://merklejerk.github.io/holtburger/3d/maps-travel/#navigate-with-the-minimap)

### Follow the waypoint

**Later · agent · available · still** — ID: `waypoint-minimap`

- Setup: The same waypoint visible on the minimap.
- Frame: Crop the minimap with direction and distance visible.
- Expected result: The reader recognizes the guidance toward the destination.
- Used in: [3d/maps-travel/#follow-a-waypoint](https://merklejerk.github.io/holtburger/3d/maps-travel/#follow-a-waypoint)

## Launcher, setup and UI stills

Use sample server/account names. Hide passwords and personal paths. Choose a comfortable UI/text scale; frame the relevant panel closely enough that its controls are readable.

### Make room for your HUD

**First · agent · available · still** — ID: `hud`

- Setup: Unlock UI layout in a real gameplay scene.
- Frame: Crop one HUD component with its actual move and resize handles visible; omit unrelated windows.
- Expected result: The component’s layout-editing affordances are clear at guide size.
- Used in: [3d/interface/#move-and-resize-the-hud](https://merklejerk.github.io/holtburger/3d/interface/#move-and-resize-the-hud)

### Choose your world

**First · agent · available · still** — ID: `launcher`

- Setup: A sample server/profile with account filled and password hidden.
- Frame: Frame server/profile choices, account and Play; omit private machine details.
- Expected result: Readers can identify each step used by the connection guide.
- Used in: [startup/launcher/](https://merklejerk.github.io/holtburger/startup/launcher/)

### Find a command as you type

**First · agent · available · clip** — ID: `chat-completion`

- Setup: Chat input with a partial command and multiple suggestions.
- Frame: Crop to the composer and suggestions. Show syntax and descriptions, then accept a suggestion.
- Expected result: Type a partial command, browse suggestions and accept one. Keep the input and suggestion list in frame.
- Used in: [3d/chat/#discover-commands-as-you-type](https://merklejerk.github.io/holtburger/3d/chat/#discover-commands-as-you-type)

### Choose a public server

**First · agent · available · still** — ID: `treestats-import`

- Setup: Open Import from TreeStats with a recognizable public server search.
- Frame: Crop the import dialog; retain search, software, population and the import control.
- Expected result: Show the TreeStats search results, server software and import action.
- Used in: [startup/launcher/#import-your-server](https://merklejerk.github.io/holtburger/startup/launcher/#import-your-server)

### Choose a character

**First · user · available · still** — ID: `character-roster`

- Setup: A character selected in a populated roster, with the equipped 3D preview visible.
- Frame: Use the complete character-selection screen, including the roster, 3D character and scene backdrop.
- Expected result: The reader recognizes the full character-selection experience and can find Enter World and Create character.
- Used in: [startup/characters/#choose-your-character](https://merklejerk.github.io/holtburger/startup/characters/#choose-your-character)

### Your HUD at a glance

**First · user · available · still** — ID: `hud-showcase`

- Setup: Enable /ui-showcase in a real gameplay scene.
- Frame: Full viewport with the HUD components visible and no layout controls.
- Expected result: Introduce the HUD and connect each component to its player guide.
- Used in: [3d/#your-hud-at-a-glance](https://merklejerk.github.io/holtburger/3d/#your-hud-at-a-glance)

### Choose your game data

**Later · agent · available · still** — ID: `content-picker`

- Setup: A launcher profile using an actual retail DAT folder.
- Frame: Crop the content-folder field and Browse/Use application default controls. Native OS file-picker chrome is outside this capture.
- Expected result: The reader can locate the application’s folder selection control and see a selected DAT folder.
- Used in: [startup/game-data/#need-the-dats](https://merklejerk.github.io/holtburger/startup/game-data/#need-the-dats)

### Improve a stat

**Later · agent · available · still** — ID: `character-progression`

- Setup: A character sheet with a trainable skill and an affordable improvement quote; do not buy unintentionally.
- Frame: Use a tight component crop; retain relevant controls and enough context to follow the task. Show the skill and cost, with a second still for the Train confirmation.
- Expected result: Immediate improvement cost and separately confirmed training are distinguishable.
- Used in: [3d/character/#improve-a-stat-or-train-a-skill](https://merklejerk.github.io/holtburger/3d/character/#improve-a-stat-or-train-a-skill)

### Activate chat history

**Later · agent · available · still** — ID: `chat`

- Setup: Inactive chat with its history activation button visible.
- Frame: Close up on the activation icon and a little surrounding chat.
- Expected result: The reader can locate the control that makes chat accept pointer input.
- Used in: [3d/chat/#keep-the-world-clickable](https://merklejerk.github.io/holtburger/3d/chat/#keep-the-world-clickable)

### Inspect an item

**Later · agent · available · still** — ID: `item-appraisal`

- Setup: An ordinary item with requirements, effects and effective combat values.
- Frame: Use a tight component crop; retain relevant controls and enough context to follow the task. Crop the appraisal window with title and relevant fields; no test errors or missing artwork.
- Expected result: A reader can find requirements and effective values at website size.
- Used in: [3d/inspecting/#items](https://merklejerk.github.io/holtburger/3d/inspecting/#items)

### Race

**Later · agent · available · still** — ID: `character-creation`

- Setup: A new character draft on the Race page.
- Frame: Capture the creation page and preview, omitting unrelated application chrome.
- Expected result: The reader recognizes the race choices and character preview.
- Used in: [startup/characters/#create-a-character](https://merklejerk.github.io/holtburger/startup/characters/#create-a-character)

### Graphics troubleshooting

**Later · agent · available · still** — ID: `hardware-info`

- Setup: Launcher App settings open to graphics; machine details safe to show.
- Frame: Crop the relevant controls and Copy hardware info, without dumping the full report into the image.
- Expected result: The troubleshooting action is easy to locate.
- Used in: [3d/help/#report-a-rendering-problem](https://merklejerk.github.io/holtburger/3d/help/#report-a-rendering-problem)

### Save a DAT folder with a profile

**Later · agent · available · still** — ID: `profile-content`

- Setup: A sample launcher profile with its Advanced controls expanded.
- Frame: Crop the content-folder choice and save-profile action; use a neutral sample path.
- Expected result: Show the profile’s content-folder control and the action that saves the change.
- Used in: [startup/game-data/#keep-server-specific-dats-separate](https://merklejerk.github.io/holtburger/startup/game-data/#keep-server-specific-dats-separate)

### Appearance

**Later · agent · available · still** — ID: `creation-appearance`

- Setup: The same draft on the Appearance page.
- Frame: Keep the preview and appearance choices visible.
- Expected result: The reader recognizes the appearance controls and clothing reroll.
- Used in: [startup/characters/#create-a-character](https://merklejerk.github.io/holtburger/startup/characters/#create-a-character)

### Skills & Stats

**Later · agent · available · still** — ID: `creation-build`

- Setup: The same draft with attributes and skills allocated.
- Frame: Show the combined attributes, starting vitals and skill groups.
- Expected result: The reader sees the build together in one place.
- Used in: [startup/characters/#create-a-character](https://merklejerk.github.io/holtburger/startup/characters/#create-a-character)

### Review

**Later · agent · available · still** — ID: `creation-review`

- Setup: The same draft on the final Review page.
- Frame: Show the final build, starting town and Create character action.
- Expected result: The reader can recognize the final review before creation.
- Used in: [startup/characters/#create-a-character](https://merklejerk.github.io/holtburger/startup/characters/#create-a-character)

## TUI gameplay and scripts

Use a real terminal session with a prepared character and the shipped scripts. Show pane focus and the footer; choose a large enough terminal font for the final website size. All interactive TUI capture belongs to the user.

### The TUI at a glance

**First · user · pending · still** — ID: `tui-workflow`

- Setup: A focused dashboard with an assessed entity and context pane.
- Frame: Keep pane boundaries, focus and footer shortcuts legible.
- Action/purpose: Keep pane boundaries, focus and footer shortcuts legible.
- Expected result: The reader recognizes the dashboard, context and input areas.
- Used in: [tui/#a-client-you-can-play](https://merklejerk.github.io/holtburger/tui/#a-client-you-can-play), [tui/basics/#choose-a-dashboard-tab](https://merklejerk.github.io/holtburger/tui/basics/#choose-a-dashboard-tab)

### Run a bundled script

**First · user · pending · clip** — ID: `tui-script`

- Setup: A prepared fighter or mage, with appropriate supplies and a safe test encounter.
- Frame: Show /scripts, /run, useful script feedback, and /unrun without long idle time.
- Action/purpose: Start a fighter or mage, show its feedback, then stop it and resume manual control.
- Expected result: The script starts, makes a visible decision, then stops so manual control resumes.
- Used in: [tui/#a-client-you-can-script](https://merklejerk.github.io/holtburger/tui/#a-client-you-can-script), [tui/bundled-scripts/#mage](https://merklejerk.github.io/holtburger/tui/bundled-scripts/#mage), [tui/running-scripts/#start-in-the-world](https://merklejerk.github.io/holtburger/tui/running-scripts/#start-in-the-world), [gallery/#clips](https://merklejerk.github.io/holtburger/gallery/#clips)

### A TUI quantity prompt

**Later · user · pending · still** — ID: `tui-gameplay`

- Setup: A real inventory or vendor quantity prompt.
- Frame: Show the prompt with relevant item and footer actions.
- Action/purpose: Show the prompt with relevant item and footer actions.
- Expected result: The reader recognizes how a multi-step inventory task is presented.
- Used in: [tui/gameplay/#trading-and-salvage](https://merklejerk.github.io/holtburger/tui/gameplay/#trading-and-salvage)
