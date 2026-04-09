# Deno Core Scripting Architecture Plan

## 1. Context And Boundaries

### Goal

Integrate a `deno_core`-based scripting host on the frontend side of the client so scripts can observe stable game events, query a local mirrored client view, and emit explicit intents without bypassing the existing event-driven architecture.

### Why This Matters

The TUI already maintains a meaningful local projection of client-visible state. We should lean into that instead of inventing a second or third read model just because scripting exists.

At the same time, we should not bind scripts directly to raw TUI widget state or to the exact field layout of `GameData`. That would make scripting brittle, frontend-specific, and expensive to carry into a future 3D client.

The design target is therefore:

- reuse the existing frontend projection work
- avoid direct access to authoritative `WorldState`
- avoid exposing raw TUI presentation state as the script contract
- avoid a facade design that degenerates into scattered glue code

### In Scope

- Define where the `deno_core` runtime should live relative to the TUI shell and core runtime.
- Define the script-facing read surface, write surface, and event surface.
- Define how to reuse the existing frontend projection without turning `GameData` into the public scripting API.
- Define a minimal architecture that can start in the TUI while preserving a path toward a future shared client-facing scripting layer.
- Identify where glue code should live and how to keep it contained.

### Out Of Scope

- Implementing `deno_core` itself.
- Designing a full permissions or sandbox policy.
- Designing the entire long-term 3D client scripting UX.
- Exhaustively enumerating every future script API method.
- Reworking the existing reducer architecture beyond what scripting needs.

## 2. Ground Truth And Existing Patterns

### Reference Sources

- [apps/holtburger-cli/ARCHITECTURE.md](apps/holtburger-cli/ARCHITECTURE.md)
- [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs)
- [apps/holtburger-cli/src/update/app_action.rs](apps/holtburger-cli/src/update/app_action.rs)
- [apps/holtburger-cli/src/update/world.rs](apps/holtburger-cli/src/update/world.rs)
- [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs)
- [apps/holtburger-cli/src/pages/game/data.rs](apps/holtburger-cli/src/pages/game/data.rs)
- [crates/holtburger-core/src/client/runtime.rs](crates/holtburger-core/src/client/runtime.rs)
- [crates/holtburger-core/src/client/runtime_body_view_cache.rs](crates/holtburger-core/src/client/runtime_body_view_cache.rs)
- [crates/holtburger-core/src/client/types.rs](crates/holtburger-core/src/client/types.rs)
- [AGENTS.md](AGENTS.md)

### Relevant Current Architecture Facts

- The core runtime owns the authoritative client world, movement, simulation, and network loop.
- The TUI owns a mirrored local projection via `AppState`, `GameState`, and `GameData`.
- The TUI already consumes `ClientViewEvent` and reduces those events into local caches and UI state.
- `GameData` already contains script-relevant mirrored state such as entities, vitals, inventory, fellowship, and runtime body samples.
- `RuntimeBodyViewCache` is already explicitly a mirrored read-model cache and not an authoritative owner.
- The TUI architecture already says external integrations should compile into `AppAction` and feed emitted `ClientCommand`s back through the normal shell flow.

### Non-Negotiable Constraints

- `JsRuntime` from `deno_core` is not `Send` or `Sync`.
- Async JS work only progresses while the JS runtime event loop is polled.
- Scripts should not read `WorldState` directly.
- Scripts should not depend on TUI widget-local state such as focus, scroll offsets, dashboard tab selection, or modal implementation details.

### Dry-Run Findings Against The Current Codebase

- The proposed top-level scripting facade is directionally right, but the current codebase does not expose a clean standalone target model yet. The nearest existing seam is `Interaction::Targeting { target_guid }`, while the existing helper `active_interaction_subject_guid(...)` in `apps/holtburger-cli/src/utils.rs` is broader and also folds in approach and follow state.
- `Page::Game` exists before the client is fully in world. The selection flow transitions to the game page on `ClientState::EnteringWorld`, not on `ClientState::InWorld`, so host lifetime should be keyed to actual in-world session state rather than merely checking whether `Page::Game` exists.
- A strict rule that all script events are derived only from `ClientViewEvent` is too narrow. Some script-visible workflow concepts, such as the current interaction subject, are frontend-derived and come from local reducer state rather than directly from core events.
- The event example was previously double-modeling workflow state through both dedicated event variants and a nested workflow enum. The plan should use one model consistently.

### Dry-Run Consequences

- The read facade should expose `target_entity()` as a useful client-visible read concept and avoid overloading it with approach or follow state.
- Host startup and teardown should be coordinated off session state such as `ClientState::InWorld` plus page presence, not just page presence alone.
- The script-event bridge should be described as one centralized adapter over both core view events and relevant frontend workflow transitions, rather than as a pure `ClientViewEvent` translation layer.
- The intent layer should not be forced to be perfectly cross-client from day one. A hybrid shape is fine: keep broadly useful intents directly on `ScriptIntent`, and retain a `Client(ScriptClientIntent)` branch for current-client policy actions.

## 3. Core Design Decision

### Decision

The scripting runtime should live on the frontend side of the architecture and consume the same event stream that drives the TUI projection, but it should read through a script-facing facade over the existing local mirrored state instead of binding directly to `GameData` or duplicating that state into another projection.

This is not a rule that scripts may never observe frontend-owned state. The actual rule is narrower:

- scripts may observe frontend-owned semantic state when that state represents a real client workflow
- scripts should not depend on raw widget or layout state when the real contract is a higher-level workflow or confirmation concept

Examples:

- an active craft or fellowship confirmation is a real semantic client workflow and is reasonable to expose
- the fact that the TUI currently renders that workflow as a modal overlay is not itself the scripting contract
- a local unswear confirmation can be exposed as a semantic pending confirmation, even though it is TUI-owned today
- focused pane, scroll offsets, and text-input cursor position remain presentation concerns and should stay out of the scripting API

### Consequences

This gives us:

- no direct coupling to authoritative core internals
- no need to re-project the whole world a second time just for scripts
- a script host that can stay event-driven and deterministic with the rest of the client
- a narrow seam where frontend-owned state can be curated into a stable contract

This also means:

- the facade must be intentionally thin and centralized
- the first implementation can live in the TUI, but the scripting host crate should avoid TUI-widget concerns so it can later be reused

## 4. Proposed Runtime Topology

### High-Level Shape

```text
core runtime task
  owns authoritative WorldState and emits ClientViewEvent
          |
          v
frontend shell
  owns AppState/GameState/GameData local projection
  owns action drain and command dispatch
          |
          +--> script host owner
                 consumes event feed
               queries script-safe local client view
                 emits ScriptIntent
          |
          v
app action / command bridge
  compiles script intents into AppAction or ClientCommand
```

### Recommended Ownership

- The script host should be owned by the frontend shell, not by `holtburger-core`.
- The host should not mutate local projection state directly.
- The host should receive events and issue intents only.
- The host should query current script-visible state through a single adapter object that reads from the existing frontend projection.

### Threading Recommendation

Two workable options exist:

1. Run the JS runtime in a dedicated frontend-owned thread with a current-thread Tokio runtime.
2. Run the JS runtime in the frontend side synchronously as a locally owned component that is pumped from the main shell loop.

Option 1 is the safer long-term choice because it isolates `deno_core` ownership and avoids making the TUI loop responsible for driving V8 progress directly. Option 2 is viable for a narrow MVP but risks making the shell loop harder to reason about.

This plan assumes Option 1 as the target shape.

## 5. Script API Shape

### Principle

The public script API should expose stable game concepts, not raw Rust UI structs and not raw widget-driven actions.

### Read Surface

The read surface should be query-oriented and snapshot-like.

The top-level name should reflect that scripts are reading client-visible state, not just world state. More workflow-oriented concepts will likely follow, so the contract should admit both projected world facts and frontend-owned semantic state.

Because of that, the primary facade should be named `ScriptClientView`, not `ScriptWorldView`.

Suggested Rust-side facade:

```rust
pub trait ScriptClientView {
    fn self_entity(&self) -> Option<ScriptSelfView>;
    fn target_entity(&self) -> Option<ScriptEntityView>;
    fn entity(&self, guid: Guid) -> Option<ScriptEntityView>;
    fn nearby_entities(&self) -> Vec<ScriptEntityView>;
    fn inventory_items(&self) -> Vec<ScriptInventoryItemView>;
    fn fellowship(&self) -> Option<ScriptPartyView>;
    fn active_spells(&self) -> Vec<ScriptSpellEffectView>;
    fn server_time(&self) -> Option<f64>;
    fn pending_confirmation(&self) -> Option<ScriptConfirmation>;
    fn busy_operation(&self) -> Option<ScriptBusyOperation>;
}
```

This trait is intentionally small. It is not a mirror of every `GameData` field.

`target_entity()` should specifically mean the entity selected by the client targeting concept, not the subject of any arbitrary active interaction. If the TUI currently reuses the same GUID across targeting, approach, and follow display logic, that is an implementation shortcut, not the contract we should bless in the scripting API.

If this surface grows enough that the distinction matters operationally, we can later split it internally into narrower sub-facets such as `ScriptWorldView` and `ScriptWorkflowView`, while keeping `ScriptClientView` as the public top-level contract.

Suggested view structs:

```rust
pub struct ScriptSelfView {
    pub guid: Guid,
    pub name: String,
    pub position: Option<WorldPosition>,
    pub health: Option<u32>,
    pub stamina: Option<u32>,
    pub mana: Option<u32>,
    pub combat_mode: CombatMode,
}

pub struct ScriptEntityView {
    pub guid: Guid,
    pub name: Option<String>,
    pub position: Option<WorldPosition>,
    pub distance_to_self: Option<f32>,
    pub is_player: bool,
    pub is_monster: bool,
    pub is_vendor: bool,
    pub is_dead: bool,
}
```

The exact shape will evolve, but the contract should remain semantic and loss-minimizing.

### Event Surface

Scripts should react to a curated event stream rather than re-scanning the world every tick.

Suggested event enum:

```rust
pub enum ScriptEvent {
    ClientStatusChanged { state: ClientState },
    ChatMessage(ScriptChatEvent),
    Workflow(ScriptWorkflowEvent),
    SelfVitalsChanged,
    EntityAppeared { guid: Guid },
    EntityDisappeared { guid: Guid },
    EntityUpdated { guid: Guid },
    InventoryChanged,
    SpellbookChanged,
    FellowshipChanged,
}
```

For confirmations and similar flows, prefer semantic workflow events and snapshots over raw TUI state exposure.

These workflow notifications should not live on a separate event channel. They should be carried as a variant inside the main `ScriptEvent` stream so scripts only have one inbound event source to consume and order remains explicit.

Suggested pattern:

```rust
pub enum ScriptWorkflowEvent {
    ConfirmationOpened { confirmation: ScriptConfirmation },
    ConfirmationClosed,
    BusyOperationChanged { busy: Option<ScriptBusyOperation> },
    TargetEntityChanged { guid: Option<Guid> },
}

pub enum ScriptConfirmation {
    Character(ActiveCharacterConfirmation),
    Local {
        kind: ScriptLocalConfirmationKind,
        text: String,
    },
}
```

This lets scripts reason about a pending confirmation without caring whether the frontend happened to show it as a modal, drawer, overlay, or future non-TUI affordance.

It also avoids splitting event consumption between "world events" and "workflow events" when, in practice, scripts will often want to react to both in one loop.

Important rule: the script event stream should be derived in one place by a dedicated script-event bridge, not hand-assembled across many reducers. In practice that bridge will observe both `ClientViewEvent` and a small amount of frontend-owned workflow state.

### Write Surface

Scripts should emit high-level intents first.

We should not be dogmatic about forcing every intent to be immediately cross-client. The cleaner compromise is to keep broadly useful intents directly on `ScriptIntent`, while retaining a `Client(ScriptClientIntent)` branch for policy that is still clearly client-owned.

```rust
pub enum ScriptIntent {
    Log { level: ScriptLogLevel, message: String },
    Say { message: String },
    Tell { target: String, message: String },
    Use { guid: Guid },
    CastUntargetedSpell { spell_id: u32 },
    CastTargetedSpell { target: Guid, spell_id: u32 },
    RespondToConfirmation { accepted: bool },
  Client(ScriptClientIntent),
}

pub enum ScriptClientIntent {
  TargetEntity { guid: Guid },
  Approach { guid: Guid },
  Follow { guid: Guid },
  Attack { guid: Guid },
  CancelInteraction,
}
```

The frontend shell then compiles those intents into:

- script intents whose semantics are already represented directly by shared client workflows when that is available
- `Client(ScriptClientIntent)` payloads whose behavior is still owned by current-client policy when no better shared seam exists yet

This keeps the existing reducer/action architecture in charge.

For now, `TargetEntity`, `Approach`, `Follow`, and `Attack` should all be treated as client-policy-facing intents rather than prematurely blessed as universally shared semantics.

## 6. Avoiding A Glue-Code Explosion

This is the main design risk.

### Anti-Pattern To Avoid

Do not create dozens of tiny wrappers like:

- `script_get_player_health()` calling one field on `GameData`
- `script_get_entity_name()` calling one field on `Entity`
- `script_get_inventory_count()` calling one helper in a random panel module

That style spreads scripting glue across the TUI and guarantees maintenance pain.

### Recommended Pattern

Centralize all scripting adaptation in one layer:

- one adapter from frontend projection to `ScriptClientView`
- one centralized script-event bridge from core events and relevant frontend workflow transitions to `ScriptEvent`
- one adapter from `ScriptIntent` to `AppAction` or `ClientCommand`

That means the glue is not “everywhere.” It is three explicit translation seams.

### Facade Rule

The facade should be read-only, semantic, and batch-oriented.

Good facade calls:

- `self_entity()`
- `target_entity()`
- `nearby_entities()`
- `inventory_items()`
- `active_spells()`

Bad facade calls:

- `health_current_raw_field()`
- `selected_dashboard_tab()`
- `chat_input_buffer_text()`
- `context_panel_scroll_offset()`
- `is_confirmation_modal_visible()`

Good workflow-oriented calls instead:

- `pending_confirmation()`
- `busy_operation()`
- `can_submit_confirmation_response()`

### Implementation Strategy For Thin Glue

The adapter should be implemented once against the existing frontend projection.

Suggested first adapter:

```rust
pub struct TuiScriptClientView<'a> {
    pub app: &'a AppState,
    pub game: Option<&'a GameState>,
}

impl ScriptClientView for TuiScriptClientView<'_> {
    // build semantic views from AppState/GameData here
}
```

This keeps the MVP cheap. Later, if a future 3D client wants scripting, it can implement the same `ScriptClientView` trait against its own local projection.

The key is that scripts depend on `ScriptClientView`, not on `GameData`.

### What To Reuse Directly

The adapter should reuse existing helpers where they already encode game semantics rather than UI behavior.

Examples that are good reuse candidates:

- `GameData::runtime_position_for_guid`
- `GameData::runtime_sample_for_guid`
- `GameData` inventory and equipment ownership tracking
- `RuntimeBodyViewCache`
- `WorldContext`-style semantic helpers already implemented on `GameData`
- `Interaction::Targeting { target_guid }` as the current TUI seam for target-entity projection

Examples that should not be pulled into script reads:

- dashboard tab logic
- chat input state
- raw modal visibility and overlay mechanics
- render/layout caches

## 7. Crate Layout Recommendation

### Target Shape

Introduce a shared scripting crate once the MVP shape is proven.

Suggested eventual layout:

- `crates/holtburger-scripting`
  - script host and deno runtime ownership
  - `ScriptEvent`, `ScriptIntent`, `ScriptClientView`
  - JS extension/op registration
- `apps/holtburger-cli`
  - TUI-specific adapter implementing `ScriptClientView`
  - bridge from shell events into script host
  - bridge from `ScriptIntent` into `AppAction` or `ClientCommand`

### MVP Exception

If it reduces startup friction, the first spike can live under the TUI crate, but the public Rust interfaces should still be written as if they will move into a shared crate.

That means:

- avoid ratatui types in the scripting surface
- avoid direct references to TUI view widgets
- avoid naming that assumes terminal UX is the only client

## 8. Phase Breakdown

### Phase 1: Define The Stable Host Boundary

Deliverables:

- Add scripting architecture docs.
- Define `ScriptEvent`, `ScriptIntent`, and `ScriptClientView` traits and view types on paper.
- Define the three translation seams explicitly.

Acceptance Criteria:

- We can describe how a script observes state, queries current client-visible state, and emits commands without referring to direct `GameState` mutation.
- The API shape avoids TUI widget concepts.

### Phase 2: TUI-Side MVP Host

Deliverables:

- Create a minimal host owner on the frontend side.
- Feed a curated event stream into the host.
- Implement one TUI-side `ScriptClientView` adapter.
- Support a small set of intents such as log, say, approach, use, attack.

Acceptance Criteria:

- A test script can react to a chat or entity event and emit at least one gameplay intent through the normal app shell.
- No direct reads from authoritative `WorldState` are required.

### Phase 3: Shared Surface Extraction

Deliverables:

- Move generic scripting types and host code into a shared crate.
- Keep the TUI-specific adapter in the TUI crate.

Acceptance Criteria:

- The scripting API no longer depends on TUI-local types.
- The TUI host code becomes adapter glue rather than the home of the whole runtime.

## 9. Risks And Mitigations

### Risk: The Facade Slowly Becomes A Full Duplicate Of `GameData`

Mitigation:

- Keep the facade semantic and use-case-driven.
- Add fields only when scripts need a stable concept, not just because a `GameData` field exists.

### Risk: Script Events Diverge From TUI Event Semantics

Mitigation:

- Derive `ScriptEvent` from one centralized bridge that observes the same core events and frontend workflow transitions that already drive the projection and client workflow state.
- Keep event derivation centralized rather than spreading it across reducers and panels.

### Risk: The Host Ends Up Owning Another Hidden Reducer

Mitigation:

- The host should not mutate game projection state.
- It should only observe, query, and emit intents.

### Risk: MVP Code Gets Trapped In The TUI

Mitigation:

- Write the scripting surface without ratatui or widget-local types.
- Use trait-based world access from the start.

### Risk: `deno_core` Pumping Complicates The Main Shell Loop

Mitigation:

- Prefer a dedicated owner thread for the JS runtime.
- Treat shell integration as channel-based rather than direct shared ownership.

## 10. Definition Of Done

- Scripts can observe a curated event stream.
- Scripts can query a stable semantic client-view facade backed by the existing frontend projection.
- Scripts can emit explicit intents that flow through the normal app shell.
- No direct `WorldState` exposure is required.
- No TUI widget or render-state details leak into the script contract.
- Scripting glue remains centralized in three translation seams rather than scattered across reducers and panels.

## 11. Decisions And Remaining Open Questions

### Recorded Decisions

- The first script host should emit `ScriptIntent` only. Do not add a direct `ClientCommand` escape hatch in the MVP.
- Confirmation and busy-operation state should be available both as events and as snapshot-style reads.
- The first host can be scoped to active in-world game-page state. In practice that means one host per entered-world character session is fine for now, but it should start on actual in-world session entry rather than merely on `Page::Game` creation.
- `ScriptIntent only` means scripts do not bypass the intent layer. It does not mean every intent payload is already a universally shared cross-client semantic; `Client(ScriptClientIntent)` exists specifically for current-client policy.

### Rationale

- Keeping the MVP write surface to `ScriptIntent` preserves the action-first integration model and avoids locking scripts onto low-level command details too early.
- Exposing workflow state as both events and snapshot reads avoids forcing scripts to reconstruct current state solely from event history while still letting them react incrementally.
- The current TUI does not have meaningful session-restart orchestration, and scripts only make sense after entering the world anyway, so binding host lifetime to the game-page session is operationally simple and architecturally acceptable.

### Remaining Open Questions

- Should the host be created eagerly on entering `ClientState::InWorld`, or lazily on first script load after entering the world?
- Should script source loading be restricted to local files for the MVP, or do we want an abstract loader seam from the start?

### Deferred Workflow Note

Confirmation handling does not materially change the core scripting integration shape.

- Core-backed confirmations already fit the event plus intent model cleanly.
- Some local confirmations are currently TUI-owned, but that does not force a different runtime topology or facade design.
- The initial integration can defer a unified confirmation API as long as the architecture leaves room for a later semantic workflow surface.

Practical implication:

- do not block the scripting host, event bridge, or client-view facade work on confirmation cleanup
- record confirmation workflows as a follow-up API-shaping task
- if needed, the MVP can simply omit confirmation control and document that limitation

## 12. Recommended First Implementation Slice

Start with the smallest slice that proves the architecture without overcommitting the API:

- script host owner thread
- `ScriptEvent::ChatMessage`
- `ScriptEvent::EntityAppeared`
- `ScriptClientView::self_entity`
- `ScriptClientView::nearby_entities`
- `ScriptIntent::Log`
- `ScriptIntent::Say`
- `ScriptIntent::Client(ScriptClientIntent::TargetEntity { .. })`
- `ScriptIntent::Client(ScriptClientIntent::Approach { .. })`

Host lifetime for this slice should be tied to the active in-world game-page session. Concretely, that means it should start only once the client is actually in world rather than merely after `TransitionToGame`, and it does not need to survive character changes or pre-world selection state in the first implementation.

If that slice feels awkward, the architecture is wrong. If that slice feels clean, the rest can grow from the same seams.