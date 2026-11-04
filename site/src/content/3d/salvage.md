---
title: 'Salvaging'
description: 'Review a batch and its estimated materials before destroying items.'
section: '3D client · Items & equipment'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

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

Temporarily suppressing the confirmation does not make salvage automatic: you still prepare each batch and press **Salvage**.
