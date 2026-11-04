---
title: 'Crafting, trading & salvage'
description: 'Prepare your materials and offers, then review before committing.'
section: '3D client'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Use an item on a target

Activate the crafting tool or ingredient, then choose the item to use it on. Follow the targeting prompt; **Escape** cancels target selection.

## Review the attempt

With **Confirm crafting attempts with success chance** enabled in gameplay settings, review the offered chance and confirm when ready. Check the target and materials before accepting an attempt that can consume or destroy them.

Read the result in chat and inspect the resulting item. For breaking items down into materials, use [salvage](/holtburger/3d/crafting/).

## Buy or sell at a vendor

Interact with the vendor to open its shop. Drag stock into the trade queue to buy; drag carried items into the queue to sell.

Check quantities, available stock, and the projected currency balances. Remove unwanted entries or use **Clear** to start over. Press **Trade** when the queue and totals are right.

Wait for the result before preparing another trade. If the price, stock, range or inventory changes, review the updated feedback and adjust your queue.

<Media id="vendor" />

## Trade with another player

Select the other player and interact to open a trade. Add your items and inspect both offers before confirming.

Use **Confirm trade** when your side is ready. Both players' acceptance is shown. **Withdraw acceptance** lets you take back your confirmation; **Reset offers** clears both offers.

If either offer changes, check the contents again before accepting. Wait for the completed transfer before leaving the window.

<Media id="player-trade" />

## Give a single item

For a direct handoff to a player or NPC, use [Give](/holtburger/3d/inventory/#give-an-item): select the recipient, select the item, then press **G**.

## Open the helper

Try to use a locked door or container. With the unlock helper enabled, Holtburger offers the available key and lockpick actions.

The helper is enabled by default. Automatic key use is a separate setting and starts disabled.

## Try your keys

Choose **Try all keys** to try the distinct keys available in your inventory. The helper shows how many are available and reports the result.

If you prefer this to happen when you encounter a lock, enable **Automatically try inventory keys** under **Settings → Gameplay → Locks**. If the keys do not open it, the helper can offer the lockpick fallback.

## Pick the lock

The helper presents the best usable pick for your trained lockpicking skill. Check the pick and the success estimate when one is available, then activate the pick action.

Keep an eye on pick uses and cooldowns. If the attempt fails, read the result before trying again or changing tools. You can cancel the workflow when you want to move on.

<Media id="locks" />

## Build a batch

Use an **Ust**, or select a carried item and choose **Salvage**. Drag more items into **Items to salvage**.

You can include different materials in one batch. Each material has its own estimated output row, showing units and workmanship.

Items stay in your inventory while you prepare the batch. Use an item's remove button or drag it out of the queue to remove it; **Clear** empties the queue.

## Check the estimate

Holtburger appraises missing item details as needed. If an item cannot be appraised, read its explanation and use **Retry** when ready. The batch must have a valid review before **Salvage** is available.

**Whole stacks are included.** Split a stack first if you only want to salvage part of it.

<Media id="salvage" />

## Confirm

Check the queued items, then press **Salvage** and review the destruction confirmation. Salvaged items are consumed. The output rows are estimates; check the resulting bags in inventory afterward.
