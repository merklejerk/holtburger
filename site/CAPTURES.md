# Media capture handoff

Generated from `authoring/captures.json`, the media catalog and actual page placements. Edit those sources rather than this report.

The website works without these captures. This is the final-session shot list, not a prerequisite to writing or deployment. Start with the **First** shots; the rest can be collected when convenient. All footage involving live characters, special account/server state, or an interactive TUI belongs to the user. Fixture images must be labeled as UI illustrations, never as gameplay evidence.

Keep originals outside Git and publish processed files through [MEDIA.md](MEDIA.md). Record the client version, use readable text scale, hide credentials, and leave a second of stillness before/after each action. Prefer short clips over one long recording.

## 3D controls and active play

Use a safe outdoor area with several nearby creatures or objects, a short practice jump, and enough health/stamina. Keep movement and targeting defaults for the demonstration. Record short clips with key presses visible.

### Smart Tab in action

**First · user · pending · clip** — ID: `smart-tab`

- Setup: Several eligible targets; show peace/combat stance and targeting preferences.
- Frame: Keep the target HUD, a few candidates and the key display in frame.
- Action/purpose: Hold to acquire a target, tap to cycle, then interact or attack. Show selection separately from the action.
- Expected result: A hold acquires a target; taps and Shift+Tab cycle; interaction/attack is a separate deliberate action.
- Used in: [3d/#keep-your-attention-on-the-game](https://merklejerk.github.io/holtburger/3d/#keep-your-attention-on-the-game), [3d/combat/#use-smart-tab-in-combat](https://merklejerk.github.io/holtburger/3d/combat/#use-smart-tab-in-combat), [gallery/#clips](https://merklejerk.github.io/holtburger/gallery/#clips)

### From preview to landing

**First · user · pending · clip** — ID: `jump-demo`

- Setup: A repeatable, safe short jump with the landing visible.
- Frame: Show the character, target, trajectory and power bar together.
- Action/purpose: Choose a target and power, inspect the jump trajectory, then execute the leap.
- Expected result: The chosen preview and executed landing are visible in one continuous clip.
- Used in: [3d/movement-camera/#read-the-preview](https://merklejerk.github.io/holtburger/3d/movement-camera/#read-the-preview), [gallery/#clips](https://merklejerk.github.io/holtburger/gallery/#clips)

### Camera and mouse steering

**First · user · pending · clip** — ID: `camera`

- Setup: Open ground with a landmark to compare character facing.
- Frame: Keep the character and landmark visible; label mouse buttons.
- Action/purpose: Compare left-drag orbit, right-drag turning, and mouse-button movement.
- Expected result: Orbit leaves facing alone; right-hold steers, and middle/both buttons move forward.
- Used in: [3d/movement-camera/#look-around-or-steer](https://merklejerk.github.io/holtburger/3d/movement-camera/#look-around-or-steer)

### The combat HUD

**First · user · pending · clip** — ID: `combat-controls`

- Setup: A safe target, melee weapon and optional ranged weapon/ammunition.
- Frame: Close enough to read the curved power/accuracy arc, height buttons, play/pause icon and ammunition; keep the selected target visible.
- Action/purpose: Show the curved power/accuracy arc, height buttons and play/pause control, then use them through a short melee and missile encounter.
- Expected result: The new layout is recognizable, with adjustment and start/cancel shown in melee and missile stances.
- Used in: [3d/#keep-attack-controls-within-reach](https://merklejerk.github.io/holtburger/3d/#keep-attack-controls-within-reach), [3d/combat/#your-attack-controls](https://merklejerk.github.io/holtburger/3d/combat/#your-attack-controls)

### Selection and combat at a glance

**First · user · pending · clip** — ID: `target-indicators`

- Setup: Use several nearby creatures or objects. Start an attack, then select another object while the attack continues.
- Frame: Keep the character, targets and input display visible.
- Action/purpose: Show the bold selected-object outline and the separate reticle on an active combat target.
- Expected result: Show the bold selected-object outline and the separate reticle on an active combat target.
- Used in: [3d/combat/#keep-track-of-your-target](https://merklejerk.github.io/holtburger/3d/combat/#keep-track-of-your-target)

### Keep moving through the windup

**First · user · pending · clip** — ID: `mobile-combat`

- Setup: Use a character with a caster, bow and ammunition in a safe fight.
- Frame: Keep the character, targets and input display visible.
- Action/purpose: Show running while casting, then archery while moving, with normal movement keys visible.
- Expected result: Show running while casting, then archery while moving, with normal movement keys visible.
- Used in: [3d/#stay-mobile](https://merklejerk.github.io/holtburger/3d/#stay-mobile), [3d/combat/#fight-on-the-move](https://merklejerk.github.io/holtburger/3d/combat/#fight-on-the-move)

### Watch for a name

**Later · user · pending · clip** — ID: `nearby-alerts`

- Setup: A known nearby name and a repeatable matching encounter.
- Frame: Show the rule editor/pattern preview, then the list and resulting notice.
- Action/purpose: Create an alert using a glob, show its match preview, then show a real matching encounter notification.
- Expected result: The glob matches expected names and produces one useful encounter notification.
- Used in: [3d/nearby/#add-a-name-alert](https://merklejerk.github.io/holtburger/3d/nearby/#add-a-name-alert)

### Choose an emote

**Later · user · pending · clip** — ID: `emotes`

- Setup: A character able to perform a standard emote, starting in combat stance.
- Frame: Show the T wheel, selection and full character gesture.
- Action/purpose: Open the T emote wheel, perform an emote, and show the previous combat stance returning.
- Expected result: The emote plays and the previous combat stance returns; release-to-dismiss can be a separate beat.
- Used in: [3d/chat/#use-an-emote](https://merklejerk.github.io/holtburger/3d/chat/#use-an-emote)

## Equipment, inventory and spells

Use a character with two gear choices, stackable supplies, an Ust, two expendable salvage materials, a usable spellbook/caster, and a vendor nearby. Save valuables outside the salvage batch.

### Equipment loadouts

**First · user · pending · clip** — ID: `loadouts`

- Setup: Two weapon/gear arrangements, with one slot intentionally omitted and an empty included slot.
- Frame: Capture the builder, result icon/bar cell, and equipment changes; split into short steps if needed.
- Action/purpose: Choose which slots a loadout includes, bind it, and show the resulting equipment change.
- Expected result: Included, omitted and cleared slots have visibly different outcomes.
- Used in: [3d/#prepare-your-next-move](https://merklejerk.github.io/holtburger/3d/#prepare-your-next-move), [3d/equipment-loadouts/#choose-what-changes](https://merklejerk.github.io/holtburger/3d/equipment-loadouts/#choose-what-changes), [gallery/#clips](https://merklejerk.github.io/holtburger/gallery/#clips)

### Find a spell and bind it

**First · user · pending · clip** — ID: `spells`

- Setup: Known spells in several schools/levels and an empty spell-bar cell.
- Frame: Keep search, filters and destination bar readable.
- Action/purpose: Search and filter the spellbook, then drag a spell into an action bar.
- Expected result: A found spell is inspected and dragged to its bar, then used with the correct target.
- Used in: [3d/#prepare-your-next-move](https://merklejerk.github.io/holtburger/3d/#prepare-your-next-move), [3d/spells/#build-your-spell-bars](https://merklejerk.github.io/holtburger/3d/spells/#build-your-spell-bars)

### Review a mixed salvage batch

**First · user · pending · still** — ID: `salvage`

- Setup: Two expendable materials, including a stack; prepare but do not submit the batch.
- Frame: Close view of Items to salvage and Estimated output; retain all quantities.
- Action/purpose: Show two materials, their estimated outputs, and one queued stack with its full quantity.
- Expected result: Whole-stack inclusion and separate material output rows are visible.
- Used in: [3d/crafting/#check-the-estimate](https://merklejerk.github.io/holtburger/3d/crafting/#check-the-estimate)

### Open a locked container

**Later · user · pending · clip** — ID: `locks`

- Setup: A real locked chest/door, at least one key, trained Lockpick and a usable pick.
- Frame: Show the locked object and helper; keep estimate and result text readable.
- Action/purpose: Show the key action and lockpick estimate at a real locked chest, with the outcome visible.
- Expected result: The key attempt and available lockpick action/result can be understood.
- Used in: [3d/crafting/#pick-the-lock](https://merklejerk.github.io/holtburger/3d/crafting/#pick-the-lock)

### Buy and sell

**Later · user · pending · clip** — ID: `vendor`

- Setup: A nearby vendor, enough currency, one purchase and one expendable sale.
- Frame: Show stock, queue quantities, balances and Trade feedback.
- Action/purpose: Queue a purchase and a sale, adjust quantities, review balances, and show the completed trade.
- Expected result: A reviewed purchase/sale completes and the resulting balances/items are visible.
- Used in: [3d/crafting/#buy-or-sell-at-a-vendor](https://merklejerk.github.io/holtburger/3d/crafting/#buy-or-sell-at-a-vendor)

### Pack and equip

**Later · user · pending · clip** — ID: `inventory-moves`

- Setup: Two packs, mergeable stacks and an equippable item; Native sorting selected.
- Frame: Keep source and destination plus the equipment strip visible.
- Action/purpose: Use Native sorting to move an item between packs, merge a stack, equip and unequip.
- Expected result: Reordering/transfers, merging and equip/unequip have clear visible results.
- Used in: [3d/inventory/#move-and-equip](https://merklejerk.github.io/holtburger/3d/inventory/#move-and-equip)

### Make space in a bag

**Later · user · pending · clip** — ID: `inventory-merge`

- Setup: Several partially filled compatible stacks in one bag, with free space for a split.
- Frame: Show the Y quantity prompt, bag Auto-merge action and completion feedback.
- Action/purpose: Split a stack with Y, then request bag Auto-merge and show the resulting stack and freed-slot feedback.
- Expected result: The split amount, merged stacks and freed-slot feedback are readable.
- Used in: [3d/inventory/#auto-merge-a-bag](https://merklejerk.github.io/holtburger/3d/inventory/#auto-merge-a-bag)

### Build a useful action bar

**Later · user · pending · clip** — ID: `action-bars`

- Setup: Usable item and saved loadout, plus room to clone a bar.
- Frame: Keep drag sources, bar menu/layout controls and keyboard focus hints in view.
- Action/purpose: Bind an item and a loadout, clone and rotate a bar, then focus it and activate a cell by keyboard.
- Expected result: Binding, cloning, rotation and keyboard activation are understandable.
- Used in: [3d/equipment-loadouts/#arrange-and-manage](https://merklejerk.github.io/holtburger/3d/equipment-loadouts/#arrange-and-manage)

## World, party and character states

Group location-dependent work together: a party member for trade/party, an owned or permitted house, an active contract, an outdoor death location when convenient, and your server’s barber service. These shots can wait until the relevant state occurs naturally.

### Read the ground ahead

**First · user · pending · clip** — ID: `minimap`

- Setup: Use an outdoor route and a dungeon entrance.
- Frame: Keep the minimap readable beside the surrounding scene.
- Action/purpose: Show outdoor terrain, buildings, impassable areas and elevation, then a dungeon layout.
- Expected result: Show outdoor terrain, buildings, impassable areas and elevation, then a dungeon layout.
- Used in: [3d/#read-the-route-ahead](https://merklejerk.github.io/holtburger/3d/#read-the-route-ahead), [3d/maps-travel/#navigate-with-the-minimap](https://merklejerk.github.io/holtburger/3d/maps-travel/#navigate-with-the-minimap)

### Review both offers

**Later · user · pending · still** — ID: `player-trade`

- Setup: A consenting second player with a small sample offer on each side.
- Frame: Frame the whole trade window with both participants and confirmation/reset controls.
- Action/purpose: Show both trade offers, acceptance status, and the withdraw/reset controls using sample participants.
- Expected result: Both offers and acceptance states are readable; no valuable exchange is required.
- Used in: [3d/crafting/#trade-with-another-player](https://merklejerk.github.io/holtburger/3d/crafting/#trade-with-another-player)

### Mark the next stop

**Later · user · pending · clip** — ID: `waypoints`

- Setup: An outdoor character and open World map/chat.
- Frame: Show command input, coordinate link and map pin without a full-screen chat zoom.
- Action/purpose: Set a waypoint from chat coordinates, then follow its direction and distance on the minimap.
- Expected result: Set a waypoint from chat coordinates; show its world map pin and minimap direction and distance while traveling, then clear it.
- Used in: [3d/maps-travel/#follow-a-waypoint](https://merklejerk.github.io/holtburger/3d/maps-travel/#follow-a-waypoint)

### Prepare a house payment

**Later · user · pending · still** — ID: `housing-payments`

- Setup: A house crystal with a real purchase/maintenance requirement and suitable carried items.
- Frame: Show eligibility/payment rows and Auto-fill; stop before payment unless desired.
- Action/purpose: Show a house crystal requirement, carried payment items, Auto-fill and the prepared amounts.
- Expected result: Prepared amounts and remaining requirements are readable.
- Used in: [reference/housing/#inspect-a-house-crystal](https://merklejerk.github.io/holtburger/reference/housing/#inspect-a-house-crystal)

### Separate entry from storage

**Later · user · pending · still** — ID: `housing-access`

- Setup: An owned/permitted house and sample guest entries.
- Frame: Show Access & guests with separate entry/storage controls and names safe to publish.
- Action/purpose: Show guest entry and storage permissions with sample names and the current house owner.
- Expected result: Entry permission is visibly separate from storage permission.
- Used in: [reference/housing/#manage-access](https://merklejerk.github.io/holtburger/reference/housing/#manage-access)

### Track a contract

**Later · user · pending · still** — ID: `journal`

- Setup: An in-progress or repeatable contract with a contact/quest location.
- Frame: Show filtered contract details, a timer and its map destination; use two stills if needed.
- Action/purpose: Show a filtered contract with progress, repeat or deadline timer, and its map destination.
- Expected result: Progress/timing and the useful destination are clear.
- Used in: [reference/journal/#find-a-contract](https://merklejerk.github.io/holtburger/reference/journal/#find-a-contract)

### Find your way back

**Later · user · pending · clip** — ID: `corpse-recovery`

- Setup: A naturally available outdoor death location and recoverable nearby corpse; no deliberate death required.
- Frame: Show /corpse, the coordinate link, map waypoint and V cycling in short connected steps.
- Action/purpose: Show a real outdoor death location, /corpse output, a coordinate link becoming a waypoint, and nearby corpse cycling.
- Expected result: The recorded location helps navigation without implying the record proves current contents.
- Used in: [3d/maps-travel/#find-your-way-back](https://merklejerk.github.io/holtburger/3d/maps-travel/#find-your-way-back)

### Keep the party in view

**Later · user · pending · still** — ID: `party`

- Setup: A small party with a leader and another visible member.
- Frame: Show the roster/recruitment controls and party HUD together at a readable scale.
- Action/purpose: Show the party roster and in-world party HUD, including leader and recruitment controls.
- Expected result: The leader, membership and selected member can be identified.
- Used in: [3d/maps-travel/#form-a-party](https://merklejerk.github.io/holtburger/3d/maps-travel/#form-a-party)

### A change of appearance

**Later · user · pending · still** — ID: `barber`

- Setup: Your server’s barber interaction, with heritage-specific choices available.
- Frame: Crop Barbershop with appearance choices and Apply/Cancel.
- Action/purpose: Show the Barbershop appearance controls, heritage-specific choices and Apply/Cancel actions.
- Expected result: The choices and explicit Apply action are clear; applying is optional.
- Used in: [reference/appearance/#barbershop](https://merklejerk.github.io/holtburger/reference/appearance/#barbershop)

## Launcher, setup and UI stills

Use sample server/account names. Hide passwords and personal paths. Choose a comfortable UI/text scale; frame the relevant panel closely enough that its controls are readable.

### Make room for your HUD

**First · user · pending · still** — ID: `hud`

- Setup: Several HUD elements in a normal gameplay view; choose one small and one larger text size.
- Frame: Two matched stills or one comparison image with the world visible.
- Action/purpose: Show rearranged panels and the difference between UI scaling and text scaling.
- Expected result: Panel placement and UI/text scale differences are clear without cropping controls.
- Used in: [3d/#make-the-interface-yours](https://merklejerk.github.io/holtburger/3d/#make-the-interface-yours), [3d/interface/#move-and-resize-the-hud](https://merklejerk.github.io/holtburger/3d/interface/#move-and-resize-the-hud)

### Add your server

**First · user · pending · still** — ID: `launcher`

- Setup: A sample server/profile with account filled and password hidden.
- Frame: Frame server/profile choices, account and Play; omit private machine details.
- Action/purpose: Show the launcher server entry and Play action using sample connection details.
- Expected result: Readers can identify each step used by the connection guide.
- Used in: [startup/servers/#add-your-account](https://merklejerk.github.io/holtburger/startup/servers/#add-your-account)

### Choose your game data

**Later · user · pending · still** — ID: `content-picker`

- Setup: First-launch folder selection with a complete retail DAT folder available.
- Frame: Show the folder-level choice and enough file names to identify the correct directory; use a neutral path.
- Action/purpose: Show the first-launch folder picker with a complete retail DAT folder selected.
- Expected result: The reader can distinguish selecting the folder from selecting one DAT file.
- Used in: [startup/settings/#need-the-dats](https://merklejerk.github.io/holtburger/startup/settings/#need-the-dats)

### Plan a skill improvement

**Later · user · pending · still** — ID: `character-progression`

- Setup: A character sheet with a trainable skill and an affordable improvement quote; do not buy unintentionally.
- Frame: Show the skill and cost, with a second still for the Train confirmation.
- Action/purpose: Show a skill detail and its cost, plus the separate confirmation for training a new skill.
- Expected result: Immediate improvement cost and separately confirmed training are distinguishable.
- Used in: [reference/character/#improve-a-stat-or-train-a-skill](https://merklejerk.github.io/holtburger/reference/character/#improve-a-stat-or-train-a-skill)

### From playing to reading chat

**Later · user · pending · clip** — ID: `chat`

- Setup: Sample conversation with coordinates and harmless text.
- Frame: Keep the chat history, its interaction toggle and part of the world visible. Show modifier keys; omit private conversations.
- Action/purpose: Show command autocomplete with syntax and descriptions, then temporary history interaction and returning to play.
- Expected result: Start with click-through live messages. Hold Control (Command on macOS) to scroll and select text; release to resume live messages. Toggle history interaction for longer reading, then turn it off. Show Enter to compose and sending to return to play. Type a partial command, show suggestions with syntax and descriptions, then choose and accept one.
- Used in: [3d/chat/#filter-the-noise](https://merklejerk.github.io/holtburger/3d/chat/#filter-the-noise)

### Inspect an item

**Later · user · pending · still** — ID: `item-appraisal`

- Setup: An ordinary item with requirements, effects and effective combat values.
- Frame: Crop the appraisal window with title and relevant fields; no test errors or missing artwork.
- Action/purpose: Show item requirements and effective values in a readable appraisal window.
- Expected result: A reader can find requirements and effective values at website size.
- Used in: [3d/inventory/#examine](https://merklejerk.github.io/holtburger/3d/inventory/#examine)

### Create an adventurer

**Later · user · pending · clip** — ID: `character-creation`

- Setup: An unused character slot and a server on which creating a sample character is acceptable.
- Frame: Show appearance, Skills & Stats and review in separate short beats.
- Action/purpose: Show appearance, Skills & Stats, and review; finish at the selected new character before entering the world.
- Expected result: Creation finishes on the selected new roster entry before explicit world entry.
- Used in: [startup/creation/#review-and-create](https://merklejerk.github.io/holtburger/startup/creation/#review-and-create)

### Graphics troubleshooting

**Later · user · pending · still** — ID: `hardware-info`

- Setup: Launcher App settings open to graphics; machine details safe to show.
- Frame: Crop the relevant controls and Copy hardware info, without dumping the full report into the image.
- Action/purpose: Show the launcher graphics settings and Copy hardware info action.
- Expected result: The troubleshooting action is easy to locate.
- Used in: [support/#graphics-or-startup-trouble](https://merklejerk.github.io/holtburger/support/#graphics-or-startup-trouble), [support/graphics/#report-a-rendering-problem](https://merklejerk.github.io/holtburger/support/graphics/#report-a-rendering-problem)

## TUI gameplay and scripts

Use a real terminal session with a prepared character and the shipped scripts. Show pane focus and the footer; choose a large enough terminal font for the final website size. All interactive TUI capture belongs to the user.

### Around the terminal dashboard

**First · user · pending · clip** — ID: `tui-workflow`

- Setup: Normal gameplay with nearby targets and carried items.
- Frame: Keep dashboard, context and footer visible; record Tab focus changes.
- Action/purpose: Move between nearby entities, inventory and appraisal; show focus and the available footer actions.
- Expected result: Pane focus, tab selection and Assess results are legible.
- Used in: [tui/#a-client-you-can-play](https://merklejerk.github.io/holtburger/tui/#a-client-you-can-play), [tui/basics/#choose-a-dashboard-tab](https://merklejerk.github.io/holtburger/tui/basics/#choose-a-dashboard-tab)

### Run a bundled script

**First · user · pending · clip** — ID: `tui-script`

- Setup: A prepared fighter or mage, with appropriate supplies and a safe test encounter.
- Frame: Show /scripts, /run, useful script feedback, and /unrun without long idle time.
- Action/purpose: Start a fighter or mage, show its feedback, then stop it and resume manual control.
- Expected result: The script starts, makes a visible decision, then stops so manual control resumes.
- Used in: [tui/#a-client-you-can-script](https://merklejerk.github.io/holtburger/tui/#a-client-you-can-script), [tui/bundled-scripts/#mage](https://merklejerk.github.io/holtburger/tui/bundled-scripts/#mage), [tui/running-scripts/#start-in-the-world](https://merklejerk.github.io/holtburger/tui/running-scripts/#start-in-the-world), [gallery/#clips](https://merklejerk.github.io/holtburger/gallery/#clips)

### A task through the TUI

**Later · user · pending · clip** — ID: `tui-gameplay`

- Setup: An inventory task plus a quantity prompt or vendor trade.
- Frame: Keep changing footer actions and resulting items/quantities visible.
- Action/purpose: Move an inventory item, inspect its details, and show a quantity prompt or vendor review with the changing footer actions.
- Expected result: The reader can follow a multi-step task without guessing which pane has focus.
- Used in: [tui/gameplay/#trading-and-salvage](https://merklejerk.github.io/holtburger/tui/gameplay/#trading-and-salvage)
