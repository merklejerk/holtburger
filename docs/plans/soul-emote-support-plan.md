# Soul Emote Support Plan

## Context And Boundaries

### Goal
Implement retail-style soul emote support end-to-end so holtburger can send, receive, and semantically classify motion emotes like `*wave*`, while keeping TUI scope limited to input and chat behavior rather than motion playback UI.

### In Scope
- Add protocol support for client-originated soul emotes on the wire.
- Parse retail `ChatPoseTable` data and expose a runtime emote catalog through shared crates.
- Preserve the distinction between plain emotes and soul emotes through `holtburger-core` event projection.
- Add shared semantic resolution for soul emote tokens without blocking the feature on persistent-state classification.
- Update the TUI input path so soul emotes can be issued intentionally and displayed correctly in chat.
- Add tests and documentation for the new protocol/content/runtime flow.

### Out Of Scope
- Rendering motion playback, stance badges, or animation state in the TUI.
- Full MotionTable-driven animation playback or frame timing in holtburger clients.
- A full retail-accurate client-side `pose -> MotionCommand` table for 3D playback in this pass.
- NPC or monster authored emote scripting beyond preserving wire compatibility.
- Reworking unrelated chat input or command systems beyond the minimum needed to route soul emotes cleanly.

---

## Ground Truth And Existing Patterns

### Reference Sources
- Soul emote action opcode in [ACE/Source/ACE.Server/Network/GameAction/GameActionType.cs](../../ACE/Source/ACE.Server/Network/GameAction/GameActionType.cs)
- Soul emote handler in [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionSoulEmote.cs](../../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionSoulEmote.cs)
- Plain emote handler in [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionEmote.cs](../../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionEmote.cs)
- Player broadcast path in [ACE/Source/ACE.Server/WorldObjects/Player.cs](../../ACE/Source/ACE.Server/WorldObjects/Player.cs)
- Soul emote message layout in [ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageSoulEmote.cs](../../ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageSoulEmote.cs)
- Server-side soul emote command set in [ACE/Source/ACE.Server/Entity/SoulEmote.cs](../../ACE/Source/ACE.Server/Entity/SoulEmote.cs)
- Chat pose DAT format in [ACE/Source/ACE.DatLoader/FileTypes/ChatPoseTable.cs](../../ACE/Source/ACE.DatLoader/FileTypes/ChatPoseTable.cs)
- ACViewer explorer wiring for `ChatPoseTable` in [ACViewer/ACViewer/FileTypes/ChatPoseTable.cs](../../ACViewer/ACViewer/FileTypes/ChatPoseTable.cs)
- Holburger opcode definitions in [crates/holtburger-protocol/src/opcodes.rs](../../crates/holtburger-protocol/src/opcodes.rs)
- Holburger chat message/action types in [crates/holtburger-protocol/src/messages/chat/types.rs](../../crates/holtburger-protocol/src/messages/chat/types.rs) and [crates/holtburger-protocol/src/messages/chat/actions.rs](../../crates/holtburger-protocol/src/messages/chat/actions.rs)
- Holburger action envelope in [crates/holtburger-protocol/src/messages/game_action.rs](../../crates/holtburger-protocol/src/messages/game_action.rs)
- Core command path in [crates/holtburger-core/src/client/commands.rs](../../crates/holtburger-core/src/client/commands.rs)
- Core message projection in [crates/holtburger-core/src/client/messages.rs](../../crates/holtburger-core/src/client/messages.rs) and [crates/holtburger-core/src/client/types.rs](../../crates/holtburger-core/src/client/types.rs)
- TUI chat/input handling in [apps/holtburger-cli/src/pages/game/input.rs](../../apps/holtburger-cli/src/pages/game/input.rs), [apps/holtburger-cli/src/pages/game/domains/chat.rs](../../apps/holtburger-cli/src/pages/game/domains/chat.rs), and [apps/holtburger-cli/src/pages/game/panels/chat.rs](../../apps/holtburger-cli/src/pages/game/panels/chat.rs)

### Existing Patterns To Follow
- Runtime asset parsing and namespaced content exposure in [crates/holtburger-dat/ARCHITECTURE.md](../../crates/holtburger-dat/ARCHITECTURE.md) and [crates/holtburger-content/src/repository.rs](../../crates/holtburger-content/src/repository.rs)
- Shared semantic projection via `ClientViewEvent` in [crates/holtburger-core/src/client/mod.rs](../../crates/holtburger-core/src/client/mod.rs)
- Feature plans in [docs/plans/entity-motion-combat-target-plan.md](./entity-motion-combat-target-plan.md)

---

## Investigation Summary

### Verified Facts
- ACE accepts player soul emotes on a dedicated client action opcode, `0x01E1`, not the plain emote opcode.
- ACE rebroadcasts player soul emotes as a string payload on `0x01E2`; the player chat path does not resolve the incoming token to a `MotionCommand` in `HandleActionSoulEmote`.
- `ChatPoseTable` contains command string -> pose string plus pose string -> chat emote metadata, but not `MotionCommand` ids.
- Holburger already parses server-to-client `SoulEmote` messages but currently collapses them into the same event shape as plain emotes.
- Holburger does not currently expose a `ChatPoseTable` parser or runtime emote catalog.
- The current runtime asset-loading seam already flows through `ContentRepository -> ClientRuntimeBuilder::load_assets() -> WorldBootstrap -> WorldState`; there is no late-bound content lookup seam inside core message handling today.
- The TUI already has a generic emote/chat lane, but today it routes only colon-prefixed input to a plain `ClientCommand::Emote`, treats incoming plain and soul emotes identically in chat, and mirrors that collapsed shape into scripting.

### Key Architectural Implication
The shared implementation seam is not “play the animation.” The seam is “recognize, transport, and classify soul emotes as a distinct semantic feature.” That belongs in `protocol`, `dat`, `content`, and `core`. The TUI should consume those semantics but stay presentation-light.

### Dry-Run Adjustments
- The plan should treat soul-emote lookup as bootstrap data, not as an ad hoc repository query from `holtburger-core`. The existing runtime already loads spell and motion reference data into `WorldBootstrap` and `WorldState`, and soul-emote resolution should follow that same ownership model.
- The command split needs to be explicit earlier in the plan. The current code has only `ClientCommand::Emote(String)` and only `ClientViewEvent::Emote { sender, text }`, so preserving the soul/plain distinction is an API change across `core`, the TUI domain reducer, update filters, and scripting.
- The TUI phase currently undercounts affected surfaces. Besides input and chat rendering, `apps/holtburger-cli/src/update/world.rs` and `apps/holtburger-cli/src/scripting.rs` also depend on the collapsed emote event shape and should be called out as first-class touch points.
- A cleaner first pass is to keep soul-emote semantic resolution lossless and string-based. `ChatPoseTable` plus ACE’s current wire behavior supports token -> pose -> text metadata, but not retail-accurate `MotionCommand` playback data. The plan should avoid implying a stronger motion contract than the codebase can currently prove.

### Recommended Course Corrections
- Treat persistent-state classification as an explicit follow-up, not optional work folded into Phase 3. The current feature path does not need it, and keeping it in-phase invites guesswork back into the plan.
- Keep protocol fixtures ACE-verified and parity-focused. The first `SoulEmote` client action confirmed the same `String16L` layout as `Emote`, but also showed why alignment assumptions should be proven in tests instead of inferred from nearby packets.
- Avoid starting the `holtburger-core` or TUI semantic split before the Phase 3 bootstrap/catalog seam exists. Otherwise downstream code will be forced to choose between raw-token passthrough and ad hoc repository lookups that the plan already ruled out.
- Keep the Phase 3 catalog lossless and string-first. The parsed `ChatPoseTable` yields command tokens, pose identifiers, and display strings, but it still does not prove any stronger enum or motion-command contract.
- Keep the catalog type owned by `holtburger-content`, and have `holtburger-world` consume it through bootstrap data. Phase 3 exposed that the old `content -> world` dependency was backwards for this seam.

---

## Proposed Architecture

### Layer 1: Protocol
Add first-class support for client-originated soul emote actions in `holtburger-protocol`.

Recommended shape:
- `GameActionOpcode::SoulEmote = 0x01E1`
- `SoulEmoteActionData { message: String }`
- `GameAction::SoulEmote(Box<SoulEmoteActionData>)`

### Layer 2: DAT Parsing
Add a `ChatPoseTable` parser to `holtburger-dat` that captures:
- command token
- pose identifier
- chat emote text metadata

This parser should stay lossless and retail-shaped rather than baking TUI policy into the type.

### Layer 3: Runtime Content Catalog
Expose a shared emote catalog in `holtburger-content`, then load it through the existing world-bootstrap path so runtime code can answer:
- is this token a known soul emote?
- what pose does it resolve to?
- what display strings are associated with the pose?

Recommended ownership:
- `holtburger-dat` parses raw `ChatPoseTable`
- `holtburger-content` builds a curated `SoulEmoteCatalog`
- `ClientRuntimeBuilder::load_assets()` loads that catalog into `WorldBootstrap`
- `holtburger-world` or `holtburger-core` consumes the loaded catalog without reaching back into `ContentRepository`

If persistent-state classification is needed, store that in a derived shared catalog or semantic layer instead of teaching the TUI its own lookup table.
That classification remains deferred for this feature and should not block the catalog shape.

### Layer 4: Shared Client Semantics
`holtburger-core` should preserve plain emotes vs soul emotes as distinct semantic events and resolve known soul-emote tokens through the shared content catalog.

Recommended event shape:
- raw token from the wire
- sender metadata
- resolved pose id when known
- resolved display text or fallback raw token

Persistent-state classification should remain out of band for the first pass. Preserve enough raw data to add that semantic layer later without changing the wire or catalog contracts.

Recommended command shape:
- Keep `ClientCommand::Emote(String)` for the current plain emote transport
- `ClientCommand::SoulEmote(String)` for the dedicated `0x01E1` path

This keeps the existing plain-emote command stable while making the dedicated soul-emote transport explicit. The important constraint is not renaming the old command; it is preventing core and downstream consumers from collapsing both transports back into one semantic lane.

### Layer 5: TUI Policy
The TUI should:
- allow intentional soul-emote input
- route it through the dedicated client command
- log resolved chat text cleanly

The TUI should not attempt to render the motion itself in this feature.

---

## Phased Implementation

### Phase 1: Add Protocol Support For Client Soul Emotes

Status: completed 2026-04-21

#### Deliverables
- Add `GameActionOpcode::SoulEmote` in [crates/holtburger-protocol/src/opcodes.rs](../../crates/holtburger-protocol/src/opcodes.rs)
- Add `SoulEmoteActionData` beside existing chat action data in [crates/holtburger-protocol/src/messages/chat/actions.rs](../../crates/holtburger-protocol/src/messages/chat/actions.rs)
- Add `GameAction::SoulEmote` packing/unpacking in [crates/holtburger-protocol/src/messages/game_action.rs](../../crates/holtburger-protocol/src/messages/game_action.rs)
- Add or extend fixtures/tests for soul emote action serialization and message decoding

#### Acceptance Criteria
- Holburger can pack a client `SoulEmote` game action on opcode `0x01E1`
- Existing `SoulEmote` server-message decoding remains intact
- Protocol tests cover both pack and unpack for the new action variant

### Phase 2: Parse `ChatPoseTable` In `holtburger-dat`

Status: completed 2026-04-21

#### Deliverables
- Add a retail-shaped `ChatPoseTable` parser in `holtburger-dat`
- Add typed structures for command-to-pose and pose-to-chat-emote entries
- Add parser tests using fixture bytes or a focused synthetic binary aligned to ACE’s layout

#### Likely Files
- `crates/holtburger-dat/src/file_type/chat_pose_table.rs`
- `crates/holtburger-dat/src/file_type/mod.rs`
- parser tests colocated with the new file type

#### Acceptance Criteria
- The parser reads the retail `0x0E000007` file shape proven by ACE
- Command tokens and pose keys round-trip in tests without dropping fields
- The new file type is available through normal typed asset lookup patterns

### Phase 3: Expose A Shared Soul-Emote Catalog Through `holtburger-content`

Status: completed 2026-04-22

#### Deliverables
- Add a runtime-facing content query or typed asset wrapper for soul-emote lookup
- Define a shared semantic type for resolved soul emotes
- Do not add persistent-state classification in this phase; preserve pose ids and raw lookup data so a later consumer can layer that on with grounded evidence

#### Likely Files
- `crates/holtburger-content/src/repository.rs`
- `crates/holtburger-content/src/lib.rs`
- a new content-facing emote module
- `crates/holtburger-core/src/client/builder.rs`
- `crates/holtburger-world/src/bootstrap.rs`
- `crates/holtburger-world/src/state/types.rs`

#### Acceptance Criteria
- Runtime code can look up a token like `*wave*` and get back a resolved pose plus display-text metadata
- Unknown tokens fail cleanly without inventing semantics
- Content code stays free of TUI-only rendering concerns
- The loaded catalog is available from runtime state without direct `ContentRepository` access in message handlers
- The runtime-facing API is a curated `SoulEmoteCatalog`, while `ChatPoseTable` remains available as the raw parsed substrate in `holtburger-dat`

### Phase 4: Preserve Soul-Emote Semantics Through `holtburger-core`

#### Deliverables
- Add a distinct client command path for soul emotes in core
- Stop collapsing `EmoteText` and `SoulEmote` into the same event shape
- Project a distinct `ClientViewEvent` for soul emotes with resolved metadata when available
- Keep plain emotes and soul emotes separate for downstream consumers

#### Likely Files
- `crates/holtburger-core/src/client/types.rs`
- `crates/holtburger-core/src/client/commands.rs`
- `crates/holtburger-core/src/client/messages.rs`
- `crates/holtburger-core/src/client/mod.rs`
- `apps/holtburger-cli/src/update/world.rs` because the in-game event allowlist currently names only the collapsed `ClientViewEvent::Emote`
- `apps/holtburger-cli/src/scripting.rs` because scripting currently maps the collapsed emote event into a generic chat-emote script event

#### Acceptance Criteria
- Core can intentionally send `SoulEmote` actions
- Receiving `0x01E2` produces a soul-emote-specific view event
- Plain emote behavior is unchanged
- Event payloads include both raw token and resolved semantic data when content is available

### Phase 5: Update TUI Input And Chat Handling

#### Deliverables
- Define how TUI input chooses plain emote vs soul emote transport
- Route recognized soul emote syntax through the dedicated client command
- Update chat logging to use the richer soul-emote event payload
- Keep the TUI UI neutral: no motion badges, no animation state widgets

#### Recommended Direction
- Preserve the current colon-prefixed pathway for freeform plain emotes
- Add a retail-oriented path for soul-emote syntax such as `*wave*`
- Route `:waves` and `*wave*` to different client commands intentionally rather than teaching core to guess transport from arbitrary free text
- Resolve and log soul emotes via the shared core event, not local TUI lookups
- Match retail input syntax for the first-pass soul-emote path rather than introducing additional aliases

#### Likely Files
- `apps/holtburger-cli/src/pages/game/input.rs`
- `apps/holtburger-cli/src/pages/game/domains/chat.rs`
- `apps/holtburger-cli/src/pages/game/panels/chat.rs`
- `apps/holtburger-cli/src/types.rs`
- `apps/holtburger-cli/src/update/world.rs`
- `apps/holtburger-cli/src/scripting.rs`

#### Acceptance Criteria
- Typing a recognized soul emote sends the dedicated soul-emote command path
- Incoming soul emotes appear correctly in chat
- The TUI does not grow feature-specific motion UI

### Phase 6: Documentation, Diagnostics, And Hardening

#### Deliverables
- Document the wire distinction between plain emotes and soul emotes
- Document the `ChatPoseTable` format and the limits of what it does not contain
- Add a focused diagnostic or test helper if needed to inspect resolved emote catalogs from mounted content

#### Acceptance Criteria
- Docs explain where string resolution happens and where motion playback does not yet happen
- Tests cover the new protocol/content/core boundaries
- No crate boundary violations are introduced for TUI convenience

---

## Risks And Mitigations

### Risk 1: Overfitting Shared Semantics To TUI Needs
If we let the TUI define the emote model, we will end up with a frontend-shaped abstraction that a future 3D client has to work around.

Mitigation:
- Keep retail-shaped parsing in `dat`
- Keep reusable semantic resolution in `content` or `core`
- Keep TUI-specific policy limited to input routing and chat presentation

### Risk 2: Guessing Persistent-State Semantics
Some pose names clearly look stateful, but a guessed classification table can drift from retail behavior.

Mitigation:
- Defer persistent-state classification in the first pass
- Only promote classifications that are proven from retail references or obvious ACE naming with documented confidence
- Preserve raw pose ids so future work can refine semantics without changing the wire layer

### Risk 3: Mixing Plain Emotes And Soul Emotes Again
The current code already collapses both into one event. A partial refactor could keep that leak alive.

Mitigation:
- Make the split explicit in `WireEvent` or `ClientViewEvent`
- Add tests that assert different message opcodes yield different event kinds
- Add TUI and scripting tests that assert the split survives downstream projection rather than being recombined at the app boundary

### Risk 4: Putting Lookup Logic In The Wrong Crate
If soul-emote lookup stays as an on-demand `ContentRepository` query from `holtburger-core`, we will bypass the existing bootstrap model and create a one-off dependency seam for chat only.

Mitigation:
- Build the catalog in `holtburger-content`
- Load it alongside spell and motion assets through `ClientRuntimeBuilder`
- Store the resolved runtime-facing catalog on `WorldBootstrap` or `WorldState`, then consume it from there

### Risk 5: Expanding TUI Scope Into Motion Rendering
It is tempting to add small “waving” or “kneeling” markers once semantic data exists.

Mitigation:
- Keep the plan explicit that TUI UI motion surfacing is out of scope
- Reject feature creep unless it is requested separately

---

## Definition Of Done

- `holtburger-protocol` supports `SoulEmote` client actions with tests
- `holtburger-dat` can parse `ChatPoseTable` with tests
- `holtburger-content` exposes a runtime soul-emote lookup surface
- The soul-emote catalog is loaded through the existing world bootstrap path rather than queried directly from `ContentRepository` at runtime
- `holtburger-core` preserves plain emotes vs soul emotes as distinct semantic events
- The TUI can send recognized soul emotes and display them correctly in chat
- Scripting and app event filtering preserve the plain-vs-soul split
- No motion playback UI is added to the TUI
- Narrow targeted tests pass for touched protocol/content/core/TUI slices
- Relevant docs are updated to describe the wire/content/runtime model accurately

---

## Living Worksheet

### Task Checklist
- [x] Phase 1: Add protocol support for client soul emotes
- [x] Phase 2: Parse `ChatPoseTable` in `holtburger-dat`
- [x] Phase 3: Expose a shared soul-emote catalog in `holtburger-content`
- [ ] Phase 4: Preserve soul-emote semantics through `holtburger-core`
- [ ] Phase 5: Update TUI input and chat handling without UI motion playback
- [ ] Phase 6: Add docs, diagnostics, and hardening

### Decisions Log
- 2026-04-21: TUI motion playback or state badges are explicitly out of scope for this feature.
- 2026-04-21: Shared implementation should focus on transport and semantic classification, not animation playback.
- 2026-04-21: Keep `ClientCommand::Emote` for plain emotes and add `ClientCommand::SoulEmote` for the dedicated retail soul-emote transport.
- 2026-04-21: First-pass TUI soul-emote input should match retail `*token*` syntax.
- 2026-04-21: Persistent-state classification is deferred until a later consumer needs it.
- 2026-04-21: `holtburger-dat` should expose the raw parsed `ChatPoseTable`, while `holtburger-content` should expose a curated runtime-facing `SoulEmoteCatalog` derived from it.
- 2026-04-22: `SoulEmoteCatalog` should stay content-owned and be loaded into runtime bootstrap data, not recreated inside `holtburger-world` or looked up from `ContentRepository` during message handling.
- 2026-04-22: The crate dependency direction for this seam should be `holtburger-world -> holtburger-content`, not `holtburger-content -> holtburger-world`.

### Verification Log
- 2026-04-21: Verified ACE uses a dedicated `SoulEmote` client action opcode (`0x01E1`) and rebroadcast message opcode (`0x01E2`).
- 2026-04-21: Verified ACE `ChatPoseTable` contains command and chat text mappings, but not `MotionCommand` ids.
- 2026-04-21: Verified holtburger currently decodes `SoulEmote` server messages but lacks a client action path and collapses soul/plain emotes into the same event lane.
- 2026-04-21: Dry-run against current runtime wiring showed a cleaner ownership seam through `ContentRepository -> ClientRuntimeBuilder -> WorldBootstrap -> WorldState` instead of core-side repository lookups.
- 2026-04-21: Dry-run against TUI/app code showed additional required touch points in update filtering and scripting, not just input/chat rendering.
- 2026-04-21: Implemented Phase 1 in `holtburger-protocol` by adding `GameActionOpcode::SoulEmote`, `SoulEmoteActionData`, `GameAction::SoulEmote`, and dispatch/parity tests.
- 2026-04-21: Validated Phase 1 with `cargo test -p holtburger-protocol` (`265 passed`).
- 2026-04-21: Verified the `*wave*` client-action fixture uses the same `String16L` layout as plain emotes and does not include trailing pad bytes when the payload is already 4-byte aligned.
- 2026-04-21: Implemented Phase 2 in `holtburger-dat` by adding a retail-shaped `ChatPoseTable` parser with `chat_pose_hash` (`command -> pose`) and `chat_emote_hash` (`pose -> ChatEmoteData`) plus `StaticResourceKey` wiring.
- 2026-04-21: Validated Phase 2 with `cargo test -p holtburger-dat` (`48` unit tests plus `2` integration tests passed).
- 2026-04-21: Confirmed the DAT parser requires padded 16-bit PStrings for both hash keys and values, including nested `ChatEmoteData` strings.
- 2026-04-22: Implemented Phase 3 by adding a curated `SoulEmoteCatalog` in `holtburger-content`, a `ContentRepository::read_soul_emote_catalog()` helper, and runtime bootstrap wiring through `ClientRuntimeBuilder`, `WorldBootstrap`, and `WorldState`.
- 2026-04-22: Corrected the crate boundary for this seam by removing the unused `holtburger-content -> holtburger-world` dependency and making `holtburger-world` consume the content-owned catalog instead.
- 2026-04-22: Validated the Phase 3 runtime-loading seam with `cargo test -p holtburger-core runtime_builder_load_assets_reads_bootstrap_from_repository`.
- 2026-04-22: Validated the content layer with `cargo test -p holtburger-content`.
- 2026-04-22: Validated the updated synthetic world bootstrap shape with `cargo test -p holtburger-world test_empty_world_uses_synthetic_reference_data`.

### Open Questions
- None blocking Phase 4.
- Persistent-state classification remains intentionally deferred until a concrete downstream consumer needs it.
- Phase 4 should decide the minimum soul-emote event payload that preserves raw token plus resolved catalog metadata without re-collapsing plain and soul emotes into one lane.
