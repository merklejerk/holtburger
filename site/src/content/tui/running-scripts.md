---
title: 'Run and manage scripts'
description: 'Start a bundled or personal script, inspect its status, and stop it when needed.'
section: 'Terminal client · Automation'
---

<script>
import Media from '#lib/components/Media.svelte';
</script>

## Start in the world

Enter the world, then use:

```text
/scripts
/run fighter
/unrun
```

`/scripts` shows script status, any queued startup, your local directory, and discovered scripts. `/run NAME` starts `NAME.js`; `/unrun` stops it and clears queued startup.

**Only one script runs at a time.** Starting another replaces the current script.

Use `/script MESSAGE` to send a command to the active script. What the message means depends on that script.

<Media id="tui-script" />

## Keep personal files separate

Set `SCRIPT_DIR` to a writable directory for your scripts and preferences. Keep it outside the extracted release folder so updates do not replace your work.

```text
my-scripts/
  hello.js
  hello.data.json
  .config/
    hello.config.json
```

Run `/run hello`, without the extension. A local script with the same basename as a bundled script takes precedence. `/scripts` helps check which directory the client is using.

## Start a script at launch

Add `--character NAME --run fighter` to your usual connection command. Use `--run-args 'TEXT'` when the script accepts startup arguments. Startup waits until the character is ready.

For a supervised process, `-Q` / `--auto-quit` exits on disconnect so an external supervisor can restart it.

See the [launch options](/holtburger/tui/reference/options/) for logging and connection flags, or [write your first script](/holtburger/tui/scripting/).
