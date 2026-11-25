---
title: 'Live API & AI agents'
description: 'Connect bots, external tools, and AI agents to a running 3D or terminal client over localhost.'
section: 'Automation & API'
---

<script>
import IllustratedProse from '#lib/components/IllustratedProse.svelte';
</script>

Holtburger includes an opt-in, localhost-only **Live API** shared by both the 3D client and the terminal client. It exposes typed game state, spatial queries, events, and actions over HTTP and WebSocket—and was designed from the start to be **agent-friendly**, so AI agents can inspect and drive a live session without custom glue code.

<IllustratedProse name="qalabar">

## Connect an AI agent

1. **Enable the Live API:**
   - **3D client:** Open **App settings → Live API** in the launcher, check **Enable localhost Live API**, and press **Save**. Leave the port blank for an automatic ephemeral port, or enter a fixed port. You can also enable it for a single session with `--api` (and `--api-port PORT`).
   - **Terminal client:** Launch `holtburger-cli` with `--api` (and optionally `--api-port PORT`).
2. **Copy the starter prompt:** Enter the world and type `/api prompt` in chat. Holtburger copies a one-sentence prompt containing your running client's local URL to the clipboard.
3. **Paste it into your agent:** Paste the prompt into your AI coding or desktop agent (such as Claude Code, Codex, or Gemini CLI) along with your goal.

The starter prompt directs the agent to `GET /`, which serves a compact Markdown guide and live capability list so the agent can orient itself immediately without flooding its context window.

</IllustratedProse>

## Designed for AI agents

Instead of bolting an LLM wrapper onto a legacy plugin API, the Live API shapes its wire contract around how agents actually reason and work:

| Capability                            | Why it matters for agents                                                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token-efficient guide (`GET /`)       | Returns a concise Markdown primer plus a live header of the client's current lifecycle state and active capabilities, rather than dumping a large spec up front.                                                                               |
| OpenAPI 3.1 (`GET /v1/openapi.json`)  | Authoritative, typed schemas for every route, query, command, preview, event, and WebSocket frame—agents can inspect only the endpoints and types they need.                                                                                   |
| Dry-run previews (`POST /v1/preview`) | Check outdoor coordinate conversions, raycasts, sphere-sweeps, spell readiness, item use, salvage, and vendor math without moving or sending packets to the server.                                                                            |
| Blocking settlement (`wait: settled`) | Commands that finish asynchronously (steering, spells, appraisals, combat stance, inventory actions) can wait for their outcome instead of fragile sleep loops.                                                                                |
| Spatial & visual sensing              | Indoor cell-portal topology (`GET /v1/world/cells`) for dungeon navigation, plus HUD-free 3D viewport screenshots (`GET /v1/screenshot`).                                                                                                      |
| 3D overlays & HUD feedback            | Draw timed ground rings and 3D route polylines directly in the 3D scene (grouped by namespace with auto-expiration), pop HUD toasts, and print local chat lines with clickable coordinates (`42.3N, 15.8E`) and `[Label](0xHEX)` entity links. |
| Automatic instance discovery          | Each active client publishes a user-private PID record (`instances/<pid>.json`) under the local state directory and removes it on exit, so tools find ephemeral ports.                                                                         |

## In-game controls and safety

The Live API is **disabled by default**. When enabled, it binds strictly to `127.0.0.1`, rejects requests with a browser `Origin` header, and enforces loopback `Host` headers to prevent DNS rebinding.

Use `/api` in chat (in either the 3D or terminal client) to check status or pause automation at any time:

| Command       | Action                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| `/api`        | Show whether the Live API is active, its localhost URL, and pause state       |
| `/api prompt` | Copy the one-line AI agent starter prompt for this running instance           |
| `/api pause`  | Stop active automation steering/combat and reject further automation commands |
| `/api resume` | Allow automation commands again                                               |

In the 3D client, a compact HUD badge also appears while the Live API is active so you can see its state and pause or resume automation with a click.

## For bots, tools, and scripts

External bots and companion tools use the same localhost server:

- **REST (`GET /v1/...`, `POST /v1/command`, `POST /v1/preview`):** Read typed snapshots of self, nearby entities, inventory, equipment, spellbook, trade, vendor, and world cells, or long-poll `GET /v1/events?since=<seq>&waitMs=<ms>`.
- **Multiplexed WebSocket (`WS /v1/ws`):** Subscribe to semantic event topics with sequence catch-up, send multiplexed queries/commands, and opt into throttled live motion updates (`1`–`15 Hz`).
- **Shared engine with TUI scripts:** The [terminal client's JavaScript runtime](/holtburger/tui/scripting/) runs on the same underlying Live API engine. Use the Live API when you want an external language, bot framework, or AI agent in either client; use TUI scripts when you want a self-contained headless bot.

Start a client with the Live API enabled and read `GET /` or `GET /v1/openapi.json` directly for the authoritative, up-to-date route and schema reference.
