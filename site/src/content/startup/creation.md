---
title: 'Character creation'
description: 'Build your character with attributes and skills together.'
section: 'Startup'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Plan your build

**Skills & Stats** puts attributes, starting vitals and skills together. Skills are grouped by specialized, trained and untrained status, so you can review the build as you allocate points.

## Finish your appearance

Adjust your appearance in the preview. The clothing reroll lets you try another starting outfit while keeping your chosen features.

## Review and create

Check the final review and choose **Create character**. The new character is selected in the roster, ready to enter the world.

<div class="media-sequence">
<div class="media-sequence-controls" role="group" aria-label="Character builder screenshots">
<label class="button"><input type="radio" name="creation-page" value="race" checked /> Race</label>
<label class="button"><input type="radio" name="creation-page" value="appearance" /> Appearance</label>
<label class="button"><input type="radio" name="creation-page" value="build" /> Skills & Stats</label>
<label class="button"><input type="radio" name="creation-page" value="review" /> Review</label>
</div>
<div class="media-sequence-page" data-media-page="race"><Media id="character-creation" /></div>
<div class="media-sequence-page" data-media-page="appearance"><Media id="creation-appearance" /></div>
<div class="media-sequence-page" data-media-page="build"><Media id="creation-build" /></div>
<div class="media-sequence-page" data-media-page="review"><Media id="creation-review" /></div>
</div>
