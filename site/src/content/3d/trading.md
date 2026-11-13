---
title: 'Buying & trading'
description: 'Shop at vendors, exchange offers with players, or give an item directly.'
section: '3D client'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
import Media from '#lib/components/Media.svelte';
</script>

<IllustratedProse name="drudge">

## Buy or sell at a vendor

Interact with the vendor to open its shop. Drag stock into the trade queue to buy; drag carried items into the queue to sell.

Equipment in vendor stock is appraised automatically to show [cantrip-tier borders](/holtburger/3d/inventory/#recognize-cantrip-tiers). Inspect the item for its spells and requirements before deciding.

Check quantities, available stock, and the projected currency balances. Remove unwanted entries or use **Clear** to start over. Press **Trade** when the queue and totals are right.

Wait for the result before preparing another trade. If the price, stock, range or inventory changes, review the updated feedback and adjust your queue.

</IllustratedProse>

<Media id="vendor" detail />

## Trade with another player

Select the other player and interact to open a trade. Add your items and inspect both offers before confirming.

Equipment in the other player’s offer is also appraised automatically to show cantrip-tier borders.

Use **Confirm trade** when your side is ready. Both players' acceptance is shown. **Withdraw acceptance** lets you take back your confirmation; **Reset offers** clears both offers.

If either offer changes, check the contents again before accepting. Wait for the completed transfer before leaving the window.

<Media id="player-trade" detail />

## Give a single item

For a direct handoff to a player or NPC, use [Give](/holtburger/3d/interactions/#give-an-item): select the recipient, select the item, then press **G**.
