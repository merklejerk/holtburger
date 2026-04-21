# Soul Emote Support Plan

## Context And Boundaries

### Goal
Implement retail-style soul emote support end-to-end so holtburger can send, receive, and semantically classify motion emotes like `*wave*`, while keeping TUI scope limited to input and chat behavior rather than motion playback UI.

### In Scope
- Add protocol support for client-originated soul emotes on the wire.
- Parse retail `ChatPoseTable` data and expose a runtime emote catalog through shared crates.
- Preserve the distinction between plain emotes and soul emotes through `holtburger-core` event projection.
- Add shared semantic resolution for soul emote tokens and persistent-state classification where needed.
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
- The TUI already has a generic emote/chat lane, but today it treats emotes as plain chat text and does not distinguish soul-emote semantics.

### Key Architectural Implication
The shared implementation seam is not “play the animation.” The seam is “recognize, transport, and classify soul emotes as a distinct semantic feature.” That belongs in `protocol`, `dat`, `content`, and `core`. The TUI should consume those semantics but stay presentation-light.

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
Expose a shared emote catalog in `holtburger-content` so runtime code can answer:
- is this token a known soul emote?
- what pose does it resolve to?
- what display strings are associated with the pose?

If persistent-state classification is needed, store that in a derived shared catalog or semantic layer instead of teaching the TUI its own lookup table.

### Layer 4: Shared Client Semantics
`holtburger-core` should preserve plain emotes vs soul emotes as distinct semantic events and resolve known soul-emote tokens through the shared content catalog.

Recommended event shape:
- raw token from the wire
- sender metadata
- resolved pose id when known
- resolved display text or fallback raw token
- semantic kind: transient vs persistent-state if classification is available

### Layer 5: TUI Policy
The TUI should:
- allow intentional soul-emote input
- route it through the dedicated client command
- log resolved chat text cleanly

The TUI should not attempt to render the motion itself in this feature.

---

## Phased Implementation

### Phase 1: Add Protocol Support For Client Soul Emotes

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

#### Deliverables
- Add a runtime-facing content query or typed asset wrapper for soul-emote lookup
- Define a shared semantic type for resolved soul emotes
- Optionally add a minimal derived classification for persistent-state poses if it can be justified without guesswork

#### Likely Files
- `crates/holtburger-content/src/repository.rs`
- a new content-facing emote module if needed

#### Acceptance Criteria
- Runtime code can look up a token like `*wave*` and get back a resolved pose plus display-text metadata
- Unknown tokens fail cleanly without inventing semantics
- Content code stays free of TUI-only rendering concerns

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
- Preserve the current generic emote pathway for freeform text emotes
- Add a retail-oriented path for soul-emote syntax such as `*wave*`
- Resolve and log soul emotes via the shared core event, not local TUI lookups

#### Likely Files
- `apps/holtburger-cli/src/pages/game/input.rs`
- `apps/holtburger-cli/src/pages/game/domains/chat.rs`
- `apps/holtburger-cli/src/pages/game/panels/chat.rs`
- `apps/holtburger-cli/src/types.rs` only if a new app action is needed

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
- Treat persistent-state classification as optional in the first pass
- Only promote classifications that are proven from retail references or obvious ACE naming with documented confidence
- Preserve raw pose ids so future work can refine semantics without changing the wire layer

### Risk 3: Mixing Plain Emotes And Soul Emotes Again
The current code already collapses both into one event. A partial refactor could keep that leak alive.

Mitigation:
- Make the split explicit in `WireEvent` or `ClientViewEvent`
- Add tests that assert different message opcodes yield different event kinds

### Risk 4: Expanding TUI Scope Into Motion Rendering
It is tempting to add small “waving” or “kneeling” markers once semantic data exists.

Mitigation:
- Keep the plan explicit that TUI UI motion surfacing is out of scope
- Reject feature creep unless it is requested separately

---

## Definition Of Done

- `holtburger-protocol` supports `SoulEmote` client actions with tests
- `holtburger-dat` can parse `ChatPoseTable` with tests
- `holtburger-content` exposes a runtime soul-emote lookup surface
- `holtburger-core` preserves plain emotes vs soul emotes as distinct semantic events
- The TUI can send recognized soul emotes and display them correctly in chat
- No motion playback UI is added to the TUI
- Narrow targeted tests pass for touched protocol/content/core/TUI slices
- Relevant docs are updated to describe the wire/content/runtime model accurately

---

## Living Worksheet

### Task Checklist
- [ ] Phase 1: Add protocol support for client soul emotes
- [ ] Phase 2: Parse `ChatPoseTable` in `holtburger-dat`
- [ ] Phase 3: Expose a shared soul-emote catalog in `holtburger-content`
- [ ] Phase 4: Preserve soul-emote semantics through `holtburger-core`
- [ ] Phase 5: Update TUI input and chat handling without UI motion playback
- [ ] Phase 6: Add docs, diagnostics, and hardening

### Decisions Log
- 2026-04-21: TUI motion playback or state badges are explicitly out of scope for this feature.
- 2026-04-21: Shared implementation should focus on transport and semantic classification, not animation playback.

### Verification Log
- 2026-04-21: Verified ACE uses a dedicated `SoulEmote` client action opcode (`0x01E1`) and rebroadcast message opcode (`0x01E2`).
- 2026-04-21: Verified ACE `ChatPoseTable` contains command and chat text mappings, but not `MotionCommand` ids.
- 2026-04-21: Verified holtburger currently decodes `SoulEmote` server messages but lacks a client action path and collapses soul/plain emotes into the same event lane.

### Open Questions
- Should TUI soul emote input be limited to strict retail `*token*` syntax, or should we also support slash/colon aliases that resolve through the same shared catalog?
- Do we want a first-pass persistent-state classification table now, or should Phase 3 stay purely lossless and defer state semantics until a later client actually consumes them?
- Should the content layer expose raw `ChatPoseTable` records directly, or a curated runtime `SoulEmoteCatalog` wrapper that is easier for core to consume?