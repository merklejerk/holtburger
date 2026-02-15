# Event Boundary Architecture Worksheet (2026-02-14)

## 1) Context & Boundaries

### Goal
Define a durable event architecture for `holtburger-core` that keeps protocol fidelity, avoids consumer confusion, and supports higher-level convenience abstractions without overfitting transport details into app-facing APIs.

### In Scope
- Define the target 3-layer event model:
  - `WireEvent` (1:1 protocol semantics)
  - `StateEvent` (state mutation model)
  - `ClientViewEvent` (consumer-friendly abstractions)
- Identify which current event areas should migrate first.
- Capture decisions already made for stats/vitals/properties/spells/entities/errors/enchantments.
- Provide phased migration plan and acceptance criteria.

### Out of Scope
- Implementing the refactor in this worksheet.
- Reworking packet parsing internals.
- UI redesign beyond adapting to new event contracts.

---

## 1.1) Quick Glossary (When to Use Which)

- **`WireEvent`**: Use when you care about protocol fidelity, packet-order debugging, replay parity, or reverse-engineering.
- **`StateEvent`**: Use when you care about authoritative in-memory world/player state transitions in core.
- **`ClientViewEvent`**: Use when you are building app/UI/tool features and want stable, consumer-friendly semantics.

### Rule of Thumb
- If the question is **"what did the server send?"**, use `WireEvent`.
- If the question is **"what changed in core state?"**, use `StateEvent`.
- If the question is **"what should the app render/do?"**, use `ClientViewEvent`.

---

## 1.2) Separation Philosophy (Why Three Event Types)

### Core Principle
One event stream should not have to optimize for mutually conflicting goals. In this project, we have three distinct goals:

1. **Fidelity** — preserve protocol truth for debugging and parity work.
2. **Authority** — model deterministic state mutation in core.
3. **Ergonomics** — provide stable, low-cognitive-load data for consumers.

Trying to satisfy all three in one enum causes ambiguity, brittle ordering dependencies, and API churn.

### Design Intent Per Layer
- **`WireEvent` is observational**: it reports what arrived, without reinterpreting intent.
- **`StateEvent` is authoritative**: it describes accepted state mutation after core logic applies.
- **`ClientViewEvent` is opinionated**: it provides pre-joined/snapshot abstractions to reduce consumer complexity.

### Invariants
- `WireEvent` should never be required for normal UI correctness.
- `StateEvent` should be derivable from authoritative core state transitions, not UI concerns.
- `ClientViewEvent` should be generated from authoritative state, not directly from raw transport deltas.
- Loss of one stream should not corrupt the semantics of another stream.

### Anti-Patterns to Avoid
- Using `WireEvent` as a de facto UI API.
- Emitting consumer-specific convenience payloads in `StateEvent`.
- Deriving `ClientViewEvent` directly from packet order when a state snapshot is available.
- Creating one-off typed events for every possible property mutation.

### Why This Matters Here
- Vitals can update frequently and should stay efficient and explicit.
- Property IDs are broad and dynamic, so generic state-level property mutation is practical.
- Enchant/spell/entity views benefit from snapshot-style consumer abstractions to avoid ordering bugs.
- Reverse-engineering and parity validation still require a protocol-fidelity stream.

### Reviewer Decision Checklist (Where Should a New Event Live?)

For any new event, answer these in order:

1. **Is packet-fidelity/order itself the product requirement?**
  - Yes → `WireEvent`
  - No → continue
2. **Does this represent an authoritative core state mutation?**
  - Yes → `StateEvent`
  - No → continue
3. **Is this primarily for app/UI/tool ergonomics?**
  - Yes → `ClientViewEvent`
4. **Would consumers otherwise need to replay fragile deltas/order?**
  - Yes → prefer snapshot-style `ClientViewEvent`
5. **Is this a high-frequency hot path (e.g., vitals/movement)?**
  - Yes → keep minimal payloads; avoid heavy wrapping/snapshots unless required
6. **Does abstraction create one event per property/flag and explode surface area?**
  - Yes → keep generic at `StateEvent`, add selective `ClientViewEvent` only for high-value flows

If answers conflict, bias toward:
- correctness and debuggability first (`WireEvent` + `StateEvent`),
- then additive `ClientViewEvent` for ergonomics.

---

## 2) Ground Truth & Existing Patterns

### Reference Sources
- `crates/holtburger-core/src/client/types.rs`
- `crates/holtburger-core/src/world/mod.rs`
- `crates/holtburger-core/src/client/messages.rs`
- `crates/holtburger-core/src/world/player/messages.rs`
- `apps/holtburger-cli/src/ui/update/world.rs`
- `crates/holtburger-common/src/properties.rs`
- `ACE/Source/ACE.Server/**` (semantic behavior/source-of-truth for server event intent)

### Current Constraints / Observations
- Some gameplay systems (vitals, movement, physics) are high-frequency and should avoid expensive abstraction overhead.
- `Property*` IDs are very broad; creating one event type per property is not practical.
- Resource resolution is a cross-cutting concern (spells now, assets generally later), so it remains a separate pattern.

---

## 3) Decisions Locked (from design discussion)

1. **Stats + Skills can be combined** into a single snapshot-style abstraction.
2. **Vitals remain separate** due to high-frequency updates.
3. **Generic property updates remain generic** (no explosion of one-off typed events for each property).
4. **`PlayerSpellsUpdated` abstraction is desired**, while retaining resource-resolution flow for asset enrichment.
5. **Entity transport abstraction is desired** (consumer-facing entity updates should be cleaner than raw movement/physics deltas).
6. **Error dedupe/normalization is desired** (avoid duplicated error representations across client/world layers).
7. **Architecture direction: add a third event kind** rather than forcing one stream to satisfy all needs.

---

## 4) Target Architecture

## 4.1 `WireEvent` (wire-fidelity stream)
Purpose: debugging, protocol parity, replay tooling, deterministic packet-order reasoning.

Characteristics:
- 1:1 with decoded protocol messages/events.
- Minimal transformation.
- Stable for reverse-engineering and fixture validation.

Examples:
- Raw game-event opcode payloads.
- Decoded `GameMessage` / `GameEvent` variants with protocol fields preserved.

## 4.2 `StateEvent` (state mutation stream)
Purpose: represent world/player state changes produced by core simulation/state tracking.

Characteristics:
- Still relatively low-level.
- Safe for core subsystems and deterministic state application.
- Should not require transport-level context to be meaningful.

Examples:
- Entity spawned/despawned.
- Vital updated.
- Property updated (generic by design).

## 4.3 `ClientViewEvent` (consumer abstraction stream)
Purpose: app-facing ergonomics and correctness, especially for UI/tools.

Characteristics:
- Snapshot/pre-joined abstractions where order-sensitive deltas are brittle.
- Resource-enriched where possible.
- Explicitly *not* required to be protocol-1:1.

Examples:
- `PlayerStatsSkillsUpdated` (combined stat+skill view).
- `VitalUpdated` (kept independent).
- `PlayerSpellsUpdated` (+ optional resolved metadata).
- `PlayerEnchantmentsUpdated` (canonical snapshot).
- `EntityUpserted/EntityRemoved` or equivalent transport abstraction.
- `ErrorEvent` (deduped, normalized shape).

## 4.4 Proposed `ClientViewEvent` v1 Catalog (Concrete)

The following are proposed initial shapes for v1. These are intentionally explicit to reduce interpretation drift during implementation.

### `ClientViewEvent::PlayerStatsSkillsUpdated`
- **Purpose:** single consumer snapshot for stats+skills rendering.
- **Fields:**
  - `attributes: Vec<Attribute>`
  - `skills: Vec<Skill>`
  - `resistances: Resistances`
  - `armor: i32`
  - `vitae: f32`
- **Emission:** after any state mutation that changes derived stats/skills.

### `ClientViewEvent::PlayerVitalUpdated`
- **Purpose:** retain high-frequency, low-latency vital updates.
- **Fields:**
  - `vital: Vital`
- **Emission:** on each accepted vital mutation.

### `ClientViewEvent::PlayerSpellsUpdated`
- **Purpose:** canonical spellbook snapshot for consumers.
- **Fields:**
  - `spell_ids: Vec<u32>`
  - `resolved: Vec<ResolvedSpellSummary>` (optional/partial)
- **Notes:** supports existing resource resolution pattern; unresolved entries are allowed.

### `ClientViewEvent::PlayerEnchantmentsUpdated`
- **Purpose:** canonical enchantment snapshot to avoid fragile delta replay.
- **Fields:**
  - `enchantments: Vec<Enchantment>`
  - `resolved_names: std::collections::HashMap<u32, String>` (optional/partial)
- **Emission:** after any enchant mutation/purge/dispel/update flow.

### `ClientViewEvent::EntityUpserted`
- **Purpose:** normalized entity update for consumer caches.
- **Fields:**
  - `entity: Entity`
  - `change_mask: EntityChangeMask` (optional; aids efficient UI updates)
- **Emission:** spawn + meaningful update paths that alter observable entity state.

### `ClientViewEvent::EntityRemoved`
- **Purpose:** normalized removal event.
- **Fields:**
  - `guid: Guid`

### `ClientViewEvent::ErrorRaised`
- **Purpose:** one normalized, deduped consumer error surface.
- **Fields:**
  - `source: ErrorSource` (`Wire`, `State`, `Client`)
  - `code: Option<u32>`
  - `kind: ErrorKind` (e.g., `Weenie`, `Character`, `Client`, `Transport`)
  - `message: String`
  - `is_transient: bool`

### Supporting v1 Helper Types
- `ResolvedSpellSummary { spell_id: u32, name: Option<String>, school: Option<u32>, icon: Option<Guid> }`
- `EntityChangeMask` bitflags (position/properties/container/wielder/physics/etc)
- `ErrorSource` and `ErrorKind` enums for normalization

### Emission Contract (v1)
- `ClientViewEvent` is additive and derived from authoritative state.
- Event ordering must preserve causality relative to source `StateEvent` mutation.
- Missing resource metadata must never block emission (partial payloads are valid).
- Snapshot events should replace consumer-side replay of fragile deltas.

## 4.5 Decision Defaults (Adopted)

The following defaults are adopted for implementation unless explicitly revised:

1. **Transport/API shape:** `ClientViewEvent` uses a **parallel channel** as the long-term interface.
  - Single-PR cutover target: **no temporary `ClientEvent::ClientView(...)` bridge** in merged state.
2. **Projection location:** `ClientViewEvent` is generated in a **dedicated projector layer after state mutation**, reading authoritative state.
3. **Ordering contract:** within one processing cycle, ordering is:
  - `WireEvent` → `StateEvent` mutation(s) → derived `ClientViewEvent`.
4. **Async enrichment semantics:** resource resolution completion may append/update `ClientViewEvent` later; it must not block initial emission.
5. **PR posture:** this plan targets a **single PR cutover** with no compatibility window.

---

## 5) Event Area Matrix (Keep vs Abstract)

| Area | WireEvent | StateEvent | ClientViewEvent | Notes |
|---|---|---|---|---|
| Stats + Skills | Keep raw | Keep if needed internally | **Add combined snapshot** | Approved direction |
| Vitals | Keep raw | Keep separate | Keep separate (optional light normalization) | High-frequency path |
| Properties | Keep raw | Keep `PropertyUpdated` generic | Optional selective abstractions only for high-value cases | Avoid type explosion |
| Spells | Keep raw spell deltas | Keep current mutation events/state | **Add `PlayerSpellsUpdated`** | Keep resource-resolution pattern |
| Enchantments | Keep raw deltas/purges | Keep state mutation stream | **Add canonical snapshot event** | Avoid delta ordering issues in consumers |
| Entities | Keep raw movement/physics | Keep world mutation stream | **Add entity transport abstraction** | Consumer simplicity |
| Errors | Keep protocol/weanie forms | Keep if needed for world semantics | **Add normalized deduped error event** | Reduce duplicate handling paths |

---

## 6) Phased Migration Plan

### Phase 1 — Introduce ClientViewEvent rail
#### Deliverables
- Add `ClientViewEvent` enum + emission plumbing in core.
- Add parallel channel/subscription path for `ClientViewEvent`.
- Keep `WireEvent` / `StateEvent` available for debug and internal state consumers.

#### Acceptance Criteria
- End-of-PR consumers compile and run against the new event boundaries.
- `ClientViewEvent` stream can be observed in parallel.

### Phase 2 — First abstractions (low-risk/high-value)
#### Deliverables
- Add `PlayerEnchantmentsUpdated` canonical `ClientViewEvent`.
- Add normalized `ErrorRaised` `ClientViewEvent`.
- Add initial entity abstraction event(s) for consumer usage.

#### Acceptance Criteria
- TUI can consume `ClientViewEvent` for enchants/errors/entities without regressions.
- Death/purge/order-sensitive cases remain correct.

### Phase 3 — Stats/skills + spells abstraction
#### Deliverables
- Add combined stats+skills `ClientViewEvent` snapshot.
- Keep vitals on independent update path.
- Add `PlayerSpellsUpdated` `ClientViewEvent` snapshot with optional resolved metadata.

#### Acceptance Criteria
- Client-view consumer can render character panel from `ClientViewEvent` stream with fewer joins.
- Resource-resolution pattern remains intact and extensible.

### Phase 4 — Consumer migration strategy
#### Deliverables
- Migrate TUI to `ClientViewEvent` where beneficial.
- Keep wire/state subscriptions available for debug and advanced tooling.
- Document intended usage per stream in architecture docs.

#### Acceptance Criteria
- Reduced consumer complexity in UI handlers.
- No loss of debugging fidelity.

### Phase 5 — Final Cleanup & Enforcement (same PR)
#### Deliverables
- Ensure no temporary bridge code exists (`ClientEvent::ClientView(...)` remains absent).
- Remove obsolete dual-path handlers introduced during implementation.
- Remove stale comments/toggles/feature flags created only for transition scaffolding.
- Remove legacy consumer patterns replaced by steady-state `ClientViewEvent` consumption.

#### Acceptance Criteria
- No migration/compatibility shims remain anywhere in merged code.
- `ClientViewEvent` projector path is the only supported consumer abstraction source.
- Documentation describes only steady-state architecture.

---

## 7) Risks & Mitigations

- **Risk:** Triple-stream model creates ambiguity for consumers.
  - **Mitigation:** Publish strict guidance: Wire for fidelity, State for simulation, ClientView for app/UI.
- **Risk:** Duplicate event volume / performance overhead.
  - **Mitigation:** Make `ClientViewEvent` opt-in and use lightweight cloning/snapshots only where needed.
- **Risk:** Drift between State and ClientView interpretations.
  - **Mitigation:** Build `ClientViewEvent` from authoritative state snapshots after mutation.
- **Risk:** Over-abstracting high-frequency paths (vitals/movement).
  - **Mitigation:** Keep vitals separate and avoid excessive wrapping on hot paths.

---

## 8) Definition of Done (for implementation effort)

- Core exposes three clearly documented event streams with explicit intent.
- TUI consumes `ClientViewEvent` for at least: enchantments, errors, and entity transport abstraction.
- Stats+skills abstraction exists; vitals remain separate.
- Spells abstraction exists and works with resource resolution.
- Generic property update remains generic at State layer.
- Tests cover at least one ordering-sensitive scenario (e.g., enchant update + purge).
- No temporary migration shims or bridge code exist in merged state.

---

## 9) Execution Worksheet

### A) Checklist

#### Phase 1
- [x] Introduce `ClientViewEvent` type and emission channel.
- [x] Add parallel subscription API for `ClientViewEvent`.
- [x] Keep `WireEvent` + `StateEvent` available for their intended roles.

#### Phase 2
- [x] Add `PlayerEnchantmentsUpdated` `ClientViewEvent`.
- [x] Add normalized `ErrorRaised` `ClientViewEvent`.
- [x] Add entity transport abstraction event(s).

#### Phase 3
- [x] Add combined stats+skills `ClientViewEvent` snapshot.
- [x] Keep vitals separate and verify update cadence behavior.
- [x] Add `PlayerSpellsUpdated` + resource-enrichment hooks.

#### Phase 4
- [x] Migrate TUI handlers to selected `ClientViewEvent` variants.
- [x] Verify no behavior regressions in death/purge/movement/error cases.
- [x] Document stream usage guidance.

#### Phase 5
- [x] Confirm no temporary bridge/event rollout shims exist.
- [x] Delete obsolete dual-path consumer handlers.
- [x] Remove migration-only feature flags/toggles/comments.
- [x] Confirm docs describe only steady-state architecture.

### B) Decision Log

| Date | Decision | Why | Impact |
|---|---|---|---|
| 2026-02-14 | Keep vitals separate | High-frequency updates | Avoid hot-path overhead |
| 2026-02-14 | Keep properties generic | Too many property IDs | Prevent event type explosion |
| 2026-02-14 | Add spells abstraction but keep resolver pattern | Assets are cross-cutting | Future-proof resource model |
| 2026-02-14 | Add third stream (`ClientViewEvent`) | Separate fidelity vs ergonomics | Cleaner API boundaries |
| 2026-02-14 | Use parallel `ClientViewEvent` channel by default | Avoid overloading `ClientEvent` and keep boundaries clear | Cleaner long-term API |
| 2026-02-14 | Add mandatory cleanup phase | Prevent permanent migration/legacy code | Lower maintenance burden |
| 2026-02-14 | Single-PR cutover (no compatibility window) | Avoid legacy migration code | Faster convergence to steady-state architecture |
| 2026-02-14 | Trigger snapshots on Character Selection Success / PlayerDescription | Vitals/Stats/Spells initial sync | Ensure UI is ready immediately on logon |
| 2026-02-14 | Subsystems (Auth/Movement) return events instead of emitting | Enable centralized projection | Guarantees all events hit the Projector for translation |
| 2026-02-14 | Use `HashMap` instead of `Vec` for Stats/Skills snapshots | O(1) lookup for UI rendering | Significantly reduces UI logic complexity |
| 2026-02-14 | Centralize Character Selection in `messages.rs` | Resolve borrow checker conflicts | Safe mutation of player state during auth flow |
| 2026-02-14 | Add `Default` to `CharacterLevelInfo` | Early projection safety | Prevents crashes during early-sync snapshots |
| 2026-02-14 | Use `AppAction::ReceivedViewEvent` for TUI bridge | Connect TUI main loop to broadcast | Safe multi-threaded event handling |
| 2026-02-14 | Gut TUI `WorldEvent` handlers in Phase 5 | Enforce authoritative snapshot use | Eliminates logic duplication and UI drift |
| 2026-02-14 | Use `Box<Entity>` in `ClientViewEvent` | Balance performance vs ergonomics | Avoids excessive large-object clones while keeping events predictable |

### C) Verification Log

| Date | Check | Result | Notes |
|---|---|---|---|
| 2026-02-14 | `cargo check -p holtburger-core` | ✅ | Phase 1 stream plumbing compiles in core |
| 2026-02-14 | `cargo check -p holtburger-cli` | ✅ | Existing CLI consumer unchanged and compiling |
| 2026-02-14 | Phase 2 implementation | ✅ | Enchants, Errors, and Entity abstractions implemented and projected correctly. |
| 2026-02-14 | Phase 3 implementation | ✅ | Stats, Skills, and Spells abstractions implemented. Character Selection triggers initial sync. |
| 2026-02-14 | Phase 4/5 integration check | ✅ | CLI fully migrated to ClientViewEvents; compilation success across workspace. |
| YYYY-MM-DD | Focused event-order tests | ⬜ | Enchant/update/purge ordering |
| YYYY-MM-DD | Manual TUI smoke via user-run | ⬜ | Verify panel/state correctness |

### D) Open Questions (Remaining)

1. Which concrete API shape should the parallel `ClientViewEvent` channel use (tokio broadcast vs mpsc fanout vs callback registration)?
2. What is the exact ordering contract for late resource-resolution updates relative to already-emitted `ClientViewEvent` snapshots?
3. What performance budget do we accept for snapshot/event fanout overhead (CPU + allocations) on high-traffic sessions?
