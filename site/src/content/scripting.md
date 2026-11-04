---
title: 'Your first script'
description: 'Write a small JavaScript handler, run it in the TUI, and build from there.'
section: 'Scripting'
---

<script>
import hello from '../../examples/hello.js?raw';
</script>

## Say hello

Save this as `hello.js` in your writable `SCRIPT_DIR`, or [download the example](/holtburger/assets/scripting/hello.js):

<pre><code>{hello}</code></pre>

Enter the world in the TUI, then run:

```text
/run hello a first test
```

The script prints a greeting and sends its startup arguments to the debug log. Use `/unrun` to stop it. `/scripts` shows status and the local script directory.

## React to the game

`HB.onEvent` receives lifecycle, game-state, chat, combat and workflow events. Read current state through helpers such as `HB.selfEntity()` or `HB.inventory()`, then request a focused action.

Handle startup for setup and tick events for repeated decisions. Check for missing state and wait for feedback before repeating an action; sending an action does not mean it has finished.

## Choose your next step

- [Runtime and persistence](/holtburger/scripting/runtime/): events, sidecar files, TypeScript and bundling.
- [API reference](/holtburger/scripting/reference/): state helpers, actions and exact types.
- [HTTP integrations](/holtburger/scripting/integrations/): communicate with a JSON service.
- [Bundled scripts](/holtburger/tui/bundled-scripts/): larger examples already shipped with the client.
