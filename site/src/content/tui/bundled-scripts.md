---
title: 'Bundled fighter & mage'
description: 'Start with the shipped automation, then tune it for your character.'
section: 'Terminal client · Automation'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Fighter

Start with `/run fighter`. The fighter handles survival priorities, nearby healing and party support, then chooses fights while staying within its party movement limits. When there is nothing else to do, it stays with the party leader.

Startup arguments can adjust its engagement and party distances:

```text
/run fighter --aggro-dist 15 --max-party-dist 20
```

Have suitable equipment, healing supplies and skills ready. Watch the first encounters to see whether those distances and supplies fit your character.

## Mage

Start with `/run mage`. The mage chooses spells from its available spellbook and data, manages restoration, and supports party following and combat.

Keep the bundled `mage.js`, `mage.data.json` and `mage.data.bin` together. Local preferences belong in `SCRIPT_DIR/.config/mage.config.json`:

```json
{
	"preferredSpells": [],
	"bannedSpells": []
}
```

The arrays accept spell IDs or spell key names from the script's data. Preferred spells rank ahead of other valid choices; banned spells are excluded. Empty lists use the ordinary selection without your own preferences.

<Media id="tui-script" />

## Make it your own

Check feedback, equipment, spell knowledge and supplies before leaving a run to continue. Use `/unrun` to stop the script.

For trade services, buffing or specialized routes, write a script tailored to those tasks.

For the authoring workflow and API, start with [your first script](/holtburger/tui/scripting/).
