# Holtburger Scripting Guide

This guide is a quickstart and reference for script authors working against the `holtburger-scripting` crate and the TUI runtime that embeds it.

The runtime is intentionally small and opinionated:

- Scripts are plain JavaScript files loaded by basename.
- The host exposes a frozen global object named `HB`, with `Holtburger` as an alias.
- Scripts receive structured events and can emit typed intents back to the frontend.
- Scripts can make small JSON-only HTTP requests through `HB.postJson()` when the frontend allows it.
- HTTP access is hard-gated by the TUI's launch-time allowlist. If you do not explicitly allow a host, the request is rejected.
- Script-specific config is local-only; script data can be local or bundled.

For platform-specific install guidance and the writable script directory defaults, see the root [README](../../README.md#installation-and-first-run).

## Embedded Runtime Limits

The scripting host is an embedded Deno Core runtime, NOT the full Deno CLI or a general-purpose Node environment. You will not have access to raw filesystem ops, generic networking, or node libraries. The exported `HB` API is all you get.

Practical constraints to keep in mind:

- The host loads one JavaScript source per script. It does not manage a module graph for you.
- There is no first-class TypeScript execution path at runtime. TypeScript needs to be compiled before the script is run.
- You cannot `import()` or `require()` dependencies. If you want external dependencies, bundle them into the final JavaScript file.
- The host injects `HB`/`Holtburger` and structured events, but it does not provide a browser DOM or UI framework runtime.
- The only network helper is `HB.postJson()`, and the TUI may deny requests that are outside its launch-time allowlist.
- Long synchronous work will block the script host. Keep heavy work out of the hot path.

The safest assumption is that a Holtburger script should be a small, deterministic control loop that reacts to client state and emits a few focused actions.

## Quickstart

1. Put a script in your writable local script directory, using the basename you want to run.
2. Run the TUI.
3. Use `/run <BASENAME> [ARGS...]` to start the script, or `/scripts` to inspect what the client can see.

If you issue `/run` before the client has entered the world and the player entity is available, the client logs a warning and ignores the command.

The simplest useful script is usually an event handler that logs a little state and then grows from there.

```js
const config = HB.loadConfig() ?? { enabled: true };

HB.onEvent((event) => {
  if (event.kind === "lifecycle" && event.data.kind === "started") {
    HB.debugLog(`started with args: ${event.data.args}`);
    HB.print("info", "hello from Holtburger");
    return;
  }

  if (event.kind === "lifecycle" && event.data.kind === "tick") {
    if (config.enabled === false) {
      return;
    }

    const self = HB.selfEntity();
    if (!self) {
      return;
    }

    HB.debugLog(`${self.name}: ${self.health}/${self.healthMax}`);
  }
});
```

The repo includes a larger example in [scripts/fighter.js](../../scripts/fighter.js).

## HTTP Requests

`HB.postJson()` is the only network helper in the embedded runtime. It is intentionally narrow:

- Only `POST` is supported.
- The request and response bodies are JSON-only.
- Scripts cannot set custom headers.
- The host always sends Holtburger-identifying `Origin` and `User-Agent` headers.
- The TUI decides which exact host and port pairs are allowed at launch time, and its command-line args also set the request timeout and maximum response size.
- The `--script-fetch-allow-host` flag accepts either `HOST:PORT` or `http(s)://HOST[:PORT]` and normalizes both forms to a host plus port allowlist entry.
- By default, the only allowed host is `localhost:9999`.
- Requests to any host other than the launch-time allowlist are denied before the HTTP request is sent.
- The HTTP work runs off the main script-host thread, and the Promise settles on the next normal host pump.

Typical usage with error handling:

```js
(async () => {
  try {
    const response = await HB.postJson({
      url: "http://localhost:9999/status",
    });

    if (!response.ok) {
      HB.print("warn", `helper returned HTTP ${response.status}`);
      return;
    }

    HB.debugLog(JSON.stringify(response.bodyJson));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "unknown";
    const message = error instanceof Error ? error.message : String(error);
    HB.print("error", `fetch failed (${code}): ${message}`);
  }
})();
```

Failures such as timeouts, denied hosts, malformed URLs, oversize responses, and transport errors reject the promise with an `Error` whose `code` is a stable snake_case string such as `timeout` or `policy_denied`.

## Script Layout

The runtime resolves scripts by basename. If both the writable local directory and the bundled `scripts/` tree contain the same basename, the local script wins.

Typical local layout:

```text
<SCRIPT_DIR>/
  my-bot.js
  my-bot.data.json
  .config/
    my-bot.config.json
```

The filenames mean:

- `<BASENAME>.js` is the script entrypoint.
- `<BASENAME>.data.json` is optional script data, usually checked in or bundled.
- `.config/<BASENAME>.config.json` is script-local config and always lives in the writable local tree.

## Runtime Model

Scripts are executed in a fresh Deno-based runtime that the frontend owns. The runtime injects the `HB`/`Holtburger` global and then loads your script.

The host then dispatches structured events to every handler registered with `HB.onEvent(handler)`.

Two practical consequences matter when you write scripts:

- Keep module-level state small and explicit. It lives only for the lifetime of the running script host.
- Put persistent values in `HB.loadConfig()` / `HB.writeConfig()` or in `HB.loadData()` if the data is static and meant to ship with the script.

## TypeScript Workflow

TypeScript is a good fit for authoring, but the runtime expects JavaScript output. The usual workflow is:

1. Write your source in TypeScript.
2. Type-check it with `tsc`.
3. Bundle or transpile the result into a single JavaScript file.
4. Place the generated `.js` output in the writable script directory.

Useful patterns:

- Keep authoring sources in a separate tree from the generated runtime script.
- Emit one bundled `.js` file per runnable script basename.
- Generate source maps during development if your bundler supports them.
- Keep the runtime-facing entrypoint small and let helper modules disappear into the bundle.

There is an experimental Holtburger API typedef file at [holtburger.d.ts](holtburger.d.ts).

> [!TIP]
> Even if you aren't using TS, the typedef file can serve as a complete reference for the API shapes.

## Bundler Suggestions

Any bundler that can flatten a dependency graph into a single browser-style or IIFE-style JavaScript file works well.

Practical options:

- `esbuild` for fast local iteration and a tiny config surface.
- `tsup` if you want a TypeScript-first wrapper around `esbuild`.
- `rollup` if you want more control over output shape and plugin composition.
- `vite` if you already use it elsewhere and just want a build step that emits a bundle.

Suggested build rules:

- Target plain JavaScript output that does not depend on runtime module loading.
- Avoid package-manager-only assumptions in the shipped file.
- Prefer a single output file per script basename so the CLI can load it directly.
- Keep any script data tables separate from the generated code if the data is meant to be edited or shipped independently.

Example `esbuild` command:

```bash
esbuild src/index.ts --bundle --platform=browser --format=iife --target=es2020 --outfile=dist/fighter.js
```

That kind of workflow maps well to Holtburger because the runtime wants one runnable `.js` file and does not need the rest of your source tree at launch time.

## Events

`HB.onEvent(handler)` registers a function that receives every structured event from the host. Handlers are called synchronously in registration order.

The event payloads are plain JSON objects serialized from the Rust `ScriptEvent` enums. The exact field names come from the Rust types in [src/types.rs](src/types.rs), and the top-level event kinds are lowercase snake_case:

- `lifecycle`
- `chat_message`
- `combat_feedback`
- `workflow`
- `command`
- `weenie_error`
- `self_vitals_changed`
- `entity_appeared`
- `entity_disappeared`
- `entity_updated`
- `teleport_started`
- `player_killed`
- `inventory_changed`
- `spellbook_changed`
- `party_changed`

Lifecycle events are especially important:

- `started` fires when the host is ready. It includes an `args` string from `/run`, which is empty when no extra arguments were provided.
- `stopped` fires when the script is shutting down.
- `tick` fires on the normal update cadence and carries `elapsed_seconds`.

The most common pattern is to handle `started` for one-time setup and `tick` for repeatable decision making.

## Reading State

Use the read helpers to inspect the current client snapshot.

### Core Snapshot Helpers

- `HB.selfEntity()` returns the player's own snapshot, or `null` if the client is not ready.
- `HB.characterSheet()` returns the current attributes, vitals, and skills snapshot, or `null` if the client is not ready.
- `HB.currentInteraction()` returns the current interaction state, such as target, approach, follow, or attack, or `null` if none is active.
- `HB.combatInfo()` returns the current combat mode and related combat state; if no client snapshot is available yet, it returns the default empty combat view.
- `HB.currentTradeInfo()` returns the active trade state, including the trade partner and both item lists, or `null` if no trade is active.
- `HB.party()` returns the current party snapshot, or `null` if the client is not in a party.
- `HB.currentOpenContainer()` returns the guid of the currently open container, or `null`.
- `HB.serverTime()` returns the current server time as a number, or `0` if the client has not synced yet.
- `HB.pendingConfirmation()` returns the active confirmation dialog snapshot, or `null` if no confirmation is open.
- `HB.busyOperation()` returns the current busy operation state as a snake_case string, or `none` when the client is idle.
- `HB.inventory()` returns container views for the current inventory, or an empty array if the client snapshot is not ready.
- `HB.equipment()` returns a JavaScript `Map` keyed by snake_case equipment slot name, with values containing `equipMask` and `itemGuid`; if no snapshot is available, it returns an empty map.

### World Queries

- `HB.entity(guid)` returns a single entity snapshot, or `null` if the guid is not known in the current client snapshot.
- `HB.entityExists(guid)` checks whether a guid is known to the current client snapshot; it returns `false` when the snapshot is unavailable.
- `HB.nearbyEntities(maxDistance, classifications)` returns nearby entity snapshots, optionally limited by distance in meters and filtered by snake_case entity kinds such as `player`, `monster`, or `container`.
- `HB.distance(from, to)` computes the distance in meters between positions or guids; if the snapshot is unavailable, it returns `0`.
- `HB.headingTo(from, to)` computes the heading in radians from one position or guid to another; if the snapshot is unavailable, it returns `0`.

### Character and Combat Helpers

- `HB.enchantments()` returns the active enchantment list, where each entry contains a spell id and end time; if the snapshot is unavailable, it returns an empty array.
- `HB.spellbook()` returns the player's spell ids, or an empty array if the snapshot is unavailable.
- `HB.inSpellbook(spellId)` checks whether the given spell id is in the spellbook; it returns `false` when the snapshot is unavailable.

### Property Accessors

These helpers read low-level entity properties by guid and property id:

- `HB.entityBoolProp(guid, prop)` returns a boolean property value, or `null` if the guid or property id is unknown.
- `HB.entityIntProp(guid, prop)` returns an integer property value, or `null` if the guid or property id is unknown.
- `HB.entityInt64Prop(guid, prop)` returns a 64-bit integer property value as a JSON number, or `null` if the guid or property id is unknown.
- `HB.entityFloatProp(guid, prop)` returns a floating-point property value, or `null` if the guid or property id is unknown.
- `HB.entityStringProp(guid, prop)` returns a string property value, or `null` if the guid or property id is unknown.
- `HB.entityDataProp(guid, prop)` returns the referenced data guid, or `null` if the guid or property id is unknown.
- `HB.entityInstanceProp(guid, prop)` returns the referenced instance guid, or `null` if the guid or property id is unknown.

Use them when the higher-level snapshots do not expose the data you need yet.

## Emitting Actions

The write side of the API emits frontend intents or direct client actions.

### Logging and Chat

- `HB.print(style, message)` emits a script message into the chat buffer. Accepted styles include `trace`, `debug`, `info`, `warn`, `warning`, `error`, `system`, `chat`, `combat`, `tell`, `emote`, `party`, `guild`, `trade`, `help`, `society`, and `magic`; unknown values fall back to `info`.
- `HB.debugLog(message)` sends a message to the frontend debug log.
- `HB.say(message)` sends in-game chat text.
- `HB.emote(message)` sends an emote message.
- `HB.soulEmote(token)` sends a retail soul emote on the dedicated soul-emote transport. Pass the full token without surrounding asterisks, for example `wave`.

### Client Interaction

- `HB.targetEntity(guid)` requests that the client target the given entity.
- `HB.approach(guid)` requests movement toward the given entity.
- `HB.follow(guid)` requests following the given entity.
- `HB.attack(guid)` requests attacking the given entity.
- `HB.setCombatMode(on)` requests combat mode on (`true`) or off (`false`).
- `HB.cancelInteraction()` cancels the current client interaction workflow.

### Movement and Combat

- `HB.snapHeading(heading)` requests an immediate heading snap in radians.
- `HB.scoot(distanceMeters)` requests a short forward scoot by the given distance in meters.
- `HB.castSpell(spellId, target)` queues a spell cast by id, optionally against a target guid; pass `null` to omit the target.
- `HB.respondToConfirmation(accepted)` accepts or declines the currently open confirmation dialog.

### Inventory and Containers

- `HB.openContainer(guid)` requests opening the given container guid.
- `HB.closeContainer(guid)` requests closing the given container guid.
- `HB.moveItem(item, container)` moves an item into a container.
- `HB.stackItems(source, destination, amount)` moves a stack amount from one item to another.
- `HB.splitItem(item, container, amount)` splits the given amount into the destination container.
- `HB.combine(source, dest)` combines the source item with the destination item.
- `HB.useWith(source, dest)` is an alias for `HB.combine(source, dest)` and emits the same intent.
- `HB.salvage(tool, items)` salvages the listed item guids using the given tool guid.
- `HB.assess(target)` requests an assess action on the target guid.
- `HB.drop(item)` drops the item.
- `HB.pickup(item, container)` picks up the item from the given container, or from the world when `container` is `null`.
- `HB.equip(guid, slot)` equips the item into the named slot. Slot names use snake_case values such as `head_wear`, `melee_weapon`, or `cloak`.
- `HB.unequip(guid)` unequips the item with the given guid.

### Trade

- `HB.openTrade(guid)` requests opening a trade with the given entity guid.
- `HB.addToTrade(item)` adds an item to the current trade offer.
- `HB.acceptTrade()` accepts the current trade offer.
- `HB.declineTrade()` declines the current trade offer.
- `HB.resetTrade()` clears the current trade offer without leaving the trade session.
- `HB.exitTrade()` leaves the trade session.

## Persistence

Script persistence is intentionally split into two different concerns.

### Config

- `HB.loadConfig()` reads the script-local config from `.config/<BASENAME>.config.json`, or returns `null` if no config exists yet.
- `HB.writeConfig(contents)` writes a string or JSON-serializable value to the same file and returns a boolean success flag.

Use config for user preferences, toggles, and state that should survive script reloads but stay local to the machine.

### Data

- `HB.loadData()` reads optional script data, checking the writable local script directory first and then the bundled script tree, or returns `null` if no data is available.
- `HB.loadDataBin()` reads optional binary script data from `<BASENAME>.data.bin`, checking the writable local script directory first and then the bundled script tree, or returns `null` if no binary data is available.

Use data for shipped tables, lookup data, and other script-owned resources that should be versioned with the script but may be overridden locally.

## Practical Conventions

- Prefer one top-level `HB.onEvent(...)` registration per script unless you have a strong reason to split handlers.
- Treat `started` as initialization and `tick` as the steady-state control loop.
- Keep action emission idempotent when possible. The same tick can be revisited many times while the client state is stable.
- Store durable state in config, not in globals.
- Use `HB.loadData()` for data tables that should travel with the script.

## Reference Source

If you need the exact runtime contract, these are the source files to read next:

- [src/host.rs](src/host.rs) for the JavaScript host and `HB` API surface
- [src/types.rs](src/types.rs) for the serializable script event and intent types
